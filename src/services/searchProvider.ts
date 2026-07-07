// Pure search orchestration. Online = Apple's MKLocalSearch results (its order, with coordinates); offline
// (Apple rejects) = the local gazetteer + charger DB, ranked by place.ts. Dependency-injected so it stays
// node-testable. NO native imports here.
import { normalizeQuery, rankPlaces, type Place, type SearchRegion } from './place';

// Max rows shown in the autocomplete list.
export const RESULT_CAP = 12;

export interface SearchDeps {
  // Online: Apple MKLocalSearch (results carry coordinates). Rejects when offline / on MKError.
  appleSearch: (q: string, region: SearchRegion) => Promise<Place[]>;
  // Offline fallback: synchronous prefix query over the local gazetteer + charger DB. `q` is normalized.
  localSearch: (q: string, region: SearchRegion) => Place[];
}

// Empty query → []. Otherwise Apple (its order) online, or ranked local results offline. Capped.
export async function runSearch(
  rawQuery: string,
  region: SearchRegion,
  deps: SearchDeps,
): Promise<Place[]> {
  const q = normalizeQuery(rawQuery);
  if (!q) return [];
  try {
    return (await deps.appleSearch(q, region)).slice(0, RESULT_CAP);
  } catch {
    return rankPlaces(deps.localSearch(q, region), region).slice(0, RESULT_CAP);
  }
}
