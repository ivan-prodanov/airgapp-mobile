import { test } from 'node:test';
import assert from 'node:assert/strict';

import {
  bindVehicleVin,
  setClimateKeeperState,
  setClimateOnState,
  activeVehicle,
  addVehicle,
  AMP_MAX,
  AMP_MIN,
  clampSpeedLimitKmh,
  createInitialFleet,
  kmhToMph,
  mphToKmh,
  speedLimitDisplayKmh,
  speedLimitKmhToStoredMph,
  SPEED_LIMIT_MAX_KMH,
  SPEED_LIMIT_MIN_KMH,
  HI_TEMP,
  LIMIT_MAX,
  LIMIT_MIN,
  LO_TEMP,
  nextVehicleId,
  prevVehicleId,
  removeVehicle,
  setActiveVehicle,
  setChargeLimitState,
  setChargingAmpsState,
  setSeatClimateState,
  setSteeringWheelClimateState,
  setTargetTempState,
  stepSeatClimateState,
  stepSteeringWheelClimateState,
  toggleState,
  updateActiveVehicleState,
  updateEnrolledVehicleState,
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

test('updateEnrolledVehicleState always targets vehicles[0], even when another car is active', () => {
  // The launch-time cache rehydrate must land on the enrolled car (index 0)
  // regardless of which car is on screen — swipe to a demo car, rehydrate still
  // seeds the real car.
  let fleet = addVehicle(createInitialFleet(), 'model3'); // demo car becomes active
  assert.notEqual(fleet.activeId, fleet.vehicles[0].id); // active is NOT the enrolled car
  fleet = updateEnrolledVehicleState(fleet, (s) => ({ ...s, batteryLevel: 46 }));
  assert.equal(fleet.vehicles[0].state.batteryLevel, 46); // enrolled car got it
  assert.equal(activeVehicle(fleet).state.batteryLevel, null); // active demo car untouched
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

// --- Setpoints (lifted out of ClimateScreen/charging.tsx local useState) -------------------------

// This test is the anchor for the lift being a PURE refactor: these were the screens' useState
// defaults, so a fresh car must still render exactly what the screens used to mount with.
test('setpoint defaults match the screen-local useState values they replaced', () => {
  assert.equal(initialVehicleState.targetTempC, 19.5);
  // 'on' until 2026-07-29. It was a screen-local useState default that this test
  // faithfully pinned — but it is a claim about the CAR, made before we have read
  // the car, and it is rendered undimmed so it reads as fact. Tesla's own
  // selector resolves ON and FANONLY explicitly and lands everything else,
  // undefined included, on Off (@5224733). So Off is both the honest default and
  // theirs.
  assert.equal(initialVehicleState.cabinOverheatMode, 'off');
  assert.equal(initialVehicleState.cabinOverheatTemp, '40');
  assert.equal(initialVehicleState.bioweaponOn, false);
  assert.equal(initialVehicleState.climateKeeper, 'off');
  assert.equal(initialVehicleState.chargeLimitPercent, 80);
  assert.equal(initialVehicleState.chargingAmps, AMP_MAX);
});

test('setTargetTempState snaps to the 0.5° grid and clamps to the LO/HI sentinels', () => {
  const s = initialVehicleState;
  assert.equal(setTargetTempState(s, 19.5 + 0.5).targetTempC, 20); // the screen's +chevron
  assert.equal(setTargetTempState(s, 19.5 - 0.5).targetTempC, 19);
  assert.equal(setTargetTempState(s, 21.3).targetTempC, 21.5); // rounds to nearest half
  assert.equal(setTargetTempState(s, 21.1).targetTempC, 21);
  assert.equal(setTargetTempState(s, 99).targetTempC, HI_TEMP); // HI sentinel
  assert.equal(setTargetTempState(s, -5).targetTempC, LO_TEMP); // LO sentinel
  // Stepping past a bound saturates rather than wrapping, so a held chevron rests on LO/HI.
  assert.equal(setTargetTempState(setTargetTempState(s, HI_TEMP), HI_TEMP + 0.5).targetTempC, HI_TEMP);
});

test('setChargeLimitState clamps to the 50–100% slider domain', () => {
  const s = initialVehicleState;
  assert.equal(setChargeLimitState(s, 90).chargeLimitPercent, 90);
  assert.equal(setChargeLimitState(s, 0).chargeLimitPercent, LIMIT_MIN); // track spans 0–100, limit floors at 50
  assert.equal(setChargeLimitState(s, 100).chargeLimitPercent, LIMIT_MAX);
  assert.equal(setChargeLimitState(s, 250).chargeLimitPercent, LIMIT_MAX);
  assert.equal(setChargeLimitState(s, 73.6).chargeLimitPercent, 74); // slider hands over a raw fraction
});

test('setChargingAmpsState clamps to the 5–16 A stepper domain', () => {
  const s = initialVehicleState;
  assert.equal(setChargingAmpsState(s, 12).chargingAmps, 12);
  assert.equal(setChargingAmpsState(s, AMP_MIN - 1).chargingAmps, AMP_MIN);
  assert.equal(setChargingAmpsState(s, AMP_MAX + 1).chargingAmps, AMP_MAX);
});

test('the comfort toggles flip via toggleState (the generic path the sheet rows use)', () => {
  let s = initialVehicleState;
  for (const key of ['bioweaponOn'] as const) {
    s = toggleState(s, key);
    assert.equal(s[key], true);
    s = toggleState(s, key);
    assert.equal(s[key], false);
  }
  // Camp and Pet are NOT independent, and this test used to assert that they
  // were — "both can be on at once" was the defect written down as a guarantee.
  // The car has ONE `climateKeeperMode`, so selecting either necessarily clears
  // the other; Tesla's own screen prompts before doing it.
  let k = setClimateKeeperState(initialVehicleState, 'camp');
  assert.equal(k.climateKeeper, 'camp');
  k = setClimateKeeperState(k, 'pet');
  assert.equal(k.climateKeeper, 'pet', 'selecting Pet replaces Camp — it cannot add to it');
  k = setClimateKeeperState(k, 'off');
  assert.equal(k.climateKeeper, 'off');
});

test('setpoints are per-vehicle: editing the active car leaves the others alone', () => {
  const fleet = addVehicle(createInitialFleet(), 'model3'); // veh_2 active
  const edited = updateActiveVehicleState(fleet, (s) => setChargeLimitState(s, 100));
  assert.equal(activeVehicle(edited).state.chargeLimitPercent, 100);
  assert.equal(edited.vehicles[0].state.chargeLimitPercent, 80); // veh_1 untouched
});

// ── P3.T1: which vehicle is the enrolled car? ──────────────────────────────
test('bindVehicleVin marks one vehicle as the live car', () => {
  const fleet = addVehicle(createInitialFleet(), 'modelS');
  const bound = bindVehicleVin(fleet, fleet.vehicles[0].id, '5YJ...123');
  assert.equal(bound.vehicles[0].vin, '5YJ...123');
  assert.equal(bound.vehicles[1].vin, undefined, 'a demo car must never carry a vin');
});

test('bindVehicleVin CLEARS the vin from every other vehicle — "live" must be unambiguous', () => {
  // Two vins would silently share one gateway (useCarLink's single-gateway
  // invariant: session.ts's _domainCache is keyed on domain only, not VIN).
  let fleet = addVehicle(createInitialFleet(), 'modelS');
  fleet = bindVehicleVin(fleet, fleet.vehicles[0].id, 'VIN_A');
  fleet = bindVehicleVin(fleet, fleet.vehicles[1].id, 'VIN_B');
  assert.equal(fleet.vehicles[0].vin, undefined);
  assert.equal(fleet.vehicles[1].vin, 'VIN_B');
  assert.equal(fleet.vehicles.filter((v) => v.vin !== undefined).length, 1);
});

test('bindVehicleVin is idempotent — returns the same object when nothing changes', () => {
  const fleet = bindVehicleVin(createInitialFleet(), 'veh_1', 'VIN_A');
  assert.equal(bindVehicleVin(fleet, 'veh_1', 'VIN_A'), fleet, 'must not churn state each render');
});

test('a fresh fleet has no vin — nothing is live until enrollment binds one', () => {
  assert.equal(createInitialFleet().vehicles[0].vin, undefined);
});

// The rule useFleetState applies. Pinned here because getting it wrong sends a
// real command to a real car from a demo car's UI.
const activeIsLive = (activeVin: string | undefined, enrolled: string | null, linked: boolean) =>
  linked && !!enrolled && activeVin === enrolled;

test('activeIsLive: only the enrolled car on screen counts as live', () => {
  assert.equal(activeIsLive('VIN_A', 'VIN_A', true), true, 'the real car, enrolled');
  assert.equal(activeIsLive(undefined, 'VIN_A', true), false, 'a DEMO car while a real car is enrolled');
  assert.equal(activeIsLive('VIN_B', 'VIN_A', true), false, 'a different car');
  assert.equal(activeIsLive('VIN_A', null, false), false, 'nothing enrolled');
  assert.equal(activeIsLive(undefined, null, false), false, 'pure demo app');
});

test('speed-limit km/h stepping round-trips exactly (no 116→114 skip)', () => {
  // Default 85 mph reads as 137 km/h — the value shown in the Tesla screenshot.
  assert.equal(speedLimitDisplayKmh(85), 137);
  // THE fix: storing the exact km/h→mph value means every whole km/h in the domain displays back as
  // itself, so a 1-km/h step moves the reading by exactly 1 (never skips, never collapses).
  for (let k = SPEED_LIMIT_MIN_KMH; k <= SPEED_LIMIT_MAX_KMH; k += 1) {
    assert.equal(speedLimitDisplayKmh(speedLimitKmhToStoredMph(k)), k, `${k} km/h must round-trip`);
  }
  // The specific case from the bug report: 116 km/h then one step down is 115, not 114.
  assert.equal(speedLimitDisplayKmh(speedLimitKmhToStoredMph(116)) - 1, 115);
  // km/h clamp holds the domain.
  assert.equal(clampSpeedLimitKmh(SPEED_LIMIT_MIN_KMH - 5), SPEED_LIMIT_MIN_KMH);
  assert.equal(clampSpeedLimitKmh(SPEED_LIMIT_MAX_KMH + 5), SPEED_LIMIT_MAX_KMH);
  // Conversion sanity.
  assert.ok(Math.abs(kmhToMph(193) - 120) < 0.5, '193 km/h ≈ 120 mph');
  assert.ok(Math.abs(mphToKmh(50) - 80) < 1, '50 mph ≈ 80 km/h');
});

// ── Switching the climate off takes the seats with it ────────────────────────
//
// Ivan: "the cooling seats also turn off in tesla app but ours are kept until the
// refresh... I suspect not only cooling but generally any type of seat heat/cold
// is deactivated". Both true, and it is ONE rule of theirs, not a per-seat one:
// `getSeatClimateState` (@1235392) returns false for EVERY seat while
// `hasSeatAndHvacOffCommand` (@1234366) holds, which it does when the newest
// in-flight HVAC command is HvacAutoAction powerOn=false or ClimateKeeper OFF.
test('climate off clears every seat — heat, cool and auto alike', () => {
  const on: VehicleViewState = {
    ...initialVehicleState,
    climateOn: true,
    seatClimateModes: {
      ...initialVehicleState.seatClimateModes,
      frontLeft: { mode: 'cool', level: 3 },
      frontRight: { mode: 'heat', level: 2 },
      rearLeft: { mode: 'auto', level: 2, autoActivity: 'cool' },
    },
  };

  const off = setClimateOnState(on, false);
  assert.equal(off.climateOn, false);
  for (const seat of ['frontLeft', 'frontRight', 'rearLeft'] as const) {
    assert.deepEqual(off.seatClimateModes[seat], { mode: 'off', level: 0 }, seat);
  }

  // Turning the climate ON must NOT invent seat activity — only the off
  // direction clears, matching their one-way short-circuit.
  const backOn = setClimateOnState(off, true);
  assert.deepEqual(backOn.seatClimateModes, off.seatClimateModes);
});

test('switching a keeper mode off clears the seats the same way', () => {
  // The route Ivan actually hit: Camp Mode off. It drives climateOn false, and
  // the seats have to follow through the same rule rather than lingering until
  // the next read.
  const camp: VehicleViewState = {
    ...initialVehicleState,
    climateOn: true,
    climateKeeper: 'camp',
    seatClimateModes: {
      ...initialVehicleState.seatClimateModes,
      frontLeft: { mode: 'cool', level: 2 },
    },
  };
  const off = setClimateKeeperState(camp, 'off');
  assert.equal(off.climateOn, false);
  assert.deepEqual(off.seatClimateModes.frontLeft, { mode: 'off', level: 0 });

  // Starting a mode leaves the seats to the car.
  const started = setClimateKeeperState(initialVehicleState, 'camp');
  assert.equal(started.climateOn, true);
  assert.deepEqual(started.seatClimateModes, initialVehicleState.seatClimateModes);
});
