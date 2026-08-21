import { test } from 'node:test';
import assert from 'node:assert/strict';

import { requiredBlePermissions, ANDROID_S } from './blePermissions';

test('android 31+ needs the split runtime permissions, not the legacy pair', () => {
  assert.deepEqual(requiredBlePermissions('android', 36), [
    'android.permission.BLUETOOTH_SCAN',
    'android.permission.BLUETOOTH_CONNECT',
  ]);
});

test('the split lands exactly at API 31, not 30 or 32', () => {
  assert.equal(ANDROID_S, 31);
  assert.ok(requiredBlePermissions('android', 31).includes('android.permission.BLUETOOTH_SCAN'));
  assert.ok(!requiredBlePermissions('android', 30).includes('android.permission.BLUETOOTH_SCAN'));
});

test('android below 31 needs fine location instead', () => {
  assert.deepEqual(requiredBlePermissions('android', 30), [
    'android.permission.ACCESS_FINE_LOCATION',
  ]);
});

test('iOS needs no explicit runtime BLE permission list', () => {
  assert.deepEqual(requiredBlePermissions('ios', 0), []);
});
