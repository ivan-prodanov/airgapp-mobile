import type {
  CabinOverheatMode,
  CabinOverheatTemp,
  CarLocation,
  ClimateKeeperMode,
  MediaNowPlaying,
  SeatClimateModes,
  SteeringWheelClimate,
  TirePressures,
} from '@/types/vehicleTypes';
import { load, makeSaver, type AppStorage } from './persistence';

// The linked car's last-known telemetry, cached across app launches.
//
// Why this exists: docs/superpowers/research/tesla-status-assets-FINDINGS.md §B.
// The official app persists its vehicle-data slice — including
// `last_received_vehicle_data_timestamp` — via redux-persist. On cold start it
// REHYDRATES that, so the header immediately reads "Last seen 2 hours ago" (+
// spinner, since the cached timestamp is >2min old) and paints the cached
// battery with no pop-in. Without this cache our timestamp starts null, which
// renders the never-fetched "Connecting" fallback — the exact bug the user
// caught on the device.
//
// Storage-injected so the logic stays node-testable; useCarLink binds the real
// AsyncStorage-backed appStorage. NOTE: this is plain telemetry, never secrets
// — the device key and Pi bearer stay in the Keychain (see keystore.ts).

export interface CarLinkCache {
  // Our analogue of their `last_received_vehicle_data_timestamp` — see the
  // mapping note in src/ble/vehicleStatusText.ts.
  lastVehicleDataAt: number;
  batteryLevel: number | null;
  rangeMiles: number | null;
  charging: boolean | null;
  awake: boolean | null;
  // The rest of the visible readable telemetry, so a cold start rehydrates the
  // whole Home/Climate/Charging surface (dimmed) instead of blank — the way the
  // official app persists its full vehicle_data slice (findings §B).
  interiorTempC: number | null;
  exteriorTempC: number | null;
  targetTempC: number | null;
  chargeLimitPercent: number | null;
  chargingAmps: number | null;
  // The climate TOGGLES. Rendered from telemetry, so by this file's own rule
  // they belong here — and they were missing, which is the tirePressures gap
  // repeated a third time. Without them a cold start painted whatever
  // initialVehicleState happened to say (Cabin Overheat Protection asserted
  // "On, 40°C" on every launch) until a climate read landed, and if the car was
  // asleep it asserted it indefinitely — undimmed, so it read as fact rather
  // than as the last known value.
  climateOn: boolean | null;
  frontDefrostOn: boolean | null;
  // Not rendered on its own — the Defrost row drives the pair and the reconciler
  // diffs `front || rear`. Cached with its partner so a rehydrated front does
  // not diff against a rear that reset to false.
  rearDefrostOn: boolean | null;
  bioweaponOn: boolean | null;
  climateKeeper: ClimateKeeperMode | null;
  copActivelyCooling: boolean | null;
  cabinOverheatMode: CabinOverheatMode | null;
  cabinOverheatTemp: CabinOverheatTemp | null;
  // The rest of the steady-state telemetry, closing the GAP list that
  // carLinkCacheCoverage.test.ts made visible. Same rule as everything above:
  // rendered from telemetry, so a cold start shows the last known value dimmed
  // rather than the initial default presented as fact.
  //
  // What deliberately stays OUT is in that test's NOT_CACHED map: speed, gear,
  // driving, powerKw, userPresent, centerDisplay, activeRoute. For those a cached
  // value would be a lie rather than a stale truth — "45 mph" on a parked car is
  // worse than nothing.
  locked: boolean | null;
  sentryEnabled: boolean | null;
  valetMode: boolean | null;
  speedLimitMode: boolean | null;
  // Steady-state Security & Drivers settings, now that closures_state +
  // parental_controls_state are actually read (see readSecurity). Cached for the
  // same reason as the toggles above: a cold start shows the last known value
  // dimmed rather than the initial default (e.g. 85 mph) presented as the car's.
  speedLimitMph: number | null;
  parentalControls: boolean | null;
  parentalLimitSpeed: boolean | null;
  parentalReduceAccel: boolean | null;
  parentalRequireSafety: boolean | null;
  parentalCurfewNotify: boolean | null;
  cableAttached: boolean | null;
  // Monotonic — it cannot become wrong while the app is closed, only slightly
  // out of date. The most cacheable value we have.
  odometerMiles: number | null;
  leftFrontWindowOpen: boolean | null;
  rightFrontWindowOpen: boolean | null;
  leftRearWindowOpen: boolean | null;
  rightRearWindowOpen: boolean | null;
  seatClimateModes: SeatClimateModes | null;
  steeringWheelClimate: SteeringWheelClimate | null;
  // The car's last known GPS. Persisted for the same reason as the rest: a cold
  // start should show what we knew, not a blank.
  //
  // Its absence was visible and annoying — on relaunch the map fell back to the
  // USER's position and only jumped to the car after a pull-to-refresh, because
  // `carLocation` lived only in memory. The native side already persists this
  // (CarRegionMonitor keeps it in UserDefaults for the reboot-survival geofence),
  // so the phone knew where the car was the whole time; JS just did not.
  //
  // Stale by nature: it is where the car was when we last read it. That is the
  // same contract as the battery percentage beside it, and it is what the
  // official app does too — show the last known state, dimmed, rather than
  // nothing.
  carLocation: CarLocation | null;
  // Paired with carLocation and cached with it — a position with no age would
  // render as "just now" on every cold start, which is the opposite of true.
  carLocationAt: number | null;
  // TPMS. Cached for the same reason as everything else here: a cold start
  // should show what we last knew, dimmed, not "—".
  //
  // This was missed on the first cut and Ivan caught it immediately — the app
  // showed em dashes until the car was woken. Exactly the carLocation gap from
  // the day before, repeated on the very next field I added. The rule is simply
  // that anything rendered from telemetry belongs in this cache.
  tirePressures: TirePressures | null;
  // Now playing. Same rule again: it is rendered from telemetry, so it is
  // cached. A relaunch shows the last known track dimmed rather than an
  // empty card.
  media: MediaNowPlaying | null;
  // Charge panel. Same rule: rendered from telemetry, so cached — a relaunch
  // shows the last known charge state rather than an empty panel.
  chargingState: string | null;
  minutesToChargeLimit: number | null;
  chargerPowerKw: number | null;
  chargeRateMph: number | null;
  energyAddedKwh: number | null;
  fastCharging: boolean | null;
  chargerActualCurrentA: number | null;
  chargerVoltageV: number | null;
  chargerPilotCurrentA: number | null;
}

