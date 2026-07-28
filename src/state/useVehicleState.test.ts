import { test } from 'node:test';
import assert from 'node:assert/strict';

import { buildVehicleActions } from './useVehicleState';
import { initialVehicleState } from '../types/vehicleTypes';
import type { VehicleStateKey, VehicleViewState } from '../types/vehicleTypes';

// ── The frunk double-tap (P0, reported on-car 2026-07-27) ───────────────────
//
// Tap frunk, tap it again while the car is still physically opening. The car
// ends OPEN; the app shows CLOSED and stays wrong for up to 30 seconds.
//
// ROOT CAUSE, read rather than inferred: `toggleState` derives the new value
// from `state[key]` — the CURRENT value, which after tap 1 is an UNCONFIRMED
// optimistic guess. Frunk actuate is a TOGGLE (both taps send the same
// openFrunk), so the car may ignore the second command outright while the lid
// is mid-travel. Our model then holds a value the car never agreed to, and
// filterPatchUnderIntent defends it: the car's correcting read CONTRADICTS the
// optimistic value, and confirm-and-release only releases on AGREEMENT.
//
// Note what this means: confirm-and-release (shipped 2026-07-18, nine days
// BEFORE the report) cannot help here by construction, and shortening GRACE_MS
// would only shorten the wrong state. The fix has to stop the bad optimistic
// value from being produced.
//
// Lock does not have this bug because lock/unlock are ABSOLUTE commands: two
// taps ask for two different states and the car honours both.

function harness(inFlight: Set<VehicleStateKey>) {
  let state: VehicleViewState = { ...initialVehicleState };
  const actions = buildVehicleActions(
    (update) => {
      state = update(state);
    },
    (key) => inFlight.has(key),
  );
  return { actions, get: () => state };
}

test('the first tap toggles normally', () => {
  const { actions, get } = harness(new Set());
  assert.equal(get().frunkOpen, false);
  actions.toggle('frunkOpen');
  assert.equal(get().frunkOpen, true);
});

test('a second tap while the command is in flight does NOT toggle again', () => {
  // The defect. Without the guard this flips back to false, and the grace then
  // suppresses the car's "actually, I am open" for the rest of the window.
  const inFlight = new Set<VehicleStateKey>();
  const { actions, get } = harness(inFlight);

  actions.toggle('frunkOpen');
  assert.equal(get().frunkOpen, true, 'tap 1 applies');

  inFlight.add('frunkOpen'); // the command is now on its way to the car
  actions.toggle('frunkOpen');
  assert.equal(get().frunkOpen, true, 'tap 2 must be ignored, not derive from an unconfirmed value');
});

test('once the command settles, the control works again', () => {
  // The guard must last only as long as the command, NOT the 30s grace — the
  // frunk actuates in ~5s and a control dead for 30s would be its own bug.
  const inFlight = new Set<VehicleStateKey>(['frunkOpen']);
  const { actions, get } = harness(inFlight);

  actions.toggle('frunkOpen');
  assert.equal(get().frunkOpen, false, 'blocked while in flight');

  inFlight.delete('frunkOpen');
  actions.toggle('frunkOpen');
  assert.equal(get().frunkOpen, true, 'released once settled');
});

test('an unrelated key is unaffected by a busy one', () => {
  // The guard is per-key. A frunk command in flight must not freeze the lock.
  const { actions, get } = harness(new Set<VehicleStateKey>(['frunkOpen']));
  actions.toggle('locked');
  assert.equal(get().locked, !initialVehicleState.locked);
});

test('with no predicate supplied, every toggle applies', () => {
  // Demo cars and tests build actions without a car link; they must not be
  // silently frozen by a defaulted-truthy guard.
  let state: VehicleViewState = { ...initialVehicleState };
  const actions = buildVehicleActions((update) => {
    state = update(state);
  });
  actions.toggle('frunkOpen');
  assert.equal(state.frunkOpen, true);
});
