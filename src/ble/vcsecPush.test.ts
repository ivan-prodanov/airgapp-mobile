// vcsecPush.test.ts — decodeUnsolicitedVcsecStatus against synthetic frames.
// Pure: encodes real RoutableMessage/FromVCSECMessage protos (no hardware).

import { test } from 'node:test';
import assert from 'node:assert/strict';

import { decodeUnsolicitedVcsecStatus, decodeCpdWarning } from './vcsecPush';
import { RoutableMessage, FromVCSECMessage, encodeMessage } from './proto';

// A CPD push: FromVCSECMessage{ CPDMessage(55){ CPDNotification(1)=level } }.
// Our proto doesn't model field 55, so hand-encode it (tag 55<<3|2 = 442 = 0xba 0x03).
function cpdFrame(level: number): Uint8Array {
  const cpdMsg = Uint8Array.from([0x08, level]); // field 1 varint = level
  const payload = Uint8Array.from([0xba, 0x03, cpdMsg.length, ...cpdMsg]); // field 55 len-delimited
  return encodeMessage(RoutableMessage, {
    fromDestination: { domain: 2 },
    protobufMessageAsBytes: payload,
  });
}

test('decodeCpdWarning extracts the CPD level from field 55 → field 1', () => {
  assert.equal(decodeCpdWarning(cpdFrame(1)), 1); // INITIAL_WARNING
  assert.equal(decodeCpdWarning(cpdFrame(2)), 2); // ESCALATED_WARNING
  assert.equal(decodeCpdWarning(cpdFrame(0)), 0); // NONE
});

test('decodeCpdWarning returns 0 for a non-CPD VCSEC push and for garbage', () => {
  const status = encodeMessage(RoutableMessage, {
    fromDestination: { domain: 2 },
    protobufMessageAsBytes: encodeMessage(FromVCSECMessage, { vehicleStatus: { vehicleLockState: 1 } }),
  });
  assert.equal(decodeCpdWarning(status), 0);
  assert.equal(decodeCpdWarning(Uint8Array.from([0xff, 0xff, 0xff])), 0);
});

// Build a plaintext VCSEC push: a RoutableMessage FROM the VCSEC domain (2), no
// request_uuid, carrying an unencrypted FromVCSECMessage{vehicleStatus} payload.
function pushFrame(
  vehicleStatus: object,
  opts: { domain?: number; requestUuid?: Uint8Array; encrypted?: boolean; noPayload?: boolean } = {},
): Uint8Array {
  const inner = encodeMessage(FromVCSECMessage, { vehicleStatus });
  const fields: Record<string, unknown> = {
    fromDestination: { domain: opts.domain ?? 2 },
  };
  if (!opts.noPayload) fields.protobufMessageAsBytes = inner;
  if (opts.requestUuid) fields.requestUuid = opts.requestUuid;
  if (opts.encrypted) {
    fields.signatureData = {
      AES_GCM_ResponseData: { nonce: new Uint8Array(12), tag: new Uint8Array(16), counter: 1 },
    };
  }
  return encodeMessage(RoutableMessage, fields);
}

test('decodes a plaintext VCSEC push into the same VcsecStatus the poll produces', () => {
  const frame = pushFrame({
    vehicleLockState: 0, // UNLOCKED (index 0 of LOCK_NAMES; 2 is internal_locked)
    vehicleSleepStatus: 1, // AWAKE
    closureStatuses: { frontDriverDoor: 1 /* OPEN */, rearTrunk: 0 /* CLOSED */ },
  });
  const status = decodeUnsolicitedVcsecStatus(frame);
  assert.ok(status);
  assert.equal(status.lockState, 'unlocked');
  assert.equal(status.sleepStatus, 'awake');
  assert.equal(status.closures.frontDriverDoor, 'open');
  assert.equal(status.closures.rearTrunk, 'closed');
});

test('rejects a frame from the INFOTAINMENT domain (3) — not a VCSEC push', () => {
  assert.equal(decodeUnsolicitedVcsecStatus(pushFrame({ vehicleLockState: 1 }, { domain: 3 })), null);
});

test('rejects a SOLICITED reply (carries our request_uuid)', () => {
  const frame = pushFrame({ vehicleLockState: 1 }, { requestUuid: new Uint8Array([1, 2, 3, 4]) });
  assert.equal(decodeUnsolicitedVcsecStatus(frame), null);
});

test('rejects an ENCRYPTED payload (AES-GCM sealed — solicited-read path, not a push)', () => {
  assert.equal(decodeUnsolicitedVcsecStatus(pushFrame({ vehicleLockState: 1 }, { encrypted: true })), null);
});

test('rejects a frame with no payload (e.g. presence beacon with empty body)', () => {
  assert.equal(decodeUnsolicitedVcsecStatus(pushFrame({}, { noPayload: true })), null);
});

test('rejects garbage bytes that are not a RoutableMessage', () => {
  // Random bytes: decode either throws or yields no VCSEC fromDestination.
  assert.equal(decodeUnsolicitedVcsecStatus(new Uint8Array([0xff, 0x00, 0x13, 0x37, 0x42])), null);
});

test('a VCSEC push with an empty vehicleStatus still decodes (all-closed / all-default)', () => {
  // vehicleStatus present but every field default -> a valid (empty) status,
  // NOT null. This is how a settled car reports "everything closed".
  const status = decodeUnsolicitedVcsecStatus(pushFrame({}));
  assert.ok(status, 'an explicit (if empty) vehicleStatus is a real push');
  assert.deepEqual(status.closures, {});
});
