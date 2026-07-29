// reconcile.test.ts — the pure diffToCommands / revertFields tests.
//
// Runs under plain node. Every case that maps to a real BLE command is pinned
// here because the failure mode is "a wrong command reaches a real car".

import { test } from 'node:test';
import assert from 'node:assert/strict';

import {
  setTargetTempState,
  stepSeatClimateState,
  stepSteeringWheelClimateState,
} from '../state/fleet';
import { diffToCommands, revertFields, type ReconciledCommand } from './reconcile';
import { initialVehicleState, type VehicleStateKey, type VehicleViewState } from '../types/vehicleTypes';

const base: VehicleViewState = initialVehicleState;
const s = (patch: Partial<VehicleViewState>): VehicleViewState => ({ ...base, ...patch });

// Assert the emitted (cmd, keys) pairs, order-independent.
function expect(prev: VehicleViewState, next: VehicleViewState, want: ReconciledCommand[]) {
  const norm = (r: ReconciledCommand[]) =>
    r
      .map((x) => ({ cmd: x.cmd, keys: [...x.keys].sort() }))
      .sort((a, b) => JSON.stringify(a).localeCompare(JSON.stringify(b)));
  assert.deepEqual(norm(diffToCommands(prev, next)), norm(want));
}

test('no change emits nothing', () => {
  expect(s({ locked: true }), s({ locked: true }), []);
});

test('a non-command field change (batteryLevel) emits nothing', () => {
  expect(s({ batteryLevel: 40 }), s({ batteryLevel: 80 }), []);
});

test('lock / unlock', () => {
  expect(s({ locked: false }), s({ locked: true }), [{ cmd: { type: 'lock' }, keys: ['locked'] }]);
  expect(s({ locked: true }), s({ locked: false }), [{ cmd: { type: 'unlock' }, keys: ['locked'] }]);
});

test('the frunk emits NOTHING from a diff — actuation is dispatched explicitly', () => {
  // This test used to assert the opposite: that BOTH transitions emit openFrunk.
  // That rule was correct while the optimistic value toggled, and it is exactly
  // what made the double-tap defect possible.
  //
  // The command is now dispatched explicitly by useFleetState's actuateFrunk,
  // because the command and the state deliberately no longer move together: the
  // command fires on EVERY tap (their sendFrunkCommand always sends open on a
  // non-powered frunk, and an aftermarket auto-close rides it), while the
  // optimistic value only ever moves to OPEN. A diff rule cannot express that —
  // it would send nothing on the second tap, which is the tap that matters.
  expect(s({ frunkOpen: false }), s({ frunkOpen: true }), []);
  expect(s({ frunkOpen: true }), s({ frunkOpen: false }), []);
});

test('trunk / charge port open+close', () => {
  expect(s({ trunkOpen: false }), s({ trunkOpen: true }), [
    { cmd: { type: 'openTrunk' }, keys: ['trunkOpen'] },
  ]);
  expect(s({ chargePortOpen: true }), s({ chargePortOpen: false }), [
    { cmd: { type: 'closeChargePort' }, keys: ['chargePortOpen'] },
  ]);
});

test('sentry on/off', () => {
  expect(s({ sentryEnabled: false }), s({ sentryEnabled: true }), [
    { cmd: { type: 'sentry', on: true }, keys: ['sentryEnabled'] },
  ]);
});

test('windows: any-open → vent, all-closed → close, owning the whole set', () => {
  const wk = ['leftFrontWindowOpen', 'rightFrontWindowOpen', 'leftRearWindowOpen', 'rightRearWindowOpen'];
  expect(base, s({ leftFrontWindowOpen: true }), [{ cmd: { type: 'ventWindows' }, keys: wk }]);
  expect(s({ leftFrontWindowOpen: true, rightRearWindowOpen: true }), base, [
    { cmd: { type: 'closeWindows' }, keys: wk },
  ]);
});

