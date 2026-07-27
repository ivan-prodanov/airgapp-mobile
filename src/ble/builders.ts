// builders.ts — Tesla vehicle-command action builders.
//
// Ported from the browser reference (rpi-webclient/client/session.js, lines
// ~1156–1520, "Action builders" section). Each builder returns an
// ActionPayload: the wire bytes ready to be AES-GCM-encrypted, the BLE
// domain those bytes target, and optional RoutableMessage flags.
//
// honkAction and vcsecGetStatusAction were already ported in P1c
// (session.ts) — imported and re-exported here, not duplicated.
//
// Deviations from the reference, found while verifying every new/changed
// field against the vendored .proto files under proto/ (not guessed):
//
//   1. `setKeepAccPowerAction` is MISNAMED in the reference — it actually
//      builds hvacBioweaponModeAction. Ported here under its correct name,
//      setBioweaponModeAction. No "keep accessory power" proto exists.
//
//   2. `remoteDriveAction` in the reference wraps a VehicleAction field
//      `vehicleControlRemoteStartAction` — THAT FIELD DOES NOT EXIST in the
//      vendored car_server.proto (grepped: no match). The reference's own
//      RKE_ACTION table (session.js:1160-1166) already defines
//      RKE_ACTION_REMOTE_DRIVE = 20 in vcsec.proto's RKEAction_E enum,
//      alongside LOCK/UNLOCK/WAKE_VEHICLE — just never wired to a builder.
//      Ported here correctly as a VCSEC RKEAction (matching how
//      lock/unlock/wake work), using the reference's own already-defined
//      constant.
//
//   3. `setClimateTempAction` in the reference sends
//      `hvacTemperatureAdjustmentAction: { levels: [c, c] }`. The vendored
//      HvacTemperatureAdjustmentAction message (car_server.proto:290-313)
//      has NO `levels` field (repeated or otherwise) — it has
//      `driver_temp_celsius` (6) and `passenger_temp_celsius` (7) as plain
//      floats, plus `absolute_celsius` (3, no zone) and a `level`
//      (singular, TEMP_MIN/TEMP_MAX Void oneof — not a numeric setpoint).
//      protobufjs silently drops unrecognized object keys during
//      `create()`, so the reference's builder has been encoding an EMPTY
//      HvacTemperatureAdjustmentAction (a no-op on the wire). Ported here
//      using driverTempCelsius + passengerTempCelsius (both set to the same
//      value), matching the reference's evident INTENT ("set both to the
//      same value for single-zone cars").
//
// See commands.test.ts / the P1d report for the full list of verified field
// names and the CarCommand dispatch table.

import {
  DOMAIN_INFOTAINMENT,
  DOMAIN_VEHICLE_SECURITY,
  FLAG_ENCRYPT_RESPONSE_BIT,
  encodeInfotainmentAction,
  encodeVCSECMessage,
  type ActionPayload,
} from './session';

// --- VCSEC enum values, vendored from vcsec.proto -----------------------

export const RKE_ACTION = Object.freeze({
  UNLOCK: 0,
  LOCK: 1,
  REMOTE_DRIVE: 20,
  AUTO_SECURE_VEHICLE: 29,
  WAKE_VEHICLE: 30,
});

export const CLOSURE_MOVE = Object.freeze({
  NONE: 0,
  MOVE: 1,
  STOP: 2,
  OPEN: 3,
  CLOSE: 4,
});

// --- VCSEC actions --------------------------------------------------------

export function lockAction(): ActionPayload {
  return { domain: DOMAIN_VEHICLE_SECURITY, bytes: encodeVCSECMessage({ RKEAction: RKE_ACTION.LOCK }) };
}
export function unlockAction(): ActionPayload {
  return { domain: DOMAIN_VEHICLE_SECURITY, bytes: encodeVCSECMessage({ RKEAction: RKE_ACTION.UNLOCK }) };
}
export function wakeAction(): ActionPayload {
  return { domain: DOMAIN_VEHICLE_SECURITY, bytes: encodeVCSECMessage({ RKEAction: RKE_ACTION.WAKE_VEHICLE }) };
}
// remoteDriveAction — see deviation #2 above: a VCSEC RKEAction, not an
// Infotainment VehicleAction (the reference's field doesn't exist).
export function remoteDriveAction(): ActionPayload {
  return { domain: DOMAIN_VEHICLE_SECURITY, bytes: encodeVCSECMessage({ RKEAction: RKE_ACTION.REMOTE_DRIVE }) };
}

