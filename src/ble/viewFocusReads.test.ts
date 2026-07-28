import test from 'node:test';
import assert from 'node:assert/strict';

import { focusFromCameraMode, readPlanFor, planForCameraMode, CADENCE_MS , nextRotatedState} from './viewFocusReads';

test('focusFromCameraMode mirrors app/index.tsx exactly', () => {
  // index.tsx: cameraMode === 'CLIMATE' ? 'climate' : 'TOP_DOWN' ? 'controls' : 'home'
  assert.equal(focusFromCameraMode('CLIMATE'), 'climate');
  assert.equal(focusFromCameraMode('TOP_DOWN'), 'controls');
  assert.equal(focusFromCameraMode('PARKED'), 'home');
});

test('an unknown or missing cameraMode falls back to home, never undefined', () => {
  // The plan is consumed on every poll tick; an undefined plan would throw
  // inside the tick and take out the whole read.
  assert.equal(focusFromCameraMode(undefined), 'home');
  assert.equal(focusFromCameraMode(null), 'home');
  assert.equal(focusFromCameraMode('SOMETHING_NEW'), 'home');
  assert.ok(planForCameraMode(undefined).states.length > 0);
});

test('every focus reads exactly ONE state PER TICK — the scoping IS the change', () => {
  // Four states per tick is what forced the 60s throttle: each is a full command
  // round trip. The invariant that matters is therefore per-TICK cost.
  //
  // This used to assert `plan.states.length === 1`, which conflated "one state
  // per tick" with "one state in the plan". Rotation makes those different: a
  // plan may list several and still read exactly one each tick. Closures joined
  // the rotation on 2026-07-28 and tripped this — correctly flagging that
  // something changed, but for the wrong reason. Asserting the real invariant
  // keeps the guard honest instead of deleting it.
  for (const focus of ['home', 'controls', 'climate'] as const) {
    const plan = readPlanFor(focus);
    for (let tick = 0; tick < plan.states.length * 2; tick++) {
      assert.equal(
        nextRotatedState(plan.states, tick).length,
        1,
        `${focus} must read one state per tick`,
      );
    }
  }
});

test('climate panel reads climate ONLY (the app: "fetching climate only")', () => {
  assert.deepEqual(readPlanFor('climate').states, ['climate']);
});

test('controls and home both read drive state — that is where speed is rendered', () => {
  // 'on controls screen, fetching drive state'. Home has no recovered literal,
  // but VehicleStatusText renders speed + the blue "Driving" label there, and
  // both come from DriveState. This is the case the change exists to fix.
  assert.ok(readPlanFor('controls').states.includes('drive'));
  assert.ok(readPlanFor('home').states.includes('drive'));
});

test('each focus uses its RECOVERED per-screen cadence, not one blanket value', () => {
  // RESPONSE-19 Q5 disassembled the pairings. controls/climate are inferred;
  // security 1250 / scheduling 2500 / location 5000 are proven.
  assert.equal(readPlanFor('controls').intervalMs, 1650);
  assert.equal(readPlanFor('climate').intervalMs, 5000);
  // Home is our own screen with no counterpart in the app; it borrows the
  // controls tier because it reads the same state for the same reason.
  assert.equal(readPlanFor('home').intervalMs, CADENCE_MS.controls);
});

test('every cadence sits in the four recovered tiers', () => {
  const tiers = [1250, 1650, 2500, 5000];
  for (const v of Object.values(CADENCE_MS)) assert.ok(tiers.includes(v), `${v} is not a recovered tier`);
});

test('the focused read is strictly cheaper than the full read it rides beside', () => {
  // The full read is 4 states / 60s = ~4 round trips per minute. The focused
  // read is 1 state / 5s = 12 per minute. Guard the ratio so a future edit
  // cannot quietly multiply link load: 1-state-at-5s is 12 trips/min, and
  // anything above ~15 would start crowding user commands.
  // At the controls tier (1650ms) this is ~36 round trips/min for ONE state.
  // That is Tesla's own rate for this screen, so the ceiling tracks theirs.
  // ROTATION, so the plan's length does NOT multiply the cost — one state is
  // read per tick whatever the plan lists. That is precisely why adding closures
  // was affordable: it takes a slot, it does not add a trip.
  const plan = readPlanFor('home');
  const tripsPerMinute = 60_000 / plan.intervalMs;
  assert.ok(tripsPerMinute <= 40, `focused read costs ${tripsPerMinute} round trips/min`);
});

