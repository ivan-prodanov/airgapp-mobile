import { test } from 'node:test';
import assert from 'node:assert/strict';

import { configForState } from './vehicleConfigForState';
import { initialVehicleState, vehicleConfigs, type VehicleViewState } from '../types/vehicleTypes';

function stateWith(partial: Partial<VehicleViewState>): VehicleViewState {
  return { ...initialVehicleState, ...partial };
}

test('configForState: no overrides returns the model base config object unchanged', () => {
  const cfg = configForState(stateWith({ carModel: 'modelY', exteriorColor: null, wheelType: null }));
  assert.equal(cfg, vehicleConfigs.modelY); // same reference — no needless clone
});

test('configForState: both overrides merge into vehicle_config, base untouched', () => {
  const cfg = configForState(
    stateWith({ carModel: 'modelY', exteriorColor: 'DeepBlue', wheelType: 'Induction20Black' }),
  );
  assert.equal(cfg.vehicle_config.exterior_color, 'DeepBlue');
  assert.equal(cfg.vehicle_config.wheel_type, 'Induction20Black');
  // Everything else carries over from the model base…
  assert.equal(cfg.vehicle_config.car_type, vehicleConfigs.modelY.vehicle_config.car_type);
  // …and the shared base object is not mutated.
  assert.equal(vehicleConfigs.modelY.vehicle_config.exterior_color, 'UltraRed');
});

test('configForState: a single override leaves the other field at the model default', () => {
  const cfg = configForState(stateWith({ carModel: 'modelS', exteriorColor: 'PearlWhite', wheelType: null }));
  assert.equal(cfg.vehicle_config.exterior_color, 'PearlWhite');
  assert.equal(cfg.vehicle_config.wheel_type, vehicleConfigs.modelS.vehicle_config.wheel_type);
});

test('configForState: interiorTrim override lands on interior_trim_type', () => {
  const cfg = configForState(stateWith({ carModel: 'modelY', interiorTrim: 'Cream' }));
  assert.equal(cfg.vehicle_config.interior_trim_type, 'Cream');
});

test('configForState: performance=true → red calipers + a spoiler; false → neither', () => {
  const perf = configForState(stateWith({ carModel: 'modelY', performance: true })).vehicle_config;
  assert.equal(perf.red_brake_calipers, true);
  assert.equal(perf.spoiler_type, 'CarbonFiber');

  const base = configForState(stateWith({ carModel: 'modelY', performance: false })).vehicle_config;
  assert.equal(base.red_brake_calipers, false);
  assert.equal(base.spoiler_type, 'None');
});

test('configForState: performance swaps the front fascia on Highland(3)/Juniper(Y)', () => {
  assert.equal(
    configForState(stateWith({ carModel: 'modelY', performance: true })).vehicle_config.fascia_type,
    'performanceBayberry',
  );
  assert.equal(
    configForState(stateWith({ carModel: 'modelY', performance: false })).vehicle_config.fascia_type,
    'baseBayberry',
  );
  assert.equal(
    configForState(stateWith({ carModel: 'model3', performance: false })).vehicle_config.fascia_type,
    'basePoppyseed',
  );
});

test('configForState: models without a fascia toggle keep their base fascia', () => {
  // Model S has no perf/standard fascia variant → fascia_type unchanged by trim.
  const s = configForState(stateWith({ carModel: 'modelS', performance: false })).vehicle_config;
  assert.equal(s.fascia_type, vehicleConfigs.modelS.vehicle_config.fascia_type);
});
