import { test } from 'node:test';
import assert from 'node:assert/strict';

import {
  loadPiConfig,
  savePiConfig,
  clearPiConfig,
  loadCarConfig,
  saveCarConfig,
  clearCarConfig,
  parseEnrolUrl,
  isValidVin,
} from './config';
import { createMemorySecretStore } from './__testutils__/memorySecretStore';

test('loadPiConfig returns null when nothing has been saved', async () => {
  const store = createMemorySecretStore();
  assert.equal(await loadPiConfig(store), null);
});

test('savePiConfig / loadPiConfig round-trip the credentials', async () => {
  // Credentials ONLY — the VIN moved to CarConfig, see the split below.
  const store = createMemorySecretStore();
  const cfg = { baseUrl: 'https://pi.example', token: 'tok' };
  await savePiConfig(store, cfg);
  assert.deepEqual(await loadPiConfig(store), cfg);
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

// ── The split: car identity vs forwarder credentials ─────────────────────────
// 2026-07-27. The VIN used to live inside PiConfig. useCarLink gates `linked` on
// the VIN alone and direct BLE needs only the VIN + device key, so losing the Pi
// credentials took the car with them: a working BLE setup silently became a demo
// vehicle, every command a no-op with no error anywhere.

test('the two configs are independent: forgetting the Pi keeps the car', async () => {
  const store = createMemorySecretStore();
  await saveCarConfig(store, { vin: VALID_VIN });
  await savePiConfig(store, { baseUrl: 'https://pi', token: 't' });

  await clearPiConfig(store);

  assert.equal(await loadPiConfig(store), null, 'forwarder gone');
  assert.deepEqual(await loadCarConfig(store), { vin: VALID_VIN }, 'car survives — direct BLE keeps working');
});

test('clearCarConfig is the explicit way to forget the vehicle', async () => {
  const store = createMemorySecretStore();
  await saveCarConfig(store, { vin: VALID_VIN });

  await clearCarConfig(store);

  assert.equal(await loadCarConfig(store), null);
});

test('a car can be configured with no forwarder at all (BLE-only)', async () => {
  const store = createMemorySecretStore();
  await saveCarConfig(store, { vin: VALID_VIN });

  assert.equal((await loadCarConfig(store))?.vin, VALID_VIN);
  assert.equal(await loadPiConfig(store), null, 'no Pi arm, and that is fine');
});

test('loadCarConfig reads a pre-split PiConfig that still carries the VIN', async () => {
  // Upgrade path: an install from before the split must not need a re-enrol.
  const store = createMemorySecretStore();
  await store.setItem(
    'ble.piConfig.v1',
    JSON.stringify({ baseUrl: 'https://pi', token: 't', vin: VALID_VIN, nickname: 'Keros' }),
  );

  assert.deepEqual(await loadCarConfig(store), { vin: VALID_VIN, nickname: 'Keros', vehicleId: undefined });
});

test('loadPiConfig rejects a legacy VIN-only blob as credentials', async () => {
  const store = createMemorySecretStore();
  await store.setItem('ble.piConfig.v1', JSON.stringify({ vin: VALID_VIN }));

  assert.equal(await loadPiConfig(store), null, 'a VIN is not a baseUrl+token');
  assert.equal((await loadCarConfig(store))?.vin, VALID_VIN, 'but it IS a car');
});

test('loadCarConfig returns null on a genuinely fresh install', async () => {
  assert.equal(await loadCarConfig(createMemorySecretStore()), null);
});
