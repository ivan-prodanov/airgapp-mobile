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
// Correlation rule (spec §6): routing_address is PRIMARY. VCSEC
// GET_STATUS replies (every lock/closure read) carry
// `to_destination.routing_address` but an EMPTY `request_uuid` — a
// uuid-only matcher silently drops every one of those replies forever.
// Accept iff:
//   (want.routingAddress && frame.toDestination.routingAddress == want.routingAddress)
//   || (want.uuid && frame.requestUuid == want.uuid)

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

  if (want.routingAddress && gotRoutingAddress && bytesEqual(want.routingAddress, gotRoutingAddress)) {
    return true;
  }
  if (want.uuid && gotUuid && bytesEqual(want.uuid, gotUuid)) {
    return true;
  }
  return false;
}
