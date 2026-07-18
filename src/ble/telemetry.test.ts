import { test } from 'node:test';
import assert from 'node:assert/strict';

import {
  CLOSURE_INTENT_GRACE_MS,
  infotainmentToPatch,
  parseCarServerResponse,
  parseVcsecStatus,
  vcsecStatusToPatch,
} from './telemetry';

// ── parseVcsecStatus ──────────────────────────────────────────────────────

test('parseVcsecStatus maps lock/sleep/presence enum ints to the right names', () => {
  const status = parseVcsecStatus({
    vehicleLockState: 1, // VEHICLELOCKSTATE_LOCKED
    vehicleSleepStatus: 1, // VEHICLE_SLEEP_STATUS_AWAKE
    userPresence: 2, // VEHICLE_USER_PRESENCE_PRESENT
  });
  assert.equal(status.lockState, 'locked');
  assert.equal(status.sleepStatus, 'awake');
  assert.equal(status.userPresence, 'present');
});

test('parseVcsecStatus maps all four lock states', () => {
  assert.equal(parseVcsecStatus({ vehicleLockState: 0 }).lockState, 'unlocked');
  assert.equal(parseVcsecStatus({ vehicleLockState: 1 }).lockState, 'locked');
  assert.equal(parseVcsecStatus({ vehicleLockState: 2 }).lockState, 'internal_locked');
  assert.equal(parseVcsecStatus({ vehicleLockState: 3 }).lockState, 'selective_unlocked');
});

test('parseVcsecStatus maps closureStatuses to the closures map', () => {
  const status = parseVcsecStatus({
    vehicleLockState: 1,
    closureStatuses: {
      frontDriverDoor: 1, // OPEN
      frontPassengerDoor: 0, // CLOSED
      rearDriverDoor: 2, // AJAR
      rearPassengerDoor: 5, // OPENING
      rearTrunk: 6, // CLOSING
      frontTrunk: 3, // UNKNOWN
      chargePort: 0, // CLOSED
      tonneau: 1, // OPEN
    },
  });
  assert.deepEqual(status.closures, {
    frontDriverDoor: 'open',
    frontPassengerDoor: 'closed',
    rearDriverDoor: 'ajar',
    rearPassengerDoor: 'opening',
    rearTrunk: 'closing',
    frontTrunk: 'unknown',
    chargePort: 'closed',
    tonneau: 'open',
  });
});

test('parseVcsecStatus: missing closureStatuses -> empty closures object', () => {
  const status = parseVcsecStatus({ vehicleLockState: 1 });
  assert.deepEqual(status.closures, {});
});

test('parseVcsecStatus: unknown/out-of-range enum ints normalize to "unknown"', () => {
  const status = parseVcsecStatus({
    vehicleLockState: 99,
    vehicleSleepStatus: 99,
    userPresence: 99,
    closureStatuses: { frontDriverDoor: 42 },
  });
  assert.equal(status.lockState, 'unknown');
  assert.equal(status.sleepStatus, 'unknown');
  assert.equal(status.userPresence, 'unknown');
  assert.equal(status.closures.frontDriverDoor, 'unknown');
});

test('parseVcsecStatus: FAILED_UNLATCH (4) normalizes to "unknown" (not part of the closure union)', () => {
  const status = parseVcsecStatus({ closureStatuses: { frontTrunk: 4 } });
  assert.equal(status.closures.frontTrunk, 'unknown');
});

test('parseVcsecStatus: totally empty/garbage input is tolerated', () => {
  const status = parseVcsecStatus({});
  assert.equal(status.lockState, 'unknown');
  assert.equal(status.sleepStatus, 'unknown');
  assert.equal(status.userPresence, 'unknown');
  assert.deepEqual(status.closures, {});
});

// ── vcsecStatusToPatch ────────────────────────────────────────────────────

test('vcsecStatusToPatch: LOCKED -> {locked:true}; UNLOCKED -> {locked:false}; unknown -> omitted', () => {
  const now = 1_000_000;
  const locked = vcsecStatusToPatch(parseVcsecStatus({ vehicleLockState: 1 }), {}, now);
  assert.equal(locked.patch.locked, true);

  const unlocked = vcsecStatusToPatch(parseVcsecStatus({ vehicleLockState: 0 }), {}, now);
  assert.equal(unlocked.patch.locked, false);

  const internal = vcsecStatusToPatch(parseVcsecStatus({ vehicleLockState: 2 }), {}, now);
  assert.equal(internal.patch.locked, true);

  const selective = vcsecStatusToPatch(parseVcsecStatus({ vehicleLockState: 3 }), {}, now);
  assert.equal(selective.patch.locked, false);

  const unknown = vcsecStatusToPatch(parseVcsecStatus({ vehicleLockState: 99 }), {}, now);
  assert.equal('locked' in unknown.patch, false);
});

