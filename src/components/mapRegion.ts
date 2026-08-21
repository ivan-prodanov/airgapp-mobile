// Pure conversions between react-native-maps' `Region` (what location.tsx speaks) and MapLibre's
// centre/zoom/bounds model (what the Android surface speaks).
//
// Kept out of the component so it is node-testable — the same isolation rule src/ble follows. The
// arithmetic here is exactly the kind that fails silently: MapLibre orders coordinates
// [longitude, latitude] and its bounds as [west, south, east, north], while everything else in
// this app says {latitude, longitude}. A flip does not throw, it just puts the car in the ocean.

/** react-native-maps' Region — latitude/longitude with full-span deltas. */
export interface RegionLike {
  latitude: number;
  longitude: number;
  latitudeDelta: number;
  longitudeDelta: number;
}

/** MapLibre's LngLatBounds: [west, south, east, north]. */
export type Bounds4 = [number, number, number, number];

/** A tap on a map label, normalised to the shape location.tsx's onPoiClick handler expects. */
export interface PoiTap {
  name: string;
  latitude: number;
  longitude: number;
}

/**
 * Region → bounds. The deltas are FULL spans, not half-spans, so each edge is half a delta from
 * the centre. Getting that wrong silently doubles or halves every fitted viewport.
 */
export function regionToBounds(r: RegionLike): Bounds4 {
  const halfLat = r.latitudeDelta / 2;
  const halfLng = r.longitudeDelta / 2;
  return [r.longitude - halfLng, r.latitude - halfLat, r.longitude + halfLng, r.latitude + halfLat];
}

/** Bounds → Region, the inverse of regionToBounds. */
export function boundsToRegion([west, south, east, north]: Bounds4): RegionLike {
  return {
    latitude: (south + north) / 2,
    longitude: (west + east) / 2,
    latitudeDelta: Math.abs(north - south),
    longitudeDelta: Math.abs(east - west),
  };
}

/** Smallest bounds containing every point. Returns null for an empty list. */
export function boundsForCoordinates(
  points: { latitude: number; longitude: number }[],
): Bounds4 | null {
  if (points.length === 0) return null;
  let west = points[0].longitude;
  let east = points[0].longitude;
  let south = points[0].latitude;
  let north = points[0].latitude;
  for (const p of points) {
    west = Math.min(west, p.longitude);
    east = Math.max(east, p.longitude);
    south = Math.min(south, p.latitude);
    north = Math.max(north, p.latitude);
  }
  // A single point (or several identical ones) gives a zero-area box, which MapLibre's fitBounds
  // resolves to its maximum zoom. Pad it to something a map can actually show.
  if (west === east && south === north) {
    const pad = 0.002; // ~200 m
    return [west - pad, south - pad, east + pad, north + pad];
  }
  return [west, south, east, north];
}

/** Apple's onPoiClick payload → PoiTap. */
export function normalizeApplePoi(e: {
  nativeEvent: { name?: string; coordinate: { latitude: number; longitude: number } };
}): PoiTap {
  return {
    name: e.nativeEvent.name ?? 'Place',
    latitude: e.nativeEvent.coordinate.latitude,
    longitude: e.nativeEvent.coordinate.longitude,
  };
}

/**
 * A MapLibre queryRenderedFeatures hit → PoiTap, or null when the feature has no usable point.
 *
 * MapLibre returns GeoJSON, so coordinates are [lon, lat] — the opposite order to every other
 * coordinate in this app.
 */
export function normalizeMapLibrePoi(f: {
  properties?: Record<string, unknown> | null;
  geometry?: { type?: string; coordinates?: unknown } | null;
}): PoiTap | null {
  const coords = f.geometry?.coordinates;
  if (!Array.isArray(coords) || coords.length < 2) return null;
  const [lon, lat] = coords as unknown[];
  if (typeof lat !== 'number' || typeof lon !== 'number') return null;
  const props = f.properties ?? {};
  const raw = props.name ?? props['name:latin'] ?? props.ref;
  const name = typeof raw === 'string' && raw.length > 0 ? raw : 'Place';
  return { name, latitude: lat, longitude: lon };
}
