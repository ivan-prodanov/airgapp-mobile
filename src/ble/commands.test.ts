// commands.test.ts — decode-own-output tests for the P1d command builders
// and the CarCommand → buildCommand dispatcher.
//
// Every test builds an action (directly via ./builders, or through
// buildCommand for the CarCommand-shaped path), decodes the SAME bytes back
// with the real protobuf codec, and asserts the field the builder claims to
// set — never a tautological "bytes.length > 0" check.

import { test } from 'node:test';
import assert from 'node:assert/strict';

import { Action, VCSECUnsignedMessage, decodeMessage } from './proto';
import { DOMAIN_INFOTAINMENT, DOMAIN_VEHICLE_SECURITY, FLAG_ENCRYPT_RESPONSE_BIT } from './session';
import { buildCommand, type CarCommand } from './commands';
import {
  RKE_ACTION,
  CLOSURE_MOVE,
  CLIMATE_KEEPER,
  SEAT_COOLER_LEVEL,
  SEAT_COOLER_POS,
  COP_ACTIVATION_TEMP,
  validatePin,
  lockAction,
  unlockAction,
  wakeAction,
  remoteDriveAction,
  openFrunkAction,
  openTrunkAction,
  closeTrunkAction,
  openChargePortAction,
  closeChargePortAction,
  flashLightsAction,
  climateOnAction,
  climateOffAction,
  sentryOnAction,
  sentryOffAction,
  startChargingAction,
  stopChargingAction,
  chargeMaxRangeAction,
  chargeStandardRangeAction,
  setChargeLimitAction,
  setClimateKeeperAction,
  setCabinOverheatAction,
  setBioweaponModeAction,
  setSteeringWheelHeaterAction,
  ventWindowsAction,
  closeWindowsAction,
  setSeatHeaterAction,
  setSeatCoolerAction,
  homelinkAction,
  setValetModeAction,
  activateSpeedLimitAction,
  deactivateSpeedLimitAction,
  clearSpeedLimitPinAction,
  setSpeedLimitMphAction,
  navigateGpsAction,
  navigateGpsWithLabelAction,
  navigateSearchAction,
  navigateWaypointsAction,
  boomboxAction,
  getChargeStateAction,
  getClimateStateAction,
  getDriveStateAction,
  getLocationStateAction,
  getClosuresStateAction,
  getFullVehicleDataAction,
  defrostOnAction,
  defrostOffAction,
  setClimateTempAction,
  setChargingAmpsAction,
  mediaPlayToggleAction,
  mediaNextTrackAction,
  mediaPrevTrackAction,
  mediaVolumeAction,
  setPinToDriveAction,
  resetPinToDriveAction,
  setCopTempAction,
} from './builders';

function decodeAction(bytes: Uint8Array) {
  return decodeMessage(Action, bytes);
}
function decodeVcsec(bytes: Uint8Array) {
  return decodeMessage(VCSECUnsignedMessage, bytes);
}

// --- VCSEC builders ----------------------------------------------------------

test('lockAction / unlockAction / wakeAction — VCSEC RKEAction', () => {
  assert.equal(lockAction().domain, DOMAIN_VEHICLE_SECURITY);
  assert.equal(decodeVcsec(lockAction().bytes).RKEAction, RKE_ACTION.LOCK);
  assert.equal(decodeVcsec(unlockAction().bytes).RKEAction, RKE_ACTION.UNLOCK);
  assert.equal(decodeVcsec(wakeAction().bytes).RKEAction, RKE_ACTION.WAKE_VEHICLE);
});

test('remoteDriveAction — VCSEC RKEAction REMOTE_DRIVE (reference bug fixed: not an Infotainment action)', () => {
  const a = remoteDriveAction();
  assert.equal(a.domain, DOMAIN_VEHICLE_SECURITY);
  assert.equal(decodeVcsec(a.bytes).RKEAction, RKE_ACTION.REMOTE_DRIVE);
  assert.equal(RKE_ACTION.REMOTE_DRIVE, 20);
});

