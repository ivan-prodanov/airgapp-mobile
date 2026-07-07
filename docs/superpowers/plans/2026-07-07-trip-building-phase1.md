# Trip Building — Phase 1 (Trip Core) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Selecting a search result starts an in-memory **trip** (car always first) and shows a Trip bottom-sheet itinerary (stops + mocked battery %/times, Leave Now, Edit Trip, Send-to-Car mock, Cancel). No real routing yet.

**Architecture:** Pure trip model + itinerary math in `state/trip.ts` (node-tested). The bottom-sheet chrome is extracted from `LocationSheet` into a shared `BottomSheet` so `LocationSheet` (search/charging) and the new `TripSheet` (trip itinerary) both reuse it. `location.tsx` gains a `screen` state machine and drives the trip via a `useTrip` hook. Phase-1 legs are straight-line mocks; Phase 2 swaps in real Apple routing.

**Tech Stack:** React Native 0.85, TypeScript, `react-native` `Animated`/`PanResponder`, Node built-in test runner. **JS-only — no native rebuild this phase.**

## Global Constraints

- **JS-only this phase — NO native rebuild.** Deploy with `bash scripts/godot-ios/deploy-js.sh`.
- **Add NO dependencies. NO `expo prebuild`.**
- **Tests:** pure logic only via `node --import tsx --test`; register new `*.test.ts` in `package.json`'s `test` script. `state/trip.ts` must not import React Native.
- **The car is always `stops[0]`** — non-removable, non-reorderable. `removeStop` is a no-op on index 0; `reorderStops` clamps to `>= 1`.
- **Send to Car is a local mock** — no network, no Tesla API. The trip is **in-memory / session** (Cancel clears it).
- **Device:** CoreDevice `F3867E6E-E95F-5B2A-9C4E-06D1D72475A1`, bundle `local.airgapp.mobile`.

## File Structure

```
Pure (node:test):
  src/state/trip.ts                  CREATE  Trip model + ops + straightLineLegs + computeItinerary + tripTotals
  src/state/trip.test.ts             CREATE  ops + itinerary tests

App:
  src/state/useTrip.ts               CREATE  hook: { trip, start, addStop, addCharger, removeStop, reorder, clear }
  src/components/BottomSheet.tsx      CREATE  extracted sheet chrome (Animated + PanResponder + detents + handle)
  src/components/LocationSheet.tsx    MODIFY  render inside <BottomSheet> (behavior unchanged; re-export the FRAC consts)
  src/components/TripSheet.tsx        CREATE  Trip itinerary view (rows + Leave Now + Edit Trip + Send-to-Car + Cancel)
  src/app/location.tsx               MODIFY  `screen` state, useTrip, select→trip, render TripSheet, replace deep-link
  package.json                        MODIFY  register trip.test.ts
```

**Type/name contract (define once, reuse verbatim):**
- `TripStop = { id: string; kind: 'car'|'place'|'charger'; title: string; subtitle?: string; coordinate: LatLng }` (Task 1)
- `Trip = { stops: TripStop[] }` (Task 1)
- `Leg = { distanceM: number; durationS: number }` (Task 1)
- `ItineraryRow = { stop: TripStop; pct: number; at: number; chargeMinutes?: number }` (Task 1)
- `ItineraryOpts = { departAt; startPct; drainPctPerKm; chargerRestorePct; chargeMinutes }` + `DEFAULT_ITINERARY_OPTS` (Task 1)
- `computeItinerary(stops, legs, opts): ItineraryRow[]`, `straightLineLegs(stops): Leg[]`, `tripTotals(legs): { distanceM; durationS }` (Task 1)
- `useTrip()` → `{ trip: Trip|null, start(carCoord, place), addStop(place), addCharger(charger), removeStop(id), reorder(from,to), clear() }` (Task 2)
- `BottomSheetHandle = { expand(): void; collapse(): void; expandFull(): void }`; `<BottomSheet ref>{({dragHandlers, expandFull, collapseToMiddle}) => ReactNode}</BottomSheet>` (Task 3)
- `LatLng`, `Place`, `Charger` from existing modules.

---

### Task 1: Trip model + itinerary math (pure)

**Files:** Create `src/state/trip.ts`, `src/state/trip.test.ts`; Modify `package.json`.

**Interfaces:** Produces all the Task-1 contract types/functions above. Consumes `Place` (`@/services/place`), `Charger` (`@/services/tomtom`), `LatLng` (`@/state/mockLocation`) — types only, no runtime RN import.

- [ ] **Step 1: Write the failing test** — `src/state/trip.test.ts`

