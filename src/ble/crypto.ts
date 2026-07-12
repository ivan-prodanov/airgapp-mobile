// crypto.ts — Tesla BLE session crypto, ported to pure-JS @noble/* primitives.
//
// Ported from the browser reference at
// /Users/ivan/Work/airgapp/rpi-webclient/client/crypto.js, which used
// crypto.subtle (WebCrypto). This module is SYNCHRONOUS — noble has no
// opaque CryptoKey concept, so every function here takes/returns raw
// Uint8Arrays directly instead of awaiting crypto.subtle. Callers must NOT
// `await` these functions.
//
// ── Tesla's KDF, exactly as the SDK does it ──
//
//   1. ECDH(my_priv_d, car_eph_pub) → shared X coordinate (32 bytes,
//      big-endian, zero-padded if the integer is shorter than 256
//      bits). WebCrypto's deriveBits with the ECDH algorithm returns
//      exactly this — same wire format the SDK's
//      `elliptic.P256().ScalarMult` produces with FillBytes.
//
//      noble's p256.getSharedSecret(priv, pub) returns a POINT, not just
//      X — by default a 33-byte COMPRESSED point. We must call it with
//      isCompressed=false to get the 65-byte uncompressed 0x04||X||Y, then
//      take bytes [1, 33) as X. Using the compressed form or including the
//      0x04 prefix produces the wrong AES key and silently breaks the
//      session (car will reject with a signature/decrypt fault).
//
//   2. SHA-1 over those 32 bytes → 20 bytes.
//
//   3. First 16 bytes of the SHA-1 digest → AES-128-GCM key.
//
// The SHA-1 here is NOT for collision resistance — it's a fixed-output
// PRG that compresses the shared secret into the AES key. The SDK
// comment is explicit about this: "collision resistance isn't needed."
// We can't change it without breaking interop with the car firmware.

import { p256 } from '@noble/curves/p256';
import { sha1 } from '@noble/hashes/sha1';
import { sha256 } from '@noble/hashes/sha256';
import { hmac } from '@noble/hashes/hmac';
import { randomBytes } from '@noble/hashes/utils';
import { gcm } from '@noble/ciphers/aes';

// importPeerPubkey validates the raw 65-byte SEC1 uncompressed point
// (0x04 || X || Y) that comes back from the car inside a SessionInfo
// message and returns it unchanged (there is no opaque-key concept in
// noble — we just pass the validated bytes straight to getSharedSecret).
export function importPeerPubkey(rawSec1Bytes: Uint8Array): Uint8Array {
  if (rawSec1Bytes.length !== 65 || rawSec1Bytes[0] !== 0x04) {
    throw new Error(
      `expected 65-byte SEC1 uncompressed point (0x04 || X || Y), got ${rawSec1Bytes.length} bytes${
        rawSec1Bytes.length ? ` starting 0x${rawSec1Bytes[0].toString(16)}` : ''
      }`,
    );
  }
  return rawSec1Bytes;
}

// deriveSessionKeyMaterial returns the raw 16-byte AES-GCM key as a
// Uint8Array. Internal building block used by deriveSessionKey + tests
// (which need to compare bytes against a known vector).
//
// myPrivScalar: 32-byte big-endian private scalar (JWK `d`, base64url-
// decoded by the caller). peerPubBytes: 65-byte SEC1 uncompressed point,
// as returned by importPeerPubkey.
export function deriveSessionKeyMaterial(
  myPrivScalar: Uint8Array,
  peerPubBytes: Uint8Array,
): Uint8Array {
  // isCompressed=false → 65-byte 0x04||X||Y. Bytes [1, 33) are X — see
  // the module-level note above; this is the one place this port is
  // easiest to get wrong.
  const point = p256.getSharedSecret(myPrivScalar, peerPubBytes, false);
  const sharedX = point.slice(1, 33);
  const digest = sha1(sharedX);
  return digest.slice(0, 16);
}

