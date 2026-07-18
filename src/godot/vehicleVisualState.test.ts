import { test } from 'node:test';
import assert from 'node:assert/strict';

import { hasVehicleVisualStateChanged } from './vehicleVisualState';
import { initialVehicleState, type VehicleViewState } from '../types/vehicleTypes';

const base = initialVehicleState;
const changed = (patch: Partial<VehicleViewState>) => hasVehicleVisualStateChanged(base, { ...base, ...patch });

test('an unchanged state reports no visual change', () => {
  assert.equal(hasVehicleVisualStateChanged(base, { ...base }), false);
});

// Positive control: without these the "no-op" assertions below would pass vacuously.
test('renderer state still reports a visual change', () => {
  assert.equal(changed({ frunkOpen: true }), true);
  assert.equal(changed({ driving: true }), true);
  assert.equal(changed({ charging: true }), true);
  assert.equal(changed({ leftFrontWindowOpen: true }), true);
  assert.equal(changed({ climateOn: true }), true);
});

// The P3.T2 no-op guard. These fields are sheet/setpoint state that createGodotStatePayload never
// reads, so an UPDATE_PRODUCT for them would carry a byte-identical payload. hasVehicleVisualStateChanged
// is a DENYLIST, so a new field leaks into the renderer path unless it is explicitly ignored — this
// test is what catches that.
test('climate/charging setpoints and comfort toggles never trigger a renderer update', () => {
  assert.equal(changed({ targetTempC: 28 }), false);
  assert.equal(changed({ cabinOverheatMode: 'off' }), false);
  assert.equal(changed({ cabinOverheatTemp: '30' }), false);
  assert.equal(changed({ bioweaponOn: true }), false);
  assert.equal(changed({ campModeOn: true }), false);
  assert.equal(changed({ petModeOn: true }), false);
  assert.equal(changed({ chargeLimitPercent: 100 }), false);
  assert.equal(changed({ chargingAmps: 5 }), false);
  // The car's GPS position drives the map pin only, never the 3D payload.
  assert.equal(changed({ carLocation: { lat: 1, lon: 2, heading: null } }), false);
});

// A slider drag / held chevron mutates one setpoint per sample; none may reach Godot.
test('changing every setpoint at once is still not a visual change', () => {
  assert.equal(
    changed({
      targetTempC: 24,
      cabinOverheatMode: 'noac',
      cabinOverheatTemp: '35',
      bioweaponOn: true,
      campModeOn: true,
      petModeOn: true,
      chargeLimitPercent: 55,
      chargingAmps: 9,
    }),
    false,
  );
});

// A setpoint edit bundled with a real renderer change must still repaint (defrost sets both).
test('a setpoint bundled with renderer state still reports a change', () => {
  assert.equal(changed({ targetTempC: 28, frontDefrostOn: true }), true);
});