test('windows: still-vented → still-vented emits nothing', () => {
  expect(s({ leftFrontWindowOpen: true }), s({ leftFrontWindowOpen: true, rightFrontWindowOpen: true }), []);
});

test('charging: start/stop, limit, amps', () => {
  expect(s({ charging: false }), s({ charging: true }), [
    { cmd: { type: 'chargeStart' }, keys: ['charging'] },
  ]);
  expect(s({ chargeLimitPercent: 80 }), s({ chargeLimitPercent: 90 }), [
    { cmd: { type: 'setChargeLimit', percent: 90 }, keys: ['chargeLimitPercent'] },
  ]);
  expect(s({ chargingAmps: 16 }), s({ chargingAmps: 24 }), [
    { cmd: { type: 'setChargingAmps', amps: 24 }, keys: ['chargingAmps'] },
  ]);
});

test('climate: on/off, temp, bioweapon, overheat, camp, pet', () => {
  expect(s({ climateOn: false }), s({ climateOn: true }), [
    { cmd: { type: 'climateOn' }, keys: ['climateOn'] },
  ]);
  expect(s({ targetTempC: 19.5 }), s({ targetTempC: 21 }), [
    { cmd: { type: 'setClimateTemp', celsius: 21 }, keys: ['targetTempC'] },
  ]);
  expect(s({ bioweaponOn: false }), s({ bioweaponOn: true }), [
    {
      cmd: { type: 'bioweaponMode', on: true, manualOverride: false },
      // Claims climateOn too: enabling bioweapon runs the HVAC, and Tesla's
      // derived isClimateOn reports it while the command is in flight.
      keys: ['bioweaponOn', 'climateOn'],
    },
  ]);
  expect(s({ cabinOverheatMode: 'on' }), s({ cabinOverheatMode: 'off' }), [
    { cmd: { type: 'cabinOverheat', on: false, fanOnly: false }, keys: ['cabinOverheatMode'] },
  ]);
  // No A/C is its OWN command. `fanOnly` used to be pinned false, so this arm
  // encoded byte-identically to On and the selection snapped back a read later.
  expect(s({ cabinOverheatMode: 'off' }), s({ cabinOverheatMode: 'noac' }), [
    { cmd: { type: 'cabinOverheat', on: true, fanOnly: true }, keys: ['cabinOverheatMode'] },
  ]);
  expect(s({ cabinOverheatMode: 'off' }), s({ cabinOverheatMode: 'on' }), [
    { cmd: { type: 'cabinOverheat', on: true, fanOnly: false }, keys: ['cabinOverheatMode'] },
  ]);

  // ONE keeper field -> ONE command, and it claims the single key it owns.
  // Starting a keeper mode also claims climateOn — see the implied-climate-on
  // test below.
  expect(s({ climateKeeper: 'off' }), s({ climateKeeper: 'camp' }), [
    { cmd: { type: 'climateKeeper', mode: 'camp' }, keys: ['climateKeeper', 'climateOn'] },
  ]);
  // 'pet' is OUR name for the row; the action proto calls it Dog.
  expect(s({ climateKeeper: 'off' }), s({ climateKeeper: 'pet' }), [
    { cmd: { type: 'climateKeeper', mode: 'dog' }, keys: ['climateKeeper', 'climateOn'] },
  ]);
  // Switching modes is a SINGLE command. As two booleans this transition emitted
  // both `camp` and `off` in one tick — the off arriving second and cancelling
  // the mode the user just picked.
  expect(s({ climateKeeper: 'pet' }), s({ climateKeeper: 'camp' }), [
    { cmd: { type: 'climateKeeper', mode: 'camp' }, keys: ['climateKeeper', 'climateOn'] },
  ]);
});