// Keyed by VIN: re-linking a different car must not inherit the old car's
// "last seen" age or battery.
export function carLinkCacheKey(vin: string): string {
  return `carlink.cache.${vin}`;
}

// NORMALISE on load. This is persisted across app versions, so a payload can
// predate today's shape — `rangeKm` was renamed to `rangeMiles` in the Round-5
// work, and the old key rehydrated as `undefined`, which then rendered "NaN km".
// Anything absent or non-finite becomes null, so a stale cache degrades to "no
// value" instead of leaking undefined into vehicle state.
const num = (v: unknown): number | null => (typeof v === 'number' && Number.isFinite(v) ? v : null);
// Same contract for strings: absent, wrong-typed, or empty all become null so
// a stale cache renders no line rather than a blank one.
const str = (v: unknown): string | null => (typeof v === 'string' && v.length > 0 ? v : null);
const bool = (v: unknown): boolean | null => (typeof v === 'boolean' ? v : null);
// Union fields are validated by MEMBERSHIP. `str()` would happily rehydrate a
// corrupt "banana" into a field typed 'off' | 'noac' | 'on' and light a segment
// that does not exist.
const oneOf = <T extends string>(v: unknown, allowed: readonly T[]): T | null =>
  typeof v === 'string' && (allowed as readonly string[]).includes(v) ? (v as T) : null;

const SEATS = [
  'frontLeft',
  'frontRight',
  'rearLeft',
  'rearMiddle',
  'rearRight',
  'thirdRowLeft',
  'thirdRowRight',
] as const;
const lvl = (v: unknown, max: number): number => (typeof v === 'number' && v >= 0 && v <= max ? v : 0);

