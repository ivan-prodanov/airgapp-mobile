import test from 'node:test';
import assert from 'node:assert/strict';

import { focusFromCameraMode, readPlanFor, planForCameraMode, FOCUS_INTERVAL_MS } from './viewFocusReads';

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

test('the interval sits inside the range recovered from the app, at its slow end', () => {
  // Recovered constants: 1250, 1650, 2500, 5000. Only 1250 is unambiguously
  // tied to a screen (security), so we take the slowest candidate until
  // REQUEST-19 Q5 says which delay belongs to which screen.
  assert.ok(FOCUS_INTERVAL_MS >= 1250 && FOCUS_INTERVAL_MS <= 5000);
  assert.equal(FOCUS_INTERVAL_MS, 5000);
  for (const focus of ['home', 'controls', 'climate'] as const) {
    assert.equal(readPlanFor(focus).intervalMs, FOCUS_INTERVAL_MS);
  }
});

test('the focused read is strictly cheaper than the full read it rides beside', () => {
  // The full read is 4 states / 60s = ~4 round trips per minute. The focused
  // read is 1 state / 5s = 12 per minute. Guard the ratio so a future edit
  // cannot quietly multiply link load: 1-state-at-5s is 12 trips/min, and
  // anything above ~15 would start crowding user commands.
  const plan = readPlanFor('home');
  const tripsPerMinute = (60_000 / plan.intervalMs) * plan.states.length;
  assert.ok(tripsPerMinute <= 15, `focused read costs ${tripsPerMinute} round trips/min`);
});
