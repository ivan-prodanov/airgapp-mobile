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
//
// ⚠ This is field 1, NOT 2. The first run of this probe had it as 2 —
// `routing_address`, the OTHER arm of the same oneof — which is length-delimited,
// so scalarField correctly refused to read it as a number and every frame came
// back `domain=?`. The probe then dutifully reported NO_PUSHES on nine frames it
// simply could not classify. Read the oneof, not the neighbour.
const DEST_DOMAIN = 1;

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

// A push is a frame from the INFOTAINMENT domain arriving on the unsolicited path.
//
// The first version of this ALSO required `!hasRequestUuid`, to exclude the
// subscribe ACK. That was wrong twice over:
//   1. RESPONSE-15 says the 16-byte request_uuid IS the subscription's
//      CORRELATION TAG — so pushes are expected to echo it. The predicate
//      excluded precisely the frames it was hunting.
//   2. The exclusion was not needed anyway: the ACK is consumed by the gateway's
//      own correlator inside exchange(), so it never reaches the unsolicited path.
// Both halves of that mistake pointed the same way, which is how nine 5-second
// frames got reported as "no pushes".
export function isSubscriptionPush(o: VdsObservation): boolean {
  return o.fromDomain === 3;
}

// medianIntervalMs — the decisive statistic. If the gap between pushes tracks the
// max_update_rate_ms WE chose, the frames are answering our subscription and
// nothing else: no other timer in this app or on this link has any reason to
// follow a parameter we picked at random. Median, not mean, so one late frame
// (BLE retransmit, app hiccup) cannot drag the answer.
export function medianIntervalMs(observations: VdsObservation[]): number | null {
  if (observations.length < 2) return null;
  const sorted = [...observations].sort((a, b) => a.atMs - b.atMs);
  const gaps: number[] = [];
  for (let i = 1; i < sorted.length; i++) gaps.push(sorted[i].atMs - sorted[i - 1].atMs);
  gaps.sort((a, b) => a - b);
  const mid = Math.floor(gaps.length / 2);
  return gaps.length % 2 ? gaps[mid] : Math.round((gaps[mid - 1] + gaps[mid]) / 2);
}

// Does an observed cadence match a requested rate? Deliberately loose (±40%):
// the car rate-limits, it does not run a metronome, and BLE adds jitter. The
// test that matters is whether cadence CHANGES with the parameter, not whether
// it hits the number exactly.
export function cadenceMatches(medianMs: number | null, requestedMs: number): boolean {
  if (medianMs === null) return false;
  return medianMs >= requestedMs * 0.6 && medianMs <= requestedMs * 1.4;
}

// A probe run is now a BASELINE plus N subscription windows at DIFFERENT
// requested rates. The rate sweep is the whole point: frame counts alone cannot
// separate "the car answered our subscription" from "the car happened to be
// chatty", but a cadence that TRACKS a parameter we chose can only come from the
// subscription. Run 1 produced nine frames at a clean 5.0s while asking for
// 5000ms, which is suggestive — and suggestive is not the same as measured.
export interface VdsWindow {
  label: string;
  startMs: number;
  endMs: number;
  requestedRateMs: number;
  subscribeOutcome: string;
  subscribeResponseHex: string | null;
}

