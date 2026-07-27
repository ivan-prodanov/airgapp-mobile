// queue.ts — per-VIN command queue, with priority.
//
// Ported from the browser reference (rpi-webclient/client/state.js ~line 491
// `SessionQueue`). Tesla's per-domain session counter is monotonic; two commands
// in flight at once on the same VIN would race on that counter and corrupt the
// session. So work for one VIN runs strictly one at a time — that part is
// unchanged and non-negotiable. Different VINs still run concurrently.
//
// WHAT CHANGED, AND WHY (2026-07-26). The original was a bare promise chain:
//
//     const run = tail.then(() => job(), () => job());
//
// which cannot reorder. Everything queued behind everything else, so a lock tap
// landed behind whatever background read happened to be in flight. PE-4 measured
// the cost: a tap during a drive-read loop took 513ms worst-case against 177ms
// idle, purely from waiting its turn.
//
// The rule for this project is that unlocking the car outranks whatever else is
// happening. Passive entry already bypasses this queue entirely (it writes under
// the link's write lock, hence 2ms), and a failing background read can no longer
// evict the lock session (see evictScopeFor). This closes the last gap: a user
// command jumps AHEAD of queued background work.
//
// What it deliberately does NOT do is preempt. A job already on the wire runs to
// completion — a BLE exchange cannot be abandoned mid-counter — so the floor for
// a user command is one in-flight read, ~180-250ms. That is a real bound rather
// than a tuned number, and it is exactly what the priority buys: the worst case
// stops being "however much background work is queued" and becomes "one read".
//
// The reference's core trick is preserved: a job that REJECTS must not wedge the
// queue, and its rejection reaches its own caller and nobody else's.

export type JobPriority =
  // Anything the user is waiting on: lock, unlock, drive, pull-to-refresh.
  | 'user'
  // Polls and speculative reads. The only thing that yields.
  | 'background';

interface QueuedJob {
  run: () => Promise<unknown>;
  resolve: (v: unknown) => void;
  reject: (e: unknown) => void;
}

interface Lane {
  user: QueuedJob[];
  background: QueuedJob[];
  draining: boolean;
}

export class SessionQueue {
  private lanes = new Map<string, Lane>();

  // priority defaults to 'user' ON PURPOSE. Background work must opt IN to
  // yielding: a caller that has not thought about it is treated as important, so
  // the cost of forgetting is a slower poll, never a slower unlock.
  enqueue<T>(vin: string, job: () => Promise<T>, opts?: { priority?: JobPriority }): Promise<T> {
    const lane = this.laneFor(vin);
    return new Promise<T>((resolve, reject) => {
      const entry: QueuedJob = {
        run: job,
        resolve: resolve as (v: unknown) => void,
        reject,
      };
      if (opts?.priority === 'background') lane.background.push(entry);
      else lane.user.push(entry);
      void this.drain(vin);
    });
  }

  // Queue depth, for instrumentation. Excludes the job currently running.
  depth(vin: string): { user: number; background: number } {
    const lane = this.lanes.get(vin);
    return { user: lane?.user.length ?? 0, background: lane?.background.length ?? 0 };
  }

  private laneFor(vin: string): Lane {
    let lane = this.lanes.get(vin);
    if (!lane) {
      lane = { user: [], background: [], draining: false };
      this.lanes.set(vin, lane);
    }
    return lane;
  }

  private async drain(vin: string): Promise<void> {
    const lane = this.laneFor(vin);
    if (lane.draining) return; // one runner per VIN — the serialization guarantee
    lane.draining = true;
    try {
      for (;;) {
        // Re-read every iteration rather than snapshotted: a user command that
        // arrives WHILE a background job is running must go next, not behind the
        // rest of the background backlog. That is the whole point.
        const next = lane.user.shift() ?? lane.background.shift();
        if (!next) break;
        try {
          next.resolve(await next.run());
        } catch (e) {
          next.reject(e);
        }
        // Yield one microtask before starting the next job.
        //
        // The old promise chain gave this for free: `tail.then(...)` scheduled
        // the next job a microtask after the previous settled, so a caller's
        // own `.then` ran BEFORE the queue moved on. Draining in a tight loop
        // would start the next job first and change observable ordering for
        // anyone awaiting a command. Preserved deliberately — this rewrite is
        // about priority, and it should change nothing else.
        await Promise.resolve();
      }
    } finally {
      lane.draining = false;
      // A job enqueued between the empty check and clearing the flag would
      // otherwise sit forever with no runner to pick it up.
      if (lane.user.length > 0 || lane.background.length > 0) void this.drain(vin);
    }
  }
}

// sharedSessionQueue — THE queue. One per process, not one per gateway.
//
// Why a singleton rather than a parameter callers remember to pass: the session
// cache (_domainCache in session.ts) is already MODULE-LEVEL, so every gateway
// in the app operates on the SAME cached session — same monotonic counter, same
// routing address. A gateway with its own queue therefore does not get its own
// session; it gets a second, unsynchronised writer onto the shared one.
//
// Measured 2026-07-27 04:38-04:41: the Car Link debug screen builds its own
// gateway, so its commands and the app's polls interleaved on one counter. The
// probe's commands degraded to 25 SECONDS while the app's own polls in the same
// seconds completed in 170ms. The link was fine; the counter was being raced.
//
// CreateCarGatewayArgs.queue stays injectable for tests, but the DEFAULT is now
// this one, so a new call site is safe by omission rather than by remembering.
export const sharedSessionQueue = new SessionQueue();

// Test hook. Drops queued work — jobs already awaiting stay unresolved, which is
// fine between tests and would be a bug anywhere else.
export function __resetSharedSessionQueue(): void {
  (sharedSessionQueue as unknown as { lanes: Map<string, unknown> }).lanes.clear();
}
