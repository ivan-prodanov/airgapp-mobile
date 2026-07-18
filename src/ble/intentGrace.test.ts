// intentGrace.test.ts — the pure optimistic-intent-strip helper.
//
// Runs under plain node (intentGrace.ts imports only the view-state types).
// Proves: a patch key still under a live intent is stripped; an expired intent
// lets the key through AND is pruned from the map; unrelated keys pass; and the
// map's expired entries are pruned even when they aren't in the incoming patch.

import { test } from 'node:test';
import assert from 'node:assert/strict';

import { filterPatchUnderIntent, GRACE_MS } from './intentGrace';
import type { VehicleStateKey, VehicleViewState } from '../types/vehicleTypes';

test('GRACE_MS is 30s', () => {
  assert.equal(GRACE_MS, 30_000);
});

test('a key under a live intent is stripped from the patch', () => {
  const now = 1_000;
  const intent = new Map<VehicleStateKey, number>([['locked', now + 5_000]]);
  const patch: Partial<VehicleViewState> = { locked: false, awake: true };
  const out = filterPatchUnderIntent(patch, intent, now);
  assert.deepEqual(out, { awake: true }); // locked stripped, awake kept
});

test('an expired intent lets the key through and is pruned from the map', () => {
  const now = 10_000;
  const intent = new Map<VehicleStateKey, number>([['locked', now - 1]]);
  const patch: Partial<VehicleViewState> = { locked: true };
  const out = filterPatchUnderIntent(patch, intent, now);
  assert.deepEqual(out, { locked: true });
  assert.equal(intent.has('locked'), false); // pruned
});

test('an intent expiring exactly at now is treated as expired (passes through)', () => {
  const now = 500;
  const intent = new Map<VehicleStateKey, number>([['locked', now]]);
  const out = filterPatchUnderIntent({ locked: true }, intent, now);
  assert.deepEqual(out, { locked: true });
  assert.equal(intent.has('locked'), false);
});

test('unrelated keys pass through untouched', () => {
  const now = 0;
  const intent = new Map<VehicleStateKey, number>([['locked', now + 5_000]]);
  const patch: Partial<VehicleViewState> = { driverFrontDoorOpen: true, awake: false };
  const out = filterPatchUnderIntent(patch, intent, now);
  assert.deepEqual(out, { driverFrontDoorOpen: true, awake: false });
});

test('expired entries are pruned even when absent from the incoming patch', () => {
  const now = 100;
  const intent = new Map<VehicleStateKey, number>([
    ['locked', now - 1], // expired
    ['awake', now + 5_000], // live
  ]);
  const out = filterPatchUnderIntent({ trunkOpen: true }, intent, now);
  assert.deepEqual(out, { trunkOpen: true });
  assert.equal(intent.has('locked'), false); // expired pruned
  assert.equal(intent.has('awake'), true); // live survives
});

test('an empty patch stays empty', () => {
  const intent = new Map<VehicleStateKey, number>([['locked', 9_999]]);
  assert.deepEqual(filterPatchUnderIntent({}, intent, 0), {});
});

test('a false value under live intent is still stripped (not confused for absent)', () => {
  const now = 0;
  const intent = new Map<VehicleStateKey, number>([['locked', now + 5_000]]);
  const out = filterPatchUnderIntent({ locked: false }, intent, now);
  assert.deepEqual(out, {}); // the falsey value was present and got stripped
});

// ── confirm-and-release (with `current`) ────────────────────────────────────

test('CONFIRM: a read matching the optimistic value releases the grace and passes through', () => {
  const now = 0;
  const intent = new Map<VehicleStateKey, number>([['frunkOpen', now + 5_000]]);
  // Optimistically opened the frunk (current=true); the car confirms open.
  const out = filterPatchUnderIntent({ frunkOpen: true }, intent, now, { frunkOpen: true } as VehicleViewState);
  assert.deepEqual(out, { frunkOpen: true });
  assert.equal(intent.has('frunkOpen'), false); // grace RELEASED on confirmation
});

test('CONTRADICT: a read differing from the optimistic value is suppressed and keeps the grace', () => {
  const now = 0;
  const intent = new Map<VehicleStateKey, number>([['frunkOpen', now + 5_000]]);
  // Optimistic=true; a stale read says closed → suppress, grace stays.
  const out = filterPatchUnderIntent({ frunkOpen: false }, intent, now, { frunkOpen: true } as VehicleViewState);
  assert.deepEqual(out, {});
  assert.equal(intent.has('frunkOpen'), true); // still under grace
});

test('THE FRUNK BUG: confirm on open, then a real close applies immediately (no 30s wait)', () => {
  const intent = new Map<VehicleStateKey, number>([['frunkOpen', 30_000]]);
  // 1) You tapped open (current=true); the car's push confirms open → releases.
  let out = filterPatchUnderIntent({ frunkOpen: true }, intent, 1_000, { frunkOpen: true } as VehicleViewState);
  assert.deepEqual(out, { frunkOpen: true });
  assert.equal(intent.has('frunkOpen'), false);
  // 2) You then close it manually a few seconds later — well inside the old 30s
  //    window. With the grace released, the close now applies instantly.
  out = filterPatchUnderIntent({ frunkOpen: false }, intent, 5_000, { frunkOpen: true } as VehicleViewState);
  assert.deepEqual(out, { frunkOpen: false });
});
