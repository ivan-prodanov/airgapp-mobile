import { test } from 'node:test';
import assert from 'node:assert/strict';

import { inspectUnsolicitedFrame, formatUnsolicitedFrame } from './passiveEntryCapture';

// A routine closure/lock push: FromVCSECMessage { vehicleStatus(1) = {…} }.
const vehicleStatusFrame = Uint8Array.from([0x0a, 0x02, 0x08, 0x01]);

test('a routine vehicleStatus push is NOT flagged as a candidate', () => {
  const r = inspectUnsolicitedFrame(vehicleStatusFrame);
  assert.deepEqual(r.fields, [1]);
  assert.deepEqual(r.names, ['vehicleStatus']);
  assert.equal(r.hasUnknown, false, 'routine pushes must not create false positives');
});

test('an UNKNOWN submessage is flagged — this is the challenge we are hunting', () => {
  // Field 20, which we have no proto for. The real AuthenticationRequest field
  // number is unknown; the point is that ANY unmodelled field gets surfaced
  // rather than silently dropped.
  const frame = Uint8Array.from([0xa2, 0x01, 0x03, 0x08, 0x09, 0x10]); // field 20, LEN 3
  const r = inspectUnsolicitedFrame(frame);
  assert.deepEqual(r.fields, [20]);
  assert.deepEqual(r.names, ['UNKNOWN(20)']);
  assert.equal(r.hasUnknown, true);
});

test('a frame mixing known + unknown fields is still flagged', () => {
  const frame = Uint8Array.from([
    0x0a, 0x02, 0x08, 0x01, // vehicleStatus(1)
    0xa2, 0x01, 0x01, 0x09, // UNKNOWN(20)
  ]);
  const r = inspectUnsolicitedFrame(frame);
  assert.deepEqual(r.fields, [1, 20]);
  assert.equal(r.hasUnknown, true, 'a known field must not mask an unknown one');
});

test('format marks candidates so they are greppable among routine pushes', () => {
  const routine = formatUnsolicitedFrame(vehicleStatusFrame);
  assert.equal(routine.length, 2);
  assert.ok(!routine[0].includes('CANDIDATE'), 'no marker on routine traffic');
  assert.match(routine[1], /raw: 0a 02 08 01/);

  const candidate = formatUnsolicitedFrame(Uint8Array.from([0xa2, 0x01, 0x01, 0x09]));
  assert.match(candidate[0], /\*\*\* CANDIDATE CHALLENGE \*\*\*/);
});

test('hex is capped so one huge frame cannot swamp the log', () => {
  const big = new Uint8Array(400).fill(0xab);
  const r = inspectUnsolicitedFrame(big);
  assert.equal(r.byteLength, 400, 'true length is still reported');
  assert.match(r.hex, /…\(\+144 more\)/);
});

test('a malformed frame degrades instead of throwing', () => {
  // Truncated length-delimited field — real BLE frames can be anything.
  assert.doesNotThrow(() => inspectUnsolicitedFrame(Uint8Array.from([0x0a, 0x7f])));
});