export function openFrunkAction(): ActionPayload {
  return {
    domain: DOMAIN_VEHICLE_SECURITY,
    bytes: encodeVCSECMessage({ closureMoveRequest: { frontTrunk: CLOSURE_MOVE.OPEN } }),
  };
}
export function openTrunkAction(): ActionPayload {
  return {
    domain: DOMAIN_VEHICLE_SECURITY,
    bytes: encodeVCSECMessage({ closureMoveRequest: { rearTrunk: CLOSURE_MOVE.OPEN } }),
  };
}
export function closeTrunkAction(): ActionPayload {
  return {
    domain: DOMAIN_VEHICLE_SECURITY,
    bytes: encodeVCSECMessage({ closureMoveRequest: { rearTrunk: CLOSURE_MOVE.CLOSE } }),
  };
}
export function openChargePortAction(): ActionPayload {
  return {
    domain: DOMAIN_VEHICLE_SECURITY,
    bytes: encodeVCSECMessage({ closureMoveRequest: { chargePort: CLOSURE_MOVE.OPEN } }),
  };
}
export function closeChargePortAction(): ActionPayload {
  return {
    domain: DOMAIN_VEHICLE_SECURITY,
    bytes: encodeVCSECMessage({ closureMoveRequest: { chargePort: CLOSURE_MOVE.CLOSE } }),
  };
}

// --- Infotainment simple actions ------------------------------------------

export function flashLightsAction(): ActionPayload {
  return { domain: DOMAIN_INFOTAINMENT, bytes: encodeInfotainmentAction({ vehicleControlFlashLightsAction: {} }) };
}
export function climateOnAction(): ActionPayload {
  return { domain: DOMAIN_INFOTAINMENT, bytes: encodeInfotainmentAction({ hvacAutoAction: { powerOn: true } }) };
}
export function climateOffAction(): ActionPayload {
  return { domain: DOMAIN_INFOTAINMENT, bytes: encodeInfotainmentAction({ hvacAutoAction: { powerOn: false } }) };
}
export function sentryOnAction(): ActionPayload {
  return {
    domain: DOMAIN_INFOTAINMENT,
    bytes: encodeInfotainmentAction({ vehicleControlSetSentryModeAction: { on: true } }),
  };
}
export function sentryOffAction(): ActionPayload {
  return {
    domain: DOMAIN_INFOTAINMENT,
    bytes: encodeInfotainmentAction({ vehicleControlSetSentryModeAction: { on: false } }),
  };
}
export function startChargingAction(): ActionPayload {
  return { domain: DOMAIN_INFOTAINMENT, bytes: encodeInfotainmentAction({ chargingStartStopAction: { start: {} } }) };
}
export function stopChargingAction(): ActionPayload {
  return { domain: DOMAIN_INFOTAINMENT, bytes: encodeInfotainmentAction({ chargingStartStopAction: { stop: {} } }) };
}
export function chargeMaxRangeAction(): ActionPayload {
  return {
    domain: DOMAIN_INFOTAINMENT,
    bytes: encodeInfotainmentAction({ chargingStartStopAction: { startMaxRange: {} } }),
  };
}
export function chargeStandardRangeAction(): ActionPayload {
  return {
    domain: DOMAIN_INFOTAINMENT,
    bytes: encodeInfotainmentAction({ chargingStartStopAction: { startStandard: {} } }),
  };
}
export function setChargeLimitAction(percent: number): ActionPayload {
  const p = Math.round(percent);
  if (p < 50 || p > 100) throw new Error('charge limit must be 50..100');
  return { domain: DOMAIN_INFOTAINMENT, bytes: encodeInfotainmentAction({ chargingSetLimitAction: { percent: p } }) };
}

// --- Climate keeper / cabin overheat / bioweapon / wheel heater -----------
//
// HvacClimateKeeperAction.ClimateKeeperAction enum: 0=Off, 1=On, 2=Dog, 3=Camp.

export const CLIMATE_KEEPER = Object.freeze({ OFF: 0, ON: 1, DOG: 2, CAMP: 3 });

