// commands.ts — the CarCommand discriminated union + buildCommand dispatcher.
//
// This is the P3/P4 entry point: given a CarCommand, buildCommand() returns
// the wire-ready { domain, bytes, flags? } that session.ts's sendCommand()
// AES-GCM-encrypts and ships. CarCommand's shape is copied verbatim from
// docs/superpowers/plans/2026-07-12-ble-backend-integration.md Part 4 (the
// binding interface contract) — do not diverge without architect sign-off.
//
// Every buildable variant maps to a builder in ./builders (or the two
// already ported in ./session: honk, vcsecGetStatus — not command-mapped
// here but re-exported for completeness). Variants with no matching proto
// message throw a clear "unsupported over BLE: <type>" error so the caller
// (Phase 3/4) surfaces it and Phase 4 hides the corresponding UI control for
// live cars. See the P1d report for the full mapping table.

import { honkAction, type ActionPayload } from './session';
import type { Domain } from './types';
import {
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
  setChargeLimitAction,
  setClimateKeeperAction,
  CLIMATE_KEEPER,
  setCabinOverheatAction,
  setBioweaponModeAction,
  setSteeringWheelHeaterAction,
  ventWindowsAction,
  closeWindowsAction,
  setSeatHeaterAction,
  SEAT_POS_HEATER,
  SEAT_HEATER_LEVEL,
  setSeatCoolerAction,
  SEAT_COOLER_POS,
  SEAT_COOLER_LEVEL,
  homelinkAction,
  setValetModeAction,
  activateSpeedLimitAction,
  deactivateSpeedLimitAction,
  clearSpeedLimitPinAction,
  setSpeedLimitMphAction,
  navigateGpsAction,
  navigateGpsWithLabelAction,
  boomboxAction,
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
  resetValetPinAction,
  setParentalControlsAction,
  clearParentalControlsPinAction,
  setParentalSpeedLimitAction,
  setParentalSettingAction,
  type ParentalSetting,
  setCopTempAction,
  navigateWaypointsAction,
  NAV_ORDER,
} from './builders';

// --- The CarCommand union (verbatim from the plan's Part 4) ----------------

export type CarCommand =
  | { type: 'lock' }
  | { type: 'unlock' }
  | { type: 'wake' }
  | { type: 'openFrunk' }
  | { type: 'openTrunk' }
  | { type: 'closeTrunk' }
  | { type: 'openChargePort' }
  | { type: 'closeChargePort' }
  | { type: 'chargeStart' }
  | { type: 'chargeStop' }
  | { type: 'setChargeLimit'; percent: number }
  | { type: 'setChargingAmps'; amps: number }
  | { type: 'climateOn' }
  | { type: 'climateOff' }
  | { type: 'setClimateTemp'; celsius: number }
  | { type: 'defrostOn' }
  | { type: 'defrostOff' }
  | { type: 'climateKeeper'; mode: 'off' | 'on' | 'dog' | 'camp' }
  | { type: 'cabinOverheat'; on: boolean; fanOnly: boolean }
  | { type: 'setCopTemp'; level: 'low' | 'medium' | 'high' }
  | { type: 'seatHeater'; seat: 'FL' | 'FR' | 'RL' | 'RC' | 'RR'; level: 0 | 1 | 2 | 3 }
  | { type: 'seatCooler'; seat: 'FL' | 'FR'; level: 0 | 1 | 2 | 3 }
  | { type: 'steeringWheelHeat'; on: boolean }
  | { type: 'ventWindows' }
  | { type: 'closeWindows' }
  | { type: 'honk' }
  | { type: 'flashLights' }
  | { type: 'remoteStart' }
  | { type: 'sentry'; on: boolean }
  | { type: 'valet'; on: boolean; pin?: string }
  // "Clear PIN" row actions — distinct from turning the feature off. Valet and PIN to Drive clear via a
  // confirm alert with no PIN entry; Parental and Speed Limit clear by verifying the PIN (speedLimit
  // .clearPin above), and both require the feature to be off first.
  | { type: 'valetClearPin' }
  | { type: 'pinToDriveClearPin' }
  | {
      type: 'parental';
      action: 'activate' | 'deactivate' | 'clearPin' | 'setSpeedLimit' | 'setSetting';
      pin?: string;
      mph?: number;
      setting?: ParentalSetting;
      enable?: boolean;
    }
  | { type: 'speedLimit'; action: 'activate' | 'deactivate' | 'set' | 'clearPin'; mph?: number; pin?: string }
  | { type: 'homelink'; lat: number; lon: number }
  | { type: 'boombox'; sound: number }
  | { type: 'bioweaponMode'; on: boolean; manualOverride: boolean }
  | { type: 'pinToDrive'; on: boolean; pin?: string }
  | { type: 'navigateTo'; lat: number; lon: number; label?: string; order?: 'REPLACE' | 'PREPEND' | 'APPEND' }
  | { type: 'navigateWaypoints'; coords: { lat: number; lon: number }[]; order: 'REPLACE' | 'PREPEND' | 'APPEND' }
  | { type: 'media'; action: 'toggle' | 'next' | 'prev' | 'volumeUp' | 'volumeDown' };

