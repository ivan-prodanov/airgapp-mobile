# Trip Building — Phase 2 (Real Apple Route) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Replace the Phase-1 straight-line trip mock with a real **Apple MKDirections** route — a blue polyline on the map, real per-leg durations feeding the itinerary times, and real total time/distance on the Send-to-Car button — plus stop pins and fit-to-trip.

**Architecture:** A new `route(coords)` method on the existing `AppleSearch` Swift module runs `MKDirections` per consecutive leg and returns the concatenated polyline + per-leg distance/duration + totals. A `useTripRoute` hook fetches it when the trip changes; `location.tsx` draws the `<Polyline>` + stop pins + fits the map, and feeds the real legs/totals into `TripSheet` (falling back to the straight-line mock when offline).

**Tech Stack:** Swift + MapKit (`MKDirections`), the local `AppleSearch` Expo module, `react-native-maps` `Polyline`, TypeScript. **Requires ONE full `xcodebuild` (native).**

## Global Constraints

- **This phase needs a native rebuild** (new Swift method). `pod install` is NOT required (the module's `source_files` glob already covers the file) but the full `xcodebuild` Release is. **NO `expo prebuild`.**
- **Add NO JS dependencies.** `react-native-maps` (with `Polyline`) is already installed.
- **`route` is online-only** — MKDirections needs the network. On failure the trip **falls back to the Phase-1 straight-line legs** (no polyline, mock totals); never crash.
- **Signing:** automatic, `DEVELOPMENT_TEAM=859B8N529C`, never override. iOS min 16.4.
- **Device:** CoreDevice `F3867E6E-E95F-5B2A-9C4E-06D1D72475A1`, bundle `local.airgapp.mobile`.
- **`Leg = { distanceM: number; durationS: number }`** is the shared shape from `@/state/trip` (Phase 1) — the route wrapper returns legs in exactly this shape.

## File Structure

```
Native / device:
  modules/expo-apple-search/ios/AppleSearchModule.swift   MODIFY  add route(coords) MKDirections method
  modules/expo-apple-search/src/AppleSearch.types.ts      MODIFY  AppleRouteLeg + AppleRoute
  modules/expo-apple-search/src/AppleSearchModule.ts      MODIFY  declare route()
  src/services/appleDirections.ts                         CREATE  appleRoute(coords) → RouteResult
  src/state/useTripRoute.ts                               CREATE  hook: fetch route on trip change
  src/app/location.tsx                                    MODIFY  Polyline + stop pins + fit-to-trip + real legs/totals
```

**Type/name contract:**
- Native `route(coords: {latitude,longitude}[]) → { polyline: {latitude,longitude}[]; legs: {distanceM,durationS}[]; totalDistanceM: number; totalDurationS: number }` (Task 1).
- `appleRoute(coords: LatLng[]): Promise<RouteResult>` where `RouteResult = { polyline: LatLng[]; legs: Leg[]; totalDistanceM: number; totalDurationS: number }` (Task 1).
- `useTripRoute(stops: TripStop[] | undefined): RouteResult | null` (Task 2).

---

### Task 1: Native `route` (MKDirections) + JS wrapper

**Files:** Modify `modules/expo-apple-search/ios/AppleSearchModule.swift`, `…/src/AppleSearch.types.ts`, `…/src/AppleSearchModule.ts`; Create `src/services/appleDirections.ts`.

**Interfaces:** Produces the native `route` + `appleRoute(coords)` above. Consumes `Leg` (`@/state/trip`), `LatLng` (`@/state/mockLocation`), the native module default export.

> Native — verified on-device in Task 4 (no node test).

- [ ] **Step 1: Add the `route` method to `AppleSearchModule.swift`.** Insert a `polyPoints` helper after `makeRegion` (top of file, after line 9):

```swift
// Extract an MKPolyline's coordinates as [{ latitude, longitude }].
private func polyPoints(_ polyline: MKPolyline) -> [[String: Double]] {
  let count = polyline.pointCount
  var buf = [CLLocationCoordinate2D](repeating: CLLocationCoordinate2D(), count: count)
  polyline.getCoordinates(&buf, range: NSRange(location: 0, length: count))
  return buf.map { ["latitude": $0.latitude, "longitude": $0.longitude] }
}
```

Then add this `AsyncFunction` inside `definition()` (after the `search` function, before the closing braces):

```swift
    AsyncFunction("route") { (coords: [[String: Double]], promise: Promise) in
      DispatchQueue.main.async {
        func point(_ c: [String: Double]) -> MKMapItem {
          MKMapItem(placemark: MKPlacemark(coordinate: CLLocationCoordinate2D(latitude: c["latitude"] ?? 0, longitude: c["longitude"] ?? 0)))
        }
        if coords.count < 2 {
          promise.resolve(["polyline": [], "legs": [], "totalDistanceM": 0, "totalDurationS": 0])
          return
        }
        var polyline: [[String: Double]] = []
        var legs: [[String: Double]] = []
        var totalDistanceM = 0.0
        var totalDurationS = 0.0
        func step(_ i: Int) {
          if i >= coords.count - 1 {
            promise.resolve([
              "polyline": polyline, "legs": legs,
              "totalDistanceM": totalDistanceM, "totalDurationS": totalDurationS,
            ])
            return
          }
          let req = MKDirections.Request()
          req.source = point(coords[i])
          req.destination = point(coords[i + 1])
          req.transportType = .automobile
          MKDirections(request: req).calculate { resp, err in
            guard let r = resp?.routes.first else {
              promise.reject("APPLE_ROUTE", err?.localizedDescription ?? "no route")
              return
            }
            polyline.append(contentsOf: polyPoints(r.polyline))
            legs.append(["distanceM": r.distance, "durationS": r.expectedTravelTime])
            totalDistanceM += r.distance
            totalDurationS += r.expectedTravelTime
            step(i + 1)
          }
        }
        step(0)
      }
    }
```

- [ ] **Step 2: Add route types to `modules/expo-apple-search/src/AppleSearch.types.ts`** (append):

```ts
export interface AppleRouteLeg {
  distanceM: number;
  durationS: number;
}
export interface AppleRoute {
  polyline: { latitude: number; longitude: number }[];
  legs: AppleRouteLeg[];
  totalDistanceM: number;
  totalDurationS: number;
}
```

- [ ] **Step 3: Declare `route` in `modules/expo-apple-search/src/AppleSearchModule.ts`.** Change the imports + class to include it:

```ts
import { requireNativeModule } from 'expo';

import type { AppleCompletion, AppleRegion, AppleResult, AppleRoute } from './AppleSearch.types';

declare class AppleSearchModule {
  // MKLocalSearchCompleter typeahead — suggestions only (no coordinates).
  complete(query: string, region: AppleRegion): Promise<AppleCompletion[]>;
  // MKLocalSearch — full results WITH coordinates.
  search(query: string, region: AppleRegion): Promise<AppleResult[]>;
  // MKDirections — polyline + per-leg distance/duration + totals for consecutive coords.
  route(coords: { latitude: number; longitude: number }[]): Promise<AppleRoute>;
}

export default requireNativeModule<AppleSearchModule>('AppleSearch');
```

- [ ] **Step 4: Create `src/services/appleDirections.ts`**

```ts
// Online route via the AppleSearch native module (MKDirections). Maps the native result into the shared Leg
// shape + a LatLng polyline. Rejects offline → useTripRoute falls back to the straight-line mock.
import AppleSearch from '../../modules/expo-apple-search';
import type { LatLng } from '@/state/mockLocation';
import type { Leg } from '@/state/trip';

export interface RouteResult {
  polyline: LatLng[];
  legs: Leg[];
  totalDistanceM: number;
  totalDurationS: number;
}

export async function appleRoute(coords: LatLng[]): Promise<RouteResult> {
  const r = await AppleSearch.route(coords.map((c) => ({ latitude: c.latitude, longitude: c.longitude })));
  return {
    polyline: r.polyline.map((p) => ({ latitude: p.latitude, longitude: p.longitude })),
    legs: r.legs.map((l) => ({ distanceM: l.distanceM, durationS: l.durationS })),
    totalDistanceM: r.totalDistanceM,
    totalDurationS: r.totalDurationS,
  };
}
```

- [ ] **Step 5: Typecheck**

Run: `npx tsc --noEmit -p tsconfig.json`
Expected: no errors from `appleDirections.ts` / the module JS.

- [ ] **Step 6: Commit**

```bash
git add modules/expo-apple-search src/services/appleDirections.ts
git commit -m "feat(trip): AppleSearch.route (MKDirections) native method + appleDirections wrapper"
```

---

### Task 2: `useTripRoute` hook

**Files:** Create `src/state/useTripRoute.ts`.

**Interfaces:** Consumes `appleRoute` (Task 1), `RouteResult` (Task 1), `TripStop` (`@/state/trip`). Produces `useTripRoute(stops)`.

- [ ] **Step 1: Create `src/state/useTripRoute.ts`**

```ts
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
```

- [ ] **Step 2: Typecheck**

Run: `npx tsc --noEmit -p tsconfig.json`
Expected: no errors.

- [ ] **Step 3: Commit**

```bash
git add src/state/useTripRoute.ts
git commit -m "feat(trip): useTripRoute — fetch Apple route on trip change"
```

---

### Task 3: Map route + stop pins + fit-to-trip + real legs/totals

**Files:** Modify `src/app/location.tsx`.

**Interfaces:** Consumes `useTripRoute` (Task 2). Feeds real `legs`/`totals` into the existing `TripSheet` + footer (Phase 1), draws the route + pins.

- [ ] **Step 1: Add imports.** Add `Polyline` to the `react-native-maps` import and import the hook:

```ts
import MapView, { Marker, Polyline, PROVIDER_DEFAULT, type MapType, type Region } from 'react-native-maps';
```
```ts
import { useTripRoute } from '@/state/useTripRoute';
```

- [ ] **Step 2: Fetch the route + derive real legs/totals.** Replace the Phase-1 `tripLegs`/`tripTotalsVal` block (added in Phase 1 after `onSelectPlace`) with:

```tsx
  // Real Apple route for the active trip (null while loading / offline → straight-line fallback).
  const tripRoute = useTripRoute(trip.trip?.stops);
  const tripLegs = tripRoute?.legs ?? (trip.trip ? straightLineLegs(trip.trip.stops) : []);
  const tripTotalsVal = tripRoute
    ? { distanceM: tripRoute.totalDistanceM, durationS: tripRoute.totalDurationS }
    : tripTotals(tripLegs);
```

(The `<TripSheet legs={tripLegs} …>` and the footer's `formatDuration(tripTotalsVal.durationS)` / `formatKm(tripTotalsVal.distanceM/1000)` from Phase 1 now show real values automatically.)

- [ ] **Step 3: Fit the map to the trip.** Add an effect near the other effects in the component body:

```tsx
  // Frame the whole trip (route if we have it, else the stops) above the trip sheet.
  useEffect(() => {
    if (screen !== 'trip' || !trip.trip) return;
    const coords = tripRoute?.polyline?.length ? tripRoute.polyline : trip.trip.stops.map((s) => s.coordinate);
    mapRef.current?.fitToCoordinates(coords, {
      edgePadding: { top: 90, right: 44, bottom: Math.round(height * 0.55), left: 44 },
      animated: true,
    });
  }, [screen, trip.trip, tripRoute]);
```

- [ ] **Step 4: Draw the route polyline + stop pins inside `<MapView>`.** Right after the closing of the `{tab === 'charging' && markerChargers.map(...)}` block (still inside `<MapView>`), add:

```tsx
        {screen === 'trip' && tripRoute?.polyline?.length ? (
          <Polyline coordinates={tripRoute.polyline} strokeColor="#3E6AE1" strokeWidth={5} />
        ) : null}

        {screen === 'trip' && trip.trip
          ? trip.trip.stops.slice(1).map((s) => (
              <Marker key={s.id} coordinate={s.coordinate} anchor={{ x: 0.5, y: 1 }} tracksViewChanges={false}>
                <SymbolView
                  name={s.kind === 'charger' ? 'bolt.circle.fill' : 'mappin.circle.fill'}
                  tintColor={s.kind === 'charger' ? '#E5484D' : '#3E6AE1'}
                  size={30}
                />
              </Marker>
            ))
          : null}
```

- [ ] **Step 5: Typecheck + full suite**

Run: `npx tsc --noEmit -p tsconfig.json && npm test`
Expected: tsc clean; all tests PASS (pure logic unchanged).

- [ ] **Step 6: Commit**

```bash
git add src/app/location.tsx
git commit -m "feat(trip): draw Apple route polyline + stop pins + fit-to-trip; real time/distance"
```

---

### Task 4: Native rebuild + deploy + verify

**Files:** none.

- [ ] **Step 1: Full Release build** (compiles the new Swift `route` method; renews the weekly profile)

Run:
```bash
xcodebuild -workspace ios/airgapp.xcworkspace -scheme airgapp -configuration Release \
  -sdk iphoneos -destination 'generic/platform=iOS' -allowProvisioningUpdates build
```
Expected: `BUILD SUCCEEDED`. No `DEVELOPMENT_TEAM=` overrides.

- [ ] **Step 2: Install** (the xcodebuild also bundles the current JS)

Run:
```bash
APP="$(ls -dt "$HOME"/Library/Developer/Xcode/DerivedData/airgapp-*/Build/Products/Release-iphoneos/airgapp.app 2>/dev/null | head -1)"
xcrun devicectl device install app --device F3867E6E-E95F-5B2A-9C4E-06D1D72475A1 "$APP"
```
Expected: `App installed`. (`route` symbol check: `nm "$APP/airgapp" | grep -ci route` > 0 is a rough sanity signal.)

- [ ] **Step 3: Refresh the JS layer** (so `places.db` gets re-placed + latest JS)

Run: `bash scripts/godot-ios/deploy-js.sh`
Expected: `✓ done`.

- [ ] **Step 4: On-device check** (eyes on the phone):
  1. Search or charger → build a trip → the map draws a **blue route line** following roads (not a straight line), with a **pin at the destination** (red bolt for a charger).
  2. The map **fits the whole route** above the trip sheet.
  3. "Send to Car · Xh Ym · Z km" shows **real** time/distance (road distance, not straight-line); itinerary times reflect real leg durations.
  4. **Airplane mode** → build a trip → no crash; falls back to no line + straight-line mock totals.

- [ ] **Step 5: Commit** (only if a tweak was needed during verification).

---

## Self-Review

**Spec coverage (Phase 2 slice):**
- Real Apple route line (MKDirections polyline) → Task 1 (native) + Task 3 (`<Polyline>`). ✓
- Real total time + distance on Send-to-Car → Task 1 legs/totals + Task 3 `tripTotalsVal`. ✓
- Real per-leg durations feeding itinerary times → Task 3 `tripLegs` into `computeItinerary` (Phase 1 `TripSheet`). ✓
- Stop pins (destination/charger) → Task 3 Step 4. ✓
- Fit-to-trip → Task 3 Step 3. ✓
- Offline degradation (no line, straight-line fallback) → Task 2 (`catch → null`) + Task 3 (`?? straightLineLegs`). ✓
- One native method on the existing AppleSearch module → Task 1. ✓
- (Edit Trip screen / reorder / Add Charger remain **Phase 3**.)

**Placeholder scan:** none. The Swift/TS/JSX are complete. Offline fallback is concrete (straight-line legs from Phase 1).

**Type/name consistency:** native `route` returns `{polyline, legs, totalDistanceM, totalDurationS}`; `AppleRoute` (Task 1 types) matches; `appleRoute` maps to `RouteResult` with `Leg[]` (`@/state/trip`) — same `{distanceM,durationS}` used by `computeItinerary`/`tripTotals` (Phase 1). `useTripRoute(stops)` (Task 2) consumed in Task 3 as `tripRoute`. `TripSheet`'s `legs` prop + the footer's `tripTotalsVal` (Phase 1) unchanged. ✓

---

## Execution Handoff

Phase 2 plan complete. Tasks 1-3 are native-source + JS (typecheck only — the route is device-verified); Task 4 is the one full `xcodebuild` (~25 min) + on-device check. Phase 3 (Edit Trip: add/remove/drag-reorder + Add Charger) gets its own plan after this lands.
