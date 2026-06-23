import { test } from 'node:test';
import assert from 'node:assert/strict';

import {
  activeVehicle,
  addVehicle,
  createInitialFleet,
  cycleSeatClimateState,
  cycleSteeringWheelClimateState,
  nextVehicleId,
  prevVehicleId,
  removeVehicle,
  setActiveVehicle,
  toggleState,
  updateActiveVehicleState,
} from './fleet';
import { initialVehicleState } from '../types/vehicleTypes';

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

// Model Y steering wheel: heating=true, auto=true → sequence: off → heat → auto → off
test('cycleSteeringWheelClimateState advances off→heat→auto→off for Model Y', () => {
  const s0 = { ...initialVehicleState, steeringWheelClimateMode: 'off' as const };
  const s1 = cycleSteeringWheelClimateState(s0);
  assert.equal(s1.steeringWheelClimateMode, 'heat');
  const s2 = cycleSteeringWheelClimateState(s1);
  assert.equal(s2.steeringWheelClimateMode, 'auto');
  const s3 = cycleSteeringWheelClimateState(s2);
  assert.equal(s3.steeringWheelClimateMode, 'off'); // wraps back
});

// Model Y frontLeft: heatLevels=3, coolLevels=3, auto=true
// sequence: {off,0} → {heat,1} → {heat,2} → {heat,3} → {auto,0} → {cool,1} → {cool,2} → {cool,3} → {off,0}
// Model Y rearLeft: heatLevels=3, coolLevels=0, auto=false
// sequence: {off,0} → {heat,1} → {heat,2} → {heat,3} → {off,0}
test('cycleSeatClimateState advances frontLeft through full heat/auto/cool sequence', () => {
  const s0 = { ...initialVehicleState }; // frontLeft: {off, 0}
  const s1 = cycleSeatClimateState(s0, 'frontLeft');
  assert.deepEqual(s1.seatClimateModes.frontLeft, { mode: 'heat', level: 1 });
  const s2 = cycleSeatClimateState(s1, 'frontLeft');
  assert.deepEqual(s2.seatClimateModes.frontLeft, { mode: 'heat', level: 2 });
  const s3 = cycleSeatClimateState(s2, 'frontLeft');
  assert.deepEqual(s3.seatClimateModes.frontLeft, { mode: 'heat', level: 3 });
  const s4 = cycleSeatClimateState(s3, 'frontLeft');
  assert.deepEqual(s4.seatClimateModes.frontLeft, { mode: 'auto', level: 0 });
  const s5 = cycleSeatClimateState(s4, 'frontLeft');
  assert.deepEqual(s5.seatClimateModes.frontLeft, { mode: 'cool', level: 1 });
  const s6 = cycleSeatClimateState(s5, 'frontLeft');
  assert.deepEqual(s6.seatClimateModes.frontLeft, { mode: 'cool', level: 2 });
  const s7 = cycleSeatClimateState(s6, 'frontLeft');
  assert.deepEqual(s7.seatClimateModes.frontLeft, { mode: 'cool', level: 3 });
  const s8 = cycleSeatClimateState(s7, 'frontLeft'); // wraps back to off
  assert.deepEqual(s8.seatClimateModes.frontLeft, { mode: 'off', level: 0 });
  // other seats untouched throughout
  assert.deepEqual(s8.seatClimateModes.frontRight, { mode: 'off', level: 0 });
  assert.deepEqual(s8.seatClimateModes.rearLeft, { mode: 'off', level: 0 });
});

test('cycleSeatClimateState rearLeft has no cool/auto — wraps after heat level 3', () => {
  const s0 = { ...initialVehicleState }; // rearLeft: {off, 0}
  const s1 = cycleSeatClimateState(s0, 'rearLeft');
  assert.deepEqual(s1.seatClimateModes.rearLeft, { mode: 'heat', level: 1 });
  const s2 = cycleSeatClimateState(s1, 'rearLeft');
  assert.deepEqual(s2.seatClimateModes.rearLeft, { mode: 'heat', level: 2 });
  const s3 = cycleSeatClimateState(s2, 'rearLeft');
  assert.deepEqual(s3.seatClimateModes.rearLeft, { mode: 'heat', level: 3 });
  const s4 = cycleSeatClimateState(s3, 'rearLeft'); // wraps — no cool, no auto
  assert.deepEqual(s4.seatClimateModes.rearLeft, { mode: 'off', level: 0 });
  // frontLeft untouched
  assert.deepEqual(s4.seatClimateModes.frontLeft, { mode: 'off', level: 0 });
});
