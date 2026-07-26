// VDS-M1 — does the car PUSH vehicle data over our BLE link?
//
// This module is a MEASUREMENT, not a feature. It exists to settle one question
// that no amount of static analysis can, because the binary that would answer it
// (InfotainmentDispatcher) is in no firmware image we hold:
//
//     when a vehicle-data subscription is armed over BLE, does the car's
//     dispatcher actually deliver UNSOLICITED pushes on that link?
//
// Everything else about the mechanism is already settled — see the evidence, for
// AND against, on `VehicleDataSubscription` in proto/car_server.proto. The short
// version: the car implements it transport-agnostically (handle-keyed, no
// transport selection), but the official app deliberately never sends it over
// BLE and 4.58.0 kill-switches it outright. So the prior is "this will not work",
// and the probe is built to make a NEGATIVE result trustworthy and cheap to read.
//
// Design consequences of that goal, all deliberate:
//
//   • It captures EVERY inbound car-initiated frame while armed, not just ones it
//     can decode. A push in an envelope we do not model would otherwise look
//     exactly like silence — the same trap the passive-entry capture was built to
//     escape (see passiveEntryCapture.ts's header).
//   • It records a BASELINE window before subscribing. The car already pushes
//     VCSEC status unprompted, so "frames arrived" proves nothing on its own;
//     only a rate or content CHANGE across the subscribe boundary does.
//   • It always cancels, and asks for a short TTL, so a wedged subscription
//     cannot outlive the probe by more than the TTL.
//
// A clean negative here is a real result: it closes the last open question on the
// biggest-looking parity gap we found, and justifies keeping the per-state poll.

// A self-contained top-level scanner. whitelistPermissions.dumpTopLevelFields
// exists and is close, but it reports only {field,wireType,length} — it SKIPS
// varint values, and the two facts this probe turns on (from_destination.domain
// and flags) are both varints. Reading them needs the value, so scan here rather
// than widen a shared helper for one experiment.
interface ScannedField {
  field: number;
  wireType: number;
  // Set for wire type 0 (varint).
  value?: number;
  // Set for wire type 2 (length-delimited).
  bytes?: Uint8Array;
}

function scanFields(buf: Uint8Array): ScannedField[] {
  const out: ScannedField[] = [];
  let pos = 0;
  const varint = (): number | null => {
    let result = 0;
    let shift = 0;
    while (pos < buf.length) {
      const b = buf[pos++];
      // Beyond 32 bits the arithmetic below stops being exact. Nothing this
      // probe reads is that large, so bail rather than report a wrong number.
      if (shift > 28) return null;
      result += (b & 0x7f) * Math.pow(2, shift);
      if ((b & 0x80) === 0) return result;
      shift += 7;
    }
    return null;
  };
  while (pos < buf.length) {
    const tag = varint();
    if (tag === null) break;
    const field = tag >>> 3;
    const wireType = tag & 0x07;
    if (wireType === 0) {
      const v = varint();
      if (v === null) break;
      out.push({ field, wireType, value: v });
    } else if (wireType === 2) {
      const len = varint();
      if (len === null || pos + len > buf.length) break;
      out.push({ field, wireType, bytes: buf.subarray(pos, pos + len) });
      pos += len;
    } else if (wireType === 5) {
      pos += 4;
      out.push({ field, wireType });
    } else if (wireType === 1) {
      pos += 8;
      out.push({ field, wireType });
    } else {
      break; // groups / unknown — stop rather than misread the rest
    }
  }
  return out;
}

// RoutableMessage field numbers (universal_message.proto).
const RM_FROM_DESTINATION = 7;
const RM_PAYLOAD = 10;
const RM_REQUEST_UUID = 50;
const RM_FLAGS = 52;
// Destination.domain — the arm of the oneof that names an ECU (2 = VCSEC,
// 3 = INFOTAINMENT). A subscription push must come FROM domain 3; a VCSEC status
// push comes from 2. That single byte is the primary discriminator.
const DEST_DOMAIN = 2;

export interface VdsObservation {
  // Milliseconds since the probe armed — the axis the whole report is read on.
  atMs: number;
  byteLen: number;
  // null when the frame carries no from_destination.domain we can read.
  fromDomain: number | null;
  // Present only on a reply to something WE sent. Its absence is what makes a
  // frame a genuine push rather than a late response.
  hasRequestUuid: boolean;
  flags: number | null;
  // Top-level field numbers of the inner payload, so an unmodelled push is
  // still distinguishable from a known one.
  innerFields: number[];
  hex: string;
}

export interface VdsProbeReport {
  lines: string[];
  // The measurement, kept separate from its prose so a test can assert on it.
  baselineFrames: number;
  windowFrames: number;
  domain3Pushes: number;
  verdict: 'PUSHES' | 'NO_PUSHES' | 'INCONCLUSIVE';
}

function toHex(b: Uint8Array, max = 128): string {
  const shown = Array.from(b.subarray(0, max))
    .map((x) => x.toString(16).padStart(2, '0'))
    .join(' ');
  return b.length > max ? `${shown} …(+${b.length - max} more)` : shown;
}

// Reads a varint field's value, or null when absent. Returns null (not a
// fabricated number) when the field is present with the wrong wire type.
function scalarField(fields: ScannedField[], field: number): number | null {
  const f = fields.find((x) => x.field === field);
  return f && typeof f.value === 'number' ? f.value : null;
}

function subMessage(fields: ScannedField[], field: number): Uint8Array | null {
  return fields.find((x) => x.field === field)?.bytes ?? null;
}

