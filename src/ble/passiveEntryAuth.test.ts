import { test } from 'node:test';
import assert from 'node:assert/strict';

import {
  parseAuthenticationRequest,
  encodeAuthenticationResponse,
  encodeUnsignedAuthResponse,
  encodeToVcsecSignedMessage,
  buildAuthIv,
  describeReasons,
  AUTH_LEVEL,
  AUTH_REJECTION,
  AUTH_TOKEN_LENGTH,
  SIGNATURE_TYPE_AES_GCM_TOKEN,
} from './passiveEntryAuth';

// A VERBATIM challenge captured from the car 2026-07-20, reason 5
// (PASSIVE_UNLOCK_EXTERIOR_HANDLE_PULL). Testing against real bytes rather than
// only hand-built ones is what caught the envelope bug in the capture layer.
const REAL_HANDLE_PULL = Uint8Array.from([
  0x32, 0x02, 0x08, 0x00, // RoutableMessage.to_destination
  0x3a, 0x02, 0x08, 0x02, // RoutableMessage.from_destination (domain 2 VCSEC)
  0x52, 0x1f, // payload(10), len 31
  0x1a, 0x1d, // FromVCSECMessage.authenticationRequest(3), len 29
  0x12, 0x16, // sessionInfo(2), len 22
  0x0a, 0x14, // token(1), len 20
  0x29, 0xd5, 0x11, 0xed, 0x01, 0xe5, 0xe9, 0x1e, 0xf4, 0xd8,
  0x9c, 0xbe, 0x8e, 0x71, 0xa2, 0x55, 0x33, 0xdd, 0x72, 0x7e,
  0x18, 0x02, // requestedLevel(3) = 2 (DRIVE)
  0x22, 0x01, 0x01, // reasonsForAuth(4) packed = [1]
]);

test('decodes a REAL captured challenge', () => {
  const req = parseAuthenticationRequest(REAL_HANDLE_PULL);
  assert.ok(req, 'must decode');
  assert.equal(req.token.length, AUTH_TOKEN_LENGTH, 'token is exactly 20 bytes');
  assert.equal(req.token[0], 0x29);
  assert.equal(req.requestedLevel, AUTH_LEVEL.DRIVE, 'car asks for DRIVE, not UNLOCK');
  assert.deepEqual(req.reasons, [1]);
});

test('decodes reasonsForAuth in BOTH packed and unpacked form', () => {
  // The car packs; the schema permits either and we do not control its encoder.
  // body is 12 bytes: sessionInfo(6) + requestedLevel(2) + reasons(4)
  const packed = Uint8Array.from([
    0x1a, 0x0c, 0x12, 0x04, 0x0a, 0x02, 0xaa, 0xbb, 0x18, 0x01, 0x22, 0x02, 0x05, 0x09,
  ]);
  assert.deepEqual(parseAuthenticationRequest(packed)?.reasons, [5, 9]);
  const unpacked = Uint8Array.from([
    0x1a, 0x0c, 0x12, 0x04, 0x0a, 0x02, 0xaa, 0xbb, 0x18, 0x01, 0x20, 0x05, 0x20, 0x09,
  ]);
  assert.deepEqual(parseAuthenticationRequest(unpacked)?.reasons, [5, 9]);
});

test('a routine vehicleStatus push is NOT mistaken for a challenge', () => {
  // Critical: this runs on every unsolicited frame. A false positive would make
  // us sign and transmit garbage at the car.
  const routine = Uint8Array.from([
    0x32, 0x02, 0x08, 0x00, 0x3a, 0x02, 0x08, 0x02,
    0x52, 0x04, 0x0a, 0x02, 0x08, 0x01, // payload = { vehicleStatus(1) }
  ]);
  assert.equal(parseAuthenticationRequest(routine), null);
});

test('a challenge with no token yields null rather than an unsigned grant', () => {
  // requestedLevel present but sessionInfo absent → per q1.java we must NOT
  // sign a grant. Returning null keeps that decision impossible to get wrong.
  const noToken = Uint8Array.from([0x1a, 0x04, 0x18, 0x02, 0x22, 0x00]);
  assert.equal(parseAuthenticationRequest(noToken), null);
});

test('malformed frames degrade to null instead of throwing', () => {
  assert.doesNotThrow(() => parseAuthenticationRequest(Uint8Array.from([0x1a, 0x7f])));
  assert.equal(parseAuthenticationRequest(Uint8Array.from([0x1a, 0x7f])), null);
});

test('encodes AuthenticationResponse with the official app\'s field values', () => {
  const b = encodeAuthenticationResponse({ authenticationLevel: AUTH_LEVEL.DRIVE });
  // authenticationLevel(1)=2, estimatedDistance(2)=0, authenticationRejection(3)=0
  assert.deepEqual(Array.from(b), [0x08, 0x02, 0x10, 0x00, 0x18, 0x00]);
});

