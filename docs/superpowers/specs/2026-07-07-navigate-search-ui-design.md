# Navigate search — UI & recents design

**Date:** 2026-07-07
**Status:** Approved design
**Builds on:** `2026-07-07-navigate-search-design.md` (the search *logic* — `place.ts`, `searchProvider.ts`,
`placeSource.ts`, `appleSearch.ts`, `useNavigateSearch.ts`, the `AppleSearch` native module, the bundled
gazetteer). This spec adds the **visual search UI** and **persisted recents** on top of that logic.
**Scope:** the search field interaction + results list + recents. **Out of scope:** what tapping a result
*does* beyond adding it to recents (routing/destination — the user will specify next), and pixel-polish.

## Problem

The Location bottom sheet has a static "Navigate" box that does nothing. It should behave like the Tesla /
Apple Maps search: tap it → the sheet grows to full height and a keyboard-backed field appears; as you type,
ranked autocomplete rows appear (name, address, distance); tapping a row records it in a locally-persisted
Recents list. Reference screenshots (2026-07-07): empty focused state, and two typed states (`vidi`,
`kaufland`) showing name + address + a distance pill per row, ordered by Apple.

## Two modes of the Location sheet

The sheet (`LocationSheet.tsx`) gains a **focused/search** mode alongside its existing **browse** mode.

- **Browse** (default, unchanged layout): middle detent; `Navigate` box on top; Recents/Charging tabs;
  the recents list below. Only change: the list is now **real stored recents**, not `MOCK_RECENTS`.
- **Search** (box focused): tapping the box focuses a live `TextInput`, animates the sheet to the **full**
  detent, hides the Recents/Charging tabs, and shows an **✕** in the field.
  - **Empty query** → show recents (grouped Today / Yesterday / older). Blank when there are none (this is
    why the reference "empty" screenshot is blank — a fresh install has no recents).
  - **Typing** → autocomplete rows (below).
  - **Floating label:** `Navigate` is the field placeholder when empty; once there is text it shrinks to a
    small gray label above the typed text (matches the `vidi` / `kaufland` screenshots).
  - **✕ button:** if the field has text → clear it (back to the empty/recents state); if already empty →
    exit search (blur → sheet settles to the middle detent → tabs return).

## Result row

One row shape for both autocomplete results and recents:

- **Title** — bold (place / business / city name).
- **Subtitle** — gray, one line, truncated with `…` (address / region / context).
- **Distance pill** — right-aligned rounded pill: `mappin` icon + kilometres **from the car** (`carCoord`),
  formatted by the existing `formatKm`. Consistent with the charger list, which also shows car-distance.

Reuses the existing `row` / `rowText` / `rowName` / `rowAddress` / `distancePill` styles.

## Data flow

Driven by `useNavigateSearch(region)` (extends the existing hook), ~300 ms debounce:

- **Online (chosen default):** the list is **Apple `MKLocalSearch`** results in Apple's order. We switch the
  live query from `complete` (`MKLocalSearchCompleter`, no coordinates) to **`search`** (`MKLocalSearch`,
  returns `mapItems` with `name`, `placemark.title`, and a **coordinate**) so every row has a coordinate →
  we compute the distance pill from `carCoord`.
- **Offline (Apple `search` rejects):** fall back to the bundled **gazetteer + charger DB**
  (`placeSource.searchLocal`) with our own ranking (`place.ts`). Same row UI; distances computed the same way.
