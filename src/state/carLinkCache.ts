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
}

// Keyed by VIN: re-linking a different car must not inherit the old car's
// "last seen" age or battery.
export function carLinkCacheKey(vin: string): string {
  return `carlink.cache.${vin}`;
}

export async function loadCarLinkCache(storage: AppStorage, vin: string): Promise<CarLinkCache | null> {
  const cached = await load<CarLinkCache | null>(storage, carLinkCacheKey(vin), null);
  if (!cached || typeof cached.lastVehicleDataAt !== 'number') return null;
  return cached;
}

export function makeCarLinkCacheSaver(storage: AppStorage, vin: string): (value: CarLinkCache) => void {
  return makeSaver<CarLinkCache>(storage, carLinkCacheKey(vin), 500);
}
