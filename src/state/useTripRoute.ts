// Fetches the Apple route whenever the trip's stops change. Returns null while pending / when offline / for a
// <2-stop trip; the screen falls back to straight-line legs in that case. Stale responses are dropped.
import { useEffect, useState } from 'react';

import { appleRoute, type RouteResult } from '@/services/appleDirections';
import type { TripStop } from '@/state/trip';

export function useTripRoute(stops: TripStop[] | undefined): RouteResult | null {
  const [route, setRoute] = useState<RouteResult | null>(null);

  useEffect(() => {
    if (!stops || stops.length < 2) {
      setRoute(null);
      return;
    }
    let cancelled = false;
    setRoute(null); // clear the previous route while the new one loads
    appleRoute(stops.map((s) => s.coordinate))
      .then((r) => {
        if (!cancelled) setRoute(r);
      })
      .catch(() => {
        if (!cancelled) setRoute(null);
      });
    return () => {
      cancelled = true;
    };
  }, [stops]);

  return route;
}
