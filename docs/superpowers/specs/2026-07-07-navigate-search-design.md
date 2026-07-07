# Navigate search — design

**Date:** 2026-07-07
**Status:** Approved design
**Scope:** the SEARCH LOGIC only (input → ranked results with coordinates). Visual UI and what a tap *does*
(drop pin / set destination / route) are deliberately out of scope — see "Out of scope".

## Problem

The Location screen's bottom sheet has a "Navigate" search field that is currently a placeholder. It should
behave like a normal maps app / the Tesla app: type a query and get live search results for **objects** —
cities, towns, businesses/POIs, and addresses — that can be selected to drive the map.

## Key constraint discovered (why the design is a hybrid)

Apple's search APIs that a third-party app can call are **online-only**:

- `MKLocalSearch` (POI/business search) and `MKLocalSearchCompleter` (typeahead) are network services.
- `CLGeocoder` (address/place geocoding; what `expo-location` wraps) is also network-only. Apple's docs:
  *"Geocoders rely on a network service, and a live network connection must be present … in Airplane mode …
  the geocoder can't connect."* Even a city lookup errors offline.
- The Maps *app's* downloadable offline maps are Apple-internal and not exposed to third-party apps.

So **general business/POI/exact-address search requires network**. But **place-name search (cities / towns /
regions) can be offline** if we ship our own gazetteer — no one ships a global *business* index on-device, but
a *place-name* gazetteer is small and openly licensed.

## Approach (chosen: "B" — local-first, Apple-enriched)

A **hybrid** search:

- **Offline layer (always runs, instant):** on-device SQLite — a bundled **GeoNames gazetteer** (cities /
  towns / regions) + our existing **charger DB** + **recents**. Prefix query, no network.
- **Online layer (when connected):** Apple **`MKLocalSearchCompleter` + `MKLocalSearch`** for businesses,
  POIs, and precise addresses, region-biased to the current map view.
- Results from both are **merged, ranked, de-duped** and shown as one list.

Autocomplete (type → results) therefore works **offline** against the local data, and is **enriched** with
Apple's rich results when online.

Rejected alternative ("A", all-open pure-JS via Photon/Nominatim): fully JS-deployable and open, but Apple's
`MKLocalSearch` gives materially better business/POI quality and matches the real Tesla/Apple Maps app. We
accept one small native module to get that quality. (A remains a fallback if the module proves troublesome.)

## Architecture / components

Each is small and single-purpose:

### 1. `AppleSearch` native module (Swift, Expo) — the ONLY native piece
Wraps the two Apple APIs and exposes them to JS:
- `complete(query: string, region): Promise<{ title, subtitle }[]>` — `MKLocalSearchCompleter` typeahead
  (fast suggestions, no coordinates).
- `search(query: string, region): Promise<{ title, subtitle, coordinate, category }[]>` — `MKLocalSearch`,
  returns full results **with coordinates** (used to resolve a tapped completion, or to search directly).
- `region` biases results toward the current map viewport (an `MKCoordinateRegion`).
- Online-only by nature; a network/`MKError` failure rejects/returns empty and the JS layer degrades to
  local-only.
Added like our other native modules (`expo install` of the local module → `pod install` → full `xcodebuild`;
no `expo prebuild`). See [[native-module-add-no-prebuild]].

### 2. `placeSource.ts` (pure JS, offline) — local search over SQLite
- Reads three local sources: the **gazetteer** (`places` table), the **charger DB** (`chargers` table, via
  the existing on-device SQLite from [[ev-charger-data-providers]]), and **recents** (mock now, real later).
- Prefix/substring match on name, region-biased, returns `Place[]` with coordinates. Uses `expo-sqlite`
  (already in the binary), same `getAllSync` bbox/prefix pattern as `chargerSource.ts`.

### 3. `searchProvider.ts` (pure JS) — orchestrator
- Debounces input (~200 ms).
- **Always** runs `placeSource` (offline path) and emits those results immediately.
- Also **attempts** `AppleSearch.complete`; folds the results in when it succeeds.
- **Merges / ranks / de-dupes** and caps the list.
- **Online detection (chosen default): none explicit** — always attempt Apple; a rejection/timeout is caught
  and the list stays local-only. (Optional refinement: `expo-network` reachability to skip the Apple call
  entirely when offline, avoiding a guaranteed-to-fail request.)

