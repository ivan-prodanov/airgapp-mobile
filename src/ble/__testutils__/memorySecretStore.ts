// __testutils__/memorySecretStore.ts — a trivial in-memory SecretStore for
// keystore.test.ts / config.test.ts / index.test.ts. Every test gets its own
// instance (call the factory per-test) so state never leaks across cases.
//
// This is NOT a stand-in for production storage — it's plaintext in a JS
// Map, alive only for the process lifetime. Production must inject an
// `expo-secure-store`/iOS-Keychain-backed SecretStore (see keystore.ts's
// header comment); that adapter is a Phase-2 hardware task, not built here.

import type { SecretStore } from '../types';

export function createMemorySecretStore(): SecretStore {
  const map = new Map<string, string>();
  return {
    async getItem(key: string): Promise<string | null> {
      return map.has(key) ? map.get(key)! : null;
    },
    async setItem(key: string, value: string): Promise<void> {
      map.set(key, value);
    },
    async removeItem(key: string): Promise<void> {
      map.delete(key);
    },
  };
}
