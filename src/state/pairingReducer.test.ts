import { test } from 'node:test';
import assert from 'node:assert/strict';
import { pairReducer, initialPairState } from './pairingReducer';

test('happy path: vin → connecting → presentKey → verifying → paired', () => {
  let s = initialPairState;
  s = pairReducer(s, { t: 'submitVin', vin: '5YJYGDEE9PF000000' });
  assert.equal(s.step, 'connecting');
  assert.equal(s.vin, '5YJYGDEE9PF000000');
  s = pairReducer(s, { t: 'connected' });
  assert.equal(s.step, 'presentKey');
  s = pairReducer(s, { t: 'keySent' });
  assert.equal(s.step, 'verifying');
  s = pairReducer(s, { t: 'verified' });
  assert.equal(s.step, 'paired');
});

test('submitVin rejects an invalid VIN (stays on vin, sets error)', () => {
  const s = pairReducer(initialPairState, { t: 'submitVin', vin: 'nope' });
  assert.equal(s.step, 'vin');
  assert.ok(s.error);
});

test('connect failure and verify timeout surface an error, retry resumes', () => {
  let s = pairReducer({ step: 'connecting', vin: '5YJYGDEE9PF000000', error: null }, { t: 'connectFailed', error: 'not found' });
  assert.equal(s.step, 'error');
  assert.equal(s.error, 'not found');
  s = pairReducer(s, { t: 'retry' });               // retry goes back to connecting with the same VIN
  assert.equal(s.step, 'connecting');
  assert.equal(s.vin, '5YJYGDEE9PF000000');

  const t = pairReducer({ step: 'verifying', vin: '5YJYGDEE9PF000000', error: null }, { t: 'verifyTimeout' });
  assert.equal(t.step, 'error');
});

test('cancel resets to the initial VIN step', () => {
  assert.deepEqual(pairReducer({ step: 'verifying', vin: 'x', error: null }, { t: 'cancel' }), initialPairState);
});

test('stale async events are ignored outside their step', () => {
  // connect resolves AFTER cancel — must not jump to presentKey
  assert.equal(pairReducer(initialPairState, { t: 'connected' }).step, 'vin');
  // connectFailed from vin — ignored
  assert.equal(pairReducer(initialPairState, { t: 'connectFailed', error: 'x' }).step, 'vin');
  // verifyTimeout after verified — must not flip paired back to error
  assert.equal(pairReducer({ step: 'paired', vin: '5YJYGDEE9PF000000', error: null }, { t: 'verifyTimeout' }).step, 'paired');
  // retry only from error
  assert.equal(pairReducer(initialPairState, { t: 'retry' }).step, 'vin');
  // keySent only from presentKey
  assert.equal(pairReducer(initialPairState, { t: 'keySent' }).step, 'vin');
});

test('submitVin normalizes the VIN (trim + uppercase) and works from the error step', () => {
  const lower = pairReducer(initialPairState, { t: 'submitVin', vin: '  5yjygdee9pf000000  ' });
  assert.equal(lower.step, 'connecting');
  assert.equal(lower.vin, '5YJYGDEE9PF000000');
  const fromError = pairReducer({ step: 'error', vin: 'x', error: 'boom' }, { t: 'submitVin', vin: '5YJ3E1EA7LF000000' });
  assert.equal(fromError.step, 'connecting');
  assert.equal(fromError.vin, '5YJ3E1EA7LF000000');
});

test('verifyTimeout sets an error; retry clears it; invalid submitVin keeps the prior vin', () => {
  const timedOut = pairReducer({ step: 'verifying', vin: '5YJYGDEE9PF000000', error: null }, { t: 'verifyTimeout' });
  assert.ok(timedOut.error);
  const retried = pairReducer(timedOut, { t: 'retry' });
  assert.equal(retried.step, 'connecting');
  assert.equal(retried.error, null);
  assert.equal(retried.vin, '5YJYGDEE9PF000000');
  const bad = pairReducer({ step: 'vin', vin: 'KEEPME', error: null }, { t: 'submitVin', vin: 'nope' });
  assert.equal(bad.step, 'vin');
  assert.ok(bad.error);
});
