// telemetry.ts — decoded VCSEC/CarServer protobuf -> normalized snapshot -> VehicleViewState patch.
//
// Ported from the browser reference (rpi-webclient/client/state.js `applyVcsecStatus` ~162 and
// `applyCarServerResponse` ~214), but pure: no localStorage, no dirty-tracking, no side effects —
// just (decoded message) -> (normalized snapshot) and (normalized snapshot) -> (Partial<VehicleViewState>).
// The caller (P3 useCarLink) owns merging the patch into the active vehicle's state and persisting
// closureIntent across calls.
//
// Zero React/Expo/network imports, no hardware — pure TS.

import type {
  ClimateKeeperMode,
  CabinOverheatMode,
  CabinOverheatTemp,
  SeatClimateMode,
  SeatPosition,
  SteeringWheelClimateModeName,
  VehicleViewState,
} from '../types/vehicleTypes';
import { initialVehicleState } from '../types/vehicleTypes';
import { copMode, copTemp, keeperMode, resolveSeat, resolveSteeringWheel } from './climateStateMap';

// ── Normalized types (Part 4 shape) ────────────────────────────────────────

export type LockState = 'locked' | 'unlocked' | 'internal_locked' | 'selective_unlocked' | 'unknown';
export type SleepStatus = 'awake' | 'asleep' | 'unknown';
export type PresenceState = 'present' | 'not_present' | 'unknown';
export type ClosureFieldState = 'open' | 'closed' | 'ajar' | 'opening' | 'closing' | 'unknown';

export type ClosureFieldName =
  | 'frontDriverDoor'
  | 'frontPassengerDoor'
  | 'rearDriverDoor'
  | 'rearPassengerDoor'
  | 'rearTrunk'
  | 'frontTrunk'
  | 'chargePort'
  | 'tonneau';

export interface VcsecStatus {
  lockState: LockState;
  sleepStatus: SleepStatus;
  userPresence: PresenceState;
  closures: Partial<Record<ClosureFieldName, ClosureFieldState>>;
}

export interface InfotainmentSnapshot {
  charge?: {
    cableAttached?: boolean;
    // Charge-panel detail. All null when the car does not report them, which is
    // normal when unplugged — the panel hides those lines rather than showing 0.
    minutesToChargeLimit?: number | null;
    chargerPowerKw?: number | null;
    energyAddedKwh?: number | null;
    chargeRateMph?: number | null;
    /**
     * DC / Supercharger, from ChargeState.fast_charger_present.
     *
     * Gates the amperage control: their `showAmps` is
     *   apiVersion >= MIN_SET_CHARGE_AMPS_CAR_API_VERSION
     *     && !vehicleIsSemi && fastcharging !== true
     *     && !showPowershareDischargingContent
     * so the stepper is HIDDEN on DC, where the current is not ours to set.
     */
    fastCharging?: boolean;
    /** Live delivery, for the charging status row: "16A · 230V". */
    chargerActualCurrentA?: number | null;
    chargerVoltageV?: number | null;
    /** getNominalChargeCurrent = charger_pilot_current — the "/32" in "16/32A". */
    chargerPilotCurrentA?: number | null;
    soc: number | undefined;
    rangeMiles: number | null;
    chargingState: string | undefined;
    chargeLimitSoc: number | undefined;
    // Saved Home/Work locations (ChargeState.home_location/work_location). Present
    // only when the car reports them; used to name the Set Schedules dropdown.
    homeCoord?: { lat: number; lon: number } | null;
    workCoord?: { lat: number; lon: number } | null;
  };
  climate?: {
    insideTempC: number | undefined;
    outsideTempC: number | undefined;
    targetTempC: number | undefined;
    isOn: boolean;
    frontDefrostOn: boolean | undefined;
    rearDefrostOn: boolean | undefined;
    cabinOverheatMode: CabinOverheatMode | undefined;
    copActivelyCooling: boolean | undefined;
    cabinOverheatTemp: CabinOverheatTemp | undefined;
    keeper: ClimateKeeperMode | undefined;
    bioweaponOn: boolean | undefined;
    steeringWheel: { mode: SteeringWheelClimateModeName; level: 0 | 1 | 2 } | undefined;
    seats: Partial<Record<SeatPosition, SeatClimateMode>> | undefined;
  };
  drive?: {
    speed: number | null;
    gear: string;
    odometerMiles: number | null;
    powerKw: number | null;
  };
  // The car's active navigation route, when it has one. Every field describes the
  // CURRENT SEGMENT — the next stop — not the final destination (RESPONSE-19 Q1).
  route?: {
    destination: string | null;
    minutesToArrival: number | null;
    milesToArrival: number | null;
    coordinates: { lat: number; lon: number } | null;
  };
  location?: {
    lat: number | undefined;
    lon: number | undefined;
    heading: number | undefined;
    /**
     * LocationState.gps_as_of — the CAR's own fix time, Unix SECONDS.
     *
     * This is what "we last saw the car here" should mean. Falling back to our
     * read time would date the pin to whenever the phone happened to poll,
     * which on a sleeping car can be long after the car actually stopped there.
     */
    gpsAsOfSec: number | undefined;
  };
  // TPMS. Values are BAR — the proto says so twice ("tpms pressure values in
  // bar", "rcp values in bar") and the car agrees with its own placard, so
  // nothing is converted on the way through.
  tires?: {
    fl: number | null;
    fr: number | null;
    rl: number | null;
    rr: number | null;
    // Recommended COLD pressure, front and rear, straight from the car (fields
    // 18/19). This is the placard value — never hardcode it per model.
    rcpFront: number | null;
    rcpRear: number | null;
    // A wheel is "warned" if the car raised either flag for it. Hard and soft
    // are kept separate because they mean different things: soft is "check it",
    // hard is "it is unsafe".
    hardWarning: { fl: boolean; fr: boolean; rl: boolean; rr: boolean };
    softWarning: { fl: boolean; fr: boolean; rl: boolean; rr: boolean };
  };
  // Now playing, in TWO slices because it takes two reads: the 452-byte cap
  // allows one submessage per request, and the fields a now-playing line needs
  // are split across MediaState (15) and MediaDetailState (16).
  //
  // They are kept as DISTINCT sub-keys deliberately. `awakeSync` merges its
  // per-read slices with a shallow spread that is safe "only because each read
  // writes a DISTINCT sub-key" — one shared `media` key would have the second
  // read clobber the first with its own absent fields.
  media?: {
    // The car's own opinion on whether it will accept transport commands.
    // undefined = not read yet, which is NOT the same as false.
    remoteControlEnabled: boolean | undefined;
    title: string | null;
    artist: string | null;
    // MediaPlaybackStatus: 0 Stopped, 1 Playing, 2 Paused. Kept as the raw enum
    // rather than a bare `playing` boolean — "stopped" and "paused" render
    // differently and collapsing them loses that.
    playbackStatus: number | undefined;
    sourceType: number | undefined;
    volume: number | null;
    volumeMax: number | null;
    volumeIncrement: number | null;
  };
  mediaDetail?: {
    album: string | null;
    station: string | null;
    sourceName: string | null;
    elapsedSec: number | null;
    durationSec: number | null;
  };
  closures?: {
    sentryOn: boolean | undefined;
    windows: Partial<Record<'leftFront' | 'rightFront' | 'leftRear' | 'rightRear', boolean>>;
    userPresent?: boolean | undefined;
    centerDisplay?: string | undefined;
    locked?: boolean | undefined;
    valetMode?: boolean | undefined;
    speedLimitMode?: boolean | undefined;
  };
  // Schedule readback — the raw entries the car holds, for the write-path truth
  // check. Kept verbatim (daysOfWeek is the car's own bitmask; start/end are
  // minutes) rather than mapped, so the diagnostic shows exactly what is stored.
  chargeSchedules?: RawSchedule[];
  preconditionSchedules?: RawSchedule[];
}

