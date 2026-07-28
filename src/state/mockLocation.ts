// Geo utilities (bearing/distance/polar-offset) + a handful of remaining UI mocks (recents, busy-times).
// The car's map position is now the real GPS from BLE (state.carLocation); when it isn't known yet the
// UI falls back to the user's own location — there is no longer a fake per-car offset.

export interface LatLng {
  latitude: number;
  longitude: number;
}

const EARTH_RADIUS_M = 6_378_137;
const DEG = Math.PI / 180;

// Project `origin` by a polar offset (bearing + distance) using the equirectangular small-distance
// approximation. North component shifts latitude; east component shifts longitude, scaled by cos(lat).
// Used to fan out overlapping charger pins (location.tsx / tomtom.ts) — NOT for the car position, which
// now comes solely from the car's real GPS (state.carLocation).
export function offsetCoordinate(origin: LatLng, offset: { bearingDeg: number; distanceM: number }): LatLng {
  const brng = offset.bearingDeg * DEG;
  const dNorth = offset.distanceM * Math.cos(brng);
  const dEast = offset.distanceM * Math.sin(brng);
  const dLat = (dNorth / EARTH_RADIUS_M) / DEG;
  const dLng = (dEast / (EARTH_RADIUS_M * Math.cos(origin.latitude * DEG))) / DEG;
  return { latitude: origin.latitude + dLat, longitude: origin.longitude + dLng };
}

// Initial great-circle bearing FROM `a` TO `b`, degrees 0-360 (0 = north,
// clockwise). Used by the Home "Location" row arrow to point at the car: fed the
// user's live coord + the car's real GPS, it updates as either moves.
export function bearingBetween(a: LatLng, b: LatLng): number {
  const lat1 = a.latitude * DEG;
  const lat2 = b.latitude * DEG;
  const dLng = (b.longitude - a.longitude) * DEG;
  const y = Math.sin(dLng) * Math.cos(lat2);
  const x = Math.cos(lat1) * Math.sin(lat2) - Math.sin(lat1) * Math.cos(lat2) * Math.cos(dLng);
  return (Math.atan2(y, x) / DEG + 360) % 360;
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

// The mock "last updated" timestamp and its hand-rolled `formatTimeAgo` lived
// here. Both are gone: the pill now reads the real `carLocationAt` and formats
// it with `relativeAge` from ble/vehicleStatusText.ts — the RECOVERED port of
// moment's fromNow that the home header already uses. Two formatters with
// different thresholds (floor vs round, 30-day months vs the Gregorian mean)
// could describe the same instant differently on two screens.

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
