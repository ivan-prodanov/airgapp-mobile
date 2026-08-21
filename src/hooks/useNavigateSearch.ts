// Wires the real (native) search sources into the pure searchProvider and exposes debounced results plus
// persisted recents. Online = Apple (MKLocalSearch); offline = local gazetteer/charger. Logic seam for the
// LocationSheet search UI. `select` records a tapped place as a recent.
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';

import { onlineSearch } from '@/services/onlineSearch';
import { normalizeQuery, type Place, type SearchRegion } from '@/services/place';
import { initPlaceSources, searchLocal } from '@/services/placeSource';
import { groupRecentsByDay, type RecentGroup } from '@/services/recents';
import { addRecent, loadRecents } from '@/services/recentsStore';
import { runSearch, type SearchDeps } from '@/services/searchProvider';

const DEBOUNCE_MS = 300;

export function useNavigateSearch(region: SearchRegion) {
  const [query, setQuery] = useState('');
  const [results, setResults] = useState<Place[]>([]);
  const [recentGroups, setRecentGroups] = useState<RecentGroup[]>([]);
  const seq = useRef(0); // drop stale async responses

  // `appleSearch` is the SearchDeps field name (Apple was the only online source when it was
  // written); the value is now platform-chosen — Apple on iOS, Photon elsewhere.
  const deps: SearchDeps = useMemo(() => ({ appleSearch: onlineSearch, localSearch: searchLocal }), []);

  const refreshRecents = useCallback(() => {
    setRecentGroups(groupRecentsByDay(loadRecents(), Date.now()));
  }, []);

  // Open the gazetteer + load recents once.
  useEffect(() => {
    void initPlaceSources();
    refreshRecents();
  }, [refreshRecents]);

  // Debounced query → results (empty query clears the list; the UI shows recentGroups instead).
  useEffect(() => {
    const mine = ++seq.current;
    if (!normalizeQuery(query)) {
      setResults([]);
      return;
    }
    const timer = setTimeout(() => {
      void runSearch(query, region, deps).then((r) => {
        if (seq.current === mine) setResults(r);
      });
    }, DEBOUNCE_MS);
    return () => clearTimeout(timer);
  }, [query, region, deps]);

  // Record a tapped place as a recent, then refresh the recents groups.
  const select = useCallback(
    (place: Place) => {
      addRecent(place, Date.now());
      refreshRecents();
    },
    [refreshRecents],
  );

  return { query, setQuery, results, recentGroups, select };
}
