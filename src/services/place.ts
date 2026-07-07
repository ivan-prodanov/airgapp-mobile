// Pure search-result model + merge/rank/dedupe. NO React Native / expo imports (node-testable).
// The single result shape shown in the Navigate list and handed to the map on tap.

export interface SearchRegion {
  latitude: number;
  longitude: number;
  latitudeDelta: number;
  longitudeDelta: number;
}

export interface Place {
  id: string;
  title: string;            // "Sofia", "Kaufland Mladost", "ul. Filip Avramov 1"
  subtitle?: string;        // "BG", "Sofia, Bulgaria", category/context
  coordinate: { latitude: number; longitude: number } | null; // null for unresolved Apple completions
  kind: 'city' | 'charger' | 'poi' | 'address' | 'recent';
  source: 'gazetteer' | 'charger' | 'recent' | 'apple';
  population?: number;      // ranking hint (local results only)
}

// Diacritic-insensitive lowercase key for matching/dedupe. GeoNames asciiname is already ASCII, so a
// folded query prefix-matches it directly.
export function foldAccents(s: string): string {
  // ̀–ͯ = Unicode combining diacritical marks (stripped after NFD decomposition).
  return s.normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase();
}

export function normalizeQuery(q: string): string {
  return foldAccents(q).trim();
}

// Source tiers: recents first, local place data next, Apple online results last.
const TIER: Record<Place['source'], number> = { recent: 0, gazetteer: 1, charger: 1, apple: 2 };

function inRegion(p: Place, r: SearchRegion): boolean {
  if (!p.coordinate) return false;
  return (
    Math.abs(p.coordinate.latitude - r.latitude) <= r.latitudeDelta &&
    Math.abs(p.coordinate.longitude - r.longitude) <= r.longitudeDelta
  );
}

// Collapse the same place appearing from two sources (e.g. a city from gazetteer AND Apple) by folded
// title; keep the coordinate-bearing / lower-tier (more authoritative) entry. Title-only dedupe is a
// deliberate simplification — Apple completions carry no coordinate to disambiguate by.
export function dedupePlaces(list: Place[]): Place[] {
  const seen = new Map<string, Place>();
  for (const cur of list) {
    const key = foldAccents(cur.title);
    const prev = seen.get(key);
    if (!prev) {
      seen.set(key, cur);
      continue;
    }
    const better = (!prev.coordinate && !!cur.coordinate) || TIER[cur.source] < TIER[prev.source];
    if (better) seen.set(key, cur);
  }
  return [...seen.values()];
}

// Stable order: tier, then in-viewport before out, then population desc.
export function rankPlaces(list: Place[], region: SearchRegion): Place[] {
  return [...list].sort((a, b) => {
    if (TIER[a.source] !== TIER[b.source]) return TIER[a.source] - TIER[b.source];
    const ra = inRegion(a, region) ? 0 : 1;
    const rb = inRegion(b, region) ? 0 : 1;
    if (ra !== rb) return ra - rb;
    return (b.population ?? 0) - (a.population ?? 0);
  });
}

export function mergeResults(
  local: Place[],
  apple: Place[],
  opts: { region: SearchRegion; cap?: number },
): Place[] {
  const merged = dedupePlaces([...local, ...apple]);
  return rankPlaces(merged, opts.region).slice(0, opts.cap ?? 12);
}