test('seat heater: level change emits per position; cool only front', () => {
  const seat = (pos: 'frontLeft' | 'rearRight', mode: 'heat' | 'cool', level: 0 | 1 | 2 | 3) =>
    s({ seatClimateModes: { ...base.seatClimateModes, [pos]: { mode, level } } });
  expect(base, seat('frontLeft', 'heat', 2), [
    { cmd: { type: 'seatHeater', seat: 'FL', level: 2 }, keys: ['seatClimateModes'] },
  ]);
  expect(base, seat('rearRight', 'heat', 1), [
    { cmd: { type: 'seatHeater', seat: 'RR', level: 1 }, keys: ['seatClimateModes'] },
  ]);
  expect(base, seat('frontLeft', 'cool', 3), [
    { cmd: { type: 'seatCooler', seat: 'FL', level: 3 }, keys: ['seatClimateModes'] },
  ]);
});

test('seat off maps to level 0, not the stale level', () => {
  const on = s({ seatClimateModes: { ...base.seatClimateModes, frontLeft: { mode: 'heat', level: 3 } } });
  const off = s({ seatClimateModes: { ...base.seatClimateModes, frontLeft: { mode: 'off', level: 0 } } });
  expect(on, off, [{ cmd: { type: 'seatHeater', seat: 'FL', level: 0 }, keys: ['seatClimateModes'] }]);
});

test('steering wheel heat on/off', () => {
  expect(
    s({ steeringWheelClimate: { mode: 'off', level: 0 } }),
    s({ steeringWheelClimate: { mode: 'heat', level: 1 } }),
    [{ cmd: { type: 'steeringWheelHeat', on: true }, keys: ['steeringWheelClimate'] }],
  );
});

test('multiple independent edits in one tick emit multiple commands', () => {
  const got = diffToCommands(s({ locked: true }), s({ locked: false, targetTempC: 22 }));
  assert.equal(got.length, 2);
});

// ── revertFields — the field-scoped rollback ────────────────────────────────
test('revertFields restores only the named keys, leaving other edits intact', () => {
  const prev = s({ locked: true, targetTempC: 19.5 });
  // The user unlocked AND changed temp in the same tick; the LOCK command fails.
  const optimistic = s({ locked: false, targetTempC: 22 });
  const reverted = revertFields(optimistic, prev, ['locked']);
  assert.equal(reverted.locked, true, 'lock reverts');
  assert.equal(reverted.targetTempC, 22, 'the temp edit survives — it was a different command');
});

test('revertFields returns the SAME object when nothing needs reverting', () => {
  const prev = s({ locked: true });
  const state = s({ locked: true });
  assert.equal(revertFields(state, prev, ['locked'] as VehicleStateKey[]), state);
});

// ── Bugs found on the real car 2026-07-17 (see carlink-test-plan.md) ──────────
test('Defrost: front+rear flipping ON emits defrostOn (was UNMAPPED → only climateOn)', () => {
  const prev: VehicleViewState = { ...base, frontDefrostOn: false, rearDefrostOn: false };
  const next: VehicleViewState = { ...base, frontDefrostOn: true, rearDefrostOn: true };
  const cmds = diffToCommands(prev, next).map((c) => c.cmd.type);
  assert.ok(cmds.includes('defrostOn'), 'must send defrostOn');
});

test('Defrost OFF emits defrostOff', () => {
  const prev: VehicleViewState = { ...base, frontDefrostOn: true, rearDefrostOn: true };
  const next: VehicleViewState = { ...base, frontDefrostOn: false, rearDefrostOn: false };
  assert.deepEqual(
    diffToCommands(prev, next).map((c) => c.cmd),
    [{ type: 'defrostOff' }],
  );
});

test('Cabin overheat TEMP 30/35/40 -> setCopTemp low/medium/high (was UNMAPPED)', () => {
  for (const [temp, level] of [['30', 'low'], ['35', 'medium'], ['40', 'high']] as const) {
    const prev: VehicleViewState = { ...base, cabinOverheatTemp: '35' };
    const next: VehicleViewState = { ...base, cabinOverheatTemp: temp };
    if (temp === '35') continue; // no change
    assert.deepEqual(diffToCommands(prev, next)[0].cmd, { type: 'setCopTemp', level });
  }
});

