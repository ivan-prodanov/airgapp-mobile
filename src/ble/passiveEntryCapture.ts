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

import { dumpTopLevelFields } from './whitelistPermissions';

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
  const dumped = dumpTopLevelFields(frame);
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

// formatUnsolicitedFrame renders the report for the diagnostics file. The
// CANDIDATE marker is the whole point — it makes the frame we're hunting
// greppable in a log that will otherwise be full of routine closure pushes.
export function formatUnsolicitedFrame(frame: Uint8Array): string[] {
  const r = inspectUnsolicitedFrame(frame);
  return [
    `${r.hasUnknown ? '*** CANDIDATE CHALLENGE *** ' : ''}unsolicited ${r.byteLength}B ` +
      `fields=[${r.fields.join(',')}] (${r.names.join(', ')})`,
    `  raw: ${r.hex}`,
  ];
}
