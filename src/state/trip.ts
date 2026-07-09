// Trip planning model + itinerary math. Pure — NO React Native imports (node-testable). stops[0] is always
// the car (non-removable, non-reorderable). Phase 1 uses straight-line legs; Phase 2 swaps in real Apple
// routing (same computeItinerary, different `legs`). Energy numbers are deliberately mocked.
import type { Place } from '@/services/place';
import type { Charger } from '@/services/tomtom';
import type { LatLng } from '@/state/mockLocation';

export type StopKind = 'car' | 'place' | 'charger';
export interface TripStop {
  id: string;
  kind: StopKind;
  title: string;
  subtitle?: string;
  coordinate: LatLng;
}
export interface Trip {
  stops: TripStop[];
}
export interface Leg {
  distanceM: number;
  durationS: number;
}
export interface ItineraryRow {
  stop: TripStop;
  at: number; // arrival time, epoch ms (real: departure + cumulative Apple leg durations)
}

// Each stop gets a unique INSTANCE id (not derived from the place) so the same place can appear twice in a
// trip (Car → A → B → A) and be removed / reordered / keyed independently.
let stopSeq = 0;
const uid = (): string => {
  stopSeq += 1;
  return String(stopSeq);
};

export function carStop(coordinate: LatLng): TripStop {
  return { id: 'car', kind: 'car', title: 'Car location', coordinate };
}
export function placeToStop(place: Place): TripStop {
  return {
    id: `place:${uid()}`,
    kind: 'place',
    title: place.title,
    subtitle: place.subtitle,
    coordinate: place.coordinate ?? { latitude: 0, longitude: 0 },
  };
}
export function chargerToStop(c: Charger): TripStop {
  return {
    id: `charger:${uid()}`,
    kind: 'charger',
    title: c.name,
    subtitle: c.region || c.place,
    coordinate: { latitude: c.latitude, longitude: c.longitude },
  };
}

export function startTrip(car: TripStop, place: Place): Trip {
  return { stops: [car, placeToStop(place)] };
}
export function addStop(trip: Trip, place: Place): Trip {
  return { stops: [...trip.stops, placeToStop(place)] };
}
// Insert a place stop at `index`, clamped to [1, stops.length] so it never lands before the car.
export function insertStop(trip: Trip, place: Place, index: number): Trip {
  const at = Math.max(1, Math.min(index, trip.stops.length));
  const stops = [...trip.stops];
  stops.splice(at, 0, placeToStop(place));
  return { stops };
}
export function addCharger(trip: Trip, c: Charger): Trip {
  return { stops: [...trip.stops, chargerToStop(c)] };
}
// Insert a charger stop at `index`, clamped to [1, stops.length] (never before the car).
export function insertCharger(trip: Trip, c: Charger, index: number): Trip {
  const at = Math.max(1, Math.min(index, trip.stops.length));
  const stops = [...trip.stops];
  stops.splice(at, 0, chargerToStop(c));
  return { stops };
}
// Remove by id, but never the car (index 0).
export function removeStop(trip: Trip, id: string): Trip {
  return { stops: trip.stops.filter((s, i) => i === 0 || s.id !== id) };
}
// Move stops[from] → to, with both indices clamped to >= 1 so the car stays first.
export function reorderStops(trip: Trip, from: number, to: number): Trip {
  const n = trip.stops.length;
  if (from < 1 || from >= n || to < 1 || to >= n || from === to) return trip;
  const stops = [...trip.stops];
  const [moved] = stops.splice(from, 1);
  stops.splice(to, 0, moved);
  return { stops };
}

const EARTH_M = 6_371_000;
function haversineM(a: LatLng, b: LatLng): number {
  const toRad = (d: number) => (d * Math.PI) / 180;
  const dLat = toRad(b.latitude - a.latitude);
  const dLng = toRad(b.longitude - a.longitude);
  const la1 = toRad(a.latitude);
  const la2 = toRad(b.latitude);
  const h = Math.sin(dLat / 2) ** 2 + Math.cos(la1) * Math.cos(la2) * Math.sin(dLng / 2) ** 2;
  return 2 * EARTH_M * Math.asin(Math.sqrt(h));
}

const MOCK_SPEED_MPS = 80_000 / 3600; // ~80 km/h, for phase-1 mock durations
// Phase-1 mock legs: straight-line distance + a nominal speed. Replaced by real Apple route legs in Phase 2.
export function straightLineLegs(stops: TripStop[]): Leg[] {
  const legs: Leg[] = [];
  for (let i = 1; i < stops.length; i += 1) {
    const distanceM = haversineM(stops[i - 1].coordinate, stops[i].coordinate);
    legs.push({ distanceM, durationS: distanceM / MOCK_SPEED_MPS });
  }
  return legs;
}

// Arrival time per stop: departure (`departAt`) + cumulative real Apple leg durations. `legs[i-1]` is the leg
// into stops[i]. No battery/charge modelling — we have no real vehicle SOC/consumption data.
export function computeItinerary(stops: TripStop[], legs: Leg[], departAt: number): ItineraryRow[] {
  const rows: ItineraryRow[] = [{ stop: stops[0], at: departAt }];
  let at = departAt;
  for (let i = 1; i < stops.length; i += 1) {
    const leg = legs[i - 1] ?? { distanceM: 0, durationS: 0 };
    at += leg.durationS * 1000;
    rows.push({ stop: stops[i], at });
  }
  return rows;
}

export function tripTotals(legs: Leg[]): { distanceM: number; durationS: number } {
  return legs.reduce(
    (acc, l) => ({ distanceM: acc.distanceM + l.distanceM, durationS: acc.durationS + l.durationS }),
    { distanceM: 0, durationS: 0 },
  );
}
