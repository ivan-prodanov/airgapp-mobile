import { test } from 'node:test';
import assert from 'node:assert/strict';

import { chargingStateText, chargingTextStrings, STATE_SEPARATOR } from './chargeText';

// Recovered from chargeRowStateSelector @3884280-3884400. See chargeText.ts.

test('chargingStateText: the four branches of getVehicleChargingStateText', () => {
  assert.equal(chargingStateText('Charging'), 'Charging');
  assert.equal(chargingStateText('Complete'), 'Charging Complete');
  assert.equal(chargingStateText('Stopped'), 'Charging Stopped');
  // Verified against the shipped English table (main.decompiled.js:926615), not
  // inferred from the key — which is how it was wrong the first time.
  assert.equal(chargingStateText('NoPower'), 'Charging Error - No Power');
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
    chargerPilotCurrentA: 32,
  });
  // kW is an INTEGER (Math.round(Math.max(0, ...))) — 7.4 renders as "7".
  // Current is "actual/nominal A" when the pilot current is known.
  // Separator is the SAME "  ·  " as the header, not a tighter one.
  assert.deepEqual(lines, ['7 kW', '+12 kWh', '16/32A  ·  230V']);
});

test('charging on DC: no current/voltage pair', () => {
  // getVehicleChargingCurrentAndVoltageText is gated on !isFastCharging.
  const lines = chargingTextStrings({
    fastCharging: true,
    chargerPowerKw: 149,
    energyAddedKwh: 34,
    chargerActualCurrentA: 320,
    chargerVoltageV: 400,
    chargerPilotCurrentA: 500,
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
      chargerPilotCurrentA: null,
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
      chargerPilotCurrentA: null,
    }),
    ['16A'],
  );
});

test('kW is always an integer, and negative power clamps to 0', () => {
  // getVehicleChargingkWText = Math.round(Math.max(0, chargerPower)) + ' kW'.
  // I had invented a "keep a decimal below 10" rule; theirs has no such branch.
  const base = {
    fastCharging: true as boolean,
    energyAddedKwh: null,
    chargerActualCurrentA: null,
    chargerVoltageV: null,
    chargerPilotCurrentA: null,
  };
  assert.deepEqual(chargingTextStrings({ ...base, chargerPowerKw: 7.45 }), ['7 kW']);
  assert.deepEqual(chargingTextStrings({ ...base, chargerPowerKw: 148.6 }), ['149 kW']);
  // Math.max(0, ...) — a car briefly reporting negative power must not print "-1 kW".
  assert.deepEqual(chargingTextStrings({ ...base, chargerPowerKw: -1 }), ['0 kW']);
});

test('current falls back to 0A only when we already have a voltage to show', () => {
  // Theirs ALWAYS emits a current part, 0 when null. For us a null can also mean
  // "not read yet", so a bare unknown omits the item rather than fabricating 0A
  // — but once any part is known we mirror them, 0 fallback included.
  assert.deepEqual(
    chargingTextStrings({
      fastCharging: false,
      chargerPowerKw: null,
      energyAddedKwh: null,
      chargerActualCurrentA: null,
      chargerVoltageV: 230,
      chargerPilotCurrentA: null,
    }),
    ['0A  ·  230V'],
  );
});

test('the state runs INLINE after the limit, behind a dot separator', () => {
  // @4157408: ''.concat(dotSeparator, '  ') with `this` = '  ' — two spaces,
  // U+00B7, two spaces. Not a layout gap; a literal string in a nested <Text>.
  assert.equal(STATE_SEPARATOR, '  ·  ');
  assert.equal(
    `Charge limit: 80%${STATE_SEPARATOR}${chargingStateText('Charging')}`,
    'Charge limit: 80%  ·  Charging',
  );
});
