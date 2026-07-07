# Trip building — design

**Date:** 2026-07-07
**Status:** Approved design
**Builds on:** the Navigate search UI (`2026-07-07-navigate-search-ui-design.md`). Selecting a search result,
which currently just records a recent, now **builds a trip**.
**Scope:** trip planning UX (state + screens) + a real Apple route line/time/distance + drag-reorder.
**Mocked:** energy/battery %, "Set Departure Energy", "Leave Now", "Send to Car". **Out:** turn-by-turn
navigation, real vehicle energy modelling, real Send-to-Car (forbidden — see constraints).

## Problem

Selecting a place should start a **trip** (like the Tesla app): a route from the car through optional
waypoints/chargers to a destination, shown as a bottom-sheet itinerary + a route line on the map. Today
`onNavigateToCharger` just deep-links to Apple Maps — the code already marks this a placeholder "until there's
a trip/route concept". This replaces that hand-off with an in-app trip.

Reference (2026-07-07 screenshots): a Trip sheet (Car location → Sofia charger → Vidin) with per-stop battery
% + times, "Leave Now", "Edit Trip", and "Send to Car · 3h 45m · 212.2 km"; and an Edit Trip sheet with
reorderable rows, "Add Stop", and "Add Charger".

## Hard constraints

- **Send to Car must never reach Tesla's servers** (standing safety rule). The button is a **local mock** —
  no network, no Tesla API. It may show a local confirmation only.
- **The car is always the first stop**, non-removable and non-reorderable. (The ✕ shown on the car row in the
  reference Edit-Trip screenshot is intentionally omitted.)
- **No `expo prebuild`.** The one native addition (MKDirections) goes in the existing `AppleSearch` module +
  `pod install` + a full `xcodebuild` (Phase 2 only).

## Trip state (`src/state/trip.ts`) — pure, node-tested

```ts
type StopKind = 'car' | 'place' | 'charger';
interface TripStop { id: string; kind: StopKind; title: string; subtitle?: string; coordinate: LatLng }
interface Trip { stops: TripStop[] } // stops[0] is always the car
```

Pure operations (immutable; index 0 protected):
- `carStop(coord: LatLng): TripStop` → `{ id:'car', kind:'car', title:'Car location', coordinate }`.
- `placeToStop(place: Place): TripStop` / `chargerToStop(charger: Charger): TripStop`.
- `startTrip(car: TripStop, place: Place): Trip` → `{ stops:[car, placeToStop(place)] }`.
- `addStop(trip, place): Trip` / `addCharger(trip, charger): Trip` — append.
- `removeStop(trip, id): Trip` — remove by id; **no-op for the car / index 0**.
- `reorderStops(trip, from, to): Trip` — move a stop; `from`/`to` clamped to `>= 1` so the car stays first.

The trip is **in-memory / session** (ephemeral planning); `Cancel` clears it. Not persisted.

## Screen state machine (`location.tsx`)

`location.tsx` owns `screen: 'search' | 'trip' | 'editTrip' | 'addCharger'`; the `trip: Trip | null` and its
mutators come from the `useTrip` hook.

