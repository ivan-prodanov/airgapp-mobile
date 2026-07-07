# Trip editing v2 — design (supersedes Phase 3)

**Date:** 2026-07-07
**Status:** Approved design
**Supersedes:** the **Phase 3** section of `2026-07-07-trip-building-design.md` (the `EditTripSheet` /
`AddChargerSheet` built there are being **replaced** — they read as dated / not usable). Phases 1–2 (trip
state, itinerary, real Apple route) stay as-is.
**Scope:** rebuild the trip-editing UX to industry standard — direct-manipulation rows (drag-reorder, swipe
actions, long-press native context menu) on a single editable trip screen, and make "Add Charger" reuse the
real Charging-tab experience.

## Problem

The Phase-3 Edit Trip screen (a separate mode with a hand-rolled drag list + a bespoke charger picker) looks
dated and isn't pleasant to use. The trip screen should be **directly editable** (no separate edit mode) with
the gestures users expect from a maps app: drag to reorder, swipe a row for actions, long-press for a native
menu — using proper libraries, not hand-rolled approximations.

## Gesture foundation (the enabling decision)

The app has always used React Native `PanResponder` and has **no `GestureHandlerRootView`**, because
`react-native-gesture-handler` (RNGH) was inert under the old expo-router **native tabs** — which are now
**removed** (plain Stack). RNGH 2.31.2 + reanimated 4.3.1 + worklets 0.8.3 are already installed **and linked**
in the binary.

- **Enable RNGH:** add one `GestureHandlerRootView` at the app root (`_layout.tsx`).
- **Smoke-test first (JS-only, no rebuild):** verify a bare `Gesture.Pan()` fires on the Location screen
  before committing. If it's still inert (unexpected), **fall back** to a `PanResponder` drag +
  `react-native-swipe-list-view` (PanResponder-based) — the native context menu / share / clipboard are
  RNGH-independent and stay either way.

## Tools

**Architecture A (all-RN)** — chosen so rows stay custom RN views (consistent with the app) and compose
cleanly. `@expo/ui`'s SwiftUI `ContextMenu` and `react-native-context-menu-view` were both rejected: the
former is SwiftUI-hosted and won't wrap a custom RN row that's also inside RN swipe/drag; the latter has open
New-Architecture rendering bugs. The long-press menu is therefore hand-rolled but styled to feel native.

| Interaction | Library / approach | Native? |
|---|---|---|
| Long-press context menu | **hand-rolled** — RN `Modal` + dark scrim + `expo-haptics` (already installed), menu positioned at the row | JS-only, no new dep |
| Swipe actions | **`ReanimatedSwipeable`** (`react-native-gesture-handler/ReanimatedSwipeable`, already installed) | JS-only (needs the root view above) |
| Drag-reorder | **`react-native-reorderable-list`** v0.18 (`pnpm add`) | JS-only, no native code (rides on RNGH + reanimated) |
| Share | **`Share`** from `react-native` core | JS-only |
| Copy to clipboard | **`expo-clipboard`** (pinned to its SDK-56 version) | **native → one rebuild** |

**Rebuild:** exactly one `xcodebuild` to add `expo-clipboard` (pin the version to match ExpoModulesCore
56.0.14 to avoid the dyld version-skew gotcha — see [[native-module-add-no-prebuild]]). Everything else ships
via `deploy-js.sh`.

## Trip screen v2 (one directly-editable screen)

Rewrite `TripSheet` into a single editable screen; **delete** `EditTripSheet` and `AddChargerSheet`; remove
the `editTrip` screen state.

- **Header:** the trip title area holds **`Add Stop`** and **`Add Charger`** actions. **Leave Now** and **Edit
  Trip** are removed.
- **Itinerary rows** (car is `stops[0]`, pinned at top — no drag handle, no swipe, no menu):
  - **Drag-reorder** via a `≡` handle (`react-native-reorderable-list`). Drop index **clamped ≥ 1** so the car
    stays first; the handle is omitted on the car row.
  - **Swipe** (trailing / right→left) reveals actions, with **Delete** as the **destructive full-swipe**
    (`ReanimatedSwipeable`).
  - **Long-press** opens a **hand-rolled context menu** (RN `Modal` + dark scrim + haptics, styled to look
    native) with the same actions.
  - **Actions** (both swipe and menu): **Copy** (name/address → clipboard, `expo-clipboard`), **Share** (native
    share sheet with the place name + an Apple-Maps URL), **Insert Stop** (search → insert *after this row*),
    **Delete** (remove; removing the last non-car stop discards the trip → back to search).
