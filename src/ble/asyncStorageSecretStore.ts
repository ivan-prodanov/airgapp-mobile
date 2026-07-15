// asyncStorageSecretStore.ts — AsyncStorage-backed SecretStore for HARDWARE
// BRING-UP ONLY.
//
// ⚠️ BRING-UP STORAGE ONLY — AsyncStorage is NOT encrypted at rest. The device private key + bearer
// token live here temporarily for hardware bring-up so we stay on the JS-only deploy loop. Swap for an
// expo-secure-store (iOS Keychain) adapter before any non-dev use — same SecretStore interface, drop-in.
//
// Isolated in its own file (same pattern as src/state/appStorage.ts) so no
// node-tested module ever transitively imports AsyncStorage (which can't
// load under node/tsx). Only src/app/carlink.tsx (a screen, never
// node-tested) imports this. Deliberately NOT re-exported from
// src/ble/index.ts — see that file's header comment on what the façade
// exposes; this bring-up adapter is out of scope for the reviewed/frozen
// façade.

import AsyncStorage from '@react-native-async-storage/async-storage';
import type { SecretStore } from './types';

export const asyncStorageSecretStore: SecretStore = {
  getItem: (k) => AsyncStorage.getItem(k),
  setItem: (k, v) => AsyncStorage.setItem(k, v),
  removeItem: (k) => AsyncStorage.removeItem(k),
};
