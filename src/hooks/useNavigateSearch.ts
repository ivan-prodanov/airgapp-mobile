// Wires the real (native) search sources into the pure searchProvider orchestrator and exposes debounced
// results. Logic only — the search field UI is out of scope. Progressive: local results render instantly,
// then the merged (local + Apple) list replaces them when Apple returns.
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';

import { appleComplete, appleResolve } from '@/services/appleSearch';
import type { Place, SearchRegion } from '@/services/place';
import { normalizeQuery } from '@/services/place';
import { initPlaceSources, recents, searchLocal } from '@/services/placeSource';
import { runSearch, type SearchDeps } from '@/services/searchProvider';

const DEBOUNCE_MS = 200;

export function useNavigateSearch(region: SearchRegion) {
  const [query, setQuery] = useState('');
  const [results, setResults] = useState<Place[]>([]);
  const seq = useRef(0); // drop stale async responses

  const deps: SearchDeps = useMemo(
    () => ({ localSearch: searchLocal, appleComplete, recents }),
    [],
  );

  // Open the gazetteer once.
  useEffect(() => {
    void initPlaceSources();
  }, []);

  useEffect(() => {
    const mine = ++seq.current;
    const q = normalizeQuery(query);

    // Instant offline feedback (empty query → recents).
    setResults(q ? searchLocal(q, region) : recents());

    if (!q) return;
    const timer = setTimeout(() => {
      void runSearch(query, region, deps).then((merged) => {
        if (seq.current === mine) setResults(merged);
      });
    }, DEBOUNCE_MS);
    return () => clearTimeout(timer);
  }, [query, region, deps]);

  const resolve = useCallback((p: Place) => appleResolve(p, region), [region]);

  return { query, setQuery, results, resolve };
}