export interface RawSchedule {
  id: number | undefined;
  daysOfWeek: number | undefined;
  startEnabled?: boolean | undefined;
  startTime?: number | undefined;
  endEnabled?: boolean | undefined;
  endTime?: number | undefined;
  preconditionTime?: number | undefined;
  enabled: boolean | undefined;
  oneTime: boolean | undefined;
  latitude?: number | undefined;
  longitude?: number | undefined;
}

// Grace window for optimistic closure intent (mirrors state.js CLOSURE_INTENT_GRACE_MS ~line 89).
// The VCSEC Hall sensor can lag; within this window a fresh VCSEC read that contradicts a closure
// command we just issued is ignored so the UI doesn't flip-flop back to the pre-command value.
export const CLOSURE_INTENT_GRACE_MS = 30_000;

// ── Enum int -> name tables (source of truth: proto/vcsec.proto) ──────────
//
// The build pipeline generates the decoder with `pbjs --force-number`, so decoded enum fields
// always arrive as plain JS numbers, indexed exactly as declared in the .proto (proto3 enums start
// at 0 and are contiguous here) — a straight array works as the lookup table, same trick the
// reference uses for _LOCK_NAMES/_SLEEP_NAMES/_PRESENCE_NAMES/_CLOSURE_NAMES.

// VehicleLockState_E: 0 UNLOCKED, 1 LOCKED, 2 INTERNAL_LOCKED, 3 SELECTIVE_UNLOCKED
const LOCK_NAMES: readonly LockState[] = ['unlocked', 'locked', 'internal_locked', 'selective_unlocked'];
// VehicleSleepStatus_E: 0 UNKNOWN, 1 AWAKE, 2 ASLEEP
const SLEEP_NAMES: readonly SleepStatus[] = ['unknown', 'awake', 'asleep'];
// UserPresence_E: 0 UNKNOWN, 1 NOT_PRESENT, 2 PRESENT
const PRESENCE_NAMES: readonly PresenceState[] = ['unknown', 'not_present', 'present'];
// ClosureState_E: 0 CLOSED, 1 OPEN, 2 AJAR, 3 UNKNOWN, 4 FAILED_UNLATCH, 5 OPENING, 6 CLOSING.
// FAILED_UNLATCH (4) has no home in ClosureFieldState (the mapping rules only define
// open/closed/ajar/opening/closing/unknown) — normalize it to 'unknown' rather than inventing a
// 7th state, so callers only ever see the documented union and unknown/missing always omits the
// mapped boolean instead of guessing.
const CLOSURE_NAMES: readonly ClosureFieldState[] = [
  'closed',
  'open',
  'ajar',
  'unknown',
  'unknown',
  'opening',
  'closing',
];

const CLOSURE_FIELDS: readonly ClosureFieldName[] = [
  'frontDriverDoor',
  'frontPassengerDoor',
  'rearDriverDoor',
  'rearPassengerDoor',
  'rearTrunk',
  'frontTrunk',
  'chargePort',
  'tonneau',
];

// ── Small tolerant-decode helpers ──────────────────────────────────────────

function isRecord(v: unknown): v is Record<string, unknown> {
  return typeof v === 'object' && v !== null;
}