test('vcsecStatusToPatch: sleepStatus AWAKE/ASLEEP/unknown', () => {
  const now = 1_000_000;
  assert.equal(vcsecStatusToPatch(parseVcsecStatus({ vehicleSleepStatus: 1 }), {}, now).patch.awake, true);
  assert.equal(vcsecStatusToPatch(parseVcsecStatus({ vehicleSleepStatus: 2 }), {}, now).patch.awake, false);
  assert.equal(
    'awake' in vcsecStatusToPatch(parseVcsecStatus({ vehicleSleepStatus: 0 }), {}, now).patch,
    false,
  );
});

test('vcsecStatusToPatch: door OPEN -> true, CLOSED -> false, UNKNOWN -> absent', () => {
  const now = 1_000_000;
  const status = parseVcsecStatus({
    closureStatuses: {
      frontDriverDoor: 1, // OPEN
      frontPassengerDoor: 0, // CLOSED
      rearDriverDoor: 3, // UNKNOWN
    },
  });
  const { patch } = vcsecStatusToPatch(status, {}, now);
  assert.equal(patch.driverFrontDoorOpen, true);
  assert.equal(patch.passengerFrontDoorOpen, false);
  assert.equal('driverRearDoorOpen' in patch, false);
});

test('vcsecStatusToPatch: full closure field mapping (frunk/trunk/chargePort/rear doors)', () => {
  const now = 1_000_000;
  const status = parseVcsecStatus({
    closureStatuses: {
      frontDriverDoor: 1,
      frontPassengerDoor: 1,
      rearDriverDoor: 1,
      rearPassengerDoor: 1,
      rearTrunk: 1,
      frontTrunk: 1,
      chargePort: 1,
      tonneau: 1,
    },
  });
  const { patch } = vcsecStatusToPatch(status, {}, now);
  assert.equal(patch.driverFrontDoorOpen, true);
  assert.equal(patch.passengerFrontDoorOpen, true);
  assert.equal(patch.driverRearDoorOpen, true);
  assert.equal(patch.passengerRearDoorOpen, true);
  assert.equal(patch.trunkOpen, true);
  assert.equal(patch.frunkOpen, true);
  assert.equal(patch.chargePortOpen, true);
  // tonneau has no VehicleViewState field
  assert.equal('tonneau' in patch, false);
});

test('vcsecStatusToPatch: AJAR/OPENING -> true, CLOSING -> false', () => {
  const now = 1_000_000;
  const status = parseVcsecStatus({
    closureStatuses: {
      frontDriverDoor: 2, // AJAR
      frontPassengerDoor: 5, // OPENING
      rearDriverDoor: 6, // CLOSING
    },
  });
  const { patch } = vcsecStatusToPatch(status, {}, now);
  assert.equal(patch.driverFrontDoorOpen, true);
  assert.equal(patch.passengerFrontDoorOpen, true);
  assert.equal(patch.driverRearDoorOpen, false);
});

test('vcsecStatusToPatch: closure-intent grace — still-valid intent omits the field and carries it forward', () => {
  const now = 1_000_000;
  const status = parseVcsecStatus({ closureStatuses: { rearTrunk: 0 } }); // VCSEC says CLOSED
  const intent = { rearTrunk: now + 5000 }; // we optimistically opened it 25s ago, grace not expired
  const { patch, closureIntent } = vcsecStatusToPatch(status, intent, now);
  assert.equal('trunkOpen' in patch, false); // field omitted -- UI keeps its optimistic value
  assert.equal(closureIntent.rearTrunk, now + 5000); // intent carried forward unchanged
});

