import { test } from 'node:test';
import assert from 'node:assert/strict';

import { p256 } from '@noble/curves/p256';

import { loadOrCreateDeviceKeys, loadDeviceKeys, deleteDeviceKeys, publicKeyBase64, deviceKeyFingerprint } from './keystore';
import { base64ToBytes } from './bytes';
import { createMemorySecretStore } from './__testutils__/memorySecretStore';

test('loadOrCreateDeviceKeys generates a fresh keypair on an empty store', async () => {
  const store = createMemorySecretStore();
  const keys = await loadOrCreateDeviceKeys(store);
  assert.equal(keys.privateScalar.length, 32);
  assert.equal(keys.publicKeyRaw.length, 65);
  assert.equal(keys.publicKeyRaw[0], 0x04);
  // The stored key must actually persist under the documented storage key.
  const raw = await store.getItem('ble.deviceKey.v1');
  assert.ok(raw, 'private scalar was not persisted');
});

test('loadOrCreateDeviceKeys generates a VALID key: pubkey re-derives from the scalar', async () => {
  const store = createMemorySecretStore();
  const keys = await loadOrCreateDeviceKeys(store);
  const rederived = p256.getPublicKey(keys.privateScalar, false);
  assert.deepEqual(keys.publicKeyRaw, rederived);
});

test('a second call returns the SAME keys (re-derived from the persisted scalar)', async () => {
  const store = createMemorySecretStore();
  const first = await loadOrCreateDeviceKeys(store);
  const second = await loadOrCreateDeviceKeys(store);
  assert.deepEqual(second.privateScalar, first.privateScalar);
  assert.deepEqual(second.publicKeyRaw, first.publicKeyRaw);
});

test('only the private scalar is persisted — pubkey is re-derived, not stored separately', async () => {
  const store = createMemorySecretStore();
  await loadOrCreateDeviceKeys(store);
  const raw = await store.getItem('ble.deviceKey.v1');
  assert.ok(raw);
  // The persisted value is the 32-byte scalar as hex (64 hex chars) — not a
  // JSON blob carrying both halves.
  assert.equal(raw!.length, 64);
  assert.match(raw!, /^[0-9a-f]{64}$/);
});

test('publicKeyBase64 round-trips via base64ToBytes back to publicKeyRaw', async () => {
  const store = createMemorySecretStore();
  const keys = await loadOrCreateDeviceKeys(store);
  const b64 = publicKeyBase64(keys);
  assert.deepEqual(base64ToBytes(b64), keys.publicKeyRaw);
});

test('deviceKeyFingerprint is stable and colon-hex formatted', async () => {
  const store = createMemorySecretStore();
  const keys = await loadOrCreateDeviceKeys(store);
  const fp1 = deviceKeyFingerprint(keys);
  const fp2 = deviceKeyFingerprint(keys);
  assert.equal(fp1, fp2);
  // 8 bytes of sha256(pubRaw), colon-separated hex: "ab:cd:ef:..." x8.
  assert.match(fp1, /^([0-9a-f]{2}:){7}[0-9a-f]{2}$/);
});

test('deviceKeyFingerprint differs for different keys', async () => {
  const storeA = createMemorySecretStore();
  const storeB = createMemorySecretStore();
  const a = await loadOrCreateDeviceKeys(storeA);
  const b = await loadOrCreateDeviceKeys(storeB);
  assert.notEqual(deviceKeyFingerprint(a), deviceKeyFingerprint(b));
});

test('deleteDeviceKeys then load generates a NEW, different key', async () => {
  const store = createMemorySecretStore();
  const first = await loadOrCreateDeviceKeys(store);
  await deleteDeviceKeys(store);
  const raw = await store.getItem('ble.deviceKey.v1');
  assert.equal(raw, null);
  const second = await loadOrCreateDeviceKeys(store);
  assert.notDeepEqual(second.privateScalar, first.privateScalar);
  assert.notDeepEqual(second.publicKeyRaw, first.publicKeyRaw);
});

test('loadDeviceKeys returns null on an empty store and NEVER creates a key', async () => {
  // The diagnostic bug this exists to prevent: a "read-only" probe built on
  // loadOrCreateDeviceKeys reported a key immediately after a full wipe, because
  // calling it had minted one. Inspecting state must not change it.
  const store = createMemorySecretStore();

  assert.equal(await loadDeviceKeys(store), null);
  assert.equal(await loadDeviceKeys(store), null, 'still empty — nothing was written');
  assert.equal(await store.getItem('ble.deviceKey.v1'), null, 'no key material persisted');
});

test('loadDeviceKeys returns the SAME key loadOrCreateDeviceKeys persisted', async () => {
  const store = createMemorySecretStore();
  const created = await loadOrCreateDeviceKeys(store);

  const read = await loadDeviceKeys(store);

  assert.deepEqual(read?.privateScalar, created.privateScalar);
  assert.deepEqual(read?.publicKeyRaw, created.publicKeyRaw);
});
