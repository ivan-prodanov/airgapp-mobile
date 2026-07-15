// reconcile.test.ts — the pure diffToCommands / revertLockedIfNeeded tests.
//
// Runs under plain node (reconcile.ts imports only the CarCommand union + the
// view-state type). Asserts the exact command list the reconciler emits for
// the locked transitions, that no command is emitted for a no-op or an
// unrelated field change, and that the rollback reverts only `locked`.

import { test } from 'node:test';
import assert from 'node:assert/strict';

import { diffToCommands, revertLockedIfNeeded } from './reconcile';
import { initialVehicleState, type VehicleViewState } from '../types/vehicleTypes';

const base: VehicleViewState = initialVehicleState;

test('diffToCommands: unlocked → locked emits lock', () => {
  const prev: VehicleViewState = { ...base, locked: false };
  const next: VehicleViewState = { ...base, locked: true };
  assert.deepEqual(diffToCommands(prev, next), [{ type: 'lock' }]);
});

test('diffToCommands: locked → unlocked emits unlock', () => {
  const prev: VehicleViewState = { ...base, locked: true };
  const next: VehicleViewState = { ...base, locked: false };
  assert.deepEqual(diffToCommands(prev, next), [{ type: 'unlock' }]);
});

test('diffToCommands: no change emits nothing', () => {
  const prev: VehicleViewState = { ...base, locked: true };
  const next: VehicleViewState = { ...base, locked: true };
  assert.deepEqual(diffToCommands(prev, next), []);
});

test('diffToCommands: an unrelated field change emits nothing', () => {
  const prev: VehicleViewState = { ...base, cameraMode: 'PARKED' };
  const next: VehicleViewState = { ...base, cameraMode: 'CLIMATE' };
  assert.deepEqual(diffToCommands(prev, next), []);
});

test('revertLockedIfNeeded: restores locked to prev, leaves other edits intact', () => {
  const prev: VehicleViewState = { ...base, locked: true, climateOn: false };
  // state after optimistic unlock plus an unrelated later edit (climate on).
  const state: VehicleViewState = { ...base, locked: false, climateOn: true };
  const reverted = revertLockedIfNeeded(state, prev);
  assert.equal(reverted.locked, true); // locked rolled back
  assert.equal(reverted.climateOn, true); // unrelated edit preserved
});

test('revertLockedIfNeeded: returns the same object when locked already matches', () => {
  const prev: VehicleViewState = { ...base, locked: true };
  const state: VehicleViewState = { ...base, locked: true, climateOn: true };
  assert.equal(revertLockedIfNeeded(state, prev), state);
});
