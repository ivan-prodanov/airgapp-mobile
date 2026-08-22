import { test } from 'node:test';
import assert from 'node:assert/strict';

import { NAV_GUARD_MS, createNavGuard } from './navGuard';

test('the first press is allowed, with no delay', () => {
  const guard = createNavGuard(NAV_GUARD_MS);
  // Synchronous verdict: the guard must never defer a lone tap (a trailing
  // debounce would make every normal navigation feel laggy).
  assert.equal(guard.allow(1_000), true);
});

test('a second press inside the window is swallowed — the double-push bug', () => {
  const guard = createNavGuard(NAV_GUARD_MS);
  assert.equal(guard.allow(1_000), true);
  // ~120ms later: a human double-tap, well inside the screen transition.
  assert.equal(guard.allow(1_120), false);
  assert.equal(guard.allow(1_300), false);
});

test('the window is measured from the ALLOWED press, not the last attempt', () => {
  // Otherwise a fast tapper keeps pushing the window forward and the screen
  // stays locked for as long as they keep tapping.
  const guard = createNavGuard(500);
  assert.equal(guard.allow(1_000), true);
  assert.equal(guard.allow(1_400), false);
  assert.equal(guard.allow(1_500), true);
});

test('a deliberate second press after the window navigates again', () => {
  const guard = createNavGuard(500);
  assert.equal(guard.allow(1_000), true);
  assert.equal(guard.allow(1_600), true);
});

test('one guard covers every destination — Location then Charging cannot stack', () => {
  // The guard is per-screen, not per-button: tapping Location and then Charging
  // during the slide would otherwise push two screens just the same.
  const guard = createNavGuard(NAV_GUARD_MS);
  assert.equal(guard.allow(1_000), true);
  assert.equal(guard.allow(1_050), false);
});

test('reset() reopens the guard immediately (screen regained focus)', () => {
  // Coming back from Location must not leave the row dead for the rest of the
  // window — the screen resets its guard when it is focused again.
  const guard = createNavGuard(NAV_GUARD_MS);
  assert.equal(guard.allow(1_000), true);
  guard.reset();
  assert.equal(guard.allow(1_010), true);
});
