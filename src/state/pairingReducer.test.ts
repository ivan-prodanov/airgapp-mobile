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
