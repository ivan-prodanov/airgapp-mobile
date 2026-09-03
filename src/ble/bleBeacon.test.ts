import test from 'node:test';
import assert from 'node:assert/strict';

import {
  APPLE_COMPANY_ID,
  TESLA_BEACON_UUID,
  beaconIsVehicle,
  expectedBeaconMinor,
  parseIBeacon,
} from './bleBeacon';

// The exact primary-PDU manufacturer data captured from the real car on 2026-09-03
// (VIN XP7YGCELXTB844019), WITHOUT the leading 2-byte company id — i.e. what Android's
// getManufacturerSpecificData(0x004C) hands the callback:
//   0215 74278bdab64445208f0c720eaf059935 0000 f3ab c5
const CAPTURED = (() => {
  const hex = '021574278bdab64445208f0c720eaf0599350000f3abc5';
  const out = new Uint8Array(hex.length / 2);
  for (let i = 0; i < out.length; i++) out[i] = parseInt(hex.slice(i * 2, i * 2 + 2), 16);
  return out;
})();

const VIN = 'XP7YGCELXTB844019';

test('Apple company id is 0x004C', () => {
  assert.equal(APPLE_COMPANY_ID, 0x004c);
});

test('minor derivation matches the live advertisement (VIN …844019 → 62379 = 0xF3AB)', () => {
  assert.equal(expectedBeaconMinor(VIN), 62379);
  assert.equal(expectedBeaconMinor(VIN), 0xf3ab);
});

test('minor derivation reads leading digits of the last 5 chars, byte-swapped', () => {
  // last5 all digits
  assert.equal(expectedBeaconMinor('XXXXXXXXXXXX12345'), ((12345 & 0xff) << 8) | (12345 >> 8));
  // last5 with a letter: NSString.integerValue stops at the first non-digit → 4
  assert.equal(expectedBeaconMinor('XXXXXXXXXXXX4A019'), (4 << 8) & 0xffff);
  // too short
  assert.equal(expectedBeaconMinor('1234'), null);
});

test('parseIBeacon decodes the captured car advertisement byte-for-byte', () => {
  const b = parseIBeacon(CAPTURED);
  assert.ok(b, 'should parse as an iBeacon');
  assert.equal(b!.uuid, TESLA_BEACON_UUID);
  assert.equal(b!.major, 0);
  assert.equal(b!.minor, 62379);
});

test('parseIBeacon rejects non-iBeacon manufacturer data (e.g. Apple nearby type 0x10)', () => {
  // Real iPhone continuity payload starts 0x10 0x07 …, not 0x02 0x15.
  const nearby = Uint8Array.from([0x10, 0x07, 0x70, 0x1f, 0xf5, 0x50, 0x3c, 0xcc]);
  assert.equal(parseIBeacon(nearby), null);
});

test('beaconIsVehicle: our UUID + VIN-derived minor identifies THIS car', () => {
  const b = parseIBeacon(CAPTURED)!;
  assert.equal(beaconIsVehicle(b, VIN), true);
  // same UUID, wrong minor (another Tesla) → not our car
  assert.equal(beaconIsVehicle({ ...b, minor: 12345 }, VIN), false);
  // right minor, foreign UUID → not our car
  assert.equal(beaconIsVehicle({ ...b, uuid: '00000000-0000-0000-0000-000000000000' }, VIN), false);
});
