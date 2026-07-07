// Online enrichment via the AppleSearch native module (MapKit). Maps native completions/results to the
// shared Place shape. appleComplete is the real SearchDeps.appleComplete; appleResolve turns a tapped
// (coordinate-less) Apple completion into a coordinate via MKLocalSearch. Native import path is relative
// (local Expo module — same pattern as ../../modules/expo-godot-view).
import AppleSearch, { type AppleRegion } from '../../modules/expo-apple-search';
import type { Place, SearchRegion } from './place';

function toRegion(r: SearchRegion): AppleRegion {
  return {
    latitude: r.latitude,
    longitude: r.longitude,
    latitudeDelta: r.latitudeDelta,
    longitudeDelta: r.longitudeDelta,
  };
}

// Typeahead: title/subtitle only, no coordinate (resolved on tap via appleResolve). Rejects offline →
// searchProvider catches and degrades to local-only.
export async function appleComplete(q: string, region: SearchRegion): Promise<Place[]> {
  const raw = await AppleSearch.complete(q, toRegion(region));
  return raw.map((r, i) => ({
    id: `apple:${i}:${r.title}`,
    title: r.title,
    subtitle: r.subtitle || undefined,
    coordinate: null,
    kind: 'poi' as const,
    source: 'apple' as const,
  }));
}

// Online list source: Apple MKLocalSearch (full results WITH coordinates → distance pill). Rejects offline →
// searchProvider catches and falls back to local. This is the real SearchDeps.appleSearch.
export async function appleSearch(q: string, region: SearchRegion): Promise<Place[]> {
  const raw = await AppleSearch.search(q, toRegion(region));
  return raw.map((r, i) => ({
    id: `apple:${i}:${r.title}`,
    title: r.title,
    subtitle: r.subtitle || undefined,
    coordinate: { latitude: r.latitude, longitude: r.longitude },
    kind: 'poi' as const,
    source: 'apple' as const,
  }));
}

// Resolve a tapped Apple completion (coordinate === null) to a coordinate via MKLocalSearch. Local
// results already have a coordinate and don't need this.
export async function appleResolve(place: Place, region: SearchRegion): Promise<Place> {
  if (place.coordinate) return place;
  const query = place.subtitle ? `${place.title} ${place.subtitle}` : place.title;
  const [first] = await AppleSearch.search(query, toRegion(region));
  if (!first) return place;
  return { ...place, coordinate: { latitude: first.latitude, longitude: first.longitude } };
}
