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
  setSeatClimateState,
  setSteeringWheelClimateState,
  stepSeatClimateState,
  stepSteeringWheelClimateState,
  toggleState,
  updateActiveVehicleState,
} from './fleet';
import { climateCapabilitiesFor, initialVehicleState, vehicleConfigs } from '../types/vehicleTypes';

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

// --- Climate controls: icon-tap (step down) + menu (set mode) ------------------------------------

// Icon taps ramp the level DOWN: off → max heat, then 3→2→1→off. (Model Y front seat = heatLevels 3.)
test('stepSeatClimateState ramps frontLeft heat down 3→2→1→off', () => {
  const s0 = { ...initialVehicleState }; // frontLeft: {off, 0}
  const s1 = stepSeatClimateState(s0, 'frontLeft');
  assert.deepEqual(s1.seatClimateModes.frontLeft, { mode: 'heat', level: 3 });
  const s2 = stepSeatClimateState(s1, 'frontLeft');
  assert.deepEqual(s2.seatClimateModes.frontLeft, { mode: 'heat', level: 2 });
  const s3 = stepSeatClimateState(s2, 'frontLeft');
  assert.deepEqual(s3.seatClimateModes.frontLeft, { mode: 'heat', level: 1 });
  const s4 = stepSeatClimateState(s3, 'frontLeft');
  assert.deepEqual(s4.seatClimateModes.frontLeft, { mode: 'off', level: 0 });
  // other seats untouched
  assert.deepEqual(s4.seatClimateModes.frontRight, { mode: 'off', level: 0 });
});

// The menu enters a mode at its MAX level; icon taps then ramp that mode down.
test('setSeatClimateState snaps to max level per mode, step ramps it down', () => {
  const cool0 = setSeatClimateState(initialVehicleState, 'frontLeft', 'cool');
  assert.deepEqual(cool0.seatClimateModes.frontLeft, { mode: 'cool', level: 3 });
  const cool1 = stepSeatClimateState(cool0, 'frontLeft');
  assert.deepEqual(cool1.seatClimateModes.frontLeft, { mode: 'cool', level: 2 });

  const auto = setSeatClimateState(initialVehicleState, 'frontLeft', 'auto');
  assert.deepEqual(auto.seatClimateModes.frontLeft, { mode: 'auto', level: 0 });
  // Tapping the icon in auto falls straight to off (auto has no level ramp).
  const offFromAuto = stepSeatClimateState(auto, 'frontLeft');
  assert.deepEqual(offFromAuto.seatClimateModes.frontLeft, { mode: 'off', level: 0 });
});

// Rear seats are heat-only (no cool/auto) — stepping just ramps heat down.
test('stepSeatClimateState rearLeft ramps heat 3→2→1→off (heat only)', () => {
  const s0 = { ...initialVehicleState };
  const s1 = stepSeatClimateState(s0, 'rearLeft');
  assert.deepEqual(s1.seatClimateModes.rearLeft, { mode: 'heat', level: 3 });
  const s2 = stepSeatClimateState(stepSeatClimateState(s1, 'rearLeft'), 'rearLeft');
  assert.deepEqual(s2.seatClimateModes.rearLeft, { mode: 'heat', level: 1 });
  const s3 = stepSeatClimateState(s2, 'rearLeft');
  assert.deepEqual(s3.seatClimateModes.rearLeft, { mode: 'off', level: 0 });
});

// Steering wheel: 2 heat levels (2→1→off), no cooling; menu offers Heat/Auto only.
test('stepSteeringWheelClimateState ramps 2→1→off; setSteeringWheelClimateState handles auto', () => {
  const s0 = { ...initialVehicleState }; // {off, 0}
  const s1 = stepSteeringWheelClimateState(s0);
  assert.deepEqual(s1.steeringWheelClimate, { mode: 'heat', level: 2 });
  const s2 = stepSteeringWheelClimateState(s1);
  assert.deepEqual(s2.steeringWheelClimate, { mode: 'heat', level: 1 });
  const s3 = stepSteeringWheelClimateState(s2);
  assert.deepEqual(s3.steeringWheelClimate, { mode: 'off', level: 0 });

  const auto = setSteeringWheelClimateState(s0, 'auto');
  assert.deepEqual(auto.steeringWheelClimate, { mode: 'auto', level: 0 });
  assert.deepEqual(stepSteeringWheelClimateState(auto).steeringWheelClimate, { mode: 'off', level: 0 });
});

