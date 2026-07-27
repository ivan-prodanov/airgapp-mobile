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

// The grouped location. Readable by the app AND the Share Extension.
export const sharedSecretStore: SecretStore = {
  getItem: (k) => SecureStore.getItemAsync(k, OPTS),
  setItem: (k, v) => SecureStore.setItemAsync(k, v, OPTS),
  removeItem: (k) => SecureStore.deleteItemAsync(k, OPTS),
};

// The pre-migration location: no access group, app-private.
export const legacySecretStore: SecretStore = {
  getItem: (k) => SecureStore.getItemAsync(k),
  setItem: (k, v) => SecureStore.setItemAsync(k, v),
  removeItem: (k) => SecureStore.deleteItemAsync(k),
};

// PRODUCTION — the plain, ungrouped Keychain. Exactly what shipped before the
// access-group work, and deliberately back to one location.
//
// 2026-07-27: an attempt to move these secrets into a shared access group so the
// Share Extension could read them lost the Pi config and, via useCarLink's
// setPassiveEntryDeviceKey push, ended with a non-enrolled key in every location.
// The grouped path is UNPROVEN on this setup and must not be used again until
// someone demonstrates write → FULL APP RELAUNCH → read, from both processes. An
// in-process read-back does not prove an item survives a restart, and that is the
// exact assumption that caused the loss.
//
// One store, one location, no fallback, nothing that moves or deletes. Anything
// clever here has to earn its place on device first.
export const secureStoreSecretStore: SecretStore = legacySecretStore;

// Leftovers from the failed migration live in the grouped location and are now
// unreachable through the production store. They are stale by construction —
// nothing writes them — so they are a trap for the next reader, not a backup.
// purgeGroupedLeftovers removes them. Deliberately NOT automatic: silent deletion
// of secrets is what started this, so it is an explicit, user-triggered action.
export async function purgeGroupedLeftovers(keys: readonly string[]): Promise<string[]> {
  const done: string[] = [];
  for (const key of keys) {
    try {
      const present = (await sharedSecretStore.getItem(key)) !== null;
      if (!present) {
        done.push(`${key}: nothing in the grouped location`);
        continue;
      }
      await sharedSecretStore.removeItem(key);
      done.push(`${key}: grouped copy removed`);
    } catch (err) {
      done.push(`${key}: purge failed — ${err instanceof Error ? err.message : String(err)}`);
    }
  }
  return done;
}
