import { test } from 'node:test';
import assert from 'node:assert/strict';

import { buildRoutablePassiveResponse, DOMAIN_VEHICLE_SECURITY } from './session';
import { decodeMessage, RoutableMessage } from './proto';
import { aesGcmDecrypt, buildAesGcmMetadata } from './crypto';
import {
  encodeUnsignedAuthResponse,
  encodeAuthenticationResponse,
  AUTH_LEVEL,
} from './passiveEntryAuth';
import type { Session } from './types';

// A deterministic fake session — enough for the sync frame builder. The 16-byte
// key + fixed routing/pub/epoch let us decrypt and assert the exact structure
// RE RESPONSE #9 specified.
function fakeSession(counter = 10): Session {
  return {
    sessionId: 'test',
    domain: DOMAIN_VEHICLE_SECURITY,
    vin: '5YJ3E1EA1AAA00001',
    routingAddress: Uint8Array.from(new Array(16).fill(0xab)),
    sessionKey: Uint8Array.from(new Array(16).fill(0x42)),
    keyBytes: Uint8Array.from(new Array(16).fill(0x42)),
    myPubRaw: Uint8Array.from(new Array(65).fill(0x04)),
    vehiclePubRaw: Uint8Array.from(new Array(65).fill(0x04)),
    epoch: Uint8Array.from(new Array(16).fill(0x07)),
    counter,
    clockBase: 1000,
    localBaselineMs: Date.now(),
    close: async () => {},
  };
}

test('routable passive response has the exact envelope RE #9 specified', () => {
  const s = fakeSession(10);
  const inner = encodeUnsignedAuthResponse(
    encodeAuthenticationResponse({ authenticationLevel: AUTH_LEVEL.DRIVE }),
  );
  const { bytes, counter } = buildRoutablePassiveResponse(s, inner);

  assert.equal(counter, 11, 'counter bumped once');
  assert.equal(s.counter, 11, 'bump is persisted on the session');

  const rm = decodeMessage(RoutableMessage, bytes);
  assert.equal(rm.toDestination.domain, DOMAIN_VEHICLE_SECURITY, 'to.domain = VEHICLE_SECURITY');
  assert.deepEqual(
    new Uint8Array(rm.fromDestination.routingAddress),
    s.routingAddress,
    'from.routing_address is ours',
  );
  // uuid = single 0x00 byte — the challenge uuid is NOT echoed.
  assert.deepEqual(new Uint8Array(rm.uuid), Uint8Array.from([0x00]), 'uuid = {0x00}');
  assert.equal(rm.payload, 'protobufMessageAsBytes', 'carries ciphertext, not plaintext');
  assert.ok(rm.signatureData.AES_GCM_PersonalizedData, 'sealed AES_GCM_Personalized (routable)');
});

test('the nonce is a RANDOM 12 bytes, NOT the counter — the whole point vs legacy', () => {
  const a = buildRoutablePassiveResponse(fakeSession(10), Uint8Array.from([0xaa]));
  const b = buildRoutablePassiveResponse(fakeSession(10), Uint8Array.from([0xaa]));
  const na = new Uint8Array(decodeMessage(RoutableMessage, a.bytes).signatureData.AES_GCM_PersonalizedData.nonce);
  const nb = new Uint8Array(decodeMessage(RoutableMessage, b.bytes).signatureData.AES_GCM_PersonalizedData.nonce);
  assert.equal(na.length, 12, 'nonce is 12 bytes (routable), not 4 (legacy IV=counter)');
  // Same key + same counter (11) on both — if the nonce were counter-derived
  // these would be EQUAL, which is exactly the legacy nonce-reuse catastrophe.
  // Random nonce → they differ.
  assert.notDeepEqual(na, nb, 'same key+counter still gets distinct nonces — no reuse');
});

test('decrypts back to our exact AuthenticationResponse, and binds NO token', () => {
  const s = fakeSession(10);
  const inner = encodeUnsignedAuthResponse(
    encodeAuthenticationResponse({ authenticationLevel: AUTH_LEVEL.DRIVE }),
  );
  const { bytes, counter } = buildRoutablePassiveResponse(s, inner);
  const rm = decodeMessage(RoutableMessage, bytes);
  const sig = rm.signatureData.AES_GCM_PersonalizedData;

  // Rebuild the AAD exactly as the car would (flags omitted since 0) and decrypt.
  const aad = buildAesGcmMetadata({
    domain: DOMAIN_VEHICLE_SECURITY,
    verifierName: s.vin,
    epoch: s.epoch,
    expiresAt: sig.expiresAt,
    counter,
    flags: 0,
  });
  const pt = aesGcmDecrypt(
    s.sessionKey,
    new Uint8Array(sig.nonce),
    new Uint8Array(rm.protobufMessageAsBytes),
    new Uint8Array(sig.tag),
    aad,
  );
  // Round-trips to the SAME inner UnsignedMessage{authenticationResponse} we fed
  // in — proving the seal + AAD are correct AND that the inner is exactly the
  // auth response (inner was built by encodeUnsignedAuthResponse).
  assert.deepEqual(new Uint8Array(pt), inner, 'decrypts to our inner auth response');
  // Freshness-only: the counter lives in the signature, never as the nonce.
  assert.equal(sig.counter, counter, 'counter is in the signature, not used as the nonce');
});
