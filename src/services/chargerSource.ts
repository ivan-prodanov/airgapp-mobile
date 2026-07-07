// Charger DISCOVERY source: the on-device SQLite database (chargers.db) pushed by
// scripts/godot-ios/deploy-chargers.sh — the whole world (~189k stations), queried by bounding box with an
// index so memory/time stay flat regardless of dataset size. If no DB has been pushed yet (a brand-new
// install), discovery is simply empty until you run deploy-chargers.sh. See [[ev-charger-data-providers]].
//
// expo-sqlite is native, so this module (unlike osm.ts) is app-only and must NOT be imported by the Node
// build scripts.
import * as SQLite from 'expo-sqlite';

import { distanceMeters, type LatLng } from '@/state/mockLocation';
import { OPEN_247_RANGE } from './osm';
import type { Charger, ChargerSearchResult, ConnectorGroup, LatLngBounds } from './tomtom';

const DB_NAME = 'chargers.db';
// Cap rows per query. Zoomed out this returns the highest-power stations in view (major/fast chargers); the
// map render cap (150) and list cap (60) further trim client-side. Keeps a huge bbox from marshalling
// thousands of rows across the bridge.
const QUERY_LIMIT = 1200;

// The DB stores 24/7 opening hours as a boolean flag; rebuild the range object the UI expects on read.
interface Row {
  id: string;
  lat: number;
  lng: number;
  name: string;
  place: string;
  region: string;
  currentType: string;
  maxPowerKW: number;
  totalConnectors: number;
  connectors: string; // JSON
  phone: string | null;
  website: string | null;
  open247: number;
}

// `defaultDatabaseDirectory` is `<container>/Documents/SQLite`; strip the SQLite suffix so we open (and the
// push script targets) `Documents/chargers.db` — Documents always exists, so no directory-creation dance.
function documentsDir(): string | undefined {
  const dir = SQLite.defaultDatabaseDirectory as string | undefined;
  return dir ? dir.replace(/\/SQLite\/?$/, '') : undefined;
}

// undefined = not yet tried; null = no usable DB (→ bundled fallback); else the open handle.
let db: SQLite.SQLiteDatabase | null | undefined;
function getDb(): SQLite.SQLiteDatabase | null {
  if (db !== undefined) return db;
  try {
    const handle = SQLite.openDatabaseSync(DB_NAME, undefined, documentsDir());
    const row = handle.getFirstSync<{ n: number }>('SELECT count(*) AS n FROM chargers');
    db = row && row.n > 0 ? handle : null;
  } catch {
    db = null; // no DB pushed yet, or it lacks the chargers table → fall back to the bundled extract
  }
  return db;
}

function rowToCharger(r: Row, car: LatLng): Charger {
  let connectors: ConnectorGroup[] = [];
  try {
    connectors = JSON.parse(r.connectors) as ConnectorGroup[];
  } catch {
    // leave empty on malformed JSON
  }
  return {
    id: r.id,
    name: r.name,
    place: r.place,
    region: r.region,
    latitude: r.lat,
    longitude: r.lng,
    currentType: r.currentType === 'DC' ? 'DC' : 'AC',
    maxPowerKW: r.maxPowerKW,
    totalConnectors: r.totalConnectors,
    availableConnectors: r.totalConnectors, // OSM has no live count; the badge uses the availability Record
    connectors,
    phone: r.phone ?? undefined,
    website: r.website ?? undefined,
    openingHours: r.open247 ? OPEN_247_RANGE : undefined,
    distanceM: distanceMeters(car, { latitude: r.lat, longitude: r.lng }),
  };
}

export function osmChargersInBounds(bounds: LatLngBounds, car: LatLng): ChargerSearchResult {
  const handle = getDb();
  if (!handle) return { chargers: [], quotaExceeded: false }; // no DB pushed yet → empty until deploy-chargers.sh
  const rows = handle.getAllSync<Row>(
    `SELECT id, lat, lng, name, place, region, currentType, maxPowerKW, totalConnectors, connectors, phone, website, open247
       FROM chargers
      WHERE lat BETWEEN ? AND ? AND lng BETWEEN ? AND ?
      ORDER BY maxPowerKW DESC
      LIMIT ?`,
    bounds.south,
    bounds.north,
    bounds.west,
    bounds.east,
    QUERY_LIMIT,
  );
  const chargers = rows.map((r) => rowToCharger(r, car)).sort((a, b) => a.distanceM - b.distanceM);
  return { chargers, quotaExceeded: false };
}

// Is there ANY charger inside this box? (cheap indexed existence check.)
export function hasChargerInBounds(bounds: LatLngBounds): boolean {
  const handle = getDb();
  if (!handle) return false;
  const row = handle.getFirstSync<{ one: number }>(
    'SELECT 1 AS one FROM chargers WHERE lat BETWEEN ? AND ? AND lng BETWEEN ? AND ? LIMIT 1',
    bounds.south,
    bounds.north,
    bounds.west,
    bounds.east,
  );
  return row != null;
}

// The single nearest charger to a point (squared-degree distance, lng weighted by cos(lat) so it's a fair
// local metric). A full scan of the table, but it's one row and only runs on the Charging-tab open.
export function nearestChargerTo(coord: LatLng): LatLng | null {
  const handle = getDb();
  if (!handle) return null;
  const cosLat = Math.cos((coord.latitude * Math.PI) / 180);
  const row = handle.getFirstSync<{ lat: number; lng: number }>(
    `SELECT lat, lng FROM chargers
      ORDER BY (lat - ?) * (lat - ?) + ((lng - ?) * ?) * ((lng - ?) * ?) ASC
      LIMIT 1`,
    coord.latitude,
    coord.latitude,
    coord.longitude,
    cosLat,
    coord.longitude,
    cosLat,
  );
  return row ? { latitude: row.lat, longitude: row.lng } : null;
}

// Name-substring match over the charger DB, for the Navigate search (secondary to the gazetteer).
export function chargersMatchingName(
  query: string,
  limit: number,
): { id: string; name: string; lat: number; lng: number; place: string; region: string }[] {
  const handle = getDb();
  if (!handle) return [];
  return handle.getAllSync<{ id: string; name: string; lat: number; lng: number; place: string; region: string }>(
    `SELECT id, name, lat, lng, place, region
       FROM chargers
      WHERE name LIKE ?
      ORDER BY maxPowerKW DESC
      LIMIT ?`,
    `%${query}%`,
    limit,
  );
}