```ts
import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  carStop, startTrip, addStop, addCharger, removeStop, reorderStops,
  straightLineLegs, computeItinerary, tripTotals, type TripStop, type Leg,
} from './trip';
import type { Place } from '@/services/place';
import type { Charger } from '@/services/tomtom';

const CAR = { latitude: 42.7, longitude: 23.3 };
const place = (id: string, lat: number, lng: number): Place => ({
  id, title: id, subtitle: `${id} addr`, coordinate: { latitude: lat, longitude: lng }, kind: 'poi', source: 'apple',
});
const charger = (id: string): Charger => ({
  id, name: `Charger ${id}`, place: 'P', region: 'R', latitude: 42.8, longitude: 23.4,
  currentType: 'DC', maxPowerKW: 150, totalConnectors: 4, availableConnectors: 4, connectors: [], distanceM: 0,
});

test('startTrip puts the car first, then the place', () => {
  const t = startTrip(carStop(CAR), place('Vidin', 43.99, 22.88));
  assert.deepEqual(t.stops.map((s) => s.kind), ['car', 'place']);
  assert.equal(t.stops[0].title, 'Car location');
  assert.equal(t.stops[1].title, 'Vidin');
});

test('addStop / addCharger append', () => {
  let t = startTrip(carStop(CAR), place('A', 43, 23));
  t = addCharger(t, charger('c1'));
  t = addStop(t, place('B', 44, 24));
  assert.deepEqual(t.stops.map((s) => s.kind), ['car', 'place', 'charger', 'place']);
});

test('removeStop never removes the car', () => {
  let t = startTrip(carStop(CAR), place('A', 43, 23));
  t = removeStop(t, t.stops[0].id); // try to remove car → no-op
  assert.equal(t.stops.length, 2);
  t = removeStop(t, t.stops[1].id); // remove the place
  assert.deepEqual(t.stops.map((s) => s.kind), ['car']);
});

test('reorderStops keeps the car pinned at index 0', () => {
  let t = startTrip(carStop(CAR), place('A', 43, 23));
  t = addStop(t, place('B', 44, 24));
  t = reorderStops(t, 2, 1); // move B before A
  assert.deepEqual(t.stops.map((s) => s.title), ['Car location', 'B', 'A']);
  const same = reorderStops(t, 0, 1); // trying to move the car → unchanged
  assert.deepEqual(same.stops.map((s) => s.title), ['Car location', 'B', 'A']);
});

test('straightLineLegs returns one leg per consecutive pair with positive distance', () => {
  const stops: TripStop[] = [carStop(CAR), { id: 'x', kind: 'place', title: 'X', coordinate: { latitude: 43.7, longitude: 23.3 } }];
  const legs = straightLineLegs(stops);
  assert.equal(legs.length, 1);
  assert.ok(legs[0].distanceM > 100_000 && legs[0].distanceM < 120_000); // ~111 km/deg lat
  assert.ok(legs[0].durationS > 0);
});

test('computeItinerary drains per km, restores at chargers, advances time', () => {
  const stops: TripStop[] = [
    carStop(CAR),
    { id: 'c', kind: 'charger', title: 'C', coordinate: CAR },
    { id: 'd', kind: 'place', title: 'D', coordinate: CAR },
  ];
  const legs: Leg[] = [{ distanceM: 100_000, durationS: 3600 }, { distanceM: 50_000, durationS: 1800 }];
  const rows = computeItinerary(stops, legs, {
    departAt: 0, startPct: 90, drainPctPerKm: 0.2, chargerRestorePct: 80, chargeMinutes: 8,
  });
  assert.equal(rows.length, 3);
  assert.equal(rows[0].pct, 90);              // car
  assert.equal(rows[1].pct, 70);              // 90 - 0.2*100 (arrival at charger)
  assert.equal(rows[1].chargeMinutes, 8);
  assert.equal(rows[1].at, 3_600_000);        // 1h
  assert.equal(rows[2].pct, 70);              // restored to 80 then -0.2*50
  assert.equal(rows[2].at, 3_600_000 + 8 * 60_000 + 1_800_000); // +8min charge +30min drive
});

test('tripTotals sums legs', () => {
  assert.deepEqual(tripTotals([{ distanceM: 10, durationS: 1 }, { distanceM: 5, durationS: 2 }]), { distanceM: 15, durationS: 3 });
});
```

- [ ] **Step 2: Run it, verify it fails**

Run: `node --import tsx --test src/state/trip.test.ts`
Expected: FAIL — `Cannot find module './trip'`.

- [ ] **Step 3: Write `src/state/trip.ts`**