test('vcsecStatusToPatch: closure-intent grace — expired intent emits the field and drops the intent', () => {
  const now = 1_000_000;
  const status = parseVcsecStatus({ closureStatuses: { rearTrunk: 0 } }); // VCSEC says CLOSED
  const intent = { rearTrunk: now - 1 }; // expired
  const { patch, closureIntent } = vcsecStatusToPatch(status, intent, now);
  assert.equal(patch.trunkOpen, false); // VCSEC value wins now
  assert.equal('rearTrunk' in closureIntent, false); // intent dropped
});

test('vcsecStatusToPatch: intent for one field does not block other fields', () => {
  const now = 1_000_000;
  const status = parseVcsecStatus({
    closureStatuses: { rearTrunk: 0, frontTrunk: 1 },
  });
  const intent = { rearTrunk: now + 5000 };
  const { patch, closureIntent } = vcsecStatusToPatch(status, intent, now);
  assert.equal('trunkOpen' in patch, false);
  assert.equal(patch.frunkOpen, true);
  assert.equal(closureIntent.rearTrunk, now + 5000);
  assert.equal('frontTrunk' in closureIntent, false);
});

test('vcsecStatusToPatch: userPresence maps to no VehicleViewState field', () => {
  const now = 1_000_000;
  const status = parseVcsecStatus({ userPresence: 2 });
  const { patch } = vcsecStatusToPatch(status, {}, now);
  // No key on VehicleViewState corresponds to presence; patch should have no stray key for it.
  assert.equal(Object.keys(patch).length, 0);
});

test(CLOSURE_INTENT_GRACE_MS + 'ms is the documented closure-intent grace window', () => {
  assert.equal(CLOSURE_INTENT_GRACE_MS, 30_000);
});

// ── parseCarServerResponse + infotainmentToPatch ─────────────────────────

test('charge: soc -> batteryLevel, batteryRange kept RAW in miles (no conversion at ingest)', () => {
  const snap = parseCarServerResponse({
    vehicleData: {
      chargeState: { batteryLevel: 72, batteryRange: 100, chargingState: { Charging: {} }, chargeLimitSoc: 90 },
    },
  });
  assert.equal(snap.charge?.soc, 72);
  // Round 5 §2a: `battery_range` IS miles and the official app converts at
  // display time. Converting+rounding here would compound error on a mi display.
  assert.equal(snap.charge?.rangeMiles, 100);
  assert.equal(snap.charge?.chargingState, 'Charging');
  assert.equal(snap.charge?.chargeLimitSoc, 90);

  const patch = infotainmentToPatch(snap);
  assert.equal(patch.batteryLevel, 72);
  assert.equal(patch.charging, true);
});

test('charge: chargingState {Disconnected:{}} -> charging:false', () => {
  const snap = parseCarServerResponse({
    chargeState: { batteryLevel: 50, chargingState: { Disconnected: {} } },
  });
  const patch = infotainmentToPatch(snap);
  assert.equal(patch.charging, false);
});

test('climate: temps + isOn map through', () => {
  const snap = parseCarServerResponse({
    climateState: { insideTempCelsius: 22.5, outsideTempCelsius: 15, driverTempSetting: 21, isClimateOn: true },
  });
  assert.equal(snap.climate?.insideTempC, 22.5);
  assert.equal(snap.climate?.outsideTempC, 15);
  assert.equal(snap.climate?.targetTempC, 21);
  assert.equal(snap.climate?.isOn, true);

  const patch = infotainmentToPatch(snap);
  assert.equal(patch.interiorTempC, 22.5);
  assert.equal(patch.exteriorTempC, 15);
  assert.equal(patch.climateOn, true);
});

test('drive: gear {D:{}} -> driving:true; {P:{}} -> driving:false; {R:{}}/{N:{}} -> driving:true', () => {
  assert.equal(
    infotainmentToPatch(parseCarServerResponse({ driveState: { shiftState: { D: {} } } })).driving,
    true,
  );
  assert.equal(
    infotainmentToPatch(parseCarServerResponse({ driveState: { shiftState: { P: {} } } })).driving,
    false,
  );
  assert.equal(
    infotainmentToPatch(parseCarServerResponse({ driveState: { shiftState: { R: {} } } })).driving,
    true,
  );
  assert.equal(
    infotainmentToPatch(parseCarServerResponse({ driveState: { shiftState: { N: {} } } })).driving,
    true,
  );
});

test('drive: absent shiftState -> driving:false', () => {
  const snap = parseCarServerResponse({ driveState: {} });
  assert.equal(infotainmentToPatch(snap).driving, false);
});