### 4. `Place` type — the single result shape
```ts
type Place = {
  id: string;
  title: string;        // "Berlin", "Kaufland - Младост", "ул. Филип Аврамов 1"
  subtitle?: string;    // "Germany", "Sofia, Bulgaria", category/context
  coordinate: { latitude: number; longitude: number };
  kind: 'city' | 'charger' | 'poi' | 'address' | 'recent';
  source: 'gazetteer' | 'charger' | 'recent' | 'apple';
};
```
The list renders `Place[]`; a tap returns the selected `Place` (with its coordinate) to the map — the handoff
point where the (out-of-scope) destination behavior will later plug in.

## Data — the gazetteer

- **Source:** GeoNames **`cities1000`** — **170,267** cities/towns with population ≥ 1000 (good small-town
  coverage), **CC BY 4.0** (openly licensed → bundleable with attribution "© GeoNames, CC BY 4.0").
- **Shape:** a `places` SQLite table — `id, name, asciiname, lat, lng, country, admin1, population` — indexed
  on `name` and `asciiname` (accent-insensitive matching) for fast prefix queries.
- **Size (measured, trimmed to those columns + indexes):** **~16 MB** on-device (~8.7 MB gzipped). Density
  ladder evaluated: cities5000 = 69k/6.4 MB, cities1000 = 170k/16 MB, cities500 = 235k/22 MB. **cities1000
  chosen** — small-town coverage matters (Balkan towns are often < 5000 pop) and 16 MB is negligible next to
  the 34 MB charger DB. (Denser than cities500 means the full ~400–500 MB allCountries — not worth it.)
- **Delivery:** **bundled in-app** so offline place search works **from first install** (unlike the pushed
  charger DB — offline place search is core enough to ship with the binary). A small build script (mirroring
  `build-charger-db.ts`) downloads GeoNames → trims to the columns above → writes the `places` SQLite asset,
  re-runnable to refresh.

## Data flow (search logic)

1. User types → debounce ~200 ms (empty query → show recents).
2. Query `placeSource` (gazetteer + chargers + recents) → emit results immediately; these already carry
   coordinates (offline path).
3. In parallel, attempt `AppleSearch.complete(query, region)` → suggestions (title/subtitle, **no**
   coordinates) → fold into the list. A failure (offline / `MKError`) is caught → the list stays local-only.
4. `searchProvider` merges local + Apple → ranks → de-dupes → caps (~12) → renders.
5. Tap a result → a **local** result already has a coordinate (use directly); an **Apple** suggestion is
   resolved to a coordinate via `AppleSearch.search`. The selected `Place` is handed to the map
   (out-of-scope destination behavior).

## Ranking / merge

- **Order:** matching **recents** first → local **gazetteer/charger** prefix matches → **Apple** POI/address
  results.
- **Region bias:** prefer results near the current map viewport (both the SQLite query and Apple's `region`).
- **De-dupe:** collapse the same place appearing from two sources (e.g. a city in both the gazetteer and
  Apple) by name + proximity; prefer the richer/closer one.
- **Cap:** ~12 results.

## Error handling

- Offline or Apple error → show **local-only** results; never crash or block on the network.
- Empty query → show **recents**.
- No matches anywhere → empty state ("No results").

## Testing

- **Unit (pure JS):** `placeSource` prefix query against a small fixture DB; `searchProvider` merge / rank /
  de-dupe / cap given synthetic local + Apple result sets; offline path (Apple rejects → local-only).
- **Manual (on-device):** the `AppleSearch` native module and Apple's online results; offline behavior in
  Airplane mode.

## Out of scope (later, "one by one")

- What a tap **does**: drop pin, set as destination, add a route stop, hand off to native maps navigation.
- Route drawing / turn-by-turn.
- Visual UI / styling of the search field and results list.
- Real recents (still mock); wired when a trip/destination concept exists.

## Decision record

- **Apple search is online-only** (verified against Apple docs) → offline needs our own data.
- **Offline place-names via a bundled GeoNames gazetteer** (CC BY 4.0), cities-subset, SQLite — the
  charger-DB pattern reused. Full POI/business/address stays online (Apple).
- **One native module** (`MKLocalSearchCompleter` + `MKLocalSearch`) accepted for best-quality online results
  that match the Tesla/Apple Maps app; everything else JS/SQLite and JS-deployable.
