# Charger Map Clustering Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make the Charging-tab map behave like PlugShare — bounding-box station fetch + `supercluster` clustering, so markers spread across the viewport, cluster into counted bubbles when zoomed out, split into pins when zoomed in, and stay stable across zoom/pan.

**Architecture:** Fetch stations for the current map bounding box via TomTom `geometrySearch` (POST POLYGON) and cache them. Feed the cached pool into a `supercluster` index; for the current bbox + zoom it returns cluster features (with counts) or single-point features. Render clusters as tappable count bubbles (zoom in) and points as charger pins (navigate). Deterministic → stable.

**Tech Stack:** React Native (Expo SDK 56), `react-native-maps`, `supercluster@8`, TomTom Search API (`geometrySearch`), Hermes; tests via `node --import tsx --test`.

## Global Constraints

- No native rebuild: everything ships via `bash scripts/godot-ios/deploy-js.sh` (JS-only). `supercluster` is pure JS — OK. Do NOT add native modules.
- TomTom key is read from `process.env.EXPO_PUBLIC_TOMTOM_API_KEY` (already in gitignored `.env.local`); `deploy-js.sh` sources it. After any change that could re-fold the key, verify with `strings <app>/main.jsbundle | grep 7onpPrwpn`.
- TomTom EV category id is `7309`. `geometrySearch` `limit` max is `100`.
- Keep the existing `Charger` interface shape; live availability + price stay mock (v2).
- Match existing code style: 2-space indent, named exports, focused files, node `*.test.ts` next to source.

---

### Task 1: Geo types + region↔bbox/zoom helpers

**Files:**
- Modify: `src/services/tomtom.ts` (add `LatLngBounds` interface near `ViewportRegion`)
- Create: `src/services/clusterChargers.ts`
- Test: `src/services/clusterChargers.test.ts`

**Interfaces:**
- Consumes: `ViewportRegion` (already exported from `tomtom.ts`: `{ latitude; longitude; latitudeDelta; longitudeDelta }`).
- Produces:
  - `interface LatLngBounds { north: number; south: number; east: number; west: number }` (exported from `tomtom.ts`)
  - `zoomForRegion(region: Pick<ViewportRegion,'longitudeDelta'>): number`
  - `boundsForRegion(region: ViewportRegion): LatLngBounds`

- [ ] **Step 1: Add the `LatLngBounds` type to `tomtom.ts`**

In `src/services/tomtom.ts`, right after the existing `ViewportRegion` interface, add:

```ts
export interface LatLngBounds {
  north: number;
  south: number;
  east: number;
  west: number;
}
```

- [ ] **Step 2: Write the failing test**

Create `src/services/clusterChargers.test.ts`:

```ts
import { test } from 'node:test';
import assert from 'node:assert/strict';

import { zoomForRegion, boundsForRegion } from './clusterChargers';

test('zoomForRegion maps longitudeDelta to a web-mercator zoom', () => {
  // 360° across → zoom 0-ish (clamped to 1); ~0.005° across → high zoom.
  assert.equal(zoomForRegion({ longitudeDelta: 360 }), 1); // clamped floor
  assert.equal(zoomForRegion({ longitudeDelta: 0.3515625 }), 10); // 360/2^10
  assert.ok(zoomForRegion({ longitudeDelta: 0.005 }) >= 15);
});

test('boundsForRegion returns the n/s/e/w edges of the region', () => {
  const b = boundsForRegion({ latitude: 42.7, longitude: 23.3, latitudeDelta: 0.1, longitudeDelta: 0.2 });
  assert.equal(b.north, 42.75);
  assert.equal(b.south, 42.65);
  assert.equal(b.east, 23.4);
  assert.equal(b.west, 23.2);
});
```

- [ ] **Step 3: Run test to verify it fails**

Run: `node --import tsx --test src/services/clusterChargers.test.ts`
Expected: FAIL — cannot find module `./clusterChargers`.

