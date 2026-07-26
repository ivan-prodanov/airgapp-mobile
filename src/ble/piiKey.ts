// piiKey — the vehicle-data subscription's PII crypto, end to end and offline.
//
// Why this exists: on THIS car (HW4-Ryzen) the subscription delivers gated state
// as an empty cleartext field plus an encrypted envelope. Measured, not assumed —
// VDS-M5 caught `2a 00` (drive_state, present and EMPTY) beside
// `5a 51 08 05 …` (encrypted_data, field_number = 5). RESPONSE-19 expected
// DriveState to be cleartext and flagged the choice as MCU2→HW4 divergent; the
// divergence is real, so even live SPEED needs this path.
//
// The scheme (RESPONSE-19 Q1c, PROVEN from the app's own decryptor ke0/e.java):
//
//   1. We generate an RSA-2048 keypair locally and keep it.
//   2. We send the PUBLIC key, as PKCS#1 PEM TEXT, inside the subscription.
//   3. The car mints a symmetric AES key K, wraps it to our public key with
//      RSA-OAEP(SHA-1), and returns the wrapped blob IN-BAND in the push.
//   4. We unwrap K locally with our private key.
//   5. Each gated state is AES-256-GCM under K, with the state selector as AAD.
//
// Every step is local. There is no Tesla-held key and no network anywhere in it —
// which is the whole point of a "PII key": it hides location from Tesla's own
// relay. That makes it a perfect fit for an air-gapped client, and it is why
// this is worth the RSA dependency.

import forge from 'node-forge';
import { gcm } from '@noble/ciphers/aes';

// Same CSPRNG the rest of the BLE crypto uses.
import { randomBytes } from '@noble/hashes/utils';

const PKCS1_PUBLIC_HEADER = '-----BEGIN RSA PUBLIC KEY-----';

// forge speaks "binary strings" — one character per byte. Node's Buffer does
// that conversion in a line, and the first version of this file used it.
//
// ⚠ Buffer DOES NOT EXIST IN HERMES. The unit tests all passed because they run
// under Node, and the very first on-car run died with
// `Property 'Buffer' doesn't exist` before it reached the car at all. See
// bytes.ts's header — the same trap, already documented there, for btoa/atob.
// Nothing in runtime code may use Buffer; piiKey.test.ts enforces that by
// scanning this file.
function bytesToBinaryString(b: Uint8Array): string {
  let s = '';
  // Chunked: String.fromCharCode(...spread) blows the argument limit on large
  // inputs, and a wrapped key is 256 bytes with PEMs larger still.
  const CHUNK = 1024;
  for (let i = 0; i < b.length; i += CHUNK) {
    s += String.fromCharCode(...b.subarray(i, Math.min(i + CHUNK, b.length)));
  }
  return s;
}

function binaryStringToBytes(s: string): Uint8Array {
  const out = new Uint8Array(s.length);
  for (let i = 0; i < s.length; i++) out[i] = s.charCodeAt(i) & 0xff;
  return out;
}

export interface PiiKeypair {
  // PKCS#1 PEM. Private stays on device; public goes to the car.
  privatePem: string;
  publicPkcs1Pem: string;
}

// generatePiiKeypair — RSA-2048, seeded from our own CSPRNG.
//
// forge's default PRNG self-seeds from whatever entropy it can find in the JS
// environment, which on React Native is thin. We hand it the same source the
// rest of our crypto uses instead of trusting that fallback for a long-lived
// key. Synchronous generation blocks for a while (seconds on a phone) — call it
// once and persist, never per subscription.
export function generatePiiKeypair(bits = 2048): PiiKeypair {
  const prng = forge.random.createInstance();
  prng.seedFileSync = (needed: number) =>
    forge.util.createBuffer(bytesToBinaryString(randomBytes(needed))).getBytes(needed);
  // bits is a parameter ONLY because the car will not accept a request large
  // enough to carry a 2048-bit PEM. VDS-M7 measured the wall: it answers a 276B
  // sealed body and goes silent at 372B, i.e. the same 452B wire cap Android
  // applies inbound. A PKCS#1 PEM at 2048 is 434 chars ⇒ 451B sealed ⇒ ~557B
  // framed, so it is dropped without a word. 1024 is ~220 chars ⇒ ~237B sealed,
  // which fits. Whether the CAR accepts a 1024-bit subscriber key is the open
  // question — VDS-M8 asks it. 2048 stays the default; nothing should quietly
  // ship a weaker key.
  const { privateKey, publicKey } = forge.pki.rsa.generateKeyPair({ bits, e: 0x10001, prng });
  return {
    privatePem: forge.pki.privateKeyToPem(privateKey),
    // ⚠ publicKeyToRSAPublicKeyPem, NOT publicKeyToPem. The first emits PKCS#1
    // ("BEGIN RSA PUBLIC KEY"), which is what the car wants; the second emits
    // SPKI ("BEGIN PUBLIC KEY"). They differ by a wrapper and the car rejects
    // the wrong one with no useful diagnostic — a dead subscription.
    publicPkcs1Pem: forge.pki.publicKeyToRSAPublicKeyPem(publicKey),
  };
}