test('the tyre overlay is what makes us read TPMS at all', () => {
  // Screen-keyed, one level finer: a panel nobody has opened is worth no round
  // trip. Opening it starts the read; closing it stops it immediately.
  // 'tires' present and 'drive' gone is the claim; closures stay (the trunk and
  // frunk markers are on this screen, so dropping them here would disable the
  // no-op-close fix exactly where it matters most).
  const tyre = planForCameraMode('TOP_DOWN', { tirePressureVisible: true }).states;
  assert.ok(tyre.includes('tires'));
  assert.equal(tyre.includes('drive'), false);
  assert.ok(planForCameraMode('TOP_DOWN', { tirePressureVisible: false }).states.includes('drive'));
  assert.ok(planForCameraMode('TOP_DOWN').states.includes('drive'), 'absent flag ⇒ no TPMS read');
});

test('TPMS REPLACES drive on controls rather than adding to it', () => {
  // Nothing on the Controls screen renders speed — the status line lives on
  // Home — so drive gives up its slot to tyres rather than sharing.
  //
  // Asserted as "drive is gone", not "length === 1": closures DO stay, because
  // the trunk and frunk markers are on this screen. Pinning the length made an
  // unrelated addition look like the replacement had regressed.
  const plan = planForCameraMode('TOP_DOWN', { tirePressureVisible: true });
  assert.ok(plan.states.includes('tires'));
  assert.equal(plan.states.includes('drive'), false, 'drive gives up its slot');
  assert.equal(plan.intervalMs, CADENCE_MS.controls, 'same cadence as the screen it belongs to');
});

test('the tyre flag does NOT leak onto other screens', () => {
  // fleet.ts already forces the flag false when leaving TOP_DOWN, but the read
  // plan must not depend on that staying true.
  // Asserts the LEAK, not the exact plan: these screens must not gain 'tires'.
  // Pinning the whole array made an unrelated addition (closures) look like a
  // leak regression.
  assert.equal(planForCameraMode('CLIMATE', { tirePressureVisible: true }).states.includes('tires'), false);
  assert.equal(planForCameraMode('PARKED', { tirePressureVisible: true }).states.includes('tires'), false);
});

// ── Rotation ────────────────────────────────────────────────────────────────
//
// Recovered from Tesla iOS v4.56: they POLL, they do not push. getPollingInterval
// returns VEHICLE_DATA_POLLING_INTERVAL_ONLINE = FIVE_SECONDS (5000) while the
// car is online, and the payload VehicleDataSlicesSet includes MEDIA_STATE and
// MEDIA_DETAIL_STATE. We cannot send their 23-slice call — the 452-byte cap is
// one submessage per request — so we rotate to reach the same per-slice cadence.

test('rotation: one state per tick, cycling', () => {
  const states = ['drive', 'media', 'mediaDetail'];
  assert.deepEqual(nextRotatedState(states, 0), ['drive']);
  assert.deepEqual(nextRotatedState(states, 1), ['media']);
  assert.deepEqual(nextRotatedState(states, 2), ['mediaDetail']);
  assert.deepEqual(nextRotatedState(states, 3), ['drive'], 'wraps');
});

test('rotation: a single-state plan is passed through untouched', () => {
  // The overwhelmingly common case — Home with no media, Controls, Climate.
  // Rotating one state must not change today's behaviour at all.
  assert.deepEqual(nextRotatedState(['drive'], 0), ['drive']);
  assert.deepEqual(nextRotatedState(['drive'], 7), ['drive']);
  assert.deepEqual(nextRotatedState([], 3), []);
});