```ts
// Trip planning model + itinerary math. Pure — NO React Native imports (node-testable). stops[0] is always
// the car (non-removable, non-reorderable). Phase 1 uses straight-line legs; Phase 2 swaps in real Apple
// routing (same computeItinerary, different `legs`). Energy numbers are deliberately mocked.
import type { Place } from '@/services/place';
import type { Charger } from '@/services/tomtom';
import type { LatLng } from '@/state/mockLocation';

export type StopKind = 'car' | 'place' | 'charger';
export interface TripStop {
  id: string;
  kind: StopKind;
  title: string;
  subtitle?: string;
  coordinate: LatLng;
}
export interface Trip {
  stops: TripStop[];
}
export interface Leg {
  distanceM: number;
  durationS: number;
}
export interface ItineraryRow {
  stop: TripStop;
  pct: number; // battery % on arrival (mock)
  at: number; // arrival time, epoch ms
  chargeMinutes?: number; // dwell for charger stops (mock)
}

export function carStop(coordinate: LatLng): TripStop {
  return { id: 'car', kind: 'car', title: 'Car location', coordinate };
}
export function placeToStop(place: Place): TripStop {
  return {
    id: `place:${place.id}`,
    kind: 'place',
    title: place.title,
    subtitle: place.subtitle,
    coordinate: place.coordinate ?? { latitude: 0, longitude: 0 },
  };
}
export function chargerToStop(c: Charger): TripStop {
  return {
    id: `charger:${c.id}`,
    kind: 'charger',
    title: c.name,
    subtitle: c.region || c.place,
    coordinate: { latitude: c.latitude, longitude: c.longitude },
  };
}

export function startTrip(car: TripStop, place: Place): Trip {
  return { stops: [car, placeToStop(place)] };
}
export function addStop(trip: Trip, place: Place): Trip {
  return { stops: [...trip.stops, placeToStop(place)] };
}
export function addCharger(trip: Trip, c: Charger): Trip {
  return { stops: [...trip.stops, chargerToStop(c)] };
}
// Remove by id, but never the car (index 0).
export function removeStop(trip: Trip, id: string): Trip {
  return { stops: trip.stops.filter((s, i) => i === 0 || s.id !== id) };
}
// Move stops[from] → to, with both indices clamped to >= 1 so the car stays first.
export function reorderStops(trip: Trip, from: number, to: number): Trip {
  const n = trip.stops.length;
  if (from < 1 || from >= n || to < 1 || to >= n || from === to) return trip;
  const stops = [...trip.stops];
  const [moved] = stops.splice(from, 1);
  stops.splice(to, 0, moved);
  return { stops };
}

const EARTH_M = 6_371_000;
function haversineM(a: LatLng, b: LatLng): number {
  const toRad = (d: number) => (d * Math.PI) / 180;
  const dLat = toRad(b.latitude - a.latitude);
  const dLng = toRad(b.longitude - a.longitude);
  const la1 = toRad(a.latitude);
  const la2 = toRad(b.latitude);
  const h = Math.sin(dLat / 2) ** 2 + Math.cos(la1) * Math.cos(la2) * Math.sin(dLng / 2) ** 2;
  return 2 * EARTH_M * Math.asin(Math.sqrt(h));
}

const MOCK_SPEED_MPS = 80_000 / 3600; // ~80 km/h, for phase-1 mock durations
// Phase-1 mock legs: straight-line distance + a nominal speed. Replaced by real Apple route legs in Phase 2.
export function straightLineLegs(stops: TripStop[]): Leg[] {
  const legs: Leg[] = [];
  for (let i = 1; i < stops.length; i += 1) {
    const distanceM = haversineM(stops[i - 1].coordinate, stops[i].coordinate);
    legs.push({ distanceM, durationS: distanceM / MOCK_SPEED_MPS });
  }
  return legs;
}

export interface ItineraryOpts {
  departAt: number; // epoch ms
  startPct: number;
  drainPctPerKm: number;
  chargerRestorePct: number;
  chargeMinutes: number;
}
export const DEFAULT_ITINERARY_OPTS: Omit<ItineraryOpts, 'departAt'> = {
  startPct: 90,
  drainPctPerKm: 0.18,
  chargerRestorePct: 80,
  chargeMinutes: 8,
};

// Battery % + arrival time per stop. `legs[i-1]` is the leg into stops[i]. Chargers restore to
// chargerRestorePct and add chargeMinutes of dwell AFTER arrival. All numbers are mock.
export function computeItinerary(stops: TripStop[], legs: Leg[], opts: ItineraryOpts): ItineraryRow[] {
  const rows: ItineraryRow[] = [];
  let pct = opts.startPct;
  let at = opts.departAt;
  rows.push({ stop: stops[0], pct, at });
  for (let i = 1; i < stops.length; i += 1) {
    const leg = legs[i - 1] ?? { distanceM: 0, durationS: 0 };
    pct = Math.max(0, pct - opts.drainPctPerKm * (leg.distanceM / 1000));
    at += leg.durationS * 1000;
    const stop = stops[i];
    if (stop.kind === 'charger') {
      rows.push({ stop, pct, at, chargeMinutes: opts.chargeMinutes });
      pct = opts.chargerRestorePct;
      at += opts.chargeMinutes * 60_000;
    } else {
      rows.push({ stop, pct, at });
    }
  }
  return rows;
}

export function tripTotals(legs: Leg[]): { distanceM: number; durationS: number } {
  return legs.reduce(
    (acc, l) => ({ distanceM: acc.distanceM + l.distanceM, durationS: acc.durationS + l.durationS }),
    { distanceM: 0, durationS: 0 },
  );
}
```

- [ ] **Step 4: Run the test, verify it passes**

Run: `node --import tsx --test src/state/trip.test.ts`
Expected: PASS (7 tests).

- [ ] **Step 5: Register the test** — in `package.json`, append `src/state/trip.test.ts` to the `test` script (keep all existing entries):

