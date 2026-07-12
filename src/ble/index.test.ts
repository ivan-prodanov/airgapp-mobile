import { test } from 'node:test';
import assert from 'node:assert/strict';

import * as ble from './index';

test('isCarLinkEnabled reflects EXPO_PUBLIC_CAR_LINK=1', () => {
  const prev = process.env.EXPO_PUBLIC_CAR_LINK;
  try {
    process.env.EXPO_PUBLIC_CAR_LINK = '1';
    assert.equal(ble.isCarLinkEnabled(), true);
  } finally {
    if (prev === undefined) delete process.env.EXPO_PUBLIC_CAR_LINK;
    else process.env.EXPO_PUBLIC_CAR_LINK = prev;
  }
});

test('isCarLinkEnabled is false when unset', () => {
  const prev = process.env.EXPO_PUBLIC_CAR_LINK;
  try {
    delete process.env.EXPO_PUBLIC_CAR_LINK;
    assert.equal(ble.isCarLinkEnabled(), false);
  } finally {
    if (prev === undefined) delete process.env.EXPO_PUBLIC_CAR_LINK;
    else process.env.EXPO_PUBLIC_CAR_LINK = prev;
  }
});

test('isCarLinkEnabled is false for any other value', () => {
  const prev = process.env.EXPO_PUBLIC_CAR_LINK;
  try {
    process.env.EXPO_PUBLIC_CAR_LINK = 'true';
    assert.equal(ble.isCarLinkEnabled(), false);
  } finally {
    if (prev === undefined) delete process.env.EXPO_PUBLIC_CAR_LINK;
    else process.env.EXPO_PUBLIC_CAR_LINK = prev;
  }
});

test('the public façade exports the gateway + keystore + config surface as functions/classes', () => {
  assert.equal(typeof ble.createCarGateway, 'function');
  assert.equal(typeof ble.PiClient, 'function'); // class
  assert.equal(typeof ble.loadOrCreateDeviceKeys, 'function');
  assert.equal(typeof ble.deleteDeviceKeys, 'function');
  assert.equal(typeof ble.publicKeyBase64, 'function');
  assert.equal(typeof ble.deviceKeyFingerprint, 'function');
  assert.equal(typeof ble.loadPiConfig, 'function');
  assert.equal(typeof ble.savePiConfig, 'function');
  assert.equal(typeof ble.clearPiConfig, 'function');
  assert.equal(typeof ble.parseEnrolUrl, 'function');
  assert.equal(typeof ble.isValidVin, 'function');
  assert.equal(typeof ble.buildCommand, 'function');
  assert.equal(typeof ble.isCarLinkEnabled, 'function');
});

test('the façade does not leak internal session engine guts', () => {
  assert.equal((ble as Record<string, unknown>).withCachedSession, undefined);
  assert.equal((ble as Record<string, unknown>).deriveSessionKey, undefined);
  assert.equal((ble as Record<string, unknown>).aesGcmEncrypt, undefined);
});
