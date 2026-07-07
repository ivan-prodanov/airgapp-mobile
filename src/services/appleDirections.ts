// Online route via the AppleSearch native module (MKDirections). Maps the native result into the shared Leg
// shape + a LatLng polyline. Rejects offline → useTripRoute falls back to the straight-line mock.
import AppleSearch from '../../modules/expo-apple-search';
import type { LatLng } from '@/state/mockLocation';
import type { Leg } from '@/state/trip';

export interface RouteResult {
  polyline: LatLng[];
  legs: Leg[];
  totalDistanceM: number;
  totalDurationS: number;
}

export async function appleRoute(coords: LatLng[]): Promise<RouteResult> {
  const r = await AppleSearch.route(coords.map((c) => ({ latitude: c.latitude, longitude: c.longitude })));
  return {
    polyline: r.polyline.map((p) => ({ latitude: p.latitude, longitude: p.longitude })),
    legs: r.legs.map((l) => ({ distanceM: l.distanceM, durationS: l.durationS })),
    totalDistanceM: r.totalDistanceM,
    totalDurationS: r.totalDurationS,
  };
}
