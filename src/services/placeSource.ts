// Offline local search sources for Navigate: the bundled GeoNames gazetteer (places.db) + the charger
// DB (chargers.db) + recents. expo-sqlite is native, so this module is app-only (never imported by the
// Node build scripts or node:test). The pure ranking/merge lives in place.ts / searchProvider.ts.
import * as SQLite from 'expo-sqlite';

import { chargersMatchingName } from './chargerSource';
import type { Place, SearchRegion } from './place';

const PLACES_DB = 'places.db';
const GAZETTEER_LIMIT = 40; // rows pulled before the merge trims to the visible cap
const CHARGER_LIMIT = 8;

interface PlaceRow {
  id: string;
  name: string;
  lat: number;
  lng: number;
  country: string;
  admin1: string;
  population: number;
}

// undefined = not initialized; null = no usable DB; else the open handle.
let placesDb: SQLite.SQLiteDatabase | null | undefined;
let initPromise: Promise<void> | undefined;

// Copy the bundled gazetteer asset into the SQLite directory (idempotent — skipped if already present)
// and open it. Call on mount before searchLocal. Concurrency-safe: the in-flight promise is memoized so
// overlapping callers (e.g. the hook + a caller) share one import. importDatabaseFromAssetAsync is a
// no-op copy when the file already exists (no forceOverwrite).
export function initPlaceSources(): Promise<void> {
  if (!initPromise) {
    initPromise = (async () => {
      try {
        await SQLite.importDatabaseFromAssetAsync(PLACES_DB, { assetId: require('../../assets/places.db') });
        placesDb = SQLite.openDatabaseSync(PLACES_DB);
      } catch {
        placesDb = null; // asset missing / import failed → gazetteer results simply empty
      }
    })();
  }
  return initPromise;
}

function gazetteerMatching(q: string): Place[] {
  if (!placesDb) return [];
  const rows = placesDb.getAllSync<PlaceRow>(
    `SELECT id, name, lat, lng, country, admin1, population
       FROM places
      WHERE asciiname LIKE ? OR name LIKE ?
      ORDER BY population DESC
      LIMIT ?`,
    `${q}%`,
    `${q}%`,
    GAZETTEER_LIMIT,
  );
  return rows.map((r) => ({
    id: `geo:${r.id}`,
    title: r.name,
    subtitle: r.country || undefined, // ISO2 code; readable-name enrichment is a later UI concern
    coordinate: { latitude: r.lat, longitude: r.lng },
    kind: 'city' as const,
    source: 'gazetteer' as const,
    population: r.population,
  }));
}

function chargerMatching(q: string): Place[] {
  return chargersMatchingName(q, CHARGER_LIMIT).map((c) => ({
    id: `chg:${c.id}`,
    title: c.name,
    subtitle: c.region || c.place || undefined,
    coordinate: { latitude: c.lat, longitude: c.lng },
    kind: 'charger' as const,
    source: 'charger' as const,
  }));
}

// The real SearchDeps.localSearch: gazetteer + charger matches (synchronous; DB opened by init).
// eslint-disable-next-line @typescript-eslint/no-unused-vars -- region reserved for future proximity bias
export function searchLocal(q: string, _region: SearchRegion): Place[] {
  return [...gazetteerMatching(q), ...chargerMatching(q)];
}

// The real SearchDeps.recents (mock until a trip/destination concept exists).
export function recents(): Place[] {
  return [];
}
