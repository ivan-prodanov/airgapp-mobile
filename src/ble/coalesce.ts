// C2 — rapid-input coalescing.
//
// Plan Part 10 §C2: "debounce/coalesce double-taps on a control so the two
// commands + rollbacks don't race (reviewer-flagged double-tap edge)".
//
// THE PROBLEM. Two things generate bursts:
//   - a double-tap on a toggle (lock, lock) — the reviewer's edge;
//   - a SLIDER DRAG, once P3.T2's setpoints are wired: one command per sample,
//     ~60 a second, at a real car over BLE.
// The per-VIN FIFO already serialises execution, so ordering is safe. What is
// NOT safe is the ROLLBACKS. Each dispatch closes over "revert to the value
// before ME"; if command 1 fails after the user has already moved on to value 3,
// its rollback yanks the UI back to value 0 and clobbers a newer optimistic
// state that the car may well have accepted.
//
// THE RULE. Per lane (a lane = one set of affected fields):
//   1. At most ONE command in flight.
//   2. A submit while one is in flight replaces a single "next" slot — the
//      LATEST value wins; the intermediate ones never go to the car.
//   3. A superseded command's rollback is NEUTRALISED. The user has moved past
//      that value, so its failure must not drag the UI backwards. Only the last
//      command in a burst may roll back.
//
// A single tap is therefore dispatched IMMEDIATELY — no artificial latency, no
// debounce timer to tune. A burst collapses to at most two round-trips: the one
// already in flight, plus the final value.
//
// Lanes are keyed on the affected fields, so `locked` and `chargeLimitPercent`
// never block each other. Commands with NO declared keys are never coalesced —
// we can't reason about what they'd supersede, so they always run.
//
// Pure and node-tested: no react-native import (the ble/* isolation rule).

import { logi } from '../services/logbus';

export interface CoalesceJob<C> {
  cmd: C;
  // Reverts the optimistic UI. Called only if THIS job is still the newest in
  // its lane when it fails — see rule 3.
  rollback: () => void;
  // The VehicleStateKeys this command changes. Empty ⇒ never coalesced.
  keys: readonly string[];
}

// `run` must resolve when the command is fully settled (ok, failed, or threw) —
// its rejection is not our business; the caller already surfaces failures.
export type RunJob<C> = (cmd: C, rollback: () => void, keys: readonly string[]) => Promise<void>;

export interface Coalescer<C> {
  submit(job: CoalesceJob<C>): void;
  // Testing/diagnostics: how many lanes are busy.
  activeLanes(): number;
}

const laneOf = (keys: readonly string[]) => [...keys].sort().join('|');

interface LaneState<C> {
  next: CoalesceJob<C> | null;
  // Set on the job currently in flight, so we can neutralise it if superseded.
  supersede: (() => void) | null;
}

export function createCoalescer<C>(run: RunJob<C>): Coalescer<C> {
  const lanes = new Map<string, LaneState<C>>();

  const start = (lane: string, job: CoalesceJob<C>) => {
    const state = lanes.get(lane);
    if (!state) return;
    // `live` gates the rollback: flipped false the moment a newer job for this
    // lane arrives, so the in-flight command's failure becomes silent-to-the-UI
    // (the newer optimistic value stands, and the 20s poll reconciles truth).
    let live = true;
    state.supersede = () => {
      live = false;
    };
    const guarded = () => {
      if (live) job.rollback();
    };
    void run(job.cmd, guarded, job.keys).then(settle(lane), settle(lane));
  };

  const settle = (lane: string) => () => {
    const state = lanes.get(lane);
    if (!state) return;
    const next = state.next;
    state.next = null;
    state.supersede = null;
    if (next) {
      start(lane, next);
      return;
    }
    lanes.delete(lane);
  };

  return {
    submit(job) {
      if (job.keys.length === 0) {
        // Nothing to coalesce on — run it and forget it.
        void run(job.cmd, job.rollback, job.keys);
        return;
      }
      const lane = laneOf(job.keys);
      const state = lanes.get(lane);
      if (!state) {
        lanes.set(lane, { next: null, supersede: null });
        logi('coalesce', 'run', { lane });
        start(lane, job);
        return;
      }
      // Busy: this job supersedes whatever is in flight AND any job already
      // queued behind it. Both of their rollbacks are now stale.
      logi('coalesce', 'supersede', { lane, hadQueued: state.next !== null });
      state.supersede?.();
      state.next = job;
    },
    activeLanes: () => lanes.size,
  };
}