export function setClimateKeeperAction(mode: number): ActionPayload {
  const m = Number(mode);
  if (![0, 1, 2, 3].includes(m)) throw new Error('climate keeper mode must be 0..3');
  return {
    domain: DOMAIN_INFOTAINMENT,
    bytes: encodeInfotainmentAction({ hvacClimateKeeperAction: { ClimateKeeperAction: m } }),
  };
}
export function setCabinOverheatAction(on: boolean): ActionPayload {
  return {
    domain: DOMAIN_INFOTAINMENT,
    bytes: encodeInfotainmentAction({ setCabinOverheatProtectionAction: { on: !!on, fanOnly: false } }),
  };
}
// setBioweaponModeAction — see deviation #1: the reference calls this
// setKeepAccPowerAction, but it builds hvacBioweaponModeAction. Renamed to
// its correct name; no "keep accessory power" proto exists.
export function setBioweaponModeAction(on: boolean): ActionPayload {
  return {
    domain: DOMAIN_INFOTAINMENT,
    bytes: encodeInfotainmentAction({ hvacBioweaponModeAction: { on: !!on, manualOverride: false } }),
  };
}
// Steering-wheel heat is on/off ONLY — HvacSteeringWheelHeaterAction has a
// single `power_on` bool field, no level. Confirmed against car_server.proto.
export function setSteeringWheelHeaterAction(on: boolean): ActionPayload {
  return {
    domain: DOMAIN_INFOTAINMENT,
    bytes: encodeInfotainmentAction({ hvacSteeringWheelHeaterAction: { powerOn: !!on } }),
  };
}

// --- Windows ---------------------------------------------------------------

export function ventWindowsAction(): ActionPayload {
  return { domain: DOMAIN_INFOTAINMENT, bytes: encodeInfotainmentAction({ vehicleControlWindowAction: { vent: {} } }) };
}
export function closeWindowsAction(): ActionPayload {
  return {
    domain: DOMAIN_INFOTAINMENT,
    bytes: encodeInfotainmentAction({ vehicleControlWindowAction: { close: {} } }),
  };
}

// --- Seat heater / cooler ----------------------------------------------------
//
// Heaters use a double-oneof Void message (SEAT_POS x SEAT_HEATER_LEVEL);
// coolers use numeric enums. Both confirmed against car_server.proto.

export const SEAT_POS_HEATER = Object.freeze({
  FRONT_LEFT: 'CAR_SEAT_FRONT_LEFT',
  FRONT_RIGHT: 'CAR_SEAT_FRONT_RIGHT',
  REAR_LEFT: 'CAR_SEAT_REAR_LEFT',
  REAR_CENTER: 'CAR_SEAT_REAR_CENTER',
  REAR_RIGHT: 'CAR_SEAT_REAR_RIGHT',
});
export const SEAT_HEATER_LEVEL = Object.freeze({
  OFF: 'SEAT_HEATER_OFF',
  LOW: 'SEAT_HEATER_LOW',
  MED: 'SEAT_HEATER_MED',
  HIGH: 'SEAT_HEATER_HIGH',
});

export function setSeatHeaterAction(position: string, level: string): ActionPayload {
  const p = (SEAT_POS_HEATER as Record<string, string>)[position] || position;
  const l = (SEAT_HEATER_LEVEL as Record<string, string>)[level] || level;
  return {
    domain: DOMAIN_INFOTAINMENT,
    bytes: encodeInfotainmentAction({
      hvacSeatHeaterActions: {
        hvacSeatHeaterAction: [{ [l]: {}, [p]: {} }],
      },
    }),
  };
}

// Cooler enum is numeric: 1=Off, 2=Low, 3=Med, 4=High. Positions:
// FrontLeft=1, FrontRight=2 (no rear cooling in the proto).
export const SEAT_COOLER_LEVEL = Object.freeze({ OFF: 1, LOW: 2, MED: 3, HIGH: 4 });
export const SEAT_COOLER_POS = Object.freeze({ FRONT_LEFT: 1, FRONT_RIGHT: 2 });

export function setSeatCoolerAction(position: string | number, level: string | number): ActionPayload {
  const p = (SEAT_COOLER_POS as Record<string, number>)[position as string] ?? position;
  const l = (SEAT_COOLER_LEVEL as Record<string, number>)[level as string] ?? level;
  return {
    domain: DOMAIN_INFOTAINMENT,
    bytes: encodeInfotainmentAction({
      hvacSeatCoolerActions: {
        hvacSeatCoolerAction: [{ seatPosition: p, seatCoolerLevel: l }],
      },
    }),
  };
}

// --- Homelink / remote drive ------------------------------------------------

export function homelinkAction({ latitude, longitude }: { latitude: number; longitude: number }): ActionPayload {
  if (!Number.isFinite(latitude) || !Number.isFinite(longitude)) {
    throw new Error('homelink needs valid lat/lon');
  }
  return {
    domain: DOMAIN_INFOTAINMENT,
    bytes: encodeInfotainmentAction({ vehicleControlTriggerHomelinkAction: { location: { latitude, longitude } } }),
  };
}

