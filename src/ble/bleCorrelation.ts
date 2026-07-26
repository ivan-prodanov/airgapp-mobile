// bleCorrelation.ts — request/response correlation ("demux") for the
// direct phone→Tesla BLE transport.
//
// Ported from tesla_session.go's Exchange (:189-269). See
// docs/superpowers/plans/tesla-ble-transport-spec.md §6. Rather than
// hand-rolling the Go SDK's raw top-level protobuf field scanner, this
// reuses the existing generated RoutableMessage codec (proto.ts) — we
// already have the full typed message, no need to walk wire bytes by
// hand.
//
// RoutableMessage field names, confirmed against src/ble/proto/gen.d.ts:
//   - top-level: `toDestination`, `fromDestination` (each a `Destination`
//     oneof-shaped object), `uuid`, `requestUuid` (both `Uint8Array`,
//     required — decode always yields at least an empty array).
//   - `Destination.routingAddress` (`Uint8Array | null | undefined`,
//     part of the `domain | routingAddress` oneof).
//
// Correlation rule. The frame's own request_uuid DECIDES when it has one;
// routing_address is only the fallback for frames that carry none:
//
//   frame.requestUuid present  → accept iff it equals want.uuid
//   frame.requestUuid absent   → accept iff to_destination.routing_address
//                                 equals want.routingAddress
//
// The fallback exists because VCSEC GET_STATUS replies (every lock/closure read)
// carry `to_destination.routing_address` and an EMPTY `request_uuid`; a
// uuid-only matcher would silently drop all of them forever.
//
// The spec called routing_address PRIMARY and this file implemented that — which
// was the wedge, because routing_address is per-SESSION, not per-request. See
// frameAnswersRequest for the full failure mode.

import { RoutableMessage, decodeMessage } from './proto';

export interface Correlators {
  routingAddress?: Uint8Array;
  uuid?: Uint8Array;
}

// bytesEqual treats undefined/empty as "absent" at the call sites below;
// here it's a strict byte-for-byte comparison of two concrete arrays.
function bytesEqual(a: Uint8Array, b: Uint8Array): boolean {
  if (a.length !== b.length) return false;
  for (let i = 0; i < a.length; i++) {
    if (a[i] !== b[i]) return false;
  }
  return true;
}

// nonEmpty normalizes a possibly-undefined/possibly-empty byte array to
// "present or not" — protobufjs decodes an absent `bytes` field as an
// empty Uint8Array, which for our purposes is the same as "not set".
function nonEmpty(bytes: Uint8Array | null | undefined): Uint8Array | undefined {
  return bytes && bytes.length > 0 ? bytes : undefined;
}

// outgoingCorrelators reads OUR outgoing request's correlators:
// from_destination.routing_address (primary) and uuid (fallback).
export function outgoingCorrelators(requestBytes: Uint8Array): Correlators {
  const decoded = decodeMessage(RoutableMessage, requestBytes);
  return {
    routingAddress: nonEmpty(decoded.fromDestination?.routingAddress),
    uuid: nonEmpty(decoded.uuid),
  };
}

// frameAnswersRequest reports whether an inbound COMPLETE frame (already
// stripped of the 2-byte length prefix by BleReassembler) answers the
// request that produced `want`. Never throws — a garbage/partial frame
// that fails to decode simply isn't our answer.
export function frameAnswersRequest(frameBytes: Uint8Array, want: Correlators): boolean {
  let decoded: { toDestination?: { routingAddress?: Uint8Array | null } | null; requestUuid?: Uint8Array | null };
  try {
    decoded = decodeMessage(RoutableMessage, frameBytes);
  } catch {
    return false;
  }

  const gotRoutingAddress = nonEmpty(decoded.toDestination?.routingAddress);
  const gotUuid = nonEmpty(decoded.requestUuid);

  // A frame that carries a request_uuid is SELF-IDENTIFYING: it names the
  // request it answers, so it either matches ours or it is not ours. Decide on
  // the uuid alone and never fall through to routing address.
  //
  // ⚠ THIS ORDERING IS THE WEDGE FIX. It used to check routing address FIRST and
  // return true on a match, which meant a mismatched uuid was ignored.
  // routingAddress is minted ONCE PER SESSION (session.ts, at
  // openDirectSession) and reused by every request in it — it identifies the
  // SESSION, never the request. So a LATE reply to request A satisfied request
  // B, B failed on the uuid check downstream, retried, and consumed the next
  // stale reply. Permanently one-behind, until the car went quiet or the app was
  // restarted. Measured on-car 2026-07-26: every exchange timing out for 60-90s
  // while the car was demonstrably still pushing to us.
  if (gotUuid) {
    return !!want.uuid && bytesEqual(want.uuid, gotUuid);
  }

  // No uuid on the frame — fall back to the session's routing address. This is
  // what that matcher exists for: VCSEC GET_STATUS replies (every lock/closure
  // read) carry to_destination.routing_address and an EMPTY request_uuid, and a
  // uuid-only matcher would drop all of them forever.
  if (want.routingAddress && gotRoutingAddress && bytesEqual(want.routingAddress, gotRoutingAddress)) {
    return true;
  }
  return false;
}