export function isPkcs1PublicPem(pem: string): boolean {
  return pem.trimStart().startsWith(PKCS1_PUBLIC_HEADER);
}

// unwrapPiiKey — open PiiKeyResponse.encrypted_pii_key into the raw AES key K.
//
// RSA/ECB/OAEPWithSHA-1AndMGF1Padding with the default (empty) label. SHA-1 is
// not our choice — it is what the car uses, and OAEP's use of it here is not a
// collision-resistance dependency.
export function unwrapPiiKey(privatePem: string, encryptedPiiKey: Uint8Array): Uint8Array {
  const priv = forge.pki.privateKeyFromPem(privatePem);
  const decrypted = priv.decrypt(
    bytesToBinaryString(encryptedPiiKey),
    'RSA-OAEP',
    { md: forge.md.sha1.create(), mgf1: { md: forge.md.sha1.create() } },
  );
  return binaryStringToBytes(decrypted);
}

// be32 — the AAD. RESPONSE-19: the AAD is the 4-byte BIG-ENDIAN field_number,
// which binds each ciphertext to its state slot so a location blob cannot be
// replayed as a charge blob. Our earlier probe tried a single AAD byte: right
// idea, wrong width, and it therefore failed to decrypt anything.
export function be32(n: number): Uint8Array {
  const out = new Uint8Array(4);
  out[0] = (n >>> 24) & 0xff;
  out[1] = (n >>> 16) & 0xff;
  out[2] = (n >>> 8) & 0xff;
  out[3] = n & 0xff;
  return out;
}

export interface EncryptedStateEnvelope {
  fieldNumber: number;
  ciphertext: Uint8Array;
  // The 28-byte field the proto calls `tag`.
  tag: Uint8Array;
}

// decryptEncryptedState — AES-GCM under K.
//
// The 28 bytes are nonce(12) ‖ gcmTag(16), NONCE FIRST — we guessed the split
// on-car and the RE confirmed both split and order. @noble's gcm expects the
// tag appended to the ciphertext, same convention as the JCE call the app makes.
export function decryptEncryptedState(k: Uint8Array, env: EncryptedStateEnvelope): Uint8Array {
  if (env.tag.length !== 28) {
    throw new Error(`pii envelope: expected a 28-byte nonce||tag, got ${env.tag.length}`);
  }
  const nonce = env.tag.subarray(0, 12);
  const gcmTag = env.tag.subarray(12, 28);
  const sealed = new Uint8Array(env.ciphertext.length + gcmTag.length);
  sealed.set(env.ciphertext, 0);
  sealed.set(gcmTag, env.ciphertext.length);
  return gcm(k, nonce, be32(env.fieldNumber)).decrypt(sealed);
}

// --- persistence -----------------------------------------------------------

// Separate from the device keypair on purpose. That one is a P-256 key the CAR
// has whitelisted and which authenticates every command — rotating or losing it
// means re-enrolling with the key card. This one is an RSA key that only ever
// wraps a PII key; it can be regenerated at will, and conflating them would put
// the enrolment key at risk for no reason.
const PII_KEY_STORAGE_KEY = 'ble.piiKeypair.pkcs1.v1';

export interface PiiKeyStore {
  getItem(key: string): Promise<string | null>;
  setItem(key: string, value: string): Promise<void>;
}