- [ ] **Step 4: Write minimal implementation**

Create `src/services/clusterChargers.ts`:

```ts
import type { LatLngBounds, ViewportRegion } from './tomtom';

// Web-mercator zoom that shows `longitudeDelta` degrees across the map, clamped to a sane range.
export function zoomForRegion(region: Pick<ViewportRegion, 'longitudeDelta'>): number {
  const z = Math.log2(360 / region.longitudeDelta);
  return Math.max(1, Math.min(20, Math.round(z)));
}

// The n/s/e/w edges of a region (centre ± half-delta).
export function boundsForRegion(region: ViewportRegion): LatLngBounds {
  return {
    north: region.latitude + region.latitudeDelta / 2,
    south: region.latitude - region.latitudeDelta / 2,
    east: region.longitude + region.longitudeDelta / 2,
    west: region.longitude - region.longitudeDelta / 2,
  };
}
```

- [ ] **Step 5: Run test to verify it passes**

Run: `node --import tsx --test src/services/clusterChargers.test.ts`
Expected: PASS (2 tests).

- [ ] **Step 6: Commit**

```bash
git add src/services/tomtom.ts src/services/clusterChargers.ts src/services/clusterChargers.test.ts
git commit -m "feat(charging): add LatLngBounds + region↔bbox/zoom helpers"
```

---

### Task 2: TomTom bounding-box fetch + widened mock

**Files:**
- Modify: `src/services/tomtom.ts` (add `searchChargersInBounds`; widen the mock; remove the superseded `searchChargers`, `searchChargersInViewport`, `thinChargers`, `ChargerQuery`, grid constants, `MOCK_SPECS`, `mockChargersNear`)
- Test: `src/services/tomtom.test.ts`

**Interfaces:**
- Consumes: `LatLngBounds` (Task 1), `LatLng`/`distanceMeters`/`offsetCoordinate` (from `mockLocation`), existing `mapTomTomResult`, `TOMTOM_KEY`, `EV_CATEGORY`, `Charger`.
- Produces: `searchChargersInBounds(bounds: LatLngBounds, car: LatLng): Promise<Charger[]>` (sorted by distance from `car`).

- [ ] **Step 1: Write the failing test**

Create `src/services/tomtom.test.ts`:

```ts
import { test } from 'node:test';
import assert from 'node:assert/strict';

import { searchChargersInBounds } from './tomtom';

// With no EXPO_PUBLIC_TOMTOM_API_KEY in the test env, this hits the mock path.
test('searchChargersInBounds returns only stations inside the bounds (mock path)', async () => {
  const car = { latitude: 42.6977, longitude: 23.3219 };
  const wide = await searchChargersInBounds({ north: 42.85, south: 42.55, east: 23.5, west: 23.15 }, car);
  const tiny = await searchChargersInBounds({ north: 42.70, south: 42.695, east: 23.325, west: 23.32 }, car);
  assert.ok(wide.length > tiny.length, 'a wider box contains at least as many stations');
  for (const c of tiny) {
    assert.ok(c.latitude <= 42.70 && c.latitude >= 42.695, 'lat in bounds');
    assert.ok(c.longitude <= 23.325 && c.longitude >= 23.32, 'lon in bounds');
  }
});

test('searchChargersInBounds sorts by distance from the car', async () => {
  const car = { latitude: 42.6977, longitude: 23.3219 };
  const list = await searchChargersInBounds({ north: 42.85, south: 42.55, east: 23.5, west: 23.15 }, car);
  for (let i = 1; i < list.length; i += 1) {
    assert.ok(list[i].distanceM >= list[i - 1].distanceM);
  }
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `node --import tsx --test src/services/tomtom.test.ts`
Expected: FAIL — `searchChargersInBounds` is not exported.

- [ ] **Step 3: Replace the fetch/mock internals in `tomtom.ts`**

In `src/services/tomtom.ts`: delete `searchChargers`, `ChargerQuery`, `fetchTomTom`, `searchChargersInViewport`, `thinChargers`, the `GRID`/`PER_CELL`/`MAX_MARKERS`/`SEP_DIVISOR`/`SINGLE_QUERY_SPAN_KM` constants, `MOCK_SPECS`, and `mockChargersNear`. Keep `Charger`, `chargerCoord`, `ViewportRegion`, `LatLngBounds`, `TOMTOM_KEY`, `EV_CATEGORY`, `TomTomResult`, `mapTomTomResult`. Then add:

```ts
// Search EV stations inside a map bounding box via TomTom geometrySearch (POST POLYGON) — returns
// stations spread across the whole rectangle, not just nearest-to-centre. Sorted by distance from car.
export async function searchChargersInBounds(bounds: LatLngBounds, car: LatLng): Promise<Charger[]> {
  const raw = TOMTOM_KEY ? await fetchTomTomBounds(bounds) : mockChargersInBounds(bounds);
  return raw
    .map((c) => ({ ...c, distanceM: distanceMeters(car, c) }))
    .sort((a, b) => a.distanceM - b.distanceM);
}