export function buildVdsReport(args: {
  observations: VdsObservation[];
  baselineEndMs: number;
  windows: VdsWindow[];
}): VdsProbeReport {
  const { observations, baselineEndMs, windows } = args;
  const baseline = observations.filter((o) => o.atMs < baselineEndMs);

  const lines: string[] = [];
  lines.push(`VDS-M1 vehicle-data subscription probe (rate sweep)`);
  lines.push(
    `baseline ${(baselineEndMs / 1000).toFixed(0)}s, nothing subscribed: ${baseline.length} car-initiated ` +
      `frames (${baseline.filter(isSubscriptionPush).length} from domain 3)`,
  );

  let totalPushes = 0;
  let tracked = 0;
  let measurable = 0;
  for (const w of windows) {
    const inWin = observations.filter((o) => o.atMs >= w.startMs && o.atMs < w.endMs);
    const pushes = inWin.filter(isSubscriptionPush);
    totalPushes += pushes.length;
    const median = medianIntervalMs(pushes);
    const matches = cadenceMatches(median, w.requestedRateMs);
    if (median !== null) {
      measurable++;
      if (matches) tracked++;
    }
    lines.push('');
    lines.push(
      `window "${w.label}" — requested rate ${w.requestedRateMs}ms, ` +
        `${((w.endMs - w.startMs) / 1000).toFixed(0)}s long`,
    );
    lines.push(`  subscribe outcome: ${w.subscribeOutcome}`);
    if (w.subscribeResponseHex) lines.push(`  subscribe response: ${w.subscribeResponseHex}`);
    lines.push(
      `  ${inWin.length} car-initiated frames, ${pushes.length} from domain 3; ` +
        `median gap ${median === null ? 'n/a' : `${median}ms`} ` +
        `→ ${median === null ? 'not measurable' : matches ? 'TRACKS the requested rate' : 'does NOT track'}`,
    );
    // Raw hex for EVERY frame, unconditionally. Run 1 printed it only for frames
    // that passed the (broken) push predicate, so the nine most interesting
    // frames of the run were logged as one-line summaries with no bytes behind
    // them — nothing left to re-examine once the predicate turned out wrong.
    // Never gate the evidence on the classification being tested.
    for (const o of inWin) {
      lines.push(
        `  +${(o.atMs / 1000).toFixed(1)}s ${o.byteLen}B domain=${o.fromDomain ?? '?'} ` +
          `uuid=${o.hasRequestUuid ? 'yes' : 'no'} flags=${o.flags ?? '-'}`,
      );
      lines.push(`    raw: ${o.hex}`);
    }
  }

  let verdict: VdsProbeReport['verdict'];
  if (measurable >= 2 && tracked === measurable) {
    verdict = 'PUSHES';
    lines.push('');
    lines.push(
      `VERDICT: THE CAR PUSHES over BLE — ${totalPushes} domain-3 frames, and the cadence tracked the ` +
        `requested rate in ${tracked}/${measurable} windows at DIFFERENT rates. Nothing else on this link ` +
        `follows a parameter we chose, so these are answers to our subscription. This contradicts the ` +
        `prior (the app never uses VDS over BLE, and 4.58.0 kill-switches it) — the car supports more ` +
        `than the app exercises. Decode the payloads before building on it.`,
    );
  } else if (totalPushes > 0) {
    verdict = 'INCONCLUSIVE';
    lines.push('');
    lines.push(
      `VERDICT: INCONCLUSIVE — ${totalPushes} domain-3 frames arrived, but the cadence did not clearly ` +
        `track the requested rate (${tracked}/${measurable} windows). Something is pushing; whether it is ` +
        `our subscription is unproven. Re-run, and decode the raw frames above.`,
    );
  } else if (baseline.length === 0 && observations.length === 0) {
    verdict = 'INCONCLUSIVE';
    lines.push('');
    lines.push(
      `VERDICT: INCONCLUSIVE — no car-initiated frames at all, not even in the baseline. The link was ` +
        `silent, so this says nothing about subscriptions. Re-run with the car awake and in range.`,
    );
  } else {
    verdict = 'NO_PUSHES';
    lines.push('');
    lines.push(
      `VERDICT: NO PUSHES — frames crossed the link but none came from domain 3 in any subscription ` +
        `window. The subscription's BLE arm does not deliver. Keep the per-state poll (which is what the ` +
        `official app does over BLE too).`,
    );
  }
  const windowFrames = observations.filter((o) => o.atMs >= baselineEndMs).length;
  return { lines, baselineFrames: baseline.length, windowFrames, domain3Pushes: totalPushes, verdict };
}