// deriveSessionKey returns the raw 16-byte AES-128-GCM session key ready
// to pass straight to gcm(key, nonce, aad). There's no CryptoKey wrapping
// step with noble — callers pass these bytes directly to aesGcmEncrypt /
// aesGcmDecrypt.
//
// Caller responsibility: pass the right peer pubkey. Tesla maintains
// SEPARATE session keys per domain (VCSEC vs Infotainment) — each
// domain's SessionInfo contains its own ephemeral pubkey, so derive
// one key per domain and don't mix them.
export function deriveSessionKey(myPrivScalar: Uint8Array, peerPubBytes: Uint8Array): Uint8Array {
  return deriveSessionKeyMaterial(myPrivScalar, peerPubBytes);
}

// bytesToHex / hexToBytes are crypto-adjacent helpers, kept here so
// callers and tests can render/parse bytes without pulling in another
// dependency.
export function bytesToHex(bytes: Uint8Array): string {
  return Array.from(bytes)
    .map((b) => b.toString(16).padStart(2, '0'))
    .join('');
}
export function hexToBytes(hex: string): Uint8Array {
  const clean = hex.replace(/\s+/g, '');
  const out = new Uint8Array(clean.length / 2);
  for (let i = 0; i < out.length; i++) {
    out[i] = parseInt(clean.substr(i * 2, 2), 16);
  }
  return out;
}

// ── Tesla metadata block ──
//
// Every signed/encrypted message authenticates a sorted list of
// (tag, value) pairs that name the message: signature type, domain,
// recipient (VIN), epoch, expiry, counter. The serialisation is
// strict — tags MUST be ascending, lengths MUST be ≤ 255 bytes — and
// is hashed (SHA-256) to produce the AES-GCM AAD. A MITM that tampers
// with any of these fields breaks the AAD digest and AES-GCM rejects
// the ciphertext on decrypt.
//
// Mirrors authentication/metadata.go. The (tag || length || value)
// framing is verbatim; TAG_END = 0xff appended once at the close.

// Tags — values from signatures.proto (signatures.Tag_*). Kept here
// as a named enum so callsites read like the SDK.
export const TAG = Object.freeze({
  SIGNATURE_TYPE: 0,
  DOMAIN: 1,
  PERSONALIZATION: 2,
  EPOCH: 3,
  EXPIRES_AT: 4,
  COUNTER: 5,
  CHALLENGE: 6,
  FLAGS: 7,
  REQUEST_HASH: 8,
  FAULT: 9,
  END: 255,
});

// SignatureType enum values, also from signatures.proto.
export const SIGNATURE_TYPE = Object.freeze({
  AES_GCM: 0,
  AES_GCM_PERSONALIZED: 5,
  HMAC: 6,
  HMAC_PERSONALIZED: 8,
  AES_GCM_RESPONSE: 9,
});

export const DOMAIN = Object.freeze({
  BROADCAST: 0,
  VEHICLE_SECURITY: 2,
  INFOTAINMENT: 3,
});

// MetadataBlockBuilder accumulates (tag, value) pairs and renders the
// final byte buffer. Stateful so the caller can assemble it
// imperatively; matches the SDK's metadata type. Throws on
// out-of-order tags (a programmer error — would break wire compat
// silently if allowed).
export class MetadataBlockBuilder {
  private parts: Uint8Array[] = [];
  private lastTag = -1;

  add(tag: number, value: Uint8Array | null | undefined): this {
    if (tag < this.lastTag) {
      throw new Error(`metadata tag ${tag} added after ${this.lastTag} (must be ascending)`);
    }
    if (value == null) return this; // nullable — matches SDK
    if (value.length > 255) {
      throw new Error(`metadata value for tag ${tag} is ${value.length} bytes (max 255)`);
    }
    this.lastTag = tag;
    this.parts.push(new Uint8Array([tag, value.length]));
    this.parts.push(value);
    return this;
  }

  addUint32(tag: number, v: number): this {
    const buf = new Uint8Array(4);
    new DataView(buf.buffer).setUint32(0, v >>> 0, false); // big-endian
    return this.add(tag, buf);
  }

  // bytes returns the encoded block WITHOUT the trailing TAG_END.
  // Internal — checksum()/hmac() are what production code calls.
  bytes(): Uint8Array {
    let total = 0;
    for (const p of this.parts) total += p.length;
    const out = new Uint8Array(total);
    let off = 0;
    for (const p of this.parts) {
      out.set(p, off);
      off += p.length;
    }
    return out;
  }