export interface BuiltCommand {
  domain: Domain;
  bytes: Uint8Array;
  flags?: number;
}

function fromPayload(p: ActionPayload): BuiltCommand {
  return p.flags != null ? { domain: p.domain, bytes: p.bytes, flags: p.flags } : { domain: p.domain, bytes: p.bytes };
}

const SEAT_HEATER_SEAT: Record<'FL' | 'FR' | 'RL' | 'RC' | 'RR', string> = {
  FL: SEAT_POS_HEATER.FRONT_LEFT,
  FR: SEAT_POS_HEATER.FRONT_RIGHT,
  RL: SEAT_POS_HEATER.REAR_LEFT,
  RC: SEAT_POS_HEATER.REAR_CENTER,
  RR: SEAT_POS_HEATER.REAR_RIGHT,
};
const SEAT_HEATER_LVL: Record<0 | 1 | 2 | 3, string> = {
  0: SEAT_HEATER_LEVEL.OFF,
  1: SEAT_HEATER_LEVEL.LOW,
  2: SEAT_HEATER_LEVEL.MED,
  3: SEAT_HEATER_LEVEL.HIGH,
};
const SEAT_COOLER_SEAT: Record<'FL' | 'FR', number> = {
  FL: SEAT_COOLER_POS.FRONT_LEFT,
  FR: SEAT_COOLER_POS.FRONT_RIGHT,
};
const SEAT_COOLER_LVL: Record<0 | 1 | 2 | 3, number> = {
  0: SEAT_COOLER_LEVEL.OFF,
  1: SEAT_COOLER_LEVEL.LOW,
  2: SEAT_COOLER_LEVEL.MED,
  3: SEAT_COOLER_LEVEL.HIGH,
};
const CLIMATE_KEEPER_MODE: Record<'off' | 'on' | 'dog' | 'camp', number> = {
  off: CLIMATE_KEEPER.OFF,
  on: CLIMATE_KEEPER.ON,
  dog: CLIMATE_KEEPER.DOG,
  camp: CLIMATE_KEEPER.CAMP,
};

