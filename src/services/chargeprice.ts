// Live availability via Chargeprice. OSM (discovery) has no live occupancy, so we fetch it here — in BULK
// by bounding box (one request returns many stations, each with `available_count`) and match each result
// to the nearest OSM charger by proximity (no shared id exists). Where Chargeprice has no live figure the
// charger keeps its "N?" badge. In the Balkans most stations report `null` today, so treat this as
// best-effort enrichment, not a guarantee. See [[ev-charger-data-providers]].
//
// Key: EXPO_PUBLIC_CHARGEPRICE_API_KEY (free "demo" key), inlined by Metro → ships via deploy-js.sh.
import { distanceMeters, type LatLng } from '@/state/mockLocation';
import type { Charger, LatLngBounds, StationAvailability } from './tomtom';

const CHARGEPRICE_KEY = process.env.EXPO_PUBLIC_CHARGEPRICE_API_KEY ?? '';
const BASE = 'https://api.chargeprice.app/v1/charging_stations';

interface CpChargePoint {
  power?: number;
  count?: number;
  available_count?: number | null;
}
interface CpStation {
  latitude?: number;
  longitude?: number;
  charge_points?: CpChargePoint[];
}

// A Chargeprice station reduced to what we need: coordinate + summed live availability.
export interface AvailabilityStation extends LatLng {
  available: number;
  total: number;
}

function parseStations(json: unknown): AvailabilityStation[] {
  const data = (json as { data?: { attributes?: CpStation }[] }).data ?? [];
  const out: AvailabilityStation[] = [];
  for (const d of data) {
    const a = d.attributes;
    if (!a || typeof a.latitude !== 'number' || typeof a.longitude !== 'number') continue;
    const cps = a.charge_points ?? [];
    // If NO charge point reports a live count, availability is unknown → skip (charger stays "N?").
    if (!cps.some((c) => typeof c.available_count === 'number')) continue;
    let available = 0;
    let total = 0;
    for (const c of cps) {
      total += c.count ?? 0;
      available += c.available_count ?? 0;
    }
    out.push({ latitude: a.latitude, longitude: a.longitude, available, total });
  }
  return out;
}

async function query(params: URLSearchParams): Promise<AvailabilityStation[]> {
  if (!CHARGEPRICE_KEY) return [];
  try {
    const res = await fetch(`${BASE}?${params.toString()}`, {
      headers: { 'API-Key': CHARGEPRICE_KEY, 'Content-Type': 'application/json' },
    });
    if (!res.ok) return [];
    return parseStations(await res.json());
  } catch {
    return [];
  }
}

// Bulk: all stations (with live availability) inside a viewport bbox — one request for many pins.
export function fetchAvailabilityInBounds(b: LatLngBounds): Promise<AvailabilityStation[]> {
  const params = new URLSearchParams({
    'filter[latitude.gte]': String(b.south),
    'filter[latitude.lte]': String(b.north),
    'filter[longitude.gte]': String(b.west),
    'filter[longitude.lte]': String(b.east),
    'page[size]': '400',
  });
  return query(params);
}

// Targeted: stations within a small radius of one point — used on tap so the detail panel is reliable
// even when the bulk viewport fetch didn't cover the tapped station.
export function fetchAvailabilityNear(coord: LatLng, radiusM = 250): Promise<AvailabilityStation[]> {
  const params = new URLSearchParams({
    'filter[latitude]': String(coord.latitude),
    'filter[longitude]': String(coord.longitude),
    'filter[radius]': String(radiusM),
  });
  return query(params);
}

// Match Chargeprice stations to OSM chargers by proximity → a Record keyed by charger id. Each station is
// assigned to the single nearest charger within MATCH_RADIUS_M, and a charger keeps only its closest match.
const MATCH_RADIUS_M = 120;
export function matchAvailability(
  chargers: Charger[],
  stations: AvailabilityStation[],
): Record<string, StationAvailability> {
  const rec: Record<string, StationAvailability> = {};
  const bestDist: Record<string, number> = {};
  for (const st of stations) {
    let nearest: Charger | null = null;
    let nearestD = MATCH_RADIUS_M;
    for (const c of chargers) {
      const d = distanceMeters(st, c);
      if (d < nearestD) {
        nearestD = d;
        nearest = c;
      }
    }
    if (nearest && (bestDist[nearest.id] === undefined || nearestD < bestDist[nearest.id])) {
      bestDist[nearest.id] = nearestD;
      rec[nearest.id] = { available: st.available, total: st.total };
    }
  }
  return rec;
}