```json
    "test": "node --import tsx --test src/state/fleet.test.ts src/state/controlActions.test.ts src/state/preferences.test.ts src/state/persistence.test.ts src/services/gazetteer.test.ts src/services/place.test.ts src/services/searchProvider.test.ts src/services/recents.test.ts src/state/trip.test.ts"
```

- [ ] **Step 6: Commit**

```bash
git add src/state/trip.ts src/state/trip.test.ts package.json
git commit -m "feat(trip): trip model + itinerary math (pure)"
```

---

### Task 2: `useTrip` hook

**Files:** Create `src/state/useTrip.ts`.

**Interfaces:** Consumes the Task-1 ops. Produces `useTrip()` → `{ trip, start, addStop, addCharger, removeStop, reorder, clear }`.

- [ ] **Step 1: Create `src/state/useTrip.ts`**

```ts
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
```

- [ ] **Step 2: Typecheck**

Run: `npx tsc --noEmit -p tsconfig.json`
Expected: no errors from `useTrip.ts`.

- [ ] **Step 3: Commit**

```bash
git add src/state/useTrip.ts
git commit -m "feat(trip): useTrip hook"
```

---

### Task 3: Extract `BottomSheet` chrome (refactor — search behavior unchanged)

**Files:** Create `src/components/BottomSheet.tsx`; Modify `src/components/LocationSheet.tsx`.

**Interfaces:** Produces `BottomSheetHandle` + `<BottomSheet>` (render-prop). `LocationSheet` re-exports `SHEET_MIDDLE_FRAC`/`SHEET_MINIMAL_FRAC` (location.tsx imports them from LocationSheet). `LocationSheetHandle` becomes an alias of `BottomSheetHandle`.

> This moves the Animated.View + PanResponder + detents + handle out of `LocationSheet`. Verify the search/charging sheet still behaves identically afterward (Task 6 deploy).

- [ ] **Step 1: Create `src/components/BottomSheet.tsx`** (moves the chrome verbatim from LocationSheet)

```tsx
import { forwardRef, useCallback, useImperativeHandle, useMemo, useRef, type ReactNode } from 'react';
import { Animated, PanResponder, StyleSheet, useWindowDimensions, View, type GestureResponderHandlers } from 'react-native';

// Visible fraction of the screen at each detent (measured off the Tesla app's three states). Exported so the
// map can pad its centring/fitting by these panel heights.
export const SHEET_MINIMAL_FRAC = 0.25;
export const SHEET_MIDDLE_FRAC = 0.34;
const SHEET_FULL_FRAC = 0.92;

export interface BottomSheetHandle {
  expand: () => void; // open at least to the middle detent (never shrinks)
  collapse: () => void; // drop to the minimal detent
  expandFull: () => void; // open to the full detent
}

interface RenderProps {
  dragHandlers: GestureResponderHandlers;
  expandFull: () => void;
  collapseToMiddle: () => void;
}
interface Props {
  children: (props: RenderProps) => ReactNode;
}

const OVERDRAG_RESIST = 2.5;
const overDrag = (y: number, expanded: number, collapsed: number) => {
  if (y < expanded) return expanded - Math.sqrt(1 + (expanded - y)) * OVERDRAG_RESIST;
  if (y > collapsed) return collapsed + Math.sqrt(1 + (y - collapsed)) * OVERDRAG_RESIST;
  return y;
};

// Bottom-anchored panel dragged by its top handle between three detents (full / middle / minimal), shared by
// LocationSheet (search/charging) and TripSheet (itinerary).
export const BottomSheet = forwardRef<BottomSheetHandle, Props>(function BottomSheet({ children }, ref) {
  const { height } = useWindowDimensions();
  const SHEET_H = Math.round(height * SHEET_FULL_FRAC);
  const snaps = useMemo(() => {
    const full = 0;
    const middle = Math.round(SHEET_H - height * SHEET_MIDDLE_FRAC);
    const minimal = Math.round(SHEET_H - height * SHEET_MINIMAL_FRAC);
    return { full, middle, minimal, points: [full, middle, minimal] };
  }, [SHEET_H, height]);
  const snapsRef = useRef(snaps);
  snapsRef.current = snaps;

  const translateY = useRef(new Animated.Value(snaps.middle)).current;
  const restingY = useRef(snaps.middle);

  const settle = useCallback(
    (target: number, velocityY = 0) => {
      restingY.current = target;
      Animated.spring(translateY, {
        toValue: target,
        velocity: velocityY * 500,
        stiffness: 1000,
        damping: 500,
        mass: 3,
        overshootClamping: true,
        restDisplacementThreshold: 0.5,
        restSpeedThreshold: 0.5,
        useNativeDriver: true,
      }).start();
    },
    [translateY],
  );

  useImperativeHandle(
    ref,
    () => ({
      expand: () => settle(Math.min(restingY.current, snapsRef.current.middle)),
      collapse: () => settle(snapsRef.current.minimal),
      expandFull: () => settle(snapsRef.current.full),
    }),
    [settle],
  );

  const pan = useRef(
    PanResponder.create({
      onMoveShouldSetPanResponderCapture: (_e, g) => Math.abs(g.dy) > 8 && Math.abs(g.dy) > Math.abs(g.dx),
      onPanResponderMove: (_e, g) => {
        const s = snapsRef.current;
        translateY.setValue(overDrag(restingY.current + g.dy, s.full, s.minimal));
      },
      onPanResponderRelease: (_e, g) => {
        const s = snapsRef.current;
        const projected = restingY.current + g.dy + g.vy * 200;
        const target = s.points.reduce(
          (best, p) => (Math.abs(p - projected) < Math.abs(best - projected) ? p : best),
          s.points[0],
        );
        settle(target, g.vy);
      },
    }),
  ).current;

  const renderProps: RenderProps = {
    dragHandlers: pan.panHandlers,
    expandFull: () => settle(snapsRef.current.full),
    collapseToMiddle: () => settle(snapsRef.current.middle),
  };

  return (
    <Animated.View style={[styles.sheet, { height: SHEET_H, transform: [{ translateY }] }]}>
      <View style={styles.handleWrap} {...pan.panHandlers}>
        <View style={styles.handle} />
      </View>
      {children(renderProps)}
    </Animated.View>
  );
});

const styles = StyleSheet.create({
  sheet: {
    position: 'absolute',
    left: 0,
    right: 0,
    bottom: 0,
    backgroundColor: '#161616',
    borderTopLeftRadius: 16,
    borderTopRightRadius: 16,
    shadowColor: '#000',
    shadowOffset: { width: 0, height: -8 },
    shadowOpacity: 0.5,
    shadowRadius: 16,
  },
  handleWrap: { alignItems: 'center', paddingTop: 8, paddingBottom: 12 },
  handle: { width: 38, height: 5, borderRadius: 3, backgroundColor: 'rgba(255,255,255,0.28)' },
});
```