test('sentry: Armed -> sentryEnabled:true; Off -> sentryEnabled:false', () => {
  const armed = parseCarServerResponse({ closuresState: { sentryModeState: { Armed: {} } } });
  assert.equal(infotainmentToPatch(armed).sentryEnabled, true);

  const off = parseCarServerResponse({ closuresState: { sentryModeState: { Off: {} } } });
  assert.equal(infotainmentToPatch(off).sentryEnabled, false);
});

test('windows: only emitted when the snapshot actually carries them', () => {
  const snap = parseCarServerResponse({
    closuresState: {
      windowOpenDriverFront: true,
      windowOpenPassengerFront: false,
      // rear windows omitted entirely
    },
  });
  const patch = infotainmentToPatch(snap);
  assert.equal(patch.leftFrontWindowOpen, true);
  assert.equal(patch.rightFrontWindowOpen, false);
  assert.equal('leftRearWindowOpen' in patch, false);
  assert.equal('rightRearWindowOpen' in patch, false);
});

test('missing slices are simply absent from the patch (partial patch)', () => {
  const snap = parseCarServerResponse({ climateState: { insideTempCelsius: 20 } });
  const patch = infotainmentToPatch(snap);
  assert.equal('batteryLevel' in patch, false);
  assert.equal('charging' in patch, false);
  assert.equal('driving' in patch, false);
  assert.equal('sentryEnabled' in patch, false);
  assert.equal(patch.interiorTempC, 20);
});

test('parseCarServerResponse: totally empty response -> empty snapshot, empty patch', () => {
  const snap = parseCarServerResponse({});
  assert.deepEqual(snap, {});
  assert.deepEqual(infotainmentToPatch(snap), {});
});

test('parseCarServerResponse: top-level chargeState (no vehicleData wrapper) is also accepted', () => {
  const snap = parseCarServerResponse({ chargeState: { batteryLevel: 40 } });
  assert.equal(snap.charge?.soc, 40);
});

test('parseCarServerResponse: batteryRange absent -> rangeMiles null', () => {
  const snap = parseCarServerResponse({ chargeState: { batteryLevel: 40 } });
  assert.equal(snap.charge?.rangeMiles, null);
});

// ── oneof robustness: handles both {CaseName:{}} objects and plain strings ─

test('oneof normalization: chargingState as plain string "Charging" works the same as {Charging:{}}', () => {
  const snap = parseCarServerResponse({ chargeState: { batteryLevel: 10, chargingState: 'Charging' } });
  assert.equal(snap.charge?.chargingState, 'Charging');
  assert.equal(infotainmentToPatch(snap).charging, true);
});

test('oneof normalization: shiftState as plain string "D" works the same as {D:{}}', () => {
  const snap = parseCarServerResponse({ driveState: { shiftState: 'D' } });
  assert.equal(snap.drive?.gear, 'D');
  assert.equal(infotainmentToPatch(snap).driving, true);
});

test('oneof normalization: sentryModeState as plain string "Armed"', () => {
  const snap = parseCarServerResponse({ closuresState: { sentryModeState: 'Armed' } });
  assert.equal(infotainmentToPatch(snap).sentryEnabled, true);
});

// ── proto3 explicit-optional: slice present, sub-field absent -> omitted, not fabricated ──

test('charge: slice present with ONLY chargingState set -> charging emitted, batteryLevel omitted', () => {
  const snap = parseCarServerResponse({ chargeState: { chargingState: { Charging: {} } } });
  assert.equal(snap.charge?.soc, undefined);
  const patch = infotainmentToPatch(snap);
  assert.equal(patch.charging, true);
  assert.ok(!('batteryLevel' in patch));
});

test('climate: slice present with ONLY isClimateOn:true set -> climateOn emitted, temps omitted', () => {
  const snap = parseCarServerResponse({ climateState: { isClimateOn: true } });
  assert.equal(snap.climate?.insideTempC, undefined);
  assert.equal(snap.climate?.outsideTempC, undefined);
  const patch = infotainmentToPatch(snap);
  assert.equal(patch.climateOn, true);
  assert.ok(!('interiorTempC' in patch));
  assert.ok(!('exteriorTempC' in patch));
});