// --- Valet / speed-limit (PIN-protected) ------------------------------------

export function validatePin(pin: unknown): string {
  const p = (pin ?? '').toString();
  if (!/^\d{4}$/.test(p)) throw new Error('PIN must be exactly 4 digits');
  return p;
}

// Turning valet ON carries a 4-digit PIN; turning it OFF sends an EMPTY password. Verified in the
// decompiled app (v4.58.0): the Valet row's off path dispatches setValetMode(false, '') with no prompt
// at all, so requiring a PIN here would make "turn valet off" impossible.
export function setValetModeAction(on: boolean, pin: string): ActionPayload {
  const p = on ? validatePin(pin) : '';
  return {
    domain: DOMAIN_INFOTAINMENT,
    bytes: encodeInfotainmentAction({ vehicleControlSetValetModeAction: { on: !!on, password: p } }),
  };
}
// Valet "Clear PIN" — CarServer.VehicleControlResetValetPinAction (empty), via VehicleAction = 28.
// This is the row's Clear PIN action, NOT the off switch (see setValetModeAction above).
export function resetValetPinAction(): ActionPayload {
  return {
    domain: DOMAIN_INFOTAINMENT,
    bytes: encodeInfotainmentAction({ vehicleControlResetValetPinAction: {} }),
  };
}
export function activateSpeedLimitAction(pin: string): ActionPayload {
  return {
    domain: DOMAIN_INFOTAINMENT,
    bytes: encodeInfotainmentAction({ drivingSpeedLimitAction: { activate: true, pin: validatePin(pin) } }),
  };
}
export function deactivateSpeedLimitAction(pin: string): ActionPayload {
  return {
    domain: DOMAIN_INFOTAINMENT,
    bytes: encodeInfotainmentAction({ drivingSpeedLimitAction: { activate: false, pin: validatePin(pin) } }),
  };
}
export function clearSpeedLimitPinAction(pin: string): ActionPayload {
  return {
    domain: DOMAIN_INFOTAINMENT,
    bytes: encodeInfotainmentAction({ drivingClearSpeedLimitPinAction: { pin: validatePin(pin) } }),
  };
}
export function setSpeedLimitMphAction(mph: number): ActionPayload {
  const raw = Number(mph);
  if (!Number.isFinite(raw)) throw new Error('speed limit must be a number');
  // The UI stores the exact km/h→mph value (e.g. 80 km/h = 49.7 mph); the car resolves whole mph, so
  // round at dispatch. Range 50..120 mph ≈ 80..193 km/h. The old 90 cap was ours, not the protocol's.
  const m = Math.round(raw);
  if (m < 50 || m > 120) throw new Error('speed limit must be 50..120 mph');
  return {
    domain: DOMAIN_INFOTAINMENT,
    bytes: encodeInfotainmentAction({ drivingSetSpeedLimitAction: { limitMph: m } }),
  };
}

// --- Navigation --------------------------------------------------------------
//
// REPLACE=0, PREPEND=1, APPEND=2 (RemoteNavTripOrder).
//
// ⚠ OUR VENDORED PROTO IS WRONG HERE — do not "correct" this back from
// `proto/gen.d.ts`. The generated enum carries a spurious
// `REMOTE_NAV_TRIP_ORDER_UNKNOWN = 0` which shifts every real value up by one
// (REPLACE=1, PREPEND=2, APPEND=3). The official app's enum has no UNKNOWN member:
//
//   new f3("RemoteNavTripOrderReplace", 0, 0)   → REPLACE = 0
//   new f3("RemoteNavTripOrderPrepend", 1, 1)   → PREPEND = 1
//   new f3("RemoteNavTripOrderAppend",  2, 2)   → APPEND  = 2
//                                (fc0/f3.java, HW4 decompile; RESPONSE-15 Tier 0)
//
// Consequence of the old values, and why this was a live user-visible defect:
// every "navigate here" sent 1 = PREPEND, so destinations were PREPENDED to the
// existing trip instead of REPLACING it, and APPEND sent 3 — not a valid value,
// which the car maps to null. REPLACE=0 is the proto default, so it may be omitted
// on the wire entirely; the car defaults to REPLACE, which is exactly what we want.
export const NAV_ORDER = Object.freeze({ REPLACE: 0, PREPEND: 1, APPEND: 2 });