test('closure builders — frunk/trunk/charge port open+close', () => {
  assert.equal(decodeVcsec(openFrunkAction().bytes).closureMoveRequest?.frontTrunk, CLOSURE_MOVE.OPEN);
  assert.equal(decodeVcsec(openTrunkAction().bytes).closureMoveRequest?.rearTrunk, CLOSURE_MOVE.OPEN);
  assert.equal(decodeVcsec(closeTrunkAction().bytes).closureMoveRequest?.rearTrunk, CLOSURE_MOVE.CLOSE);
  assert.equal(decodeVcsec(openChargePortAction().bytes).closureMoveRequest?.chargePort, CLOSURE_MOVE.OPEN);
  assert.equal(decodeVcsec(closeChargePortAction().bytes).closureMoveRequest?.chargePort, CLOSURE_MOVE.CLOSE);
});

// --- Infotainment simple builders --------------------------------------------

test('honk / flashLights / sentry / charging on-off actions', () => {
  assert.equal(decodeAction(flashLightsAction().bytes).vehicleAction?.vehicleControlFlashLightsAction != null, true);
  assert.equal(decodeAction(climateOnAction().bytes).vehicleAction?.hvacAutoAction?.powerOn, true);
  assert.equal(decodeAction(climateOffAction().bytes).vehicleAction?.hvacAutoAction?.powerOn, false);
  assert.equal(decodeAction(sentryOnAction().bytes).vehicleAction?.vehicleControlSetSentryModeAction?.on, true);
  assert.equal(decodeAction(sentryOffAction().bytes).vehicleAction?.vehicleControlSetSentryModeAction?.on, false);
  assert.equal(decodeAction(startChargingAction().bytes).vehicleAction?.chargingStartStopAction?.chargingAction, 'start');
  assert.equal(decodeAction(stopChargingAction().bytes).vehicleAction?.chargingStartStopAction?.chargingAction, 'stop');
  assert.equal(
    decodeAction(chargeMaxRangeAction().bytes).vehicleAction?.chargingStartStopAction?.chargingAction,
    'startMaxRange',
  );
  assert.equal(
    decodeAction(chargeStandardRangeAction().bytes).vehicleAction?.chargingStartStopAction?.chargingAction,
    'startStandard',
  );
});

test('setChargeLimitAction(80) sets chargingSetLimitAction.percent, rejects out-of-range', () => {
  const decoded = decodeAction(setChargeLimitAction(80).bytes);
  assert.equal(decoded.vehicleAction?.chargingSetLimitAction?.percent, 80);
  assert.throws(() => setChargeLimitAction(49), /50\.\.100/);
  assert.throws(() => setChargeLimitAction(101), /50\.\.100/);
});

test('climate keeper / cabin overheat / bioweapon / steering wheel heater', () => {
  const dog = decodeAction(setClimateKeeperAction(CLIMATE_KEEPER.DOG).bytes);
  assert.equal(dog.vehicleAction?.hvacClimateKeeperAction?.ClimateKeeperAction, CLIMATE_KEEPER.DOG);

  const cop = decodeAction(setCabinOverheatAction(true).bytes);
  assert.equal(cop.vehicleAction?.setCabinOverheatProtectionAction?.on, true);
  assert.equal(cop.vehicleAction?.setCabinOverheatProtectionAction?.fanOnly, false);

  // setBioweaponModeAction — the corrected name for the reference's
  // misleadingly-named setKeepAccPowerAction (builds hvacBioweaponModeAction).
  const bio = decodeAction(setBioweaponModeAction(true).bytes);
  assert.equal(bio.vehicleAction?.hvacBioweaponModeAction?.on, true);

  const wheel = decodeAction(setSteeringWheelHeaterAction(true).bytes);
  assert.equal(wheel.vehicleAction?.hvacSteeringWheelHeaterAction?.powerOn, true);
});

test('windows: vent / close', () => {
  assert.equal(decodeAction(ventWindowsAction().bytes).vehicleAction?.vehicleControlWindowAction?.action, 'vent');
  assert.equal(decodeAction(closeWindowsAction().bytes).vehicleAction?.vehicleControlWindowAction?.action, 'close');
});

test("setSeatHeaterAction('FL', HIGH) sets the double-oneof seat+level", () => {
  const decoded = decodeAction(setSeatHeaterAction('CAR_SEAT_FRONT_LEFT', 'SEAT_HEATER_HIGH').bytes);
  const actions = decoded.vehicleAction?.hvacSeatHeaterActions?.hvacSeatHeaterAction;
  assert.equal(actions?.length, 1);
  assert.equal(actions?.[0].seatPosition, 'CAR_SEAT_FRONT_LEFT');
  assert.equal(actions?.[0].seatHeaterLevel, 'SEAT_HEATER_HIGH');
});

