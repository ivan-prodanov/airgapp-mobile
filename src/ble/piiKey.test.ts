import test from 'node:test';
import assert from 'node:assert/strict';
import forge from 'node-forge';
import { gcm } from '@noble/ciphers/aes';

import {
  extractWrappedPiiKey,
  parsePiiEnvelopes,
  generatePiiKeypair,
  isPkcs1PublicPem,
  unwrapPiiKey,
  be32,
  decryptEncryptedState,
} from './piiKey';

// One keypair for the whole file — RSA-2048 generation is seconds, not ms.
const KP = generatePiiKeypair();

test('the public key is PKCS#1, not SPKI — the car rejects the wrong one silently', () => {
  assert.ok(isPkcs1PublicPem(KP.publicPkcs1Pem));
  assert.match(KP.publicPkcs1Pem, /^-----BEGIN RSA PUBLIC KEY-----/);
  // The easy wrong turn: forge's publicKeyToPem emits SPKI. If we ever swapped
  // the call, THIS is the assertion that catches it rather than a dead
  // subscription with no diagnostic.
  const spki = forge.pki.publicKeyToPem(forge.pki.publicKeyFromPem(KP.publicPkcs1Pem));
  assert.match(spki, /^-----BEGIN PUBLIC KEY-----/);
  assert.equal(isPkcs1PublicPem(spki), false);
});

test('the keypair is RSA-2048, so a wrapped key will be 256 bytes on the wire', () => {
  const pub = forge.pki.publicKeyFromPem(KP.publicPkcs1Pem);
  assert.equal(pub.n.bitLength(), 2048);
  // RESPONSE-19 predicts encrypted_pii_key = 256 B. Verify our own side agrees,
  // so an unexpected length on-car means the CAR differs, not us.
  const wrapped = pub.encrypt('x'.repeat(32), 'RSA-OAEP', {
    md: forge.md.sha1.create(),
    mgf1: { md: forge.md.sha1.create() },
  });
  assert.equal(wrapped.length, 256);
});

test('unwrapPiiKey opens exactly what an RSA-OAEP(SHA-1) wrap produced', () => {
  // Simulate the car: wrap a random AES-256 key to our public key with the exact
  // transform ke0/e.java uses.
  const k = Uint8Array.from({ length: 32 }, (_, i) => (i * 7 + 3) & 0xff);
  const pub = forge.pki.publicKeyFromPem(KP.publicPkcs1Pem);
  const wrapped = pub.encrypt(Buffer.from(k).toString('binary'), 'RSA-OAEP', {
    md: forge.md.sha1.create(),
    mgf1: { md: forge.md.sha1.create() },
  });
  const got = unwrapPiiKey(KP.privatePem, Uint8Array.from(Buffer.from(wrapped, 'binary')));
  assert.deepEqual(Array.from(got), Array.from(k), 'unwrapped key must match byte for byte');
});

test('be32 is BIG-endian — the width our earlier probe got wrong', () => {
  assert.deepEqual(Array.from(be32(8)), [0, 0, 0, 8]);
  assert.deepEqual(Array.from(be32(5)), [0, 0, 0, 5]);
  assert.deepEqual(Array.from(be32(6072)), [0, 0, 0x17, 0xb8]);
  // The probe used a single byte [8]. Same value, wrong length, no decrypt.
  assert.notDeepEqual(Array.from(be32(8)), [8]);
});

// Build an envelope the way the car does, so the test exercises OUR decrypt
// against an INDEPENDENT encrypt rather than round-tripping one function.
const sealEnvelope = (k: Uint8Array, fieldNumber: number, plaintext: Uint8Array) => {
  const nonce = Uint8Array.from({ length: 12 }, (_, i) => i + 1);
  const sealed = gcm(k, nonce, be32(fieldNumber)).encrypt(plaintext);
  const ciphertext = sealed.subarray(0, sealed.length - 16);
  const gcmTag = sealed.subarray(sealed.length - 16);
  const tag = new Uint8Array(28);
  tag.set(nonce, 0);
  tag.set(gcmTag, 12);
  return { fieldNumber, ciphertext, tag };
};

test('decryptEncryptedState opens a car-shaped envelope (nonce first, be32 AAD)', () => {
  const k = Uint8Array.from({ length: 32 }, (_, i) => i);
  const plaintext = Uint8Array.from([0x08, 0x01, 0x35, 0x00, 0x00, 0x20, 0x41]);
  const env = sealEnvelope(k, 5, plaintext);
  assert.equal(env.tag.length, 28, 'the car sends 28 bytes: nonce(12) || gcmTag(16)');
  assert.deepEqual(Array.from(decryptEncryptedState(k, env)), Array.from(plaintext));
});

test('the AAD binds a state to its slot — a drive blob cannot be replayed as location', () => {
  // This is the property the be32(field_number) AAD exists to give. Worth an
  // explicit test: if we ever passed the wrong selector, decryption would fail
  // and look like "wrong key" instead of "wrong slot".
  const k = Uint8Array.from({ length: 32 }, (_, i) => i);
  const env = sealEnvelope(k, 5, Uint8Array.from([1, 2, 3]));
  assert.throws(() => decryptEncryptedState(k, { ...env, fieldNumber: 8 }));
});

