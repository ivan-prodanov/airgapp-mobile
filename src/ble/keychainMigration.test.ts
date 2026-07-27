import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

import {
  formatMigrationReport,
  makeMigratingSecretStore,
  migrateSecretsToAccessGroup,
  SHARED_SECRET_KEYS,
} from './keychainMigration.ts';
import type { SecretStore } from './types.ts';

// A Keychain stand-in. The real thing returns null (not an error) when you read
// under the wrong access group, which is exactly what makes this migration
// dangerous — so the fake models that: two independent maps, no cross-visibility.
function makeStore(seed: Record<string, string> = {}) {
  const map = new Map(Object.entries(seed));
  const store: SecretStore = {
    getItem: async (k) => map.get(k) ?? null,
    setItem: async (k, v) => void map.set(k, v),
    removeItem: async (k) => void map.delete(k),
  };
  return { store, map };
}

const KEY = 'ble.deviceKey.v1';

describe('migrateSecretsToAccessGroup', () => {
  it('copies, verifies, then deletes the original', async () => {
    const from = makeStore({ [KEY]: 'scalar-hex' });
    const to = makeStore();

    const r = await migrateSecretsToAccessGroup(from.store, to.store, [KEY]);

    assert.equal(r.ok, true);
    assert.deepEqual(r.outcomes, [{ key: KEY, status: 'migrated' }]);
    assert.equal(to.map.get(KEY), 'scalar-hex', 'value must land in the new group');
    assert.equal(from.map.get(KEY), 'scalar-hex', 'ORIGINAL IS KEPT — copy, never move');
  });

  it('is a no-op when the old location is empty', async () => {
    // Fresh install, or a previous run already finished. Must not be an error —
    // this is the steady state on every launch after the first.
    const from = makeStore();
    const to = makeStore({ [KEY]: 'already-here' });

    const r = await migrateSecretsToAccessGroup(from.store, to.store, [KEY]);

    assert.equal(r.ok, true);
    assert.deepEqual(r.outcomes, [{ key: KEY, status: 'absent' }]);
    assert.equal(to.map.get(KEY), 'already-here', 'must not disturb an already-migrated value');
  });

  it('KEEPS the original when the read-back is null', async () => {
    // The dangerous case: the grouped write silently did not take. Deleting here
    // would destroy the enrolment and the app would look unenrolled with no error.
    const from = makeStore({ [KEY]: 'scalar-hex' });
    const to = {
      store: {
        getItem: async () => null, // write appears to succeed, read returns nothing
        setItem: async () => {},
        removeItem: async () => {},
      } satisfies SecretStore,
    };

    const r = await migrateSecretsToAccessGroup(from.store, to.store, [KEY]);

    assert.equal(r.ok, false);
    assert.equal(r.outcomes[0].status, 'verify-failed');
    assert.equal(from.map.get(KEY), 'scalar-hex', 'ORIGINAL MUST SURVIVE a failed verify');
  });

  it('KEEPS the original when the read-back does not match', async () => {
    const from = makeStore({ [KEY]: 'scalar-hex' });
    const to = {
      store: {
        getItem: async () => 'something-else',
        setItem: async () => {},
        removeItem: async () => {},
      } satisfies SecretStore,
    };

    const r = await migrateSecretsToAccessGroup(from.store, to.store, [KEY]);

    assert.equal(r.ok, false);
    assert.equal(r.outcomes[0].status, 'verify-failed');
    assert.equal(from.map.get(KEY), 'scalar-hex');
  });

  it('KEEPS the original when the write throws', async () => {
    const from = makeStore({ [KEY]: 'scalar-hex' });
    const to = {
      store: {
        getItem: async () => null,
        setItem: async () => {
          throw new Error('keychain busy');
        },
        removeItem: async () => {},
      } satisfies SecretStore,
    };

    const r = await migrateSecretsToAccessGroup(from.store, to.store, [KEY]);

    assert.equal(r.ok, false);
    assert.equal(r.outcomes[0].status, 'error');
    assert.equal(from.map.get(KEY), 'scalar-hex');
  });

  it('one key failing does not stop the others', async () => {
    // Partial failure must be partial, not total: the Pi config failing to move
    // should not leave the device key stranded in the old group.
    const [deviceKey, piConfig] = SHARED_SECRET_KEYS;
    const from = makeStore({ [deviceKey]: 'scalar', [piConfig]: 'cfg' });
    const to = makeStore();
    let calls = 0;
    const flaky: SecretStore = {
      getItem: async (k) => to.map.get(k) ?? null,
      setItem: async (k, v) => {
        calls += 1;
        if (k === piConfig) throw new Error('nope');
        to.map.set(k, v);
      },
      removeItem: async (k) => void to.map.delete(k),
    };

    const r = await migrateSecretsToAccessGroup(from.store, flaky);

    assert.equal(calls, 2, 'both keys attempted');
    assert.equal(r.ok, false);
    assert.equal(r.outcomes.find((o) => o.key === deviceKey)?.status, 'migrated');
    assert.equal(r.outcomes.find((o) => o.key === piConfig)?.status, 'error');
    assert.equal(from.map.get(deviceKey), 'scalar', 'kept — copy, never move');
    assert.equal(from.map.get(piConfig), 'cfg', 'the one that failed is untouched');
  });

  it('migrates both shared secrets by default', async () => {
    const from = makeStore({ 'ble.deviceKey.v1': 'a', 'ble.piConfig.v1': 'b' });
    const to = makeStore();

    const r = await migrateSecretsToAccessGroup(from.store, to.store);

    assert.equal(r.ok, true);
    assert.deepEqual([...to.map.entries()].sort(), [
      ['ble.deviceKey.v1', 'a'],
      ['ble.piConfig.v1', 'b'],
    ]);
  });
});

