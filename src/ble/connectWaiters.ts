// connectWaiters.ts — callers waiting for the native BLE link to come up.
//
// The wait used to always run its full budget, and it sits inside openSession,
// which runs inside the per-VIN command queue. So a wait nobody needed any more
// (after a token change, say) kept every newer command queued behind it. That is
// why it can now be cut short: by a zero budget, or by the generation retiring.
//
// Split out of foregroundBleLink so it can be tested: that file imports the
// native module and cannot load under node.

import { GenerationCancelledError } from './cancelled';

interface Waiter {
  resolve: () => void;
  timer: ReturnType<typeof setTimeout>;
  detach: () => void;
}

export class ConnectWaiters {
  private waiters: Waiter[] = [];

  get size(): number {
    return this.waiters.length;
  }

  wait(timeoutMs: number, lifetime?: AbortSignal): Promise<void> {
    if (lifetime?.aborted) return Promise.reject(new GenerationCancelledError());
    const failure = () =>
      new Error(
        `BLE connection closed — native central did not connect within ${timeoutMs}ms (car asleep/out of range?)`,
      );
    if (timeoutMs <= 0) return Promise.reject(failure());

    return new Promise<void>((resolve, reject) => {
      const onRetire = () => {
        this.remove(waiter);
        reject(new GenerationCancelledError());
      };
      const waiter: Waiter = {
        resolve,
        timer: setTimeout(() => {
          this.remove(waiter);
          reject(failure());
        }, timeoutMs),
        detach: () => lifetime?.removeEventListener('abort', onRetire),
      };
      lifetime?.addEventListener('abort', onRetire);
      this.waiters.push(waiter);
    });
  }

  resolveAll(): void {
    const pending = this.waiters;
    this.waiters = [];
    for (const w of pending) {
      clearTimeout(w.timer);
      w.detach();
      w.resolve();
    }
  }

  private remove(waiter: Waiter): void {
    clearTimeout(waiter.timer);
    waiter.detach();
    this.waiters = this.waiters.filter((w) => w !== waiter);
  }
}
