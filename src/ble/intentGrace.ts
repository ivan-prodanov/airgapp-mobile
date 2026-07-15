// intentGrace.ts — the pure optimistic-intent-strip helper for the liveness poll.
//
// When the user taps a control (e.g. lock), the fleet layer optimistically sets
// the field and dispatches the real command; the car's Hall/lock sensors lag, so
// a VCSEC telemetry read 1–20s later can still report the OLD value. To stop the
// poll from reverting a change the user just made, useCarLink stamps each
// user-changed VehicleStateKey with a grace expiry (now + GRACE_MS) and runs each
// incoming telemetry patch through this filter: any key still inside its grace
// window is stripped, so the stale read never overwrites the optimistic value.
//
// This is the uniform, key-based grace the brief asks for — applied to lock,
// awake and every closure alike, keyed by VehicleStateKey — which is why the poll
// passes an EMPTY closureIntent to vcsecStatusToPatch and does the grace HERE.
//
// PURE — imports only the view-state types, so it (and its test) run under plain
// node. The one side effect is pruning expired entries from the passed intent map
// (the caller's ref), which is exactly the housekeeping the brief specifies.

import type { VehicleStateKey, VehicleViewState } from '../types/vehicleTypes';

// Grace window: how long after a user-initiated change a contradicting telemetry
// read for the same field is suppressed. Matches telemetry.ts's closure grace.
export const GRACE_MS = 30_000;

// filterPatchUnderIntent returns a copy of `patch` with every key still under a
// LIVE intent (expiry > now) removed, and — as a side effect — deletes every
// EXPIRED entry (expiry <= now) from `intent`. An entry expiring exactly at `now`
// counts as expired (the grace has elapsed), so the field passes through and the
// intent is dropped.
export function filterPatchUnderIntent(
  patch: Partial<VehicleViewState>,
  intent: Map<VehicleStateKey, number>,
  now: number,
): Partial<VehicleViewState> {
  // Prune expired intents first (housekeeping); safe to delete while iterating a Map.
  for (const [key, expiry] of intent) {
    if (expiry <= now) intent.delete(key);
  }

  const src = patch as Record<string, unknown>;
  const out: Record<string, unknown> = {};
  for (const key of Object.keys(patch) as VehicleStateKey[]) {
    const expiry = intent.get(key);
    if (expiry !== undefined && expiry > now) continue; // still under live intent → strip
    out[key] = src[key];
  }
  return out as Partial<VehicleViewState>;
}
