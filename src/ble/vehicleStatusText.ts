// The vehicle status line shown under the car name on Home.
//
// Source of truth: docs/superpowers/research/tesla-status-assets-FINDINGS.md
// (Round 3) — a static RE of the official Tesla app v4.58.0
// (`VehicleStatusText` #117231). Round 3 CORRECTED Round 2 on two points this
// module previously got wrong, so read §A before changing anything here:
//
//  1. The freshness string is the PRIMARY text, not a fallback. "Connecting"
//     shows ONLY for a vehicle that has never been fetched.
//  2. The spinner co-renders WITH "Last seen/Asleep {{age}}" — it is not
//     exclusive to "Connecting", and it spins continuously the whole time the
//     data is stale, not just during an explicit refresh gesture.
//
// Their render dispatch (findings §A), first match wins: live states (Parked /
// Mobile Access Disabled / In Service / Charging / …) take priority; the LAST
// branch is `isDataStale`, whose text is the freshness string and whose spinner
// is `canWake || !fetchedDataRecently`. Since the stale branch is entered on
// exactly the same 2-minute threshold that makes `fetchedDataRecently` false,
// that OR is always true inside it — so for us `spinner === stale`, and
// `canWake` never needs modelling.

// TimeInMs.TWO_MINUTES — the one threshold behind both `isVehicleDataStale`
// (#30694) and `fetchedDataRecently` (#30697). Findings §A.
export const DATA_STALE_MS = 120_000;

export interface VehicleStatusInput {
  // A real car-link (not a demo/unlinked vehicle).
  linked: boolean;
  // Our analogue of their `last_received_vehicle_data_timestamp`: the last read
  // that found the car AWAKE and reporting; null = never fetched.
  //
  // NOTE ON THE MAPPING (deliberate, and the one place our transport differs):
  // their timestamp tracks INFOTAINMENT `vehicle_data`, which simply stops
  // arriving once the car sleeps — that's what makes their status age out into
  // "Asleep 5 minutes". Our poll is VCSEC, which keeps answering while the car
  // sleeps, so a raw "last successful read" would never go stale and we'd show
  // a live "Parked" for a sleeping car forever. Stamping this only while awake
  // reproduces their behaviour on our transport.
  lastVehicleDataAt: number | null;
  awake: boolean;
  now: number;
}

export interface VehicleStatus {
  // null = render nothing at all (findings §A priority 1: empty text).
  text: string | null;
  // The inline BusyIcon before the text.
  spinner: boolean;
  // Data older than DATA_STALE_MS. Also drives the battery row's 50% dim
  // (findings §C3), which is why it's exposed rather than kept internal.
  stale: boolean;
}

// relativeAge ports moment's `fromNow` — the exact formatter the official app
// uses (findings §B: `vehicleDataLastUpdatedString` formats `now - timestamp`
// with `.fromNow()`). Asleep passes fromNow(true) = no suffix, offline uses the
// suffix. Thresholds/phrasing are moment's English defaults (ss:44, m:45, h:22,
// d:26, M:11), so "Asleep 5 minutes" / "Last seen 2 hours ago" read exactly as
// they do in the real app.
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
  const { linked, lastVehicleDataAt, awake, now } = input;

  // Demo/unlinked vehicles have no real telemetry: keep the showroom copy, and
  // never spin (there is nothing to wait for).
  if (!linked) {
    return { text: awake ? 'Parked' : 'Last seen 3 days ago', spinner: false, stale: false };
  }

  const fetchedRecently = lastVehicleDataAt !== null && now - lastVehicleDataAt < DATA_STALE_MS;

  // A live state wins over the stale branch (findings §A priorities 1-6).
  if (fetchedRecently) return { text: 'Parked', spinner: false, stale: false };

  // The stale branch (priority 7). The spinner is ALWAYS on here — see the
  // header note. This is what makes cold start read "Last seen 2 hours ago"
  // beside a spinner rather than a bare "Connecting".
  if (lastVehicleDataAt === null) {
    // Never fetched (fresh install / newly linked car) — the ONLY route to
    // "Connecting" (findings §B).
    return { text: 'Connecting', spinner: true, stale: true };
  }

  const age = now - lastVehicleDataAt;
  const text = awake ? `Last seen ${relativeAge(age, true)}` : `Asleep ${relativeAge(age, false)}`;
  return { text, spinner: true, stale: true };
}