async function fetchTomTomBounds(b: LatLngBounds): Promise<Charger[]> {
  const body = JSON.stringify({
    geometryList: [
      {
        type: 'POLYGON',
        vertices: [`${b.north},${b.west}`, `${b.north},${b.east}`, `${b.south},${b.east}`, `${b.south},${b.west}`],
      },
    ],
  });
  try {
    const res = await fetch(
      `https://api.tomtom.com/search/2/geometrySearch/.json?key=${TOMTOM_KEY}&categorySet=${EV_CATEGORY}&limit=100`,
      { method: 'POST', headers: { 'Content-Type': 'application/json' }, body },
    );
    if (!res.ok) return [];
    const json = (await res.json()) as { results?: TomTomResult[] };
    return (json.results ?? []).map(mapTomTomResult).filter((c): c is Charger => c !== null);
  } catch {
    return [];
  }
}

// --- Mock fallback (until/without a key): ~36 stations scattered on 3 rings around the first-queried
// centre (the car), so clustering is demonstrable. searchChargersInBounds filters them to the bbox.
let mockAnchor: LatLng | null = null;
let mockSet: Charger[] | null = null;
const MOCK_NAMES = ['Tesla Supercharger', 'Ionity', 'Eldrive', 'Shell Recharge', 'AMP Charge', 'PowerGo'];

function ensureMockSet(center: LatLng): Charger[] {
  if (mockAnchor && mockSet) return mockSet;
  mockAnchor = center;
  const set: Charger[] = [];
  let i = 0;
  for (const dist of [2000, 5000, 9000]) {
    for (let bearing = 0; bearing < 360; bearing += 30) {
      const coord = offsetCoordinate(center, { bearingDeg: bearing, distanceM: dist });
      const dc = i % 2 === 0;
      set.push({
        id: `mock-${i}`,
        name: MOCK_NAMES[i % MOCK_NAMES.length],
        place: 'Sofia',
        region: 'Sofia, Bulgaria',
        latitude: coord.latitude,
        longitude: coord.longitude,
        currentType: dc ? 'DC' : 'AC',
        maxPowerKW: dc ? [50, 120, 250][i % 3] : [7, 11, 22][i % 3],
        totalConnectors: (i % 6) + 1,
        availableConnectors: i % 4,
        pricePerKWh: 0.3 + (i % 5) * 0.1,
        distanceM: 0,
      });
      i += 1;
    }
  }
  mockSet = set;
  return set;
}

