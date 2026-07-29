import { test } from 'node:test';
import assert from 'node:assert/strict';

import { climateDescriptionText, showsOverheatActivationTemp } from './climateDisplay';
import type { ClimateDescriptionInput } from './climateDisplay';


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


const base: ClimateDescriptionInput = {
  climateOn: false,
  bioweaponOn: false,
  climateKeeper: 'off',
  interiorTempC: null,
  openWindowCount: 0,
  copActivelyCooling: false,
};
const at = (o: Partial<ClimateDescriptionInput>) => climateDescriptionText({ ...base, ...o });

// The whole point of the cascade is PRIORITY: the interior temperature is the
// first FALLBACK, not a field. Ivan asked why it is sometimes hidden, and this
// is the answer — anything more specific replaces it.
test('climate ON: says what it is doing, never the temperature', () => {
  assert.equal(at({ climateOn: true, interiorTempC: 21 }), 'Active');
  assert.equal(at({ climateOn: true, interiorTempC: 21, climateKeeper: 'camp' }), 'Keep On');
  assert.equal(at({ climateOn: true, interiorTempC: 21, bioweaponOn: true }), 'Bioweapon Defense Mode');
  // Bioweapon outranks the keeper — their order, checked first (@3887838).
  assert.equal(
    at({ climateOn: true, bioweaponOn: true, climateKeeper: 'pet' }),
    'Bioweapon Defense Mode',
  );
});

test('climate OFF: temperature first, then windows, then COP, then nothing', () => {
  assert.equal(at({ interiorTempC: 21.4 }), 'Interior 21°C');
  // A known temperature outranks open windows.
  assert.equal(at({ interiorTempC: 21, openWindowCount: 2 }), 'Interior 21°C');
  // Singular and plural are two separate keys of theirs, not a formatter.
  assert.equal(at({ openWindowCount: 1 }), 'Window open');
  assert.equal(at({ openWindowCount: 3 }), 'Windows open');
  assert.equal(at({ copActivelyCooling: true }), 'Cabin Overheat Protection');
  assert.equal(at({ openWindowCount: 1, copActivelyCooling: true }), 'Window open');
});

test('nothing known -> NO line, not a dash', () => {
  // The actual defect. We rendered showNum(interiorTempC), which prints an
  // em-dash for an unknown value, so a car we had never read claimed
  // "Interior —". Theirs renders no line at all.
  assert.equal(at({}), null);
});
