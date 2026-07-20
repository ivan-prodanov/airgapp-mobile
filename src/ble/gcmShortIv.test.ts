import { test } from 'node:test';
import assert from 'node:assert/strict';
import crypto from 'node:crypto';

import { aesGcmEncryptShortIv, be32 } from './gcmShortIv';

// The ground truth: OpenSSL computes GCM's J0 via GHASH for a non-12-byte IV.
// If our hand-composed short-IV GCM matches OpenSSL across random inputs AND
// IV lengths, it is correct — this is the whole reason the on-car seal failed.
function openssl(key: Uint8Array, iv: Uint8Array, aad: Uint8Array, pt: Uint8Array) {
  const c = crypto.createCipheriv(`aes-${key.length * 8}-gcm`, key, iv);
  c.setAAD(aad);
  const ct = Buffer.concat([c.update(pt), c.final()]);
  return { ct: new Uint8Array(ct), tag: new Uint8Array(c.getAuthTag()) };
}

test('matches OpenSSL for a 4-BYTE IV (the Tesla case)', () => {
  const key = new Uint8Array(16).fill(0x42);
  const iv = be32(5);
  const aad = new Uint8Array(20).fill(0xab);
  const pt = Uint8Array.from([0x1a, 0x06, 0x08, 0x02, 0x10, 0x00, 0x18, 0x00]);

  const ours = aesGcmEncryptShortIv(key, iv, aad, pt);
  const ref = openssl(key, iv, aad, pt);
  assert.deepEqual(ours.ciphertext, ref.ct, 'ciphertext must match OpenSSL');
  assert.deepEqual(ours.tag, ref.tag, 'tag must match OpenSSL');
});

test('matches OpenSSL across random key/IV-length/AAD/plaintext (fuzz)', () => {
  for (let i = 0; i < 200; i += 1) {
    const key = crypto.randomBytes(16);
    // Exercise non-12-byte IVs specifically — 1,4,7,8,13,16 bytes.
    const ivLen = [1, 4, 7, 8, 13, 16][i % 6];
    const iv = crypto.randomBytes(ivLen);
    const aad = crypto.randomBytes(i % 40);
    const pt = crypto.randomBytes(i % 64);

    const ours = aesGcmEncryptShortIv(key, iv, aad, pt);
    const ref = openssl(key, iv, aad, pt);
    assert.deepEqual(ours.ciphertext, ref.ct, `ct mismatch at i=${i} ivLen=${ivLen}`);
    assert.deepEqual(ours.tag, ref.tag, `tag mismatch at i=${i} ivLen=${ivLen}`);
  }
});

test('a 12-byte IV also matches (regression against the fast path)', () => {
  const key = crypto.randomBytes(16);
  const iv = crypto.randomBytes(12);
  const aad = crypto.randomBytes(13);
  const pt = crypto.randomBytes(31);
  const ours = aesGcmEncryptShortIv(key, iv, aad, pt);
  const ref = openssl(key, iv, aad, pt);
  assert.deepEqual(ours.ciphertext, ref.ct);
  assert.deepEqual(ours.tag, ref.tag);
});

test('be32 is the 4-byte big-endian counter Tesla uses', () => {
  assert.deepEqual(Array.from(be32(1)), [0, 0, 0, 1]);
  assert.deepEqual(Array.from(be32(0x01020304)), [1, 2, 3, 4]);
});
