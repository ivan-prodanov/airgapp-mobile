import { test } from 'node:test';
import assert from 'node:assert/strict';

import { BleReassembler, MAX_BLE_MESSAGE_SIZE, RX_STALE_GAP_MS, frameForWrite } from './bleFraming';

function concat(chunks: Uint8Array[]): Uint8Array {
  const total = chunks.reduce((n, c) => n + c.length, 0);
  const out = new Uint8Array(total);
  let o = 0;
  for (const c of chunks) {
    out.set(c, o);
    o += c.length;
  }
  return out;
}

test('frameForWrite: small payload fits in one chunk with 2-byte BE length prefix', () => {
  const payload = new Uint8Array([1, 2, 3, 4, 5]);
  const chunks = frameForWrite(payload, 20);
  assert.equal(chunks.length, 1);
  assert.deepEqual(Array.from(chunks[0]), [0x00, 0x05, 1, 2, 3, 4, 5]);
  assert.equal(chunks[0].length, 7);
});

test('frameForWrite: payload larger than blockLength splits into multiple chunks that reassemble', () => {
  const payload = new Uint8Array(40).map((_, i) => i);
  const chunks = frameForWrite(payload, 20);
  // 2 (prefix) + 40 = 42 bytes -> chunks of 20, 20, 2
  assert.equal(chunks.length, 3);
  assert.equal(chunks[0].length, 20);
  assert.equal(chunks[1].length, 20);
  assert.equal(chunks[2].length, 2);

  const reassembled = concat(chunks);
  assert.equal(reassembled.length, 42);
  assert.equal(reassembled[0], 0x00);
  assert.equal(reassembled[1], 0x28); // 40
  assert.deepEqual(Array.from(reassembled.slice(2)), Array.from(payload));
});

test('frameForWrite: throws when blockLength <= 0', () => {
  assert.throws(() => frameForWrite(new Uint8Array([1]), 0), /blockLength/);
  assert.throws(() => frameForWrite(new Uint8Array([1]), -1), /blockLength/);
});

test('frameForWrite: throws when payload length cannot fit the 2-byte prefix', () => {
  const bigPayload = new Uint8Array(0x10000);
  assert.throws(() => frameForWrite(bigPayload, 20), /0xffff|length/i);
});

test('BleReassembler: one message delivered in a single push', () => {
  const payload = new Uint8Array([9, 8, 7]);
  const framed = concat(frameForWrite(payload, 1024));
  const r = new BleReassembler();
  const out = r.push(framed, 1000);
  assert.equal(out.length, 1);
  assert.deepEqual(Array.from(out[0]), Array.from(payload));
});

test('BleReassembler: one message split across three pushes at the same clock time', () => {
  const payload = new Uint8Array(10).map((_, i) => i + 1);
  const framed = concat(frameForWrite(payload, 1024)); // single chunk of prefix+payload
  const a = framed.slice(0, 4);
  const b = framed.slice(4, 9);
  const c = framed.slice(9);

  const r = new BleReassembler();
  assert.deepEqual(r.push(a, 1000), []);
  assert.deepEqual(r.push(b, 1000), []);
  const out = r.push(c, 1000);
  assert.equal(out.length, 1);
  assert.deepEqual(Array.from(out[0]), Array.from(payload));
});

test('BleReassembler: two messages concatenated in one buffer both returned in order', () => {
  const p1 = new Uint8Array([1, 1, 1]);
  const p2 = new Uint8Array([2, 2, 2, 2]);
  const framed = concat([...frameForWrite(p1, 1024), ...frameForWrite(p2, 1024)]);

  const r = new BleReassembler();
  const out = r.push(framed, 1000);
  assert.equal(out.length, 2);
  assert.deepEqual(Array.from(out[0]), Array.from(p1));
  assert.deepEqual(Array.from(out[1]), Array.from(p2));
});

