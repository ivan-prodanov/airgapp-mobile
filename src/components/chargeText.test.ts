import { test } from 'node:test';
import assert from 'node:assert/strict';

import { chargingStateText, chargingTextStrings } from './chargeText';

// Recovered from chargeRowStateSelector @3884280-3884400. See chargeText.ts.

test('chargingStateText: the four branches of getVehicleChargingStateText', () => {
  assert.equal(chargingStateText('Charging'), 'Charging');
  assert.equal(chargingStateText('Complete'), 'Charging Complete');
  assert.equal(chargingStateText('Stopped'), 'Charging Stopped');
  assert.equal(chargingStateText('NoPower'), 'No Power');
});

test('chargingStateText: states with no arm in their switch render nothing', () => {
  // Disconnected/Starting/Unknown have no branch, so the header's right side is
  // empty. Inventing a label for them would put text where theirs shows none.
  assert.equal(chargingStateText('Disconnected'), null);
  assert.equal(chargingStateText('Starting'), null);
  assert.equal(chargingStateText(null), null);
});

test('charging: the row is live values, NOT the last-session sentence', () => {
  // The bug Ivan caught: a charging car showed "0 kWh added during last charging
  // session" because we only ever built the idle line.
  const lines = chargingTextStrings({
    fastCharging: false,
    chargerPowerKw: 7.4,
    energyAddedKwh: 12,
    chargerActualCurrentA: 16,
    chargerVoltageV: 230,
  });
  assert.deepEqual(lines, ['7.4 kW', '+12 kWh', '16A · 230V']);
});

test('charging on DC: no current/voltage pair', () => {
  // getVehicleChargingCurrentAndVoltageText is gated on !isFastCharging.
  const lines = chargingTextStrings({
    fastCharging: true,
    chargerPowerKw: 149,
    energyAddedKwh: 34,
    chargerActualCurrentA: 320,
    chargerVoltageV: 400,
  });
  assert.deepEqual(lines, ['149 kW', '+34 kWh']);
});

test('charging: each element is dropped independently when the car is quiet', () => {
  assert.deepEqual(
    chargingTextStrings({
      fastCharging: false,
      chargerPowerKw: null,
      energyAddedKwh: 3,
      chargerActualCurrentA: null,
      chargerVoltageV: null,
    }),
    ['+3 kWh'],
  );
  assert.deepEqual(
    chargingTextStrings({
      fastCharging: false,
      chargerPowerKw: null,
      energyAddedKwh: null,
      chargerActualCurrentA: 16,
      chargerVoltageV: null,
    }),
    ['16A'],
  );
});

test('kW keeps a decimal only below 10, where it carries information', () => {
  const ac = chargingTextStrings({
    fastCharging: false,
    chargerPowerKw: 7.45,
    energyAddedKwh: null,
    chargerActualCurrentA: null,
    chargerVoltageV: null,
  });
  assert.deepEqual(ac, ['7.5 kW']);
  const dc = chargingTextStrings({
    fastCharging: true,
    chargerPowerKw: 148.6,
    energyAddedKwh: null,
    chargerActualCurrentA: null,
    chargerVoltageV: null,
  });
  assert.deepEqual(dc, ['149 kW']);
});
