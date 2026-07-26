// navBench — formatting helpers for the on-car navigation test bench.
//
// This replaced a set of automated probes (NAV-P1/P2/P3) that produced two
// CONTRADICTORY verdicts on the same message in two consecutive runs. The post
// mortem is worth keeping, because it's what this module is shaped around:
//
//   • The classifier never checked whether the send SUCCEEDED. A timed-out seed
//     left the car on an old route, the "after" read matched the "before" read,
//     and "unchanged" was reported as "the order was honoured". A confident
//     verdict from nothing happening at all.
//   • Six commands in ninety seconds desynchronised the Pi's BLE channel
//     ("sent uuid=… got request_uuid=…, Pi-side BLE channel has buffered a
//     previous response"), so later sends read earlier replies.
//   • The one question that matters most — does PREPEND insert a stop and keep
//     the rest of the route — is NOT answerable from a read at all. Every
//     active-route field describes the NEXT stop (RESPONSE-19 Q1), so PREPEND
//     and REPLACE produce identical readings. Only the car's screen can tell
//     them apart, and no amount of classifier cleverness changes that.
//
// So: this module formats FACTS and computes no verdicts. It reports what was
// sent, what came back, and how far the destination moved between two reads. The
// human running the bench draws the conclusions — they can see the centre screen,
// which is the instrument that actually answers the question.

export interface ProbeCoord {
  lat: number;
  lon: number;
}

// One DriveState + VCSEC read, kept raw. `present` is separate from "destination
// is non-null" because RESPONSE-19 Blocker 3 claims the whole route block can be
// suppressed when nobody is in the car — and whether that's true here is one of
// the things the bench exists to find out.
export interface RouteRead {
  present: boolean;
  destination: string | null;
  coordinates: ProbeCoord | null;
  minutesToArrival: number | null;
  milesToArrival: number | null;
  shiftState: string;
  userPresent: boolean | null;
  // From VCSEC, which answers even while the car sleeps — so this is populated in
  // exactly the cases where the DriveState read below is not.
  sleepStatus: string;
  // Why DriveState could not be read, when it could not. This is a RESULT, not an
  // error to swallow: "car asleep, route unreadable" is the finding in the sleep
  // test, and an aborted read would have thrown that information away.
  readError: string | null;
}

// "42.6977, 23.3219" → a coordinate, or null if it isn't one. Rejects out-of-range
// values so a typo can't be sent to the car as a real destination.
export function parseCoord(raw: string): ProbeCoord | null {
  const parts = raw.split(',');
  if (parts.length !== 2) return null;
  const lat = Number(parts[0].trim());
  const lon = Number(parts[1].trim());
  if (!Number.isFinite(lat) || !Number.isFinite(lon)) return null;
  if (Math.abs(lat) > 90 || Math.abs(lon) > 180) return null;
  return { lat, lon };
}

export const fmtCoord = (c: ProbeCoord): string => `${c.lat.toFixed(5)},${c.lon.toFixed(5)}`;

// Great-circle distance in metres. Reported as a number, never thresholded — the
// bench states how far the destination moved and leaves "is that the same place?"
// to the person looking at the car.
export function metresBetween(a: ProbeCoord, b: ProbeCoord): number {
  const R = 6_371_000;
  const toRad = (d: number) => (d * Math.PI) / 180;
  const dLat = toRad(b.lat - a.lat);
  const dLon = toRad(b.lon - a.lon);
  const h =
    Math.sin(dLat / 2) ** 2 + Math.cos(toRad(a.lat)) * Math.cos(toRad(b.lat)) * Math.sin(dLon / 2) ** 2;
  return 2 * R * Math.asin(Math.min(1, Math.sqrt(h)));
}

// The full state of one read, on one line. Everything the bench knows, nothing
// inferred.
export function formatRouteRead(r: RouteRead): string {
  const presence = r.userPresent === null ? '?' : r.userPresent ? 'yes' : 'no';
  const where = `shift=${r.shiftState} driver=${presence} car=${r.sleepStatus}`;
  // An unreadable DriveState is not the same claim as "no route" — say which.
  if (r.readError) return `ROUTE: UNREADABLE (${r.readError}) | ${where}`;
  if (!r.present) return `ROUTE: none (no active-route fields in the reply) | ${where}`;
  const eta = [
    r.minutesToArrival === null ? null : `${r.minutesToArrival}min`,
    r.milesToArrival === null ? null : `${r.milesToArrival.toFixed(1)}mi`,
  ]
    .filter(Boolean)
    .join(' ');
  const coord = r.coordinates ? fmtCoord(r.coordinates) : 'no coord';
  return `ROUTE: "${r.destination ?? 'unnamed'}" @ ${coord}${eta ? ` (${eta})` : ''} | ${where}`;
}

// How this read differs from the previous one — distance moved and whether the
// name changed. Both are observations; neither is a conclusion about `order`.
export function formatRouteDelta(prev: RouteRead | null, next: RouteRead): string {
  if (!prev) return 'DELTA: (first read this session — nothing to compare)';
  // An unreadable side cannot be compared. Saying so beats reporting a change
  // that is really just a failed read.
  if (prev.readError || next.readError) {
    return `DELTA: not comparable — ${next.readError ? 'this' : 'the previous'} read failed`;
  }
  if (prev.present !== next.present) {
    return `DELTA: route ${prev.present ? 'DISAPPEARED' : 'APPEARED'} since the last read`;
  }
  if (!next.present) return 'DELTA: still no route';
  const moved =
    prev.coordinates && next.coordinates
      ? `next stop moved ${metresBetween(prev.coordinates, next.coordinates).toFixed(0)} m`
      : 'no coordinate on one side — cannot measure movement';
  const renamed =
    prev.destination === next.destination
      ? `name unchanged ("${next.destination ?? 'unnamed'}")`
      : `name "${prev.destination ?? 'unnamed'}" → "${next.destination ?? 'unnamed'}"`;
  return `DELTA: ${moved}; ${renamed}`;
}
