import { test } from 'node:test';
import assert from 'node:assert/strict';

import { ensureAwake, WAKE_DEADLINE_MS, type WakeGateDeps } from './wakeGate';

// A deterministic harness: a mock clock that only advances when sleep() is called, so the deadline loop
// runs in zero real time. `wake()` flips `woke`; probeAwake reports awake once woke AND the clock has passed
// `awakeAfterMs` (models the car taking a while to boot).
function harness(opts: {
  awakeImmediately?: boolean;
  neverWakes?: boolean;
  awakeAfterMs?: number;
}): { deps: WakeGateDeps; woke: () => boolean; probes: () => number } {
  let t = 0;
  let woke = false;
  let probes = 0;
  const deps: WakeGateDeps = {
    now: () => t,
    sleep: async (ms) => {
      t += ms;
    },
    wake: async () => {
      woke = true;
    },
    probeAwake: async () => {
      probes += 1;
      if (opts.awakeImmediately) return true;
      if (opts.neverWakes) return false;
      return woke && t >= (opts.awakeAfterMs ?? 0);
    },
  };
  return { deps, woke: () => woke, probes: () => probes };
}

test('ensureAwake: already awake → returns awake, sends no wake', async () => {
  const h = harness({ awakeImmediately: true });
  assert.equal(await ensureAwake(h.deps), 'awake');
  assert.equal(h.woke(), false);
  assert.equal(h.probes(), 1); // one probe, then done
});

test('ensureAwake: asleep → wakes, polls, returns awake once the car comes up', async () => {
  const h = harness({ awakeAfterMs: 6_000 });
  assert.equal(await ensureAwake(h.deps), 'awake');
  assert.equal(h.woke(), true);
  assert.ok(h.probes() >= 2); // initial (asleep) + at least one poll after wake
});

test('ensureAwake: car never wakes → timeout at the deadline', async () => {
  const h = harness({ neverWakes: true });
  assert.equal(await ensureAwake(h.deps), 'timeout');
  assert.equal(h.woke(), true); // it did try to wake
});

test('ensureAwake: aborted before starting → aborted, no wake', async () => {
  const h = harness({ neverWakes: true });
  const deps: WakeGateDeps = { ...h.deps, signal: { aborted: true } };
  assert.equal(await ensureAwake(deps), 'aborted');
  assert.equal(h.woke(), false);
});

test('ensureAwake: superseded mid-wait → aborted', async () => {
  let t = 0;
  let woke = false;
  const signal = { aborted: false };
  const deps: WakeGateDeps = {
    now: () => t,
    sleep: async (ms) => {
      t += ms;
      if (t >= 4_000) signal.aborted = true; // a newer command supersedes us while we wait
    },
    wake: async () => {
      woke = true;
    },
    probeAwake: async () => false,
    signal,
  };
  assert.equal(await ensureAwake(deps), 'aborted');
  assert.equal(woke, true);
});

test('ensureAwake: deadline is bounded (does not loop forever)', async () => {
  let t = 0;
  const deps: WakeGateDeps = {
    now: () => t,
    sleep: async (ms) => {
      t += ms;
    },
    wake: async () => {},
    probeAwake: async () => false,
  };
  assert.equal(await ensureAwake(deps), 'timeout');
  assert.ok(t >= WAKE_DEADLINE_MS); // advanced past the deadline, then stopped
});