test('Seat COOL 1 -> off emits seatCooler 0, NOT seatHeater 0 (the reported bug)', () => {
  const prev: VehicleViewState = {
    ...base,
    seatClimateModes: { ...base.seatClimateModes, frontLeft: { mode: 'cool', level: 1 } },
  };
  const next: VehicleViewState = {
    ...base,
    seatClimateModes: { ...base.seatClimateModes, frontLeft: { mode: 'off', level: 0 } },
  };
  assert.deepEqual(diffToCommands(prev, next)[0].cmd, { type: 'seatCooler', seat: 'FL', level: 0 });
});

test('Seat cool 3->2->1 still emits seatCooler at each level', () => {
  const at = (mode: 'cool', level: number): VehicleViewState => ({
    ...base,
    seatClimateModes: { ...base.seatClimateModes, frontLeft: { mode, level: level as 0 | 1 | 2 | 3 } },
  });
  assert.deepEqual(diffToCommands(at('cool', 3), at('cool', 2))[0].cmd, { type: 'seatCooler', seat: 'FL', level: 2 });
  assert.deepEqual(diffToCommands(at('cool', 2), at('cool', 1))[0].cmd, { type: 'seatCooler', seat: 'FL', level: 1 });
});

test('Seat AUTO emits NOTHING over BLE (no command exists — must not send a stray heater level)', () => {
  const prev: VehicleViewState = { ...base, seatClimateModes: { ...base.seatClimateModes, frontLeft: { mode: 'off', level: 0 } } };
  const next: VehicleViewState = { ...base, seatClimateModes: { ...base.seatClimateModes, frontLeft: { mode: 'auto', level: 3 } } };
  assert.equal(diffToCommands(prev, next).length, 0);
});

// ── Security & Drivers: PIN-gated toggles ────────────────────────────────────
// The transitions below mirror exactly what src/app/security.tsx patches.

test('Valet first-enable sets the PIN + turns on; command owns both keys', () => {
  // security.tsx: patch({ valetPin: pin, valetMode: true })
  expect(s({ valetMode: false, valetPin: null }), s({ valetMode: true, valetPin: '1234' }), [
    { cmd: { type: 'valet', on: true, pin: '1234' }, keys: ['valetMode', 'valetPin'] },
  ]);
});

test('Valet off carries NO pin (empty password) and does not clear the stored PIN', () => {
  expect(s({ valetMode: true, valetPin: '1234' }), s({ valetMode: false, valetPin: '1234' }), [
    { cmd: { type: 'valet', on: false }, keys: ['valetMode'] },
  ]);
});

test('Valet Clear PIN (pin → null while off) emits valetClearPin, not an off command', () => {
  expect(s({ valetMode: false, valetPin: '1234' }), s({ valetMode: false, valetPin: null }), [
    { cmd: { type: 'valetClearPin' }, keys: ['valetPin'] },
  ]);
});

test('PIN to Drive off keeps the PIN (empty password); clearing is a separate verb', () => {
  expect(s({ pinToDrive: true, pinToDrivePin: '4321' }), s({ pinToDrive: false, pinToDrivePin: '4321' }), [
    { cmd: { type: 'pinToDrive', on: false }, keys: ['pinToDrive'] },
  ]);
  expect(s({ pinToDrive: false, pinToDrivePin: '4321' }), s({ pinToDrive: false, pinToDrivePin: null }), [
    { cmd: { type: 'pinToDriveClearPin' }, keys: ['pinToDrivePin'] },
  ]);
});

