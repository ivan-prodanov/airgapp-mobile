// OpenStreetMap charging-station data layer. DISCOVERY comes from a bundled, pre-built OSM extract
// (ODbL, "© OpenStreetMap contributors") — no per-pan network cost, works offline, and legally cacheable
// (unlike TomTom). This module maps raw OSM `amenity=charging_station` elements → our Charger shape (used
// by the build-time generator in scripts/osm/), and serves the bundled records by bounding box at runtime.
//
// Live availability is NOT in OSM — it is fetched separately (Chargeprice, proximity-matched) and the pin
// badge falls back to "N?" where unknown. See [[ev-charger-data-providers]].
import type { Charger, ConnectorGroup } from './tomtom';

// A single element as returned by the Overpass API (`out tags center`). Nodes carry lat/lon directly;
// ways/relations carry a `center`. `tags` is the raw OSM key/value map.
// OSM only knows "24/7", not real weekly ranges, so a 24/7 station gets this single 7-day-spanning range
// (→ formatOpeningHours renders "Open 24 hours"). Shared with the SQLite source (chargerSource.ts).
export const OPEN_247_RANGE = [
  { startDate: '2026-01-01', startHour: 0, startMinute: 0, endDate: '2026-01-08', endHour: 0, endMinute: 0 },
];

export interface OsmElement {
  type: 'node' | 'way' | 'relation';
  id: number;
  lat?: number;
  lon?: number;
  center?: { lat: number; lon: number };
  tags?: Record<string, string>;
}

// A bundled charger record = a Charger minus the runtime-only distance (added when we know the car pos).
export type StoredCharger = Omit<Charger, 'distanceM'>;

// OSM socket:<type> → friendly label + whether it's DC. Covers the plugs that actually appear in the
// Balkans; unknown types fall through to a tidied label and the power-based AC/DC heuristic.
const SOCKET_TYPES: Record<string, { label: string; dc: boolean }> = {
  type2: { label: 'Type 2', dc: false },
  type2_cable: { label: 'Type 2', dc: false },
  type2_combo: { label: 'CCS', dc: true },
  type1: { label: 'Type 1', dc: false },
  type1_combo: { label: 'CCS (Type 1)', dc: true },
  combo_ccs: { label: 'CCS', dc: true },
  ccs: { label: 'CCS', dc: true },
  chademo: { label: 'CHAdeMO', dc: true },
  tesla_supercharger: { label: 'Tesla', dc: true },
  tesla_supercharger_ccs: { label: 'Tesla CCS', dc: true },
  tesla_destination: { label: 'Tesla (AC)', dc: false },
  schuko: { label: 'Domestic', dc: false },
  domestic: { label: 'Domestic', dc: false },
  cee_blue: { label: 'CEE', dc: false },
  cee_red_16a: { label: 'CEE 16A', dc: false },
  cee_red_32a: { label: 'CEE 32A', dc: false },
  gb_dc: { label: 'GB/T DC', dc: true },
  gb_ac: { label: 'GB/T AC', dc: false },
};

function prettySocket(type: string): { label: string; dc: boolean } {
  if (SOCKET_TYPES[type]) return SOCKET_TYPES[type];
  const dc = /combo|ccs|chademo|_dc|supercharger/.test(type);
  const label = type.replace(/_/g, ' ').replace(/\b\w/g, (m) => m.toUpperCase());
  return { label, dc };
}

// Parse an OSM power string into kW: "50 kW", "50000" (W), "22", "3.7 kW", "150 kW;350 kW", "22.08".
// Takes the first value in a list; treats a bare number > 1000 as watts.
export function parsePowerKW(raw: string | undefined): number {
  if (!raw) return 0;
  const first = raw.split(/[;,]/)[0];
  const m = first.match(/([\d.]+)\s*(kw|w)?/i);
  if (!m) return 0;
  let n = parseFloat(m[1]);
  if (!isFinite(n)) return 0;
  const unit = (m[2] ?? '').toLowerCase();
  if (unit === 'w' || (unit === '' && n > 1000)) n /= 1000; // watts → kW
  return Math.round(n * 10) / 10;
}