// Whole-map or nothing: if the cached object is not an object we return null and
// the store keeps its defaults. Within it, each seat is rebuilt from validated
// parts, so one corrupt entry cannot take the rest of the map with it.
function seatModes(v: unknown): SeatClimateModes | null {
  if (!v || typeof v !== 'object') return null;
  const src = v as Record<string, { mode?: unknown; level?: unknown } | undefined>;
  const out = {} as SeatClimateModes;
  for (const seat of SEATS) {
    out[seat] = {
      mode: oneOf(src[seat]?.mode, ['off', 'heat', 'cool', 'auto'] as const) ?? 'off',
      level: lvl(src[seat]?.level, 3) as 0 | 1 | 2 | 3,
    };
  }
  return out;
}

// Level tops out at 2 here, not 3 — the wheel has no third step and never cools.
function wheelClimate(v: unknown): SteeringWheelClimate | null {
  if (!v || typeof v !== 'object') return null;
  const src = v as { mode?: unknown; level?: unknown };
  return {
    mode: oneOf(src.mode, ['off', 'heat', 'auto'] as const) ?? 'off',
    level: lvl(src.level, 2) as 0 | 1 | 2,
  };
}

export async function loadCarLinkCache(storage: AppStorage, vin: string): Promise<CarLinkCache | null> {
  const cached = await load<Partial<CarLinkCache> | null>(storage, carLinkCacheKey(vin), null);
  const at = num(cached?.lastVehicleDataAt);
  if (at === null) return null;
  return {
    lastVehicleDataAt: at,
    batteryLevel: num(cached?.batteryLevel),
    rangeMiles: num(cached?.rangeMiles),
    charging: bool(cached?.charging),
    awake: bool(cached?.awake),
    interiorTempC: num(cached?.interiorTempC),
    exteriorTempC: num(cached?.exteriorTempC),
    targetTempC: num(cached?.targetTempC),
    chargeLimitPercent: num(cached?.chargeLimitPercent),
    chargingAmps: num(cached?.chargingAmps),
    // Validated by membership, not by typeof: a corrupt or older cache must not
    // hand a bogus string to a union-typed field and light a segment that does
    // not exist. Absent stays null — "not read yet", distinct from "off".
    climateOn: bool(cached?.climateOn),
    frontDefrostOn: bool(cached?.frontDefrostOn),
    rearDefrostOn: bool(cached?.rearDefrostOn),
    bioweaponOn: bool(cached?.bioweaponOn),
    climateKeeper: oneOf(cached?.climateKeeper, ['off', 'on', 'camp', 'pet'] as const),
    copActivelyCooling: bool(cached?.copActivelyCooling),
    cabinOverheatMode: oneOf(cached?.cabinOverheatMode, ['off', 'noac', 'on'] as const),
    cabinOverheatTemp: oneOf(cached?.cabinOverheatTemp, ['30', '35', '40'] as const),
    locked: bool(cached?.locked),
    sentryEnabled: bool(cached?.sentryEnabled),
    valetMode: bool(cached?.valetMode),
    speedLimitMode: bool(cached?.speedLimitMode),
    speedLimitMph: num(cached?.speedLimitMph),
    parentalControls: bool(cached?.parentalControls),
    parentalLimitSpeed: bool(cached?.parentalLimitSpeed),
    parentalReduceAccel: bool(cached?.parentalReduceAccel),
    parentalRequireSafety: bool(cached?.parentalRequireSafety),
    parentalCurfewNotify: bool(cached?.parentalCurfewNotify),
    cableAttached: bool(cached?.cableAttached),
    odometerMiles: num(cached?.odometerMiles),
    leftFrontWindowOpen: bool(cached?.leftFrontWindowOpen),
    rightFrontWindowOpen: bool(cached?.rightFrontWindowOpen),
    leftRearWindowOpen: bool(cached?.leftRearWindowOpen),
    rightRearWindowOpen: bool(cached?.rightRearWindowOpen),
    // Rebuilt seat by seat. A partial or corrupt map must not reach the markers
    // over the 3D car, and a missing seat must come back as its default rather
    // than as undefined — the overlay indexes every position unconditionally.
    seatClimateModes: seatModes(cached?.seatClimateModes),
    steeringWheelClimate: wheelClimate(cached?.steeringWheelClimate),
    // Validated, not trusted: an older cache has no carLocation, and a corrupt
    // one must not put the map pin at 0,0.
    // Validated the same way as carLocation: an older cache has no tirePressures,
    // and a corrupt one must not render a confident 0.0 bar on a tyre.
    tirePressures:
      cached?.tirePressures && typeof cached.tirePressures === 'object'
        ? {
            fl: num(cached.tirePressures.fl),
            fr: num(cached.tirePressures.fr),
            rl: num(cached.tirePressures.rl),
            rr: num(cached.tirePressures.rr),
            rcpFront: num(cached.tirePressures.rcpFront),
            rcpRear: num(cached.tirePressures.rcpRear),
            hardWarning: {
              fl: cached.tirePressures.hardWarning?.fl === true,
              fr: cached.tirePressures.hardWarning?.fr === true,
              rl: cached.tirePressures.hardWarning?.rl === true,
              rr: cached.tirePressures.hardWarning?.rr === true,
            },
            softWarning: {
              fl: cached.tirePressures.softWarning?.fl === true,
              fr: cached.tirePressures.softWarning?.fr === true,
              rl: cached.tirePressures.softWarning?.rl === true,
              rr: cached.tirePressures.softWarning?.rr === true,
            },
          }
        : null,
    // Validated field-by-field like the rest. `remoteControlEnabled` and
    // `playbackStatus` rehydrate as undefined when absent, NOT as false/0 —
    // "not read yet" must stay distinguishable from "the car said no" and
    // from "stopped", or a cold start renders disabled buttons on a car that
    // would happily accept them.
    chargingState: str(cached?.chargingState),
    minutesToChargeLimit: num(cached?.minutesToChargeLimit),
    chargerPowerKw: num(cached?.chargerPowerKw),
    chargeRateMph: num(cached?.chargeRateMph),
    energyAddedKwh: num(cached?.energyAddedKwh),
    fastCharging: typeof cached?.fastCharging === 'boolean' ? cached.fastCharging : null,
    chargerActualCurrentA: num(cached?.chargerActualCurrentA),
    chargerVoltageV: num(cached?.chargerVoltageV),
    chargerPilotCurrentA: num(cached?.chargerPilotCurrentA),
    media:
      cached?.media && typeof cached.media === 'object'
        ? {
            remoteControlEnabled:
              typeof cached.media.remoteControlEnabled === 'boolean'
                ? cached.media.remoteControlEnabled
                : undefined,
            title: str(cached.media.title),
            artist: str(cached.media.artist),
            album: str(cached.media.album),
            station: str(cached.media.station),
            playbackStatus: num(cached.media.playbackStatus) ?? undefined,
            sourceType: num(cached.media.sourceType) ?? undefined,
            sourceName: str(cached.media.sourceName),
            volume: num(cached.media.volume),
            volumeMax: num(cached.media.volumeMax),
            volumeIncrement: num(cached.media.volumeIncrement),
            elapsedSec: num(cached.media.elapsedSec),
            durationSec: num(cached.media.durationSec),
          }
        : null,
    carLocation:
      cached?.carLocation &&
      Number.isFinite(cached.carLocation.lat) &&
      Number.isFinite(cached.carLocation.lon)
        ? {
            lat: cached.carLocation.lat,
            lon: cached.carLocation.lon,
            heading: num(cached.carLocation.heading),
          }
        : null,
    // Validated the same way, and deliberately NOT defaulted to Date.now(): an
    // older cache written before this field existed has a position but no age,
    // and stamping it "now" on load would claim we had just seen the car there.
    // null reads as unknown, which is the truth.
    carLocationAt: num(cached?.carLocationAt),
  };
}

export function makeCarLinkCacheSaver(storage: AppStorage, vin: string): (value: CarLinkCache) => void {
  return makeSaver<CarLinkCache>(storage, carLinkCacheKey(vin), 500);
}
