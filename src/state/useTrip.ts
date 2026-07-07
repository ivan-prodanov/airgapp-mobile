// Holds the in-memory trip and exposes mutators over the pure ops in trip.ts. Session-only (Cancel/clear
// discards it). The screen state machine lives in location.tsx.
import { useCallback, useState } from 'react';

import type { Place } from '@/services/place';
import type { Charger } from '@/services/tomtom';
import type { LatLng } from '@/state/mockLocation';
import {
  addCharger as addChargerOp,
  addStop as addStopOp,
  carStop,
  removeStop as removeStopOp,
  reorderStops as reorderStopsOp,
  startTrip,
  type Trip,
} from './trip';

export function useTrip() {
  const [trip, setTrip] = useState<Trip | null>(null);

  const start = useCallback((carCoord: LatLng, place: Place) => setTrip(startTrip(carStop(carCoord), place)), []);
  const addStop = useCallback((place: Place) => setTrip((t) => (t ? addStopOp(t, place) : t)), []);
  const addCharger = useCallback((c: Charger) => setTrip((t) => (t ? addChargerOp(t, c) : t)), []);
  const removeStop = useCallback((id: string) => setTrip((t) => (t ? removeStopOp(t, id) : t)), []);
  const reorder = useCallback((from: number, to: number) => setTrip((t) => (t ? reorderStopsOp(t, from, to) : t)), []);
  const clear = useCallback(() => setTrip(null), []);

  return { trip, start, addStop, addCharger, removeStop, reorder, clear };
}
