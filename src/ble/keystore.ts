// keystore.ts — device P-256 keypair generation + persistence.
//
// Ported from the browser reference at
// /Users/ivan/Work/airgapp/rpi-webclient/client/keystore.js, which used
// WebCrypto with `extractable: false` — the private half never left
// crypto.subtle's opaque CryptoKey, backed by the OS keystore via IndexedDB.
// We use @noble/curves (pure JS, no native module — keeps the JS-only
// deploy-js.sh redeploy loop working), which has no opaque-key concept: the
// private scalar is ordinary, extractable JS material (a Uint8Array). That
// means SECURE STORAGE IS THIS MODULE'S CALLER'S RESPONSIBILITY, not
// something noble gives us for free.
//
// ── Storage seam (read before wiring this up in the app) ──
// `loadOrCreateDeviceKeys`/`deleteDeviceKeys` take an injected `SecretStore`
// (src/ble/types.ts) rather than reaching for a concrete storage API. Tests
// inject an in-memory store (see __testutils__/memorySecretStore.ts).
//
// TODO(Phase 2 — hardware task, needs a rebuild): production must inject a
// SecretStore backed by `expo-secure-store` (iOS Keychain), e.g.:
//
//   import * as SecureStore from 'expo-secure-store';
//   const secureStore: SecretStore = {
//     getItem: SecureStore.getItemAsync,
//     setItem: (k, v) => SecureStore.setItemAsync(k, v),
//     removeItem: SecureStore.deleteItemAsync,
//   };
//
// Do NOT default this module to AsyncStorage — AsyncStorage is plaintext
// on-disk storage and the private scalar (and, in config.ts, the Pi bearer
// token) must never land there. `expo-secure-store` isn't installed yet;
// adding it is a native-module change requiring a full xcodebuild, tracked
// as a separate Phase-2 hardware task (see AGENTS.md's native-module note).

import { p256 } from '@noble/curves/p256';
import { sha256 } from '@noble/hashes/sha256';

import { bytesToHex, hexToBytes } from './crypto';
import { bytesToBase64 } from './bytes';
import type { DeviceKeys, SecretStore } from './types';

// Storage key for the persisted private scalar (hex-encoded). Versioned
// (`.v1`) so a future key-format change can migrate cleanly instead of
// silently misreading old data.
const DEVICE_KEY_STORAGE_KEY = 'ble.deviceKey.v1';

// generateDeviceKeys creates a fresh P-256 keypair. privateScalar is the
// 32-byte big-endian scalar; publicKeyRaw is the 65-byte SEC1 uncompressed
// point (0x04 || X || Y) — pass isCompressed=false, matching the shape the
// rest of the BLE engine (crypto.ts, session.ts) expects everywhere else.
//
// `p256.utils.randomPrivateKey()` is present and correct on the pinned
// @noble/curves 1.9.7 (verified against the installed package — it returns
// a 32-byte Uint8Array drawn from a valid scalar range), so no
// randomBytes+validate fallback is needed here.
function generateDeviceKeys(): DeviceKeys {
  const privateScalar = p256.utils.randomPrivateKey();
  const publicKeyRaw = p256.getPublicKey(privateScalar, false);
  if (publicKeyRaw.length !== 65 || publicKeyRaw[0] !== 0x04) {
    // Defensive — would indicate a noble API change, not a runtime input
    // error, so throwing (not returning) is correct here.
    throw new Error(`generateDeviceKeys: unexpected public key shape (${publicKeyRaw.length} bytes)`);
  }
  return { privateScalar, publicKeyRaw };
}

// loadOrCreateDeviceKeys returns the persisted device keypair, generating
// and persisting a new one on first use. Only the private scalar is ever
// written to storage (as hex) — the public key is deterministic from the
// scalar, so it is RE-DERIVED on every load rather than cached, the same
// pattern the browser reference's session-metadata rehydration used for
// derived material.
export async function loadOrCreateDeviceKeys(store: SecretStore): Promise<DeviceKeys> {
  const existing = await loadDeviceKeys(store);
  if (existing) return existing;
  const keys = generateDeviceKeys();
  await store.setItem(DEVICE_KEY_STORAGE_KEY, bytesToHex(keys.privateScalar));
  return keys;
}

// loadDeviceKeys reads the persisted keypair and returns null when there is
// none. It NEVER creates one.
//
// Use this anywhere the question is "is this device enrolled?" rather than "give
// me keys to work with". loadOrCreateDeviceKeys mints on an empty store, so
// calling it to inspect state changes the state: a read-only diagnostic built on
// it reported a key immediately after a full wipe — because it had just made one
// (2026-07-27).
export async function loadDeviceKeys(store: SecretStore): Promise<DeviceKeys | null> {
  const existingHex = await store.getItem(DEVICE_KEY_STORAGE_KEY);
  if (!existingHex) return null;
  const privateScalar = hexToBytes(existingHex);
  const publicKeyRaw = p256.getPublicKey(privateScalar, false);
  return { privateScalar, publicKeyRaw };
}

// deleteDeviceKeys wipes the persisted keypair. Callers doing key rotation
// or "forget this Pi" should call this, then loadOrCreateDeviceKeys to mint
// a replacement — matching the reference's deleteDeviceKey behavior.
export async function deleteDeviceKeys(store: SecretStore): Promise<void> {
  await store.removeItem(DEVICE_KEY_STORAGE_KEY);
}

// publicKeyBase64 is the wire form for POST /pair/external-pubkey
// {public_key_b64} — the Pi forwards this raw SEC1 point straight to the
// car's SendAddKeyRequest.
export function publicKeyBase64(keys: DeviceKeys): string {
  return bytesToBase64(keys.publicKeyRaw);
}

// deviceKeyFingerprint is a short, stable, human-comparable identifier for
// a public key — SHA-256 of the raw bytes, truncated to 8 bytes, rendered
// colon-hex (matches the reference's fingerprintHex). Used in UI so an
// operator can eyeball "is this the key currently enrolled on the car."
export function deviceKeyFingerprint(keys: DeviceKeys): string {
  const digest = sha256(keys.publicKeyRaw).slice(0, 8);
  return Array.from(digest)
    .map((b) => b.toString(16).padStart(2, '0'))
    .join(':');
}
