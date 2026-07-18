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
  };
}

export function makeCarLinkCacheSaver(storage: AppStorage, vin: string): (value: CarLinkCache) => void {
  return makeSaver<CarLinkCache>(storage, carLinkCacheKey(vin), 500);
}