// loadOrCreatePiiKeypair — generate once, then reuse.
//
// Generation is SECONDS of blocking pure-JS bignum work on a phone, so it must
// never sit on a subscription path. It also matters that the key is STABLE: the
// car keeps `mPiiKeyData` per subscriber and rotates against the public key it
// has on file, so a fresh keypair every launch would force a re-wrap each time
// and make key-rotation behaviour impossible to reason about.
export async function loadOrCreatePiiKeypair(store: PiiKeyStore): Promise<PiiKeypair> {
  const saved = await store.getItem(PII_KEY_STORAGE_KEY);
  if (saved) {
    try {
      const parsed = JSON.parse(saved) as PiiKeypair;
      if (parsed?.privatePem && isPkcs1PublicPem(parsed.publicPkcs1Pem ?? '')) return parsed;
      // Fall through and regenerate: a stored SPKI public key would be silently
      // rejected by the car, and that failure is invisible on the wire.
    } catch {
      // corrupt entry — regenerate rather than wedge
    }
  }
  const kp = generatePiiKeypair();
  await store.setItem(PII_KEY_STORAGE_KEY, JSON.stringify(kp));
  return kp;
}

// --- reading the pushes ----------------------------------------------------
//
// A decrypted push is a CarServer.Response. The two things we need out of it —
// the wrapped key and the encrypted envelopes — are read by scanning rather than
// by decoding through the generated message, because both live on repeated
// fields whose siblings we deliberately do not model, and a partial decode there
// is easier to get quietly wrong than a 30-line scanner.

interface Scanned {
  field: number;
  varint?: number;
  bytes?: Uint8Array;
}

function scan(buf: Uint8Array): Scanned[] {
  const out: Scanned[] = [];
  let pos = 0;
  const readVarint = (): number | null => {
    let v = 0;
    let shift = 0;
    while (pos < buf.length) {
      const b = buf[pos++];
      if (shift > 56) return null;
      v += (b & 0x7f) * Math.pow(2, shift);
      if ((b & 0x80) === 0) return v;
      shift += 7;
    }
    return null;
  };
  while (pos < buf.length) {
    const tag = readVarint();
    if (tag === null) break;
    const field = tag >>> 3;
    const wire = tag & 0x07;
    if (wire === 0) {
      const v = readVarint();
      if (v === null) break;
      out.push({ field, varint: v });
    } else if (wire === 2) {
      const len = readVarint();
      if (len === null || pos + len > buf.length) break;
      out.push({ field, bytes: buf.subarray(pos, pos + len) });
      pos += len;
    } else if (wire === 5) pos += 4;
    else if (wire === 1) pos += 8;
    else break;
  }
  return out;
}

const RESPONSE_VEHICLE_DATA = 2;
const VEHICLE_DATA_ENCRYPTED = 11;
const VEHICLE_DATA_PII_KEY_RESPONSE = 900;
const PII_KEY_RESPONSE_ENCRYPTED_KEY = 2;

function vehicleDataOf(responsePlaintext: Uint8Array): Uint8Array | null {
  return scan(responsePlaintext).find((f) => f.field === RESPONSE_VEHICLE_DATA)?.bytes ?? null;
}

// extractWrappedPiiKey — VehicleData field 900 → PiiKeyResponse field 2.
// Returns the first one; the field is repeated but the car mints one key.
export function extractWrappedPiiKey(responsePlaintext: Uint8Array): Uint8Array | null {
  const vd = vehicleDataOf(responsePlaintext);
  if (!vd) return null;
  for (const f of scan(vd)) {
    if (f.field !== VEHICLE_DATA_PII_KEY_RESPONSE || !f.bytes) continue;
    const key = scan(f.bytes).find((x) => x.field === PII_KEY_RESPONSE_ENCRYPTED_KEY)?.bytes;
    if (key && key.length > 0) return key;
  }
  return null;
}

// parsePiiEnvelopes — every VehicleData field 11 in the push.
export function parsePiiEnvelopes(responsePlaintext: Uint8Array): EncryptedStateEnvelope[] {
  const vd = vehicleDataOf(responsePlaintext);
  if (!vd) return [];
  const out: EncryptedStateEnvelope[] = [];
  for (const f of scan(vd)) {
    if (f.field !== VEHICLE_DATA_ENCRYPTED || !f.bytes) continue;
    const parts = scan(f.bytes);
    const fieldNumber = parts.find((x) => x.field === 1)?.varint;
    const ciphertext = parts.find((x) => x.field === 2)?.bytes;
    const tag = parts.find((x) => x.field === 3)?.bytes;
    if (fieldNumber === undefined || !ciphertext || !tag) continue;
    out.push({ fieldNumber, ciphertext, tag });
  }
  return out;
}