function mockChargersInBounds(b: LatLngBounds): Charger[] {
  const center = { latitude: (b.north + b.south) / 2, longitude: (b.east + b.west) / 2 };
  return ensureMockSet(center).filter(
    (c) => c.latitude <= b.north && c.latitude >= b.south && c.longitude <= b.east && c.longitude >= b.west,
  );
}
```

Ensure the imports at the top still include `distanceMeters`, `offsetCoordinate`, `type LatLng` from `@/state/mockLocation` (they already do).

- [ ] **Step 4: Run test to verify it passes**

Run: `node --import tsx --test src/services/tomtom.test.ts`
Expected: PASS (2 tests).

- [ ] **Step 5: Typecheck (surfaces any leftover references to removed exports)**

Run: `npx tsc --noEmit`
Expected: errors in `src/app/location.tsx` referencing the now-removed `searchChargersInViewport`/`thinChargers`/`searchChargers` (fixed in Task 4). No errors inside `tomtom.ts` or `clusterChargers.ts`.

- [ ] **Step 6: Commit**

```bash
git add src/services/tomtom.ts src/services/tomtom.test.ts
git commit -m "feat(charging): TomTom geometrySearch bbox fetch + widened mock; drop grid/thin"
```

---

### Task 3: supercluster wrapper

**Files:**
- Modify: `package.json` (add `supercluster`, `@types/supercluster`)
- Modify: `src/services/clusterChargers.ts`
- Test: `src/services/clusterChargers.test.ts` (extend)

**Interfaces:**
- Consumes: `Charger` (from `tomtom`), `LatLngBounds`, `ViewportRegion`, `boundsForRegion`, `zoomForRegion`.
- Produces:
  - `type ChargerProps = { charger: Charger }`
  - `type ChargerClusterIndex = Supercluster<ChargerProps>`
  - `buildIndex(chargers: Charger[]): ChargerClusterIndex`
  - `getClusterFeatures(index, bounds: LatLngBounds, zoom: number): Array<Supercluster.PointFeature<ChargerProps> | Supercluster.ClusterFeature<Supercluster.AnyProps>>`
  - `expansionRegion(index, clusterId: number, latitude: number, longitude: number): ViewportRegion`

- [ ] **Step 1: Install supercluster**

Run:
```bash
pnpm add supercluster@^8 && pnpm add -D @types/supercluster
```
Expected: both added; no peer-dep errors (pure JS).

- [ ] **Step 2: Write the failing test (extend clusterChargers.test.ts)**

Append to `src/services/clusterChargers.test.ts`:

```ts
import { buildIndex, getClusterFeatures, expansionRegion } from './clusterChargers';
import type { Charger } from './tomtom';

function charger(id: string, latitude: number, longitude: number): Charger {
  return {
    id, name: id, place: '', region: '', latitude, longitude,
    currentType: 'DC', maxPowerKW: 50, totalConnectors: 2, availableConnectors: 1, distanceM: 0,
  };
}

test('buildIndex + getClusterFeatures clusters nearby points when zoomed out, splits when zoomed in', () => {
  // Three points within ~200m of each other.
  const pts = [charger('a', 42.700, 23.300), charger('b', 42.7005, 23.3005), charger('c', 42.701, 23.301)];
  const index = buildIndex(pts);
  const bounds = { north: 42.8, south: 42.6, east: 23.4, west: 23.2 };
  const zoomedOut = getClusterFeatures(index, bounds, 11);
  const zoomedIn = getClusterFeatures(index, bounds, 18);
  const clustersOut = zoomedOut.filter((f) => (f.properties as any).cluster);
  assert.equal(clustersOut.length, 1, 'nearby points collapse to one cluster when zoomed out');
  assert.equal((clustersOut[0].properties as any).point_count, 3);
  assert.equal(zoomedIn.filter((f) => (f.properties as any).cluster).length, 0, 'no clusters when zoomed in');
  assert.equal(zoomedIn.length, 3, 'three individual points when zoomed in');
});

