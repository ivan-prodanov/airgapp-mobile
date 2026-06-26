import test from 'node:test';
import assert from 'node:assert/strict';

import { CONTROL_ACTIONS, CONTROL_ACTION_ORDER, DEFAULT_FAVORITES, type ControlActionId } from './controlActions';
import { initialVehicleState, type VehicleViewState } from '../types/vehicleTypes';

const stateWith = (patch: Partial<VehicleViewState>): VehicleViewState => ({ ...initialVehicleState, ...patch });

test('CONTROL_ACTION_ORDER lists every catalog action exactly once', () => {
  const ids = Object.keys(CONTROL_ACTIONS) as ControlActionId[];
  assert.equal(CONTROL_ACTION_ORDER.length, ids.length);
  assert.deepEqual([...CONTROL_ACTION_ORDER].sort(), [...ids].sort());
});

test('there are 17 actions', () => {
  assert.equal(Object.keys(CONTROL_ACTIONS).length, 17);
});

test('every action def id matches its catalog key', () => {
  for (const [key, def] of Object.entries(CONTROL_ACTIONS)) {
    assert.equal(def.id, key);
  }
});

test('lock gridLabel reflects Locked/Unlocked state', () => {
  assert.equal(CONTROL_ACTIONS.lock.gridLabel?.(stateWith({ locked: true })), 'Locked');
  assert.equal(CONTROL_ACTIONS.lock.gridLabel?.(stateWith({ locked: false })), 'Unlocked');
});

test('climate gridLabel reflects On/Off state', () => {
  assert.equal(CONTROL_ACTIONS.climate.gridLabel?.(stateWith({ climateOn: false })), 'Off');
  assert.equal(CONTROL_ACTIONS.climate.gridLabel?.(stateWith({ climateOn: true })), 'On');
});

test('charging gridLabel reflects charge-port + charging state', () => {
  const label = (patch: Partial<VehicleViewState>) => CONTROL_ACTIONS.charging.gridLabel?.(stateWith(patch));
  assert.equal(label({ chargePortOpen: false }), 'Open');
  assert.equal(label({ chargePortOpen: true, charging: false }), 'Close');
  assert.equal(label({ chargePortOpen: true, charging: true }), 'Unlock');
});

test('charging run opens a closed port and closes (+ stops charging) an open one', () => {
  const patches: Partial<VehicleViewState>[] = [];
  const actions = { patch: (p: Partial<VehicleViewState>) => patches.push(p) } as never;

  CONTROL_ACTIONS.charging.run(stateWith({ chargePortOpen: false }), actions);
  assert.deepEqual(patches.at(-1), { chargePortOpen: true });

  CONTROL_ACTIONS.charging.run(stateWith({ chargePortOpen: true, charging: true }), actions);
  assert.deepEqual(patches.at(-1), { chargePortOpen: false, charging: false });
});

test('fart action exists with a static label', () => {
  assert.ok(CONTROL_ACTIONS.fart);
  assert.equal(CONTROL_ACTIONS.fart.label, 'Fart');
  assert.equal(CONTROL_ACTIONS.fart.gridLabel, undefined);
});

test('DEFAULT_FAVORITES are five valid, distinct action ids', () => {
  assert.equal(DEFAULT_FAVORITES.length, 5);
  assert.equal(new Set(DEFAULT_FAVORITES).size, 5);
  for (const id of DEFAULT_FAVORITES) {
    assert.ok(CONTROL_ACTIONS[id], `unknown favorite ${id}`);
  }
});
