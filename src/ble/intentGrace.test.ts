// intentGrace.test.ts — the pure optimistic-intent-strip helper.
//
// Runs under plain node (intentGrace.ts imports only the view-state types).
// Proves: a patch key still under a live intent is stripped; an expired intent
// lets the key through AND is pruned from the map; unrelated keys pass; and the
// map's expired entries are pruned even when they aren't in the incoming patch.

import { initialVehicleState } from '../types/vehicleTypes';
import { test } from 'node:test';
import assert from 'node:assert/strict';

import { filterPatchUnderIntent, releaseIntent, GRACE_MS, SETTLE_GRACE_MS } from './intentGrace';
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

// Regression: a media command must NOT put `media` under the intent grace.
//
// `media` is a single VehicleStateKey holding title, artist, album AND
// playbackStatus. Stamping it for GRACE_MS (30s) to protect an optimistic
// play/pause flip suppressed the entire card's telemetry for half a minute —
// press pause, then next, and the title could not change until the window
// expired. Measured on-car as "stuck 20+ seconds".
test('media under grace freezes the WHOLE card, which is why we do not stamp it', () => {
  const now = 1_000_000;
  const intent = new Map<VehicleStateKey, number>([['media', now + GRACE_MS]]);
  const patch = {
    media: {
      remoteControlEnabled: true,
      title: 'A different song',
      artist: 'A different artist',
      album: null,
      station: null,
      playbackStatus: 1,
      sourceType: 12,
      sourceName: null,
      volume: 5,
      volumeMax: 11,
      volumeIncrement: 1,
      elapsedSec: 3,
      durationSec: 200,
    },
  } as unknown as Partial<VehicleViewState>;

  const filtered = filterPatchUnderIntent(patch, intent, now, initialVehicleState);

  // This is the DAMAGE, asserted so nobody re-adds the stamp thinking it is
  // harmless: a track change is invisible for the whole window.
  assert.equal('media' in filtered, false);
});

// ── releaseIntent ───────────────────────────────────────────────────────────
//
// Ivan's trunk test, Tesla vs ours:
//
//   press Open Trunk, tap again midway
//     theirs: app shows closed -> car freezes midway -> ~1s later app shows OPEN
//     ours:   app shows closed -> car freezes midway -> ~30s later app shows OPEN
//
// Same optimistic flip; the difference is entirely how long the wrong value is
// DEFENDED. Theirs drops the optimistic entry on VEHICLE_COMMAND_SUCCESS
// (correlated by commandId), so the very next data render shows the truth. Ours
// held the key for the full GRACE_MS because nothing released it on settle.
//
// So the optimistic value exists to cover the COMMAND'S OWN LATENCY, and no
// longer. Once the car has answered, the car is authoritative. GRACE_MS stays
// only as the backstop for a command that never settles at all.
test('releaseIntent drops exactly the keys it is given', () => {
  const intent = new Map<VehicleStateKey, number>([
    ['trunkOpen', 9_000],
    ['locked', 9_000],
  ]);
  releaseIntent(intent, ['trunkOpen']);
  assert.equal(intent.has('trunkOpen'), false);
  assert.equal(intent.has('locked'), true, 'an unrelated key keeps its protection');
});

test('after release, a contradicting read applies immediately', () => {
  // The whole point. Before: the read is stripped until the window elapses.
  const intent = new Map<VehicleStateKey, number>([['trunkOpen', 9_000]]);
  const current = { trunkOpen: false }; // optimistic "closed" from the 2nd tap

  const suppressed = filterPatchUnderIntent({ trunkOpen: true }, intent, 1_000, current);
  assert.deepEqual(suppressed, {}, 'still defended while the command is in flight');

  releaseIntent(intent, ['trunkOpen']); // command settled
  const applied = filterPatchUnderIntent({ trunkOpen: true }, intent, 1_100, current);
  assert.deepEqual(applied, { trunkOpen: true }, 'car wins the moment its command answered');
});

test('releasing an absent key is a no-op, not a throw', () => {
  const intent = new Map<VehicleStateKey, number>();
  releaseIntent(intent, ['trunkOpen', 'locked']);
  assert.equal(intent.size, 0);
});

// ── the measured on-car sequence ────────────────────────────────────────────
//
// Replays what the log actually showed for "tap Open Trunk", which is the case
// that flickered:
//
//   cmd settle {openTrunk, ms:132, ok}
//   +30ms  push {closures:{}}              -> all closed  (TRANSIENT, stale)
//   +60ms  push {rearTrunk:"open"}         -> the truth
test('the transient all-closed frame is suppressed; the truth releases', () => {
  const intent = new Map<VehicleStateKey, number>();
  const optimistic = { trunkOpen: true }; // user tapped Open

  // Dispatch stamps the long window; settle shortens it to +SETTLE_GRACE_MS.
  const settledAt = 1_000;
  intent.set('trunkOpen', settledAt + SETTLE_GRACE_MS);

  // +30ms — the stale "all closed" push. Must NOT reach the UI.
  const transient = filterPatchUnderIntent({ trunkOpen: false }, intent, settledAt + 30, optimistic);
  assert.deepEqual(transient, {}, 'stale frame suppressed — this was the flicker');

  // +90ms — the real "open" push AGREES, so confirm-and-release lets it through
  // and drops the window, leaving later changes unprotected as they should be.
  const truth = filterPatchUnderIntent({ trunkOpen: true }, intent, settledAt + 90, optimistic);
  assert.deepEqual(truth, { trunkOpen: true });
  assert.equal(intent.has('trunkOpen'), false, 'confirmed, so released immediately');
});

test('a wrong optimistic value corrects about a second after settle', () => {
  // The double-tap: optimistic CLOSED, but the trunk froze half-open so the car
  // keeps saying open. Nothing ever confirms, so the settle window is what
  // bounds it — ~1.5s, not the 30s backstop.
  const intent = new Map<VehicleStateKey, number>();
  const optimistic = { trunkOpen: false };
  const settledAt = 1_000;
  intent.set('trunkOpen', settledAt + SETTLE_GRACE_MS);

  const during = filterPatchUnderIntent({ trunkOpen: true }, intent, settledAt + 500, optimistic);
  assert.deepEqual(during, {}, 'still protected while the transient could arrive');

  const after = filterPatchUnderIntent(
    { trunkOpen: true },
    intent,
    settledAt + SETTLE_GRACE_MS + 1,
    optimistic,
  );
  assert.deepEqual(after, { trunkOpen: true }, 'car wins ~1.5s after settle, not 30s');
});