test('setSeatCoolerAction(FRONT_LEFT, HIGH) sets numeric seat cooler fields', () => {
  const decoded = decodeAction(setSeatCoolerAction(SEAT_COOLER_POS.FRONT_LEFT, SEAT_COOLER_LEVEL.HIGH).bytes);
  const actions = decoded.vehicleAction?.hvacSeatCoolerActions?.hvacSeatCoolerAction;
  assert.equal(actions?.[0].seatPosition, SEAT_COOLER_POS.FRONT_LEFT);
  assert.equal(actions?.[0].seatCoolerLevel, SEAT_COOLER_LEVEL.HIGH);
});

test('homelinkAction sets location lat/lon; rejects non-finite coords', () => {
  // LatLong.latitude/longitude are proto `float` (32-bit) — tolerance
  // accounts for float32 round-trip precision, not a builder bug.
  const decoded = decodeAction(homelinkAction({ latitude: 37.4, longitude: -122.1 }).bytes);
  assert.ok(Math.abs((decoded.vehicleAction?.vehicleControlTriggerHomelinkAction?.location?.latitude ?? 0) - 37.4) < 1e-4);
  assert.ok(Math.abs((decoded.vehicleAction?.vehicleControlTriggerHomelinkAction?.location?.longitude ?? 0) - -122.1) < 1e-4);
  assert.throws(() => homelinkAction({ latitude: NaN, longitude: -122.1 }), /valid lat\/lon/);
});

test('valet / speed-limit PIN-protected actions validate + encode the PIN', () => {
  const valet = decodeAction(setValetModeAction(true, '1234').bytes);
  assert.equal(valet.vehicleAction?.vehicleControlSetValetModeAction?.on, true);
  assert.equal(valet.vehicleAction?.vehicleControlSetValetModeAction?.password, '1234');

  const activate = decodeAction(activateSpeedLimitAction('4321').bytes);
  assert.equal(activate.vehicleAction?.drivingSpeedLimitAction?.activate, true);
  assert.equal(activate.vehicleAction?.drivingSpeedLimitAction?.pin, '4321');

  const deactivate = decodeAction(deactivateSpeedLimitAction('4321').bytes);
  assert.equal(deactivate.vehicleAction?.drivingSpeedLimitAction?.activate, false);

  const clearPin = decodeAction(clearSpeedLimitPinAction('4321').bytes);
  assert.equal(clearPin.vehicleAction?.drivingClearSpeedLimitPinAction?.pin, '4321');

  const setMph = decodeAction(setSpeedLimitMphAction(65).bytes);
  assert.equal(setMph.vehicleAction?.drivingSetSpeedLimitAction?.limitMph, 65);
  assert.throws(() => setSpeedLimitMphAction(49), /50\.\.90/);
  assert.throws(() => setSpeedLimitMphAction(91), /50\.\.90/);
});

test('PIN validation rejects a non-4-digit pin', () => {
  assert.throws(() => validatePin('123'), /exactly 4 digits/);
  assert.throws(() => validatePin('12345'), /exactly 4 digits/);
  assert.throws(() => validatePin('abcd'), /exactly 4 digits/);
  assert.throws(() => validatePin(''), /exactly 4 digits/);
  assert.equal(validatePin('0420'), '0420');
  assert.throws(() => setValetModeAction(true, '12'), /exactly 4 digits/);
  assert.throws(() => activateSpeedLimitAction('bad!'), /exactly 4 digits/);
});

test('navigation: GPS, GPS+label, search, waypoints (Place-ID string) builders', () => {
  const gps = decodeAction(navigateGpsAction({ lat: 1.5, lon: 2.5 }).bytes);
  assert.equal(gps.vehicleAction?.navigationGpsRequest?.lat, 1.5);
  assert.equal(gps.vehicleAction?.navigationGpsRequest?.lon, 2.5);
  assert.equal(gps.vehicleAction?.navigationGpsRequest?.order, 1); // REPLACE default

  const labeled = decodeAction(navigateGpsWithLabelAction({ lat: 1.5, lon: 2.5, label: 'Home' }).bytes);
  assert.equal(labeled.vehicleAction?.navigationGpsDestinationRequest?.destination, 'Home');

  const search = decodeAction(navigateSearchAction({ query: 'Supercharger' }).bytes);
  assert.equal(search.vehicleAction?.navigationRequest?.destination, 'Supercharger');

  const wp = decodeAction(navigateWaypointsAction('refId:ChIJ1,refId:ChIJ2').bytes);
  assert.equal(wp.vehicleAction?.navigationWaypointsRequest?.waypoints, 'refId:ChIJ1,refId:ChIJ2');
});