function num(v: unknown): number | undefined {
  return typeof v === 'number' && Number.isFinite(v) ? v : undefined;
}

// A CarServer.LatLong ({ latitude, longitude }) → our lean { lat, lon }, or null
// when either coordinate is missing/non-finite.
function latLong(v: unknown): { lat: number; lon: number } | null {
  const o = v as { latitude?: unknown; longitude?: unknown } | null | undefined;
  const lat = num(o?.latitude);
  const lon = num(o?.longitude);
  return lat !== undefined && lon !== undefined ? { lat, lon } : null;
}

// str — a non-empty string, else undefined. Empty strings are the proto default for
// an unset string field, so they mean "absent", not "".
function str(v: unknown): string | undefined {
  return typeof v === 'string' && v.length > 0 ? v : undefined;
}

// enumName ports the reference's _enumName: numbers index straight into the table (the normal
// decode path with --force-number); a string is accepted too (defensive — some decode paths or
// hand-built test fixtures may already carry the resolved name) and matched case-insensitively
// against the table's own values. Anything null/undefined/out-of-range/unrecognized -> 'unknown',
// never a guess.
function enumName<T extends string>(val: unknown, table: readonly T[]): T | 'unknown' {
  if (val == null) return 'unknown';
  if (typeof val === 'number') {
    return table[val] ?? 'unknown';
  }
  if (typeof val === 'string') {
    const lower = val.toLowerCase();
    return (table as readonly string[]).includes(lower) ? (lower as T) : 'unknown';
  }
  return 'unknown';
}

// oneofName ports the reference's _oneofName: protobuf.js decodes `oneof type { Void Charging = 5; ... }`
// as either a single-key object ({ Charging: {} }) or, depending on decode options / hand-built
// fixtures, a plain string. Both normalize to the plain case name.
function oneofName(val: unknown): string | undefined {
  if (val == null) return undefined;
  if (typeof val === 'string') return val;
  if (isRecord(val)) {
    const keys = Object.keys(val);
    return keys.length > 0 ? keys[0] : undefined;
  }
  return undefined;
}

// pick reads a sub-message off either `vehicleData.<key>` (a full GetVehicleData response) or the
// top-level `<key>` (a single-field read's Response) — mirrors the reference's
// `carResp.vehicleData?.chargeState || carResp.chargeState` tolerance.
function pick(
  vehicleData: Record<string, unknown> | undefined,
  root: Record<string, unknown>,
  key: string,
): Record<string, unknown> | undefined {
  const v = vehicleData?.[key] ?? root[key];
  return isRecord(v) ? v : undefined;
}

// ── Normalizers ─────────────────────────────────────────────────────────────

// parseVcsecStatus normalizes a decoded VCSEC.VehicleStatus into a VcsecStatus. Tolerant of a
// missing/malformed input and of missing sub-fields on closureStatuses.
export function parseVcsecStatus(vehicleStatus: unknown): VcsecStatus {
  const vs = isRecord(vehicleStatus) ? vehicleStatus : {};

  const lockState = enumName(vs.vehicleLockState, LOCK_NAMES);
  const sleepStatus = enumName(vs.vehicleSleepStatus, SLEEP_NAMES);
  const userPresence = enumName(vs.userPresence, PRESENCE_NAMES);

  const closures: Partial<Record<ClosureFieldName, ClosureFieldState>> = {};
  const cs = vs.closureStatuses;
  if (isRecord(cs)) {
    for (const field of CLOSURE_FIELDS) {
      closures[field] = enumName(cs[field], CLOSURE_NAMES);
    }
  }

  return { lockState, sleepStatus, userPresence, closures };
}