  // checksum returns SHA-256( bytes() || 0xff || trailing ). The
  // trailing arg is the message payload for cases where the SDK
  // appends the to-be-authenticated message after TAG_END (the
  // session-info HMAC path); pass null for the standard AES-GCM
  // AAD case.
  checksum(trailing: Uint8Array | null): Uint8Array {
    return sha256(this.withTrailing(trailing));
  }

  // hmac returns HMAC-SHA256( subkey, bytes() || 0xff || trailing ).
  // Same shape as checksum() but with HMAC instead of plain SHA-256.
  // Used for SessionInfo tag verification — proves the response
  // really came from the car (who's the only other holder of the
  // derived session key).
  hmac(subkeyBytes: Uint8Array, trailing: Uint8Array | null): Uint8Array {
    return hmac(sha256, subkeyBytes, this.withTrailing(trailing));
  }

  private withTrailing(trailing: Uint8Array | null): Uint8Array {
    const head = this.bytes();
    const t = trailing || new Uint8Array(0);
    const total = new Uint8Array(head.length + 1 + t.length);
    total.set(head, 0);
    total[head.length] = TAG.END;
    total.set(t, head.length + 1);
    return total;
  }
}

export interface BuildAesGcmResponseMetadataArgs {
  domain: number;
  verifierName: string | Uint8Array;
  counter?: number;
  flags?: number;
  requestHash: Uint8Array;
  fault?: number;
}

// buildAesGcmResponseMetadata is the response-side analogue of
// buildAesGcmMetadata. The car uses these fields as AAD when it
// encrypts a response; we use the same shape on decrypt.
//
// Field set differs from the command-side metadata:
//   • SIGNATURE_TYPE = AES_GCM_RESPONSE (not _PERSONALIZED)
//   • DOMAIN comes from response.from_destination (car's outbound
//     domain), not request.to_destination
//   • COUNTER + FLAGS as uint32 BE
//   • REQUEST_HASH binds the response to the specific request that
//     triggered it: [SIGNATURE_TYPE_AES_GCM_PERSONALIZED byte] ||
//     request_tag (17 bytes total when the request used AES-GCM
//     PERSONALIZED — the only command-time encryption we use today)
//   • FAULT — the car's MessageFault_E as uint32 (0 = NONE on success)
//
// No EXPIRES_AT, no EPOCH, no SHA-256 trailing. Just the metadata
// block hashed to 32 bytes.
export function buildAesGcmResponseMetadata({
  domain,
  verifierName,
  counter,
  flags,
  requestHash,
  fault,
}: BuildAesGcmResponseMetadataArgs): Uint8Array {
  const m = new MetadataBlockBuilder();
  m.add(TAG.SIGNATURE_TYPE, new Uint8Array([SIGNATURE_TYPE.AES_GCM_RESPONSE]));
  m.add(TAG.DOMAIN, new Uint8Array([domain]));
  m.add(
    TAG.PERSONALIZATION,
    typeof verifierName === 'string' ? new TextEncoder().encode(verifierName) : verifierName,
  );
  m.addUint32(TAG.COUNTER, counter || 0);
  m.addUint32(TAG.FLAGS, flags || 0);
  m.add(TAG.REQUEST_HASH, requestHash);
  m.addUint32(TAG.FAULT, fault || 0);
  return m.checksum(null);
}

// makeRequestHash builds the REQUEST_HASH tag value the car expects:
// the request's signature-type byte followed by the request's tag.
// For our path (only AES-GCM-PERSONALIZED commands today) the prefix
// is byte 5 and the suffix is the 16-byte AES-GCM auth tag of the
// outbound message.
export function makeRequestHash(requestTag: Uint8Array): Uint8Array {
  const out = new Uint8Array(1 + requestTag.length);
  out[0] = SIGNATURE_TYPE.AES_GCM_PERSONALIZED;
  out.set(requestTag, 1);
  return out;
}

export interface BuildAesGcmMetadataArgs {
  domain: number;
  verifierName: string | Uint8Array;
  epoch: Uint8Array;
  expiresAt: number;
  counter: number;
  flags?: number;
}