test('the home tick is the BLE-recovered 1250, not the cloud path`s 5000', () => {
  // startBleVehicleUpdates dispatches setGetmediastate with interval 1250.
  // VEHICLE_DATA_POLLING_INTERVAL_ONLINE (5000) is the CLOUD path and must not
  // be used here — that mix-up is exactly what this test exists to prevent.
  const plan = planForCameraMode('PARKED', { mediaVisible: true });
  assert.equal(plan.intervalMs, 1250, 'the TICK is the recovered number');
  // Per-slice latency is the thing worth bounding, and it is a TRADE, not a
  // constant: their home set is four states at 1250 = 5s per slice. Ours is five
  // with the media card up — drive, media, mediaDetail, closures, climate — so
  // 6.25s. Media costs two slots because its fields are split across two
  // submessages, and drive is ours (Home renders speed, theirs does not).
  //
  // Slightly slower than theirs per slice, and worth it: before this, closures
  // waited on a 20s tick and climate on a 60s-throttled poll that measured 763s
  // at worst. 6.25s is the price of both being live at all.
  assert.ok(
    plan.states.length * plan.intervalMs <= 6500,
    `per-slice latency ${plan.states.length * plan.intervalMs}ms`,
  );
});

test('media is only polled when the card is actually on screen', () => {
  // Same principle as the tyre overlay: a panel nobody opened is worth no round
  // trips. Without the card, Home stays exactly as it was.
  const without = planForCameraMode('PARKED', { mediaVisible: false });
  assert.equal(without.states.includes('media'), false);
});

test('the media rotation does not leak onto Controls or Climate', () => {
  // Those screens do not render the card, so they must not pay for it.
  assert.equal(planForCameraMode('TOP_DOWN', { mediaVisible: true }).states.includes('media'), false);
  assert.equal(planForCameraMode('CLIMATE', { mediaVisible: true }).states.includes('media'), false);
});

// ── closures in the rotation ────────────────────────────────────────────────
//
// The trunk defect, measured on-car 2026-07-28:
//
//   dispatch closeTrunk -> settle 120ms "ok" -> trunk NEVER MOVES -> zero pushes
//   ... 11.6s ... read vcsec {rearTrunk:"open"} -> UI finally corrects
//
// VCSEC pushes are CHANGE events (five for five in that log: pushes appeared iff
// a closure actually moved). A command the car accepts but does not act on is a
// NON-event, and only a read can see a non-event. Closures rode the 20s tick.
test('closures are in the rotation wherever a closure can be actuated', () => {
  for (const focus of ['home', 'controls'] as const) {
    assert.ok(
      readPlanFor(focus).states.includes('closures'),
      `${focus} must poll closures — its screen actuates them`,
    );
  }
});

test('the climate screen does NOT poll closures', () => {
  // Theirs is climate-only there, and nothing on that screen opens a closure —
  // so paying a VCSEC round-trip for it would be pure cost.
  assert.equal(readPlanFor('climate').states.includes('closures'), false);
});

test('extra states take a SLOT — they do not add a tick', () => {
  // The answer to "won't this spam?": the interval is unchanged and the rotation
  // is what pays for extra states, so the read RATE is identical however many
  // are listed. Each lands every (slots x interval) instead of on the slow poll.
  const plan = readPlanFor('controls');
  assert.equal(plan.intervalMs, CADENCE_MS.controls, 'interval unchanged');
  assert.deepEqual(plan.states, ['drive', 'closures', 'climate']);
});

test('climate is in the rotation wherever the Climate row is rendered', () => {
  // It otherwise rides the 60s-throttled infotainment poll. Measured on-car over
  // 30 minutes: mean gap 123s, WORST 763s — twelve minutes of a climate value the
  // car may have rejected.
  for (const focus of ['home', 'controls'] as const) {
    assert.ok(readPlanFor(focus).states.includes('climate'), `${focus} must poll climate`);
  }
});

test('every branch that bypasses readPlanFor keeps closures', () => {
  // These branches return literals rather than extending the plan, so a state
  // added to readPlanFor is silently missing here. The first cut of the closures
  // change did exactly that and disabled the trunk fix whenever the media card
  // was up, or the tyre overlay open — both on the screens that actuate closures.
  const bypasses = [
    planForCameraMode('HOME', { mediaVisible: true }),
    planForCameraMode('TOP_DOWN', { tirePressureVisible: true }),
  ];
  for (const plan of bypasses) assert.ok(plan.states.includes('closures'));
});

test('the rotation actually alternates, so neither state starves', () => {
  const plan = readPlanFor('controls');
  const seen = [0, 1, 2, 3].map((tick) => nextRotatedState(plan.states, tick)[0]);
  assert.deepEqual(seen, ['drive', 'closures', 'climate', 'drive']);
});