test('BleReassembler: a >1s gap mid-message discards the partial buffer (late bytes do not complete it)', () => {
  const payload = new Uint8Array(10).map((_, i) => i);
  const framed = concat(frameForWrite(payload, 1024));
  const first = framed.slice(0, 5); // partial: prefix + 3 payload bytes
  const rest = framed.slice(5); // the completing bytes, arriving late

  const r = new BleReassembler();
  assert.deepEqual(r.push(first, 1000), []);
  // gap > RX_STALE_GAP_MS
  const out = r.push(rest, 1000 + RX_STALE_GAP_MS + 1);
  // The late bytes do NOT complete the old message. They also don't form
  // a valid message prefix on their own (in general), so nothing should
  // be emitted here.
  assert.deepEqual(out, []);

  // Reassembler recovers: after ANOTHER stale gap (so the leftover late
  // bytes are discarded too), a fresh, complete message still works.
  const p2 = new Uint8Array([42, 43]);
  const framed2 = concat(frameForWrite(p2, 1024));
  const t3 = 1000 + RX_STALE_GAP_MS + 1 + RX_STALE_GAP_MS + 1;
  const out2 = r.push(framed2, t3);
  assert.equal(out2.length, 1);
  assert.deepEqual(Array.from(out2[0]), Array.from(p2));
});

test('BleReassembler: a length prefix declaring > MAX_BLE_MESSAGE_SIZE drops the buffer and recovers on next message', () => {
  const bogus = new Uint8Array([0x07, 0xd0, 1, 2, 3]); // msgLength = 2000 > 1024
  assert.ok(2000 > MAX_BLE_MESSAGE_SIZE);

  const r = new BleReassembler();
  const out = r.push(bogus, 1000);
  assert.deepEqual(out, []);

  const p2 = new Uint8Array([5, 6, 7]);
  const framed2 = concat(frameForWrite(p2, 1024));
  const out2 = r.push(framed2, 1000);
  assert.equal(out2.length, 1);
  assert.deepEqual(Array.from(out2[0]), Array.from(p2));
});

test('BleReassembler: reset clears accumulated partial state', () => {
  const payload = new Uint8Array(10).map((_, i) => i);
  const framed = concat(frameForWrite(payload, 1024));
  const r = new BleReassembler();
  r.push(framed.slice(0, 4), 1000); // partial, no gap yet
  r.reset();
  // After reset, feeding the tail alone should NOT complete the old
  // message (buffer was cleared, and this tail alone is too short /
  // wrongly shaped to be a message on its own).
  const out = r.push(framed.slice(4), 1000);
  assert.deepEqual(out, []);
});

test('a DESYNCED stream is counted — the wedge signature', () => {
  // Feed a valid frame, then bytes that make the parser read a length from the
  // middle of a message. The emitted frames cannot start a RoutableMessage, and
  // until this counter existed that produced no evidence at all.
  const r = new BleReassembler();
  const good = Uint8Array.from([0x00, 0x03, 0x32, 0x01, 0x02]);
  assert.equal(r.push(good, 1000).length, 1);
  assert.equal(r.stats().implausibleFrames, 0, 'a real frame is plausible');

  // 0x99 cannot begin a RoutableMessage.
  r.push(Uint8Array.from([0x00, 0x02, 0x99, 0x99]), 1010);
  assert.equal(r.stats().implausibleFrames, 1);
  assert.equal(r.stats().consecutiveImplausible, 1);
  r.push(Uint8Array.from([0x00, 0x02, 0x88, 0x77]), 1020);
  assert.equal(r.stats().consecutiveImplausible, 2, 'a desync does not self-correct');

  // A good frame resets the run but not the total — the total is the history,
  // the run is the live signal.
  r.push(good, 1030);
  assert.equal(r.stats().consecutiveImplausible, 0);
  assert.equal(r.stats().implausibleFrames, 2);
});

test('staleFlushes counts the escape hatch — a wedge with ZERO confirms it never fired', () => {
  // The wedge hypothesis is that heavy push traffic keeps inter-chunk gaps under
  // RX_STALE_GAP_MS, so the flush that would clear a desync never runs. If a
  // wedge shows implausible frames climbing AND staleFlushes stuck at 0, that is
  // the mechanism, measured rather than argued.
  const r = new BleReassembler();
  r.push(Uint8Array.from([0x00, 0x09, 0x32]), 1000); // partial, waits for more
  assert.equal(r.stats().staleFlushes, 0);
  r.push(Uint8Array.from([0x01]), 1500); // 500ms gap — under the threshold
  assert.equal(r.stats().staleFlushes, 0, 'traffic this close never triggers the flush');
  r.push(Uint8Array.from([0x01]), 3000); // 1500ms gap — over it
  assert.equal(r.stats().staleFlushes, 1);
});

test('residualBytes exposes a buffer that is sitting on a partial message', () => {
  const r = new BleReassembler();
  r.push(Uint8Array.from([0x00, 0x20, 0x32, 0x01]), 1000);
  assert.equal(r.stats().residualBytes, 4, 'held, waiting for the rest');
});