- Below the itinerary, the pinned **Send to Car** / **Cancel** footer (from Phase 1) stays.

## Add Stop vs Insert Stop

Both open the search screen; they differ in where the picked place lands:

- **Add Stop** (header) → **append** (`addStop`).
- **Insert Stop** (row action, from row `i`) → **insert after row `i`** (`insertStop(trip, place, i + 1)`).

`location.tsx` tracks a `pendingInsert: number | null` (null = append). Selecting a place in search inserts at
`pendingInsert` when set, else appends, then returns to the trip screen and clears it.

## Add Charger = the Charging tab

Replace the bespoke picker. **Add Charger** reuses the existing **Charging tab** (map charger pins + Nearby
list + Filter/Sort + charger detail):

- Fit the map to the trip's stops, then show the Charging experience with chargers over the trip area.
- The charger detail's primary action becomes **"Add to Trip"** (instead of "Navigate") while adding to a
  trip: tapping it runs `addCharger(charger)` and returns to the trip screen.
- Implemented by reusing the current `ChargingView` + map-pin path with an "add-to-trip" mode flag; no new
  charger list UI.

## Trip state (`src/state/trip.ts`) — additions

Add one pure op (node-tested); the rest already exist (`addStop`, `addCharger`, `removeStop`, `reorderStops`):

- `insertStop(trip: Trip, place: Place, index: number): Trip` — insert a place stop at `index`, **clamped to
  `[1, stops.length]`** so it never lands before the car.

## Components / files

- **Rewrite** `src/components/TripSheet.tsx` — editable rows (drag/swipe/long-press), header Add Stop / Add
  Charger, reorderable list.
- **Delete** `src/components/EditTripSheet.tsx`, `src/components/AddChargerSheet.tsx`.
- **Modify** `src/state/trip.ts` (+ test) — add `insertStop`.
- **Modify** `src/app/_layout.tsx` — wrap in `GestureHandlerRootView`.
- **Modify** `src/app/location.tsx` — drop the `editTrip`/`addCharger` bespoke screens; `pendingInsert` state;
  Add-Stop/Insert/append routing; Add Charger → Charging tab in add-to-trip mode; row action handlers
  (copy/share/delete/insert).
- **Modify** `src/components/LocationSheet.tsx` — charger detail's action label/behavior configurable
  ("Navigate" vs "Add to Trip").
- **Add deps:** `react-native-reorderable-list` (JS-only), `expo-clipboard` (native, pinned).

## Error handling

- RNGH inert after the smoke-test → PanResponder drag + `swipe-list-view` fallback (documented); native menu /
  share / clipboard unaffected.
- Clipboard/share failures are caught and no-op (never crash).
- Removing all non-car stops → discard trip → search.
- Empty Add-Charger area → the Charging tab's existing "No chargers in this area" empty state.

## Testing

- **Unit (node):** `insertStop` (clamp ≥ 1, correct position); existing `reorderStops`/`removeStop` cover the
  car-pinning invariants.
- **Manual (device):** the RNGH smoke-test; drag-reorder (car fixed); swipe → Copy/Share/Insert/Delete with
  Delete as full-swipe; long-press native menu; Copy lands on clipboard; Share opens the share sheet; Add Stop
  vs Insert position; Add Charger opens the Charging tab and "Add to Trip" appends a charger.

## Decision record

- **Industry gesture libs over hand-rolled:** `react-native-reorderable-list` + `ReanimatedSwipeable` +
  `@expo/ui ContextMenu`, enabled by a single root `GestureHandlerRootView`; **RNGH smoke-test gates** the
  approach (PanResponder fallback if it fails).
- **Context menu hand-rolled** (RN `Modal` + scrim + haptics) — `@expo/ui`'s SwiftUI `ContextMenu` is
  SwiftUI-hosted and won't compose with RN swipe/drag on the same custom row; `react-native-context-menu-view`
  has New-Arch rendering bugs. **Architecture A (all-RN)** keeps rows consistent + fully controllable.
- **Copy = clipboard; plus Share** (native share sheet, maps-style) — both on rows via swipe and the menu.
- **One editable trip screen** — the separate Edit Trip mode is removed (direct manipulation).
- **Add Charger reuses the Charging tab**, not a bespoke picker.
- **One rebuild** (only for `expo-clipboard`); gesture libs + menu + share are JS-only.
