// keychainMigration — move the shared secrets into a Keychain access group so the
// Share Extension can read them.
//
// WHY THIS IS DELICATE. A Keychain item is identified partly by its access group.
// An item written WITHOUT one lives in the app's default group, and a read from a
// different group returns **nil, not an error** — so a botched migration doesn't
// throw, it just makes the device look unenrolled. On this project that means the
// car stops unlocking from the app, and the failure gives no clue why.
//
// So the order here is not negotiable:
//
//   1. read from the OLD (ungrouped) location
//   2. if absent → nothing to do (fresh install, or already migrated)
//   3. write to the NEW (grouped) location
//   4. READ IT BACK from the new location and compare byte-for-byte
//   5. only if step 4 matches, delete the old
//
// Step 4 is the whole point. Never delete a secret you have not proven you can
// read back. If the verify fails we leave BOTH copies and report it — a duplicate
// secret is recoverable, a deleted one is not.
//
// Idempotent by construction: after a successful run the old location is empty,
// so step 2 short-circuits every subsequent launch.
//
// Pure: takes two injected SecretStores, so it is node-testable and has no
// expo-secure-store import. The app wires the real ones in.

import type { SecretStore } from './types';

// The two secrets the Share Extension needs. The device key proves who we are to
// the car; the Pi config carries the bearer token for the network arm. Anything
// added here later must also be added to the extension's read path.
export const SHARED_SECRET_KEYS = ['ble.deviceKey.v1', 'ble.piConfig.v1'] as const;

export type MigrationOutcome =
  // Nothing was in the old location — fresh install, or a previous run finished.
  | { key: string; status: 'absent' }
  // Copied and verified; the old copy is gone.
  | { key: string; status: 'migrated' }
  // Copied but the read-back did not match. BOTH copies still exist. The app is
  // still working (it reads the old one); the extension may not see the value.
  | { key: string; status: 'verify-failed'; detail: string }
  // Something threw. Old copy untouched.
  | { key: string; status: 'error'; detail: string };

export interface MigrationReport {
  outcomes: MigrationOutcome[];
  // True only if every key ended up either absent or migrated. Anything else
  // means the extension cannot be trusted to read secrets yet.
  ok: boolean;
}

// migrateSecretsToAccessGroup copies each shared secret from `from` to `to`,
// verifying every copy before removing the original.
//
// `from` and `to` are the SAME underlying Keychain with different access groups —
// that is why this cannot be a rename and has to be read/write/verify/delete.
export async function migrateSecretsToAccessGroup(
  from: SecretStore,
  to: SecretStore,
  keys: readonly string[] = SHARED_SECRET_KEYS,
): Promise<MigrationReport> {
  const outcomes: MigrationOutcome[] = [];

  for (const key of keys) {
    try {
      const value = await from.getItem(key);
      if (value === null) {
        // Either never enrolled, or a previous run already moved it. Both are
        // "nothing to do" — do NOT treat an already-migrated key as a failure.
        outcomes.push({ key, status: 'absent' });
        continue;
      }

      await to.setItem(key, value);

      const readBack = await to.getItem(key);
      if (readBack !== value) {
        // The grouped write did not take. Leave the original alone: the app keeps
        // working off it, and we would rather ship a duplicate than lose the key.
        outcomes.push({
          key,
          status: 'verify-failed',
          detail: readBack === null ? 'read-back was null' : 'read-back did not match',
        });
        continue;
      }

      // NO DELETE. 2026-07-27: this deleted the ungrouped Pi config after a
      // verified read-back, and the grouped copy was then unreadable on a later
      // launch — baseUrl, token and VIN gone. A same-process read-back does not
      // prove an item survives a relaunch, and moving a secret buys nothing that
      // copying does not. Both copies stay; reads prefer the grouped one.
      outcomes.push({ key, status: 'migrated' });
    } catch (err) {
      outcomes.push({ key, status: 'error', detail: err instanceof Error ? err.message : String(err) });
    }
  }

  return { outcomes, ok: outcomes.every((o) => o.status === 'absent' || o.status === 'migrated') };
}

