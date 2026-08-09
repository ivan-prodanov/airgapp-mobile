import { test } from 'node:test';
import assert from 'node:assert/strict';

import { configHash } from './vehicleConfigHash';
import { configForState } from './vehicleConfigForState';
import { initialVehicleState, vehicleConfigs, type VehicleViewState } from '../types/vehicleTypes';

function stateWith(partial: Partial<VehicleViewState>): VehicleViewState {
  return { ...initialVehicleState, ...partial };
}

test('configHash is a stable 8-char hex string', () => {
  const h = configHash(vehicleConfigs.modelY);
  assert.match(h, /^[0-9a-f]{8}$/);
  assert.equal(h, configHash(vehicleConfigs.modelY)); // deterministic
});

test('configHash differs when a render-relevant field differs (color)', () => {
  const red = configForState(stateWith({ carModel: 'modelY', exteriorColor: 'UltraRed' }));
  const blue = configForState(stateWith({ carModel: 'modelY', exteriorColor: 'DeepBlue' }));
  assert.notEqual(configHash(red), configHash(blue));
});

test('configHash matches for two cars with the same visible config (shared snapshot)', () => {
  const a = configForState(stateWith({ carModel: 'modelY', exteriorColor: 'DeepBlue', wheelType: 'Induction20Black' }));
  const b = configForState(stateWith({ carModel: 'modelY', exteriorColor: 'DeepBlue', wheelType: 'Induction20Black' }));
  assert.equal(configHash(a), configHash(b));
});

test('configHash is independent of key order in vehicle_config', () => {
  const base = vehicleConfigs.model3;
  const reordered = {
    ...base,
    vehicle_config: Object.fromEntries(
      Object.entries(base.vehicle_config).reverse(),
    ) as typeof base.vehicle_config,
  };
  assert.equal(configHash(base), configHash(reordered));
});

test('different models hash differently', () => {
  assert.notEqual(configHash(vehicleConfigs.modelS), configHash(vehicleConfigs.modelX));
});
