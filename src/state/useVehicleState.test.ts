import { test } from 'node:test';
import assert from 'node:assert/strict';

import { actuateFrunkState, frunkActuateClaimedKeys } from './fleet';
import { initialVehicleState } from '../types/vehicleTypes';

// ── The frunk double-tap (P0, reported on-car 2026-07-27) ───────────────────
//
// Tap frunk, tap again while it is still physically opening. The car ends OPEN;
// the app showed CLOSED for up to 30s.
//
// THE FIX, recovered from the official app rather than reasoned about:
//
//   sendFrunkCommand @3986012
//     hasPoweredFrunk ? send(Front, !isOpen)   // a real directional close
//                     : send(Front, true)      // ALWAYS open. No close exists.
//
// A standard Model Y has no powered frunk, so their app has no way to express
// "close" — and therefore nothing to be optimistic about in that direction. The
// second tap re-sends the actuate; the UI only shows closed when the CAR says
// so. Ivan observed exactly this before I found it.
//
// So the optimistic value moves in ONE direction. Closed comes from the stream
// or the poll, whichever lands first. The divergence is then impossible at any
// timing, rather than merely unlikely — which matters, because my first attempt
// (drop a toggle while its command is in flight) only covered the ~1-2s the
// command takes, while the lid takes ~5s to open. A tap at t=3s still broke it.

test('actuating a CLOSED frunk optimistically opens it', () => {
  const next = actuateFrunkState({ ...initialVehicleState, frunkOpen: false });
  assert.equal(next.frunkOpen, true);
});

test('actuating an OPEN frunk changes NOTHING — closed comes from the car', () => {
  // The whole fix. We still send the command (their app does too, and Ivan's
  // aftermarket auto-close rides it), but we do not claim to know the result.
  const state = { ...initialVehicleState, frunkOpen: true };
  const next = actuateFrunkState(state);
  assert.equal(next.frunkOpen, true);
  assert.equal(next, state, 'same object: no state change, so nothing to reconcile or defend');
});

test('repeated actuation never drives the value to false', () => {
  // Ten taps in a row cannot produce the value the grace window would then
  // defend against the car's correcting read.
  let s = { ...initialVehicleState, frunkOpen: false };
  for (let i = 0; i < 10; i++) s = actuateFrunkState(s);
  assert.equal(s.frunkOpen, true);
});

test('the re-actuate tap claims NO keys, so it cannot suppress the car', () => {
  // The mirror bug, caught before shipping. `affectedKeys` on dispatch does two
  // jobs: it marks the control busy AND it stamps the intent-grace window that
  // suppresses contradicting reads.
  //
  // On the second tap we make no optimistic claim, so there is nothing to
  // protect — and stamping anyway would suppress exactly the read we are waiting
  // for. The car reports CLOSED, our value says OPEN, filterPatchUnderIntent
  // sees a contradiction and strips it for up to 30s. That is the original
  // defect with the directions reversed.
  //
  // So the keys we claim are the keys we actually moved.
  assert.deepEqual(frunkActuateClaimedKeys({ ...initialVehicleState, frunkOpen: false }), [
    'frunkOpen',
  ]);
  assert.deepEqual(frunkActuateClaimedKeys({ ...initialVehicleState, frunkOpen: true }), []);
});
