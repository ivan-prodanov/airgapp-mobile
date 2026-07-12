// queue.test.ts — per-VIN FIFO SessionQueue tests.
//
// Tesla's per-domain session counter is monotonic; two commands in flight at
// once on the same VIN corrupt the session. SessionQueue guarantees a single
// in-flight job per VIN while letting different VINs run concurrently.

import { test } from 'node:test';
import assert from 'node:assert/strict';

import { SessionQueue } from './queue';

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