- [ ] **Step 2: Refactor `LocationSheet.tsx` to use `BottomSheet`.**

(a) Replace the top imports block. Remove `Animated`, `PanResponder`, `useImperativeHandle`, `useWindowDimensions` usage that moved to BottomSheet; import `BottomSheet` + its handle + the FRAC re-exports. Change the first two import lines to:

```tsx
import { forwardRef, useRef, useState, type ReactNode, type RefObject } from 'react';
import {
  Linking,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  View,
  type GestureResponderHandlers,
} from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { SymbolView, type SFSymbol } from 'expo-symbols';

import { BottomSheet, SHEET_MIDDLE_FRAC, SHEET_MINIMAL_FRAC, type BottomSheetHandle } from './BottomSheet';
```

Keep the existing `@/state/mockLocation`, `@/services/place`, `@/services/recents`, and `@/services/tomtom` imports as they are.

(b) Re-export the FRAC consts + alias the handle type (replace the old `export const SHEET_MINIMAL_FRAC/... SHEET_FULL_FRAC` block and the `LocationSheetHandle` interface):

```tsx
export { SHEET_MIDDLE_FRAC, SHEET_MINIMAL_FRAC } from './BottomSheet';
export type LocationSheetHandle = BottomSheetHandle;
```

(c) Replace the whole body of the `LocationSheet` `forwardRef` component (everything from `const { height } = useWindowDimensions();` through the closing `});` of the returned `<Animated.View>`) with a `BottomSheet` render-prop wrapper:

```tsx
export const LocationSheet = forwardRef<LocationSheetHandle, Props>(function LocationSheet(
  { tab, onTabChange, chargers, availability, sort, onSortChange, filter, onFilterChange, selectedCharger, onSelectCharger, onCloseDetail, onNavigateCharger, query, onChangeQuery, results, recentGroups, carCoord, onSelectPlace },
  ref,
) {
  const insetBottom = useSafeAreaInsets().bottom;
  const [searchFocused, setSearchFocused] = useState(false);

  return (
    <BottomSheet ref={ref}>
      {({ dragHandlers, expandFull, collapseToMiddle }) => {
        const openSearch = () => {
          setSearchFocused(true);
          expandFull();
        };
        const closeSearch = () => {
          setSearchFocused(false);
          collapseToMiddle();
        };
        return tab === 'recents' ? (
          <RecentsView
            insetBottom={insetBottom}
            dragHandlers={dragHandlers}
            onTabChange={onTabChange}
            focused={searchFocused}
            onFocus={openSearch}
            onExit={closeSearch}
            query={query}
            onChangeQuery={onChangeQuery}
            results={results}
            recentGroups={recentGroups}
            carCoord={carCoord}
            onSelectPlace={onSelectPlace}
          />
        ) : (
          <ChargingView
            chargers={chargers}
            availability={availability}
            sort={sort}
            onSortChange={onSortChange}
            filter={filter}
            onFilterChange={onFilterChange}
            selectedCharger={selectedCharger}
            onSelectCharger={onSelectCharger}
            onCloseDetail={onCloseDetail}
            onNavigateCharger={onNavigateCharger}
            onClose={() => onTabChange('recents')}
            dragHandlers={dragHandlers}
          />
        );
      }}
    </BottomSheet>
  );
});
```

