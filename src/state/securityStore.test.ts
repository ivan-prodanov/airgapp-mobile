import { test } from 'node:test';
import assert from 'node:assert/strict';

import {
  loadSecurity,
  saveSecurity,
  securityChanged,
  securityKey,
  securityToStatePatch,
  type SecurityPersist,
} from './securityStore';
import type { SecretStore } from '@/ble/types';

// An in-memory SecretStore so the round trip is node-testable (no expo-secure-store).
function fakeStore(): SecretStore & { map: Map<string, string> } {
  const map = new Map<string, string>();
  return {
    map,
    getItem: async (k) => (map.has(k) ? (map.get(k) as string) : null),
    setItem: async (k, v) => {
      map.set(k, v);
    },
    removeItem: async (k) => {
      map.delete(k);
    },
  };
}

const SAMPLE: SecurityPersist = {
  pinToDrive: true,
  valetPin: '1234',
  parentalPin: null,
  speedLimitPin: '9999',
  pinToDrivePin: '0000',
};

test('save then load round-trips the security state', async () => {
  const store = fakeStore();
  await saveSecurity(store, 'VIN1', SAMPLE);
  assert.deepEqual(await loadSecurity(store, 'VIN1'), SAMPLE);
});

test('keyed by VIN — a different car does not inherit PINs', async () => {
  const store = fakeStore();
  await saveSecurity(store, 'VIN1', SAMPLE);
  assert.equal(await loadSecurity(store, 'VIN2'), null);
  assert.equal(securityKey('VIN1'), 'ble.security.VIN1');
});

test('load returns null when nothing saved', async () => {
  assert.equal(await loadSecurity(fakeStore(), 'VIN1'), null);
});

test('corrupt payload loads as null, never throws', async () => {
  const store = fakeStore();
  store.map.set(securityKey('VIN1'), '{not json');
  assert.equal(await loadSecurity(store, 'VIN1'), null);
});

test('load normalises missing / blank / wrong-typed fields', async () => {
  const store = fakeStore();
  // pinToDrive absent, valetPin blank, speedLimitPin a number → all coerce to default.
  store.map.set(securityKey('VIN1'), JSON.stringify({ valetPin: '', speedLimitPin: 1234, parentalPin: 'abcd' }));
  assert.deepEqual(await loadSecurity(store, 'VIN1'), {
    pinToDrive: false,
    valetPin: null,
    parentalPin: 'abcd',
    speedLimitPin: null,
    pinToDrivePin: null,
  });
});

test('securityToStatePatch mirrors the loaded values', () => {
  assert.deepEqual(securityToStatePatch(SAMPLE), {
    pinToDrive: true,
    valetPin: '1234',
    parentalPin: null,
    speedLimitPin: '9999',
    pinToDrivePin: '0000',
  });
});

test('securityChanged detects any field difference and no false positives', () => {
  assert.equal(securityChanged(SAMPLE, { ...SAMPLE }), false);
  assert.equal(securityChanged(SAMPLE, { ...SAMPLE, pinToDrive: false }), true);
  assert.equal(securityChanged(SAMPLE, { ...SAMPLE, parentalPin: '1111' }), true);
  assert.equal(securityChanged(SAMPLE, { ...SAMPLE, valetPin: null }), true);
});
