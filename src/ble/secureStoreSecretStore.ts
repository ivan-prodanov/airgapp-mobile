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
import { makeMigratingSecretStore } from './keychainMigration';
import type { SecretStore } from './types';

// Must match `keychain-access-groups` in BOTH ios/airgapp/airgapp.entitlements
// and ios/ShareExtension/ShareExtension.entitlements. `$(AppIdentifierPrefix)` in
// the entitlement expands to the team prefix at build time; the runtime API wants
// the bare group name without it.
export const SHARED_KEYCHAIN_ACCESS_GROUP = 'local.airgapp.mobile.shared';

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

// PRODUCTION — what every caller gets. Self-healing: a read that finds the grouped
// location empty falls back to the legacy one and promotes the value.
//
// This is not belt-and-braces on top of the eager migration; it is the thing that
// makes the migration SAFE. `loadOrCreateDeviceKeys` CREATES a key when it reads
// null, and useCarLink calls it on mount — so a read that beat the eager migration
// would mint a new device key and silently re-enrol the phone against a car that
// no longer recognises it. Ordering effects against every reader is not a
// guarantee. Removing the race is.
export const secureStoreSecretStore: SecretStore = makeMigratingSecretStore(
  sharedSecretStore,
  legacySecretStore,
);
