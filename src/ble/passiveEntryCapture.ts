// passiveEntryCapture.ts — M0 of the passive-entry project: capture every
// car-initiated (unsolicited) VCSEC frame so we can find out whether the car
// ever challenges our key, and what that challenge looks like on the wire.
//
// WHY THIS IS NEEDED. Passive entry is car-initiated: the car ranges nearby
// keys and issues an AuthenticationRequest to whichever whitelisted, locally
// present key it selects (research §1.3). Two things are unknown and neither is
// answerable by reading:
//   1. whether the car selects OUR key at all (the eligibility question the
//      whitelist read could not answer — the BLE reply carries no permissions
//      for ANY key on this firmware, verified on-car 2026-07-20); and
//   2. the challenge's wire format — our vendored proto has NO
//      AuthenticationRequest / AuthenticationResponse / AuthenticationReason.
//
// THE TRAP THIS AVOIDS. useCarLink's push handler calls
// decodeUnsolicitedVcsecStatus() and returns early when it yields null. A
// challenge frame is precisely a frame that does NOT decode as a VehicleStatus,
// so the existing path would drop the thing we are hunting. Capture therefore
// runs BEFORE that filter.
//
// Pure — no imports beyond the shared wire primitives, no I/O — so it is
// node-testable against hand-built frames. The caller owns persistence.

import { dumpTopLevelFields, findSubMessageAt } from './whitelistPermissions';
import { decodeMessage, RoutableMessage } from './proto';

// The frames delivered to the unsolicited handler are RoutableMessage envelopes,
// NOT bare FromVCSECMessage. An earlier version classified the OUTER fields
// (6 = to_destination, 7 = from_destination, 10 = payload) against
// FromVCSECMessage names, so every routine push looked like an unknown message
// and all 36 captured frames were flagged as candidates — useless. Unwrap
// field 10 first, then classify what is actually inside.
const ROUTABLE_PAYLOAD_FIELD = 10;

// FromVCSECMessage submessage field numbers we already understand. Anything
// else arriving unsolicited is a CANDIDATE for the challenge we're looking for.
const KNOWN_SUBMESSAGES: Record<number, string> = {
  1: 'vehicleStatus',
  4: 'commandStatus',
  16: 'whitelistInfo',
  17: 'whitelistEntryInfo',
};

export interface UnsolicitedFrameReport {
  // Top-level field numbers present in the frame.
  fields: number[];
  // Names for the ones we know; 'UNKNOWN(n)' otherwise.
  names: string[];
  // True when the frame contains at least one field we have no proto for —
  // i.e. a candidate AuthenticationRequest. This is the flag to grep for.
  hasUnknown: boolean;
  hex: string;
  byteLength: number;
}

function toHex(b: Uint8Array, max = 256): string {
  const shown = Array.from(b.subarray(0, max))
    .map((x) => x.toString(16).padStart(2, '0'))
    .join(' ');
  return b.length > max ? `${shown} …(+${b.length - max} more)` : shown;
}

// inspectUnsolicitedFrame classifies one car-initiated frame.
export function inspectUnsolicitedFrame(frame: Uint8Array): UnsolicitedFrameReport {
  // Unwrap the RoutableMessage envelope when present; classify the inner
  // FromVCSECMessage. Falls back to the frame itself if there is no field 10,
  // so a bare payload still classifies rather than reporting nothing.
  const inner = findSubMessageAt(frame, ROUTABLE_PAYLOAD_FIELD) ?? frame;
  const dumped = dumpTopLevelFields(inner);
  const fields = dumped.map((f) => f.field);
  const names = fields.map((f) => KNOWN_SUBMESSAGES[f] ?? `UNKNOWN(${f})`);
  return {
    fields,
    names,
    hasUnknown: fields.some((f) => !(f in KNOWN_SUBMESSAGES)),
    hex: toHex(frame),
    byteLength: frame.length,
  };
}

// The car's verdict on a SignedMessage we sent. Values from our own proto
// (VCSEC.SignedMessage_information_E). 6 = the AES-GCM tag failed to verify,
// which is what the first M1 run returned: envelope, keyId, token and counter
// all accepted, crypto refused.
const SIGNED_MESSAGE_INFO: Record<number, string> = {
  0: 'NONE (accepted)',
  1: 'FAULT_UNKNOWN',
  2: 'FAULT_NOT_ON_WHITELIST',
  3: 'FAULT_IV_SMALLER_THAN_EXPECTED',
  4: 'FAULT_INVALID_TOKEN',
  5: 'FAULT_TOKEN_AND_COUNTER_INVALID',
  6: 'FAULT_AES_DECRYPT_AUTH (IV or AAD wrong)',
  7: 'FAULT_ECDSA_INPUT',
  8: 'FAULT_ECDSA_SIGNATURE',
  9: 'FAULT_LOCAL_ENTITY_START',
};