(d) In the `styles` object at the bottom of LocationSheet, **delete** the now-unused `sheet`, `handleWrap`, and `handle` rules (they moved to BottomSheet). Leave everything else.

- [ ] **Step 3: Typecheck**

Run: `npx tsc --noEmit -p tsconfig.json`
Expected: no errors from `LocationSheet.tsx` / `BottomSheet.tsx`. (location.tsx still imports `LocationSheetHandle`, `SHEET_MIDDLE_FRAC`, `SHEET_MINIMAL_FRAC` from `@/components/LocationSheet` — still exported, so unchanged.)

- [ ] **Step 4: Run the full suite (no regressions)**

Run: `npm test`
Expected: all PASS (logic unaffected).

- [ ] **Step 5: Commit**

```bash
git add src/components/BottomSheet.tsx src/components/LocationSheet.tsx
git commit -m "refactor(location): extract BottomSheet chrome (shared by LocationSheet + TripSheet)"
```

---

### Task 4: `TripSheet` — the itinerary view

**Files:** Create `src/components/TripSheet.tsx`.

**Interfaces:** Consumes `BottomSheet` (Task 3); `computeItinerary`, `straightLineLegs`, `tripTotals`, `DEFAULT_ITINERARY_OPTS`, `type Trip`, `type ItineraryRow` (Task 1); `formatKm` (`@/state/mockLocation`). Produces `<TripSheet ref>` with `TripSheetHandle = BottomSheetHandle` and props `{ trip, onEditTrip, onSendToCar, onCancel }`.

- [ ] **Step 1: Create `src/components/TripSheet.tsx`**

```tsx
import { forwardRef } from 'react';
import { Pressable, ScrollView, StyleSheet, Text, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { SymbolView, type SFSymbol } from 'expo-symbols';

import { BottomSheet, type BottomSheetHandle } from './BottomSheet';
import { formatKm } from '@/state/mockLocation';
import {
  computeItinerary,
  straightLineLegs,
  tripTotals,
  DEFAULT_ITINERARY_OPTS,
  type ItineraryRow,
  type Trip,
} from '@/state/trip';

export type TripSheetHandle = BottomSheetHandle;

interface Props {
  trip: Trip;
  now: number; // departure clock (epoch ms); passed in so the component stays deterministic
  onEditTrip: () => void;
  onSendToCar: () => void;
  onCancel: () => void;
}

const ICON: Record<ItineraryRow['stop']['kind'], SFSymbol> = {
  car: 'car.fill',
  charger: 'bolt.fill',
  place: 'mappin',
};

function hhmm(at: number): string {
  const d = new Date(at);
  return `${d.getHours()}:${String(d.getMinutes()).padStart(2, '0')}`;
}
function hoursMins(totalS: number): string {
  const m = Math.round(totalS / 60);
  const h = Math.floor(m / 60);
  return h > 0 ? `${h}h ${m % 60}m` : `${m}m`;
}

export const TripSheet = forwardRef<TripSheetHandle, Props>(function TripSheet(
  { trip, now, onEditTrip, onSendToCar, onCancel },
  ref,
) {
  const insetBottom = useSafeAreaInsets().bottom;
  const legs = straightLineLegs(trip.stops); // Phase 1 mock; Phase 2 → real Apple legs
  const rows = computeItinerary(trip.stops, legs, { ...DEFAULT_ITINERARY_OPTS, departAt: now });
  const totals = tripTotals(legs);

  return (
    <BottomSheet ref={ref}>
      {({ dragHandlers }) => (
        <View style={styles.content}>
          <View {...dragHandlers} style={styles.header}>
            <Pressable style={styles.leaveBtn} onPress={() => {}}>
              <Text style={styles.leaveText}>Leave Now</Text>
              <SymbolView name="chevron.right" tintColor="rgba(255,255,255,0.6)" size={13} weight="semibold" />
            </Pressable>
            <Pressable hitSlop={10} onPress={onEditTrip}>
              <Text style={styles.editText}>Edit Trip</Text>
            </Pressable>
          </View>

          <ScrollView
            style={styles.scroll}
            contentContainerStyle={{ paddingTop: 8, paddingBottom: 12 }}
            showsVerticalScrollIndicator={false}
          >
            {rows.map((row, i) => (
              <View key={row.stop.id} style={styles.row}>
                <View style={styles.railCol}>
                  <SymbolView
                    name={ICON[row.stop.kind]}
                    tintColor={row.stop.kind === 'charger' ? '#E5484D' : row.stop.kind === 'car' ? '#3E6AE1' : 'rgba(255,255,255,0.75)'}
                    size={18}
                  />
                  {i < rows.length - 1 ? <View style={styles.rail} /> : null}
                </View>
                <View style={styles.rowText}>
                  <Text style={styles.rowTitle} numberOfLines={1}>
                    {row.stop.title}
                  </Text>
                  <Text style={styles.rowMeta} numberOfLines={1}>
                    {row.stop.kind === 'car'
                      ? `${Math.round(row.pct)}% · Set Departure Energy`
                      : [
                          `${Math.round(row.pct)}%`,
                          row.chargeMinutes ? `⚡ ${row.chargeMinutes} min` : null,
                          hhmm(row.at),
                        ]
                          .filter(Boolean)
                          .join(' · ')}
                  </Text>
                </View>
              </View>
            ))}
          </ScrollView>

          <View style={[styles.footer, { paddingBottom: insetBottom + 8 }]}>
            <Pressable style={styles.sendBtn} onPress={onSendToCar}>
              <Text style={styles.sendText}>
                Send to Car · {hoursMins(totals.durationS)} · {formatKm(totals.distanceM / 1000)}
              </Text>
            </Pressable>
            <Pressable hitSlop={8} onPress={onCancel} style={styles.cancelBtn}>
              <Text style={styles.cancelText}>Cancel</Text>
            </Pressable>
          </View>
        </View>
      )}
    </BottomSheet>
  );
});

const styles = StyleSheet.create({
  content: { flex: 1 },
  header: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: 20,
    marginTop: 2,
    marginBottom: 12,
  },
  leaveBtn: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    height: 34,
    paddingHorizontal: 14,
    borderRadius: 10,
    backgroundColor: 'rgba(255,255,255,0.08)',
  },
  leaveText: { fontSize: 15, fontWeight: '600', color: 'white' },
  editText: { fontSize: 16, fontWeight: '600', color: '#3E6AE1' },
  scroll: { flex: 1 },
  row: { flexDirection: 'row', gap: 14, paddingHorizontal: 20 },
  railCol: { alignItems: 'center', width: 22 },
  rail: { flex: 1, width: 2, backgroundColor: 'rgba(255,255,255,0.15)', marginVertical: 2 },
  rowText: { flex: 1, paddingBottom: 22 },
  rowTitle: { fontSize: 17, fontWeight: '700', color: 'white' },
  rowMeta: { fontSize: 14, color: 'rgba(255,255,255,0.5)', marginTop: 3 },
  footer: { paddingHorizontal: 16, paddingTop: 8, gap: 10 },
  sendBtn: { height: 52, borderRadius: 12, backgroundColor: '#3E6AE1', alignItems: 'center', justifyContent: 'center' },
  sendText: { fontSize: 17, fontWeight: '700', color: 'white' },
  cancelBtn: { alignItems: 'center', paddingVertical: 6 },
  cancelText: { fontSize: 16, color: 'rgba(255,255,255,0.7)' },
});
```

