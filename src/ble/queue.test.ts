// queue.test.ts — per-VIN FIFO SessionQueue tests.
//
// Tesla's per-domain session counter is monotonic; two commands in flight at
// once on the same VIN corrupt the session. SessionQueue guarantees a single
// in-flight job per VIN while letting different VINs run concurrently.

import { test } from 'node:test';
import assert from 'node:assert/strict';

import { SessionQueue, sharedSessionQueue, __resetSharedSessionQueue } from './queue';

// deferred() gives a promise plus external resolve/reject, so tests can
// control exactly when a "job" completes and observe ordering without
// timing-based flakiness.
function deferred<T>() {
  let resolve!: (v: T) => void;
  let reject!: (e: unknown) => void;
  const promise = new Promise<T>((res, rej) => {
    resolve = res;
    reject = rej;
  });
  return { promise, resolve, reject };
}

test('enqueue runs jobs for one VIN strictly in FIFO order', async () => {
  const queue = new SessionQueue();
  const order: number[] = [];

  const d1 = deferred<void>();
  const d2 = deferred<void>();

  const p1 = queue.enqueue('VIN1', async () => {
    await d1.promise;
    order.push(1);
  });
  const p2 = queue.enqueue('VIN1', async () => {
    await d2.promise;
    order.push(2);
  });
  const p3 = queue.enqueue('VIN1', async () => {
    order.push(3);
  });

  // Nothing has run yet — job 1 is blocked on d1, jobs 2/3 haven't started.
  assert.deepEqual(order, []);

  d1.resolve();
  await p1;
  assert.deepEqual(order, [1]); // job 2 still blocked on d2, hasn't pushed yet

  d2.resolve();
  await p2;
  assert.deepEqual(order, [1, 2]);

  await p3;
  assert.deepEqual(order, [1, 2, 3]);
});

test('a job does not start until the previous job for the same VIN resolves', async () => {
  const queue = new SessionQueue();
  let job2Started = false;

  const d1 = deferred<void>();
  const p1 = queue.enqueue('VIN1', async () => {
    await d1.promise;
  });
  const p2 = queue.enqueue('VIN1', async () => {
    job2Started = true;
  });

  // Give the microtask queue a chance to run anything that WOULD start job 2
  // if the queue were broken (no serialization).
  await Promise.resolve();
  await Promise.resolve();
  assert.equal(job2Started, false, 'job 2 must not start while job 1 is in flight');

  d1.resolve();
  await p1;
  await p2;
  assert.equal(job2Started, true);
});

test('a rejected job does not wedge the queue — the next job still runs', async () => {
  const queue = new SessionQueue();
  const order: string[] = [];

  const p1 = queue.enqueue('VIN1', async () => {
    order.push('job1');
    throw new Error('job1 boom');
  });
  const p2 = queue.enqueue('VIN1', async () => {
    order.push('job2');
    return 'job2-result';
  });

  await assert.rejects(p1, /job1 boom/);
  assert.equal(await p2, 'job2-result');
  assert.deepEqual(order, ['job1', 'job2']);
});

test('enqueue resolves to the job return value, and propagates its rejection', async () => {
  const queue = new SessionQueue();
  const ok = await queue.enqueue('VIN1', async () => 42);
  assert.equal(ok, 42);

  await assert.rejects(
    queue.enqueue('VIN1', async () => {
      throw new Error('nope');
    }),
    /nope/,
  );
});

test('two different VINs run concurrently, not serialized against each other', async () => {
  const queue = new SessionQueue();
  const order: string[] = [];

  const dA = deferred<void>();
  const pA = queue.enqueue('VINA', async () => {
    order.push('A-start');
    await dA.promise;
    order.push('A-end');
  });
  // VINB's job should be able to start and finish WHILE VINA's job is still
  // blocked on dA — proving the two VINs' queues don't share a tail.
  const pB = queue.enqueue('VINB', async () => {
    order.push('B-start');
    order.push('B-end');
  });

  await pB;
  assert.deepEqual(order, ['A-start', 'B-start', 'B-end']);

  dA.resolve();
  await pA;
  assert.deepEqual(order, ['A-start', 'B-start', 'B-end', 'A-end']);
});

test('FIFO ordering holds across three interleaved VINs independently', async () => {
  const queue = new SessionQueue();
  const results: Record<string, number[]> = { X: [], Y: [] };

  const jobs: Promise<void>[] = [];
  for (const vin of ['X', 'Y']) {
    for (let i = 1; i <= 4; i++) {
      jobs.push(
        queue.enqueue(vin, async () => {
          results[vin].push(i);
        }),
      );
    }
  }
  await Promise.all(jobs);

  assert.deepEqual(results.X, [1, 2, 3, 4]);
  assert.deepEqual(results.Y, [1, 2, 3, 4]);
});

test('a user command jumps AHEAD of queued background work', async () => {
  // The regression PE-4 measured: a lock tap sat behind whatever background
  // reads were queued. Ordering within a lane is still FIFO; the user lane just
  // drains first.
  const queue = new SessionQueue();
  const order: string[] = [];
  const gate = deferred<void>();

  // One background job in flight, holding the runner.
  const running = queue.enqueue('VIN1', async () => {
    await gate.promise;
    order.push('bg-running');
  }, { priority: 'background' });
  // Two more background jobs queued behind it...
  const bg2 = queue.enqueue('VIN1', async () => { order.push('bg2'); }, { priority: 'background' });
  const bg3 = queue.enqueue('VIN1', async () => { order.push('bg3'); }, { priority: 'background' });
  // ...then the user taps.
  const user = queue.enqueue('VIN1', async () => { order.push('USER'); });

  gate.resolve();
  await Promise.all([running, bg2, bg3, user]);

  // The in-flight job finishes (it cannot be preempted), then the USER command
  // goes next — ahead of the two background jobs queued before it.
  assert.deepEqual(order, ['bg-running', 'USER', 'bg2', 'bg3']);
});