// An integer socket count ("2" → 2). OSM sometimes uses "yes"/"1"; "yes" means "present, count unknown" → 1.
function parseCount(raw: string | undefined): number {
  if (!raw) return 0;
  if (raw === 'yes') return 1;
  const n = parseInt(raw, 10);
  return isFinite(n) && n > 0 ? n : 0;
}

// Build connector groups from socket:<type> (count) + socket:<type>:output (power) tags.
function connectorsFromTags(tags: Record<string, string>): ConnectorGroup[] {
  const groups: ConnectorGroup[] = [];
  for (const [k, v] of Object.entries(tags)) {
    const m = k.match(/^socket:([a-z0-9_]+)$/);
    if (!m) continue;
    const type = m[1];
    const count = parseCount(v);
    if (count === 0) continue;
    const { label, dc } = prettySocket(type);
    const powerKW = parsePowerKW(tags[`socket:${type}:output`]);
    const currentType: 'AC' | 'DC' = dc || powerKW >= 43 ? 'DC' : 'AC';
    groups.push({ label, powerKW, currentType, count });
  }
  return groups.sort((a, b) => b.powerKW - a.powerKW);
}

function firstTag(tags: Record<string, string>, keys: string[]): string | undefined {
  for (const k of keys) if (tags[k]) return tags[k];
  return undefined;
}

// Map one OSM charging_station element → a StoredCharger, or null if it has no usable coordinate.
// `country` (from the generator, per source query) enriches the region label since OSM rarely tags country.
export function mapOsmElement(el: OsmElement, country?: string): StoredCharger | null {
  const lat = el.lat ?? el.center?.lat;
  const lon = el.lon ?? el.center?.lon;
  if (lat == null || lon == null) return null;
  const tags = el.tags ?? {};

  const connectors = connectorsFromTags(tags);
  const powers = connectors.map((c) => c.powerKW).filter((p) => p > 0);
  const stationMax = parsePowerKW(tags.maxpower);
  const isDC = connectors.some((c) => c.currentType === 'DC');
  const maxPowerKW = Math.max(stationMax, ...(powers.length ? powers : [0])) || (isDC ? 50 : 22);

  const name = firstTag(tags, ['name', 'brand', 'operator', 'network']) ?? 'Charging station';
  const street = [tags['addr:street'], tags['addr:housenumber']].filter(Boolean).join(' ');
  const city = firstTag(tags, ['addr:city', 'addr:suburb', 'addr:town', 'addr:village']);
  const place = street || city || firstTag(tags, ['operator', 'brand', 'network']) || 'Charging station';
  const region = [city, tags['addr:country'] || country].filter(Boolean).join(', ') || country || 'Nearby';

  // Total plugs: sum of socket counts, else `capacity`, else 0 (0 → badge shows "?" = unknown, never a fake 1).
  const socketTotal = connectors.reduce((n, g) => n + g.count, 0);
  const totalConnectors = socketTotal || parseCount(tags.capacity);

  // Only synthesise opening hours for the unambiguous 24/7 case (→ "Open 24 hours"); richer OSM
  // opening_hours syntax is left unparsed rather than mis-shown.
  const open247 = tags.opening_hours === '24/7';

  return {
    id: `osm:${el.type[0]}${el.id}`,
    name,
    place,
    region,
    latitude: lat,
    longitude: lon,
    currentType: isDC ? 'DC' : 'AC',
    maxPowerKW,
    totalConnectors,
    availableConnectors: totalConnectors,
    connectors,
    phone: firstTag(tags, ['phone', 'contact:phone']),
    website: firstTag(tags, ['website', 'contact:website']),
    openingHours: open247 ? OPEN_247_RANGE : undefined,
  };
}

// De-duplicate by OSM id (bbox-per-country queries overlap at borders), keeping the first seen.
export function dedupeById(list: StoredCharger[]): StoredCharger[] {
  const seen = new Set<string>();
  const out: StoredCharger[] = [];
  for (const c of list) {
    if (seen.has(c.id)) continue;
    seen.add(c.id);
    out.push(c);
  }
  return out;
}

// NOTE: this module is now pure OSM→Charger MAPPING + types (used by the build script + tests). There is no
// bundled runtime data anymore — discovery is served entirely from the on-device SQLite DB via
// chargerSource.ts. (The old bundled Balkans extract + build-charger-extract.ts were removed.)