// buildCommand switches on cmd.type and calls the matching builder. Variants
// with no available proto throw — see the module doc comment and the P1d
// report. (navigateWaypoints by COORDINATE is the standing example: the car only
// accepts refId:/superchargerId: tokens — see builders.navigateWaypointsAction.)
export function buildCommand(cmd: CarCommand): BuiltCommand {
  switch (cmd.type) {
    case 'lock':
      return fromPayload(lockAction());
    case 'unlock':
      return fromPayload(unlockAction());
    case 'wake':
      return fromPayload(wakeAction());
    case 'openFrunk':
      return fromPayload(openFrunkAction());
    case 'openTrunk':
      return fromPayload(openTrunkAction());
    case 'closeTrunk':
      return fromPayload(closeTrunkAction());
    case 'openChargePort':
      return fromPayload(openChargePortAction());
    case 'closeChargePort':
      return fromPayload(closeChargePortAction());
    case 'chargeStart':
      return fromPayload(startChargingAction());
    case 'chargeStop':
      return fromPayload(stopChargingAction());
    case 'setChargeLimit':
      return fromPayload(setChargeLimitAction(cmd.percent));
    case 'setChargingAmps':
      return fromPayload(setChargingAmpsAction(cmd.amps));
    case 'climateOn':
      return fromPayload(climateOnAction());
    case 'climateOff':
      return fromPayload(climateOffAction());
    case 'setClimateTemp':
      return fromPayload(setClimateTempAction(cmd.celsius));
    case 'defrostOn':
      return fromPayload(defrostOnAction());
    case 'defrostOff':
      return fromPayload(defrostOffAction());
    case 'climateKeeper':
      return fromPayload(setClimateKeeperAction(CLIMATE_KEEPER_MODE[cmd.mode]));
    case 'cabinOverheat':
      return fromPayload(setCabinOverheatAction(cmd.on, cmd.fanOnly));
    case 'setCopTemp':
      // See builders.ts's setCopTempAction doc comment: proto confirmed
      // present, added despite the brief's "do NOT add" — flagged in the
      // P1d report for architect review.
      return fromPayload(setCopTempAction(cmd.level));
    case 'seatHeater':
      return fromPayload(setSeatHeaterAction(SEAT_HEATER_SEAT[cmd.seat], SEAT_HEATER_LVL[cmd.level]));
    case 'seatCooler':
      return fromPayload(setSeatCoolerAction(SEAT_COOLER_SEAT[cmd.seat], SEAT_COOLER_LVL[cmd.level]));
    case 'steeringWheelHeat':
      return fromPayload(setSteeringWheelHeaterAction(cmd.on));
    case 'ventWindows':
      return fromPayload(ventWindowsAction());
    case 'closeWindows':
      return fromPayload(closeWindowsAction());
    case 'honk':
      return fromPayload(honkAction());
    case 'flashLights':
      return fromPayload(flashLightsAction());
    case 'remoteStart':
      return fromPayload(remoteDriveAction());
    case 'sentry':
      return fromPayload(cmd.on ? sentryOnAction() : sentryOffAction());
    case 'valet':
      // Enabling carries the PIN; disabling sends an empty password (see setValetModeAction).
      return fromPayload(setValetModeAction(cmd.on, cmd.on ? requirePin(cmd.pin, 'valet') : ''));
    case 'speedLimit':
      switch (cmd.action) {
        case 'activate':
          return fromPayload(activateSpeedLimitAction(requirePin(cmd.pin, 'speedLimit.activate')));
        case 'deactivate':
          return fromPayload(deactivateSpeedLimitAction(requirePin(cmd.pin, 'speedLimit.deactivate')));
        case 'clearPin':
          return fromPayload(clearSpeedLimitPinAction(requirePin(cmd.pin, 'speedLimit.clearPin')));
        case 'set':
          if (cmd.mph == null) throw new Error('speedLimit.set requires mph');
          return fromPayload(setSpeedLimitMphAction(cmd.mph));
        default:
          throw new Error(`unsupported over BLE: speedLimit.${(cmd as { action: string }).action}`);
      }
    case 'homelink':
      return fromPayload(homelinkAction({ latitude: cmd.lat, longitude: cmd.lon }));
    case 'boombox':
      return fromPayload(boomboxAction(cmd.sound));
    case 'bioweaponMode':
      return fromPayload(setBioweaponModeAction(cmd.on, cmd.manualOverride));
    case 'pinToDrive':
      // Off sends an empty password and KEEPS the stored PIN; clearing it is `pinToDriveClearPin`.
      return fromPayload(
        setPinToDriveAction(cmd.on, cmd.on ? requirePin(cmd.pin, 'pinToDrive') : ''),
      );
    case 'valetClearPin':
      return fromPayload(resetValetPinAction());
    case 'pinToDriveClearPin':
      return fromPayload(resetPinToDriveAction());
    case 'parental':
      switch (cmd.action) {
        case 'activate':
          return fromPayload(setParentalControlsAction(true, requirePin(cmd.pin, 'parental.activate')));
        case 'deactivate':
          return fromPayload(setParentalControlsAction(false, requirePin(cmd.pin, 'parental.deactivate')));
        case 'clearPin':
          return fromPayload(clearParentalControlsPinAction(requirePin(cmd.pin, 'parental.clearPin')));
        case 'setSpeedLimit':
          if (cmd.mph == null) throw new Error('parental.setSpeedLimit requires mph');
          return fromPayload(setParentalSpeedLimitAction(cmd.mph));
        case 'setSetting':
          if (!cmd.setting) throw new Error('parental.setSetting requires a setting');
          return fromPayload(setParentalSettingAction(cmd.setting, !!cmd.enable));
        default:
          throw new Error(`unsupported over BLE: parental.${(cmd as { action: string }).action}`);
      }
    case 'navigateTo': {
      // The car takes a trip order on EVERY GPS-request variant — QtCarServer's
      // CarAPI::navigation_gps_request(..., const CarAPI::RemoteNavTripOrder&, ...)
      // — which is what makes APPEND-chaining a multi-stop route possible.
      const order = cmd.order ? NAV_ORDER[cmd.order] : undefined;
      return fromPayload(
        cmd.label
          ? navigateGpsWithLabelAction({ lat: cmd.lat, lon: cmd.lon, label: cmd.label, order })
          : navigateGpsAction({ lat: cmd.lat, lon: cmd.lon, order }),
      );
    }
    case 'navigateWaypoints':
      // RESPONSE-18: the waypoints STRING only accepts prefixed reference tokens
      // ("refId:<googlePlaceId>" / "superchargerId:<siteId>", comma-joined). There
      // is NO code path in the official app that emits a bare coordinate, and the
      // car silently drops tokens it can't parse — while still ACKing, which is why
      // this looked like it worked. refId is a Google Place ID and is not derivable
      // offline, so coordinate multi-stop is not available to an air-gapped client.
      // The app therefore sends ONE destination at a time, via navigateTo
      // (fleet.sendNavigation); there is no multi-stop caller any more.
      throw new Error(
        'unsupported over BLE: navigateWaypoints by coordinate — the car only accepts refId:/superchargerId: tokens',
      );
    case 'media':
      switch (cmd.action) {
        case 'toggle':
          return fromPayload(mediaPlayToggleAction());
        case 'next':
          return fromPayload(mediaNextTrackAction());
        case 'prev':
          return fromPayload(mediaPrevTrackAction());
        case 'volumeUp':
          return fromPayload(mediaVolumeAction(1));
        case 'volumeDown':
          return fromPayload(mediaVolumeAction(-1));
        default:
          throw new Error(`unsupported over BLE: media.${(cmd as { action: string }).action}`);
      }
    default: {
      const exhaustive: never = cmd;
      throw new Error(`unsupported over BLE: ${(exhaustive as { type: string }).type}`);
    }
  }
}

function requirePin(pin: string | undefined, ctx: string): string {
  if (!pin) throw new Error(`${ctx}: pin required`);
  return pin;
}
