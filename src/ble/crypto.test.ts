import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import path from 'node:path';

import { p256 } from '@noble/curves/p256';
import { sha1 } from '@noble/hashes/sha1';

import {
  bytesToHex,
  hexToBytes,
  importPeerPubkey,
  deriveSessionKeyMaterial,
  aesGcmEncryptWithNonce,
  aesGcmDecrypt,
  buildAesGcmMetadata,
  hmacSubkey,
  MetadataBlockBuilder,
  TAG,
  SIGNATURE_TYPE,
  DOMAIN,
} from './crypto';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const fixtures = JSON.parse(
  readFileSync(path.join(__dirname, '__fixtures__/goVectors.json'), 'utf8'),
);

// base64url (no padding, URL-safe alphabet) → bytes, matching the encoding
// used by the JWK `d` field in the fixtures.
function base64UrlToBytes(b64url: string): Uint8Array {
  const b64 = b64url.replace(/-/g, '+').replace(/_/g, '/');
  const padded = b64 + '='.repeat((4 - (b64.length % 4)) % 4);
  return new Uint8Array(Buffer.from(padded, 'base64'));
}

test('ECDH shared X coordinate matches the Go-verified vector', () => {
  // Computed directly with noble (not via crypto.ts) so this checks the
  // module's underlying assumption, not just that crypto.ts agrees with
  // itself. isCompressed=false → 65-byte 0x04||X||Y; X is bytes [1,33).
  const privScalar = base64UrlToBytes(fixtures.myPrivD_b64url);
  const peerPub = hexToBytes(fixtures.phonePubkeyHex);
  const point = p256.getSharedSecret(privScalar, peerPub, false);
  assert.equal(point.length, 65);
  assert.equal(point[0], 0x04);
  const sharedX = point.slice(1, 33);
  assert.equal(bytesToHex(sharedX), fixtures.expectedSharedSecretHex);
});

test('deriveSessionKeyMaterial == sha1(sharedX).slice(0, 16)', () => {
  const privScalar = base64UrlToBytes(fixtures.myPrivD_b64url);
  const peerPub = importPeerPubkey(hexToBytes(fixtures.phonePubkeyHex));
  const key = deriveSessionKeyMaterial(privScalar, peerPub);

  const expectedShared = hexToBytes(fixtures.expectedSharedSecretHex);
  const expectedKey = sha1(expectedShared).slice(0, 16);

  assert.equal(key.length, 16);
  assert.equal(bytesToHex(key), bytesToHex(expectedKey));
});

test('importPeerPubkey rejects non-65-byte / non-0x04 input', () => {
  assert.throws(() => importPeerPubkey(new Uint8Array(64)));
  assert.throws(() => importPeerPubkey(new Uint8Array(0)));
  const bad = hexToBytes(fixtures.phonePubkeyHex).slice();
  bad[0] = 0x03;
  assert.throws(() => importPeerPubkey(bad));
});

test('importPeerPubkey accepts a valid 65-byte SEC1 point', () => {
  const pub = importPeerPubkey(hexToBytes(fixtures.phonePubkeyHex));
  assert.equal(pub.length, 65);
  assert.equal(pub[0], 0x04);
});

test('aesGcmEncryptWithNonce matches Go-verified ciphertext + tag', () => {
  const key = hexToBytes(fixtures.sessionKeyHex);
  const nonce = hexToBytes(fixtures.testNonceHex);
  const plaintext = hexToBytes(fixtures.testPlainHex);
  const aad = hexToBytes(fixtures.metaExpectedAadHex);
  const { ciphertext, tag } = aesGcmEncryptWithNonce(key, plaintext, aad, nonce);
  assert.equal(bytesToHex(ciphertext), fixtures.expectedCtHex);
  assert.equal(bytesToHex(tag), fixtures.expectedTagHex);
});

test('aesGcmDecrypt round-trips and rejects tampered AAD', () => {
  const key = hexToBytes(fixtures.sessionKeyHex);
  const nonce = hexToBytes(fixtures.testNonceHex);
  const ciphertext = hexToBytes(fixtures.expectedCtHex);
  const tag = hexToBytes(fixtures.expectedTagHex);
  const aad = hexToBytes(fixtures.metaExpectedAadHex);

  const plaintext = aesGcmDecrypt(key, nonce, ciphertext, tag, aad);
  assert.equal(bytesToHex(plaintext), fixtures.testPlainHex);

  const tamperedAad = aad.slice();
  tamperedAad[0] ^= 0xff;
  assert.throws(() => aesGcmDecrypt(key, nonce, ciphertext, tag, tamperedAad));
});

test('buildAesGcmMetadata bytes + checksum match the Go-verified metadata vector', () => {
  const inputs = fixtures.metadataInputs;
  assert.equal(inputs.signatureType, 'AES_GCM_PERSONALIZED');
  assert.equal(inputs.domain, 'INFOTAINMENT');

  // Reconstruct the same MetadataBlockBuilder sequence buildAesGcmMetadata
  // uses (flags omitted since inputs.flags === 0, per the fixture's note)
  // so we can assert on the intermediate bytes(), not just the final
  // checksum digest that buildAesGcmMetadata returns.
  const m = new MetadataBlockBuilder();
  m.add(TAG.SIGNATURE_TYPE, new Uint8Array([SIGNATURE_TYPE.AES_GCM_PERSONALIZED]));
  m.add(TAG.DOMAIN, new Uint8Array([DOMAIN[inputs.domain as keyof typeof DOMAIN]]));
  m.add(TAG.PERSONALIZATION, Buffer.from(inputs.verifierName, 'utf8'));
  m.add(TAG.EPOCH, hexToBytes(inputs.epochHex));
  m.addUint32(TAG.EXPIRES_AT, inputs.expiresAt);
  m.addUint32(TAG.COUNTER, inputs.counter);
  // flags === 0 → not added, matching buildAesGcmMetadata's `if (flags > 0)`.

  const head = m.bytes();
  const total = new Uint8Array(head.length + 1);
  total.set(head, 0);
  total[head.length] = TAG.END;
  assert.equal(bytesToHex(total), fixtures.metaExpectedBytesHex);

  const aad = buildAesGcmMetadata({
    domain: DOMAIN[inputs.domain as keyof typeof DOMAIN],
    verifierName: inputs.verifierName,
    epoch: hexToBytes(inputs.epochHex),
    expiresAt: inputs.expiresAt,
    counter: inputs.counter,
    flags: inputs.flags,
  });
  assert.equal(bytesToHex(aad), fixtures.metaExpectedAadHex);
});

test('hmacSubkey("session info") matches the Go-verified subkey vector', () => {
  const key = hexToBytes(fixtures.sessionKeyHex);
  const subkey = hmacSubkey(key, 'session info');
  assert.equal(bytesToHex(subkey), fixtures.expectedSubkeySessionInfoHex);
});