export function navigateGpsAction({ lat, lon, order }: { lat: number; lon: number; order?: number }): ActionPayload {
  return {
    domain: DOMAIN_INFOTAINMENT,
    bytes: encodeInfotainmentAction({
      navigationGpsRequest: { lat: Number(lat), lon: Number(lon), order: order ?? NAV_ORDER.REPLACE },
    }),
  };
}
export function navigateGpsWithLabelAction({
  lat,
  lon,
  label,
  order,
}: {
  lat: number;
  lon: number;
  label?: string;
  order?: number;
}): ActionPayload {
  return {
    domain: DOMAIN_INFOTAINMENT,
    // Ask for an ENCRYPTED response, exactly as the infotainment reads do.
    //
    // Measured on-car 2026-07-27: nine cold nav sends, every one of them
    // "car sent no payload to inspect". Without this flag the car answers with a
    // status-only frame — no AES_GCM_ResponseData — so `decryptedPayload` is never
    // populated, `parseCarActionStatus` always returns null, and the car's own
    // verdict is unobtainable. That made the rejection-reason work inert: a send
    // the car refused and one it accepted were byte-identical to us, which is the
    // exact defect that work existed to fix.
    //
    // The reads (getChargeState/getDriveState/…) already set this and their
    // responses decrypt reliably, so the flag's round-trip is proven on this
    // firmware — it had simply never been set on a WRITE.
    flags: FLAG_ENCRYPT_RESPONSE_BIT,
    bytes: encodeInfotainmentAction({
      navigationGpsDestinationRequest: {
        lat: Number(lat),
        lon: Number(lon),
        destination: label || '',
        order: order ?? NAV_ORDER.REPLACE,
      },
    }),
  };
}
export function navigateSearchAction({ query, order }: { query: string; order?: number }): ActionPayload {
  return {
    domain: DOMAIN_INFOTAINMENT,
    bytes: encodeInfotainmentAction({ navigationRequest: { destination: query, order: order ?? NAV_ORDER.REPLACE } }),
  };
}
// navigateWaypointsAction — multi-stop navigation.
//
// NavigationWaypointsRequest.waypoints is a STRING field (car_server.proto:598).
// RESPONSE-18 recovered what the official app actually puts in it (#114892
// @04b2-054a): PREFIXED REFERENCE TOKENS JOINED BY A COMMA —
//
//     refId:<googlePlaceId>,superchargerId:<teslaSiteId>,refId:<googlePlaceId>
//
// A stop carrying neither id is silently SKIPPED by the app itself
// ("Skipping waypoint without refId or valid supercharger id" @00e1).
//
// ⚠ COORDINATES ARE NOT ACCEPTED. There is no code path in the 4.58.0 iOS build
// that emits a bare lat/lon into this field, and the semicolon form we tried
// ("lat,lon;lat,lon") is an API-side convention, not the car's. The car ACKs it
// anyway — see waypointsTokenString's note on why the ACK proves nothing — and
// then drops every unparsed token, which is exactly the "ok but no route" we
// measured on-car 2026-07-26.
//
// The message carries no trip-order field (only `waypoints` + `tripPlanOptions`),
// unlike NavigationGpsRequest which does (see NAV_ORDER).
export function navigateWaypointsAction(waypoints: string): ActionPayload {
  return {
    domain: DOMAIN_INFOTAINMENT,
    bytes: encodeInfotainmentAction({ navigationWaypointsRequest: { waypoints } }),
  };
}

// waypointsTokenString — join reference tokens the way the app does: a plain
// Array.join(','), no leading or trailing delimiter.
//
// Only `superchargerId:<id>` is constructible by an air-gapped client: `refId:` is
// a GOOGLE PLACE ID, which cannot be derived offline from a lat/lon. So this is
// usable for a Supercharger-only itinerary and nothing else.
//
// ⚠ Do NOT use the car's ACK as proof of success for anything nav-related.
// QtCarServer's navigation_waypoints_request is a thin proxy that logs and
// forwards, returning result:true BEFORE any parsing; the parse happens downstream
// and its failures never reach us (RESPONSE-18 Q3). Verify by reading back
// DriveState.active_route_* instead.
export function waypointsTokenString(tokens: string[]): string {
  if (tokens.length === 0) throw new Error('waypointsTokenString: need at least one token');
  for (const t of tokens) {
    if (!/^(refId|superchargerId):.+/.test(t)) {
      throw new Error(`waypointsTokenString: token must be refId:<id> or superchargerId:<id>, got "${t}"`);
    }
  }
  return tokens.join(',');
}

