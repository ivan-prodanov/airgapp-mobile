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

test('timeout → command timeout body', () => {
  assert.deepEqual(commandFailureText('Lock', timeout), {
    title: 'Lock failed',
    body: 'Command timeout, please try again.',
  });
});

test('unreachable → out of range / asleep body', () => {
  assert.deepEqual(commandFailureText('Lock', unreachable), {
    title: 'Lock failed',
    body: 'Car out of range or asleep, please try again.',
  });
});

test('exhausted maps to the same out-of-range body', () => {
  assert.equal(commandFailureText('Lock', exhausted).body, 'Car out of range or asleep, please try again.');
});

test('auth → not paired / re-enrol body', () => {
  assert.deepEqual(commandFailureText('Unlock', auth), {
    title: 'Unlock failed',
    body: "This phone isn't paired with the car. Re-enrol it.",
  });
});

test('fault UNKNOWN_KEY_ID → the same not-paired / re-enrol body', () => {
  assert.equal(commandFailureText('Lock', faultUnknownKey).body, "This phone isn't paired with the car. Re-enrol it.");
});

test('fault INSUFFICIENT_PRIVILEGES → key not allowed body', () => {
  assert.equal(commandFailureText('Lock', faultInsufficient).body, "This key isn't allowed to do that.");
});

test('fault (other) → the car declined the request', () => {
  assert.equal(commandFailureText('Lock', faultOther).body, 'The car declined the request.');
});

test('every branch ends in a period and starts capitalized (Tesla tone)', () => {
  for (const outcome of [unreachable, exhausted, timeout, auth, faultUnknownKey, faultInsufficient, faultOther]) {
    const { body } = commandFailureText('Lock', outcome);
    assert.ok(body.endsWith('.'), `body should end with a period: ${body}`);
    assert.equal(body[0], body[0].toUpperCase(), `body should start capitalized: ${body}`);
  }
});

// ── commandActionLabel (unchanged) ──────────────────────────────────────────

test('commandActionLabel maps known commands and title-cases the rest', () => {
  assert.equal(commandActionLabel('lock'), 'Lock');
  assert.equal(commandActionLabel('unlock'), 'Unlock');
  assert.equal(commandActionLabel('openFrunk'), 'Open frunk');
  // Unknown/unmapped command type falls back to a title-cased type.
  assert.equal(commandActionLabel('boombox'), 'Boombox');
});
