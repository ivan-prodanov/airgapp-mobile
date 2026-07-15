import { test } from 'node:test';
import assert from 'node:assert/strict';

import { RoutableMessage, encodeMessage } from './proto';
import { frameAnswersRequest, outgoingCorrelators } from './bleCorrelation';

function hexToBytes(hex: string): Uint8Array {
  return new Uint8Array(Buffer.from(hex, 'hex'));
}

const R = hexToBytes('aabbccddeeff00112233445566778899'); // 16-byte routing address
const R_OTHER = hexToBytes('00112233445566778899aabbccddeeff'); // 16 bytes, distinct from R
const U = hexToBytes('0102030405060708090a0b0c0d0e0f10'); // 16-byte uuid

test('outgoingCorrelators extracts fromDestination.routingAddress and uuid from a real encoded request', () => {
  const encoded = encodeMessage(RoutableMessage, {
    fromDestination: { routingAddress: R },
    uuid: U,
  });
  const got = outgoingCorrelators(encoded);
  assert.deepEqual(Array.from(got.routingAddress!), Array.from(R));
  assert.deepEqual(Array.from(got.uuid!), Array.from(U));
});

test('frameAnswersRequest: matches on to_destination.routing_address with an EMPTY request_uuid (VCSEC GET_STATUS path)', () => {
  const response = encodeMessage(RoutableMessage, {
    toDestination: { routingAddress: R },
    // requestUuid intentionally omitted/empty — this is the case that a
    // uuid-only matcher would silently drop forever.
  });
  assert.equal(frameAnswersRequest(response, { routingAddress: R }), true);
});

test('frameAnswersRequest: a different routingAddress does not match', () => {
  const response = encodeMessage(RoutableMessage, {
    toDestination: { routingAddress: R_OTHER },
  });
  assert.equal(frameAnswersRequest(response, { routingAddress: R }), false);
});

test('frameAnswersRequest: falls back to request_uuid when routingAddress is absent', () => {
  const response = encodeMessage(RoutableMessage, {
    requestUuid: U,
  });
  assert.equal(frameAnswersRequest(response, { uuid: U }), true);
});

test('frameAnswersRequest: routing_address takes priority — matches even when uuid also present but different', () => {
  const response = encodeMessage(RoutableMessage, {
    toDestination: { routingAddress: R },
    requestUuid: hexToBytes('ffffffffffffffffffffffffffffffff'),
  });
  assert.equal(frameAnswersRequest(response, { routingAddress: R, uuid: U }), true);
});

test('frameAnswersRequest: neither axis matches -> false', () => {
  const response = encodeMessage(RoutableMessage, {
    toDestination: { routingAddress: R_OTHER },
    requestUuid: hexToBytes('ffffffffffffffffffffffffffffffff'),
  });
  assert.equal(frameAnswersRequest(response, { routingAddress: R, uuid: U }), false);
});

test('frameAnswersRequest: garbage bytes return false without throwing', () => {
  const garbage = new Uint8Array([0xff, 0xfe, 0x00, 0x01, 0xde, 0xad]);
  assert.doesNotThrow(() => frameAnswersRequest(garbage, { routingAddress: R, uuid: U }));
  assert.equal(frameAnswersRequest(garbage, { routingAddress: R, uuid: U }), false);
});

test('frameAnswersRequest: empty want correlators never match (no false positive on absent request correlators)', () => {
  const response = encodeMessage(RoutableMessage, {
    toDestination: { routingAddress: R },
    requestUuid: U,
  });
  assert.equal(frameAnswersRequest(response, {}), false);
});