// --- Boombox -------------------------------------------------------------

export function boomboxAction(sound: number): ActionPayload {
  const s = Number(sound);
  if (!Number.isInteger(s) || s < 0 || s > 65535) throw new Error('sound must be 0..65535');
  return { domain: DOMAIN_INFOTAINMENT, bytes: encodeInfotainmentAction({ boomboxAction: { sound: s } }) };
}

// --- State-read actions ------------------------------------------------------
//
// Each wraps a GetVehicleData sub-message; flags = FLAG_ENCRYPT_RESPONSE_BIT
// (the car requires it for state reads, per session.ts's constant and
// comment on FLAG_ENCRYPT_RESPONSE_BIT).

export function getChargeStateAction(): ActionPayload {
  return {
    domain: DOMAIN_INFOTAINMENT,
    flags: FLAG_ENCRYPT_RESPONSE_BIT,
    bytes: encodeInfotainmentAction({ getVehicleData: { getChargeState: {} } }),
  };
}
export function getClimateStateAction(): ActionPayload {
  return {
    domain: DOMAIN_INFOTAINMENT,
    flags: FLAG_ENCRYPT_RESPONSE_BIT,
    bytes: encodeInfotainmentAction({ getVehicleData: { getClimateState: {} } }),
  };
}
export function getDriveStateAction(): ActionPayload {
  return {
    domain: DOMAIN_INFOTAINMENT,
    flags: FLAG_ENCRYPT_RESPONSE_BIT,
    bytes: encodeInfotainmentAction({ getVehicleData: { getDriveState: {} } }),
  };
}
export function getLocationStateAction(): ActionPayload {
  return {
    domain: DOMAIN_INFOTAINMENT,
    flags: FLAG_ENCRYPT_RESPONSE_BIT,
    bytes: encodeInfotainmentAction({ getVehicleData: { getLocationState: {} } }),
  };
}
export function getClosuresStateAction(): ActionPayload {
  return {
    domain: DOMAIN_INFOTAINMENT,
    flags: FLAG_ENCRYPT_RESPONSE_BIT,
    bytes: encodeInfotainmentAction({ getVehicleData: { getClosuresState: {} } }),
  };
}
// getTirePressureStateAction — TPMS.
//
// The proto is explicit that the values are BAR ("tpms pressure values in bar",
// "rcp values in bar"), and Ivan's car agrees: the official app shows 2.8-2.9 bar
// against a placard of 2.9. So no conversion — render what the car sends.
//
// The message also carries per-wheel hard/soft warning flags and, in fields
// 18/19, the RECOMMENDED COLD PRESSURE front and rear. That is where the Tesla
// app's "Recommended Cold Pressure: 2.9 bar" subtitle comes from — it is the
// car's own placard value, not something we hardcode per model.
export function getTirePressureStateAction(): ActionPayload {
  return {
    domain: DOMAIN_INFOTAINMENT,
    flags: FLAG_ENCRYPT_RESPONSE_BIT,
    bytes: encodeInfotainmentAction({ getVehicleData: { getTirePressureState: {} } }),
  };
}

// getMediaStateAction / getMediaDetailStateAction — now playing.
//
// TWO reads, not one, and that is forced rather than chosen: the 452-byte
// inbound cap means one submessage per request (RESPONSE-15 P2-1), and the
// fields a "now playing" line needs are split across both messages —
// title/artist/volume/playback-status live in MediaState (15), while
// album/station/elapsed/duration live in MediaDetailState (16).
//
// MediaState.remote_control_enabled is the car's own opinion on whether it will
// accept the transport commands at all. Read it before offering the buttons;
// do not infer it from a successful read, which only proves the car answered.
export function getMediaStateAction(): ActionPayload {
  return {
    domain: DOMAIN_INFOTAINMENT,
    flags: FLAG_ENCRYPT_RESPONSE_BIT,
    bytes: encodeInfotainmentAction({ getVehicleData: { getMediaState: {} } }),
  };
}
export function getMediaDetailStateAction(): ActionPayload {
  return {
    domain: DOMAIN_INFOTAINMENT,
    flags: FLAG_ENCRYPT_RESPONSE_BIT,
    bytes: encodeInfotainmentAction({ getVehicleData: { getMediaDetailState: {} } }),
  };
}

