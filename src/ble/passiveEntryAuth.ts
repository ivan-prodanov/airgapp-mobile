// passiveEntryAuth.ts — M1 of passive entry: decode the car's
// AuthenticationRequest and build the signed AuthenticationResponse.
//
// Schema source: docs/superpowers/research/RESPONSE-passive-entry-challenge-protocol.md
// (static RE of Tesla 4.58.0 iOS + Android + MCU2 authd), VALIDATED byte-for-byte
// against our own 2026-07-20 on-car capture — the two were derived independently
// and agree exactly, including 9 real PASSIVE_UNLOCK_EXTERIOR_HANDLE_PULL frames.
//
//   FromVCSECMessage.authenticationRequest = 3
//     AuthenticationRequest { sessionInfo(2) = { token(1) = 20 bytes },
//                             requestedLevel(3) = enum,
//                             reasonsForAuth(4) = packed repeated enum }
//   UnsignedMessage.authenticationResponse = 3
//     AuthenticationResponse { authenticationLevel(1), estimatedDistance(2),
//                              authenticationRejection(3) }
//   ToVCSECMessage.signedMessage = 1
//     SignedMessage { token(1)=EMPTY, protobufMessageAsBytes(2)=ciphertext,
//                     signatureType(3)=AES_GCM_TOKEN(3), signature(4)=tag,
//                     keyId(5)=SHA1(pubkey)[:4], counter(6) }
//
// EVERYTHING IS HAND-ENCODED. Our vendored proto has no AuthenticationResponse
// at all, and its UnsignedMessage lacks the authenticationResponse(3) arm — the
// same gap that forced whitelistPermissions.ts to hand-scan. Regenerating a
// 60k-line gen.js for four small messages is disproportionate.
//
// Pure — no I/O, no transport, no session lookup — so the whole protocol is
// node-testable against the real captured frames. The caller supplies the
// session key/counter and performs the write.

import { dumpTopLevelFields, findSubMessageAt } from './whitelistPermissions';

// --- enums (values verified across iOS, Android and firmware) ---------------

export const AUTH_LEVEL = { NONE: 0, UNLOCK: 1, DRIVE: 2 } as const;

export const AUTH_REJECTION = {
  NONE: 0,
  DEVICE_STATIONARY: 1,
  PASSIVE_DISABLED: 2,
  NO_TOKEN: 3,
  PASSIVE_DISABLED_AUTOMATION: 4,
  DEVICE_NOT_UNLOCKED_ON_WRIST: 5,
} as const;

export const AUTH_REASON_NAMES: Record<number, string> = {
  0: 'NOT_DOCUMENTED',
  1: 'IDENTIFICATION',
  2: 'POWER_ON_VEHICLE_REQUEST',
  3: 'GTW_REQUEST',
  4: 'UI_UNLOCK_PASSIVE_AUTH',
  5: 'PASSIVE_UNLOCK_EXTERIOR_HANDLE_PULL',
  6: 'PASSIVE_UNLOCK_INTERIOR_HANDLE_PULL',
  7: 'PASSIVE_UNLOCK_AUTOPRESENT_DOOR',
  8: 'ENTERED_HIGHER_AUTH_ZONE',
  9: 'WALK_UP_UNLOCK',
  10: 'IMMOBILIZER',
};

// The car's token is exactly 20 bytes on this firmware (q1.java:643, and all 37
// of our captured frames). A different length means we mis-parsed, or the
// firmware changed — either way, don't sign it.
export const AUTH_TOKEN_LENGTH = 20;

const FIELD_ROUTABLE_PAYLOAD = 10;
const FIELD_AUTH_REQUEST = 3;

// --- minimal protobuf writers ----------------------------------------------

function varint(value: number): number[] {
  const out: number[] = [];
  let v = value >>> 0;
  while (v > 0x7f) {
    out.push((v & 0x7f) | 0x80);
    v >>>= 7;
  }
  out.push(v);
  return out;
}

const tag = (field: number, wire: number): number[] => varint((field << 3) | wire);
const lenField = (field: number, bytes: Uint8Array | number[]): number[] => [
  ...tag(field, 2),
  ...varint(bytes.length),
  ...Array.from(bytes),
];
const varintField = (field: number, value: number): number[] => [...tag(field, 0), ...varint(value)];

// --- decode: the car's challenge -------------------------------------------

export interface AuthenticationRequest {
  token: Uint8Array;
  requestedLevel: number;
  reasons: number[];
}

