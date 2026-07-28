// viewFocusReads — which state to read, and how often, for the panel on screen.
//
// This is the official app's real BLE strategy, and it is NOT the vehicle-data
// subscription. RESPONSE-15 was explicit that over BLE the app polls per-state
// reads; the streaming subscription is pinned to Hermes and kill-switched in
// 4.58.0. (Our own probes showed the CAR will stream over BLE anyway — see
// vdsProbe.ts — but that path is blocked on per-state rate tags we refuse to
// guess, and it is not what Tesla ships.)
//
// The shape comes from `startBleVehicleUpdates` (tesla-live-status-push-FINDINGS
// §Q1, iOS-verified with byte offsets): a loop that fetches ONE state chosen by
// the visible screen —
//
//     'on security screen, fetching closures & parental controls state'   1250 ms
//     'on controls screen, fetching drive state'
//     'on climate screen, fetching climate only'
//
// — with inline delay constants of 1250, 1650, 2500 and 5000 ms, gated on
// 'is paired and connected!'.
//
// WHY THE SCOPING MATTERS MORE THAN THE INTERVAL. Our own read was four states
// per tick, each a full command round-trip, throttled to 60 s because the
// per-tick COST was the problem — an every-20s four-state read was blocking user
// commands in the shared FIFO for ~8 s at a time. Simply lowering that interval
// would have made it worse, which is exactly why the first attempt at "make the
// speed live" (a 5 s driving-only constant) was the wrong fix. Reading ONE state
// is what buys the cadence.
//
// PER-SCREEN CADENCES — now recovered (RESPONSE-19 Q5, disassembled from the
// Hermes bundle). Four tiers, and the pairings are:
//
//     security screen    1250 ms   PROVEN
//     scheduling screen  2500 ms   PROVEN
//     location screen    5000 ms   PROVEN
//     controls screen    1650 ms   PROVEN (2026-07-27, upgraded from INFERRED)
//     climate screen     5000 ms   INFERRED (by elimination + cluster adjacency)
//     home / media       1250 ms   PROVEN (2026-07-27)
//
// The 1650 upgrade and the media tier both come from reading
// `startBleVehicleUpdates`' DISPATCH SITES rather than its constant pool: each
// site ends `r6 = <label>; r7 = <interval>` into a shared tail, so the pairing is
// explicit. setGetparkedaccessorystate (logged "on controls screen") carries
// 1650, and setGetmediastate carries 1250. Adjacency in the pool would have
// paired 'media state' with 1650 and been wrong.
//
// Also settled, and worth stating because it retires an idea of mine: the
// cadence is a PURE FUNCTION OF THE FOREGROUNDED SCREEN. Nothing in that loop
// reads shift state or speed. So the very first attempt at this — "poll faster
// while driving" — was not merely a crude fix, it was the wrong shape entirely;
// Tesla never varies the rate by driving.
//
// Failure behaviour worth mirroring eventually: on RESULT_UNSUPPORTED_COMMAND /
// RESULT_INVALID_COMMAND_REQUEST their loop logs "stopping BLE vehicle data
// polling due to unrecoverable command result" and effectively stops, rather
// than hammering a car that rejected the command.

import type { InfotainmentStateKey } from './gateway';

// The panels the app actually presents. Derived from cameraMode, which the
// vehicle state already carries — no new plumbing, and it cannot drift out of
// sync with what is rendered because it IS what selects the render.
export type ViewFocus = 'home' | 'controls' | 'climate';

/**
 * One rotation slot. Mostly infotainment states, plus 'closures' — which is a
 * VCSEC read, not a domain-3 one, so the caller has to branch on it.
 *
 * Closures are here because of the defect measured on-car 2026-07-28: the car
 * ACCEPTED a closeTrunk (outcome ok) and the trunk never moved. VCSEC pushes are
 * CHANGE events, so a command that silently does nothing produces no event at
 * all — five for five in the log, pushes appeared iff a closure actually moved.
 * Detecting "what I asked for didn't happen" is a non-event, and the only thing
 * that can see a non-event is a read. Closures rode the 20s VCSEC tick, so the
 * app showed a wrong trunk for 11.6s.
 */
export type FocusSlot = InfotainmentStateKey | 'closures';

export interface FocusReadPlan {
  states: FocusSlot[];
  intervalMs: number;
}

// Recovered per-screen tiers. controls/climate are INFERRED (see above); the
// others are proven and kept here for the screens we do not yet fast-poll.
export const CADENCE_MS = Object.freeze({
  controls: 1650,
  climate: 5000,
  security: 1250,
  scheduling: 2500,
  location: 5000,
  // RECOVERED, not inferred: `startBleVehicleUpdates` dispatches
  // setGetmediastate with interval 1250, grouped with closures/charge/climate.
  home: 1250,
});

export function focusFromCameraMode(cameraMode: string | null | undefined): ViewFocus {
  // Mirrors app/index.tsx's own `mode` derivation exactly. Kept as a function
  // (not a map) so an unrecognised mode falls back to 'home' rather than
  // producing an undefined plan.
  if (cameraMode === 'CLIMATE') return 'climate';
  if (cameraMode === 'TOP_DOWN') return 'controls';
  return 'home';
}

