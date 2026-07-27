import { test } from 'node:test';
import assert from 'node:assert/strict';

import { loadPiConfig, savePiConfig, clearPiConfig, clearVehicleIdentity, parseEnrolUrl, isValidVin } from './config';
import { createMemorySecretStore } from './__testutils__/memorySecretStore';

test('loadPiConfig returns null when nothing has been saved', async () => {
  const store = createMemorySecretStore();
  assert.equal(await loadPiConfig(store), null);
});

test('savePiConfig / loadPiConfig round-trip the full shape', async () => {
  const store = createMemorySecretStore();
  const cfg = {
    baseUrl: 'https://host.ts.net/api/ble',
    token: 'abc123',
    vin: '5YJ3E1EA1AAAA0001',
    nickname: 'Phone',
    vehicleId: 'v1',
  };
  await savePiConfig(store, cfg);
  const loaded = await loadPiConfig(store);
  assert.deepEqual(loaded, cfg);
});

test('savePiConfig / loadPiConfig round-trip with only required fields', async () => {
  const store = createMemorySecretStore();
  const cfg = { baseUrl: 'https://host.ts.net/api/ble', token: 'tok' };
  await savePiConfig(store, cfg);
  assert.deepEqual(await loadPiConfig(store), cfg);
});

test('savePiConfig overwrites a previously saved config', async () => {
  const store = createMemorySecretStore();
  await savePiConfig(store, { baseUrl: 'https://a', token: 't1' });
  await savePiConfig(store, { baseUrl: 'https://b', token: 't2' });
  assert.deepEqual(await loadPiConfig(store), { baseUrl: 'https://b', token: 't2' });
});

test('clearPiConfig removes the saved config', async () => {
  const store = createMemorySecretStore();
  await savePiConfig(store, { baseUrl: 'https://a', token: 't1' });
  await clearPiConfig(store);
  assert.equal(await loadPiConfig(store), null);
});

test('the persisted value carries the bearer token as secret material (stored via SecretStore, not plaintext AsyncStorage)', async () => {
  const store = createMemorySecretStore();
  await savePiConfig(store, { baseUrl: 'https://a', token: 'super-secret-token' });
  const raw = await store.getItem('ble.piConfig.v1');
  assert.ok(raw && raw.includes('super-secret-token'));
});

test('parseEnrolUrl parses a real enrolment deep link', () => {
  const url = 'airgap://enrol?api=https%3A%2F%2Fhost.ts.net%2Fapi%2Fble&token=abc&nickname=Phone';
  assert.deepEqual(parseEnrolUrl(url), {
    baseUrl: 'https://host.ts.net/api/ble',
    token: 'abc',
    nickname: 'Phone',
  });
});

test('parseEnrolUrl works without the optional nickname', () => {
  const url = 'airgap://enrol?api=https%3A%2F%2Fhost.ts.net%2Fapi%2Fble&token=abc';
  const result = parseEnrolUrl(url);
  assert.ok(result);
  assert.equal(result!.baseUrl, 'https://host.ts.net/api/ble');
  assert.equal(result!.token, 'abc');
  assert.equal(result!.nickname, undefined);
});

test('parseEnrolUrl returns null for a non-enrol string', () => {
  assert.equal(parseEnrolUrl('https://example.com?api=x&token=y'), null);
  assert.equal(parseEnrolUrl('not a url at all'), null);
  assert.equal(parseEnrolUrl(''), null);
});

test('parseEnrolUrl returns null when token is missing', () => {
  assert.equal(parseEnrolUrl('airgap://enrol?api=https%3A%2F%2Fhost.ts.net%2Fapi%2Fble'), null);
});

test('parseEnrolUrl returns null when api is missing', () => {
  assert.equal(parseEnrolUrl('airgap://enrol?token=abc'), null);
});

test('parseEnrolUrl returns null for garbage query strings', () => {
  assert.equal(parseEnrolUrl('airgap://enrol?'), null);
  assert.equal(parseEnrolUrl('airgap://enrol'), null);
  assert.equal(parseEnrolUrl('airgap://enrol?===&&&'), null);
});

test('parseEnrolUrl decodes percent-encoded nickname values', () => {
  const url = 'airgap://enrol?api=https%3A%2F%2Fhost.ts.net%2Fapi%2Fble&token=abc&nickname=My%20Pi';
  const result = parseEnrolUrl(url);
  assert.equal(result!.nickname, 'My Pi');
});

test('isValidVin accepts a valid 17-char VIN', () => {
  assert.equal(isValidVin('5YJ3E1EA1AAAA0001'), true);
});

test('isValidVin rejects wrong length', () => {
  assert.equal(isValidVin('5YJ3E1EA1AAAA000'), false); // 16
  assert.equal(isValidVin('5YJ3E1EA1AAAA00011'), false); // 18
  assert.equal(isValidVin(''), false);
});

test('isValidVin rejects VINs containing I, O, or Q', () => {
  assert.equal(isValidVin('5YJ3E1EA1AAAA000I'), false);
  assert.equal(isValidVin('5YJ3E1EA1AAAA000O'), false);
  assert.equal(isValidVin('5YJ3E1EA1AAAA000Q'), false);
});

test('isValidVin accepts lowercase letters (case-insensitive)', () => {
  assert.equal(isValidVin('5yj3e1ea1aaaa0001'), true);
});

const VALID_VIN = '5YJ3E1EA7KF000316';

// ── VIN survives losing the Pi credentials ────────────────────────────────────
// 2026-07-27: the VIN lived only inside PiConfig, so losing the config took the
// car's identity with it. useCarLink gates `linked` on the VIN alone, so a
// working direct-BLE setup silently became a demo vehicle — every command a
// no-op, no error anywhere.

test('savePiConfig mirrors the VIN to its own key', async () => {
  const store = createMemorySecretStore();
  await savePiConfig(store, { baseUrl: 'https://pi', token: 't', vin: VALID_VIN });
  assert.equal(await store.getItem('ble.vin.v1'), VALID_VIN);
});

test('loadPiConfig recovers a BLE-only config when the Pi config is gone but the VIN remains', async () => {
  const store = createMemorySecretStore();
  await savePiConfig(store, { baseUrl: 'https://pi', token: 't', vin: VALID_VIN });

  // Simulate exactly what happened: the Pi config vanishes, the VIN does not.
  await store.removeItem('ble.piConfig.v1');

  const cfg = await loadPiConfig(store);
  assert.equal(cfg?.vin, VALID_VIN, 'the car must still be identifiable over BLE');
  assert.equal(cfg?.baseUrl, '', 'no Pi credentials — the Pi arm is simply unavailable');
  assert.equal(cfg?.token, '');
});

test('clearPiConfig forgets the Pi but NOT the car', async () => {
  const store = createMemorySecretStore();
  await savePiConfig(store, { baseUrl: 'https://pi', token: 't', vin: VALID_VIN });

  await clearPiConfig(store);

  assert.equal((await loadPiConfig(store))?.vin, VALID_VIN, 'direct BLE keeps working');
});

test('clearVehicleIdentity forgets the car', async () => {
  const store = createMemorySecretStore();
  await savePiConfig(store, { baseUrl: 'https://pi', token: 't', vin: VALID_VIN });

  await clearPiConfig(store);
  await clearVehicleIdentity(store);

  assert.equal(await loadPiConfig(store), null);
});

test('loadPiConfig returns null on a genuinely fresh install', async () => {
  assert.equal(await loadPiConfig(createMemorySecretStore()), null);
});
