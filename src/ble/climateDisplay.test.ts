import { test } from 'node:test';
import assert from 'node:assert/strict';

import { showsOverheatActivationTemp } from './climateDisplay';

// Recovered from VehicleClimateScreen @5221950:
//   supportsCabinOverheatProtection && supportsSetCabinOverheatProtectionTemp
//     && cabinOverheatProtection === CABINOVERHEATPROTECTIONON

test('the activation temperature shows only while COP is On', () => {
  assert.equal(showsOverheatActivationTemp('on'), true);
});

test('it is hidden on Fan Only — their CABINOVERHEATPROTECTIONFANONLY', () => {
  // Their own label for that mode is `..._no_ac` = "No A/C", which is ours.
  // Fan Only has no setpoint to reach, so an activation temperature is
  // meaningless there — and their branch returns a DESCRIPTION, not this row.
  assert.equal(showsOverheatActivationTemp('noac'), false);
});

test('it is hidden when Off — nothing activates', () => {
  assert.equal(showsOverheatActivationTemp('off'), false);
});
