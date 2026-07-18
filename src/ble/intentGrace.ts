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

// filterPatchUnderIntent returns a copy of `patch` with keys handled per their
// optimistic-intent state, and — as a side effect — prunes the `intent` map.
//
// CONFIRM-AND-RELEASE (not a blind timer): the 30s window is only a FALLBACK
// ceiling. For a key still under a live intent, an incoming read is either:
//   • a CONFIRMATION — its value equals the current (optimistic) value → the
//     command has landed, so release the intent immediately and let it through.
//     A later REAL change (e.g. you manually close the frunk you opened in-app)
//     then applies instantly instead of being suppressed for the rest of 30s.
//   • a CONTRADICTION — its value differs from the current value → a stale read
//     that predates the command → suppress it (keep the optimistic value) until
//     confirmed or the window elapses.
// Pass `current` (the active view state) to enable this; omit it to fall back to
// the pure timer (suppress every read for a live key). An entry expiring exactly
// at `now` counts as expired.
export function filterPatchUnderIntent(
  patch: Partial<VehicleViewState>,
  intent: Map<VehicleStateKey, number>,
  now: number,
  current?: Partial<VehicleViewState>,
): Partial<VehicleViewState> {
  // Prune expired intents first (housekeeping); safe to delete while iterating a Map.
  for (const [key, expiry] of intent) {
    if (expiry <= now) intent.delete(key);
  }

  const src = patch as Record<string, unknown>;
  const cur = (current ?? {}) as Record<string, unknown>;
  const out: Record<string, unknown> = {};
  for (const key of Object.keys(patch) as VehicleStateKey[]) {
    const expiry = intent.get(key);
    if (expiry === undefined || expiry <= now) {
      out[key] = src[key]; // no live intent → apply
      continue;
    }
    // Live intent. A read that CONFIRMS the optimistic value releases the grace
    // (the command visibly landed); a contradicting read is suppressed.
    if (current !== undefined && src[key] === cur[key]) {
      intent.delete(key);
      out[key] = src[key];
    }
    // else: contradiction within grace → strip (optimistic value stands)
  }
  return out as Partial<VehicleViewState>;
}
