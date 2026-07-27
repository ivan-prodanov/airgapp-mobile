// secureStoreSecretStore.ts — the iOS Keychain-backed SecretStore.
//
// ONE store, ONE location. Every secret this app holds — the device private
// scalar, the car's identity, the Pi bearer token — lives in a single Keychain
// access group that both the app and the Share Extension declare, so there is
// exactly one answer to "what is the device key on this phone".
//
// That wording is deliberate. On 2026-07-27 an attempt to migrate these secrets
// into the group left copies in two locations, some stale, some different, and
// the resulting ambiguity cost an enrolment and most of a day. There is no
// fallback store here and no second location by design: if a secret is not in
// the group, it does not exist.
//
// Values go through the OS Keychain (expo-secure-store), never AsyncStorage —
// AsyncStorage is plaintext on disk and the private scalar and bearer token must
// never land there.
//
// Isolated in its own file so no node-tested module ever transitively imports
// expo-secure-store (RN-only, cannot load under node/tsx). Deliberately NOT
// re-exported from src/ble/index.ts — see that file's header on what the façade
// exposes.

import * as SecureStore from 'expo-secure-store';
import type { SecretStore } from './types';

// Everything the Share Extension needs in order to send a destination by itself:
//
//   ble.deviceKey.v1  — proves who we are to the car
//   ble.carConfig.v1  — WHICH car (the VIN). Without it there is no BLE scan
//                       name to derive and no Pi session to open.
//   ble.piConfig.v1   — the bearer token for the network arm
//
// Anything added here must also be added to the extension's read path.
export const SHARED_SECRET_KEYS = ['ble.deviceKey.v1', 'ble.carConfig.v1', 'ble.piConfig.v1'] as const;

// Must match `keychain-access-groups` in BOTH ios/airgapp/airgapp.entitlements
// and ios/ShareExtension/ShareExtension.entitlements, AFTER `$(AppIdentifierPrefix)`
// expands — i.e. FULLY QUALIFIED, with the team prefix.
//
// expo-secure-store passes this straight through to kSecAttrAccessGroup
// (SecureStoreModule.swift:188, no prefixing), and that attribute requires the
// fully-qualified group. Passing the bare name names a group the binary has no
// entitlement for, and every Keychain call then fails with errSecMissingEntitlement
// (-34018) — surfaced as "A required entitlement is missing". Measured on-device
// 2026-07-27, after this comment had asserted the opposite without checking.
//
// The team prefix is fixed for this project (AGENTS.md: DEVELOPMENT_TEAM=859B8N529C,
// which warns against overriding it). Verify against the signed binary with:
//   codesign -d --entitlements - --xml <app> | plutil -p -
export const SHARED_KEYCHAIN_ACCESS_GROUP = '859B8N529C.local.airgapp.mobile.shared';

// AfterFirstUnlock rather than the WhenUnlocked default. A share sheet runs with
// the phone unlocked so WhenUnlocked would do — but the native passive-entry
// responder reads the same device key while the app is suspended and the phone
// may be locked, and a background read of a WhenUnlocked item fails silently.
// Matches the accessibility the native side already chose for its own copy
// (KeychainKey.swift: kSecAttrAccessibleAfterFirstUnlockThisDeviceOnly).
const OPTS: SecureStore.SecureStoreOptions = {
  accessGroup: SHARED_KEYCHAIN_ACCESS_GROUP,
  keychainAccessible: SecureStore.AFTER_FIRST_UNLOCK_THIS_DEVICE_ONLY,
};

// Writes are VERIFIED. A write that does not read back throws instead of
// returning quietly, because the alternative is loadOrCreateDeviceKeys finding an
// empty store on the next launch and minting a fresh key — silently re-enrolling
// the phone against a car that will reject it. That exact silence cost an
// enrolment; it must be loud.
//
// What this does NOT claim: an immediate read-back proves the write landed, not
// that it survives a process restart. Only enrolling, force-quitting and
// reopening proves that.
export const secureStoreSecretStore: SecretStore = {
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

// wipeStoredSecrets erases every secret this app holds. Destructive: afterwards
// the device is unenrolled and needs the NFC card again.
export async function wipeStoredSecrets(keys: readonly string[] = SHARED_SECRET_KEYS): Promise<string[]> {
  const done: string[] = [];
  for (const key of keys) {
    try {
      if ((await secureStoreSecretStore.getItem(key)) === null) {
        done.push(`${key}: nothing to remove`);
        continue;
      }
      await secureStoreSecretStore.removeItem(key);
      done.push(`${key}: ERASED`);
    } catch (err) {
      done.push(`${key}: FAILED — ${err instanceof Error ? err.message : String(err)}`);
    }
  }
  return done;
}