test('expansionRegion returns a tighter region centred on the cluster', () => {
  const pts = [charger('a', 42.700, 23.300), charger('b', 42.7005, 23.3005), charger('c', 42.701, 23.301)];
  const index = buildIndex(pts);
  const [cluster] = getClusterFeatures(index, { north: 42.8, south: 42.6, east: 23.4, west: 23.2 }, 11).filter(
    (f) => (f.properties as any).cluster,
  );
  const region = expansionRegion(index, (cluster.properties as any).cluster_id, 42.7005, 23.3005);
  assert.equal(region.latitude, 42.7005);
  assert.equal(region.longitude, 23.3005);
  assert.ok(region.longitudeDelta > 0 && region.longitudeDelta < 0.4);
});
```

- [ ] **Step 3: Run test to verify it fails**

Run: `node --import tsx --test src/services/clusterChargers.test.ts`
Expected: FAIL — `buildIndex` not exported.

- [ ] **Step 4: Implement the supercluster wrapper**

Append to `src/services/clusterChargers.ts`:

```ts
import Supercluster from 'supercluster';
import type { Charger } from './tomtom';

export type ChargerProps = { charger: Charger };
export type ChargerClusterIndex = Supercluster<ChargerProps, Supercluster.AnyProps>;
export type ChargerFeature =
  | Supercluster.PointFeature<ChargerProps>
  | Supercluster.ClusterFeature<Supercluster.AnyProps>;

// Build a clustering index from the charger pool. radius 60 (px), maxZoom 16 (stop clustering past it).
export function buildIndex(chargers: Charger[]): ChargerClusterIndex {
  const index = new Supercluster<ChargerProps, Supercluster.AnyProps>({ radius: 60, maxZoom: 16 });
  index.load(
    chargers.map((c) => ({
      type: 'Feature' as const,
      properties: { charger: c },
      geometry: { type: 'Point' as const, coordinates: [c.longitude, c.latitude] },
    })),
  );
  return index;
}

// Clusters + single points visible in `bounds` at `zoom`. supercluster bbox order is [w, s, e, n].
export function getClusterFeatures(index: ChargerClusterIndex, bounds: LatLngBounds, zoom: number): ChargerFeature[] {
  return index.getClusters([bounds.west, bounds.south, bounds.east, bounds.north], zoom);
}