test('boomboxAction encodes sound id, rejects out-of-range', () => {
  assert.equal(decodeAction(boomboxAction(9).bytes).vehicleAction?.boomboxAction?.sound, 9);
  assert.throws(() => boomboxAction(-1));
  assert.throws(() => boomboxAction(70000));
});

test('defrost on/off + setClimateTempAction(21) uses driver/passengerTempCelsius (NOT the reference dead "levels" field)', () => {
  assert.equal(decodeAction(defrostOnAction().bytes).vehicleAction?.hvacSetPreconditioningMaxAction?.on, true);
  assert.equal(decodeAction(defrostOffAction().bytes).vehicleAction?.hvacSetPreconditioningMaxAction?.on, false);

  const decoded = decodeAction(setClimateTempAction(21).bytes);
  assert.equal(decoded.vehicleAction?.hvacTemperatureAdjustmentAction?.driverTempCelsius, 21);
  assert.equal(decoded.vehicleAction?.hvacTemperatureAdjustmentAction?.passengerTempCelsius, 21);
  assert.throws(() => setClimateTempAction(14), /15\.\.28/);
  assert.throws(() => setClimateTempAction(29), /15\.\.28/);
});

// --- State reads: flags === FLAG_ENCRYPT_RESPONSE_BIT ------------------------

test('state-read builders set FLAG_ENCRYPT_RESPONSE_BIT and the right GetVehicleData sub-field', () => {
  const charge = getChargeStateAction();
  assert.equal(charge.flags, FLAG_ENCRYPT_RESPONSE_BIT);
  assert.notEqual(decodeAction(charge.bytes).vehicleAction?.getVehicleData?.getChargeState, undefined);

  const climate = getClimateStateAction();
  assert.equal(climate.flags, FLAG_ENCRYPT_RESPONSE_BIT);
  assert.notEqual(decodeAction(climate.bytes).vehicleAction?.getVehicleData?.getClimateState, undefined);

  const drive = getDriveStateAction();
  assert.equal(drive.flags, FLAG_ENCRYPT_RESPONSE_BIT);

  const location = getLocationStateAction();
  assert.equal(location.flags, FLAG_ENCRYPT_RESPONSE_BIT);

  const closures = getClosuresStateAction();
  assert.equal(closures.flags, FLAG_ENCRYPT_RESPONSE_BIT);

  const full = getFullVehicleDataAction();
  assert.equal(full.flags, FLAG_ENCRYPT_RESPONSE_BIT);
  const decodedFull = decodeAction(full.bytes).vehicleAction?.getVehicleData;
  assert.notEqual(decodedFull?.getChargeState, undefined);
  assert.notEqual(decodedFull?.getClimateState, undefined);
  assert.notEqual(decodedFull?.getDriveState, undefined);
  assert.notEqual(decodedFull?.getLocationState, undefined);
  assert.notEqual(decodedFull?.getClosuresState, undefined);
});

// --- New (P1d) builders: setChargingAmps / media / pinToDrive / setCopTemp --

test('setChargingAmpsAction(16) sets chargingAmps', () => {
  const decoded = decodeAction(setChargingAmpsAction(16).bytes);
  assert.equal(decoded.vehicleAction?.setChargingAmpsAction?.chargingAmps, 16);
});

test('media transport builders: toggle/next/prev/volume delta', () => {
  assert.notEqual(decodeAction(mediaPlayToggleAction().bytes).vehicleAction?.mediaPlayAction, undefined);
  assert.notEqual(decodeAction(mediaNextTrackAction().bytes).vehicleAction?.mediaNextTrack, undefined);
  assert.notEqual(decodeAction(mediaPrevTrackAction().bytes).vehicleAction?.mediaPreviousTrack, undefined);
  const vol = decodeAction(mediaVolumeAction(1).bytes);
  assert.equal(vol.vehicleAction?.mediaUpdateVolume?.mediaVolume, 'volumeDelta');
  assert.equal(vol.vehicleAction?.mediaUpdateVolume?.volumeDelta, 1);
  const down = decodeAction(mediaVolumeAction(-1).bytes);
  assert.equal(down.vehicleAction?.mediaUpdateVolume?.volumeDelta, -1);
  assert.throws(() => mediaVolumeAction(0), /non-zero/);
});

