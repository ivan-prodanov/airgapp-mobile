import { test } from 'node:test';
import assert from 'node:assert/strict';

import {
  parseWhitelistPermissions,
  hasLocalUnlock,
  describeWhitelistPermissions,
  permissionName,
  PERMISSION_LOCAL_UNLOCK,
} from './whitelistPermissions';

// Hand-built wire frames. FromVCSECMessage.whitelistEntryInfo = field 17 (LEN),
// tag = (17<<3)|2 = 138 → varint 0x8A 0x01.
const ENTRY_TAG = [0x8a, 0x01];

function fromVcsec(entryBody: number[]): Uint8Array {
  return Uint8Array.from([...ENTRY_TAG, entryBody.length, ...entryBody]);
}

// WhitelistEntryInfo fields: permissions = 3, keyRole = 7.
const permUnpacked = (...vals: number[]) => vals.flatMap((v) => [0x18, v]); // (3<<3)|0 = 0x18
const permPacked = (...vals: number[]) => [0x1a, vals.length, ...vals]; // (3<<3)|2 = 0x1a
const keyRole = (v: number) => [0x38, v]; // (7<<3)|0 = 0x38

test('reads UNPACKED repeated permissions (field 3, wire type 0)', () => {
  const buf = fromVcsec([...permUnpacked(1, 2), ...keyRole(3)]);
  assert.deepEqual(parseWhitelistPermissions(buf), [1, 2]);
});

test('reads PACKED repeated permissions (field 3, wire type 2)', () => {
  // proto3 emits packed by default; we do not control the car's encoder, so
  // both encodings must work.
  const buf = fromVcsec([...permPacked(1, 2), ...keyRole(3)]);
  assert.deepEqual(parseWhitelistPermissions(buf), [1, 2]);
});

test('skips unrelated fields before/after permissions without desyncing', () => {
  // keyRole first, then permissions — the scanner must step over a varint field
  // it does not care about.
  const buf = fromVcsec([...keyRole(3), ...permUnpacked(1, 2, 3)]);
  assert.deepEqual(parseWhitelistPermissions(buf), [1, 2, 3]);
});

test('skips a length-delimited sibling field (publicKey-shaped) correctly', () => {
  // field 2 (publicKey) LEN with 4 bytes of payload, then permissions.
  const publicKeyish = [0x12, 0x04, 0xde, 0xad, 0xbe, 0xef];
  const buf = fromVcsec([...publicKeyish, ...permUnpacked(1)]);
  assert.deepEqual(parseWhitelistPermissions(buf), [1]);
});

test('returns null when there is no whitelistEntryInfo at all', () => {
  // A vehicleStatus (field 1) message — the common poll response.
  const buf = Uint8Array.from([0x0a, 0x02, 0x08, 0x01]);
  assert.equal(parseWhitelistPermissions(buf), null, 'absent ≠ empty');
});

test('returns null when the entry exists but carries NO permissions field', () => {
  // This is the case that matters most: "unknown" must NOT be reported as "[]",
  // because an empty list is itself a meaningful (and alarming) answer.
  const buf = fromVcsec([...keyRole(3)]);
  assert.equal(parseWhitelistPermissions(buf), null);
});

test('distinguishes present-but-empty from absent', () => {
  // Packed with zero elements = the field IS present, with no bits.
  const buf = fromVcsec([...permPacked(), ...keyRole(3)]);
  assert.deepEqual(parseWhitelistPermissions(buf), [], 'present-but-empty is its own answer');
});

test('malformed/truncated input degrades to a value, never throws', () => {
  // Truncated length-delimited entry — parsing bytes off a car must not crash.
  const truncated = Uint8Array.from([...ENTRY_TAG, 0x10, 0x18]);
  assert.doesNotThrow(() => parseWhitelistPermissions(truncated));
  assert.equal(parseWhitelistPermissions(truncated), null);
});

test('hasLocalUnlock: unknown (null) is NOT reported as false', () => {
  assert.equal(hasLocalUnlock(null), null, 'null in → null out; unknown ≠ denied');
  assert.equal(hasLocalUnlock([PERMISSION_LOCAL_UNLOCK, 2]), true);
  assert.equal(hasLocalUnlock([2, 3]), false);
  assert.equal(hasLocalUnlock([]), false);
});

test('describe renders the verdict a human reads on the device', () => {
  assert.match(describeWhitelistPermissions([1, 2]), /LOCAL_UNLOCK\(1\).*ELIGIBLE/);
  assert.match(describeWhitelistPermissions([2]), /ABSENT.*NOT be authorized/);
  assert.match(describeWhitelistPermissions(null), /UNKNOWN/);
  assert.match(describeWhitelistPermissions([]), /empty/);
});

test('permissionName covers the documented enum + degrades on surprises', () => {
  assert.equal(permissionName(1), 'LOCAL_UNLOCK');
  assert.equal(permissionName(2), 'LOCAL_DRIVE');
  assert.equal(permissionName(0), 'ADD_TO_WHITELIST');
  assert.equal(permissionName(99), 'unknown(99)');
});

// Cross-check: the frames above are hand-built, so the scanner could be
// "passing" against bytes the car would never send. Decode the SAME frame with
// the real vendored proto and assert it round-trips as a genuine
// FromVCSECMessage.whitelistEntryInfo — that anchors the hand-built wire format
// to reality, and simultaneously documents WHY this module exists (the real
// decoder drops `permissions`, which is precisely what we recover).
test('hand-built frames are genuine proto (and the real decoder drops permissions)', async () => {
  const { FromVCSECMessage } = await import('./proto');
  const buf = fromVcsec([...permUnpacked(1, 2), ...keyRole(3)]);

  const decoded = FromVCSECMessage.decode(buf) as unknown as {
    subMessage?: string;
    whitelistEntryInfo?: { keyRole?: number; permissions?: unknown };
  };

  assert.equal(decoded.subMessage, 'whitelistEntryInfo', 'real proto accepts our frame');
  assert.equal(decoded.whitelistEntryInfo?.keyRole, 3, 'modelled fields decode normally');
  assert.equal(
    decoded.whitelistEntryInfo?.permissions,
    undefined,
    'the vendored proto does NOT model permissions — the reason this scanner exists',
  );
  // ...and the scanner recovers exactly what the proto threw away.
  assert.deepEqual(parseWhitelistPermissions(buf), [1, 2]);
});