test('an unmarked job is treated as a USER job — forgetting must not slow the door', async () => {
  const queue = new SessionQueue();
  const order: string[] = [];
  const gate = deferred<void>();
  const running = queue.enqueue('VIN1', async () => { await gate.promise; }, { priority: 'background' });
  const bg = queue.enqueue('VIN1', async () => { order.push('bg'); }, { priority: 'background' });
  const unmarked = queue.enqueue('VIN1', async () => { order.push('unmarked'); });
  gate.resolve();
  await Promise.all([running, bg, unmarked]);
  assert.deepEqual(order, ['unmarked', 'bg'], 'no priority given ⇒ treated as user');
});

test('user jobs keep FIFO order among themselves', async () => {
  const queue = new SessionQueue();
  const order: number[] = [];
  const gate = deferred<void>();
  const running = queue.enqueue('VIN1', async () => { await gate.promise; });
  const a = queue.enqueue('VIN1', async () => { order.push(1); });
  const b = queue.enqueue('VIN1', async () => { order.push(2); });
  const c = queue.enqueue('VIN1', async () => { order.push(3); });
  gate.resolve();
  await Promise.all([running, a, b, c]);
  assert.deepEqual(order, [1, 2, 3], 'priority reorders lanes, never within one');
});

test('a rejected background job does not wedge a waiting user command', async () => {
  const queue = new SessionQueue();
  const order: string[] = [];
  const gate = deferred<void>();
  const running = queue.enqueue('VIN1', async () => {
    await gate.promise;
    throw new Error('background read timed out');
  }, { priority: 'background' });
  const user = queue.enqueue('VIN1', async () => { order.push('USER'); });
  gate.resolve();
  await assert.rejects(running, /timed out/);
  await user;
  assert.deepEqual(order, ['USER'], 'a failing read must never block the door');
});

test('depth reports what is WAITING, so a backlog is visible', async () => {
  const queue = new SessionQueue();
  const gate = deferred<void>();
  const running = queue.enqueue('VIN1', async () => { await gate.promise; }, { priority: 'background' });
  queue.enqueue('VIN1', async () => {}, { priority: 'background' });
  queue.enqueue('VIN1', async () => {});
  assert.deepEqual(queue.depth('VIN1'), { user: 1, background: 1 });
  gate.resolve();
  await running;
});

test('TWO gateways created with NO queue argument share one — asserted on the DEFAULT', async () => {
  // The bug this closes: CreateCarGatewayArgs.queue defaulted to `new
  // SessionQueue()`, so the Car Link debug screen's gateway and the app's each
  // had their own FIFO. But the SESSION cache (_domainCache) is module-level, so
  // both operated on the SAME cached session — same monotonic counter, same
  // routing address. Two unsynchronised writers onto one counter.
  //
  // Measured 2026-07-27 04:38-04:41: the probe's commands degraded to 25 SECONDS
  // while the app's own polls in the very same seconds completed in 170ms. The
  // link was never the problem.
  //
  // ⚠ My first attempt at this test exercised sharedSessionQueue DIRECTLY, so it
  // passed with the old `new SessionQueue()` default still in place — it proved
  // the singleton was a singleton, which nobody doubted, and nothing about the
  // gateway. Verified by putting the old default back and watching the suite stay
  // green. This version reads the default out of the module instead.
  const src = await (await import('node:fs/promises')).readFile(
    new URL('./gateway.ts', import.meta.url).pathname,
    'utf8',
  );
  assert.match(
    src,
    /queue\s*=\s*sharedSessionQueue/,
    'createCarGateway must DEFAULT to the shared queue — a per-gateway queue is a second writer on one counter',
  );
  assert.doesNotMatch(
    src,
    /queue\s*=\s*new SessionQueue\(\)/,
    'a fresh per-gateway queue is exactly the bug',
  );
});

test('the shared queue serializes across callers — one runner, never interleaved', async () => {
  const order: string[] = [];
  const gate = deferred<void>();
  const a = sharedSessionQueue.enqueue('VIN1', async () => {
    await gate.promise;
    order.push('gatewayA');
  });
  const b = sharedSessionQueue.enqueue('VIN1', async () => {
    order.push('gatewayB');
  });
  assert.deepEqual(order, [], 'B must not start while A is in flight');
  gate.resolve();
  await Promise.all([a, b]);
  assert.deepEqual(order, ['gatewayA', 'gatewayB']);
});

test('__resetSharedSessionQueue clears queued work so tests do not leak into each other', () => {
  sharedSessionQueue.enqueue('VIN1', async () => {}, { priority: 'background' });
  sharedSessionQueue.enqueue('VIN1', async () => {}, { priority: 'background' });
  __resetSharedSessionQueue();
  assert.deepEqual(sharedSessionQueue.depth('VIN1'), { user: 0, background: 0 });
});
