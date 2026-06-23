import { test } from 'node:test';
import assert from 'node:assert/strict';

import {
  activeVehicle,
  addVehicle,
  createInitialFleet,
  nextVehicleId,
  prevVehicleId,
  removeVehicle,
  setActiveVehicle,
  toggleState,
  updateActiveVehicleState,
} from './fleet';

test('initial fleet is a single Model Y named Red Velvet, active', () => {
  const fleet = createInitialFleet();
  assert.equal(fleet.vehicles.length, 1);
  assert.equal(fleet.vehicles[0].id, 'veh_1');
  assert.equal(fleet.vehicles[0].name, 'Red Velvet');
  assert.equal(fleet.vehicles[0].state.carModel, 'modelY');
  assert.equal(fleet.activeId, 'veh_1');
});

test('addVehicle appends a fresh car of the chosen model and makes it active', () => {
  const fleet = addVehicle(createInitialFleet(), 'model3');
  assert.equal(fleet.vehicles.length, 2);
  const added = fleet.vehicles[1];
  assert.equal(added.id, 'veh_2');
  assert.equal(added.name, 'Model 3');
  assert.equal(added.state.carModel, 'model3');
  assert.equal(added.state.locked, true); // fresh default state
  assert.equal(fleet.activeId, 'veh_2');
});

test('addVehicle de-dups names for the same model', () => {
  let fleet = createInitialFleet();
  fleet = addVehicle(fleet, 'model3');
  fleet = addVehicle(fleet, 'model3');
  assert.deepEqual(
    fleet.vehicles.map((v) => v.name),
    ['Red Velvet', 'Model 3', 'Model 3 (2)'],
  );
});

test('new vehicle inherits theme and lightingMode from the active car', () => {
  let fleet = createInitialFleet();
  fleet = updateActiveVehicleState(fleet, (s) => ({ ...s, theme: 'light', lightingMode: 'ambient_fill' }));
  fleet = addVehicle(fleet, 'modelX');
  const added = activeVehicle(fleet).state;
  assert.equal(added.theme, 'light');
  assert.equal(added.lightingMode, 'ambient_fill');
});

test('removeVehicle is a no-op when only one car remains', () => {
  const fleet = createInitialFleet();
  assert.deepEqual(removeVehicle(fleet, 'veh_1'), fleet);
});

test('removing the active car selects the previous neighbor', () => {
  let fleet = createInitialFleet();
  fleet = addVehicle(fleet, 'model3'); // veh_2, active
  fleet = addVehicle(fleet, 'modelX'); // veh_3, active
  fleet = setActiveVehicle(fleet, 'veh_2');
  fleet = removeVehicle(fleet, 'veh_2');
  assert.equal(fleet.vehicles.length, 2);
  assert.equal(fleet.activeId, 'veh_1'); // previous neighbor
});

test('removing the active first car selects the next neighbor', () => {
  let fleet = addVehicle(createInitialFleet(), 'model3'); // veh_2
  fleet = setActiveVehicle(fleet, 'veh_1');
  fleet = removeVehicle(fleet, 'veh_1');
  assert.equal(fleet.activeId, 'veh_2');
});

test('next/prev vehicle id clamps at the ends', () => {
  let fleet = addVehicle(createInitialFleet(), 'model3'); // veh_1, veh_2; active veh_2
  fleet = setActiveVehicle(fleet, 'veh_1');
  assert.equal(prevVehicleId(fleet), 'veh_1'); // clamp at start
  assert.equal(nextVehicleId(fleet), 'veh_2');
  fleet = setActiveVehicle(fleet, 'veh_2');
  assert.equal(nextVehicleId(fleet), 'veh_2'); // clamp at end
});

test('updateActiveVehicleState mutates only the active car', () => {
  let fleet = addVehicle(createInitialFleet(), 'model3'); // active veh_2
  fleet = setActiveVehicle(fleet, 'veh_1');
  fleet = updateActiveVehicleState(fleet, (s) => toggleState(s, 'locked'));
  assert.equal(fleet.vehicles[0].state.locked, false); // veh_1 toggled
  assert.equal(fleet.vehicles[1].state.locked, true); // veh_2 untouched
});
