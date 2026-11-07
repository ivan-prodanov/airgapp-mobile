// connectWaiters.test.ts — the "wait for the native link" primitive behind
// foregroundBleLink.awaitConnected. Split out because foregroundBleLink itself
// imports the native module and cannot load under node.

import { test } from 'node:test';
import assert from 'node:assert/strict';

import { isCancelledError } from './cancelled';
import { ConnectWaiters } from './connectWaiters';
import { isTransportDeadError } from './session';

test('wait resolves when the link comes up', async () => {
  const waiters = new ConnectWaiters();
  const pending = waiters.wait(10_000);
  waiters.resolveAll();
  await pending;
});

test('wait rejects with the connect-failed text after its budget', async (t) => {
  t.mock.timers.enable({ apis: ['setTimeout'] });
  const waiters = new ConnectWaiters();
  const pending = waiters.wait(6000);
  t.mock.timers.tick(6000);
  await assert.rejects(pending, /did not connect within 6000ms/);
});

test('a zero budget fails at once instead of waiting', async () => {
  const waiters = new ConnectWaiters();
  // Real timers on purpose: this must reject without a timer having to fire.
  await assert.rejects(waiters.wait(0), /did not connect within 0ms/);
});

test('retiring the generation ends the wait immediately, as a cancellation', async () => {
  const waiters = new ConnectWaiters();
  const lifetime = new AbortController();
  const pending = waiters.wait(60_000, lifetime.signal);
  lifetime.abort();
  await assert.rejects(pending, (e: unknown) => isCancelledError(e) && !isTransportDeadError(e));
});

test('an already-retired generation does not wait at all', async () => {
  const waiters = new ConnectWaiters();
  await assert.rejects(waiters.wait(60_000, AbortSignal.abort()), isCancelledError);
});

test('a retired wait is forgotten, so a later link-up cannot resolve it twice', async () => {
  const waiters = new ConnectWaiters();
  const lifetime = new AbortController();
  const pending = waiters.wait(60_000, lifetime.signal);
  lifetime.abort();
  await assert.rejects(pending, isCancelledError);
  assert.equal(waiters.size, 0);
  waiters.resolveAll();
});