test('closures: window bool present but sentryModeState absent -> window emitted, sentryEnabled omitted', () => {
  const snap = parseCarServerResponse({ closuresState: { windowOpenDriverFront: true } });
  assert.equal(snap.closures?.sentryOn, undefined);
  const patch = infotainmentToPatch(snap);
  assert.equal(patch.leftFrontWindowOpen, true);
  assert.ok(!('sentryEnabled' in patch));
});

test('present-and-zero is still emitted: batteryLevel:0 is a real value, not treated as absent', () => {
  const snap = parseCarServerResponse({ chargeState: { batteryLevel: 0, chargingState: { Disconnected: {} } } });
  assert.equal(snap.charge?.soc, 0);
  const patch = infotainmentToPatch(snap);
  assert.ok('batteryLevel' in patch);
  assert.equal(patch.batteryLevel, 0);
});

test('present-and-zero is still emitted: interiorTempC/exteriorTempC of 0C are real values', () => {
  const snap = parseCarServerResponse({
    climateState: { insideTempCelsius: 0, outsideTempCelsius: 0, isClimateOn: false },
  });
  const patch = infotainmentToPatch(snap);
  assert.ok('interiorTempC' in patch);
  assert.ok('exteriorTempC' in patch);
  assert.equal(patch.interiorTempC, 0);
  assert.equal(patch.exteriorTempC, 0);
});

// ── vcsecStatusToPatch: closure-intent survives for keys outside the 7-key view map ──

test('vcsecStatusToPatch: still-valid intent for a key with no VehicleViewState field (e.g. tonneau) survives', () => {
  const now = 1_000_000;
  const status = parseVcsecStatus({});
  const intent = { tonneau: now + 5000 };
  const { closureIntent } = vcsecStatusToPatch(status, intent, now);
  assert.equal(closureIntent.tonneau, now + 5000);
});

test('vcsecStatusToPatch: expired intent for a key with no VehicleViewState field is dropped', () => {
  const now = 1_000_000;
  const status = parseVcsecStatus({});
  const intent = { tonneau: now - 1 };
  const { closureIntent } = vcsecStatusToPatch(status, intent, now);
  assert.equal('tonneau' in closureIntent, false);
});

// ── Expanded ClimateState read (2026-07-18) — the parser was a 6-field stub ───
test('climate: the full state reads back through infotainmentToPatch', () => {
  const snap = parseCarServerResponse({
    vehicleData: {
      climateState: {
        driverTempSetting: 21.5,
        isClimateOn: true,
        isFrontDefrosterOn: true,
        isRearDefrosterOn: false,
        cabinOverheatProtection: 2, // FanOnly -> noac
        copActivationTemperature: 3, // High -> 40
        climateKeeperMode: { Party: {} }, // Camp
        seatHeaterLeft: 2, // FL heat 2
        seatFanFrontRight: 1, // FR cool 1
        autoSteeringWheelHeat: true,
      },
    },
  });
  const p = infotainmentToPatch(snap);
  assert.equal(p.targetTempC, 21.5, 'targetTempC now APPLIED (was parsed-but-dropped)');
  assert.equal(p.frontDefrostOn, true);
  assert.equal(p.rearDefrostOn, false);
  assert.equal(p.cabinOverheatMode, 'noac');
  assert.equal(p.cabinOverheatTemp, '40');
  assert.equal(p.campModeOn, true);
  assert.equal(p.petModeOn, false);
  assert.deepEqual(p.steeringWheelClimate, { mode: 'auto', level: 0 });
  assert.deepEqual(p.seatClimateModes?.frontLeft, { mode: 'heat', level: 2 });
  assert.deepEqual(p.seatClimateModes?.frontRight, { mode: 'cool', level: 1 });
  // A seat the car didn't mention keeps its default (merge, not clobber).
  assert.deepEqual(p.seatClimateModes?.rearMiddle, { mode: 'off', level: 0 });
});

test('climate: absent optional fields are OMITTED from the patch (proto3-optional rule)', () => {
  const snap = parseCarServerResponse({ vehicleData: { climateState: { isClimateOn: false } } });
  const p = infotainmentToPatch(snap);
  assert.equal(p.climateOn, false);
  assert.equal('targetTempC' in p, false);
  assert.equal('cabinOverheatMode' in p, false);
  assert.equal('campModeOn' in p, false);
  assert.equal('seatClimateModes' in p, false, 'no seat field reported -> do not touch the map');
  assert.equal('steeringWheelClimate' in p, false);
});