function readVarintAt(b: Uint8Array, p: number): [number | null, number] {
  let r = 0;
  let s = 0;
  while (p < b.length) {
    const x = b[p];
    p += 1;
    r |= (x & 0x7f) << s;
    if ((x & 0x80) === 0) return [r >>> 0, p];
    s += 7;
    if (s > 35) return [null, p];
  }
  return [null, p];
}

// parseAuthenticationRequest pulls the challenge out of a raw unsolicited frame.
// Accepts either a RoutableMessage envelope (what the BLE link delivers) or a
// bare FromVCSECMessage. Returns null when the frame is not a challenge —
// routine vehicleStatus pushes must fall through untouched.
export function parseAuthenticationRequest(frame: Uint8Array): AuthenticationRequest | null {
  const vcsec = findSubMessageAt(frame, FIELD_ROUTABLE_PAYLOAD) ?? frame;
  const req = findSubMessageAt(vcsec, FIELD_AUTH_REQUEST);
  if (!req) return null;

  let token: Uint8Array | null = null;
  let requestedLevel: number = AUTH_LEVEL.NONE;
  const reasons: number[] = [];

  for (const f of dumpFields(req)) {
    if (f.field === 2 && f.wire === 2 && f.bytes) {
      // sessionInfo → AuthenticationRequestToken { token = 1 }
      const inner = findSubMessageAt(f.bytes, 1);
      if (inner) token = inner;
    } else if (f.field === 3 && f.wire === 0) {
      requestedLevel = f.value ?? 0;
    } else if (f.field === 4) {
      // repeated enum — accept packed (the car's encoding) AND unpacked.
      if (f.wire === 0 && f.value !== undefined) reasons.push(f.value);
      else if (f.wire === 2 && f.bytes) {
        let p = 0;
        while (p < f.bytes.length) {
          const [v, np] = readVarintAt(f.bytes, p);
          if (v === null) break;
          reasons.push(v);
          p = np;
        }
      }
    }
  }
  if (!token) return null;
  return { token, requestedLevel, reasons };
}

interface RawField {
  field: number;
  wire: number;
  value?: number;
  bytes?: Uint8Array;
}

function dumpFields(b: Uint8Array): RawField[] {
  const out: RawField[] = [];
  let p = 0;
  while (p < b.length) {
    const [t, np] = readVarintAt(b, p);
    if (t === null) break;
    p = np;
    const field = t >>> 3;
    const wire = t & 0x07;
    if (wire === 2) {
      const [l, lp] = readVarintAt(b, p);
      if (l === null || lp + l > b.length) break;
      out.push({ field, wire, bytes: b.subarray(lp, lp + l) });
      p = lp + l;
    } else if (wire === 0) {
      const [v, vp] = readVarintAt(b, p);
      if (v === null) break;
      out.push({ field, wire, value: v });
      p = vp;
    } else if (wire === 5) {
      p += 4;
    } else if (wire === 1) {
      p += 8;
    } else break;
  }
  return out;
}

export const describeReasons = (reasons: number[]): string =>
  reasons.map((r) => `${AUTH_REASON_NAMES[r] ?? 'unknown'}(${r})`).join(', ');

// --- encode: our answer ------------------------------------------------------

// AuthenticationResponse. The official app sends estimatedDistance = 0 on every
// path (the CAR does all ranging), and the grant is reason-independent — one
// code path answers walk-up, handle-pull and identification alike.
export function encodeAuthenticationResponse(opts: {
  authenticationLevel: number;
  authenticationRejection?: number;
  estimatedDistance?: number;
}): Uint8Array {
  const rejection = opts.authenticationRejection ?? AUTH_REJECTION.NONE;
  const distance = opts.estimatedDistance ?? 0;
  const out: number[] = [
    ...varintField(1, opts.authenticationLevel),
    ...varintField(2, distance),
    ...varintField(3, rejection),
  ];
  return Uint8Array.from(out);
}

// UnsignedMessage { authenticationResponse = 3 } — the plaintext that gets sealed.
export function encodeUnsignedAuthResponse(responseBytes: Uint8Array): Uint8Array {
  return Uint8Array.from(lenField(3, responseBytes));
}

// NOTE: the legacy `SignedMessage{AES_GCM_TOKEN}` encoder (IV=counter) lived here
// and was retired 2026-07-23 along with gcmShortIv.ts — routable is the sole seal
// (RE #9, on-car GRANTed). See passiveEntryResponder.ts.
