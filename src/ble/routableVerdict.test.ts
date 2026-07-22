import { test } from 'node:test';
import assert from 'node:assert/strict';

import { describeRoutableVerdict, routableVerdictAccepted } from './passiveEntryCapture';

const hex = (h: string) => Uint8Array.from(h.trim().split(/\s+/).map((x) => parseInt(x, 16)));

// VERBATIM on-car capture 2026-07-22: the car's ack of our routable auth
// response — RoutableMessage from VCSEC to our routing address, requestUuid=00,
// empty payload, NO signedMessageStatus.
const REAL_ACK = hex(
  '32 12 12 10 37 de ac 45 06 e7 d1 3f 6b 70 ef 99 40 54 61 df 3a 02 08 02 52 00 92 03 01 00',
);
// A broadcast vehicleStatus push from VCSEC (no requestUuid) — must NOT be read
// as a verdict, or every routine push would spam the circuit breaker.
const STATUS_PUSH = hex(
  '32 02 08 00 3a 02 08 02 52 10 0a 0e 18 02 20 01 38 01 42 06 08 01 10 01 18 01',
);

test('the real routable ack reads as ACCEPTED', () => {
  assert.equal(describeRoutableVerdict(REAL_ACK), 'CAR VERDICT (routable) → NONE (accepted)');
  assert.equal(routableVerdictAccepted(REAL_ACK), true);
});

test('a broadcast status push is NOT a verdict (no requestUuid)', () => {
  assert.equal(describeRoutableVerdict(STATUS_PUSH), null);
  assert.equal(routableVerdictAccepted(STATUS_PUSH), false);
});

test('malformed / empty frames degrade to null, never throw', () => {
  assert.doesNotThrow(() => describeRoutableVerdict(Uint8Array.from([0xff, 0x01])));
  assert.equal(describeRoutableVerdict(Uint8Array.from([])), null);
});