// parseCarServerResponse normalizes a decoded CarServer.Response into an InfotainmentSnapshot.
// Each slice (charge/climate/drive/location/closures) is only populated if its source sub-message
// is present; everything else is tolerant of missing sub-fields (falls back to a safe default
// value that infotainmentToPatch guards against re-emitting where it would be misleading).
export function parseCarServerResponse(carResp: unknown): InfotainmentSnapshot {
  const root = isRecord(carResp) ? carResp : {};
  const vehicleData = isRecord(root.vehicleData) ? root.vehicleData : undefined;
  const snap: InfotainmentSnapshot = {};

  // proto3 explicit-optional ("synthetic optional") fields can be absent even when their parent
  // sub-message is present, and the reference (`_applySliceFromSync`) gates EVERY field write on
  // `v !== undefined` before writing. We mirror that here by carrying `undefined` straight through
  // (via `num`/`oneofName`, neither of which fabricates a default) instead of coalescing to 0/''/
  // false — infotainmentToPatch then only emits a VehicleViewState key when the value survived as
  // non-undefined, so an absent field is OMITTED rather than reported as a fake real-looking value.
  const cs = pick(vehicleData, root, 'chargeState');
  if (cs) {
    const batteryRange = num(cs.batteryRange);
    snap.charge = {
      soc: num(cs.batteryLevel),
      // The charge panel's own fields. `minutesToChargeLimit` is the one the
      // panel shows — time to the LIMIT the user set, not to 100% — so it is
      // preferred and minutesToFullCharge is the fallback for a car that only
      // reports the latter.
      minutesToChargeLimit: num(cs.minutesToChargeLimit) ?? num(cs.minutesToFullCharge) ?? null,
      chargerPowerKw: num(cs.chargerPower) ?? null,
      // kWh put in during the LAST session — their panel's second line.
      energyAddedKwh: num(cs.chargeEnergyAdded) ?? null,
      chargeRateMph: num(cs.chargeRateMph) ?? null,
      // RAW miles: `battery_range` is already in miles and the official app converts
      // at display time (Round 5 §2a). Rounding to km here would compound error.
      rangeMiles: batteryRange ?? null,
      chargingState: oneofName(cs.chargingState),
      // Is a cable in the port? This was NEVER populated — `cableAttached` only
      // ever came from the demo toggle, so on a real car it was permanently
      // false and every control gated on it was invisible. Two signals, and
      // either is enough:
      //   conn_charge_cable — the cable TYPE oneof, present only when connected
      //                       (its SNA member means "not applicable");
      //   charging_state    — anything other than Disconnected implies a cable.
      cableAttached: (() => {
        const cable = oneofName(cs.connChargeCable);
        if (cable && cable.toLowerCase() !== 'sna') return true;
        const st = (oneofName(cs.chargingState) ?? '').toLowerCase();
        return st !== '' && st !== 'disconnected' && st !== 'unknown';
      })(),
      // DC/Supercharger. The field is in the proto and we simply never read it,
      // which is why our amp stepper stayed visible while Supercharging.
      fastCharging: cs.fastChargerPresent === true,
      chargerActualCurrentA: num(cs.chargerActualCurrent) ?? null,
      chargerVoltageV: num(cs.chargerVoltage) ?? null,
      chargerPilotCurrentA: num(cs.chargerPilotCurrent) ?? null,
      chargeLimitSoc: num(cs.chargeLimitSoc),
      homeCoord: latLong(cs.homeLocation),
      workCoord: latLong(cs.workLocation),
    };
  }

  const cl = pick(vehicleData, root, 'climateState');
  if (cl) {
    // Per-seat: combine the three separate proto fields (heat / cool / auto),
    // front seats only for cool+auto. Only positions the car actually reported
    // appear; the rest keep their existing state (see the apply block).
    const seats: Partial<Record<SeatPosition, SeatClimateMode>> = {};
    const setSeat = (pos: SeatPosition, heat: unknown, cool?: unknown, auto?: unknown) => {
      const r = resolveSeat(heat, cool, auto);
      if (r) seats[pos] = r;
    };
    setSeat('frontLeft', cl.seatHeaterLeft, cl.seatFanFrontLeft, cl.autoSeatClimateLeft);
    setSeat('frontRight', cl.seatHeaterRight, cl.seatFanFrontRight, cl.autoSeatClimateRight);
    setSeat('rearLeft', cl.seatHeaterRearLeft);
    setSeat('rearMiddle', cl.seatHeaterRearCenter);
    setSeat('rearRight', cl.seatHeaterRearRight);
    setSeat('thirdRowLeft', cl.seatHeaterThirdRowLeft);
    setSeat('thirdRowRight', cl.seatHeaterThirdRowRight);

    snap.climate = {
      insideTempC: num(cl.insideTempCelsius),
      outsideTempC: num(cl.outsideTempCelsius),
      targetTempC: num(cl.driverTempSetting),
      // `isClimateOn || isPreconditioning`, both arms — Tesla's own fallback
      // (@1228557). A car that is preconditioning IS running its climate; reading
      // only the first flag showed the system off while it was demonstrably
      // heating the cabin.
      isOn: cl.isClimateOn === true || cl.isPreconditioning === true,
      frontDefrostOn: typeof cl.isFrontDefrosterOn === 'boolean' ? cl.isFrontDefrosterOn : undefined,
      rearDefrostOn: typeof cl.isRearDefrosterOn === 'boolean' ? cl.isRearDefrosterOn : undefined,
      cabinOverheatMode: copMode(cl.cabinOverheatProtection),
      copActivelyCooling:
        typeof cl.cabinOverheatProtectionActivelyCooling === 'boolean'
          ? cl.cabinOverheatProtectionActivelyCooling
          : undefined,
      cabinOverheatTemp: copTemp(cl.copActivationTemperature),
      keeper: keeperMode(cl.climateKeeperMode),
      // Bioweapon was WRITE-ONLY: we sent the command and then believed our own
      // optimistic value forever, because nothing ever read it back. The field
      // was on the proto the whole time. Tesla reads it (their view-model's
      // `bioWeaponMode`, @5221469) and lights the row from the car, not from the
      // last tap.
      bioweaponOn: typeof cl.bioweaponModeOn === 'boolean' ? cl.bioweaponModeOn : undefined,
      steeringWheel: resolveSteeringWheel(
        cl.autoSteeringWheelHeat,
        cl.steeringWheelHeatLevel,
        cl.steeringWheelHeater,
      ),
      seats: Object.keys(seats).length ? seats : undefined,
    };
  }

  const dr = pick(vehicleData, root, 'driveState');
  if (dr) {
    // RESPONSE-15 Tier 1: odometer / power / active-route were ALREADY arriving in
    // this message and being discarded — no new request, no extra bytes on the wire.
    // NB the proto carries both a plain and an `optional*` variant of several
    // fields (the car sets one or the other depending on firmware); read either.
    const odoHundredths =
      num(dr.odometerInHundredthsOfAMile) ?? num(dr.optionalOdometerInHundredthsOfAMile);
    snap.drive = {
      speed: num(dr.speed) ?? num(dr.optionalSpeed) ?? null,
      gear: oneofName(dr.shiftState) ?? 'unknown',
      // Hundredths of a mile → miles. Keep the raw precision; format at the edge.
      odometerMiles: odoHundredths !== undefined ? odoHundredths / 100 : null,
      // Instantaneous power: positive = drawing (driving), negative = regen.
      powerKw: num(dr.power) ?? num(dr.optionalPower) ?? null,
    };
    const dest = str(dr.activeRouteDestination) ?? str(dr.optionalActiveRouteDestination);
    const mins = num(dr.activeRouteMinutesToArrival) ?? num(dr.optionalActiveRouteMinutesToArrival);
    const miles = num(dr.activeRouteMilesToArrival) ?? num(dr.optionalActiveRouteMilesToArrival);
    // activeRouteCoordinates is the NEXT stop's lat/lon (RESPONSE-19 Q1: every
    // active-route field describes the current segment, not the final destination).
    // The name is a car-side reverse-geocode we can't predict, but the coordinate
    // is one we CAN compare against what we sent — which is the only way to tell
    // "the car appended our stop" from "the car replaced the route with it".
    // That comparison is the whole discriminator in the NAV-P1 order probe.
    const coordRaw = dr.activeRouteCoordinates as { latitude?: number; longitude?: number } | undefined;
    const coordLat = num(coordRaw?.latitude);
    const coordLon = num(coordRaw?.longitude);
    const coordinates =
      coordLat !== undefined && coordLon !== undefined ? { lat: coordLat, lon: coordLon } : null;
    // Only emit a route when the car actually has one — an empty destination with
    // zeroed ETA is "no navigation", not "0 minutes away".
    if (dest || mins !== undefined || miles !== undefined || coordinates) {
      snap.route = {
        destination: dest ?? null,
        minutesToArrival: mins ?? null,
        milesToArrival: miles ?? null,
        coordinates,
      };
    }
  }

  // `mediaStr` maps absent AND empty-string to null: the car sends "" for a
  // field it has no value for (no artist on a radio station), and an empty
  // line renders worse than no line.
  const mediaStr = (v: unknown): string | null =>
    typeof v === 'string' && v.length > 0 ? v : null;
  const mediaNum = (v: unknown): number | null => num(v) ?? null;

  const ms = pick(vehicleData, root, 'mediaState');
  if (ms) {
    snap.media = {
      remoteControlEnabled:
        typeof ms.remoteControlEnabled === 'boolean' ? ms.remoteControlEnabled : undefined,
      title: mediaStr(ms.nowPlayingTitle),
      artist: mediaStr(ms.nowPlayingArtist),
      playbackStatus: num(ms.mediaPlaybackStatus),
      sourceType: num(ms.nowPlayingSource),
      volume: mediaNum(ms.audioVolume),
      volumeMax: mediaNum(ms.audioVolumeMax),
      volumeIncrement: mediaNum(ms.audioVolumeIncrement),
    };
  }

  const md = pick(vehicleData, root, 'mediaDetailState');
  if (md) {
    snap.mediaDetail = {
      album: mediaStr(md.nowPlayingAlbum),
      station: mediaStr(md.nowPlayingStation),
      // a2dp_source_name is the paired PHONE's name when the source is
      // Bluetooth; now_playing_source_string is the car's own label. Prefer the
      // label, fall back to the device.
      sourceName: mediaStr(md.nowPlayingSourceString) ?? mediaStr(md.a2dpSourceName),
      elapsedSec: mediaNum(md.nowPlayingElapsed),
      durationSec: mediaNum(md.nowPlayingDuration),
    };
  }

  const tp = pick(vehicleData, root, 'tirePressureState');
  if (tp) {
    // proto3 `optional` (synthetic oneof): a wheel whose sensor has not reported
    // is ABSENT, not zero. num() carries undefined through as null so the UI can
    // show "—" rather than a confident 0.0 bar on a wheel we know nothing about.
    const flag = (v: unknown): boolean => v === true;
    // num() carries undefined through (deliberately — see the header note on
    // synthetic optionals); this slice models "no reading" as null, so pin it.
    const bar = (v: unknown): number | null => num(v) ?? null;
    snap.tires = {
      fl: bar(tp.tpmsPressureFl),
      fr: bar(tp.tpmsPressureFr),
      rl: bar(tp.tpmsPressureRl),
      rr: bar(tp.tpmsPressureRr),
      rcpFront: bar(tp.tpmsRcpFrontValue),
      rcpRear: bar(tp.tpmsRcpRearValue),
      hardWarning: {
        fl: flag(tp.tpmsHardWarningFl),
        fr: flag(tp.tpmsHardWarningFr),
        rl: flag(tp.tpmsHardWarningRl),
        rr: flag(tp.tpmsHardWarningRr),
      },
      softWarning: {
        fl: flag(tp.tpmsSoftWarningFl),
        fr: flag(tp.tpmsSoftWarningFr),
        rl: flag(tp.tpmsSoftWarningRl),
        rr: flag(tp.tpmsSoftWarningRr),
      },
    };
  }

  const loc = pick(vehicleData, root, 'locationState');
  if (loc) {
    snap.location = {
      lat: num(loc.latitude),
      lon: num(loc.longitude),
      heading: num(loc.heading),
      gpsAsOfSec: num(loc.gpsAsOf),
    };
  }

  const cls = pick(vehicleData, root, 'closuresState');
  if (cls) {
    // sentryModeState is only set on sentry-capable cars (proto comment: "only set when sentry
    // mode supported"). The reference gates on `if (cls.sentryModeState)` — mirror that: absent ->
    // sentryOn stays undefined (omitted downstream), present -> derive on/off from the mode name.
    const sentryMode = oneofName(cls.sentryModeState);
    const windows: NonNullable<InfotainmentSnapshot['closures']>['windows'] = {};
    if (typeof cls.windowOpenDriverFront === 'boolean') windows.leftFront = cls.windowOpenDriverFront;
    if (typeof cls.windowOpenPassengerFront === 'boolean') windows.rightFront = cls.windowOpenPassengerFront;
    if (typeof cls.windowOpenDriverRear === 'boolean') windows.leftRear = cls.windowOpenDriverRear;
    if (typeof cls.windowOpenPassengerRear === 'boolean') windows.rightRear = cls.windowOpenPassengerRear;

    snap.closures = {
      sentryOn: sentryMode !== undefined ? sentryMode !== 'Off' : undefined,
      windows,
      // RESPONSE-15 Tier 1: also already on the wire and previously discarded.
      // isUserPresent + centerDisplayState are the car's own "someone is in it /
      // the screen is up" signals — the inputs a Driving status needs (REQUEST-17).
      userPresent: typeof cls.isUserPresent === 'boolean' ? cls.isUserPresent : undefined,
      centerDisplay: oneofName(cls.centerDisplayState),
      locked: typeof cls.locked === 'boolean' ? cls.locked : undefined,
      valetMode: typeof cls.valetMode === 'boolean' ? cls.valetMode : undefined,
      speedLimitMode: typeof cls.speedLimitMode === 'boolean' ? cls.speedLimitMode : undefined,
    };
  }

  const bool = (v: unknown): boolean | undefined => (typeof v === 'boolean' ? v : undefined);
  // The schedule `id` is a 64-bit field, so protobufjs hands it back as a Long
  // object (or a plain number when small) — `num()` alone drops the Long to
  // undefined. Coerce via its string form (exact up to 2^53, and our carId is
  // ~1.75e15, well under), so the readback shows the id the car actually kept.
  const num64 = (v: unknown): number | undefined => {
    if (typeof v === 'number') return v;
    if (v && typeof (v as { toString?: unknown }).toString === 'function') {
      const n = Number((v as { toString: () => string }).toString());
      return Number.isFinite(n) ? n : undefined;
    }
    return undefined;
  };
  const css = pick(vehicleData, root, 'chargeScheduleState');
  if (css && Array.isArray(css.chargeSchedules)) {
    snap.chargeSchedules = (css.chargeSchedules as Record<string, unknown>[]).map((r) => ({
      id: num64(r.id),
      daysOfWeek: num(r.daysOfWeek),
      startEnabled: bool(r.startEnabled),
      startTime: num(r.startTime),
      endEnabled: bool(r.endEnabled),
      endTime: num(r.endTime),
      enabled: bool(r.enabled),
      oneTime: bool(r.oneTime),
      latitude: num(r.latitude),
      longitude: num(r.longitude),
    }));
  }
  const pss = pick(vehicleData, root, 'preconditioningScheduleState');
  if (pss && Array.isArray(pss.preconditionSchedules)) {
    snap.preconditionSchedules = (pss.preconditionSchedules as Record<string, unknown>[]).map((r) => ({
      id: num64(r.id),
      daysOfWeek: num(r.daysOfWeek),
      preconditionTime: num(r.preconditionTime),
      enabled: bool(r.enabled),
      oneTime: bool(r.oneTime),
      latitude: num(r.latitude),
      longitude: num(r.longitude),
    }));
  }

  return snap;
}

