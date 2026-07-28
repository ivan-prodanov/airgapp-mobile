import { test } from 'node:test';
import assert from 'node:assert/strict';

import { isChargePanelVisible, shouldClearShowCharge } from './chargePanel';

// Recovered from VehicleHomeScreen @4561054-4561600. See chargePanel.ts.

test('the port alone opens the panel — no tap, no awake check', () => {
  assert.equal(isChargePanelVisible(true, false), true);
});

test('the tap alone opens it on an unplugged car', () => {
  // This is the case the old `state.awake &&` gate broke: the panel renders from
  // cached ChargeState, so a sleeping, unplugged car still opens on a tap.
  assert.equal(isChargePanelVisible(false, true), true);
});

test('neither means hidden', () => {
  assert.equal(isChargePanelVisible(false, false), false);
});

test('while plugged in, the tap cannot dismiss it', () => {
  // It is an OR. showCharge false + port open still shows — which is why the tap
  // only decides anything once unplugged.
  assert.equal(isChargePanelVisible(true, false), true);
});

test('unplugging clears the manual toggle', () => {
  assert.equal(shouldClearShowCharge(true, false, true), true);
});

test('it is an EDGE: staying unplugged does not keep clearing it', () => {
  // The regression this guards. A level check (`if (!portOpen) clear()`) would
  // return true here, so tapping the battery on an unplugged car would hide the
  // panel again on the very next render.
  assert.equal(shouldClearShowCharge(false, false, true), false);
});

test('first render never clears — usePrevious is undefined, not false', () => {
  assert.equal(shouldClearShowCharge(undefined, false, true), false);
});

test('plugging IN does not clear, and nothing clears while still plugged in', () => {
  assert.equal(shouldClearShowCharge(false, true, true), false);
  assert.equal(shouldClearShowCharge(true, true, true), false);
});

test('nothing to clear when the toggle is already off', () => {
  assert.equal(shouldClearShowCharge(true, false, false), false);
});
