// The vehicle status line shown under the car name on Home.
//
// Source of truth: docs/superpowers/research/tesla-status-visual-FINDINGS.md —
// a static RE of the official Tesla app v4.58.0 (`VehicleStatusText` #117231).
// The recovered display rules (findings §1.2/§4), verbatim:
//   - ONE Text node, ONE line, in every state except Charging.
//   - No per-state icon. The only glyph is the Connecting spinner.
//   - Renders NOTHING (zero nodes, not an empty string) when no status applies.
//   - Offline/asleep freshness IS the status line — there is no second
//     stacked "caption" line. So we never show a status AND an age.
// This module is the whole rule table, pure and node-tested; the RN component
// (src/components/VehicleStatusText.tsx) only paints what it returns.

export interface VehicleStatusInput {
  // A real car-link (not a demo/unlinked vehicle).
  linked: boolean;
  connection: 'offline' | 'connecting' | 'online';
  // Date.now() of the last successful read; null before the first one.
  lastUpdatedAt: number | null;
  awake: boolean;
  now: number;
}

export interface VehicleStatus {
  // null = render nothing at all (findings §1.2: return-null, zero nodes).
  text: string | null;
  // The inline BusyIcon before the text (findings §3).
  spinner: boolean;
}

// relativeAge ports moment's `fromNow` — the exact function the official app
// formats freshness with (findings §4: asleep = fromNow(true) i.e. no suffix,
// offline = fromNow() i.e. "… ago"). Thresholds and phrasing are moment's
// English defaults (ss:44, m:45, h:22, d:26, M:11), so "Asleep 5 minutes" and
// "Last seen 2 hours ago" read exactly as they do in the real app.
export function relativeAge(ms: number, withSuffix: boolean): string {
  const abs = Math.max(0, ms);
  // moment computes each unit as a rounded float of the whole duration (not a
  // remainder), which is why 90s is "2 minutes" and not "1 minute 30".
  const seconds = Math.round(abs / 1000);
  const minutes = Math.round(abs / 60_000);
  const hours = Math.round(abs / 3_600_000);
  const daysFloat = abs / 86_400_000;
  const days = Math.round(daysFloat);
  // moment's daysToMonths: days * 4800 / 146097 (the Gregorian mean month).
  const monthsFloat = (daysFloat * 4800) / 146097;
  const months = Math.round(monthsFloat);
  const years = Math.round(monthsFloat / 12);

  let phrase: string;
  if (seconds <= 44) phrase = 'a few seconds';
  else if (minutes <= 1) phrase = 'a minute';
  else if (minutes < 45) phrase = `${minutes} minutes`;
  else if (hours <= 1) phrase = 'an hour';
  else if (hours < 22) phrase = `${hours} hours`;
  else if (days <= 1) phrase = 'a day';
  else if (days < 26) phrase = `${days} days`;
  else if (months <= 1) phrase = 'a month';
  else if (months < 11) phrase = `${months} months`;
  else if (years <= 1) phrase = 'a year';
  else phrase = `${years} years`;

  return withSuffix ? `${phrase} ago` : phrase;
}

export function vehicleStatusText(input: VehicleStatusInput): VehicleStatus {
  const { linked, connection, lastUpdatedAt, awake, now } = input;

  // Demo/unlinked vehicles have no real telemetry: keep the showroom copy, but
  // render it through the same one-line rules as a linked car.
  if (!linked) {
    return { text: awake ? 'Parked' : 'Last seen 3 days ago', spinner: false };
  }

  // "Connecting" is the undetermined/null fallback, and the ONLY state with a
  // spinner (findings §4). No contact yet reads as undetermined, not offline.
  if (connection === 'connecting' || lastUpdatedAt === null) {
    return { text: 'Connecting', spinner: true };
  }

  const age = now - lastUpdatedAt;

  if (connection === 'online') {
    // Online + awake is simply "Parked" — no age, no "Updated Xs ago". The
    // official app shows freshness ONLY when the car is asleep or unreachable.
    return awake ? { text: 'Parked', spinner: false } : { text: `Asleep ${relativeAge(age, false)}`, spinner: false };
  }

  return { text: `Last seen ${relativeAge(age, true)}`, spinner: false };
}