test('Speed Limit: verify-enable (pin already set) does not re-own the pin key', () => {
  // security.tsx verifyEnable path: setFeature(true) only — pin unchanged.
  expect(s({ speedLimitMode: false, speedLimitPin: '1111' }), s({ speedLimitMode: true, speedLimitPin: '1111' }), [
    { cmd: { type: 'speedLimit', action: 'activate', pin: '1111' }, keys: ['speedLimitMode'] },
  ]);
});

test('Speed Limit deactivate carries the PIN; Clear PIN reads the pin being removed', () => {
  expect(s({ speedLimitMode: true, speedLimitPin: '1111' }), s({ speedLimitMode: false, speedLimitPin: '1111' }), [
    { cmd: { type: 'speedLimit', action: 'deactivate', pin: '1111' }, keys: ['speedLimitMode'] },
  ]);
  expect(s({ speedLimitMode: false, speedLimitPin: '1111' }), s({ speedLimitMode: false, speedLimitPin: null }), [
    { cmd: { type: 'speedLimit', action: 'clearPin', pin: '1111' }, keys: ['speedLimitPin'] },
  ]);
});

test('Speed Limit mph setpoint emits a set command (coalesced like the charge sliders)', () => {
  expect(s({ speedLimitMph: 85 }), s({ speedLimitMph: 86 }), [
    { cmd: { type: 'speedLimit', action: 'set', mph: 86 }, keys: ['speedLimitMph'] },
  ]);
});

test('Parental activate/deactivate carry the PIN; sub-settings + mph map to their own actions', () => {
  expect(s({ parentalControls: false, parentalPin: '2468' }), s({ parentalControls: true, parentalPin: '2468' }), [
    { cmd: { type: 'parental', action: 'activate', pin: '2468' }, keys: ['parentalControls'] },
  ]);
  expect(s({ parentalReduceAccel: true }), s({ parentalReduceAccel: false }), [
    { cmd: { type: 'parental', action: 'setSetting', setting: 'acceleration', enable: false }, keys: ['parentalReduceAccel'] },
  ]);
  expect(s({ parentalLimitSpeedMph: 85 }), s({ parentalLimitSpeedMph: 90 }), [
    { cmd: { type: 'parental', action: 'setSpeedLimit', mph: 90 }, keys: ['parentalLimitSpeedMph'] },
  ]);
});

// ── Implied climate-on (@1228092) ────────────────────────────────────────────
//
// Their isClimateOn is DERIVED from the car's state plus in-flight commands, and
// four action types force it true while they settle. We store rather than derive,
// so the equivalent is for those commands to claim `climateOn` as a field they
// own — same visible behaviour, same lifetime, and a failure reverts it.
//
// The asymmetry is the load-bearing part: only `on: true` forces the answer. An
// in-flight "off" falls through to the car, so switching a mode off must NOT
// blink the power row off underneath a climate system running for another reason.
test('enabling implies climate-on; disabling implies nothing', () => {
  const base = initialVehicleState;
  const at = (s: Partial<VehicleViewState>): VehicleViewState => ({ ...base, ...s });

  const on = diffToCommands(at({ bioweaponOn: false }), at({ bioweaponOn: true }));
  assert.deepEqual(on[0]?.keys, ['bioweaponOn', 'climateOn']);

  const off = diffToCommands(at({ bioweaponOn: true }), at({ bioweaponOn: false }));
  assert.deepEqual(off[0]?.keys, ['bioweaponOn'], 'turning OFF must not claim climateOn');

  const camp = diffToCommands(at({ climateKeeper: 'off' }), at({ climateKeeper: 'camp' }));
  assert.deepEqual(camp[0]?.keys, ['climateKeeper', 'climateOn']);

  const keeperOff = diffToCommands(at({ climateKeeper: 'camp' }), at({ climateKeeper: 'off' }));
  assert.deepEqual(keeperOff[0]?.keys, ['climateKeeper'], 'turning OFF must not claim climateOn');
});