export function getFullVehicleDataAction(): ActionPayload {
  return {
    domain: DOMAIN_INFOTAINMENT,
    flags: FLAG_ENCRYPT_RESPONSE_BIT,
    bytes: encodeInfotainmentAction({
      getVehicleData: {
        getChargeState: {},
        getClimateState: {},
        getDriveState: {},
        getLocationState: {},
        getClosuresState: {},
      },
    }),
  };
}

// --- Defrost + temperature -------------------------------------------------

export function defrostOnAction(): ActionPayload {
  return {
    domain: DOMAIN_INFOTAINMENT,
    bytes: encodeInfotainmentAction({ hvacSetPreconditioningMaxAction: { on: true, manualOverride: false } }),
  };
}
export function defrostOffAction(): ActionPayload {
  return {
    domain: DOMAIN_INFOTAINMENT,
    bytes: encodeInfotainmentAction({ hvacSetPreconditioningMaxAction: { on: false, manualOverride: false } }),
  };
}

// setClimateTempAction — see deviation #3 above: driverTempCelsius +
// passengerTempCelsius (both set the same), not the reference's dead
// `levels` field.
export function setClimateTempAction(celsius: number): ActionPayload {
  const c = Number(celsius);
  if (!Number.isFinite(c) || c < 15 || c > 28) {
    throw new Error('climate temperature must be 15..28 °C');
  }
  return {
    domain: DOMAIN_INFOTAINMENT,
    bytes: encodeInfotainmentAction({
      hvacTemperatureAdjustmentAction: { driverTempCelsius: c, passengerTempCelsius: c },
    }),
  };
}

// --- New builders (P1d — confirmed present in vendored protos) -------------

// setChargingAmpsAction → CarServer.SetChargingAmpsAction (charging_amps
// int32), via VehicleAction.setChargingAmpsAction = 43. Confirmed.
export function setChargingAmpsAction(amps: number): ActionPayload {
  const a = Math.round(Number(amps));
  if (!Number.isFinite(a) || a < 0) throw new Error('charging amps must be a non-negative number');
  return {
    domain: DOMAIN_INFOTAINMENT,
    bytes: encodeInfotainmentAction({ setChargingAmpsAction: { chargingAmps: a } }),
  };
}

// Media transport — CarServer.MediaPlayAction (empty, toggles play/pause),
// MediaNextTrack / MediaPreviousTrack (empty), via VehicleAction.mediaPlayAction
// = 15 / mediaNextTrack = 19 / mediaPreviousTrack = 20. Confirmed.
export function mediaPlayToggleAction(): ActionPayload {
  return { domain: DOMAIN_INFOTAINMENT, bytes: encodeInfotainmentAction({ mediaPlayAction: {} }) };
}
export function mediaNextTrackAction(): ActionPayload {
  return { domain: DOMAIN_INFOTAINMENT, bytes: encodeInfotainmentAction({ mediaNextTrack: {} }) };
}
export function mediaPrevTrackAction(): ActionPayload {
  return { domain: DOMAIN_INFOTAINMENT, bytes: encodeInfotainmentAction({ mediaPreviousTrack: {} }) };
}
// mediaVolumeAction — CarServer.MediaUpdateVolume `oneof media_volume {
// sint32 volume_delta = 1; float volume_absolute_float = 3; }`, via
// VehicleAction.mediaUpdateVolume = 16. Uses the RELATIVE (delta) form per
// the brief — the absolute form exists too but no CarCommand variant needs
// it yet.
export function mediaVolumeAction(delta: number): ActionPayload {
  const d = Math.round(Number(delta));
  if (!Number.isFinite(d) || d === 0) throw new Error('volume delta must be a non-zero integer');
  return {
    domain: DOMAIN_INFOTAINMENT,
    bytes: encodeInfotainmentAction({ mediaUpdateVolume: { volumeDelta: d } }),
  };
}

// Pin-to-drive — CarServer.VehicleControlSetPinToDriveAction (on bool,
// password string), via VehicleAction.vehicleControlSetPinToDriveAction =
// 77; CarServer.VehicleControlResetPinToDriveAction (empty — OWNER reset,
// not the admin-key variant), via ...ResetPinToDriveAction = 78. Confirmed.
// Same asymmetry as valet: enabling carries the 4-digit PIN, disabling sends an EMPTY password with no
// prompt (verified: the PIN-to-Drive row's off path dispatches setPinToDrive(false, '')). Turning it off
// must NOT be routed to resetPinToDriveAction — that is the separate "Clear PIN" action, which would
// discard the stored PIN the car keeps across an off/on cycle.
export function setPinToDriveAction(on: boolean, pin: string): ActionPayload {
  const p = on ? validatePin(pin) : '';
  return {
    domain: DOMAIN_INFOTAINMENT,
    bytes: encodeInfotainmentAction({ vehicleControlSetPinToDriveAction: { on: !!on, password: p } }),
  };
}
export function resetPinToDriveAction(): ActionPayload {
  return {
    domain: DOMAIN_INFOTAINMENT,
    bytes: encodeInfotainmentAction({ vehicleControlResetPinToDriveAction: {} }),
  };
}

