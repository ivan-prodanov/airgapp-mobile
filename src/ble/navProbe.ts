// NAV-P1/P2/P3 — the three on-car probes that settle RESPONSE-19's disputed claims.
//
// This module is MEASUREMENT, not feature code. RESPONSE-19 was disassembled from
// an Intel MCU2 rootfs (2026.14.3); our car is HW4 Ryzen (2026.20.6.6), and the
// report itself flags that nav semantics live in `libQtCarGUI` — precisely the
// layer most likely to have diverged. Three of its claims would each redesign the
// feature, and none is safe to take on faith:
//
//   NAV-P1  "f53 and f106 silently DISCARD the order field; only f21/f22 decode it."
//   NAV-P2  "f21 sets the order flags but does not route — it drops a pin and waits
//            for a human to tap Navigate on the centre screen."
//   NAV-P3  "the DriveState route fields are gated on driverPresent || inDrivingGear,
//            so parked-and-empty is byte-identical to no-route."
//
// The classifiers live here, apart from the I/O, because the whole value of these
// probes is in reading the result correctly — and a misread classifier is exactly
// how the VDS-M1 probe reported NO PUSHES through nine clean pushes on its first
// run. These functions are node-tested against hand-built samples.
//
// ── Why APPEND is the only honest discriminator for NAV-P1 ───────────────────
//
// The obvious test — "send PREPEND and see if the destination changes" — cannot
// work. RESPONSE-19 Q1 established that `active_route_destination` names the NEXT
// stop, not the final one. So PREPEND and REPLACE produce the SAME observable:
// either way the place we just sent becomes the next stop. They are
// indistinguishable from the read side.
//
// APPEND is different. If the order is honoured, our new stop goes to the END of
// the plan and the next stop is UNCHANGED. If the order is discarded, the car
// treats the send as a plain navigation and our stop becomes the next stop. One
// bit, cleanly separated:
//
//     next stop after ≈ what we sent   →  order was DISCARDED  (report right)
//     next stop after ≈ next stop before →  order was HONOURED  (report wrong)
//
// That comparison needs a coordinate, not a name: the destination string is a
// car-side reverse-geocode we cannot predict. `activeRouteCoordinates` gives us
// the next stop's lat/lon, which is directly comparable to what we sent — see the
// telemetry.ts note. The name is kept as a fallback for firmware that omits the
// coordinate, and as corroboration in the log either way.

// How far apart two coordinates may be and still count as "the same place". The
// car snaps a destination to the nearest routable road/POI, so an exact match is
// not on offer; 150 m is far tighter than the distance between any two places a
// human would pick as separate stops, and far looser than any snap we've seen.
export const SAME_PLACE_M = 150;

export interface ProbeCoord {
  lat: number;
  lon: number;
}

// One DriveState read, reduced to what the probes actually reason about.
// `present` is deliberately separate from "destination is non-null": RESPONSE-19
// Blocker 3 says the route block can be absent WHOLESALE when the gate is shut,
// and that absence is the thing NAV-P3 measures.
export interface RouteSample {
  present: boolean;
  destination: string | null;
  coordinates: ProbeCoord | null;
}

// The gate inputs, read from the SAME response as the route fields.
// `shiftState` is populated OUTSIDE the guarded block, which is what makes it
// usable as a proxy for "could the gate have passed?".
export interface GateSample {
  shiftState: string;
  userPresent: boolean | null;
}

// Great-circle distance in metres. Small enough inputs that the haversine's
// numerical edge cases (antipodal points) never arise.
export function metresBetween(a: ProbeCoord, b: ProbeCoord): number {
  const R = 6_371_000;
  const toRad = (d: number) => (d * Math.PI) / 180;
  const dLat = toRad(b.lat - a.lat);
  const dLon = toRad(b.lon - a.lon);
  const lat1 = toRad(a.lat);
  const lat2 = toRad(b.lat);
  const h = Math.sin(dLat / 2) ** 2 + Math.cos(lat1) * Math.cos(lat2) * Math.sin(dLon / 2) ** 2;
  return 2 * R * Math.asin(Math.min(1, Math.sqrt(h)));
}

