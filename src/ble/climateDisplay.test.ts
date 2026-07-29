import { test } from 'node:test';
import assert from 'node:assert/strict';

import {
  climateDetailText,
  climateOverheatText,
  climateStatusIcon,
  climateStatusText,
  showsOverheatActivationTemp,
} from './climateDisplay';
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
const at = (o: Partial<ClimateDescriptionInput>) => ({ ...base, ...o });

// The Home row is a BRIGHT status plus a DIM detail list, two sibling Texts
// (@3888124/@3888130) — NOT the priority cascade I first read it as. Ivan's
// screenshot shows both at once, "Active · Interior 25°C", which a cascade
// cannot produce.
test('status: Camp and Pet report Active, NOT Keep On', () => {
  // The specific mistake. Their check is `climateKeeperMode === ON` (@3887847) —
  // only the plain Keep Climate On. Mapping ANY keeper mode to "Keep On" is what
  // put the wrong word under Climate while Camp was running.
  assert.equal(climateStatusText(at({ climateOn: true, climateKeeper: 'camp' })), 'Active');
  assert.equal(climateStatusText(at({ climateOn: true, climateKeeper: 'pet' })), 'Active');
  assert.equal(climateStatusText(at({ climateOn: true, climateKeeper: 'on' })), 'Keep On');
  assert.equal(climateStatusText(at({ climateOn: true })), 'Active');
  // Bioweapon outranks every keeper mode — checked first in both the text
  // (@3887838) and the icon (@3888205).
  assert.equal(
    climateStatusText(at({ climateOn: true, bioweaponOn: true, climateKeeper: 'camp' })),
    'Bioweapon Defense Mode',
  );
  assert.equal(climateStatusText(at({ interiorTempC: 21 })), null);
});

test('detail: the temperature shows ALONGSIDE the status, not instead of it', () => {
  // The other half of the same bug — our row showed a status with no temperature.
  assert.equal(
    climateDetailText(at({ climateOn: true, climateKeeper: 'camp', interiorTempC: 25 })),
    'Interior 25°C',
  );
  // Parts JOIN rather than compete.
  assert.equal(
    climateDetailText(at({ interiorTempC: 21, openWindowCount: 2 })),
    'Interior 21°C · Windows open',
  );
  // Singular and plural are two separate keys of theirs, not a formatter.
  assert.equal(climateDetailText(at({ openWindowCount: 1 })), 'Window open');
  assert.equal(climateDetailText(at({ openWindowCount: 3 })), 'Windows open');
  // Nothing known -> NO line, not a dash. We rendered showNum(), which prints an
  // em-dash, so an unread car claimed "Interior —".
  assert.equal(climateDetailText(base), null);
});

test('cabin overheat is its own element, not part of the detail run', () => {
  // @3888142 renders it separately, so it must not join the " · " list.
  assert.equal(climateOverheatText(at({ copActivelyCooling: true })), 'Cabin Overheat Protection');
  assert.equal(climateDetailText(at({ copActivelyCooling: true })), null);
  assert.equal(climateOverheatText(base), null);
});

test('the mode glyph — getActiveClimateIcon @3888184', () => {
  assert.equal(climateStatusIcon(at({ climateKeeper: 'camp' })), 'camp');
  assert.equal(climateStatusIcon(at({ climateKeeper: 'pet' })), 'dog');
  assert.equal(climateStatusIcon(at({ climateKeeper: 'on' })), 'climate');
  assert.equal(climateStatusIcon(at({ bioweaponOn: true, climateKeeper: 'camp' })), 'biohazard');
  assert.equal(climateStatusIcon(base), null);
});