test('setPinToDriveAction(true, "1234") / resetPinToDriveAction()', () => {
  const set = decodeAction(setPinToDriveAction(true, '1234').bytes);
  assert.equal(set.vehicleAction?.vehicleControlSetPinToDriveAction?.on, true);
  assert.equal(set.vehicleAction?.vehicleControlSetPinToDriveAction?.password, '1234');
  assert.throws(() => setPinToDriveAction(true, '12'), /exactly 4 digits/);

  const reset = decodeAction(resetPinToDriveAction().bytes);
  assert.notEqual(reset.vehicleAction?.vehicleControlResetPinToDriveAction, undefined);
});

test('setCopTempAction — proto CONFIRMED present (CarServer.SetCopTempAction), despite brief text claiming otherwise', () => {
  const low = decodeAction(setCopTempAction('low').bytes);
  assert.equal(low.vehicleAction?.setCopTempAction?.copActivationTemp, COP_ACTIVATION_TEMP.LOW);
  const med = decodeAction(setCopTempAction('medium').bytes);
  assert.equal(med.vehicleAction?.setCopTempAction?.copActivationTemp, COP_ACTIVATION_TEMP.MEDIUM);
  const high = decodeAction(setCopTempAction('high').bytes);
  assert.equal(high.vehicleAction?.setCopTempAction?.copActivationTemp, COP_ACTIVATION_TEMP.HIGH);
  assert.throws(() => setCopTempAction('extreme' as never), /unknown level/);
});

// --- buildCommand: the CarCommand dispatcher ---------------------------------

test('buildCommand dispatches representative CarCommand variants to the right builder+domain', () => {
  assert.equal(buildCommand({ type: 'lock' }).domain, DOMAIN_VEHICLE_SECURITY);
  assert.equal(decodeVcsec(buildCommand({ type: 'lock' }).bytes).RKEAction, RKE_ACTION.LOCK);
  assert.equal(decodeVcsec(buildCommand({ type: 'unlock' }).bytes).RKEAction, RKE_ACTION.UNLOCK);
  assert.equal(decodeVcsec(buildCommand({ type: 'wake' }).bytes).RKEAction, RKE_ACTION.WAKE_VEHICLE);

  const honk = buildCommand({ type: 'honk' });
  assert.equal(honk.domain, DOMAIN_INFOTAINMENT);
  assert.notEqual(decodeAction(honk.bytes).vehicleAction?.vehicleControlHonkHornAction, undefined);

  const climateOn = buildCommand({ type: 'climateOn' });
  assert.equal(decodeAction(climateOn.bytes).vehicleAction?.hvacAutoAction?.powerOn, true);

  const limit = buildCommand({ type: 'setChargeLimit', percent: 80 });
  assert.equal(decodeAction(limit.bytes).vehicleAction?.chargingSetLimitAction?.percent, 80);

  const temp = buildCommand({ type: 'setClimateTemp', celsius: 21 });
  assert.equal(decodeAction(temp.bytes).vehicleAction?.hvacTemperatureAdjustmentAction?.driverTempCelsius, 21);

  const seat = buildCommand({ type: 'seatHeater', seat: 'FL', level: 3 });
  const seatActions = decodeAction(seat.bytes).vehicleAction?.hvacSeatHeaterActions?.hvacSeatHeaterAction;
  assert.equal(seatActions?.[0].seatPosition, 'CAR_SEAT_FRONT_LEFT');
  assert.equal(seatActions?.[0].seatHeaterLevel, 'SEAT_HEATER_HIGH');

  const nav = buildCommand({ type: 'navigateTo', lat: 37.1, lon: -122.2 });
  assert.equal(decodeAction(nav.bytes).vehicleAction?.navigationGpsRequest != null, true);

  const boombox = buildCommand({ type: 'boombox', sound: 9 });
  assert.equal(decodeAction(boombox.bytes).vehicleAction?.boomboxAction?.sound, 9);

  const amps = buildCommand({ type: 'setChargingAmps', amps: 16 });
  assert.equal(decodeAction(amps.bytes).vehicleAction?.setChargingAmpsAction?.chargingAmps, 16);

  const vol = buildCommand({ type: 'media', action: 'volumeUp' });
  assert.equal(decodeAction(vol.bytes).vehicleAction?.mediaUpdateVolume?.volumeDelta, 1);

  const pin = buildCommand({ type: 'pinToDrive', on: true, pin: '1234' });
  assert.equal(decodeAction(pin.bytes).vehicleAction?.vehicleControlSetPinToDriveAction?.password, '1234');
});

