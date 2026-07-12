import { test } from 'node:test';
import assert from 'node:assert/strict';

import { bytesToBase64, base64ToBytes, bytesToHex, hexToBytes } from './bytes';

// "honk honk" = 686f6e6b20686f6e6b (the fixtures' testPlainHex). Its standard
// base64 is aG9uayBob25r — a known, hand-verifiable vector.
test('bytesToBase64 encodes the honk vector to the canonical base64', () => {
  const bytes = hexToBytes('686f6e6b20686f6e6b');
  assert.equal(bytesToBase64(bytes), 'aG9uayBob25r');
});

test('base64ToBytes decodes the honk vector back to bytes', () => {
  const bytes = base64ToBytes('aG9uayBob25r');
  assert.equal(bytesToHex(bytes), '686f6e6b20686f6e6b');
});

// Padding cases: 1 and 2 leftover bytes exercise the '='/'==' tails.
test('round-trips across all three residue classes (0/1/2 mod 3)', () => {
  for (const hex of ['', 'ff', 'ffee', 'ffeedd', 'ffeeddcc', 'ffeeddccbb']) {
    const b = hexToBytes(hex);
    assert.equal(bytesToHex(base64ToBytes(bytesToBase64(b))), hex);
  }
});

test('round-trips random byte strings of every length 0..64', () => {
  for (let len = 0; len <= 64; len++) {
    const b = new Uint8Array(len);
    for (let i = 0; i < len; i++) b[i] = (i * 37 + len * 11) & 0xff;
    const rt = base64ToBytes(bytesToBase64(b));
    assert.deepEqual(rt, b, `length ${len}`);
  }
});

test('base64 uses standard (not url-safe) + and / alphabet', () => {
  // 0xfb 0xff 0xbf → +/+ region: contains '+' and '/'.
  const b = hexToBytes('fbffbf');
  const s = bytesToBase64(b);
  assert.equal(s, '+/+/');
  assert.deepEqual(base64ToBytes(s), b);
});

test('base64ToBytes tolerates embedded whitespace', () => {
  assert.equal(bytesToHex(base64ToBytes('aG9u\nayBo b25r')), '686f6e6b20686f6e6b');
});

test('base64ToBytes rejects out-of-alphabet characters', () => {
  assert.throws(() => base64ToBytes('aG9u*ayA='), /invalid base64/);
});