- [ ] **Step 2: Typecheck**

Run: `npx tsc --noEmit -p tsconfig.json`
Expected: no errors from `TripSheet.tsx`.

- [ ] **Step 3: Commit**

```bash
git add src/components/TripSheet.tsx
git commit -m "feat(trip): TripSheet itinerary view (mock energy/times, Send-to-Car mock)"
```

---

### Task 5: Wire `location.tsx` — screen state machine + build-a-trip

**Files:** Modify `src/app/location.tsx`.

**Interfaces:** Consumes `useTrip` (Task 2), `TripSheet` (Task 4). Replaces the `onNavigateToCharger` deep-link with a trip start.

- [ ] **Step 1: Add imports**

```ts
import { useTrip } from '@/state/useTrip';
import { TripSheet, type TripSheetHandle } from '@/components/TripSheet';
```

- [ ] **Step 2: Add screen state + trip hook + a departure clock.** In the component body, after the existing `const nav = useNavigateSearch(region);` line, add:

```tsx
  const trip = useTrip();
  const [screen, setScreen] = useState<'search' | 'trip'>('search');
  const tripSheetRef = useRef<TripSheetHandle>(null);
  // Departure clock for the itinerary (set when a trip starts, so times are stable while viewing).
  const [departAt, setDepartAt] = useState(0);
```

- [ ] **Step 3: Route place selection into a trip.** Replace the `onSelectPlace={nav.select}` prop passed to `<LocationSheet>` with a handler that also builds the trip. Add this callback in the component body (near the other handlers):

```tsx
  const onSelectPlace = (place: import('@/services/place').Place) => {
    nav.select(place); // still records a recent
    trip.start(carCoord, place);
    setDepartAt(Date.now());
    setScreen('trip');
    tripSheetRef.current?.expand();
  };
```

Then change the prop on `<LocationSheet>`: `onSelectPlace={onSelectPlace}`.

- [ ] **Step 4: Render the TripSheet when a trip is active.** Replace the single `<LocationSheet ... />` element with a conditional on `screen`:

