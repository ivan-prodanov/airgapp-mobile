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
// RN-only and can't load under node/tsx). Only src/app/carlink.tsx imports
// this. Deliberately NOT re-exported from src/ble/index.ts — see that
// file's header comment on what the façade exposes.

import * as SecureStore from 'expo-secure-store';
import type { SecretStore } from './types';

export const secureStoreSecretStore: SecretStore = {
  getItem: (k) => SecureStore.getItemAsync(k),
  setItem: (k, v) => SecureStore.setItemAsync(k, v),
  removeItem: (k) => SecureStore.deleteItemAsync(k),
};