// The region a cluster expands into when tapped — centred on the cluster, zoomed to just split it.
export function expansionRegion(
  index: ChargerClusterIndex,
  clusterId: number,
  latitude: number,
  longitude: number,
): ViewportRegion {
  const zoom = Math.min(index.getClusterExpansionZoom(clusterId), 18);
  const longitudeDelta = 360 / 2 ** zoom;
  return { latitude, longitude, latitudeDelta: longitudeDelta, longitudeDelta };
}
```

(Move the `import type { LatLngBounds, ViewportRegion } from './tomtom';` line at the top of the file to also cover these — it already imports both.)

- [ ] **Step 5: Run test to verify it passes**

Run: `node --import tsx --test src/services/clusterChargers.test.ts`
Expected: PASS (4 tests).

- [ ] **Step 6: Commit**

```bash
git add package.json pnpm-lock.yaml src/services/clusterChargers.ts src/services/clusterChargers.test.ts
git commit -m "feat(charging): supercluster wrapper (buildIndex/getClusterFeatures/expansionRegion)"
```

---

### Task 4: Rewire LocationView to bbox fetch + clustered markers

**Files:**
- Modify: `src/app/location.tsx`

**Interfaces:**
- Consumes: `searchChargersInBounds` (Task 2); `buildIndex`, `getClusterFeatures`, `expansionRegion`, `boundsForRegion`, `zoomForRegion`, `ChargerFeature` (Tasks 1/3); existing `chargerCoord`, `Charger`, `LatLngBounds`, `ViewportRegion`, `distanceMeters`.
- Produces: none (screen).

- [ ] **Step 1: Update imports**

In `src/app/location.tsx`, replace the `@/services/tomtom` import block with:

```ts
import {
  chargerCoord,
  searchChargersInBounds,
  type Charger,
  type LatLngBounds,
  type ViewportRegion,
} from '@/services/tomtom';
import {
  boundsForRegion,
  buildIndex,
  expansionRegion,
  getClusterFeatures,
  zoomForRegion,
  type ChargerFeature,
} from '@/services/clusterChargers';
```

Keep the `@/state/mockLocation` import (still needs `distanceMeters`, `offsetCoordinate`, `formatTimeAgo`, `getMockLastUpdated`, `type LatLng`, `type MockLocationOffset`). Keep the `LocationSheet` import.

- [ ] **Step 2: Replace charging state + derived data**

Replace the current `fetched`/`region`/`loadedRef` state and the `visibleChargers` memo with:

```ts
  const [tab, setTab] = useState<LocationTab>('recents');
  const [fetched, setFetched] = useState<Charger[]>([]);
  const [region, setRegion] = useState<ViewportRegion>({ ...FALLBACK_COORD, ...DEFAULT_DELTA });
  const [sort, setSort] = useState<ChargerSort>('distance');
  const [filter, setFilter] = useState<ChargerFilter>({ dc: true, ac: true, availableOnly: false });
  const sheetRef = useRef<LocationSheetHandle>(null);
  const loadedRef = useRef<LatLngBounds | null>(null);
  const refetchTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

  const carCoord = useMemo(
    () => offsetCoordinate(userCoord ?? FALLBACK_COORD, offset),
    [userCoord, offset],
  );

  // Pool filtered by AC/DC + availability. Clusters/list both derive from this so they stay consistent.
  const filteredPool = useMemo(() => {
    let pool = fetched;
    if (filter.dc !== filter.ac) {
      pool = pool.filter((c) => (filter.dc ? c.currentType === 'DC' : c.currentType === 'AC'));
    }
    if (filter.availableOnly) pool = pool.filter((c) => c.availableConnectors > 0);
    return pool;
  }, [fetched, filter]);

  // supercluster index over the filtered pool; recomputed only when the pool changes.
  const index = useMemo(() => buildIndex(filteredPool), [filteredPool]);

  // Cluster + point features for the current viewport (stable across small zoom/pan).
  const clusterFeatures: ChargerFeature[] = useMemo(
    () => getClusterFeatures(index, boundsForRegion(region), zoomForRegion(region)),
    [index, region],
  );

  // The list shows the stations currently in view, sorted by the Sort control.
  const visibleChargers = useMemo(() => {
    const b = boundsForRegion(region);
    const inView = filteredPool.filter(
      (c) => c.latitude <= b.north && c.latitude >= b.south && c.longitude <= b.east && c.longitude >= b.west,
    );
    if (sort === 'availability') inView.sort((a, b2) => b2.availableConnectors - a.availableConnectors);
    else if (sort === 'price') inView.sort((a, b2) => (a.pricePerKWh ?? Infinity) - (b2.pricePerKWh ?? Infinity));
    else inView.sort((a, b2) => a.distanceM - b2.distanceM);
    return inView;
  }, [filteredPool, region, sort]);
