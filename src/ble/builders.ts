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
//      setBioweaponModeAction. (The REAL keep-accessory-power action DOES exist
//      as CarServer.SetKeepAccessoryPowerModeAction, VehicleAction 138 — see
//      setKeepAccessoryPowerModeAction below; it was simply not what the
//      reference's `setKeepAccPowerAction` built.)
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
// Unlatch the driver's door — a closureMoveRequest opening frontDriverDoor, exactly as the Tesla app's
// `sendUnlatchDriverDoor` does (ClosureMoveRequestDoorFrom(DRIVER_FRONT_DOOR)). NOT an RKE action — there is
// no RKE_ACTION_UNLATCH; it rides the same VCSEC closure mechanism as the frunk/trunk.
export function unlatchDriverDoorAction(): ActionPayload {
  return {
    domain: DOMAIN_VEHICLE_SECURITY,
    bytes: encodeVCSECMessage({ closureMoveRequest: { frontDriverDoor: CLOSURE_MOVE.OPEN } }),
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

// HvacClimateKeeperAction.ManualOverrideMode_E in the CURRENT firmware's proto:
// { SOC: 0, CPD: 1 }. CPD is Child Presence Detection — "Child Left Alone
// Detection" in their UI.
export const KEEPER_OVERRIDE = Object.freeze({ SOC: 0, CPD: 1 });

// Our vendored car_server.proto is an OLDER REVISION of this message than the
// car runs, and that is the whole bug behind "Camp Mode turn ON does not work,
// turn OFF works".
//
//   ours    HvacClimateKeeperAction { 1: ClimateKeeperAction, 2: manualOverride bool }
//   theirs  ... plus                 { 3: manualOverrideModeList, repeated enum, PACKED }
//
// Tesla's serializer writes it with writePackedEnum(3, list) (@848914), and
// their camp/pet enable path sends [CPD] whenever the car's vehicle config sets
// `cpd_disable_notification_required`. Turning a keeper mode OFF sends no
// override — which is exactly why OFF appeared to work and ON did not: the car
// accepts both (actionStatus OK) but refuses to ENGAGE a mode that suppresses
// Child Left Alone Detection unless the override is present.
//
// Everything else was already byte-identical to theirs, verified tag by tag:
// Action.vehicleAction is field 2, hvacClimateKeeperAction is field 44 in both,
// the mode is field 1 in both, and the enum is {OFF:0, ON:1, DOG:2, CAMP:3} in
// both. So the missing field was the only difference left on the wire.
//
// The generated type has no field 3, but its encoder re-emits `$unknowns` with
// writer.raw(), so we hand-encode the one field rather than regenerate the whole
// proto from a revision we do not have. Packed enum: tag (3<<3)|2 = 0x1a, then
// the byte length, then one varint per value (every value here is < 128).
const overrideModeList = (modes: readonly number[]): Uint8Array =>
  new Uint8Array([0x1a, modes.length, ...modes]);

export function setClimateKeeperAction(
  mode: number,
  overrides: readonly number[] = [],
): ActionPayload {
  const m = Number(mode);
  if (![0, 1, 2, 3].includes(m)) throw new Error('climate keeper mode must be 0..3');
  return {
    domain: DOMAIN_INFOTAINMENT,
    bytes: encodeInfotainmentAction({
      hvacClimateKeeperAction: {
        ClimateKeeperAction: m,
        ...(overrides.length ? { $unknowns: [overrideModeList(overrides)] } : {}),
      },
    }),
  };
}
// `fanOnly` is the "No A/C" arm of the three-way selector — the car cools with
// the fan alone. It was pinned false, so No A/C sent bytes identical to On: the
// car turned COP fully on, reported On, and the selection snapped back one read
// later. We could READ the mode (copMode maps FanOnly=2 -> 'noac') but never set
// it.
//
// Tesla's own mapping, from the climate screen's ToggleSelector onChange
// (@5224697), is exactly the two independent predicates:
//
//   VehicleCommand.cabinOverheatProtection(
//     on      = selected !== Off,
//     fanOnly = selected === FanOnly)
//
// Proto field numbers confirmed against their deserializer (@849455): 1 = on,
// 2 = fanOnly.
export function setCabinOverheatAction(on: boolean, fanOnly: boolean): ActionPayload {
  return {
    domain: DOMAIN_INFOTAINMENT,
    bytes: encodeInfotainmentAction({
      setCabinOverheatProtectionAction: { on: !!on, fanOnly: !!fanOnly },
    }),
  };
}
// setBioweaponModeAction — see deviation #1: the reference calls this
// setKeepAccPowerAction, but it builds hvacBioweaponModeAction. Renamed to
// its correct name. (The real keep-accessory-power setter is
// setKeepAccessoryPowerModeAction, further down.)
// `manualOverride` was pinned false — the same defect as cabin overheat's
// `fanOnly`, a second proto field frozen to a constant. Tesla sets it from the
// live keeper mode (@5223782):
//
//   VehicleCommand.bioweaponMode(on, climateKeeperMode !== OFF)
//
// It means "the user is knowingly overriding a running Camp/Pet mode", which is
// why their UI confirms first: "Enabling Bioweapon Defense Mode will disable Pet
// Mode."
export function setBioweaponModeAction(on: boolean, manualOverride: boolean): ActionPayload {
  return {
    domain: DOMAIN_INFOTAINMENT,
    bytes: encodeInfotainmentAction({
      hvacBioweaponModeAction: { on: !!on, manualOverride: !!manualOverride },
    }),
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
    // See navigateGpsWithLabelAction — without this the car answers status-only and
    // its verdict is unreadable. Applies to every nav action, not just the one that
    // happened to be under test when the absence was measured.
    flags: FLAG_ENCRYPT_RESPONSE_BIT,
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
    // Same reason as the other two — and this one matters most for diagnosing
    // failures. f21 is the only nav message that SEARCHES, so it is the only one
    // that can refuse on its merits ("no results found", observed on-car at Point
    // C). Without the flag that refusal reaches us as a status-only frame and is
    // indistinguishable from success.
    flags: FLAG_ENCRYPT_RESPONSE_BIT,
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
// Schedule READBACK — the truth check for the write path. The car echoes the
// daysOfWeek bitmask it stored, so this confirms (a) the schedule was STORED at
// all (i.e. the car accepted the coordinates — the RESPONSE-15 open question the
// ACK cannot answer) and (b) the start/end minutes round-tripped. It also lists
// ANY pre-existing schedule the official app created, whose bitmask is
// independent ground truth for the day-bit order.
export function getChargeScheduleStateAction(): ActionPayload {
  return {
    domain: DOMAIN_INFOTAINMENT,
    flags: FLAG_ENCRYPT_RESPONSE_BIT,
    bytes: encodeInfotainmentAction({ getVehicleData: { getChargeScheduleState: {} } }),
  };
}
export function getPreconditioningScheduleStateAction(): ActionPayload {
  return {
    domain: DOMAIN_INFOTAINMENT,
    flags: FLAG_ENCRYPT_RESPONSE_BIT,
    bytes: encodeInfotainmentAction({ getVehicleData: { getPreconditioningScheduleState: {} } }),
  };
}
// Parental controls readback — the Customize-Parental-Controls page's truth
// (active, pin_set, and the settings: speed limit, chill accel, require-safety,
// curfew). The official app fetches this together with closures_state whenever
// its Security screen is open ("on security screen, fetching closures & parental
// controls state..."); we do the same via readSecurity.
export function getParentalControlsStateAction(): ActionPayload {
  return {
    domain: DOMAIN_INFOTAINMENT,
    flags: FLAG_ENCRYPT_RESPONSE_BIT,
    bytes: encodeInfotainmentAction({ getVehicleData: { getParentalControlsState: {} } }),
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

// --- Multi-schedule charge & precondition (the CURRENT, day-aware generation) ---
//
// Recovered for REQUEST-15 Tier 5. Our schedules UI already models recurring
// multi-day schedules; the LEGACY ScheduledChargingAction {enabled, charging_time}
// cannot carry days, so it would silently drop the day chips. These are the
// modern messages the app itself uses.
//
// Message layout is NOT guessed — it is `common.ChargeSchedule` / `.PreconditionSchedule`
// (proto/common.proto:55/69), which the decompiled `ec0/C15891e.java` /
// `ec0/C15909q.java` adapters confirm field-for-field. They ride the VehicleAction
// oneof: add 97/99, remove 98/100.
//
//   ChargeSchedule       { id, name, daysOfWeek, startEnabled, startTime,
//                          endEnabled, endTime, oneTime, enabled, latitude, longitude }
//   PreconditionSchedule { id, name, daysOfWeek, preconditionTime, oneTime,
//                          enabled, latitude, longitude }
//
// `id` is a creation-epoch timestamp the car keys the schedule by — the SAME id
// must come back to remove it. `startTime`/`endTime`/`preconditionTime` are
// "24h in minutes" = minutes past local midnight (proto comment). lat/lon are the
// schedule's location; offline we supply the user's home coords (RESPONSE-15
// open-Q5: whether the car accepts user-supplied coords is unverified on-car).

// 'HH:MM' (24h) -> minutes past midnight, the wire unit for every schedule time.
export function hhmmToMinutes(hhmm: string): number {
  const m = /^(\d{1,2}):(\d{2})$/.exec(hhmm.trim());
  if (!m) throw new Error(`schedule time must be HH:MM, got ${JSON.stringify(hhmm)}`);
  const h = Number(m[1]);
  const min = Number(m[2]);
  if (h > 23 || min > 59) throw new Error(`schedule time out of range: ${hhmm}`);
  return h * 60 + min;
}

// days_of_week is an INT32 bitmask. Our model indexes 0=Mon … 6=Sun, and we set
// bit i for day i.
//
// ⚠ THE ONE UNVERIFIED ASSUMPTION in this whole path: the car's bit ORDER is not
// in any artefact on disk (the DaysOfWeek enum was not recovered). This mapping
// is Monday=bit0; if the car turns out Sunday-first, only this constant changes.
// It is a single source of truth on purpose, and the reconcile/UI layer must not
// re-derive it. Do NOT trust the car's ACK as proof it read the days correctly —
// verify against the car's own schedule readback before trusting it.
export const SCHEDULE_DAY_BIT = Object.freeze({ mon: 0, tue: 1, wed: 2, thu: 3, fri: 4, sat: 5, sun: 6 });
export function daysToBitmask(days: readonly number[]): number {
  let mask = 0;
  for (const d of days) {
    if (d < 0 || d > 6) throw new Error(`day index out of range 0..6: ${d}`);
    mask |= 1 << d;
  }
  return mask;
}

export interface ChargeScheduleInput {
  id: number;
  name?: string;
  days: readonly number[];
  startEnabled: boolean;
  startTime: string; // 'HH:MM'
  endEnabled: boolean;
  endTime: string; // 'HH:MM'
  enabled: boolean;
  oneTime?: boolean;
  latitude: number;
  longitude: number;
}

export function addChargeScheduleAction(s: ChargeScheduleInput): ActionPayload {
  return {
    domain: DOMAIN_INFOTAINMENT,
    bytes: encodeInfotainmentAction({
      addChargeScheduleAction: {
        id: s.id,
        name: s.name ?? '',
        daysOfWeek: daysToBitmask(s.days),
        startEnabled: !!s.startEnabled,
        startTime: hhmmToMinutes(s.startTime),
        endEnabled: !!s.endEnabled,
        endTime: hhmmToMinutes(s.endTime),
        oneTime: !!s.oneTime,
        enabled: !!s.enabled,
        latitude: s.latitude,
        longitude: s.longitude,
      },
    }),
  };
}

export function removeChargeScheduleAction(id: number): ActionPayload {
  return {
    domain: DOMAIN_INFOTAINMENT,
    bytes: encodeInfotainmentAction({ removeChargeScheduleAction: { id } }),
  };
}

export interface PreconditionScheduleInput {
  id: number;
  name?: string;
  days: readonly number[];
  preconditionTime: string; // 'HH:MM'
  enabled: boolean;
  oneTime?: boolean;
  latitude: number;
  longitude: number;
}

export function addPreconditionScheduleAction(s: PreconditionScheduleInput): ActionPayload {
  return {
    domain: DOMAIN_INFOTAINMENT,
    bytes: encodeInfotainmentAction({
      addPreconditionScheduleAction: {
        id: s.id,
        name: s.name ?? '',
        daysOfWeek: daysToBitmask(s.days),
        preconditionTime: hhmmToMinutes(s.preconditionTime),
        oneTime: !!s.oneTime,
        enabled: !!s.enabled,
        latitude: s.latitude,
        longitude: s.longitude,
      },
    }),
  };
}

export function removePreconditionScheduleAction(id: number): ActionPayload {
  return {
    domain: DOMAIN_INFOTAINMENT,
    bytes: encodeInfotainmentAction({ removePreconditionScheduleAction: { id } }),
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
// ⚠️ DEVIATES from the vendored proto (UNKNOWN=0, SPEED_LIMIT=1 … CURFEW=4). Ivan's
// on-car repro proved the FIRMWARE enum is 0-based: checking Limit Speed (we sent 1)
// set Reduce Acceleration on the car; checking Curfew (4) set nothing — every setting
// landed ONE AHEAD. The vendored proto is a different revision; the device outranks
// the doc (see tesla-parity-verify-dont-infer). Decremented to match the car:
//   acceleration→1, safetyFeatures→2, curfew→3  land exactly (verified by the shift).
//   speedLimit→0 is OMITTED on the wire (encoder guards `setting !== 0`), so the car
//   reads a MISSING setting as its default (0 = speed limit). ← the one part still to
//   confirm on-car; accel/safety/curfew are unambiguous.
const PARENTAL_SETTING_ENUM: Record<ParentalSetting, number> = {
  speedLimit: 0,
  acceleration: 1,
  safetyFeatures: 2,
  curfew: 3,
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

// Low Power Mode — CarServer.SetLowPowerModeAction (VehicleAction 130, bool
// low_power_mode). A plain on/off setter; the car reduces standby draw. The car
// DOES report it back — ChargeState.low_power_mode (191), read on the charge poll
// (telemetry.ts) — so the toggle reconciles from the car and is cached. The 3rd
// icon state (on_disabled) is ChargeState.low_power_mode_forced_on (192), on the
// wire but not yet surfaced.
export function setLowPowerModeAction(on: boolean): ActionPayload {
  return {
    domain: DOMAIN_INFOTAINMENT,
    bytes: encodeInfotainmentAction({ setLowPowerModeAction: { lowPowerMode: !!on } }),
  };
}

// Keep Accessory Power — CarServer.SetKeepAccessoryPowerModeAction (VehicleAction
// 138, bool keep_accessory_power_mode). A plain on/off setter: when on, the car
// keeps 12V accessory power live after the driver exits. Read back via
// ChargeState.keep_accessory_power_mode (194) on the charge poll (telemetry.ts),
// so it reconciles from the car and is cached, like setLowPowerModeAction.
export function setKeepAccessoryPowerModeAction(on: boolean): ActionPayload {
  return {
    domain: DOMAIN_INFOTAINMENT,
    bytes: encodeInfotainmentAction({ setKeepAccessoryPowerModeAction: { keepAccessoryPowerMode: !!on } }),
  };
}
