// The vehicle status line shown under the car name on Home.
//
// Source of truth: docs/superpowers/research/tesla-status-assets-FINDINGS.md
// (Round 3) — a static RE of the official Tesla app v4.58.0
// (`VehicleStatusText` #117231). Round 3 CORRECTED Round 2 on two points this
// module previously got wrong, so read §A before changing anything here:
//
//  1. The freshness string is the PRIMARY text, not a fallback. "Connecting"
//     shows ONLY for a vehicle that has never been fetched.
//  2. The spinner is not exclusive to "Connecting" — it co-renders with
//     whatever status is showing, including "Last seen/Asleep {{age}}".
//     (When it is on is a separate question — see THE SPINNER GATE below.)
//
// Their render dispatch (findings §A), first match wins: live states (Parked /
// Mobile Access Disabled / In Service / Charging / …) take priority; the LAST
// branch is `isDataStale`, whose text is the freshness string.
//
// THE SPINNER GATE — device-verified, and it does NOT match findings §A's
// prose. §A reads the gate as `canWake || !fetchedDataRecently` and concludes
// the spinner "shows continuously the whole time the status reads Last
// seen/Asleep". That cannot be right: this car is airgapped, so the official
// app never receives fresh vehicle_data for it and sits permanently in the
// stale branch — under that reading it would spin forever. On the real app it
// does not. It spins on pull-to-refresh and on tapping the status, and is
// otherwise still (including at cold start, beside "Last seen {age} ago").
//
// That is exactly `canWake`, which §A itself defines as "a wake was REQUESTED"
// (userForcedWakes / screensEnteredRequiringWake / userInitiatedCommands /
// overrideAutoWakes) — not "the car is wakeable".
//
// Round 4 SETTLED it from the opcodes and the device was right: the gate is an
// AND, and §A had misread the operator — "shown only when the data is NOT
// fetched-recently (and can-wake / error conditions)". So a pull-to-refresh on a
// car with <2-minute-old data shows NO spinner, even though a refetch does run.
// We gate on BOTH: a wake must be in flight AND the data must be stale.

// TimeInMs.TWO_MINUTES — the one threshold behind both `isVehicleDataStale`
// (#30694) and `fetchedDataRecently` (#30697). Findings §A.
import { KM_PER_MILES } from './batteryDisplay';

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
  // ── The not-parked gate (RESPONSE-17). "Parked" is a GATED branch in the
  // official app (`isShiftStateParked` @05f6), NOT a default: when the gear is not
  // P, control jumps past every fixed-string block into a COMPOSED, speed-bearing
  // render. That is why a driving car showed "Parked" here — we had no such gate.
  // There is no "Driving" string in that component; the app shows e.g. "111 KM/H".
  parked?: boolean;
  // DriveState.speed, in MPH (the car's unit — the app stores mph and displays
  // km/h, cf. SpeedLimitSheet). null when the car isn't reporting one.
  speedMph?: number | null;
  // Gear name as the car reports it ('D'/'R'/'N'…). Shown next to the speed; the
  // app suppresses it when parked, which the gate above already covers.
  gear?: string;
  // Charging outranks the parked/driving gate (RESPONSE-17 #12-14 sit above #19).
  charging?: boolean;
  // Our `canWake`: a user-requested wake/refresh is in flight (pull-to-refresh,
  // tapping the status line). This ALONE drives the spinner — an automatic
  // poll, a cold start, or merely-stale data must never spin. See the gate note
  // in the header.
  wakeInFlight: boolean;
  now: number;
}