test('buildCommand: state-read-shaped variants are not in the CarCommand union — verify flags via direct builder + dispatcher-adjacent seatCooler/steeringWheelHeat/cabinOverheat/setCopTemp/climateKeeper/valet/speedLimit/remoteStart/media/pinToDrive-reset', () => {
  const cooler = buildCommand({ type: 'seatCooler', seat: 'FR', level: 3 });
  const coolerActions = decodeAction(cooler.bytes).vehicleAction?.hvacSeatCoolerActions?.hvacSeatCoolerAction;
  assert.equal(coolerActions?.[0].seatPosition, SEAT_COOLER_POS.FRONT_RIGHT);
  assert.equal(coolerActions?.[0].seatCoolerLevel, SEAT_COOLER_LEVEL.HIGH);

  const wheel = buildCommand({ type: 'steeringWheelHeat', on: true });
  assert.equal(decodeAction(wheel.bytes).vehicleAction?.hvacSteeringWheelHeaterAction?.powerOn, true);

  const cop = buildCommand({ type: 'cabinOverheat', on: true });
  assert.equal(decodeAction(cop.bytes).vehicleAction?.setCabinOverheatProtectionAction?.on, true);

  const copTemp = buildCommand({ type: 'setCopTemp', level: 'high' });
  assert.equal(decodeAction(copTemp.bytes).vehicleAction?.setCopTempAction?.copActivationTemp, COP_ACTIVATION_TEMP.HIGH);

  const keeper = buildCommand({ type: 'climateKeeper', mode: 'dog' });
  assert.equal(decodeAction(keeper.bytes).vehicleAction?.hvacClimateKeeperAction?.ClimateKeeperAction, CLIMATE_KEEPER.DOG);

  const valet = buildCommand({ type: 'valet', on: true, pin: '1234' });
  assert.equal(decodeAction(valet.bytes).vehicleAction?.vehicleControlSetValetModeAction?.password, '1234');
  assert.throws(() => buildCommand({ type: 'valet', on: true }), /pin required/);

  const sl = buildCommand({ type: 'speedLimit', action: 'set', mph: 65 });
  assert.equal(decodeAction(sl.bytes).vehicleAction?.drivingSetSpeedLimitAction?.limitMph, 65);
  assert.throws(() => buildCommand({ type: 'speedLimit', action: 'activate' }), /pin required/);

  const remoteStart = buildCommand({ type: 'remoteStart' });
  assert.equal(remoteStart.domain, DOMAIN_VEHICLE_SECURITY);
  assert.equal(decodeVcsec(remoteStart.bytes).RKEAction, RKE_ACTION.REMOTE_DRIVE);

  const bio = buildCommand({ type: 'bioweaponMode', on: true });
  assert.equal(decodeAction(bio.bytes).vehicleAction?.hvacBioweaponModeAction?.on, true);

  const pinReset = buildCommand({ type: 'pinToDrive', on: false });
  assert.notEqual(decodeAction(pinReset.bytes).vehicleAction?.vehicleControlResetPinToDriveAction, undefined);
  // Enabling still requires a PIN; the message now comes from the shared requirePin() helper.
  assert.throws(() => buildCommand({ type: 'pinToDrive', on: true }), /pin required/);

  const media = buildCommand({ type: 'media', action: 'next' });
  assert.notEqual(decodeAction(media.bytes).vehicleAction?.mediaNextTrack, undefined);
});

test('buildCommand throws "unsupported over BLE" for navigateWaypoints (no lat/lon proto shape exists)', () => {
  const cmd: CarCommand = {
    type: 'navigateWaypoints',
    coords: [
      { lat: 1, lon: 2 },
      { lat: 3, lon: 4 },
    ],
    order: 'REPLACE',
  };
  assert.throws(() => buildCommand(cmd), /unsupported over BLE: navigateWaypoints/);
});

test('buildCommand throws for an unrecognized cmd.type', () => {
  assert.throws(
    () => buildCommand({ type: 'summon' } as unknown as CarCommand),
    /unsupported over BLE: summon/,
  );
});
