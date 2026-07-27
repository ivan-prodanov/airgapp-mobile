import type { CarLocation, MediaNowPlaying, TirePressures } from '@/types/vehicleTypes';
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
  };
}

export function makeCarLinkCacheSaver(storage: AppStorage, vin: string): (value: CarLinkCache) => void {
  return makeSaver<CarLinkCache>(storage, carLinkCacheKey(vin), 500);
}