export function samePlace(a: ProbeCoord | null, b: ProbeCoord | null): boolean | null {
  if (!a || !b) return null;
  return metresBetween(a, b) <= SAME_PLACE_M;
}

// The gate, exactly as RESPONSE-19 describes it: `VAPI_driverPresent` ELSE
// `VehicleUtils::inDrivingGear(true)`. We can read both halves, so we can say
// whether an absent route block is informative or merely gated.
const DRIVING_GEARS = new Set(['d', 'r', 'n', 'drive', 'reverse', 'neutral']);
export function isGateOpen(gate: GateSample): boolean {
  if (gate.userPresent === true) return true;
  return DRIVING_GEARS.has(gate.shiftState.toLowerCase());
}

// ── NAV-P1 ───────────────────────────────────────────────────────────────────

export type OrderVerdict =
  | 'ORDER_HONOURED' // the appended stop went to the end — the route field decodes `order`
  | 'ORDER_DISCARDED' // our stop became the next stop — APPEND behaved as a plain navigate
  | 'NO_BASELINE' // no route was running before the APPEND, so there was nothing to append to
  | 'ROUTE_LOST' // the car had a route and then had none — neither outcome the report predicts
  | 'GATED' // the route block is absent because nobody is in the car; re-run seated
  | 'AMBIGUOUS'; // readable, but the before/after evidence doesn't separate the two hypotheses

export interface OrderProbeInput {
  before: RouteSample; // read after establishing the throwaway route, before the APPEND
  after: RouteSample; // read after the APPEND send
  sent: ProbeCoord; // the coordinate we sent with order=APPEND
  gate: GateSample; // read alongside `after`
}

export interface ProbeVerdict<V extends string> {
  verdict: V;
  why: string;
}

export function classifyOrderProbe({ before, after, sent, gate }: OrderProbeInput): ProbeVerdict<OrderVerdict> {
  if (!before.present) {
    return isGateOpen(gate)
      ? { verdict: 'NO_BASELINE', why: 'no route was active before the APPEND — establish one first' }
      : { verdict: 'GATED', why: 'route fields absent and the gate is shut (nobody present, not in gear)' };
  }
  if (!after.present) {
    return isGateOpen(gate)
      ? { verdict: 'ROUTE_LOST', why: 'a route was active before the APPEND and none after — the send cancelled it' }
      : { verdict: 'GATED', why: 'route fields went absent but the gate shut between reads — re-run seated' };
  }

  const becameSent = samePlace(after.coordinates, sent);
  const unchanged = samePlace(after.coordinates, before.coordinates);
  if (becameSent !== null && unchanged !== null) {
    // Both comparisons available: they should disagree with each other. If they
    // agree, the throwaway destination was too close to the appended one for the
    // probe to separate them — that's a setup error, not a firmware finding.
    if (becameSent && !unchanged) {
      return {
        verdict: 'ORDER_DISCARDED',
        why: `next stop moved to the coordinate we appended (${metresBetween(after.coordinates!, sent).toFixed(0)} m) — the order field was ignored`,
      };
    }
    if (!becameSent && unchanged) {
      return {
        verdict: 'ORDER_HONOURED',
        why: 'next stop is unchanged after the APPEND — the new stop went to the end of the plan',
      };
    }
    return {
      verdict: 'AMBIGUOUS',
      why: 'the two probe points are within 150 m of each other — pick destinations further apart and re-run',
    };
  }

  // Coordinate fallback: compare the reverse-geocoded names. Weaker (the car can
  // relabel the same stop between reads) but it still separates the hypotheses.
  if (before.destination && after.destination) {
    return before.destination === after.destination
      ? {
          verdict: 'ORDER_HONOURED',
          why: `destination name unchanged ("${after.destination}") — no coordinate available, name-only evidence`,
        }
      : {
          verdict: 'ORDER_DISCARDED',
          why: `destination name changed ("${before.destination}" → "${after.destination}") — no coordinate available, name-only evidence`,
        };
  }
  return { verdict: 'AMBIGUOUS', why: 'neither coordinates nor destination names were readable in both samples' };
}