// ── Mappers: normalized -> Partial<VehicleViewState> patch ─────────────────

type ClosureViewKey =
  | 'driverFrontDoorOpen'
  | 'passengerFrontDoorOpen'
  | 'driverRearDoorOpen'
  | 'passengerRearDoorOpen'
  | 'trunkOpen'
  | 'frunkOpen'
  | 'chargePortOpen';

// tonneau intentionally omitted -- no matching VehicleViewState field.
const CLOSURE_FIELD_TO_VIEW_KEY: Partial<Record<ClosureFieldName, ClosureViewKey>> = {
  frontDriverDoor: 'driverFrontDoorOpen',
  frontPassengerDoor: 'passengerFrontDoorOpen',
  rearDriverDoor: 'driverRearDoorOpen',
  rearPassengerDoor: 'passengerRearDoorOpen',
  rearTrunk: 'trunkOpen',
  frontTrunk: 'frunkOpen',
  chargePort: 'chargePortOpen',
};

// vcsecStatusToPatch maps a normalized VcsecStatus onto a Partial<VehicleViewState>, honoring the
// closure-intent grace window. closureIntent is field-name -> intent-expiry-ms, keyed by the SAME
// ClosureFieldName as VcsecStatus.closures (not the VehicleViewState key) so callers can stamp it
// straight from whatever they optimistically wrote. Returns the surviving intent map: entries
// whose grace has not yet expired are carried forward untouched; everything else is dropped
// (either because it was reconciled just now, or because it never existed).
export function vcsecStatusToPatch(
  status: VcsecStatus,
  closureIntent: Record<string, number>,
  now: number,
): { patch: Partial<VehicleViewState>; closureIntent: Record<string, number> } {
  const patch: Partial<VehicleViewState> = {};

  if (status.lockState === 'locked' || status.lockState === 'internal_locked') {
    patch.locked = true;
  } else if (status.lockState === 'unlocked' || status.lockState === 'selective_unlocked') {
    patch.locked = false;
  } // 'unknown' -> omitted

  if (status.sleepStatus === 'awake') {
    patch.awake = true;
  } else if (status.sleepStatus === 'asleep') {
    patch.awake = false;
  } // 'unknown' -> omitted

  // Carry forward every still-valid intent entry up front, not just the ones keyed by the 7-key
  // view map below — `closureIntent` can hold keys with no VehicleViewState field (e.g. 'tonneau')
  // or any other ClosureFieldName, and those must survive too rather than being silently dropped
  // just because the view-key loop never visits them.
  const newIntent: Record<string, number> = {};
  for (const [field, expiresAt] of Object.entries(closureIntent)) {
    if (expiresAt > now) newIntent[field] = expiresAt;
  }

  for (const [field, viewKey] of Object.entries(CLOSURE_FIELD_TO_VIEW_KEY) as [ClosureFieldName, ClosureViewKey][]) {
    const expiresAt = closureIntent[field];
    if (expiresAt !== undefined && expiresAt > now) {
      // Optimistic write still within its grace window (already carried forward above): keep the
      // UI's current value and do NOT let this VCSEC read overwrite it.
      continue;
    }

    const closureState = status.closures[field];
    if (closureState === undefined || closureState === 'unknown') continue; // omit, intent already dropped

    if (closureState === 'open' || closureState === 'ajar' || closureState === 'opening') {
      patch[viewKey] = true;
    } else if (closureState === 'closed' || closureState === 'closing') {
      patch[viewKey] = false;
    }
  }

  // ABSENT closureStatuses ⟺ every closure is CLOSED. [verified on-car 2026-07-18]
  // The car includes closureStatuses ONLY when at least one closure is open, and
  // when it does it lists ALL of them; the moment everything is shut it omits the
  // sub-message entirely (both in unsolicited pushes AND solicited GET_STATUS
  // reads — a read went empty the instant the frunk closed). So an EMPTY closures
  // map is a POSITIVE "all closed" signal, not "unknown" — this is what makes a
  // CLOSE reflect instantly (its push carries no closureStatuses) and clears any
  // stale-open closure on a settled read. Respects intent grace per field.
  if (Object.keys(status.closures).length === 0) {
    for (const [field, viewKey] of Object.entries(CLOSURE_FIELD_TO_VIEW_KEY) as [
      ClosureFieldName,
      ClosureViewKey,
    ][]) {
      const expiresAt = closureIntent[field];
      if (expiresAt !== undefined && expiresAt > now) continue;
      patch[viewKey] = false;
    }
  }

  return { patch, closureIntent: newIntent };
}

