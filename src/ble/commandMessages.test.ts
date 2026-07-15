import test from 'node:test';
import assert from 'node:assert/strict';

import { commandFailureMessage, commandActionLabel } from './commandMessages';
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

test('unreachable → out of range / asleep, lowercased action', () => {
  const msg = commandFailureMessage('Lock', unreachable);
  assert.equal(msg, "Couldn't lock — car out of range or asleep");
  assert.ok(msg.includes('lock'));
});

test('exhausted maps to the same out-of-range message', () => {
  assert.equal(commandFailureMessage('Lock', exhausted), "Couldn't lock — car out of range or asleep");
});

test('timeout → the car didn\'t respond', () => {
  const msg = commandFailureMessage('Unlock', timeout);
  assert.equal(msg, "Couldn't unlock — the car didn't respond");
  assert.ok(msg.includes('unlock'));
});

test('auth → not paired / re-enrol', () => {
  const msg = commandFailureMessage('Lock', auth);
  assert.equal(msg, "Couldn't lock — this phone isn't paired. Re-enrol it.");
  assert.ok(msg.includes('lock'));
});

test('fault UNKNOWN_KEY_ID → same not-paired / re-enrol message', () => {
  const msg = commandFailureMessage('Lock', faultUnknownKey);
  assert.equal(msg, "Couldn't lock — this phone isn't paired. Re-enrol it.");
  assert.ok(msg.includes('lock'));
});

test('fault INSUFFICIENT_PRIVILEGES → not allowed for this key', () => {
  const msg = commandFailureMessage('Lock', faultInsufficient);
  assert.equal(msg, "Couldn't lock — not allowed for this key");
  assert.ok(msg.includes('lock'));
});

test('fault (other) → the car declined the request', () => {
  const msg = commandFailureMessage('Lock', faultOther);
  assert.equal(msg, "Couldn't lock — the car declined the request");
  assert.ok(msg.includes('lock'));
});

test('commandActionLabel maps known commands and title-cases the rest', () => {
  assert.equal(commandActionLabel('lock'), 'Lock');
  assert.equal(commandActionLabel('unlock'), 'Unlock');
  assert.equal(commandActionLabel('openFrunk'), 'Open frunk');
  // Unknown/unmapped command type falls back to a title-cased type.
  assert.equal(commandActionLabel('boombox'), 'Boombox');
});