test('a wrong K fails closed rather than returning garbage', () => {
  const k = Uint8Array.from({ length: 32 }, (_, i) => i);
  const wrong = Uint8Array.from({ length: 32 }, (_, i) => i + 1);
  const env = sealEnvelope(k, 5, Uint8Array.from([1, 2, 3]));
  assert.throws(() => decryptEncryptedState(wrong, env));
});

test('a malformed tag length is rejected with a readable error, not a crash', () => {
  const k = Uint8Array.from({ length: 32 }, (_, i) => i);
  const env = sealEnvelope(k, 5, Uint8Array.from([1, 2, 3]));
  assert.throws(
    () => decryptEncryptedState(k, { ...env, tag: env.tag.subarray(0, 16) }),
    /28-byte/,
  );
});

test('end to end: car wraps K, we unwrap it, and it opens the envelope', () => {
  // The whole Q1c recipe in one test — this is the thing that has to work on-car.
  const k = Uint8Array.from({ length: 32 }, (_, i) => (i * 11) & 0xff);
  const pub = forge.pki.publicKeyFromPem(KP.publicPkcs1Pem);
  const wrapped = Uint8Array.from(
    Buffer.from(
      pub.encrypt(Buffer.from(k).toString('binary'), 'RSA-OAEP', {
        md: forge.md.sha1.create(),
        mgf1: { md: forge.md.sha1.create() },
      }),
      'binary',
    ),
  );
  const driveStateBytes = Uint8Array.from([0x08, 0x01, 0x6a, 0x04, 0x00, 0x00, 0x20, 0x41]);
  const env = sealEnvelope(k, 5, driveStateBytes);

  const unwrapped = unwrapPiiKey(KP.privatePem, wrapped);
  assert.deepEqual(Array.from(decryptEncryptedState(unwrapped, env)), Array.from(driveStateBytes));
});

// --- reading a real push ---------------------------------------------------

// The EXACT plaintext VDS-M5 captured from the car, byte for byte:
//   12 55        Response field 2 (vehicleData), len 85
//     2a 00      field 5 = drive_state, PRESENT AND EMPTY
//     5a 51      field 11 = encrypted_data, len 81
//       08 05      field_number = 5
//       12 2f      ciphertext, 47 bytes
//       1a 1c      tag, 28 bytes
const REAL_PUSH = Uint8Array.from(
  Buffer.from(
    // header
    '12552a005a510805122f' +
      // ciphertext, 47 bytes (0x2f)
      '58b76ad721a1ac7d7ce7a3ff2fe483da0f072f1afb8cea19af3f193737b061ab8409d14126409d76ddd28157e05e24' +
      // tag prefix + 28 bytes
      '1a1c' +
      'cd359e4da600c3149a4ef95618cf18ba4c13887d3c3e63468869cd71',
    'hex',
  ),
);

test('parsePiiEnvelopes reads the envelope out of a REAL captured push', () => {
  const envs = parsePiiEnvelopes(REAL_PUSH);
  assert.equal(envs.length, 1);
  assert.equal(envs[0].fieldNumber, 5, 'drive_state');
  assert.equal(envs[0].ciphertext.length, 47);
  assert.equal(envs[0].tag.length, 28, 'nonce(12) || gcmTag(16)');
});

test('a push with no envelopes and no wrapped key yields empty, not a throw', () => {
  // The shape every pre-PII push had: vehicleData with an empty drive_state.
  const bare = Uint8Array.from([0x12, 0x02, 0x2a, 0x00]);
  assert.deepEqual(parsePiiEnvelopes(bare), []);
  assert.equal(extractWrappedPiiKey(bare), null);
  assert.deepEqual(parsePiiEnvelopes(Uint8Array.from([])), []);
});

test('extractWrappedPiiKey reads VehicleData field 900 -> PiiKeyResponse field 2', () => {
  // Field 900 is a 2-byte tag (0xA2 0x38), which is exactly the kind of thing a
  // hand-rolled scanner gets wrong — so build one and read it back.
  const wrapped = Uint8Array.from({ length: 256 }, (_, i) => i & 0xff);
  // field 2, len 256 -> varint 80 02 (NOT 81 02; 256 needs the exact varint)
  const piiKeyResponse = Uint8Array.from([0x12, 0x80, 0x02, ...wrapped]);
  // field 900 -> tag varint a2 38, then len 259 -> varint 83 02
  const vehicleData = Uint8Array.from([0xa2, 0x38, 0x83, 0x02, ...piiKeyResponse]);
  const response = Uint8Array.from([0x12, ...encodeLen(vehicleData.length), ...vehicleData]);
  const got = extractWrappedPiiKey(response);
  assert.ok(got, 'must find the wrapped key');
  assert.equal(got.length, 256, 'RSA-2048 wrap');
  assert.deepEqual(Array.from(got.subarray(0, 4)), [0, 1, 2, 3]);
});

function encodeLen(n: number): number[] {
  const out: number[] = [];
  let v = n;
  do {
    let b = v & 0x7f;
    v >>>= 7;
    if (v > 0) b |= 0x80;
    out.push(b);
  } while (v > 0);
  return out;
}
