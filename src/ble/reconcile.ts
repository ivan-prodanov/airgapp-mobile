// reconcile.ts — the pure user-action → CarCommand reconciler.
//
// diffToCommands maps a USER-INITIATED optimistic state change (prev → next)
// to the car command(s) that realize it. This is the single extensible seam
// between the app's view-state and the BLE command layer: every future
// control lights up by adding one `prev.field !== next.field` case here, with
// no per-button wiring. It is deliberately PURE (imports only the CarCommand
// union + the view-state type) so it runs and is unit-tested under plain node.
//
// CRITICAL: this must ONLY ever be fed the USER-action apply path (the wrapped
// apply in useFleetState). It must NEVER see telemetry-driven state mutations —
// if it did, an incoming lock-status telemetry patch would diff into a lock
// command and loop back out to the car. The two write paths (user vs telemetry)
// are kept separate at the apply layer precisely so this stays a one-way map.
//
// For this slice only `locked` is mapped. revertLockedIfNeeded is the matching
// rollback: it reverts ONLY the `locked` field when a dispatched lock/unlock
// command fails, leaving every other (independently-applied) field untouched.

import type { CarCommand } from './commands';
import type { VehicleViewState } from '../types/vehicleTypes';

export function diffToCommands(prev: VehicleViewState, next: VehicleViewState): CarCommand[] {
  const commands: CarCommand[] = [];
  if (prev.locked !== next.locked) {
    commands.push({ type: next.locked ? 'lock' : 'unlock' });
  }
  return commands;
}

// revertLockedIfNeeded returns state with `locked` restored to prev.locked.
// Used as the rollback for a failed lock/unlock: it touches only that one
// field so any other user edit applied since the optimistic toggle survives.
export function revertLockedIfNeeded(
  state: VehicleViewState,
  prev: VehicleViewState,
): VehicleViewState {
  return state.locked === prev.locked ? state : { ...state, locked: prev.locked };
}
