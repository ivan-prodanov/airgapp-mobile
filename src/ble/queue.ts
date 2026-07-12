// queue.ts — per-VIN FIFO command queue.
//
// Ported from the browser reference (rpi-webclient/client/state.js ~line 491
// `SessionQueue`). Tesla's per-domain session counter is monotonic; two
// commands in flight at once on the same VIN would race on that counter and
// corrupt the session. The reference queue is a single global FIFO chain
// (one queue instance per page load, one car). This port keys the same
// chaining pattern by VIN so multiple enrolled vehicles (future multi-VIN
// work, D6 in the plan) can run commands concurrently without serializing
// against each other, while commands for the SAME VIN still run one at a
// time, in the order they were enqueued.
//
// The reference's core trick: `run = tail.then(onFulfilled, onRejected)`
// where BOTH callbacks call `fn()`. That means the next job runs once the
// previous settles, REGARDLESS of whether it resolved or rejected — a
// failed command doesn't wedge the queue. `tail = run.catch(() => {})`
// swallows the error for chaining purposes only; the actual rejection is
// still delivered to the caller via the returned `run` promise.

export class SessionQueue {
  private tails = new Map<string, Promise<unknown>>();

  enqueue<T>(vin: string, job: () => Promise<T>): Promise<T> {
    const prevTail = this.tails.get(vin) ?? Promise.resolve();
    const run = prevTail.then(() => job(), () => job());
    this.tails.set(
      vin,
      run.catch(() => undefined),
    );
    return run;
  }
}
