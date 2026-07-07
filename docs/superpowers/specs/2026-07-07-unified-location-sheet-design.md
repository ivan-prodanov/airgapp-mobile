# Unified Location sheet — design

**Date:** 2026-07-07
**Status:** Approved design
**Scope:** merge the Location screen's two structurally-different sheet panels (Recents / Charging) into one
sheet with persistent top tabs, and simplify the trip-add flow. **JS-only** (no new deps, no rebuild).

## Problem

The Location bottom sheet swaps between two very different layouts: the **Recents** panel (search box on top,
then Recents/Charging tabs, then a recents list) and the **Charging** panel (its own "Nearby Chargers" title +
Filter/Sort/DC/AC controls + list). The tabs live *inside* the Recents panel and disappear on search-focus, so
moving between "find a place" and "find a charger" is disorienting — and it makes the trip-add flow (Add Stop
vs Add Charger) feel like two separate destinations.

## Design

One sheet, **persistent header**, tab-switched body:

**Header (always visible, below the drag handle):**
- **‹ Trip** — a back button shown **only while a trip is active**; returns to the trip panel without adding.
- **`Location | Charging` tabs** — always visible (both tabs, in both states).

**Body (switches by selected tab):**
- **Location** → the **Navigate search box**, then **results** (while typing) or **recents** (empty query).
- **Charging** → the controls row **`Sort By · DC · AC`**, then the **charger list**. The standalone
  "Nearby Chargers" title and the separate **Filter** button are removed (the DC/AC toggles already are the
  filter; the Filter sub-sheet's "Available only" toggle is dropped with it — can return later if wanted).
- **Charger selected** (list row or map pin) → the **charger detail** replaces the list under the tabs, with
  the existing pinned bottom action bar.

**Search focus:** tapping the search box still grows the sheet to the full detent (for the keyboard), but the
**tabs stay visible** (they no longer hide on focus). Blur / ✕ drops the sheet back to the middle detent.

## Trip-add flow simplification

Because both tabs now live in one sheet:
- **Add Stop** (from the trip) opens the sheet on the **Location** tab; **Add Charger** opens it on the
  **Charging** tab. From either, the user can **switch tabs freely** (add a charger when they meant a place,
  or vice-versa) without backing out.
- **‹ Trip** is the escape hatch back to the trip panel.
- The **`addingCharger` flag is removed.** The charger detail's action label is derived purely from trip
  existence: **"Add to Trip"** when a trip exists, else **"Navigate"**. `onNavigateToCharger` branches on
  `trip.trip`: exists → `addCharger` + return to the trip; none → start a trip to the charger.
- Selecting a place is unchanged: trip exists → `addStop` / `insertStop` (per `pendingInsert`); none → start a
  trip.

## Components / files

- **Modify** `src/components/LocationSheet.tsx` — the main work. Restructure so the sheet renders a persistent
  header (optional ‹ Trip + the `Location | Charging` tabs) and a tab-switched body. Fold the current
  `RecentsView` (search + results/recents) and `ChargingView` (controls + list + detail) into that shared
  frame: the tabs move to the top and no longer depend on `searchFocused`; the charging controls lose the
  "Nearby Chargers" header and the Filter button. New prop `onBackToTrip?: () => void` (present ⇒ render the
  ‹ Trip button). Rename the tab type value `'recents'` → `'location'`.
- **Modify** `src/app/location.tsx` — rename the `tab` value `'recents'` → `'location'` everywhere; remove the
  `addingCharger` state + `onTabChangeFromLocation`; pass `onBackToTrip={trip.trip ? () => setScreen('trip') : undefined}`;
  derive the charger-detail action label from `trip.trip`; simplify `onAddChargerToTrip` to `setTab('charging')`
  + `setScreen('search')` + fit-to-trip; simplify `onNavigateToCharger` (branch on `trip.trip`).
- No new files, no new dependencies.

## Error handling

- ‹ Trip only renders when a trip exists; when there's no trip the header is just the tabs.
- Switching tabs mid-add keeps the trip intact (nothing is committed until a place/charger is picked).
- Charger detail back/close returns to the charger list (tabs remain).

## Testing

- No new pure logic → no new node tests (the `'recents'`→`'location'` rename is mechanical; existing tests
  unaffected).
- **Manual (device):** tabs always visible and switch content; search-focus keeps the tabs; Charging shows
  `Sort By · DC · AC` + list with no "Nearby Chargers" header; charger detail + Add-to-Trip/Navigate; ‹ Trip
  returns to the trip; Add Stop→Location / Add Charger→Charging and free tab-switching while adding.

## Decision record

- **One sheet with persistent `Location | Charging` tabs** replaces the two-panel Recents/Charging split.
- **‹ Trip header button** (shown only with an active trip) is the way back to the trip panel.
- **Drop the `addingCharger` flag** — the charger action label is purely `trip ? 'Add to Trip' : 'Navigate'`.
- **Drop the standalone Filter button** (and its "Available only" toggle) — DC/AC toggles are the filter.
- **Tabs stay visible on search-focus** (only the sheet height changes).
- JS-only; no new dependencies or rebuild.