export function readPlanFor(focus: ViewFocus): FocusReadPlan {
  switch (focus) {
    case 'climate':
      // 'on climate screen, fetching climate only' — climate ONLY, per the app.
      return { states: ['climate'], intervalMs: CADENCE_MS.climate };
    case 'controls':
      // 'on controls screen, fetching drive state'.
      //
      // DELIBERATE DEVIATION: theirs does NOT poll closures here (their controls
      // group is drive / charge / parked accessory / tyre pressure; closures sit
      // in the home group at 1250). Ours does, because this is the camera mode
      // our trunk and frunk markers live in — the exact screen where a silently
      // no-op'd close leaves a wrong value on screen with no push coming.
      //
      // NO climate here. I added it, Ivan pushed back, and he was right: nothing
      // in this camera mode renders a climate value — you are looking at the car
      // and its markers — and THEIRS does not poll it here either (their
      // controls branch is parked accessory / charge / drive / tyres at 1650).
      //
      // It was not free: a third slot pushed closures from ~3.3s to ~5s on the
      // exact screen where the trunk and frunk are actuated, which is the latency
      // the closures change existed to fix. Two slots, 3.3s.
      return { states: ['drive', 'closures'], intervalMs: CADENCE_MS.controls };
    case 'home':
    default:
      // Home has no literal in the recovered strings, but it is where the
      // status line lives — the speed and the blue "Driving" label are rendered
      // by VehicleStatusText on Home — and those fields come from DriveState.
      // This is the case the whole change exists to fix: that line previously
      // moved only on pull-to-refresh, because DriveState rode the 60s read.
      //
      // Home has no counterpart in the app's screen list, so this pairing stays
      // MINE. It borrows the controls tier because it reads the same state for
      // the same reason — the status line is drive data.
      //
      // 'closures' matches theirs: their home/default group dispatches
      // setGetclosuresstate at 1250 (read from the DISPATCH SITE, not the
      // constant pool — pairing it with the adjacent 1650 would have been wrong
      // in exactly the way this file already warns about).
      return { states: ['drive', 'closures', 'climate'], intervalMs: CADENCE_MS.controls };
  }
}

// nextRotatedState — which ONE state to read on this tick.
//
// ⚠️ CORRECTED. The first version of this cited
// `VEHICLE_DATA_POLLING_INTERVAL_ONLINE = 5000`. That constant is real but it is
// the CLOUD path — it sits beside `VehiclePollingType.ENERGY_PAIRED_VEHICLE` and
// feeds their 23-slice `VehicleDataSlicesSet` request, which needs one HTTP call
// the BLE transport cannot make. Ivan caught it. Do not cite it for BLE.
//
// The BLE mechanism is a separate generator, `startBleVehicleUpdates`, whose own
// first log line is "starting BLE vehicle data polling task". It fetches ONE
// state per step and delays; every dispatch site ends with the same two
// registers — a label and an interval — feeding a shared tail:
//
//   setGetmediastate  ...  r6 = 'media state'   r7 = 1250
//   setGetchargestate ...  r6 = 'charge state'  r7 = 1250      <- same group
//   setGetclosuresstate .. r6 = 'closures state' r7 = 1250
//   setGetparkedaccessorystate ... r7 = 1650                   <- "on controls screen"
//   setGetlocationstate ...        r7 = 5000                   <- "on location screen"
//
// So: **media state IS fetched over BLE, at 1250ms**, grouped with
// closures/charge/climate — the set a home screen needs. Read from the dispatch
// sites, not from the constant pool: in the pool `'media state'` sits next to
// 1650, and pairing by adjacency would have given the wrong number.
//
// Two things this also settles: 1650 really is the controls tier (the 1650 group
// contains parked-accessory, whose log says "on controls screen"), which had been
// INFERRED; and `'media state'` is the only entry with no "on X screen..." log
// line, which is why it is not screen-keyed the way the others are.
//
// We rotate because we must: the car's 452-byte cap allows one submessage per
// request, so a set is N round trips. Tesla's home set is four states at 1250 =
// 5000ms per slice. Ours is three, so each lands every 3750ms — slightly fresher
// than theirs, on a smaller set.
export function nextRotatedState(states: readonly string[], tick: number): string[] {
  if (states.length <= 1) return [...states];
  return [states[tick % states.length]];
}

// planForCameraMode — the one call site's convenience wrapper.
export function planForCameraMode(
  cameraMode: string | null | undefined,
  opts?: { tirePressureVisible?: boolean; mediaVisible?: boolean },
): FocusReadPlan {
  const focus = focusFromCameraMode(cameraMode);
  // Home with the media card up rotates drive/media/mediaDetail. Media is TWO
  // reads because the fields are split across two submessages, so it costs two
  // of the three slots — which is what makes the rotation land on ~5s rather
  // than ~3.3s. Gated on the card being VISIBLE, exactly like the tyre overlay:
  // a card nobody is looking at is not worth a round trip.
  if (focus === 'home' && opts?.mediaVisible) {
    // Closures and climate stay IN. This branch returns a literal instead of
    // extending readPlanFor, so every state added to the home plan has to be
    // repeated here — and the first version of the closures change forgot to,
    // which silently disabled the trunk fix whenever the media card was up.
    return {
      states: ['drive', 'media', 'mediaDetail', 'closures', 'climate'],
      intervalMs: CADENCE_MS.home,
    };
  }
  // TPMS is fetched ONLY while the tyre overlay is open. This is the same
  // screen-keyed principle one level finer: the app's own screens decide what is
  // worth a round trip, and a panel nobody has opened is worth none. Closing the
  // overlay stops the read immediately.
  //
  // It REPLACES drive rather than adding to it: two states is two round trips
  // per tick, and nothing on the Controls screen renders speed — the status line
  // lives on Home.
  if (focus === 'controls' && opts?.tirePressureVisible) {
    // Tyres REPLACE drive (nothing here renders speed), but NOT closures: the
    // trunk and frunk markers are on this very screen, so dropping closures here
    // would disable the fix exactly where it is most needed.
    return { states: ['tires', 'closures'], intervalMs: CADENCE_MS.controls };
  }
  return readPlanFor(focus);
}