// ── NAV-P2 ───────────────────────────────────────────────────────────────────

export type RouteStartVerdict =
  | 'ROUTED' // the send produced an active route with no human input
  | 'PIN_ONLY' // gate demonstrably open and still no route — it only dropped a pin
  | 'ALREADY_ROUTING' // a route was already active, so "did this one start it" is unanswerable
  | 'GATED'; // can't tell: the route block is suppressed

export interface RouteStartInput {
  before: RouteSample; // read BEFORE the send; must show no route for the probe to mean anything
  after: RouteSample; // read after the send + settle delay
  gate: GateSample;
}

export function classifyRouteStart({ before, after, gate }: RouteStartInput): ProbeVerdict<RouteStartVerdict> {
  if (before.present) {
    return { verdict: 'ALREADY_ROUTING', why: 'a route was already active before the send — cancel it and re-run' };
  }
  if (after.present) {
    return {
      verdict: 'ROUTED',
      why: `the send started a route on its own (next stop: ${after.destination ?? 'unnamed'}) — no screen tap needed`,
    };
  }
  if (!isGateOpen(gate)) {
    return { verdict: 'GATED', why: 'no route after the send, but the gate is shut — this read proves nothing' };
  }
  return {
    verdict: 'PIN_ONLY',
    why: 'gate open, no route after the send — the car took the request without routing (check the screen for a pin)',
  };
}

// ── NAV-P3 ───────────────────────────────────────────────────────────────────
//
// The gate probe isn't a single automated run: it needs a human to get out of the
// car, shut the doors, and wait for the car to agree they're gone. So it's a
// SNAPSHOT the user takes at each stage, and the verdict is read across rows.
// Each row records the gate inputs and whether the route block came through.

export interface GateSnapshot {
  label: string;
  gate: GateSample;
  route: RouteSample;
}

export function formatGateSnapshot({ label, gate, route }: GateSnapshot): string {
  const open = isGateOpen(gate);
  const presence = gate.userPresent === null ? 'unknown' : gate.userPresent ? 'present' : 'absent';
  const fields = route.present ? `route PRESENT (${route.destination ?? 'unnamed'})` : 'route ABSENT';
  return `${label}: shift=${gate.shiftState} user=${presence} gate=${open ? 'OPEN' : 'SHUT'} → ${fields}`;
}

// The finding NAV-P3 is looking for: a row where a route is known to be running,
// the gate is shut, and the fields are absent. That single row proves absence is
// uninformative — and therefore that the action bar must not read it as "no route".
export function gateProbeVerdict(rows: GateSnapshot[]): string {
  const seenPresent = rows.some((r) => r.route.present);
  const gatedAbsence = rows.find((r) => !r.route.present && !isGateOpen(r.gate));
  const ungatedAbsence = rows.find((r) => !r.route.present && isGateOpen(r.gate));
  if (!seenPresent) {
    return 'INCONCLUSIVE — no row ever showed a route, so we never established the route was running';
  }
  if (gatedAbsence) {
    return `CONFIRMED — "${gatedAbsence.label}" lost the route fields with the gate shut while a route was running: absence is UNINFORMATIVE when parked and empty`;
  }
  if (ungatedAbsence) {
    return `CONTRADICTED — "${ungatedAbsence.label}" lost the route fields with the gate OPEN: something other than driverPresent suppresses them`;
  }
  return 'NOT REPRODUCED — the route fields survived every stage, including with the gate shut; the gate may not exist on this firmware';
}
