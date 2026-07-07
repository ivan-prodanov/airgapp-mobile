// MOCK car-location source. Until BLE feeds real coordinates, the car is pinned to the user's live
// GPS position plus a small, STABLE per-car offset (a random bearing at a fixed ~100 m distance). The
// offset is generated once per vehicle (see Vehicle.mockLocationOffset in fleet.ts) so the pin doesn't
// jump on every re-render. When BLE lands, only the LocationView's coordinate source changes — this
// whole module goes away.

export interface LatLng {
  latitude: number;
  longitude: number;
}

// A fixed-distance, random-bearing offset from the user. Stored per-car so it's stable across renders.
export interface MockLocationOffset {
  bearingDeg: number; // 0 = north, clockwise
  distanceM: number;
}

const EARTH_RADIUS_M = 6_378_137;
const DEG = Math.PI / 180;

// Generate a fresh stable offset: a random compass bearing at a fixed 100 m. Call ONCE per vehicle.
export function createMockLocationOffset(): MockLocationOffset {
  return { bearingDeg: Math.random() * 360, distanceM: 100 };
}

// Project `origin` by `offset` using the equirectangular small-distance approximation (exact enough at
// 100 m). North component shifts latitude; east component shifts longitude, scaled by cos(lat).
export function offsetCoordinate(origin: LatLng, offset: MockLocationOffset): LatLng {
  const brng = offset.bearingDeg * DEG;
  const dNorth = offset.distanceM * Math.cos(brng);
  const dEast = offset.distanceM * Math.sin(brng);
  const dLat = (dNorth / EARTH_RADIUS_M) / DEG;
  const dLng = (dEast / (EARTH_RADIUS_M * Math.cos(origin.latitude * DEG))) / DEG;
  return { latitude: origin.latitude + dLat, longitude: origin.longitude + dLng };
}

// Great-circle distance between two coordinates, in metres (haversine).
export function distanceMeters(a: LatLng, b: LatLng): number {
  const dLat = (b.latitude - a.latitude) * DEG;
  const dLng = (b.longitude - a.longitude) * DEG;
  const lat1 = a.latitude * DEG;
  const lat2 = b.latitude * DEG;
  const h = Math.sin(dLat / 2) ** 2 + Math.cos(lat1) * Math.cos(lat2) * Math.sin(dLng / 2) ** 2;
  return 2 * EARTH_RADIUS_M * Math.asin(Math.min(1, Math.sqrt(h)));
}

// Mock "last updated" timestamp: a fixed ~2 months in the past, so the pill reads like the real app's
// "2 months ago". Real BLE will supply an actual fix time.
const MOCK_AGE_MS = 62 * 24 * 60 * 60 * 1000;
export function getMockLastUpdated(now: number = Date.now()): number {
  return now - MOCK_AGE_MS;
}

const MINUTE = 60 * 1000;
const HOUR = 60 * MINUTE;
const DAY = 24 * HOUR;
const MONTH = 30 * DAY;
const YEAR = 365 * DAY;

function plural(value: number, unit: string): string {
  const n = Math.floor(value);
  return `${n} ${unit}${n === 1 ? '' : 's'} ago`;
}

// Coarse "x ago" string for the last-updated pill (just now / minutes / hours / days / months / years).
export function formatTimeAgo(fromMs: number, now: number = Date.now()): string {
  const delta = Math.max(0, now - fromMs);
  if (delta < MINUTE) return 'just now';
  if (delta < HOUR) return plural(delta / MINUTE, 'minute');
  if (delta < DAY) return plural(delta / HOUR, 'hour');
  if (delta < MONTH) return plural(delta / DAY, 'day');
  if (delta < YEAR) return plural(delta / MONTH, 'month');
  return plural(delta / YEAR, 'year');
}

// --- Recent navigation destinations (mock) -------------------------------------------------------
// Grouped by day, mirroring the real app's "Today" / "Yesterday" sectioning.

export interface RecentDestination {
  id: string;
  name: string;
  address: string;
  distanceKm: number;
}

export interface RecentGroup {
  title: string;
  items: RecentDestination[];
}

export const MOCK_RECENTS: RecentGroup[] = [
  {
    title: 'Today',
    items: [
      {
        id: 'kaufland-mladost',
        name: 'Kaufland - Младост',
        address: 'улица „Филип Аврамов“, Sofia, Bulgaria',
        distanceKm: 2.0,
      },
    ],
  },
  {
    title: 'Yesterday',
    items: [
      {
        id: 'supercharger-paradise',
        name: 'Tesla Supercharger',
        address: 'Paradise Center, Sofia, Bulgaria',
        distanceKm: 5.4,
      },
      {
        id: 'home',
        name: 'Home',
        address: 'кв. Лозенец, Sofia, Bulgaria',
        distanceKm: 7.1,
      },
    ],
  },
];

export function formatKm(distanceKm: number): string {
  return `${distanceKm.toFixed(1)} km`;
}

// --- Busy-times histogram (MOCK) -----------------------------------------------------------------
// TomTom has no popular-times data, so the charger detail's "Busy Times" chart is a plausible mock: a
// weekday-ish curve (quiet overnight, midday bump, evening peak) with tiny deterministic per-station
// variation so charts aren't identical. 24 values (index = hour 0–23), normalised 0..1.
const BUSY_BASE = [
  0.12, 0.09, 0.07, 0.06, 0.06, 0.09, 0.16, 0.32, 0.52, 0.62, 0.66, 0.7, 0.74, 0.7, 0.66, 0.62, 0.66,
  0.74, 0.86, 0.92, 0.8, 0.6, 0.36, 0.2,
];
export function busyTimesFor(id: string): number[] {
  let h = 0;
  for (let i = 0; i < id.length; i += 1) h = (h * 31 + id.charCodeAt(i)) >>> 0;
  return BUSY_BASE.map((v, i) => {
    const jitter = (((h >> (i % 16)) & 3) - 1.5) * 0.06;
    return Math.max(0.05, Math.min(1, v + jitter));
  });
}