- **Empty query:** show **recents** (never calls Apple).
- Distance is computed in the sheet from a `carCoord` prop (`distanceMeters(carCoord, place.coordinate)`), so
  `Place` stays pure and the hook needs only `region` (which also biases Apple's `MKLocalSearch`).

`searchProvider.runSearch` is refined: empty → recents; else attempt Apple `search` and, on success, return
those (Apple's order); on rejection, return `localSearch`. (The previous always-merge behavior is replaced —
online is Apple-only, per the approved design. `place.ts` `mergeResults`/`rankPlaces` remain used for the
offline path's ordering.)

## Recents (persisted)

New `src/services/recentsStore.ts`, backed by a small **SQLite** table (`recents.db` in expo-sqlite's default
directory — survives app restart, needs no rebuild):

```sql
CREATE TABLE recents (id TEXT PRIMARY KEY, title TEXT, subtitle TEXT, lat REAL, lng REAL, savedAt INTEGER);
```

- `addRecent(place, now)` — upsert by `id` (re-selecting bumps `savedAt`); after insert, prune to the newest
  **50**.
- `loadRecents(now)` — `ORDER BY savedAt DESC`, mapped to `Place[]` (with coordinate), then **grouped by day**
  into `{ title, items }[]` (Today / Yesterday / `D MMM`) — the grouping is a **pure, node-tested** function.
- Replaces `MOCK_RECENTS`; the recents list (browse mode and empty-search) renders these groups.

## Sheet control

`LocationSheetHandle` gains `expandFull()` (settle to the full detent, translateY 0). Field focus →
`expandFull()`; ✕-exit / blur → settle to the middle detent. `expand()`/`collapse()` keep their meaning.

## On tapping a result

For this pass: `addRecent(place)` and mark the place selected — **no map action yet**. This is the seam where
the (out-of-scope) routing/destination behavior will plug in next. Recents update immediately (optimistic).

## Components / files

- **Modify** `src/components/LocationSheet.tsx` — add search/focused mode (`TextInput`, floating label, ✕),
  result-rows list (distance from a new `carCoord` prop), wire recents groups + search state; add `expandFull`
  to the handle; new props for the search state + `onSelectPlace`.
- **Modify** `src/app/location.tsx` — own the search hook (`useNavigateSearch(region)`), pass `results` /
  `query` / handlers + recents + `carCoord` into the sheet, `expandFull()` on focus, `addRecent` on select.
- **Modify** `src/services/searchProvider.ts` — online-Apple / offline-local branch (+ update its tests).
- **Modify** `src/services/appleSearch.ts` — add `appleSearch(q, region)` using the native `search` (results
  with coordinates → `Place`); keep `appleComplete` (now unused by the list).
- **Modify** `src/hooks/useNavigateSearch.ts` — use the online/offline branch; expose `results` + `query` +
  `setQuery` + recents groups.
- **Create** `src/services/recentsStore.ts` — SQLite-backed recents (native).
- **Create** `src/services/recents.ts` — pure `groupRecentsByDay(places, now)` (node-tested).
- **Remove** `MOCK_RECENTS` usage from `LocationSheet.tsx` (leave the type or move it as needed).

## Error handling

- Apple `search` rejects (offline) → local fallback; never crash or block.
- Recents DB unavailable → recents are empty; search still works.
- Empty results → empty list (no error state needed beyond blank).

## Testing

- **Unit (node):** `groupRecentsByDay` (Today/Yesterday/older bucketing, ordering, dedupe already at store
  level); `searchProvider.runSearch` online→Apple / offline→local / empty→recents (DI fakes).
- **Manual (device):** the `TextInput` focus → full-detent expand, floating label, ✕ clear/exit, keyboard
  behavior, live Apple results with distance pills, offline fallback, recents persisting across a full app
  restart, tapping a result adding it to recents.

## Decision record

- **Recents persist across restarts** via a dedicated **SQLite** table (expo-sqlite already native → no
  rebuild), not the in-memory `AppStorage`.
- **Online list = Apple only** (Apple's ordering); gazetteer + charger DB are the **offline fallback**.
- **Live query uses `MKLocalSearch` (`search`)**, not the completer, because every row needs a coordinate for
  the distance pill.
- **Distance is measured from the car** (`carCoord`), consistent with the charger list.
- **Tapping a result only records a recent** for now; routing/destination is the next, separate step.
