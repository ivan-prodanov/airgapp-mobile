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

// Regression for the envelope bug: the first on-car capture flagged ALL 36
// frames as candidates because the classifier read the OUTER RoutableMessage
// fields (6/7/10) against FromVCSECMessage names. It must unwrap field 10 first.
test('unwraps the RoutableMessage envelope before classifying (regression)', () => {
  // RoutableMessage { to_destination(6), from_destination(7), payload(10) = {
  //   FromVCSECMessage { vehicleStatus(1) } } } — a ROUTINE push.
  const routine = Uint8Array.from([
    0x32, 0x02, 0x08, 0x00, // f6 to_destination
    0x3a, 0x02, 0x08, 0x02, // f7 from_destination (domain 2, VCSEC)
    0x52, 0x04, 0x0a, 0x02, 0x08, 0x01, // f10 payload = { f1 vehicleStatus }
  ]);
  const r = inspectUnsolicitedFrame(routine);
  assert.deepEqual(r.fields, [1], 'classifies the INNER message, not the envelope');
  assert.equal(r.hasUnknown, false, 'a routine push must not be flagged');
});

test('flags the real on-car unmodelled field 3 through the envelope', () => {
  // Verbatim bytes captured from the car 2026-07-20 during a ~1/sec burst:
  // FromVCSECMessage.f3 { f2={f1=<20B>}, f3=2, f4=<1B> } — no proto for f3.
  const onCar = Uint8Array.from([
    0x32, 0x02, 0x08, 0x00,
    0x3a, 0x02, 0x08, 0x02,
    0x52, 0x1f, 0x1a, 0x1d, 0x12, 0x16, 0x0a, 0x14,
    0x29, 0xd5, 0x11, 0xed, 0x01, 0xe5, 0xe9, 0x1e, 0xf4, 0xd8,
    0x9c, 0xbe, 0x8e, 0x71, 0xa2, 0x55, 0x33, 0xdd, 0x72, 0x7e,
    0x18, 0x02, 0x22, 0x01, 0x01,
  ]);
  const r = inspectUnsolicitedFrame(onCar);
  assert.deepEqual(r.fields, [3], 'inner FromVCSECMessage field 3');
  assert.equal(r.hasUnknown, true, 'field 3 is unmodelled → candidate challenge');
});

test('an accepted commandStatus (no information field) reads as NONE/accepted', async () => {
  const { describeCommandStatus, commandStatusAccepted } = await import('./passiveEntryCapture');
  // RoutableMessage{ payload(10) = FromVCSECMessage{ commandStatus(4) = {
  //   operationStatus(1)=0, signedMessageStatus(2) = { counter(1)=1499 } } } }
  // information(2) is OMITTED — proto3 drops the zero value NONE. This is the
  // exact shape the car sends on a GRANT, and reading it as "?" hid the first
  // successful passive-entry unlock on-car.
  const counterVarint = [0xdb, 0x0b]; // 1499
  const signed = [0x08, ...counterVarint]; // counter(1)=1499, NO field 2
  const cmd = [0x08, 0x00, 0x12, signed.length, ...signed]; // opStatus(1)=0, signedMsgStatus(2)
  const vcsec = [0x22, cmd.length, ...cmd]; // commandStatus = field 4
  const frame = Uint8Array.from([0x52, vcsec.length, ...vcsec]); // payload = field 10

  const v = describeCommandStatus(frame);
  assert.match(v ?? '', /counter=1499 → NONE \(accepted\)/, 'absent info ⇒ NONE, not "?"');
  assert.equal(commandStatusAccepted(frame), true);

  // A rejection (information=6) must NOT read as accepted.
  const signedRej = [0x08, ...counterVarint, 0x10, 0x06]; // + information(2)=6
  const cmdRej = [0x08, 0x02, 0x12, signedRej.length, ...signedRej];
  const rej = Uint8Array.from([0x52, cmdRej.length + 2, 0x22, cmdRej.length, ...cmdRej]);
  assert.equal(commandStatusAccepted(rej), false, 'FAULT_AES_DECRYPT_AUTH is not acceptance');
});