export interface VehicleStatus {
  // null = render nothing at all (findings §A priority 1: empty text).
  text: string | null;
  // The inline BusyIcon before the text — on only while a wake is in flight.
  spinner: boolean;
  // Data older than DATA_STALE_MS. Also drives the battery row's 50% dim
  // (findings §C3), which is why it's exposed rather than kept internal.
  stale: boolean;
  // Optional SECOND line, rendered in blue beneath the status. Occupies the slot
  // the official app uses for its Autopilot indicator — see DRIVING_SUBTEXT.
  subtext?: string;
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

// isVehicleDataUnreliable is their `isVehicleDataUnreliable(getVehicleDataQuality)`
// — true for quality in {CACHED_UNRELIABLE, UNABLE_TO_FETCH, NO_DATA} — reduced
// to the two we can observe: data older than the 2-minute window, or never
// fetched at all. Findings §4: this, NOT a raw asleep/ConnectionState, is what
// drives the renderer dim. Asleep reaches it only transitively (asleep -> no
// fresh data -> quality degrades -> dim).
export function isVehicleDataUnreliable(lastVehicleDataAt: number | null, now: number): boolean {
  return lastVehicleDataAt === null || now - lastVehicleDataAt >= DATA_STALE_MS;
}

// composeDriveText — the official app builds this line as
//   [speedPart, shiftStatePart, distancePart].filter(Boolean).join(' · ')
// (DriveStatusText #118286). We compose the first two; the third is the distance
// between phone and car, which needs the phone's position and so does not belong
// in this pure module. Returns '' when nothing is known, so the caller can fall
// back rather than render an empty status.
// The blue second line. OURS, deliberately — the official app's blue line in this
// position is its AUTOPILOT indicator ("Samodzielna jazda" = Autopilot in Polish),
// which we structurally cannot reproduce: RESPONSE-17 proved there is no
// autopilot/FSD field anywhere in the CarServer or VCSEC protos we read over BLE.
// We reuse the same slot and styling to say something we CAN prove from the gear.
export const DRIVING_SUBTEXT = 'Driving';

export function composeDriveText(speedMph: number | null, gear?: string): string {
  const parts: string[] = [];
  if (speedMph !== null && Number.isFinite(speedMph) && speedMph > 0) {
    // The car reports mph; the app displays km/h (same convention as
    // SpeedLimitSheet). Units come from getGuiSettings once that read lands.
    parts.push(`${Math.round(speedMph * KM_PER_MILES)} km/h`);
  }
  // 'unknown' is our parser's placeholder for an absent shiftState — not a gear.
  if (gear && gear !== 'unknown' && gear !== 'P') parts.push(gear);
  return parts.join(' · ');
}

export function vehicleStatusText(input: VehicleStatusInput): VehicleStatus {
  const { linked, lastVehicleDataAt, awake, wakeInFlight, now } = input;

  // Demo/unlinked vehicles have no real telemetry: keep the showroom copy, and
  // never spin (there is nothing to wait for).
  if (!linked) {
    return { text: awake ? 'Parked' : 'Last seen 3 days ago', spinner: false, stale: false };
  }

  const fetchedRecently = lastVehicleDataAt !== null && now - lastVehicleDataAt < DATA_STALE_MS;
  // The gate, per Round 4: a wake in flight AND stale data. The spinner is still
  // a structural SIBLING of the text (findings §1 tree) — it is not owned by any
  // one status string — but staleness is a term of the gate, so a fresh car
  // never spins however hard you pull.
  const spinner = wakeInFlight && !fetchedRecently;

  // A live state wins over the stale branch (findings §A priorities 1-6).
  if (fetchedRecently) {
    // Charging first — it sits ABOVE the parked/driving gate in the official
    // precedence chain, so a charging car reads "Charging" even in P.
    if (input.charging) return { text: 'Charging', spinner: false, stale: false };
    // Not parked → the composed, speed-bearing line (never the word "Driving").
    if (input.parked === false) {
      const composed = composeDriveText(input.speedMph ?? null, input.gear);
      if (composed) {
        return { text: composed, spinner: false, stale: false, subtext: DRIVING_SUBTEXT };
      }
    }
    return { text: 'Parked', spinner: false, stale: false };
  }

  if (lastVehicleDataAt === null) {
    // Never fetched (fresh install / newly linked car) — the ONLY route to
    // "Connecting" (findings §B).
    return { text: 'Connecting', spinner, stale: true };
  }

  const age = now - lastVehicleDataAt;
  const text = awake ? `Last seen ${relativeAge(age, true)}` : `Asleep ${relativeAge(age, false)}`;
  return { text, spinner, stale: true };
}
