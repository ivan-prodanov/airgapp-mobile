// secureStoreSecretStore.ts — iOS Keychain-backed SecretStore.
//
// This is the PRODUCTION store for the device private key + Pi bearer token
// (the SecretStore the keystore.ts/config.ts layer persists to). Replaces the
// M1 hardware-bring-up AsyncStorage store: AsyncStorage is plaintext
// on-disk storage and was explicitly bring-up-only (see the removed
// asyncStorageSecretStore.ts's header comment, git history). Values are
// stored via the OS Keychain (expo-secure-store), not plaintext.
//
// Isolated in its own file (same pattern as the store it replaces) so no
// node-tested module ever transitively imports expo-secure-store (which is
// RN-only and can't load under node/tsx). Deliberately NOT re-exported from
// src/ble/index.ts — see that file's header comment on what the façade exposes.
//
// ── Two stores, because an item's access group is part of its identity ──
//
// The Share Extension is a separate process and can only read Keychain items
// written into a group BOTH binaries declare. An item written without a group
// lives in the app's private default group, and reading it from the extension
// returns **nil, not an error** — the device simply looks unenrolled, with no
// diagnostic. That is why the migration in keychainMigration.ts exists and why it
// verifies a read-back before deleting anything.
//
//   • sharedSecretStore — production. Everything the extension needs.
//   • legacySecretStore — the ungrouped location, kept ONLY so the one-time
//                         migration can find pre-existing secrets and move them.
//
// Nothing but keychainMigration.ts should touch the legacy store. A new secret
// goes in the shared store, with its key added to SHARED_SECRET_KEYS.

import * as SecureStore from 'expo-secure-store';
import type { SecretStore } from './types';

// Must match `keychain-access-groups` in BOTH ios/airgapp/airgapp.entitlements
// and ios/ShareExtension/ShareExtension.entitlements, AFTER `$(AppIdentifierPrefix)`
// expands — i.e. FULLY QUALIFIED, with the team prefix.
//
// expo-secure-store passes this straight through to kSecAttrAccessGroup
// (SecureStoreModule.swift:188, no prefixing), and that attribute requires the
// fully-qualified group. Passing the bare name is a group the binary has no
// entitlement for, and every Keychain call then fails with errSecMissingEntitlement
// (-34018) — surfaced as "A required entitlement is missing". Measured on-device
// 2026-07-27; I had asserted the opposite in this comment without checking.
//
// The team prefix is fixed for this project (AGENTS.md: DEVELOPMENT_TEAM=859B8N529C,
// and it warns against overriding it). Verify against the signed binary with:
//   codesign -d --entitlements - --xml <app> | plutil -p -
export const SHARED_KEYCHAIN_ACCESS_GROUP = '859B8N529C.local.airgapp.mobile.shared';

// AfterFirstUnlock rather than the WhenUnlocked default. A share sheet runs with
// the phone unlocked so WhenUnlocked would do — but the native passive-entry
// responder reads the same device key while the app is suspended and the phone may
// be locked, and a background read of a WhenUnlocked item fails silently. This
// matches the accessibility the native side already chose for its own copy
// (KeychainKey.swift: kSecAttrAccessibleAfterFirstUnlockThisDeviceOnly).
const OPTS: SecureStore.SecureStoreOptions = {
  accessGroup: SHARED_KEYCHAIN_ACCESS_GROUP,
  keychainAccessible: SecureStore.AFTER_FIRST_UNLOCK_THIS_DEVICE_ONLY,
};

// The shared group. THE single location — the app and the Share Extension read
// and write the same Keychain items, so there is exactly one answer to "what is
// the device key".
//
// Writes are VERIFIED. If a write does not read back, this throws instead of
// returning quietly, because the alternative is loadOrCreateDeviceKeys seeing an
// empty store on the next launch and minting a fresh key — silently re-enrolling
// the phone against a car that will reject it. That is the failure that cost an
// enrolment on 2026-07-27; it must be loud, not silent.
//
// Note what this does NOT claim: an immediate read-back proves the write landed,
// not that it survives a process restart. The restart proof is the enrolment
// itself — enrol, force-quit, reopen, and the key is either still there or it is
// not. There is nothing left to lose by finding out that way.
export const sharedSecretStore: SecretStore = {
  getItem: (k) => SecureStore.getItemAsync(k, OPTS),
  async setItem(k, v) {
    await SecureStore.setItemAsync(k, v, OPTS);
    if ((await SecureStore.getItemAsync(k, OPTS)) !== v) {
      throw new Error(
        `Keychain write to the shared access group did not read back (${k}). ` +
          'The group is not usable on this build — do not re-enrol until this is fixed.',
      );
    }
  },
  removeItem: (k) => SecureStore.deleteItemAsync(k, OPTS),
};

// The pre-split ungrouped location. Nothing reads or writes it in normal
// operation; it exists so wipeStoredSecrets can clear copies left there before
// the move to the shared group.
export const legacySecretStore: SecretStore = {
  getItem: (k) => SecureStore.getItemAsync(k),
  setItem: (k, v) => SecureStore.setItemAsync(k, v),
  removeItem: (k) => SecureStore.deleteItemAsync(k),
};

export const secureStoreSecretStore: SecretStore = sharedSecretStore;

// wipeStoredSecrets erases every JS-side copy of every shared secret — grouped
// AND ungrouped. Destructive by design: after this the device is unenrolled and
// must be re-enrolled with the NFC card.
//
// Exists so "there is exactly one key on this device" can be established by
// construction rather than argued about. Today proved that a device carrying
// several copies of a secret, some stale, is a device nobody can reason about.
export async function wipeStoredSecrets(keys: readonly string[]): Promise<string[]> {
  const done: string[] = [];
  for (const key of keys) {
    for (const [label, st] of [
      ['grouped', sharedSecretStore],
      ['ungrouped', legacySecretStore],
    ] as const) {
      try {
        const present = (await st.getItem(key)) !== null;
        if (!present) {
          done.push(`${key} @ ${label}: nothing to remove`);
          continue;
        }
        await st.removeItem(key);
        done.push(`${key} @ ${label}: ERASED`);
      } catch (err) {
        done.push(`${key} @ ${label}: FAILED — ${err instanceof Error ? err.message : String(err)}`);
      }
    }
  }
  return done;
}
