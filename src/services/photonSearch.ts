// Online geocoding for platforms without MapKit — i.e. Android.
//
// Apple's MKLocalSearch has no cross-platform equivalent, so Android uses Photon
// (photon.komoot.io): an open-source geocoder over OpenStreetMap, keyless and free, built for
// typeahead. Same role, same shape, so searchProvider can swap the two by platform and the
// offline gazetteer stays the fallback for both.
//
// Two differences from the Apple path, both handled here:
//   - Photon ALWAYS returns coordinates, so there is no coordinate-less "completion" to resolve
//     on tap. photonComplete and photonSearch are therefore the same call, and photonResolve is
//     a no-op passthrough.
//   - GeoJSON is [lon, lat]. Flipping that silently puts every result in the wrong hemisphere,
//     so the mapper is pure and directly tested.
//
// Not a Tesla host, so src/ble/teslaHostGuard.ts is unaffected (it is a denylist over Tesla
// hostnames, and its scanner only covers src/ble).

import type { Place, SearchRegion } from './place';

const ENDPOINT = 'https://photon.komoot.io/api/';
const LIMIT = 12;

/** The subset of Photon's GeoJSON we consume. */
export interface PhotonFeature {
  geometry?: { type?: string; coordinates?: number[] };
  properties?: {
    name?: string;
    street?: string;
    housenumber?: string;
    city?: string;
    state?: string;
    country?: string;
    osm_key?: string;
    osm_value?: string;
  };
}

/** OSM class → our Place.kind. Anything unrecognised is a poi, which is the safe default. */
function kindFor(osmKey?: string, osmValue?: string): Place['kind'] {
  if (osmKey === 'place' && ['city', 'town', 'village', 'hamlet'].includes(osmValue ?? '')) return 'city';
  if (osmValue === 'charging_station') return 'charger';
  if (osmKey === 'building' || osmKey === 'address') return 'address';
  return 'poi';
}

/**
 * One Photon feature → one Place. Pure, so the [lon, lat] flip and the subtitle assembly are
 * testable without a network.
 *
 * Returns null for a feature with no usable point — Photon can return features whose geometry is
 * absent or non-Point, and a Place with a bogus coordinate is worse than one fewer result.
 */
export function photonFeatureToPlace(f: PhotonFeature, index: number): Place | null {
  const coords = f.geometry?.coordinates;
  if (!coords || coords.length < 2) return null;
  const [lon, lat] = coords; // GeoJSON order — NOT lat,lon
  if (typeof lat !== 'number' || typeof lon !== 'number') return null;

  const p = f.properties ?? {};
  const street = [p.street, p.housenumber].filter(Boolean).join(' ');
  const title = p.name || street || p.city || 'Place';
  // Mirrors the Apple subtitle's "locality, region" feel without repeating the title.
  const subtitle = [street && street !== title ? street : null, p.city, p.state, p.country]
    .filter((s): s is string => !!s && s !== title)
    .join(', ');

  return {
    id: `photon:${index}:${title}`,
    title,
    subtitle: subtitle || undefined,
    coordinate: { latitude: lat, longitude: lon },
    kind: kindFor(p.osm_key, p.osm_value),
    source: 'photon',
  };
}

export function photonUrl(q: string, region: SearchRegion): string {
  const params = new URLSearchParams({
    q,
    // Bias toward what the user is looking at, exactly as the Apple path passes its region.
    lat: String(region.latitude),
    lon: String(region.longitude),
    limit: String(LIMIT),
  });
  return `${ENDPOINT}?${params.toString()}`;
}

type FetchLike = (url: string, init?: { headers?: Record<string, string> }) => Promise<{
  ok: boolean;
  status: number;
  json: () => Promise<unknown>;
}>;

/**
 * Online list source. REJECTS on any failure rather than returning [] — searchProvider's
 * runSearch catches and degrades to the offline gazetteer, so an empty array would wrongly
 * read as "searched successfully, no matches" and suppress the local results.
 */
export async function photonSearch(
  q: string,
  region: SearchRegion,
  fetchImpl: FetchLike = fetch as unknown as FetchLike,
): Promise<Place[]> {
  const res = await fetchImpl(photonUrl(q, region), {
    // The public instance asks callers to identify themselves.
    headers: { 'User-Agent': 'airgapp/1.0 (personal Tesla companion app)' },
  });
  if (!res.ok) throw new Error(`photon ${res.status}`);
  const body = (await res.json()) as { features?: PhotonFeature[] };
  const features = body?.features ?? [];
  return features
    .map((f, i) => photonFeatureToPlace(f, i))
    .filter((p): p is Place => p !== null);
}

/** Photon results always carry coordinates, so typeahead and full search are one call. */
export const photonComplete = photonSearch;

/** No coordinate-less completions to resolve — kept for signature parity with appleResolve. */
export async function photonResolve(place: Place): Promise<Place> {
  return place;
}
