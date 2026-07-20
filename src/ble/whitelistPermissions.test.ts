import { test } from 'node:test';
import assert from 'node:assert/strict';

import {
  parseWhitelistInfo,
  filledSlots,
  parseWhitelistEntryPublicKey,
  dumpTopLevelFields,
  dumpEntryFields,
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

// --- Slot enumeration + raw field dumps (whitelist-probe plan Tasks 1-2) -----

test('parseWhitelistInfo reads numberOfEntries + slotMask from field 16', () => {
  // FromVCSECMessage { whitelistInfo(16) = { numberOfEntries(1)=2, slotMask(3)=6 } }
  // field 16 LEN tag = (16<<3)|2 = 130 → varint 0x82 0x01
  const frame = Uint8Array.from([0x82, 0x01, 0x04, 0x08, 0x02, 0x18, 0x06]);
  assert.deepEqual(parseWhitelistInfo(frame), { numberOfEntries: 2, slotMask: 6 });
});

test('parseWhitelistInfo returns null when no whitelistInfo is present', () => {
  assert.equal(parseWhitelistInfo(Uint8Array.from([0x08, 0x00])), null);
});

test('filledSlots expands a slotMask bitfield to slot indices', () => {
  assert.deepEqual(filledSlots(6), [1, 2]);
  assert.deepEqual(filledSlots(0), []);
  assert.deepEqual(filledSlots(1), [0]);
  // slot 4 — the slot our own key reported on-car.
  assert.deepEqual(filledSlots(0b10001), [0, 4]);
});

test('parseWhitelistEntryPublicKey unwraps the PublicKey message to the raw point', () => {
  // whitelistEntryInfo(17) { publicKey(2) = PublicKey { raw(1) = 04 AA BB }, permissions(3)=[1,2] }
  const entryBody = [
    0x12, 0x05, 0x0a, 0x03, 0x04, 0xaa, 0xbb, // field 2 → inner field 1 → 3 bytes
    ...permPacked(1, 2),
  ];
  const frame = fromVcsec(entryBody);
  assert.deepEqual(Array.from(parseWhitelistEntryPublicKey(frame) ?? []), [0x04, 0xaa, 0xbb]);
  // the existing scanner still reads the bits from the same frame
  assert.deepEqual(parseWhitelistPermissions(frame), [1, 2]);
});

test('dumpTopLevelFields lists field/wireType/length of each top-level field', () => {
  const frame = Uint8Array.from([0x82, 0x01, 0x04, 0x08, 0x02, 0x18, 0x06]);
  assert.deepEqual(dumpTopLevelFields(frame), [{ field: 16, wireType: 2, length: 4 }]);
});

test('dumpEntryFields exposes which fields the entry actually carries', () => {
  // This is the control-group workhorse: it answers "does field 3 exist on ANY
  // key?" without needing a proto for the message.
  const frame = fromVcsec([...permUnpacked(1), ...keyRole(3)]);
  assert.deepEqual(dumpEntryFields(frame), [
    { field: 3, wireType: 0, length: 0 },
    { field: 7, wireType: 0, length: 0 },
  ]);
  assert.equal(dumpEntryFields(Uint8Array.from([0x08, 0x00])), null, 'no entry → null');
});

test('dumpEntryFields on the REAL on-car reply shows no field 3 (the finding)', () => {
  // Verbatim bytes captured from the car (slot 4, keyRole 3). Locking this in as
  // a regression test: it documents the actual observation the passive-entry
  // decision rests on, so if a future change "finds" permissions here we know
  // the parser drifted rather than the car changing.
  const onCar = Uint8Array.from([
    0x8a, 0x01, 0x55,
    0x0a, 0x06, 0x0a, 0x04, 0xc6, 0xe9, 0xaf, 0x58,
    0x12, 0x43, 0x0a, 0x41, 0x04, 0xd2, 0xa5, 0xfc, 0x6c, 0x99, 0xc2, 0xdf, 0x08,
    0xd8, 0x42, 0x69, 0x7a, 0x7d, 0x3b, 0x47, 0x89, 0x62, 0xb8, 0x1f, 0x7d, 0xf0,
    0x77, 0x05, 0x39, 0x96, 0x49, 0x08, 0x7b, 0x2f, 0xda, 0x95, 0xb4, 0x3f, 0xf3,
    0xf6, 0x12, 0x9e, 0xa6, 0x33, 0x16, 0x8a, 0xad, 0xa5, 0x91, 0x7a, 0x82, 0x1b,
    0x8f, 0x67, 0x65, 0x03, 0xa0, 0x63, 0x23, 0x74, 0x83, 0x99, 0x9a, 0xc9, 0xaa,
    0x08, 0x29, 0x26, 0xb3,
    0x22, 0x02, 0x08, 0x06,
    0x30, 0x04,
    0x38, 0x03,
  ]);
  const fields = dumpEntryFields(onCar);
  assert.ok(fields, 'the car DID return an entry (field 17)');
  assert.deepEqual(
    fields.map((f) => f.field),
    [1, 2, 4, 6, 7],
    'keyId, publicKey, metadataForKey, slot, keyRole — and NO field 3 (permissions)',
  );
  assert.equal(parseWhitelistPermissions(onCar), null, 'permissions genuinely absent, not mis-parsed');
  assert.equal(
    Array.from(parseWhitelistEntryPublicKey(onCar) ?? []).length,
    65,
    'entry carries a full 65-byte SEC1 point we can match our key against',
  );
});