test('encodes a rejection (NO_TOKEN) as a distinct, non-granting answer', () => {
  const b = encodeAuthenticationResponse({
    authenticationLevel: AUTH_LEVEL.NONE,
    authenticationRejection: AUTH_REJECTION.NO_TOKEN,
  });
  assert.deepEqual(Array.from(b), [0x08, 0x00, 0x10, 0x00, 0x18, 0x03]);
});

test('wraps the response in UnsignedMessage field 3', () => {
  const inner = Uint8Array.from([0xaa, 0xbb]);
  assert.deepEqual(Array.from(encodeUnsignedAuthResponse(inner)), [0x1a, 0x02, 0xaa, 0xbb]);
});

test('builds ToVCSECMessage{SignedMessage} with an EMPTY token field', () => {
  const out = encodeToVcsecSignedMessage({
    ciphertext: Uint8Array.from([0x11, 0x22]),
    tag: Uint8Array.from(new Array(16).fill(0xcc)),
    keyId: Uint8Array.from([0xc6, 0xe9, 0xaf, 0x58]),
    counter: 7,
  });
  // ToVCSECMessage.signedMessage(1)
  assert.equal(out[0], 0x0a);
  const signed = out.subarray(2);
  // token(1) must be ABSENT — the token is bound as AAD, not echoed.
  assert.equal(signed[0], 0x12, 'first field is protobufMessageAsBytes(2), not token(1)');
  // signatureType(3) = AES_GCM_TOKEN(3)
  const i = signed.indexOf(0x18);
  assert.equal(signed[i + 1], SIGNATURE_TYPE_AES_GCM_TOKEN);
  // keyId(5) is our 4-byte SHA1 prefix
  assert.ok(
    Buffer.from(signed).includes(Buffer.from([0x2a, 0x04, 0xc6, 0xe9, 0xaf, 0x58])),
    'keyId(5) = SHA1(pubkey)[:4]',
  );
});

test('IV variants are 12 bytes and place the counter where their name says', () => {
  // The exact assembly is the one unknown the RE could not pin, so the variants
  // must be distinct and switchable without a rebuild.
  const last = buildAuthIv(1, 'counter-last');
  assert.equal(last.length, 12);
  assert.deepEqual(Array.from(last.subarray(8)), [0, 0, 0, 1], 'BE counter right-aligned');
  assert.deepEqual(Array.from(last.subarray(0, 8)), new Array(8).fill(0));

  const first = buildAuthIv(1, 'counter-first');
  assert.deepEqual(Array.from(first.subarray(0, 4)), [0, 0, 0, 1]);

  const le = buildAuthIv(1, 'counter-last-le');
  assert.deepEqual(Array.from(le.subarray(8)), [1, 0, 0, 0], 'little-endian');

  // All variants must actually differ, or cycling them on-car proves nothing.
  const seen = new Set(
    (['counter-last', 'counter-first', 'counter-last-le', 'counter-first-le'] as const).map((v) =>
      buildAuthIv(0x01020304, v).join(','),
    ),
  );
  assert.equal(seen.size, 4, 'every variant is distinct');
});

test('describeReasons names the codes we actually saw on-car', () => {
  assert.match(describeReasons([5]), /PASSIVE_UNLOCK_EXTERIOR_HANDLE_PULL\(5\)/);
  assert.match(describeReasons([1, 8]), /IDENTIFICATION\(1\), ENTERED_HIGHER_AUTH_ZONE\(8\)/);
});

test('end-to-end: real challenge → sealed response, shape is wire-valid', async () => {
  const { aesGcmEncryptWithNonce } = await import('./crypto');
  const req = parseAuthenticationRequest(REAL_HANDLE_PULL);
  assert.ok(req);

  const sessionKey = Uint8Array.from(new Array(16).fill(0x42));
  const counter = 5;
  const plaintext = encodeUnsignedAuthResponse(
    encodeAuthenticationResponse({ authenticationLevel: req.requestedLevel }),
  );
  // The token is the AAD — this is the binding that proves freshness.
  const sealed = aesGcmEncryptWithNonce(sessionKey, plaintext, req.token, buildAuthIv(counter));
  const frame = encodeToVcsecSignedMessage({
    ciphertext: sealed.ciphertext,
    tag: sealed.tag,
    keyId: Uint8Array.from([0xc6, 0xe9, 0xaf, 0x58]),
    counter,
  });

  assert.equal(sealed.tag.length, 16, 'GCM tag is 16 bytes');
  assert.ok(frame.length > 20 && frame[0] === 0x0a, 'ToVCSECMessage.signedMessage');
  // Re-parsing our own output must not look like a challenge (no infinite loop).
  assert.equal(parseAuthenticationRequest(frame), null);
});
