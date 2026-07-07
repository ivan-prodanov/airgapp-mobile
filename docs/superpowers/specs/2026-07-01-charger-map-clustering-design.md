# Charger map — PlugShare-style bbox fetch + clustering

**Date:** 2026-07-01
**Status:** Approved design (clustering confirmed)

## Problem

The Charging tab's map markers behave badly: zoomed out they pile up in the screen centre with empty edges, and any small zoom/pan swaps in a different random subset. Root cause: we query TomTom **`categorySearch`**, which returns the *N nearest results to the query centre* — not everything in the viewport. Grid-sampling and client thinning were hacks around the wrong query and produced churn.

## Goal

Make the charger map behave like PlugShare: stations spread across the visible map; **cluster bubbles** (a circle with a count) where dense, splitting into **individual pins** as you zoom in; **stable** across zoom/pan (no reshuffling); tap a cluster to zoom in, tap a pin to navigate.

## Approach (verified against the real API + libs)

1. **Bounding-box fetch** — TomTom **`geometrySearch`** (POST) with a POLYGON of the viewport corners, `categorySet=7309`, `limit=100`. Verified: returns up to 100 stations spread across the *entire* rectangle (not centre-biased).
2. **Clustering** — **`supercluster`** (v8, pure JS, industry standard, no native rebuild). Build an index from the fetched points; for the current bbox + zoom it returns cluster features (with `point_count`) and/or single-point features. Deterministic → stable; density-correct.

## Architecture

### `src/services/tomtom.ts`
- Add `export interface LatLngBounds { north; south; east; west }`.
- Add `searchChargersInBounds(bounds, car): Promise<Charger[]>` → POST `geometrySearch` with the bbox POLYGON; map results via existing `mapTomTomResult`; sort by distance from `car`. Mock fallback returns the mock set filtered to the bbox.
- **Remove** `searchChargersInViewport` (grid) and `thinChargers` (superseded by clustering). Keep `searchChargers` only if still needed for the mock anchor; otherwise fold into bounds fetch.
- **Widen the mock**: generate ~36 stations deterministically scattered within ~12 km of the anchor (bearings × distances grid) so clustering is demonstrable without a key.

### `src/services/clusterChargers.ts` (new)
- `zoomForRegion(region): number` = `round(log2(360 / longitudeDelta))`, clamped [1,20].
- `boundsForRegion(region): LatLngBounds` from centre ± delta/2.
- `buildIndex(chargers): Supercluster` — points are GeoJSON `Feature<Point>` with the `Charger` in `properties`; options `{ radius: 60, maxZoom: 16 }`.
- `getClusters(index, bounds, zoom): ClusterFeature[]` — thin wrapper over `index.getClusters([w,s,e,n], zoom)`.
- `expansionRegion(index, clusterId, region): Region` — `getClusterExpansionZoom` → longitudeDelta = `360 / 2^zoom`, centred on the cluster.

### `src/app/location.tsx`
- State: `fetched: Charger[]` (pool from last bbox fetch), `loadedBounds: LatLngBounds | null`, `region: ViewportRegion`.
- `filteredPool` = `fetched` with AC/DC + available-only filter applied.
- `index = useMemo(buildIndex(filteredPool), [filteredPool])`.
- `clusterFeatures = useMemo(getClusters(index, boundsForRegion(region), zoomForRegion(region)), [index, region])`.
- Render, when `tab === 'charging'`: for each feature → `ClusterBubble` (if `cluster`) else `ChargerPin`.
- `onRegionChangeComplete(r)`: `setRegion(r)`; if `r` outside a margin of `loadedBounds` → debounced `ensureBounds(r)` (fetch bbox padded ~1.5×, update `fetched` + `loadedBounds`).
- Tab open: `ensureBounds(carRegion, force)` then fit car + 2 nearest.
- Tap cluster → `mapRef.animateToRegion(expansionRegion(...))`. Tap pin → `onNavigateToCharger`.
- **List** (`LocationSheet`): stations currently in `boundsForRegion(region)` from `filteredPool`, sorted by the Sort control. Unchanged sheet UI/props.

### Components
- `ClusterBubble` (new, inline in `location.tsx` like `ChargerPin`): dark/red circle sized by count, showing `point_count`. Tap → expand.
- `ChargerPin`: reuse existing.

## Data flow

region settle → bbox + zoom → (fetch pool if outside cached bounds) → `supercluster.getClusters` → render bubbles/pins. Stable because the pool is cached and supercluster is deterministic.

## Dependencies

- `supercluster@^8` (+ `@types/supercluster`) — pure JS, ships via `deploy-js.sh`, no rebuild.

## Edge cases

- No key → mock (36 scattered stations) drives clustering.
- Empty bbox → no markers, empty list.
- `geometrySearch` caps at 100 per fetch → clustering + refetch-on-move keeps display sane even in dense cities.
- Filter/sort: filter applied *before* indexing (so clusters reflect the filter); sort applied to the list only.

## Testing

- Node unit tests (mirroring existing `*.test.ts`): `zoomForRegion`, `boundsForRegion`, bbox→polygon vertices, and `searchChargersInBounds` mock path (returns only in-bounds stations).
- Manual on-device: zoom out → bubbles with counts spread across map; zoom in → they split into pins; small zoom/pan → stable; tap cluster → zooms in; tap pin → directions.

## Out of scope (unchanged)

Live availability + price (TomTom EV Availability API, v2); in-app route polyline.

## Data-architecture decision record (from deep research, 2026-07-01)

Decided after a 9-agent research workflow (TomTom SDK/API/ToS, OpenChargeMap, OSM, real-app patterns, on-device preload). Conclusions:

- **API, not SDK.** The TomTom SDK's only unique capability is offline *vector map rendering*, which requires the native Swift `NDSStore` SDK (a ~25-min rebuild + risk to the custom Godot iOS project), replacing Apple Maps/`react-native-maps` with TomTom's renderer, and an "upon request" access grant. Not worth it for a connected app. TomTom's JS Maps SDK is public-preview 0.x and web-render-only (WebView on RN). Everything we need (clustering, EV filters, availability) is JS-only over REST.
- **No full local preload of TomTom data — it's a ToS violation.** TomTom terms clause 11.4 permits caching only within a Result's `cache-control` max-age (transient), and 11.6.1 forbids compiling a derivative database from extracted content; sanctioned downloads are 60–90-day time-boxed. Our fetched pool is therefore a **transient in-memory, per-session cache only** (never persisted to disk).
- **Static vs dynamic split** (OCPI/Tesla/TomTom all do this): STATIC (location, connector, power, operator) is cacheable; DYNAMIC (real-time availability, ~3-min refresh) must be fetched live, on-demand, never persisted.
- **Live availability (done):** TomTom EV Charging Stations Availability API, fetched only for visible stations, short TTL, in-memory. Badge shows real free-stall counts.

## Superseded: clustering removed (2026-07-01)

`supercluster` clustering was **removed** shortly after shipping. Reason: the marker now encodes **per-station** info (colour = DC red-by-power / AC grey; badge text = available slots, `"N?"` when unknown) — a cluster bubble is an aggregate and can't express that, and PlugShare itself doesn't cluster at city zoom. Since we fetch only the viewport (TomTom caps at 100/fetch), we render tens of **individual pins** directly. Same-coordinate overlaps are handled by stable id-ordered rendering (no flip) instead of a cluster bubble. `clusterChargers.ts` + `supercluster` were deleted; `boundsForRegion` moved into `tomtom.ts`.

**Offline baseline: dropped** (was optional; not worth the surface area — TomTom works online).