- **search** (today's recents/search/charging). Select a place →
  - no trip → `startTrip(carStop(carCoord), place)` → **trip**.
  - trip exists (reached via Add Stop) → `addStop` → **editTrip**.
- **trip** — the itinerary (below). Edit Trip → **editTrip**; Cancel → clear trip → **search**.
- **editTrip** — reorder/remove + Add Stop (→ **search**) + Add Charger (→ **addCharger**); Done → **trip**.
- **addCharger** — the charger picker scoped to the trip (below); select a charger → `addCharger` → **editTrip**.

## Trip screen (`components/TripSheet.tsx`)

Bottom sheet showing the itinerary:
- **Header row:** "Leave Now ›" (mock; opens nothing this pass) + "Edit Trip" (blue → editTrip).
- **Route list:** one row per stop — icon (car dot / charger bolt / destination pin), title, subtitle, and a
  mocked battery **%** + a **time** (arrival, computed from real leg durations). The car row shows the mock
  "Set Departure Energy".
- **Primary button:** "Send to Car · `{Xh Ym}` · `{Z km}`" — time/distance are the **real** MKDirections
  totals; tap is a **local no-op mock** (optionally a brief local confirmation), never a network call.
- **Cancel** — discard the trip → search.

## Edit Trip screen (`components/TripSheet.tsx`, editTrip mode)

- Reorderable stop list — each non-car row: ✕ (remove) + ☰ **drag handle**. **Drag-reorder is hand-rolled**
  (PanResponder measuring row offsets; the car row is fixed at top and non-draggable).
- **Add Stop** (grey) → **search** (append the selected place to the trip).
- **Add Charger** (red, bolt icon) → **addCharger**.
- **Done** → trip. **Cancel** → discard → search.

## Add Charger (`addCharger` screen)

Reuses the charger DB and list. Chargers are queried by `osmChargersInBounds` over the **bounding box of all
current trip stops** (padded), not the map viewport — "chargers between all selected points". Reuses the
existing charger row UI; selecting a charger appends a `charger` stop and returns to editTrip.

## Map (`location.tsx`)

- **Route line:** `<Polyline>` (from `react-native-maps`, blue) following the MKDirections-computed
  `polyline`, recomputed whenever `trip.stops` change. Hidden when offline / no route.
- **Stop pins:** destination + intermediate places = grey pin; chargers = red bolt pin; the car pin already
  exists. On entering a trip, the map fits to the trip's stops.

## Apple routing — native (`AppleSearch` module + `services/appleDirections.ts`)

Add to the existing `AppleSearch` Swift module:

```
route(coords: LatLng[]) : Promise<{
  polyline: LatLng[];
  legs: { distanceM: number; durationS: number }[]; // one per consecutive pair
  totalDistanceM: number;
  totalDurationS: number;
}>
```

Runs an `MKDirections` request per consecutive leg (`coords[i]`→`coords[i+1]`), concatenates the route
polylines, collects per-leg distance/`expectedTravelTime`, sums the totals. Rejects on any leg failure
(offline / no route). JS wrapper `appleRoute(coords)`. **Online-only** — offline hides the line and the
time/distance totals (the itinerary still lists stops; times fall back to blank). **Needs one native rebuild.**

## Energy (mocked, `src/state/trip.ts` — pure, node-tested)

`computeItinerary(stops, legs, opts): ItineraryRow[]` where `legs` are the MKDirections legs and
`opts = { departAt, startPct, drainPctPerKm, chargerRestorePct, chargeMinutes }`:
- Car row → `startPct`, `departAt`.
- Each subsequent stop → `pct = prev.pct - drainPctPerKm * legKm` (clamped ≥ 0);
  `at = prev.at + legDurationS (+ chargeMinutes at a charger)`. Chargers restore `pct` to `chargerRestorePct`.
- `ItineraryRow = { stop, pct, at, chargeMinutes? }`. Numbers are **clearly placeholder** (no real energy model).

## Components / files

- **Create** `src/state/trip.ts` — trip model + pure ops + `computeItinerary` (+ `trip.test.ts`).
- **Create** `src/state/useTrip.ts` — a hook holding `trip` + the mutators (thin wrapper over the pure ops).
- **Create** `src/services/appleDirections.ts` — `appleRoute(coords)` JS wrapper.
- **Modify** `modules/expo-apple-search/…` — add the native `route` method (Swift MKDirections) + JS types.
- **Create** `src/components/BottomSheet.tsx` — extract the sheet chrome (Animated.View + PanResponder +
  detents + handle + imperative `expand`/`collapse`/`expandFull`) currently inside `LocationSheet`, so both
  `LocationSheet` and the new `TripSheet` reuse it (keeps both files focused).
- **Modify** `src/components/LocationSheet.tsx` — render inside `BottomSheet` (behavior unchanged).
- **Create** `src/components/TripSheet.tsx` — the trip + editTrip views + the reorderable list.
- **Modify** `src/app/location.tsx` — `screen` state machine, `useTrip`, `<Polyline>` + stop pins, route
  fetching, Add Stop / Add Charger wiring; replace the `onNavigateToCharger` deep-link with "start/append a
  trip".

## Error handling

- Offline / MKDirections failure → no route line, blank time/distance; the itinerary still lists stops. Never
  crash or block.
- Empty/one-stop trip (only the car) → no route; selecting the first place always creates ≥ 2 stops.
- Removing down to just the car → discard the trip (back to search).

## Testing

- **Unit (node):** trip ops — `startTrip`/`addStop`/`addCharger`/`removeStop` (car protected)/`reorderStops`
  (car pinned); `computeItinerary` (drain, charger restore, times) with synthetic legs.
- **Manual (device):** MKDirections route line + real time/distance; drag-reorder; Add Stop / Add Charger;
  Send-to-Car mock does nothing outward; fit-to-trip; offline degradation.

## Phasing (each phase independently shippable)

1. **Trip core (JS-only):** `trip.ts` + `useTrip` + Trip screen + `BottomSheet` extraction + select-builds-trip
   + Cancel + Send-to-Car mock. Straight-line/no route yet; times/energy mocked.
2. **Real route (native rebuild):** the `route` MKDirections method + `appleDirections` + `<Polyline>` + real
   time/distance totals + fit-to-trip.
3. **Edit Trip:** add/remove + drag-reorder + Add Charger (bbox of stops).

## Decision record

- **Real Apple route** (MKDirections) for the polyline + time + distance; **energy stays mocked** (no vehicle
  model). Native `route` added to the existing `AppleSearch` module (one rebuild, Phase 2).
- **Drag-reorder** hand-rolled with PanResponder (no new dependency); car pinned first.
- **Send to Car is a local mock** — the Tesla-servers rule forbids the real thing.
- **Trip is ephemeral** (session, in-memory); Cancel discards it.
- **Car is always the first stop**, non-removable / non-reorderable.
- **Sheet chrome extracted** to a shared `BottomSheet` so `LocationSheet` and `TripSheet` stay focused.