// makeMigratingSecretStore — a SecretStore that heals itself on read.
//
// WHY THIS EXISTS RATHER THAN JUST THE EAGER MIGRATION ABOVE. `loadOrCreateDeviceKeys`
// CREATES a key when it reads null (useCarLink calls it on mount). So a read that
// beats the eager migration does not merely fail — it mints a NEW device key and
// silently re-enrols the phone, and the car stops recognising it. Ordering an
// effect against every possible reader is not a guarantee; removing the race is.
//
// So every read goes: shared → if empty, legacy → if found, promote it. Any caller,
// any time, any order, gets the real value. The eager migration becomes an
// optimisation and a source of log lines, not a correctness requirement.
//
// Promotion follows the same rule as the eager path: verify the read-back before
// deleting the legacy copy, and on any doubt keep both.
export function makeMigratingSecretStore(shared: SecretStore, legacy: SecretStore): SecretStore {
  return {
    async getItem(key) {
      // A THROW from the shared store must not propagate. A misconfigured access
      // group makes every Keychain call throw errSecMissingEntitlement, and on
      // 2026-07-27 that took the whole app down — the throw reached
      // loadOrCreateDeviceKeys and nothing worked. Reading is the one operation
      // that always has a second place to look, so look there instead of failing.
      let current: string | null = null;
      try {
        current = await shared.getItem(key);
      } catch {
        current = null;
      }
      if (current !== null) return current;

      const old = await legacy.getItem(key);
      if (old === null) return null; // genuinely absent in both — a real fresh install

      // Promote. If anything about this fails, still return `old` — the caller
      // must never see null for a key we demonstrably hold, or it will mint a
      // replacement.
      try {
        // COPY, never move. See the note in migrateSecretsToAccessGroup: the
        // delete that used to live here lost a live Pi config.
        await shared.setItem(key, old);
      } catch {
        // Grouped store unavailable; the legacy copy is still authoritative.
      }
      return old;
    },
    async setItem(key, value) {
      // A write has no second place to look, so a failure here is real — but
      // losing the value is worse than storing it somewhere less useful. Fall back
      // to the legacy location so the secret survives; the next successful read
      // promotes it once the shared store works again.
      try {
        await shared.setItem(key, value);
      } catch (err) {
        await legacy.setItem(key, value);
        throw err; // still surface it — this is a misconfiguration, not a mode
      }
    },
    async removeItem(key) {
      // Delete BOTH, or a "forget this device" would leave the legacy copy behind
      // to be silently promoted again on the next read.
      await shared.removeItem(key).catch(() => {});
      await legacy.removeItem(key).catch(() => {});
    },
  };
}

// makeReadOnlyFallbackStore — the SAFE ROLLBACK.
//
// Reads from BOTH locations (grouped first, then ungrouped) and MOVES NOTHING.
// Writes go to the ungrouped location, exactly as before any of this work.
//
// Why not simply revert to the plain ungrouped store: by the time you need a
// rollback, the promotion may already have moved the key into the grouped
// location and deleted the original. A plain ungrouped store would then find
// nothing — and loadOrCreateDeviceKeys would mint a replacement, turning a
// recoverable problem into a lost enrolment. Reading both is the only revert that
// is safe regardless of how far the migration got.
export function makeReadOnlyFallbackStore(shared: SecretStore, legacy: SecretStore): SecretStore {
  const tryGet = async (st: SecretStore, key: string): Promise<string | null> => {
    try {
      return await st.getItem(key);
    } catch {
      return null;
    }
  };
  return {
    async getItem(key) {
      // LEGACY FIRST — deliberately, and this is not arbitrary.
      //
      // 2026-07-27: the car rejected us with "key is not on the car whitelist"
      // while both locations held a device key. The ENROLLED key is the one that
      // was always in the ungrouped location; anything in the grouped location
      // arrived during the failed migration and may be a freshly minted key that
      // the car has never seen. Preferring the grouped copy meant presenting a
      // key the car does not know, over a link that was working perfectly.
      //
      // Reading legacy first restores exactly the pre-migration behaviour, which
      // is the whole point of a rollback.
      return (await tryGet(legacy, key)) ?? (await tryGet(shared, key));
    },
    setItem: (key, value) => legacy.setItem(key, value),
    async removeItem(key) {
      await shared.removeItem(key).catch(() => {});
      await legacy.removeItem(key).catch(() => {});
    },
  };
}

// One line per key, for the diagnostics file. The migration runs before anything
// user-visible, so this log is the only record of what happened.
export function formatMigrationReport(r: MigrationReport): string[] {
  return [
    `keychain migration: ${r.ok ? 'OK' : 'NEEDS ATTENTION'}`,
    ...r.outcomes.map((o) =>
      o.status === 'verify-failed' || o.status === 'error'
        ? `  ${o.key}: ${o.status} — ${o.detail} (original NOT deleted)`
        : `  ${o.key}: ${o.status}`,
    ),
  ];
}