// Per-model climate capabilities — the config that gates which controls show (mirrors Tesla's
// VehicleConfig; one day fed from BLE). These lock in the model-specific differences.
test('Model Y: ventilated+auto front, NO rear-centre heater, round wheel with heat+auto', () => {
  const y = climateCapabilitiesFor('modelY');
  assert.equal(y.seats.frontLeft.coolLevels > 0, true); // has seat cooling
  assert.equal(y.seats.frontLeft.auto, true);
  assert.equal(y.seats.rearMiddle.heatLevels, 0); // LEFTRIGHTONLY → no centre control
  assert.equal(y.seats.rearLeft.heatLevels > 0, true);
  assert.deepEqual(y.steeringWheel, { heating: true, heatLevels: 2, auto: true, type: 'round' });
});

test('Current Model 3 is fully featured (ventilated + auto front, heated+auto wheel)', () => {
  const m3 = climateCapabilitiesFor('model3');
  assert.equal(m3.seats.frontLeft.coolLevels > 0, true);
  assert.equal(m3.seats.frontLeft.auto, true);
  assert.equal(m3.steeringWheel.auto, true);
});

test('Older trims drop ventilation/auto; earliest Model 3 has no heated wheel', () => {
  const oldS = climateCapabilitiesFor('modelSLegacy');
  assert.equal(oldS.seats.frontLeft.coolLevels, 0); // no ventilation
  assert.equal(oldS.seats.frontLeft.auto, false); // no auto seat climate
  assert.equal(oldS.seats.frontLeft.heatLevels > 0, true); // still heated
  assert.equal(oldS.seats.rearMiddle.heatLevels > 0, true); // classic S keeps its 3 heated rear seats
  assert.equal(oldS.steeringWheel.heating, true); // round heated wheel...
  assert.equal(oldS.steeringWheel.auto, false); // ...but no wheel auto

  const old3 = climateCapabilitiesFor('model3Legacy');
  assert.equal(old3.steeringWheel.heating, false); // earliest 3 → wheel control absent entirely
  assert.equal(old3.seats.frontLeft.coolLevels, 0);
});

test('Model X 6-seater = captain chairs (no rear centre) + heated 3rd row; 7-seater = bench + 3rd row', () => {
  const x6 = climateCapabilitiesFor('modelX6Seat');
  assert.equal(x6.seats.rearMiddle.heatLevels, 0); // captain chairs → no centre seat/control
  assert.equal(x6.seats.thirdRowLeft.heatLevels > 0, true);
  assert.equal(x6.seats.thirdRowRight.heatLevels > 0, true);

  const x7 = climateCapabilitiesFor('modelX7Seat');
  assert.equal(x7.seats.rearMiddle.heatLevels > 0, true); // bench → centre present
  assert.equal(x7.seats.thirdRowLeft.heatLevels > 0, true);
});

test('Older trims render a distinct (older) body, and X seat variants carry the Godot seat config', () => {
  // Current vs older bodies use different car_type/fascia (→ different Godot scene), not a clone.
  assert.equal(vehicleConfigs.modelY.vehicle_config.fascia_type, 'performanceBayberry'); // Bayberry = current Juniper
  assert.equal(vehicleConfigs.modelYLegacy.vehicle_config.fascia_type, 'original'); // Y_High = older body
  assert.equal(vehicleConfigs.model3.vehicle_config.fascia_type, 'performancePoppyseed'); // Poppyseed = current Highland
  assert.equal(vehicleConfigs.model3Legacy.vehicle_config.fascia_type, 'original'); // Model3_High = older body
  assert.equal(vehicleConfigs.modelS.vehicle_config.car_type, 'lychee'); // S_Palladium
  assert.equal(vehicleConfigs.modelSLegacy.vehicle_config.car_type, 'models'); // classic Model_S
  assert.equal(vehicleConfigs.modelXLegacy.vehicle_config.car_type, 'modelx'); // classic Model_X

  // X seat variants: distinct ids (so the renderer re-shows) + the seat-config fields Godot reads.
  assert.equal(vehicleConfigs.modelX6Seat.vehicle_config.rear_seat_type, 3); // TwoSeat → 6-seat captain
  assert.equal(vehicleConfigs.modelX7Seat.vehicle_config.rear_seat_type, 0); // Base → 7-seat bench
  assert.notEqual(vehicleConfigs.modelX6Seat.id, vehicleConfigs.modelX.id);
  assert.notEqual(vehicleConfigs.modelX7Seat.id, vehicleConfigs.modelX6Seat.id);
  assert.notEqual(vehicleConfigs.modelX6Seat.vehicle_config.third_row_seats, 'None');
});

test('Model S/X: all three rear seats heated (incl. centre); Model X uses the yoke', () => {
  const s = climateCapabilitiesFor('modelS');
  assert.equal(s.seats.rearMiddle.heatLevels > 0, true); // THREESEATS → centre heated
  assert.equal(s.steeringWheel.type, 'round');
  const x = climateCapabilitiesFor('modelX');
  assert.equal(x.seats.rearMiddle.heatLevels > 0, true);
  assert.equal(x.steeringWheel.type, 'yoke');
});