// buildAesGcmMetadata is the canonical builder for an AES-GCM
// command's metadata. Fields are required by the SDK in this order;
// flags is only added if > 0 (matches the SDK's "for backwards
// compatibility" behaviour).
export function buildAesGcmMetadata({
  domain,
  verifierName,
  epoch,
  expiresAt,
  counter,
  flags,
}: BuildAesGcmMetadataArgs): Uint8Array {
  const m = new MetadataBlockBuilder();
  m.add(TAG.SIGNATURE_TYPE, new Uint8Array([SIGNATURE_TYPE.AES_GCM_PERSONALIZED]));
  m.add(TAG.DOMAIN, new Uint8Array([domain]));
  m.add(
    TAG.PERSONALIZATION,
    typeof verifierName === 'string' ? new TextEncoder().encode(verifierName) : verifierName,
  );
  m.add(TAG.EPOCH, epoch);
  m.addUint32(TAG.EXPIRES_AT, expiresAt);
  m.addUint32(TAG.COUNTER, counter);
  if (flags && flags > 0) m.addUint32(TAG.FLAGS, flags);
  return m.checksum(null);
}

export interface AesGcmSealed {
  nonce: Uint8Array;
  ciphertext: Uint8Array;
  tag: Uint8Array;
}

const GCM_TAG_LENGTH = 16;

// aesGcmEncrypt encrypts plaintext under sessionKey with the given
// AAD digest. Generates a fresh 12-byte nonce per call (the SDK does
// the same with crypto/rand). Returns the parts the SDK's wire
// envelope expects separately: { nonce, ciphertext, tag } — the
// Tesla protocol stores them in distinct protobuf fields rather than
// the typical "ct || tag" concatenation.
export function aesGcmEncrypt(
  sessionKey: Uint8Array,
  plaintext: Uint8Array,
  aadDigest: Uint8Array,
): AesGcmSealed {
  const nonce = randomBytes(12);
  return aesGcmEncryptWithNonce(sessionKey, plaintext, aadDigest, nonce);
}

// aesGcmEncryptWithNonce is the deterministic version for testing —
// caller supplies the nonce. Production code MUST NOT reuse nonces
// under the same key; AES-GCM loses confidentiality and integrity
// catastrophically on nonce reuse.
export function aesGcmEncryptWithNonce(
  sessionKey: Uint8Array,
  plaintext: Uint8Array,
  aadDigest: Uint8Array,
  nonce: Uint8Array,
): AesGcmSealed {
  const sealed = gcm(sessionKey, nonce, aadDigest).encrypt(plaintext);
  // noble returns ct||tag; the wire format wants them split.
  const ctLen = sealed.length - GCM_TAG_LENGTH;
  return {
    nonce,
    ciphertext: sealed.slice(0, ctLen),
    tag: sealed.slice(ctLen),
  };
}

// aesGcmDecrypt reverses the envelope. Throws on tag mismatch (which
// also covers any AAD tampering — the SDK collapses both into a
// single "invalid signature" error). noble throws synchronously on
// GCM tag failure — that's the desired rejection behavior.
export function aesGcmDecrypt(
  sessionKey: Uint8Array,
  nonce: Uint8Array,
  ciphertext: Uint8Array,
  tag: Uint8Array,
  aadDigest: Uint8Array,
): Uint8Array {
  const sealed = new Uint8Array(ciphertext.length + tag.length);
  sealed.set(ciphertext, 0);
  sealed.set(tag, ciphertext.length);
  return gcm(sessionKey, nonce, aadDigest).decrypt(sealed);
}

// hmacSubkey derives a label-specific HMAC key from the raw session
// bytes. SDK: subkey(label) = HMAC-SHA256(sessionKey, label). Used
// for the session-info handshake — the AES-GCM key proper is what
// encrypts commands.
//
// keyBytes is the 16-byte AES-GCM session key (raw Uint8Array).
export function hmacSubkey(keyBytes: Uint8Array, label: string): Uint8Array {
  return hmac(sha256, keyBytes, new TextEncoder().encode(label));
}