```

- [ ] **Step 3: Replace the fetch/fit/region-change logic**

Replace the `regionRadiusM`/`ensureCoverage`/tab-open `useEffect`/`onRegionChangeComplete` block with:

```ts
  // Does the cached bbox still comfortably contain the viewport? (margin so we refetch a bit early.)
  const boundsCover = (loaded: LatLngBounds | null, r: ViewportRegion): boolean => {
    if (!loaded) return false;
    const b = boundsForRegion(r);
    return b.north <= loaded.north && b.south >= loaded.south && b.east <= loaded.east && b.west >= loaded.west;
  };

  // Fetch a WIDE bbox (2× the viewport) and cache it. Skips when the viewport is inside the cached box.
  const ensureBounds = async (r: ViewportRegion, force = false): Promise<Charger[] | null> => {
    if (!force && boundsCover(loadedRef.current, r)) return null;
    const wide: ViewportRegion = {
      latitude: r.latitude,
      longitude: r.longitude,
      latitudeDelta: r.latitudeDelta * 2,
      longitudeDelta: r.longitudeDelta * 2,
    };
    const bounds = boundsForRegion(wide);
    const list = await searchChargersInBounds(bounds, carCoord);
    loadedRef.current = bounds;
    setFetched(list);
    return list;
  };

  // Entering the Charging tab: fetch the pool near the car and frame the car + its two nearest.
  useEffect(() => {
    if (tab !== 'charging') return;
    const r: ViewportRegion = { ...carCoord, ...DEFAULT_DELTA };
    setRegion(r);
    ensureBounds(r, true).then((list) => {
      if (!list) return;
      const nearest = [...list].sort((a, b) => a.distanceM - b.distanceM).slice(0, 2).map(chargerCoord);
      if (nearest.length === 0) {
        recenter(carCoord);
        return;
      }
      mapRef.current?.fitToCoordinates([carCoord, ...nearest], {
        edgePadding: { top: 130, right: 70, bottom: Math.round(height * SHEET_MIDDLE_FRAC) + 40, left: 70 },
        animated: true,
      });
    });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [tab]);

  // On settle: re-cluster from the cached pool instantly (stable); lazily widen the pool if we left the
  // cached box (debounced).
  const onRegionChangeComplete = (r: Region) => {
    if (tab !== 'charging') return;
    setRegion(r);
    if (refetchTimer.current) clearTimeout(refetchTimer.current);
    refetchTimer.current = setTimeout(() => ensureBounds(r), 350);
  };

  // Tap a cluster bubble → zoom the map in to split it.
  const onClusterPress = (clusterId: number, latitude: number, longitude: number) => {
    Haptics.selectionAsync().catch(() => {});
    mapRef.current?.animateToRegion(expansionRegion(index, clusterId, latitude, longitude), 300);
  };
```

- [ ] **Step 4: Replace the charger markers in the MapView with cluster/point features**

Replace the existing `{tab === 'charging' && visibleChargers.map(...)}` marker block with:

```tsx
        {tab === 'charging' &&
          clusterFeatures.map((f) => {
            const [longitude, latitude] = f.geometry.coordinates;
            const props = f.properties as { cluster?: boolean; cluster_id?: number; point_count?: number; charger?: Charger };
            if (props.cluster) {
              return (
                <Marker
                  key={`cluster-${props.cluster_id}`}
                  coordinate={{ latitude, longitude }}
                  anchor={{ x: 0.5, y: 0.5 }}
                  onPress={() => onClusterPress(props.cluster_id!, latitude, longitude)}
                >
                  <ClusterBubble count={props.point_count ?? 0} />
                </Marker>
              );
            }
            const c = props.charger!;
            return (
              <Marker
                key={c.id}
                coordinate={{ latitude, longitude }}
                anchor={{ x: 0.5, y: 1 }}
                onPress={() => onNavigateToCharger(c)}
              >
                <ChargerPin available={c.availableConnectors} />
              </Marker>
            );
          })}
```

- [ ] **Step 5: Add the `ClusterBubble` component + styles**

After the `ChargerPin` component in `src/app/location.tsx`, add:

```tsx
// Cluster bubble: a red circle with the number of stations it groups. Tapping it zooms in to split it.
function ClusterBubble({ count }: { count: number }) {
  const size = count >= 100 ? 52 : count >= 25 ? 46 : 40;
  return (
    <View style={[styles.cluster, { width: size, height: size, borderRadius: size / 2 }]}>
      <Text style={styles.clusterText}>{count}</Text>
    </View>
  );
}
```

Add to the `StyleSheet.create({ ... })` (next to the pin styles):

```ts
  cluster: {
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: '#E5484D',
    borderWidth: 2,
    borderColor: 'rgba(255,255,255,0.9)',
  },
  clusterText: {
    color: 'white',
    fontSize: 15,
    fontWeight: '700',
  },
```

- [ ] **Step 6: Typecheck**

Run: `npx tsc --noEmit`
Expected: clean (blank output).

- [ ] **Step 7: Run the whole node test suite**

Run: `npm test && node --import tsx --test src/services/clusterChargers.test.ts src/services/tomtom.test.ts`
Expected: all pass (existing suite + new cluster/tomtom tests).

- [ ] **Step 8: Commit**

```bash
git add src/app/location.tsx
git commit -m "feat(charging): cluster markers via supercluster; bbox fetch + cache; tap-to-zoom clusters"
```

---

### Task 5: Deploy + on-device verification

**Files:** none (deploy + manual verification)

- [ ] **Step 1: Deploy the JS bundle**

Run: `LANG=en_US.UTF-8 LC_ALL=en_US.UTF-8 bash scripts/godot-ios/deploy-js.sh`
Expected: `✓ done` (a `CoreDeviceError 10002` on auto-launch is benign — the install succeeded).

- [ ] **Step 2: Verify the TomTom key + geometrySearch shipped in the bundle**

Run:
```bash
APP=$(ls -dt ~/Library/Developer/Xcode/DerivedData/airgapp-*/Build/Products/Release-iphoneos/airgapp.app | head -1)
strings "$APP/main.jsbundle" | grep -q 7onpPrwpn && echo "KEY ✓"
strings "$APP/main.jsbundle" | grep -c geometrySearch | xargs echo "geometrySearch refs:"
```
Expected: `KEY ✓` and `geometrySearch refs:` ≥ 1. If the key is absent, re-run with `--reset-cache` once (`cd "$APP_REPO" && npx expo export:embed … --reset-cache`) then redeploy.

- [ ] **Step 3: Manual verification on device (ask the user to confirm)**

Open Location → Charging and check:
1. Zoomed out → **cluster bubbles with counts** spread across the map (not a centre pile).
2. Zoom in → clusters **split into individual pins**; small zoom/pan is **stable** (no reshuffle).
3. **Tap a cluster** → map zooms in and the cluster splits.
4. **Tap a pin** → native-maps directions open.
5. Filter (DC/AC/Available only) and Sort still work; the list matches what's on the map.

- [ ] **Step 4: Commit any tuning**

If radius/zoom feel off, tune `radius`/`maxZoom` in `buildIndex` (Task 3) or `DEFAULT_DELTA`, then:
```bash
git add -A && git commit -m "chore(charging): tune cluster radius/zoom"
```

---

## Self-Review

**Spec coverage:** bbox fetch (Task 2) ✓; supercluster clustering (Tasks 3–4) ✓; stable across zoom/pan via cached pool + deterministic clusters (Task 4) ✓; tap cluster → zoom (Task 4 step 3/4) ✓; tap pin → navigate (Task 4 step 4) ✓; list = in-view sorted (Task 4 step 2) ✓; widened mock (Task 2) ✓; filter before indexing (Task 4 `filteredPool`) ✓; remove grid/thin (Task 2) ✓; unit tests (Tasks 1–3) ✓; deploy + verify (Task 5) ✓.

**Placeholders:** none — every code step shows full code; commands have expected output.

**Type consistency:** `LatLngBounds` (tomtom) used everywhere; `ViewportRegion` reused; `ChargerFeature` produced in Task 3 and consumed in Task 4; `searchChargersInBounds(bounds, car)` signature matches call site; `expansionRegion(index, clusterId, lat, lon)` matches `onClusterPress`. Removed exports (`searchChargersInViewport`, `thinChargers`, `searchChargers`) are deleted in Task 2 and no longer imported after Task 4.