// Gears that count as "the car is moving" for the Godot wheel-spin path. 'P'/'Invalid'/'SNA'/
// absent all fall through to false.
const DRIVING_GEARS = new Set(['D', 'R', 'N']);

// infotainmentToPatch maps a normalized InfotainmentSnapshot onto a Partial<VehicleViewState>.
// Each slice's fields are only emitted if that slice was present in the snapshot (i.e. the source
// sub-message was present in the decoded response) — a missing slice contributes nothing, giving
// callers a genuinely partial patch to merge.
export function infotainmentToPatch(
  snap: InfotainmentSnapshot,
  now: number = Date.now(),
): Partial<VehicleViewState> {
  const patch: Partial<VehicleViewState> = {};

  if (snap.charge) {
    // soc/chargingState are proto3 explicit-optional: `undefined` means the sub-field was absent
    // from this particular read (e.g. a chargingState-only push), not that the value is really 0/
    // unknown. Only emit when the underlying field was actually present — 0 is still emitted when
    // it's a genuinely reported value (soc !== undefined includes soc === 0).
    if (snap.charge.soc !== undefined) patch.batteryLevel = snap.charge.soc;
    if (snap.charge.rangeMiles !== null) patch.rangeMiles = snap.charge.rangeMiles;
    if (snap.charge.chargingState !== undefined) {
      patch.charging = snap.charge.chargingState.toLowerCase() === 'charging';
      // The full name too, not just the boolean. The charge panel distinguishes
      // Complete / Stopped / Starting / NoPower, which `charging` collapses.
      patch.chargingState = snap.charge.chargingState;
    }
    if (snap.charge.cableAttached !== undefined) patch.cableAttached = snap.charge.cableAttached;
    if (snap.charge.chargeLimitSoc !== undefined) patch.chargeLimitPercent = snap.charge.chargeLimitSoc;
    if (snap.charge.minutesToChargeLimit != null) patch.minutesToChargeLimit = snap.charge.minutesToChargeLimit;
    if (snap.charge.chargerPowerKw != null) patch.chargerPowerKw = snap.charge.chargerPowerKw;
    if (snap.charge.energyAddedKwh != null) patch.energyAddedKwh = snap.charge.energyAddedKwh;
    if (snap.charge.fastCharging != null) patch.fastCharging = snap.charge.fastCharging;
    if (snap.charge.chargerActualCurrentA != null)
      patch.chargerActualCurrentA = snap.charge.chargerActualCurrentA;
    if (snap.charge.chargerVoltageV != null) patch.chargerVoltageV = snap.charge.chargerVoltageV;
    if (snap.charge.chargerPilotCurrentA != null)
      patch.chargerPilotCurrentA = snap.charge.chargerPilotCurrentA;
    if (snap.charge.chargeRateMph != null) patch.chargeRateMph = snap.charge.chargeRateMph;
    // Only overwrite when the car actually reported a location — a read that omits
    // it (undefined) must not clear a Home/Work we already have.
    if (snap.charge.homeCoord !== undefined) patch.homeCoord = snap.charge.homeCoord;
    if (snap.charge.workCoord !== undefined) patch.workCoord = snap.charge.workCoord;
  }

  // Gated on the MediaState half, not on either half. That read carries the
  // card's identity — title, artist, playback status — and the patch is applied
  // by a shallow spread, so emitting on a detail-only tick would replace a
  // populated card with one that has no title. A detail-only tick therefore
  // contributes nothing rather than half-erasing the card; the read plan asks
  // for both together, so that only happens when one read faulted.
  if (snap.media) {
    patch.media = {
      ...snap.media,
      album: snap.mediaDetail?.album ?? null,
      station: snap.mediaDetail?.station ?? null,
      sourceName: snap.mediaDetail?.sourceName ?? null,
      elapsedSec: snap.mediaDetail?.elapsedSec ?? null,
      durationSec: snap.mediaDetail?.durationSec ?? null,
    };
  }

  if (snap.tires) {
    // Emitted whole rather than field-by-field: the four wheels, their warnings
    // and the placard value are one reading, and a half-applied patch would
    // render a wheel against the wrong recommendation.
    patch.tirePressures = snap.tires;
  }

  if (snap.climate) {
    const c = snap.climate;
    if (c.insideTempC !== undefined) patch.interiorTempC = c.insideTempC;
    if (c.outsideTempC !== undefined) patch.exteriorTempC = c.outsideTempC;
    patch.climateOn = c.isOn;
    // targetTempC was PARSED but never applied before — the mock 19.5 stuck.
    if (c.targetTempC !== undefined) patch.targetTempC = c.targetTempC;
    if (c.frontDefrostOn !== undefined) patch.frontDefrostOn = c.frontDefrostOn;
    if (c.rearDefrostOn !== undefined) patch.rearDefrostOn = c.rearDefrostOn;
    if (c.cabinOverheatMode !== undefined) patch.cabinOverheatMode = c.cabinOverheatMode;
    if (c.copActivelyCooling !== undefined) patch.copActivelyCooling = c.copActivelyCooling;
    if (c.cabinOverheatTemp !== undefined) patch.cabinOverheatTemp = c.cabinOverheatTemp;
    if (c.keeper !== undefined) patch.climateKeeper = c.keeper;
    if (c.bioweaponOn !== undefined) patch.bioweaponOn = c.bioweaponOn;
    if (c.steeringWheel !== undefined) patch.steeringWheelClimate = c.steeringWheel;
    // MERGE onto current seats — the car omits positions it doesn't have, and we
    // must not blow away the ones it didn't mention. The caller passes prev via
    // applyTelemetry's spread, but seatClimateModes is a nested object, so merge
    // here against the defaults and let applyActive spread the rest.
    if (c.seats) {
      patch.seatClimateModes = { ...initialVehicleState.seatClimateModes, ...c.seats };
    }
  }

  if (snap.drive) {
    patch.driving = DRIVING_GEARS.has(snap.drive.gear);
    patch.gear = snap.drive.gear;
    if (snap.drive.speed !== null) patch.speed = snap.drive.speed;
    if (snap.drive.odometerMiles !== null) patch.odometerMiles = snap.drive.odometerMiles;
    if (snap.drive.powerKw !== null) patch.powerKw = snap.drive.powerKw;
  }

  // Emit null, don't omit. Omitting leaves the PREVIOUS route in state forever:
  // once set, a route that has since ended never clears for the rest of the
  // session. Only emit when the drive slice was actually read — an absent
  // driveState means "we did not ask", not "there is no route".
  if (snap.drive) {
    patch.activeRoute = snap.route
      ? {
          destination: snap.route.destination,
          minutesToArrival: snap.route.minutesToArrival,
          milesToArrival: snap.route.milesToArrival,
        }
      : null;
  }

  // Real GPS → the map's car pin (location.tsx). Only emit when BOTH coords are finite; a partial
  // read leaves carLocation untouched rather than placing the car at a bogus 0/undefined point.
  if (snap.location && snap.location.lat !== undefined && snap.location.lon !== undefined) {
    patch.carLocation = {
      lat: snap.location.lat,
      lon: snap.location.lon,
      heading: snap.location.heading ?? null,
    };
    // WHEN we saw it there. Stamped in the same branch as the position itself so
    // the two cannot drift apart: there is no path that writes one without the
    // other, and no later code has to remember to.
    //
    // Prefer the car's own gps_as_of over our read time — on a sleeping car we
    // may not poll for hours after it parked, and dating the pin to the poll
    // would claim we saw it somewhere we did not. `now` is injected so the
    // mapper stays pure and testable.
    const asOf = snap.location.gpsAsOfSec;
    patch.carLocationAt = asOf != null && Number.isFinite(asOf) && asOf > 0 ? asOf * 1000 : now;
  }

  if (snap.closures) {
    // sentryModeState absent -> sentryOn is undefined -> omit sentryEnabled entirely rather than
    // reporting a fabricated "false" (matches the reference's `if (cls.sentryModeState)` gate).
    if (snap.closures.sentryOn !== undefined) patch.sentryEnabled = snap.closures.sentryOn;
    const w = snap.closures.windows;
    if (w.leftFront !== undefined) patch.leftFrontWindowOpen = w.leftFront;
    if (w.rightFront !== undefined) patch.rightFrontWindowOpen = w.rightFront;
    if (w.leftRear !== undefined) patch.leftRearWindowOpen = w.leftRear;
    if (w.rightRear !== undefined) patch.rightRearWindowOpen = w.rightRear;
    // Free extras (RESPONSE-15 Tier 1). `locked` also arrives over VCSEC and that
    // path stays authoritative for the lock UI — this is a consistent second
    // source, not a replacement.
    const c = snap.closures;
    if (c.userPresent !== undefined) patch.userPresent = c.userPresent;
    if (c.centerDisplay !== undefined) patch.centerDisplay = c.centerDisplay;
    if (c.valetMode !== undefined) patch.valetMode = c.valetMode;
    if (c.speedLimitMode !== undefined) patch.speedLimitMode = c.speedLimitMode;
  }

  return patch;
}
