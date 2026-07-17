// reconcile.test.ts — the pure diffToCommands / revertFields tests.
//
// Runs under plain node. Every case that maps to a real BLE command is pinned
// here because the failure mode is "a wrong command reaches a real car".

import { test } from 'node:test';
import assert from 'node:assert/strict';

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

test('frunk only OPENS — closing it emits nothing (no close command exists)', () => {
  expect(s({ frunkOpen: false }), s({ frunkOpen: true }), [
    { cmd: { type: 'openFrunk' }, keys: ['frunkOpen'] },
  ]);
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
    { cmd: { type: 'bioweaponMode', on: true }, keys: ['bioweaponOn'] },
  ]);
  expect(s({ cabinOverheatMode: 'off' }), s({ cabinOverheatMode: 'on' }), [
    { cmd: { type: 'cabinOverheat', on: true }, keys: ['cabinOverheatMode'] },
  ]);
  expect(s({ cabinOverheatMode: 'on' }), s({ cabinOverheatMode: 'off' }), [
    { cmd: { type: 'cabinOverheat', on: false }, keys: ['cabinOverheatMode'] },
  ]);
  // camp and pet are INDEPENDENT — each its own keeper command.
  expect(s({ campModeOn: false }), s({ campModeOn: true }), [
    { cmd: { type: 'climateKeeper', mode: 'camp' }, keys: ['campModeOn'] },
  ]);
  expect(s({ petModeOn: false }), s({ petModeOn: true }), [
    { cmd: { type: 'climateKeeper', mode: 'dog' }, keys: ['petModeOn'] },
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