// manualOverride is read off the state we transition FROM: "a keeper mode was
// running and the user is displacing it". Pinned false before this, exactly like
// cabin overheat's fanOnly.
test('bioweapon manualOverride tracks the keeper mode it displaces', () => {
  const base = initialVehicleState;
  const at = (s: Partial<VehicleViewState>): VehicleViewState => ({ ...base, ...s });

  const plain = diffToCommands(at({ bioweaponOn: false }), at({ bioweaponOn: true }));
  assert.equal((plain[0]?.cmd as { manualOverride: boolean }).manualOverride, false);

  const over = diffToCommands(
    at({ bioweaponOn: false, climateKeeper: 'pet' }),
    at({ bioweaponOn: true, climateKeeper: 'pet' }),
  );
  assert.equal((over[0]?.cmd as { manualOverride: boolean }).manualOverride, true);
});

// ── A heater command on a cold car turns the climate on FIRST ────────────────
//
// Ivan: "moving temp up/down in Tesla app activates climate if off, verify it.
// Ours doesnt". Verified in their command saga, not inferred from the UI:
// `sendVehicleHeaterCommand` (@1196712) carries the CURRENT climateOn, and
// `sendVehicleHeaterCommandEffect` (@3972856) branches on it —
//
//     if (payload.climateOn) -> the command alone
//     else                   -> VehicleCommand.climateOn(true, …) FIRST
//
// Exactly three controls route through that wrapper: the temperature setter,
// SeatHeaterControlButton and SteeringWheelHeaterControlButton. ORDER matters —
// climate on, then the setting.
test('temp/seat/wheel on a climate-off car emit climateOn FIRST', () => {
  const off: VehicleViewState = { ...initialVehicleState, climateOn: false };

  const temp = diffToCommands(off, setTargetTempState(off, 22));
  assert.deepEqual(
    temp.map((c) => c.cmd.type),
    ['climateOn', 'setClimateTemp'],
    'climateOn must be first — the car has to be on before it accepts a setpoint',
  );

  const seat = diffToCommands(off, stepSeatClimateState(off, 'frontLeft'));
  assert.equal(seat[0]?.cmd.type, 'climateOn');

  const wheel = diffToCommands(off, stepSteeringWheelClimateState(off));
  assert.equal(wheel[0]?.cmd.type, 'climateOn');

  // Already on: no redundant command, matching their `if (payload.climateOn)`.
  const on: VehicleViewState = { ...initialVehicleState, climateOn: true };
  assert.deepEqual(
    diffToCommands(on, setTargetTempState(on, 22)).map((c) => c.cmd.type),
    ['setClimateTemp'],
  );
});

// The mirror rule, and a real regression caught on-car. Keeper and bioweapon set
// climateOn optimistically for DISPLAY (their isClimateOn derives it from the
// in-flight command, @1228092) but send only their own action. Ours emitted a
// second, real climateOn command alongside — visible in the device log as
// `dispatch climateOn` + `dispatch climateKeeper` from a single Camp tap, in two
// different coalescer lanes.
test('keeper/bioweapon imply climate-on WITHOUT emitting a climateOn command', () => {
  const off: VehicleViewState = { ...initialVehicleState, climateOn: false };

  const camp = diffToCommands(off, { ...off, climateKeeper: 'camp', climateOn: true });
  assert.deepEqual(camp.map((c) => c.cmd.type), ['climateKeeper'], 'ONE command, as they send');
  assert.deepEqual(camp[0]?.keys, ['climateKeeper', 'climateOn'], 'but it owns both fields');

  const bio = diffToCommands(off, { ...off, bioweaponOn: true, climateOn: true });
  assert.deepEqual(bio.map((c) => c.cmd.type), ['bioweaponMode']);

  // A climateOn change NOT implied by either is still a real command.
  assert.deepEqual(
    diffToCommands(off, { ...off, climateOn: true }).map((c) => c.cmd.type),
    ['climateOn'],
  );
});
