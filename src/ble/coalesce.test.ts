import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

import { createCoalescer } from './coalesce.ts';

// A controllable fake command runner: each call parks until the test settles it.
function makeRunner() {
  const started: string[] = [];
  const rollbacks: (() => void)[] = [];
  let resolvers: (() => void)[] = [];
  const run = (cmd: string, rollback: () => void) => {
    started.push(cmd);
    rollbacks.push(rollback);
    return new Promise<void>((resolve) => resolvers.push(resolve));
  };
  return {
    run,
    started,
    // Settle the oldest in-flight command, optionally failing it (which fires
    // whatever rollback the coalescer handed it).
    async settle({ fail = false } = {}) {
      const resolve = resolvers.shift();
      const rollback = rollbacks.shift();
      if (fail) rollback?.();
      resolve?.();
      await Promise.resolve();
      await Promise.resolve();
    },
  };
}

const job = (cmd: string, keys: string[], rollback: () => void) => ({ cmd, keys, rollback });

describe('createCoalescer — a single action must not be delayed', () => {
  it('runs the first job immediately, no debounce to wait out', () => {
    const r = makeRunner();
    const c = createCoalescer<string>(r.run);
    c.submit(job('lock', ['locked'], () => {}));
    assert.deepEqual(r.started, ['lock'], 'a lone tap goes straight to the car');
  });
});

describe('createCoalescer — a burst collapses to the LATEST value', () => {
  it('sends the in-flight one, then only the FINAL of the queued burst', async () => {
    const r = makeRunner();
    const c = createCoalescer<string>(r.run);
    // A slider drag: one command per sample.
    for (const v of ['80', '85', '90', '95']) c.submit(job(v, ['chargeLimitPercent'], () => {}));
    assert.deepEqual(r.started, ['80'], 'only one in flight');
    await r.settle();
    // 85 and 90 never reach the car — 95 superseded them.
    assert.deepEqual(r.started, ['80', '95'], '4 samples -> 2 round-trips');
    await r.settle();
    assert.equal(c.activeLanes(), 0, 'lane released when the burst drains');
  });

  it('holds at most one in flight per lane', async () => {
    const r = makeRunner();
    const c = createCoalescer<string>(r.run);
    c.submit(job('a', ['k'], () => {}));
    c.submit(job('b', ['k'], () => {}));
    c.submit(job('c', ['k'], () => {}));
    assert.equal(r.started.length, 1);
    await r.settle();
    assert.equal(r.started.length, 2);
  });
});

describe('createCoalescer — the rollback race (the reason C2 exists)', () => {
  it('NEUTRALISES a superseded job’s rollback', async () => {
    const r = makeRunner();
    const c = createCoalescer<string>(r.run);
    let reverted = 0;
    // Tap 1 dispatches and is still in flight...
    c.submit(job('lock', ['locked'], () => (reverted += 1)));
    // ...when tap 2 arrives. The user has moved on.
    c.submit(job('unlock', ['locked'], () => {}));
    // Tap 1 now FAILS. Its rollback must NOT drag the UI back to "unlocked" —
    // the user's newer optimistic state (and command) stands.
    await r.settle({ fail: true });
    assert.equal(reverted, 0, 'a superseded failure must not clobber a newer value');
  });

  it('the LAST job in a burst still rolls back normally', async () => {
    const r = makeRunner();
    const c = createCoalescer<string>(r.run);
    let reverted = 0;
    c.submit(job('lock', ['locked'], () => {}));
    c.submit(job('unlock', ['locked'], () => (reverted += 1)));
    await r.settle(); // the first succeeds
    await r.settle({ fail: true }); // the last fails
    assert.equal(reverted, 1, 'the newest command owns the UI, so it must revert it');
  });
});

describe('createCoalescer — lanes are independent', () => {
  it('does not let one field block another', () => {
    const r = makeRunner();
    const c = createCoalescer<string>(r.run);
    c.submit(job('lock', ['locked'], () => {}));
    c.submit(job('limit', ['chargeLimitPercent'], () => {}));
    assert.deepEqual(r.started, ['lock', 'limit'], 'different fields run concurrently');
    assert.equal(c.activeLanes(), 2);
  });

  it('treats the same key-set as one lane regardless of key order', () => {
    const r = makeRunner();
    const c = createCoalescer<string>(r.run);
    c.submit(job('a', ['x', 'y'], () => {}));
    c.submit(job('b', ['y', 'x'], () => {}));
    assert.deepEqual(r.started, ['a'], 'sorted lane key — order must not split the lane');
  });
});

describe('createCoalescer — keyless commands', () => {
  it('never coalesces a command with no declared keys', () => {
    // We cannot reason about what it would supersede, so it always runs.
    const r = makeRunner();
    const c = createCoalescer<string>(r.run);
    c.submit(job('honk', [], () => {}));
    c.submit(job('honk', [], () => {}));
    assert.deepEqual(r.started, ['honk', 'honk']);
    assert.equal(c.activeLanes(), 0);
  });
});

describe('createCoalescer — a rejecting runner must not wedge the lane', () => {
  it('drains the queue even if run() rejects', async () => {
    const started: string[] = [];
    let reject: ((e: unknown) => void) | null = null;
    const run = (cmd: string) => {
      started.push(cmd);
      return new Promise<void>((_res, rej) => (reject = rej));
    };
    const c = createCoalescer<string>(run);
    c.submit(job('a', ['k'], () => {}));
    c.submit(job('b', ['k'], () => {}));
    reject?.(new Error('boom'));
    await Promise.resolve();
    await Promise.resolve();
    assert.deepEqual(started, ['a', 'b'], 'a thrown command still releases the lane');
  });
});

// --- C3: in-flight cancellation on supersede ---------------------------------

describe('createCoalescer — C3 aborts a superseded in-flight command', () => {
  it("aborts the in-flight job's signal the moment a newer job lands in its lane", async () => {
    const signals: AbortSignal[] = [];
    let resolvers: (() => void)[] = [];
    const run = (_cmd: string, _rollback: () => void, _keys: readonly string[], signal: AbortSignal) => {
      signals.push(signal);
      return new Promise<void>((resolve) => resolvers.push(resolve));
    };
    const c = createCoalescer<string>(run);

    c.submit(job('lock', ['locked'], () => {}));
    assert.equal(signals.length, 1);
    assert.equal(signals[0].aborted, false, 'a lone command is not cancelled');

    // The user changes their mind while the first is still retrying.
    c.submit(job('unlock', ['locked'], () => {}));
    assert.equal(
      signals[0].aborted,
      true,
      'superseded command is told to stop retrying instead of holding its lane for the full deadline',
    );

    // The superseded command settles; the newer value then runs with a LIVE signal.
    resolvers.shift()?.();
    await Promise.resolve();
    await Promise.resolve();
    assert.equal(signals.length, 2, 'the newer value is dispatched');
    assert.equal(signals[1].aborted, false, 'the newest command is not born cancelled');
  });

  it('never aborts a command in a DIFFERENT lane', async () => {
    const signals: AbortSignal[] = [];
    const run = (_cmd: string, _rollback: () => void, _keys: readonly string[], signal: AbortSignal) => {
      signals.push(signal);
      return new Promise<void>(() => {});
    };
    const c = createCoalescer<string>(run);

    c.submit(job('lock', ['locked'], () => {}));
    c.submit(job('limit', ['chargeLimitPercent'], () => {}));
    assert.equal(signals.length, 2, 'independent lanes both run');
    assert.equal(signals[0].aborted, false, 'a charge-limit change must not cancel a lock');
    assert.equal(signals[1].aborted, false);
  });
});
