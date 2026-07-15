import { test } from 'node:test';
import assert from 'node:assert/strict';

import { vehicleLocalName } from './bleScanName';

// Independently computed fixture (sha1(utf8(vin))[0:8], lower-hex, "S"..."C"
// wrap) — see docs/superpowers/plans/tesla-ble-transport-spec.md §2.
test('vehicleLocalName matches the known VIN fixture', () => {
  assert.equal(vehicleLocalName('5YJ3E1EA7HF000316'), 'Sdfc829709f7bc4f0C');
});

test('vehicleLocalName is 18 chars, starts with S, ends with C', () => {
  const name = vehicleLocalName('5YJ3E1EA7HF000316');
  assert.equal(name.length, 18);
  assert.equal(name[0], 'S');
  assert.equal(name[name.length - 1], 'C');
});

test('vehicleLocalName is deterministic for the same VIN', () => {
  const a = vehicleLocalName('7SAYGDEE9PF000001');
  const b = vehicleLocalName('7SAYGDEE9PF000001');
  assert.equal(a, b);
});

test('vehicleLocalName differs across VINs', () => {
  const a = vehicleLocalName('5YJ3E1EA7HF000316');
  const b = vehicleLocalName('7SAYGDEE9PF000001');
  assert.notEqual(a, b);
});
