// Pure search orchestration. Runs the offline local source, attempts the online Apple source, and
// merges. Dependencies are injected (SearchDeps) so this stays node-testable — the real sources
// (placeSource, appleSearch) are wired in by useNavigateSearch. NO native imports here.
import { mergeResults, normalizeQuery, type Place, type SearchRegion } from './place';

export interface SearchDeps {
  // Offline: synchronous prefix query over the local SQLite gazetteer + charger DB. `q` is normalized.
  localSearch: (q: string, region: SearchRegion) => Place[];
  // Online: Apple typeahead. Rejects when offline / on MKError → caller degrades to local-only.
  appleComplete: (q: string, region: SearchRegion) => Promise<Place[]>;
  // Recent destinations (mock for now).
  recents: () => Place[];
}

// Empty query → recents. Otherwise local (instant) + Apple (best-effort) merged, ranked, capped.
export async function runSearch(
  rawQuery: string,
  region: SearchRegion,
  deps: SearchDeps,
): Promise<Place[]> {
  const q = normalizeQuery(rawQuery);
  if (!q) return deps.recents();

  const local = deps.localSearch(q, region);
  let apple: Place[] = [];
  try {
    apple = await deps.appleComplete(q, region);
  } catch {
    apple = []; // offline / Apple error → local-only, never throw
  }
  return mergeResults(local, apple, { region });
}