describe('formatMigrationReport', () => {
  it('says which key failed and that the original survived', async () => {
    const from = makeStore({ [KEY]: 'x' });
    const to = { store: { getItem: async () => null, setItem: async () => {}, removeItem: async () => {} } satisfies SecretStore };
    const lines = formatMigrationReport(await migrateSecretsToAccessGroup(from.store, to.store, [KEY]));

    assert.equal(lines[0], 'keychain migration: NEEDS ATTENTION');
    assert.match(lines[1], /verify-failed — read-back was null \(original NOT deleted\)/);
  });
});

describe('makeMigratingSecretStore — the race that would mint a new device key', () => {
  it('returns the legacy value on a read that beats the eager migration', async () => {
    // The hazard this exists for: loadOrCreateDeviceKeys CREATES a key when it
    // reads null. A null here would silently re-enrol the phone with a new key
    // and the car would stop recognising it.
    const shared = makeStore();
    const legacy = makeStore({ [KEY]: 'enrolled-scalar' });
    const store = makeMigratingSecretStore(shared.store, legacy.store);

    assert.equal(await store.getItem(KEY), 'enrolled-scalar', 'must never report null for a key we hold');
  });

  it('promotes on read: after one read the value lives in the shared group only', async () => {
    const shared = makeStore();
    const legacy = makeStore({ [KEY]: 'enrolled-scalar' });
    const store = makeMigratingSecretStore(shared.store, legacy.store);

    await store.getItem(KEY);

    assert.equal(shared.map.get(KEY), 'enrolled-scalar');
    assert.equal(legacy.map.get(KEY), 'enrolled-scalar', 'legacy copy is KEPT — a verified read-back in-process does not prove the item survives a relaunch');
  });

  it('still returns the value when promotion fails, and keeps the legacy copy', async () => {
    const legacy = makeStore({ [KEY]: 'enrolled-scalar' });
    const brokenShared: SecretStore = {
      getItem: async () => null,
      setItem: async () => {
        throw new Error('keychain busy');
      },
      removeItem: async () => {},
    };
    const store = makeMigratingSecretStore(brokenShared, legacy.store);

    assert.equal(await store.getItem(KEY), 'enrolled-scalar', 'a broken write must not surface as absent');
    assert.equal(legacy.map.get(KEY), 'enrolled-scalar', 'legacy copy survives for the next attempt');
  });

  it('survives a shared store that THROWS on every call', async () => {
    // The 2026-07-27 regression: a wrong access group makes every Keychain call
    // throw errSecMissingEntitlement. That throw reached loadOrCreateDeviceKeys
    // and the whole app stopped working. A read has a second place to look — use
    // it rather than propagating.
    const legacy = makeStore({ [KEY]: 'enrolled-scalar' });
    const throwing: SecretStore = {
      getItem: async () => {
        throw new Error('A required entitlement is missing');
      },
      setItem: async () => {
        throw new Error('A required entitlement is missing');
      },
      removeItem: async () => {
        throw new Error('A required entitlement is missing');
      },
    };
    const store = makeMigratingSecretStore(throwing, legacy.store);

    assert.equal(await store.getItem(KEY), 'enrolled-scalar', 'must not propagate the throw');
    assert.equal(legacy.map.get(KEY), 'enrolled-scalar', 'and must not lose the value');
    await assert.doesNotReject(() => store.removeItem('unrelated'), 'removeItem tolerates it too');
  });

  it('a failed shared write still persists the value to legacy before rethrowing', async () => {
    const legacy = makeStore();
    const throwing: SecretStore = {
      getItem: async () => null,
      setItem: async () => {
        throw new Error('A required entitlement is missing');
      },
      removeItem: async () => {},
    };
    const store = makeMigratingSecretStore(throwing, legacy.store);

    await assert.rejects(() => store.setItem(KEY, 'fresh'), /entitlement/);
    assert.equal(legacy.map.get(KEY), 'fresh', 'the secret survives a misconfigured shared store');
  });

  it('returns null only when BOTH are empty', async () => {
    const store = makeMigratingSecretStore(makeStore().store, makeStore().store);
    assert.equal(await store.getItem(KEY), null);
  });

  it('prefers the shared value and does not consult legacy once migrated', async () => {
    const legacy = makeStore({ [KEY]: 'stale' });
    const shared = makeStore({ [KEY]: 'current' });
    const store = makeMigratingSecretStore(shared.store, legacy.store);

    assert.equal(await store.getItem(KEY), 'current');
    assert.equal(legacy.map.get(KEY), 'stale', 'untouched — no read fell through');
  });

  it('removeItem clears BOTH, so a forget cannot be undone by promotion', async () => {
    const shared = makeStore({ [KEY]: 'v' });
    const legacy = makeStore({ [KEY]: 'v' });
    const store = makeMigratingSecretStore(shared.store, legacy.store);

    await store.removeItem(KEY);

    assert.equal(shared.map.has(KEY), false);
    assert.equal(legacy.map.has(KEY), false, 'a leftover legacy copy would be silently promoted again');
    assert.equal(await store.getItem(KEY), null);
  });
});
