import { useCallback, useEffect, useMemo, useRef, useState } from 'react';

import { load, makeSaver, type AppStorage } from './persistence';

// useReducer + hydrate-from-storage + persist-on-change. Hydrates `key` once on mount (falling back
// to `initial`), then writes the new state (debounced) after every dispatch. `reducer` must be a
// stable reference (module-level function).
export function usePersistedReducer<S, A>(
  storage: AppStorage,
  key: string,
  initial: S,
  reducer: (state: S, action: A) => S,
): [S, (action: A) => void] {
  const [state, setState] = useState<S>(initial);
  const saver = useMemo(() => makeSaver<S>(storage, key), [storage, key]);
  const initialRef = useRef(initial);

  useEffect(() => {
    let cancelled = false;
    void load(storage, key, initialRef.current).then((loaded) => {
      if (!cancelled) {
        setState(loaded);
      }
    });
    return () => {
      cancelled = true;
    };
  }, [storage, key]);

  const dispatch = useCallback(
    (action: A) => {
      setState((current) => {
        const next = reducer(current, action);
        // Persist the exact committed value here (not in a useEffect): this avoids re-writing the
        // freshly hydrated value, and makeSaver's debounce collapses React StrictMode's dev double-invoke.
        saver(next);
        return next;
      });
    },
    [reducer, saver],
  );

  return [state, dispatch];
}
