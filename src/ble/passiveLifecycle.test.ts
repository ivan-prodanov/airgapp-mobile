import { test } from 'node:test';
import assert from 'node:assert/strict';

import { whoMaySign } from './passiveLifecycle';

test('foreground → JS signs, native stands down (even if native is up)', () => {
  assert.equal(whoMaySign({ appActive: true, nativeUp: true }), 'js');
  assert.equal(whoMaySign({ appActive: true, nativeUp: false }), 'js');
});

test('background with native up → native is the sole signer', () => {
  assert.equal(whoMaySign({ appActive: false, nativeUp: true }), 'native');
});

test('background, native not up → nobody signs (JS is suspended, no phantom signer)', () => {
  assert.equal(whoMaySign({ appActive: false, nativeUp: false }), 'none');
});

test('there is never a state where BOTH js and native are told to sign', () => {
  for (const appActive of [true, false]) {
    for (const nativeUp of [true, false]) {
      const signer = whoMaySign({ appActive, nativeUp });
      // The rule returns exactly one signer (or none) — the single-writer invariant.
      assert.ok(signer === 'native' || signer === 'js' || signer === 'none');
    }
  }
});