// describeCommandStatus renders the car's answer to OUR signed message. The
// echoed counter is the join key back to the `auth ANSWERED counter=N iv=…`
// line, which is how a verdict gets attributed to the IV variant that caused it.
export function describeCommandStatus(frame: Uint8Array): string | null {
  const inner = findSubMessageAt(frame, ROUTABLE_PAYLOAD_FIELD) ?? frame;
  const status = findSubMessageAt(inner, 4);
  if (!status) return null;
  const signed = findSubMessageAt(status, 2);
  if (!signed) return null;
  let counter: number | null = null;
  let info: number | null = null;
  let p = 0;
  while (p < signed.length) {
    const tag = signed[p];
    const field = tag >>> 3;
    const wire = tag & 0x07;
    p += 1;
    if (wire !== 0) break;
    let v = 0;
    let sh = 0;
    while (p < signed.length) {
      const b = signed[p];
      p += 1;
      v |= (b & 0x7f) << sh;
      if ((b & 0x80) === 0) break;
      sh += 7;
    }
    if (field === 1) counter = v >>> 0;
    else if (field === 2) info = v >>> 0;
  }
  if (counter === null && info === null) return null;
  // proto3 omits zero-valued fields, and SIGNEDMESSAGE_INFORMATION_NONE = 0. So a
  // signedMessageStatus that carries a counter but NO `information` field means
  // NONE — the car ACCEPTED our signed message. (A rejection always carries a
  // non-zero information, e.g. 6 = FAULT_AES_DECRYPT_AUTH.) Reading absent-info as
  // "?" hid the very first on-car GRANT.
  const effInfo = info ?? 0;
  return `CAR VERDICT counter=${counter} → ${SIGNED_MESSAGE_INFO[effInfo] ?? `unknown(${effInfo})`}`;
}

// commandStatusAccepted returns true when the frame is the car's verdict on OUR
// signed message AND it accepted it (information NONE/absent). Used to drive the
// responder's circuit breaker and to detect the passive-entry grant.
export function commandStatusAccepted(frame: Uint8Array): boolean {
  const verdict = describeCommandStatus(frame);
  return verdict != null && verdict.includes('NONE (accepted)');
}

// describeRoutableVerdict — the car's answer to a ROUTABLE auth response, which
// is shaped completely differently from the legacy commandStatus above.
//
// Captured on-car 2026-07-22: after a routable authenticationResponse the car
// replies with a top-level RoutableMessage FROM DOMAIN_VEHICLE_SECURITY, TO our
// routing address, echoing our `requestUuid`, with an EMPTY payload and NO
// signedMessageStatus — i.e. an ack with no fault. A rejection would instead
// carry `signedMessageStatus` = MessageStatus{ operationStatus, signedMessageFault }.
//
// requestUuid is what separates a reply-to-us from the car's broadcast status
// pushes (which carry a payload and no requestUuid). We answer with uuid={0x00}
// so every ack echoes 0x00; correlation to the exact attempt is temporal (one
// answer in flight at a time), not by uuid value.
export function describeRoutableVerdict(frame: Uint8Array): string | null {
  let rm: ReturnType<typeof RoutableMessage.decode>;
  try {
    rm = decodeMessage(RoutableMessage, frame);
  } catch {
    return null;
  }
  const from = rm.fromDestination as { domain?: unknown } | null | undefined;
  // Accept the enum in either numeric (2) or string form, depending on decode.
  const isVcsec = from?.domain === 2 || from?.domain === 'DOMAIN_VEHICLE_SECURITY';
  if (!isVcsec) return null;
  const uuid = rm.requestUuid as Uint8Array | null | undefined;
  if (!uuid || uuid.length === 0) return null; // a status push, not a reply to us

  const st = rm.signedMessageStatus as
    | { operationStatus?: unknown; signedMessageFault?: unknown }
    | null
    | undefined;
  const opErr = st?.operationStatus === 1 || st?.operationStatus === 'OPERATIONSTATUS_ERROR';
  const fault = st?.signedMessageFault;
  const hasFault = fault != null && fault !== 0 && fault !== 'MESSAGEFAULT_ERROR_NONE';
  if (opErr || hasFault) {
    return `CAR VERDICT (routable) → REJECTED opStatus=${String(st?.operationStatus)} fault=${String(fault)}`;
  }
  return 'CAR VERDICT (routable) → NONE (accepted)';
}

// routableVerdictAccepted — true when the frame is the car's ack of OUR routable
// auth response with no fault. Feeds the same circuit breaker as the legacy path.
export function routableVerdictAccepted(frame: Uint8Array): boolean {
  const v = describeRoutableVerdict(frame);
  return v != null && v.includes('NONE (accepted)');
}

// formatUnsolicitedFrame renders the report for the diagnostics file. The
// CANDIDATE marker is the whole point — it makes the frame we're hunting
// greppable in a log that will otherwise be full of routine closure pushes.
export function formatUnsolicitedFrame(frame: Uint8Array): string[] {
  const r = inspectUnsolicitedFrame(frame);
  const verdict = describeCommandStatus(frame);
  if (verdict) return [verdict, `  raw: ${r.hex}`];
  return [
    `${r.hasUnknown ? '*** CANDIDATE CHALLENGE *** ' : ''}unsolicited ${r.byteLength}B ` +
      `fields=[${r.fields.join(',')}] (${r.names.join(', ')})`,
    `  raw: ${r.hex}`,
  ];
}