```tsx
      {screen === 'trip' && trip.trip ? (
        <TripSheet
          ref={tripSheetRef}
          trip={trip.trip}
          now={departAt}
          onEditTrip={() => {}}
          onSendToCar={() => {}}
          onCancel={() => {
            trip.clear();
            setScreen('search');
          }}
        />
      ) : (
        <LocationSheet
          ref={sheetRef}
          tab={tab}
          onTabChange={setTab}
          chargers={listChargers}
          availability={availability}
          sort={sort}
          onSortChange={setSort}
          filter={filter}
          onFilterChange={setFilter}
          selectedCharger={selectedCharger}
          onSelectCharger={onSelectCharger}
          onCloseDetail={onCloseDetail}
          onNavigateCharger={onNavigateToCharger}
          query={nav.query}
          onChangeQuery={nav.setQuery}
          results={nav.results}
          recentGroups={nav.recentGroups}
          carCoord={carCoord}
          onSelectPlace={onSelectPlace}
        />
      )}
```

- [ ] **Step 5: Point the charger-detail "navigate" at a trip too** (replaces the Apple-Maps deep-link). Change `onNavigateToCharger` (currently opens `maps://`) to start/append a trip with the charger as a place. Replace its body:

```tsx
  const onNavigateToCharger = (c: Charger) => {
    const place: import('@/services/place').Place = {
      id: `charger:${c.id}`,
      title: c.name,
      subtitle: c.region || c.place,
      coordinate: { latitude: c.latitude, longitude: c.longitude },
      kind: 'charger',
      source: 'charger',
    };
    onSelectPlace(place);
  };
```

(Leave the `onNavigate` map-button handler and its `maps://` deep-link as-is — that's the top-bar "directions" button, out of scope here.)

- [ ] **Step 6: Typecheck + full suite**

Run: `npx tsc --noEmit -p tsconfig.json && npm test`
Expected: tsc clean; all tests PASS.

- [ ] **Step 7: Commit**

```bash
git add src/app/location.tsx
git commit -m "feat(trip): screen state machine — selecting a place builds a trip"
```

---

### Task 6: Deploy (JS-only) + verify

**Files:** none.

- [ ] **Step 1: JS deploy**

Run: `bash scripts/godot-ios/deploy-js.sh`
Expected: `✓ done`.

- [ ] **Step 2: On-device check** (needs eyes on the phone):
  1. **Search still works** (regression from the BottomSheet extraction): open Location → tap Navigate → expands full, type `kaufland` → results; tabs + charging still work.
  2. **Select a result** → the **Trip sheet** appears: Car location (90% · Set Departure Energy) → the place (with % + time); "Leave Now", "Edit Trip", "Send to Car · Xh Ym · Z km", "Cancel".
  3. **Send to Car** → does nothing outward (local mock). **Edit Trip** → nothing yet (Phase 3).
  4. **Cancel** → back to search/recents (trip discarded).
  5. Charger detail → tapping the navigate/distance pill → also starts a trip to that charger.

- [ ] **Step 3: Commit** (only if a tweak was needed).

---

## Self-Review

**Spec coverage (Phase 1 slice):**
- Trip state + car-always-first + pure ops → Task 1. ✓
- In-memory/session + Cancel clears → Task 2 (`useTrip`) + Task 5 (`onCancel`). ✓
- Trip screen (itinerary, Leave Now mock, Edit Trip, Send-to-Car mock, Cancel) → Task 4. ✓
- Select-builds-trip / append-if-exists → Task 5 `onSelectPlace` (Phase 1 always starts fresh; append arrives with Add Stop in Phase 3). ✓
- Replace Apple-Maps deep-link hand-off → Task 5 Step 5. ✓
- Sheet chrome extracted/shared → Task 3. ✓
- Mocked energy/times → Task 1 `computeItinerary` + Task 4. ✓
- Send-to-Car = local no-op → Task 5 (`onSendToCar={() => {}}`). ✓
- Real route / Polyline / MKDirections → **Phase 2** (not this plan). Edit Trip screen / reorder / Add Charger → **Phase 3**.

**Placeholder scan:** none. `onEditTrip`/`onSendToCar` are intentional no-ops this phase (Edit Trip = Phase 3; Send-to-Car = permanent mock), not unfinished code. Straight-line legs are the deliberate Phase-1 route mock.

**Type/name consistency:** `TripStop`/`Trip`/`Leg`/`ItineraryRow`/`ItineraryOpts` (Task 1) used in `computeItinerary`/`straightLineLegs`/`tripTotals` (Task 1), `useTrip` (Task 2), `TripSheet` (Task 4). `BottomSheetHandle` (Task 3) aliased by `LocationSheetHandle` + `TripSheetHandle`. `useTrip()` shape (Task 2) matches Task 5 usage (`trip.trip`, `trip.start`, `trip.clear`). `DEFAULT_ITINERARY_OPTS` is `Omit<ItineraryOpts,'departAt'>` and Task 4 spreads `{ ...DEFAULT_ITINERARY_OPTS, departAt: now }` — consistent. ✓

---

## Execution Handoff

Phase 1 plan complete. Tasks 1-2 pure/testable; Task 3 is the sheet-chrome refactor (verify search unaffected); Tasks 4-5 UI wiring; Task 6 JS-only deploy + on-device check. Phases 2 (real Apple route) and 3 (Edit Trip) get their own plans after this lands.