// describeVdsFrame turns one raw car-initiated frame into the few facts that
// decide the experiment. It never throws: a frame we cannot parse must still be
// counted, because "arrived but unparseable" and "did not arrive" are the two
// outcomes this probe most needs to keep apart.
export function describeVdsFrame(frame: Uint8Array, atMs: number): VdsObservation {
  let fromDomain: number | null = null;
  let hasRequestUuid = false;
  let flags: number | null = null;
  let innerFields: number[] = [];
  try {
    const top = scanFields(frame);
    const from = subMessage(top, RM_FROM_DESTINATION);
    if (from) fromDomain = scalarField(scanFields(from), DEST_DOMAIN);
    hasRequestUuid = top.some((f) => f.field === RM_REQUEST_UUID);
    flags = scalarField(top, RM_FLAGS);
    const inner = subMessage(top, RM_PAYLOAD);
    if (inner) innerFields = scanFields(inner).map((f) => f.field);
  } catch {
    // fall through with whatever we managed to read
  }
  return { atMs, byteLen: frame.length, fromDomain, hasRequestUuid, flags, innerFields, hex: toHex(frame) };
}

// --- capture state ---------------------------------------------------------
//
// Module-level rather than passed through, because the frames arrive on a path
// (foregroundBleLink.onUnsolicited → useCarLink.handleVcsecPush) that has no
// reason to know this experiment exists. The cost at that call site is one
// boolean test when disarmed.

let armedAt: number | null = null;
let captured: VdsObservation[] = [];

export function armVdsCapture(nowMs: number): void {
  armedAt = nowMs;
  captured = [];
}

export function disarmVdsCapture(): VdsObservation[] {
  armedAt = null;
  const out = captured;
  captured = [];
  return out;
}

export function isVdsCaptureArmed(): boolean {
  return armedAt !== null;
}

// observeVdsFrame — the tap. Call for every car-initiated frame.
export function observeVdsFrame(frame: Uint8Array, nowMs: number): void {
  if (armedAt === null) return;
  // Bounded so a chatty car cannot grow this without limit while armed. If we
  // ever hit the cap the experiment has already answered itself in the
  // affirmative many times over.
  if (captured.length >= 500) return;
  captured.push(describeVdsFrame(frame, nowMs - armedAt));
}

// --- report ----------------------------------------------------------------

// A push is a frame that (a) came from the INFOTAINMENT domain and (b) is not a
// reply to anything we sent. Both halves matter: VCSEC status pushes satisfy (b)
// but come from domain 2, and the subscribe ACK satisfies (a) but not (b).
export function isSubscriptionPush(o: VdsObservation): boolean {
  return o.fromDomain === 3 && !o.hasRequestUuid;
}

export function buildVdsReport(args: {
  observations: VdsObservation[];
  baselineEndMs: number;
  subscribeOutcome: string;
  subscribeResponseHex: string | null;
  windowEndMs: number;
}): VdsProbeReport {
  const { observations, baselineEndMs, subscribeOutcome, subscribeResponseHex, windowEndMs } = args;
  const baseline = observations.filter((o) => o.atMs < baselineEndMs);
  const window = observations.filter((o) => o.atMs >= baselineEndMs);
  const pushes = window.filter(isSubscriptionPush);

  const lines: string[] = [];
  lines.push(`VDS-M1 vehicle-data subscription probe`);
  lines.push(`subscribe outcome: ${subscribeOutcome}`);
  if (subscribeResponseHex) lines.push(`  response: ${subscribeResponseHex}`);
  lines.push(
    `baseline ${Math.round(baselineEndMs / 1000)}s: ${baseline.length} car-initiated frames ` +
      `(${baseline.filter(isSubscriptionPush).length} from domain 3 without request_uuid)`,
  );
  lines.push(
    `window   ${Math.round((windowEndMs - baselineEndMs) / 1000)}s: ${window.length} car-initiated frames ` +
      `(${pushes.length} from domain 3 without request_uuid)`,
  );
  // Print every frame in the window. The counts above are the headline, but a
  // negative result is only trustworthy if the raw frames are there to check it
  // against — that is the lesson from the first inconclusive whitelist probe.
  for (const o of window) {
    lines.push(
      `  +${(o.atMs / 1000).toFixed(1)}s ${o.byteLen}B domain=${o.fromDomain ?? '?'} ` +
        `${o.hasRequestUuid ? 'reply' : 'PUSH'} flags=${o.flags ?? '-'} inner=[${o.innerFields.join(',')}]`,
    );
    if (isSubscriptionPush(o)) lines.push(`    raw: ${o.hex}`);
  }

  let verdict: VdsProbeReport['verdict'];
  if (pushes.length > 0) {
    verdict = 'PUSHES';
    lines.push(
      `VERDICT: THE CAR PUSHES over BLE — ${pushes.length} unsolicited domain-3 frames. ` +
        `Decode the inner fields above before building on this.`,
    );
  } else if (window.length === 0 && baseline.length === 0) {
    // Nothing at all arrived, in either window. That does not measure the
    // subscription — it measures a link with no traffic on it, and reporting it
    // as a negative would be the "uninterpretable negative" this probe exists to
    // avoid. Re-run with the car awake and the direct link up.
    verdict = 'INCONCLUSIVE';
    lines.push(
      `VERDICT: INCONCLUSIVE — no car-initiated frames at all, not even in the baseline. ` +
        `The link was silent, so this says nothing about subscriptions. Re-run with the car awake.`,
    );
  } else {
    verdict = 'NO_PUSHES';
    lines.push(
      `VERDICT: NO PUSHES — the link carried ${window.length} frames in the window but none were ` +
        `unsolicited domain-3. The subscription's BLE arm does not deliver. Keep the per-state poll ` +
        `(which is what the official app does over BLE too).`,
    );
  }
  return { lines, baselineFrames: baseline.length, windowFrames: window.length, domain3Pushes: pushes.length, verdict };
}
