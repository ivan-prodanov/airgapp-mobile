import test from 'node:test';
import assert from 'node:assert/strict';

import {
  suspendBackgroundReads,
  resumeBackgroundReads,
  backgroundReadsSuspended,
  withBackgroundReadsSuspended,
  __resetBackgroundReadSuspend,
} from './backgroundReads';

test('suspend/resume is COUNTED, so nested probes cannot re-enable each other', () => {
  // PE-4 warms domain 3 inside its own suspended run. With a plain boolean the
  // inner resume would restart polling while the outer probe was still
  // measuring — and a second writer on the session counter is what made PE-4's
  // "quiet" phase take 25 seconds.
  __resetBackgroundReadSuspend();
  suspendBackgroundReads();
  suspendBackgroundReads();
  resumeBackgroundReads();
  assert.equal(backgroundReadsSuspended(), true, 'still suspended by the outer hold');
  resumeBackgroundReads();
  assert.equal(backgroundReadsSuspended(), false);
});

test('resume never drives the count negative', () => {
  // A stray resume must not bank credit that later swallows a real suspend.
  __resetBackgroundReadSuspend();
  resumeBackgroundReads();
  resumeBackgroundReads();
  suspendBackgroundReads();
  assert.equal(backgroundReadsSuspended(), true);
});

test('withBackgroundReadsSuspended restores polling even when the probe THROWS', async () => {
  // Leaking a suspend would silently stop the app polling until relaunch —
  // indistinguishable from the "all BLE messages ignored" symptom.
  __resetBackgroundReadSuspend();
  await assert.rejects(
    withBackgroundReadsSuspended(async () => {
      assert.equal(backgroundReadsSuspended(), true);
      throw new Error('probe blew up');
    }),
    /probe blew up/,
  );
  assert.equal(backgroundReadsSuspended(), false, 'polling MUST come back');
});

test('withBackgroundReadsSuspended returns the value and holds for the whole run', async () => {
  __resetBackgroundReadSuspend();
  const seen: boolean[] = [];
  const out = await withBackgroundReadsSuspended(async () => {
    seen.push(backgroundReadsSuspended());
    await new Promise((r) => setTimeout(r, 5));
    seen.push(backgroundReadsSuspended());
    return 42;
  });
  assert.equal(out, 42);
  assert.deepEqual(seen, [true, true], 'held across the await, not just at entry');
  assert.equal(backgroundReadsSuspended(), false);
});