// ── Parental Controls — CarServer.ParentalControls* (VehicleAction 109-113) ──────────────────────
// Shapes mirror the app's own builders: activateParentalControls(activate, pin) and
// clearParentalControlsPin(pin). See proto/car_server.proto for tag provenance.
export function setParentalControlsAction(activate: boolean, pin: string): ActionPayload {
  return {
    domain: DOMAIN_INFOTAINMENT,
    bytes: encodeInfotainmentAction({
      parentalControlsAction: { activate: !!activate, pin: validatePin(pin) },
    }),
  };
}
export function clearParentalControlsPinAction(pin: string): ActionPayload {
  return {
    domain: DOMAIN_INFOTAINMENT,
    bytes: encodeInfotainmentAction({ parentalControlsClearPinAction: { pin: validatePin(pin) } }),
  };
}
export function setParentalSpeedLimitAction(mph: number): ActionPayload {
  const raw = Number(mph);
  if (!Number.isFinite(raw)) throw new Error('parental speed limit must be a number');
  const m = Math.round(raw); // stored as exact km/h→mph; the car resolves whole mph
  if (m < 50 || m > 120) throw new Error('parental speed limit must be 50..120 mph');
  return {
    domain: DOMAIN_INFOTAINMENT,
    bytes: encodeInfotainmentAction({ parentalControlsSetSpeedLimitAction: { limitMph: m } }),
  };
}

// The four sub-settings of the "Customize Parental Controls" panel.
export type ParentalSetting = 'speedLimit' | 'acceleration' | 'safetyFeatures' | 'curfew';
const PARENTAL_SETTING_ENUM: Record<ParentalSetting, number> = {
  speedLimit: 1, // PARENTAL_CONTROLS_SETTING_SPEED_LIMIT
  acceleration: 2, // PARENTAL_CONTROLS_SETTING_ACCELERATION
  safetyFeatures: 3, // PARENTAL_CONTROLS_SETTING_SAFETY_FEATURES
  curfew: 4, // PARENTAL_CONTROLS_SETTING_CURFEW
};
export function setParentalSettingAction(setting: ParentalSetting, enable: boolean): ActionPayload {
  return {
    domain: DOMAIN_INFOTAINMENT,
    bytes: encodeInfotainmentAction({
      parentalControlsEnableSettingsAction: { setting: PARENTAL_SETTING_ENUM[setting], enable: !!enable },
    }),
  };
}

// setCopTempAction — NOT in the brief's "new builders" list (the brief,
// following the P0 audit, states no COP activation-temperature set action
// exists). Direct verification against the vendored protos found otherwise:
// CarServer.SetCopTempAction (car_server.proto:515-516, field
// `copActivationTemp` : ClimateState.CopActivationTemp) IS present, reached
// via VehicleAction.setCopTempAction = 66 (car_server.proto:78). The enum
// (vehicle.proto:575-579) is Unspecified=0, Low=1, Medium=2, High=3 — an
// exact match for CarCommand's `setCopTemp.level: 'low'|'medium'|'high'`.
// Added despite the brief's explicit "do NOT add one" because the evidence
// is unambiguous (grep + proto source, not a guess); flagged prominently in
// the P1d report for architect review rather than silently overriding the
// brief.
export const COP_ACTIVATION_TEMP = Object.freeze({ LOW: 1, MEDIUM: 2, HIGH: 3 });

export function setCopTempAction(level: 'low' | 'medium' | 'high'): ActionPayload {
  const map: Record<string, number> = { low: COP_ACTIVATION_TEMP.LOW, medium: COP_ACTIVATION_TEMP.MEDIUM, high: COP_ACTIVATION_TEMP.HIGH };
  const v = map[level];
  if (v == null) throw new Error(`setCopTempAction: unknown level "${level}" (want low|medium|high)`);
  return {
    domain: DOMAIN_INFOTAINMENT,
    bytes: encodeInfotainmentAction({ setCopTempAction: { copActivationTemp: v } }),
  };
}
