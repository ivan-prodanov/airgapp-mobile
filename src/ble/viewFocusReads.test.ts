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

test('every focus reads exactly ONE state — the scoping IS the change', () => {
  // Four states per tick is what forced the 60s throttle: each is a full command
  // round trip. If a plan ever grows a second state, the cadence stops being
  // affordable and this test should fail loudly rather than the link degrading.
  for (const focus of ['home', 'controls', 'climate'] as const) {
    assert.equal(readPlanFor(focus).states.length, 1, `${focus} must read one state`);
  }
});

test('climate panel reads climate ONLY (the app: "fetching climate only")', () => {
  assert.deepEqual(readPlanFor('climate').states, ['climate']);
});

test('controls and home both read drive state — that is where speed is rendered', () => {
  // 'on controls screen, fetching drive state'. Home has no recovered literal,
  // but VehicleStatusText renders speed + the blue "Driving" label there, and
  // both come from DriveState. This is the case the change exists to fix.
  assert.deepEqual(readPlanFor('controls').states, ['drive']);
  assert.deepEqual(readPlanFor('home').states, ['drive']);
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
  const plan = readPlanFor('home');
  const tripsPerMinute = (60_000 / plan.intervalMs) * plan.states.length;
  assert.ok(tripsPerMinute <= 40, `focused read costs ${tripsPerMinute} round trips/min`);
});

test('the tyre overlay is what makes us read TPMS at all', () => {
  // Screen-keyed, one level finer: a panel nobody has opened is worth no round
  // trip. Opening it starts the read; closing it stops it immediately.
  assert.deepEqual(planForCameraMode('TOP_DOWN', { tirePressureVisible: true }).states, ['tires']);
  assert.deepEqual(planForCameraMode('TOP_DOWN', { tirePressureVisible: false }).states, ['drive']);
  assert.deepEqual(planForCameraMode('TOP_DOWN').states, ['drive'], 'absent flag ⇒ no TPMS read');
});

test('TPMS REPLACES drive on controls rather than adding to it', () => {
  // Two states is two round trips per tick, and nothing on the Controls screen
  // renders speed — the status line lives on Home. Keeping both would double the
  // cost for a number nobody can see.
  const plan = planForCameraMode('TOP_DOWN', { tirePressureVisible: true });
  assert.equal(plan.states.length, 1);
  assert.equal(plan.intervalMs, CADENCE_MS.controls, 'same cadence as the screen it belongs to');
});

test('the tyre flag does NOT leak onto other screens', () => {
  // fleet.ts already forces the flag false when leaving TOP_DOWN, but the read
  // plan must not depend on that staying true.
  assert.deepEqual(planForCameraMode('CLIMATE', { tirePressureVisible: true }).states, ['climate']);
  assert.deepEqual(planForCameraMode('PARKED', { tirePressureVisible: true }).states, ['drive']);
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

test('rotation: three states at the controls tier land on Tesla`s 5s per slice', () => {
  // The number that justifies the design: 3 * 1650 = 4950ms, against their
  // recovered 5000. If someone retunes CADENCE_MS.controls this should be
  // re-checked, which is why it is asserted rather than left in a comment.
  const plan = planForCameraMode('PARKED', { mediaVisible: true });
  assert.equal(plan.states.length, 3);
  const perSlice = plan.states.length * plan.intervalMs;
  assert.ok(
    Math.abs(perSlice - 5000) <= 250,
    `each slice should refresh at ~5s (Tesla's VEHICLE_DATA_POLLING_INTERVAL_ONLINE); got ${perSlice}ms`,
  );
});

test('media is only polled when the card is actually on screen', () => {
  // Same principle as the tyre overlay: a panel nobody opened is worth no round
  // trips. Without the card, Home stays exactly as it was.
  const without = planForCameraMode('PARKED', { mediaVisible: false });
  assert.deepEqual(without.states, ['drive']);
});

test('the media rotation does not leak onto Controls or Climate', () => {
  // Those screens do not render the card, so they must not pay for it.
  assert.deepEqual(planForCameraMode('TOP_DOWN', { mediaVisible: true }).states, ['drive']);
  assert.deepEqual(planForCameraMode('CLIMATE', { mediaVisible: true }).states, ['climate']);
});
