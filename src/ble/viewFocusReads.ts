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
//     controls screen    1650 ms   INFERRED (by elimination + cluster adjacency)
//     climate screen     5000 ms   INFERRED (same)
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

export interface FocusReadPlan {
  states: InfotainmentStateKey[];
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
      return { states: ['drive'], intervalMs: CADENCE_MS.controls };
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
      return { states: ['drive'], intervalMs: CADENCE_MS.controls };
  }
}

// nextRotatedState — which ONE state to read on this tick.
//
// Recovered mechanism (Tesla iOS v4.56): they do not push or subscribe, they
// POLL. `getPollingInterval` returns
//   VEHICLE_DATA_POLLING_INTERVAL_ONLINE  = TimeInMs.FIVE_SECONDS     = 5000
//   VEHICLE_DATA_POLLING_INTERVAL_OFFLINE = TimeInMs.ONE_SECOND * 1.2 = 1200
// (offline is FASTER on purpose — it is watching for the car to come up), and
// the payload is `VehicleDataSlicesSet`, a 23-slice set that includes both
// MEDIA_STATE and MEDIA_DETAIL_STATE. So: every slice they show refreshes every
// five seconds, media included.
//
// We cannot copy the SET — the car's 452-byte inbound cap allows one submessage
// per request, so their one cloud call is 23 round trips for us. We can copy the
// CADENCE, by rotating: one state per tick, so N states each land every
// N * intervalMs. At three states and 1650ms that is 4950ms — Tesla's 5000
// almost exactly, at the same per-tick link cost as reading one state forever.
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
    return { states: ['drive', 'media', 'mediaDetail'], intervalMs: CADENCE_MS.controls };
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
    return { states: ['tires'], intervalMs: CADENCE_MS.controls };
  }
  return readPlanFor(focus);
}
