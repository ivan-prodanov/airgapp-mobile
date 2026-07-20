// gcmShortIv.ts — AES-GCM that accepts a NON-96-bit IV.
//
// WHY: the Tesla passive-entry seal (AES_GCM_TOKEN) uses the invocation counter
// as a raw 4-BYTE big-endian IV (RE RESPONSE #2, from the decompiled
// gf0/b.java k()). Standard GCM libraries — including @noble/ciphers' gcm and
// WebCrypto — hard-require a 12-byte nonce and reject 4 bytes outright (verified:
// @noble throws "invalid nonce length"). For a non-96-bit IV, GCM derives the
// pre-counter block J0 via GHASH instead of the IV‖0x00000001 shortcut, so a
// 4-byte IV and any 12-byte padding of the same counter produce DIFFERENT
// keystream and tag — which is exactly why every 12-byte layout returned
// FAULT_AES_DECRYPT_AUTH on-car.
//
// This composes the seal from @noble's AUDITED primitives — ecb (single AES
// block), ctr (AES-CTR), and _polyval's ghash — per NIST SP 800-38D §7.1. No
// hand-rolled AES or field arithmetic. Validated against OpenSSL/BoringSSL
// vectors in the test.

import { ecb, ctr } from '@noble/ciphers/aes';
import { ghash } from '@noble/ciphers/_polyval';

const BLOCK = 16;

function aesBlock(key: Uint8Array, block16: Uint8Array): Uint8Array {
  // ECB of a single block = the raw AES permutation. @noble's ecb pads by
  // default; disablePadding makes a 16-byte input encrypt to exactly 16 bytes.
  return ecb(key, { disablePadding: true }).encrypt(block16);
}

function be32(counter: number): Uint8Array {
  const c = counter >>> 0;
  return Uint8Array.from([(c >>> 24) & 0xff, (c >>> 16) & 0xff, (c >>> 8) & 0xff, c & 0xff]);
}

// computeJ0 for a non-96-bit IV: J0 = GHASH_H( IV ‖ 0^s+64 ‖ len64(bitlen(IV)) ),
// zero-padded so the whole thing is a whole number of 16-byte blocks (§7.1).
function computeJ0(h: Uint8Array, iv: Uint8Array): Uint8Array {
  // The 96-bit special case: J0 = IV ‖ 0x00000001, no GHASH (§7.1). Included so
  // this function is a correct general GCM, not only the short-IV path.
  if (iv.length === 12) {
    const j0 = new Uint8Array(BLOCK);
    j0.set(iv, 0);
    j0[15] = 1;
    return j0;
  }
  const ivBlocks = Math.ceil(iv.length / BLOCK) || 1;
  const buf = new Uint8Array(ivBlocks * BLOCK + BLOCK); // padded IV + one length block
  buf.set(iv, 0);
  // last 8 bytes of the final block = bit length of the IV, big-endian.
  const bitLen = iv.length * 8;
  const dv = new DataView(buf.buffer);
  dv.setUint32(buf.length - 4, bitLen >>> 0, false);
  return ghash.create(h).update(buf).digest();
}

function inc32(block: Uint8Array): Uint8Array {
  const out = block.slice();
  const dv = new DataView(out.buffer);
  const last = dv.getUint32(12, false);
  dv.setUint32(12, (last + 1) >>> 0, false);
  return out;
}

export interface GcmShortIvSealed {
  ciphertext: Uint8Array;
  tag: Uint8Array;
}

// aesGcmEncryptShortIv seals with an arbitrary-length IV (here, 4 bytes).
// Returns ciphertext + 16-byte tag, matching the wire split the caller needs.
export function aesGcmEncryptShortIv(
  key: Uint8Array,
  iv: Uint8Array,
  aad: Uint8Array,
  plaintext: Uint8Array,
): GcmShortIvSealed {
  const h = aesBlock(key, new Uint8Array(BLOCK)); // H = E_K(0^128)
  const j0 = computeJ0(h, iv);

  // Keystream starts at inc32(J0); @noble ctr takes the full 16-byte counter.
  const ciphertext = ctr(key, inc32(j0)).encrypt(plaintext);

  // tag = E_K(J0) XOR GHASH_H(AAD, C)  with both padded and a final len block.
  const eiJ0 = aesBlock(key, j0);
  const g = ghash.create(h);
  g.update(padTo16(aad));
  g.update(padTo16(ciphertext));
  g.update(lengthBlock(aad.length, ciphertext.length));
  const s = g.digest();

  const tag = new Uint8Array(BLOCK);
  for (let i = 0; i < BLOCK; i += 1) tag[i] = eiJ0[i] ^ s[i];
  return { ciphertext, tag };
}

function padTo16(b: Uint8Array): Uint8Array {
  if (b.length % BLOCK === 0) return b;
  const out = new Uint8Array(Math.ceil(b.length / BLOCK) * BLOCK);
  out.set(b, 0);
  return out;
}

// The GCM length block: bitlen(AAD) ‖ bitlen(C), each a 64-bit big-endian value.
function lengthBlock(aadLen: number, ctLen: number): Uint8Array {
  const out = new Uint8Array(BLOCK);
  const dv = new DataView(out.buffer);
  dv.setUint32(4, (aadLen * 8) >>> 0, false); // high 32 of AAD bitlen assumed 0
  dv.setUint32(12, (ctLen * 8) >>> 0, false);
  return out;
}

export { be32 };
