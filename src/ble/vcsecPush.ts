// vcsecPush.ts — decode an UNSOLICITED VCSEC push frame into a VcsecStatus.
//
// The car pushes a VehicleStatus over the BLE notify characteristic whenever a
// closure / lock / presence changes (see
// docs/superpowers/research/tesla-live-status-push-FINDINGS.md). Unlike a
// solicited GET_STATUS reply — which is AES-GCM sealed and AAD-bound to OUR
// request's GCM tag (session.ts) — a push has no request to bind to, so it
// arrives as a PLAINTEXT FromVCSECMessage in `protobufMessageAsBytes` (session.ts
// literally calls these "unsolicited car broadcasts"). This decodes that
// plaintext into the exact same VcsecStatus shape the poll produces, so the push
// and the poll can feed ONE apply path (vcsecStatusToPatch → applyTelemetry).
//
// PURE — proto + telemetry only, no react-native. Returns null for anything that
// is not a readable VCSEC status push (not a RoutableMessage, wrong domain, a
// solicited reply that echoes our uuid, an encrypted payload, or a non-status
// beacon) so the caller can safely hand it EVERY frame the transport discards.

import { RoutableMessage, FromVCSECMessage, decodeMessage } from './proto';
import { parseVcsecStatus, type VcsecStatus } from './telemetry';

// VCSEC = domain 2 (mirrors session.ts's DOMAIN_VEHICLE_SECURITY without the
// import cycle — session.ts pulls in crypto/RN-adjacent deps we don't want here).
const DOMAIN_VEHICLE_SECURITY = 2;

// unsolicitedVcsecPayload — the PLAINTEXT FromVCSECMessage bytes of an unsolicited
// VCSEC push, or null if the frame is not one (not a RoutableMessage, wrong
// domain, a solicited reply that echoes our uuid, or a sealed payload).
function unsolicitedVcsecPayload(frameBytes: Uint8Array): Uint8Array | null {
  let msg: {
    fromDestination?: { domain?: number | null } | null;
    requestUuid?: Uint8Array | null;
    protobufMessageAsBytes?: Uint8Array | null;
    signatureData?: { AES_GCM_ResponseData?: unknown } | null;
  };
  try {
    msg = decodeMessage(RoutableMessage, frameBytes) as typeof msg;
  } catch {
    return null; // not a RoutableMessage at all
  }
  if (msg.fromDestination?.domain !== DOMAIN_VEHICLE_SECURITY) return null;
  if (msg.requestUuid && msg.requestUuid.length > 0) return null; // solicited reply
  if (msg.signatureData?.AES_GCM_ResponseData) return null; // sealed — not a push
  const payload = msg.protobufMessageAsBytes;
  if (!payload || payload.length === 0) return null;
  return payload;
}

export function decodeUnsolicitedVcsecStatus(frameBytes: Uint8Array): VcsecStatus | null {
  const payload = unsolicitedVcsecPayload(frameBytes);
  if (!payload) return null;

  let fromVcsec: { vehicleStatus?: unknown };
  try {
    fromVcsec = decodeMessage(FromVCSECMessage, payload) as { vehicleStatus?: unknown };
  } catch {
    return null;
  }
  // A push with no vehicleStatus (e.g. a presence/keepalive beacon) carries no
  // state for us — skip it rather than emit an empty patch.
  if (fromVcsec.vehicleStatus == null) return null;

  return parseVcsecStatus(fromVcsec.vehicleStatus);
}

// --- CPD (Child Presence Detection) warning over BLE -------------------------
//
// The car pushes a CPDMessage over the SAME unsolicited VCSEC channel when it
// detects a child left in the cabin. Wire format (HW4 decompile, proven):
//   FromVCSECMessage.CPDMessage  = field 55 (len-delimited submessage)
//     CPDMessage.CPDNotification = field 1  (varint enum: 0=NONE, 1=INITIAL, 2=ESCALATED)
// Our vendored proto doesn't model field 55, so scan the plaintext by hand.

// readVarint → [value, nextOffset]. Values here are small (tags/lengths/enum).
function readVarint(b: Uint8Array, pos: number): [number, number] {
  let result = 0;
  let shift = 0;
  let p = pos;
  while (p < b.length) {
    const byte = b[p++];
    result += (byte & 0x7f) * 2 ** shift;
    if ((byte & 0x80) === 0) return [result, p];
    shift += 7;
  }
  return [result, p]; // truncated
}

// scanField walks top-level protobuf fields of `b` and returns the first field
// == wantField as its sub-bytes (wire 2) or varint value (wire 0); null if
// absent/malformed.
function scanField(b: Uint8Array, wantField: number, wantWire: 0 | 2): number | Uint8Array | null {
  let p = 0;
  while (p < b.length) {
    const [tag, np] = readVarint(b, p);
    p = np;
    const field = tag >>> 3;
    const wire = tag & 7;
    if (wire === 0) {
      const [v, vp] = readVarint(b, p);
      p = vp;
      if (field === wantField && wantWire === 0) return v;
    } else if (wire === 2) {
      const [len, lp] = readVarint(b, p);
      p = lp;
      if (field === wantField && wantWire === 2) return b.subarray(p, p + len);
      p += len;
    } else if (wire === 5) {
      p += 4;
    } else if (wire === 1) {
      p += 8;
    } else {
      return null; // groups / unknown wire — bail
    }
  }
  return null;
}

// decodeCpdWarning — the CPD level (0=none, 1=initial, 2=escalated) from an
// unsolicited VCSEC push; 0 when the frame carries no CPD warning (or isn't a push).
export function decodeCpdWarning(frameBytes: Uint8Array): number {
  const payload = unsolicitedVcsecPayload(frameBytes);
  if (!payload) return 0;
  const cpd = scanField(payload, 55, 2); // CPDMessage
  if (!(cpd instanceof Uint8Array)) return 0;
  const level = scanField(cpd, 1, 0); // CPDNotification enum
  return typeof level === 'number' ? level : 0;
}
