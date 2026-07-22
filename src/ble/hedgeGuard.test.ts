import { test } from 'node:test';
import assert from 'node:assert/strict';

import { classifyFallbackReply } from './hedgeGuard';

const EPOCH = Uint8Array.from(new Array(16).fill(0x07));
const OTHER_EPOCH = Uint8Array.from(new Array(16).fill(0x09));

test('a clean success on the fallback leg is landed', () => {
  assert.equal(
    classifyFallbackReply({
      sealedEpoch: EPOCH,
      sealedCounter: 50,
      cleanSuccess: true,
      rejectSessionInfo: null,
    }),
    'landed',
  );
});

test('reject with window-top AT/PAST our counter (same epoch) = LANDED (do not re-fire)', () => {
  // This is the whole point: leg-1 landed → counter 50 consumed → leg-2 rejected,
  // but the attached SessionInfo shows the window advanced to 50. Namespace of
  // the fault is irrelevant — universal 6 and VCSEC 6 both resolve here.
  assert.equal(
    classifyFallbackReply({
      sealedEpoch: EPOCH,
      sealedCounter: 50,
      cleanSuccess: false,
      rejectSessionInfo: { epoch: EPOCH, windowTop: 50 },
    }),
    'landed',
  );
  assert.equal(
    classifyFallbackReply({
      sealedEpoch: EPOCH,
      sealedCounter: 50,
      cleanSuccess: false,
      rejectSessionInfo: { epoch: EPOCH, windowTop: 53 },
    }),
    'landed',
  );
});

test('reject with window-top BELOW our counter (same epoch) = NOT landed (real failure)', () => {
  // The car has not consumed our counter — the frame was rejected for a genuine
  // reason (bad sig / decrypt). Surface it, do not silently swallow.
  assert.equal(
    classifyFallbackReply({
      sealedEpoch: EPOCH,
      sealedCounter: 50,
      cleanSuccess: false,
      rejectSessionInfo: { epoch: EPOCH, windowTop: 49 },
    }),
    'not-landed',
  );
});

test('a reject with NO attached SessionInfo is indeterminate — never assume success', () => {
  assert.equal(
    classifyFallbackReply({
      sealedEpoch: EPOCH,
      sealedCounter: 50,
      cleanSuccess: false,
      rejectSessionInfo: null,
    }),
    'indeterminate',
  );
});

test('an epoch roll mid-command is indeterminate — window-top is not comparable', () => {
  assert.equal(
    classifyFallbackReply({
      sealedEpoch: EPOCH,
      sealedCounter: 50,
      cleanSuccess: false,
      rejectSessionInfo: { epoch: OTHER_EPOCH, windowTop: 999 },
    }),
    'indeterminate',
  );
});

test('the guard is namespace-independent: it never inspects a fault code', () => {
  // Same inputs, whether the underlying fault was universal-6 or VCSEC-6, resolve
  // purely from epoch + window-top. (Regression pin for the RE #10 trap.)
  const landed = {
    sealedEpoch: EPOCH,
    sealedCounter: 7,
    cleanSuccess: false,
    rejectSessionInfo: { epoch: EPOCH, windowTop: 7 },
  } as const;
  assert.equal(classifyFallbackReply(landed), 'landed');
});
