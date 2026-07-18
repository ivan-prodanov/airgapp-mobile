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

export function decodeUnsolicitedVcsecStatus(frameBytes: Uint8Array): VcsecStatus | null {
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

  // From the VCSEC domain only.
  if (msg.fromDestination?.domain !== DOMAIN_VEHICLE_SECURITY) return null;
  // UNSOLICITED: a solicited reply echoes our request_uuid; a push carries none.
  if (msg.requestUuid && msg.requestUuid.length > 0) return null;
  // A push is plaintext. A sealed payload is AAD-bound to a request we never sent
  // — we can't (and shouldn't) decrypt it here; that's the solicited-read path.
  if (msg.signatureData?.AES_GCM_ResponseData) return null;

  const payload = msg.protobufMessageAsBytes;
  if (!payload || payload.length === 0) return null;

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
