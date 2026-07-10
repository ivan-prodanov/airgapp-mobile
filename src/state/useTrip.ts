// Holds the in-memory trip and exposes mutators over the pure ops in trip.ts. Session-only (Cancel/clear
// discards it). The screen state machine lives in location.tsx.
import { useCallback, useEffect, useRef, useState } from 'react';

import type { Place } from '@/services/place';
import type { Charger } from '@/services/tomtom';
import type { LatLng } from '@/state/mockLocation';
import { appStorage } from './appStorage';
import { makeSaver } from './persistence';
import {
  addCharger as addChargerOp,
  addStop as addStopOp,
  carStop,
  insertCharger as insertChargerOp,
  insertStop as insertStopOp,
  removeStop as removeStopOp,
  reorderStops as reorderStopsOp,
  startTrip,
  type Trip,
  type TripStop,
} from './trip';
import { TRIP_SNAPSHOT_KEY, loadTripSnapshotFrom, saveTripSnapshotTo } from './tripSnapshot';

// Debounced snapshot writer (frequent trip edits collapse to one write). Uses the real native backend;
// this file is a hook, never node-tested, so importing appStorage/AsyncStorage here is safe.
const saveSnapshot = makeSaver<Trip | null>(appStorage, TRIP_SNAPSHOT_KEY, 400);

export function useTrip() {
  const [trip, setTrip] = useState<Trip | null>(null);
  const [savedExists, setSavedExists] = useState(false);
  // Mirror of `trip` for synchronous reads (addToSaved) without a stale closure or a setState round-trip.
  const tripRef = useRef<Trip | null>(trip);
  tripRef.current = trip;

  // Check once on mount whether a persisted "last trip" exists — but do NOT load it into the session
  // (a normal launch stays clean; no stale route on the map).
  useEffect(() => {
    void loadTripSnapshotFrom(appStorage).then((t) => setSavedExists(!!t));
  }, []);

  // Persist a snapshot of every trip change (debounced); keep savedExists in sync. Only ever write a TRUTHY
  // trip — never persist null, so the initial mount (trip === null) and clearing the active trip both leave
  // the previously-saved "last trip" snapshot intact.
  useEffect(() => {
    if (trip) {
      saveSnapshot(trip);
      setSavedExists(true);
    }
  }, [trip]);

  const start = useCallback((carCoord: LatLng, place: Place) => setTrip(startTrip(carStop(carCoord), place)), []);
  const addStop = useCallback((place: Place) => setTrip((t) => (t ? addStopOp(t, place) : t)), []);
  const insertStop = useCallback((place: Place, index: number) => setTrip((t) => (t ? insertStopOp(t, place, index) : t)), []);
  const addCharger = useCallback((c: Charger) => setTrip((t) => (t ? addChargerOp(t, c) : t)), []);
  const insertCharger = useCallback((c: Charger, index: number) => setTrip((t) => (t ? insertChargerOp(t, c, index) : t)), []);
  const removeStop = useCallback((id: string) => setTrip((t) => (t ? removeStopOp(t, id) : t)), []);
  const reorder = useCallback((from: number, to: number) => setTrip((t) => (t ? reorderStopsOp(t, from, to) : t)), []);
  const clear = useCallback(() => setTrip(null), []);
  // Replace the whole trip with a given ordered stop list (used to apply a reordered trip from the Share popup).
  const replaceStops = useCallback((stops: TripStop[]) => setTrip(stops.length ? { stops } : null), []);
  // Discard the trip entirely — session AND the persisted "last trip" — so nothing resurrects it (Cancel). The
  // debounced `saveSnapshot(null)` also cancels any pending truthy write; the direct write covers an immediate
  // relaunch before the debounce fires.
  const clearSaved = useCallback(() => {
    setTrip(null);
    setSavedExists(false);
    saveSnapshot(null);
    void saveTripSnapshotTo(appStorage, null);
  }, []);

  // Append to the active trip if one is in progress; else load the persisted snapshot and append (making it
  // active); else start a fresh single-destination trip. The snapshot load must resolve before the setState.
  const addToSaved = useCallback(async (place: Place) => {
    const active = tripRef.current;
    if (active) { setTrip(addStopOp(active, place)); return; }
    const snap = await loadTripSnapshotFrom(appStorage);
    setTrip(snap ? addStopOp(snap, place) : startTrip(carStop(place.coordinate ?? { latitude: 0, longitude: 0 }), place));
  }, []);

  return { trip, savedExists, start, addStop, insertStop, addCharger, insertCharger, removeStop, reorder, clear, addToSaved, replaceStops, clearSaved };
}
