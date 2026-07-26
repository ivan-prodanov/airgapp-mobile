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

test('REGRESSION (the WEDGE): a frame whose request_uuid MISMATCHES is NOT our answer', () => {
  // This test previously asserted the OPPOSITE — "routing_address takes
  // priority, matches even when uuid also present but different" — and that
  // assertion was the wedge.
  //
  // routingAddress is minted ONCE PER SESSION (session.ts: randomBytes at
  // openDirectSession) and reused for every request in it. So it identifies the
  // SESSION, never the request. With it checked first and short-circuiting, a
  // LATE reply to request A satisfies request B:
  //
  //   1. request A times out; we stop waiting
  //   2. request B goes out
  //   3. A's late reply arrives, carrying the session routing address
  //   4. this matcher accepts it as B's answer
  //   5. sendCommand then throws "sent uuid=… got request_uuid=…" or fails the
  //      AAD decrypt — B fails, retries, and consumes the NEXT stale reply
  //
  // Permanently one-behind. Measured on-car 2026-07-26: exchanges timing out for
  // 60-90s while the car was demonstrably still pushing, self-healing only when
  // the car went quiet, always cleared by an app restart.
  //
  // A frame carrying a request_uuid is SELF-IDENTIFYING. If it does not match,
  // it is not ours, whatever the routing address says.
  const response = encodeMessage(RoutableMessage, {
    toDestination: { routingAddress: R },
    requestUuid: hexToBytes('ffffffffffffffffffffffffffffffff'),
  });
  assert.equal(frameAnswersRequest(response, { routingAddress: R, uuid: U }), false);
});

test('routing_address still matches when the frame carries NO uuid — the VCSEC path is preserved', () => {
  // The reason routing_address matching exists at all: VCSEC GET_STATUS replies
  // (every lock/closure read) carry to_destination.routing_address and an EMPTY
  // request_uuid. A uuid-only matcher drops all of them forever. The fix above
  // must not break this, so it is asserted right next to it.
  const response = encodeMessage(RoutableMessage, { toDestination: { routingAddress: R } });
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

test('the one-behind sequence: A times out, B is sent, A late reply must NOT satisfy B', () => {
  // The wedge end to end, in the terms the log showed it. Same session, so the
  // same routing address on both replies — which is exactly why routing address
  // could never have told them apart.
  const uuidA = hexToBytes('aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa');
  const uuidB = hexToBytes('bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb');
  const lateReplyToA = encodeMessage(RoutableMessage, {
    toDestination: { routingAddress: R },
    requestUuid: uuidA,
  });
  // We are now waiting on B.
  assert.equal(frameAnswersRequest(lateReplyToA, { routingAddress: R, uuid: uuidB }), false);
  // And B's own reply still lands.
  const replyToB = encodeMessage(RoutableMessage, {
    toDestination: { routingAddress: R },
    requestUuid: uuidB,
  });
  assert.equal(frameAnswersRequest(replyToB, { routingAddress: R, uuid: uuidB }), true);
});

test('a uuid-bearing frame is rejected when we asked with routingAddress ONLY', () => {
  // Guards the strict reading: if the frame names a request and we have no uuid
  // to compare, we cannot claim it is ours. Accepting it on routing address
  // alone is precisely the old behaviour.
  const response = encodeMessage(RoutableMessage, {
    toDestination: { routingAddress: R },
    requestUuid: hexToBytes('cccccccccccccccccccccccccccccccc'),
  });
  assert.equal(frameAnswersRequest(response, { routingAddress: R }), false);
});
