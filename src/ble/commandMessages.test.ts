import test from 'node:test';
import assert from 'node:assert/strict';

import { commandFailureText, commandActionLabel } from './commandMessages';
import type { CommandOutcome } from './gateway';

type Fail = Extract<CommandOutcome, { ok: false }>;

const unreachable: Fail = { ok: false, kind: 'unreachable', message: '[lock] unreachable' };
const exhausted: Fail = { ok: false, kind: 'exhausted', message: '[lock] exhausted' };
const timeout: Fail = { ok: false, kind: 'timeout', message: '[lock] timeout' };
const auth: Fail = { ok: false, kind: 'auth', message: '[lock] auth' };
const faultUnknownKey: Fail = { ok: false, kind: 'fault', fault: 3, faultName: 'UNKNOWN_KEY_ID', message: '[lock] fault 3' };
const faultInsufficient: Fail = {
  ok: false,
  kind: 'fault',
  fault: 7,
  faultName: 'INSUFFICIENT_PRIVILEGES',
  message: '[lock] fault 7',
};
const faultOther: Fail = { ok: false, kind: 'fault', fault: 9, faultName: 'INVALID_COMMAND', message: '[lock] fault 9' };

// ── title: always "<Action> failed" (Tesla's bold first line) ────────────────

test('title is the action label + " failed", verbatim (not lowercased)', () => {
  assert.equal(commandFailureText('Lock', timeout).title, 'Lock failed');
  assert.equal(commandFailureText('Unlock', timeout).title, 'Unlock failed');
  assert.equal(commandFailureText('Open frunk', timeout).title, 'Open frunk failed');
});

test('title is independent of the failure kind', () => {
  for (const outcome of [unreachable, exhausted, timeout, auth, faultUnknownKey, faultInsufficient, faultOther]) {
    assert.equal(commandFailureText('Lock', outcome).title, 'Lock failed');
  }
});

// ── body: the reason line (Tesla's muted second line) ───────────────────────
//
// Every expectation below is the official app's VERBATIM English, recovered
// from its inline i18n catalog (findings §3.2). The casing/punctuation is
// asserted exactly as recovered — the inconsistency between them is real and
// intentional, so these are strict equality checks, never normalized.

test('timeout → command_error_timeout, verbatim', () => {
  assert.deepEqual(commandFailureText('Lock', timeout), {
    title: 'Lock failed',
    body: 'Command timeout, please try again.',
  });
});

test('unreachable → vehicle_error_connection_error, verbatim (Title Case, no period)', () => {
  assert.deepEqual(commandFailureText('Lock', unreachable), {
    title: 'Lock failed',
    body: 'Vehicle Connection Error',
  });
});

test('exhausted maps to the same connection-error body', () => {
  assert.equal(commandFailureText('Lock', exhausted).body, 'Vehicle Connection Error');
});

test('auth → vehicle_error_unauthorized, verbatim (Title Case, no period)', () => {
  assert.deepEqual(commandFailureText('Unlock', auth), {
    title: 'Unlock failed',
    body: 'Session Expired',
  });
});

test('fault UNKNOWN_KEY_ID → vehicle_error_not_in_whitelist, verbatim', () => {
  assert.equal(commandFailureText('Lock', faultUnknownKey).body, 'Set up Phone Key and try again.');
});

test('fault INSUFFICIENT_PRIVILEGES → vehicle_error_insufficient_privileges, verbatim', () => {
  assert.equal(
    commandFailureText('Lock', faultInsufficient).body,
    'Unpair your phone key and pair it again to retry.',
  );
});

test('fault (other) → the generic command_error_GENERIC_ fallback', () => {
  assert.equal(commandFailureText('Lock', faultOther).body, 'Command failed');
});

test('no branch invents an asleep/offline body (findings §3.2: no such key exists)', () => {
  // Sleep is handled upstream by auto-wake, never by the failure card — a body
  // mentioning it would be copy we made up.
  for (const outcome of [unreachable, exhausted, timeout, auth, faultUnknownKey, faultInsufficient, faultOther]) {
    const { body } = commandFailureText('Lock', outcome);
    assert.doesNotMatch(body, /asleep|offline|sleeping/i, `invented sleep copy: ${body}`);
  }
});

test('bodies start capitalized; trailing periods are verbatim, NOT normalized', () => {
  for (const outcome of [unreachable, exhausted, timeout, auth, faultUnknownKey, faultInsufficient, faultOther]) {
    const { body } = commandFailureText('Lock', outcome);
    assert.equal(body[0], body[0].toUpperCase(), `body should start capitalized: ${body}`);
  }
  // Full sentences end with a period; short labels don't (findings §3.5).
  assert.ok(commandFailureText('Lock', timeout).body.endsWith('.'));
  assert.ok(!commandFailureText('Lock', unreachable).body.endsWith('.'));
  assert.ok(!commandFailureText('Lock', auth).body.endsWith('.'));
  assert.ok(!commandFailureText('Lock', faultOther).body.endsWith('.'));
});

// ── commandActionLabel (unchanged) ──────────────────────────────────────────

test('commandActionLabel maps known commands and title-cases the rest', () => {
  assert.equal(commandActionLabel('lock'), 'Lock');
  assert.equal(commandActionLabel('unlock'), 'Unlock');
  assert.equal(commandActionLabel('openFrunk'), 'Open frunk');
  // Unknown/unmapped command type falls back to a title-cased type.
  assert.equal(commandActionLabel('boombox'), 'Boombox');
});
