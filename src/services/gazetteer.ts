// Pure GeoNames `cities1000` row → gazetteer record mapper. Shared by the build script
// (scripts/geonames/build-places-db.ts) and its tests. NO React Native / expo imports so it stays
// node-testable. Data: GeoNames cities1000, CC BY 4.0 — "© GeoNames (CC BY 4.0)".

// One stored gazetteer row. `asciiname` is GeoNames' ASCII-folded name (indexed for prefix search);
// `admin1`/`country` are GeoNames codes (readable-name enrichment is a later UI concern).
export interface PlaceRecord {
  id: string;
  name: string;
  asciiname: string;
  lat: number;
  lng: number;
  country: string;
  admin1: string;
  population: number;
}

// GeoNames column indices (tab-separated, 0-based).
const COL = { id: 0, name: 1, asciiname: 2, lat: 4, lng: 5, country: 8, admin1: 10, population: 14 };

export function parsePopulation(raw: string): number {
  const n = parseInt(raw, 10);
  return Number.isFinite(n) && n > 0 ? n : 0;
}

// Map one tab-separated cities1000 line → a PlaceRecord, or null if it lacks a usable coordinate.
export function mapGeoNamesRow(line: string): PlaceRecord | null {
  const c = line.split('\t');
  if (c.length < 15) return null;
  const lat = parseFloat(c[COL.lat]);
  const lng = parseFloat(c[COL.lng]);
  if (!Number.isFinite(lat) || !Number.isFinite(lng)) return null;
  const name = c[COL.name];
  if (!name) return null;
  return {
    id: c[COL.id],
    name,
    asciiname: c[COL.asciiname] || name,
    lat,
    lng,
    country: c[COL.country] ?? '',
    admin1: c[COL.admin1] ?? '',
    population: parsePopulation(c[COL.population] ?? ''),
  };
}
