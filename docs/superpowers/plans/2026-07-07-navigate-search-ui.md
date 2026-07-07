# Navigate Search UI + Recents Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Wire the Location sheet's "Navigate" box into a live search UI — tap to expand the sheet to full height + focus a text field, type to get Apple-ranked autocomplete rows (name / address / distance-from-car), and record tapped results into a locally-persisted Recents list.

**Architecture:** Builds on the existing search logic. The live list uses Apple `MKLocalSearch` (via the already-built `AppleSearch` native module's `search` method) online, falling back to the bundled gazetteer + charger DB offline. Recents persist in a small SQLite table (`recents.db`). Pure logic (day-grouping, the online/offline branch) is node-tested; the UI + persistence are device-verified. **JS-only deploy — no native rebuild.**

**Tech Stack:** Expo SDK 56, React Native 0.85 (Hermes), TypeScript, `expo-sqlite@56.0.5` (already linked), the `AppleSearch` local module (already built), `react-native` `TextInput`, Node built-in test runner.

## Global Constraints

- **JS-only — NO native rebuild, NO `pod install`, NO `expo prebuild`.** Everything here uses APIs already in the installed binary (`expo-sqlite`, the `AppleSearch` module's `search`, RN `TextInput`). Deploy with `bash scripts/godot-ios/deploy-js.sh`.
- **Add NO new dependencies.**
- **Tests:** pure logic only, run via `node --import tsx --test`; register each new `*.test.ts` in `package.json`'s `test` script. Modules under test must not import React Native / expo-sqlite.
- **`Date.now()` is fine in app runtime** (the ban is only in Workflow scripts). Grouping/store functions take an explicit `now`/`savedAt` param so they stay testable.
- **Distance is measured from the car** (`carCoord`), via `distanceMeters` + `formatKm` from `@/state/mockLocation` (matches the charger list).
- **Online = Apple only; offline = local fallback.** `recents.db` lives in expo-sqlite's default directory and persists across restarts.
- **Device:** CoreDevice `F3867E6E-E95F-5B2A-9C4E-06D1D72475A1`, bundle `local.airgapp.mobile`.

## File Structure

```
Pure (node:test):
  src/services/recents.ts              CREATE  RecentEntry/RecentGroup types + groupRecentsByDay(entries, now)
  src/services/recents.test.ts         CREATE  grouping tests
  src/services/searchProvider.ts       MODIFY  SearchDeps.appleSearch; runSearch = online-Apple / offline-local
  src/services/searchProvider.test.ts  MODIFY  rewrite for the new branch

Native / device (manual verify):
  src/services/appleSearch.ts          MODIFY  add appleSearch(q, region) using the native `search` (has coords)
  src/services/recentsStore.ts         CREATE  SQLite-backed recents (addRecent / loadRecents), all sync
  src/hooks/useNavigateSearch.ts       MODIFY  online/offline branch; expose results/query/setQuery/recentGroups/select
  src/components/LocationSheet.tsx      MODIFY  search/focused mode (TextInput, floating label, ✕), PlaceRow,
                                               recents groups, full-detent-on-focus, carCoord prop
  src/app/location.tsx                 MODIFY  own the hook, pass props

Deploy:
  bash scripts/godot-ios/deploy-js.sh  (JS-only, ~30s)
```

**Type/name contract (define once, reuse verbatim):**
- `RecentEntry = { place: Place; savedAt: number }` (Task 1)
- `RecentGroup = { title: string; items: Place[] }` (Task 1)
- `groupRecentsByDay(entries: RecentEntry[], now: number): RecentGroup[]` (Task 1)
- `SearchDeps = { localSearch: (q: string, region: SearchRegion) => Place[]; appleSearch: (q: string, region: SearchRegion) => Promise<Place[]> }` (Task 2)
- `runSearch(rawQuery: string, region: SearchRegion, deps: SearchDeps): Promise<Place[]>` and `RESULT_CAP = 12` (Task 2)
- `appleSearch(q: string, region: SearchRegion): Promise<Place[]>` (Task 2, in `appleSearch.ts`)
- `addRecent(place: Place, savedAt: number): void`, `loadRecents(): RecentEntry[]` (Task 3)
- `useNavigateSearch(region: SearchRegion)` returns `{ query, setQuery, results, recentGroups, select }` (Task 4)
- `Place` and `SearchRegion` from `@/services/place` (existing).

---

### Task 1: Recents day-grouping (pure)

**Files:**
- Create: `src/services/recents.ts`
- Test: `src/services/recents.test.ts`
- Modify: `package.json` (register test)

**Interfaces:**
- Produces: `RecentEntry`, `RecentGroup` types; `groupRecentsByDay(entries, now)`.
- Consumes: `Place` from `./place`.

- [ ] **Step 1: Write the failing test** — `src/services/recents.test.ts`

```ts
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { groupRecentsByDay, type RecentEntry } from './recents';
import type { Place } from './place';

const p = (id: string): Place => ({
  id, title: id, coordinate: { latitude: 42.7, longitude: 23.3 }, kind: 'recent', source: 'recent',
});
// Fixed "now" = 2026-07-07 12:00 local.
const NOW = new Date(2026, 6, 7, 12, 0, 0).getTime();
const DAY = 86_400_000;

test('buckets into Today / Yesterday / dated, newest group first', () => {
  const entries: RecentEntry[] = [
    { place: p('a'), savedAt: NOW - 60_000 },       // today
    { place: p('b'), savedAt: NOW - DAY - 60_000 }, // yesterday
    { place: p('c'), savedAt: new Date(2026, 6, 2, 9, 0, 0).getTime() }, // 2 Jul
  ];
  const groups = groupRecentsByDay(entries, NOW);
  assert.deepEqual(groups.map((g) => g.title), ['Today', 'Yesterday', '2 Jul']);
  assert.deepEqual(groups.map((g) => g.items.map((i) => i.id)), [['a'], ['b'], ['c']]);
});

test('keeps input order within a day and merges same-day entries', () => {
  const entries: RecentEntry[] = [
    { place: p('a'), savedAt: NOW - 1000 },
    { place: p('b'), savedAt: NOW - 2000 },
  ];
  const groups = groupRecentsByDay(entries, NOW);
  assert.equal(groups.length, 1);
  assert.deepEqual(groups[0].items.map((i) => i.id), ['a', 'b']);
});

test('empty input → no groups', () => {
  assert.deepEqual(groupRecentsByDay([], NOW), []);
});
```

- [ ] **Step 2: Run it, verify it fails**

Run: `node --import tsx --test src/services/recents.test.ts`
Expected: FAIL — `Cannot find module './recents'`.

- [ ] **Step 3: Write `src/services/recents.ts`**

```ts
// Pure recents model + day-grouping for the Navigate list. NO React Native / expo imports (node-testable).
// The store (recentsStore.ts) supplies RecentEntry[] newest-first; this groups them for display.
import type { Place } from './place';

export interface RecentEntry {
  place: Place;
  savedAt: number; // epoch ms
}

export interface RecentGroup {
  title: string; // "Today" | "Yesterday" | "2 Jul"
  items: Place[];
}

const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
const DAY_MS = 86_400_000;

function startOfLocalDay(t: number): number {
  const d = new Date(t);
  d.setHours(0, 0, 0, 0);
  return d.getTime();
}

// Group newest-first entries into Today / Yesterday / "D Mon" buckets, preserving input order. Groups appear
// in first-seen order (so, given newest-first input, most-recent day first).
export function groupRecentsByDay(entries: RecentEntry[], now: number): RecentGroup[] {
  const today = startOfLocalDay(now);
  const order: string[] = [];
  const byTitle = new Map<string, Place[]>();
  for (const e of entries) {
    const day = startOfLocalDay(e.savedAt);
    let title: string;
    if (day === today) title = 'Today';
    else if (day === today - DAY_MS) title = 'Yesterday';
    else {
      const d = new Date(e.savedAt);
      title = `${d.getDate()} ${MONTHS[d.getMonth()]}`;
    }
    if (!byTitle.has(title)) {
      byTitle.set(title, []);
      order.push(title);
    }
    byTitle.get(title)!.push(e.place);
  }
  return order.map((title) => ({ title, items: byTitle.get(title)! }));
}
```

- [ ] **Step 4: Run the test, verify it passes**

Run: `node --import tsx --test src/services/recents.test.ts`
Expected: PASS (3 tests).

- [ ] **Step 5: Register the test** — in `package.json`, append `src/services/recents.test.ts` to the `test` script (keep all existing entries):

```json
    "test": "node --import tsx --test src/state/fleet.test.ts src/state/controlActions.test.ts src/state/preferences.test.ts src/state/persistence.test.ts src/services/gazetteer.test.ts src/services/place.test.ts src/services/searchProvider.test.ts src/services/recents.test.ts"
```

- [ ] **Step 6: Commit**

```bash
git add src/services/recents.ts src/services/recents.test.ts package.json
git commit -m "feat(navigate): recents day-grouping (pure)"
```

---

### Task 2: searchProvider online-Apple / offline-local + `appleSearch`

**Files:**
- Modify: `src/services/searchProvider.ts`
- Modify: `src/services/searchProvider.test.ts`
- Modify: `src/services/appleSearch.ts`

**Interfaces:**
- Produces: `SearchDeps = { localSearch, appleSearch }`; `runSearch(rawQuery, region, deps)`; `RESULT_CAP = 12`; and `appleSearch(q, region): Promise<Place[]>` in `appleSearch.ts`.
- Consumes: `normalizeQuery`, `rankPlaces`, `Place`, `SearchRegion` from `./place`; the native `AppleSearch.search`.

- [ ] **Step 1: Rewrite the test** — replace the entire contents of `src/services/searchProvider.test.ts`

```ts
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { runSearch, RESULT_CAP, type SearchDeps } from './searchProvider';
import type { Place, SearchRegion } from './place';

const REGION: SearchRegion = { latitude: 42.7, longitude: 23.3, latitudeDelta: 0.5, longitudeDelta: 0.5 };
const place = (over: Partial<Place>): Place => ({
  id: 'x', title: 'X', coordinate: { latitude: 42.7, longitude: 23.3 }, kind: 'poi', source: 'apple', ...over,
});
const deps = (over: Partial<SearchDeps> = {}): SearchDeps => ({
  localSearch: () => [],
  appleSearch: async () => [],
  ...over,
});

test('empty query returns no results', async () => {
  assert.deepEqual(await runSearch('   ', REGION, deps()), []);
});

test('online: returns Apple results in Apple order (not re-ranked)', async () => {
  const apple = [place({ id: 'a1', title: 'Vidin' }), place({ id: 'a2', title: 'Vidimeks' })];
  const out = await runSearch('vidi', REGION, deps({ appleSearch: async () => apple }));
  assert.deepEqual(out.map((p) => p.id), ['a1', 'a2']);
});

test('online results are capped at RESULT_CAP', async () => {
  const many = Array.from({ length: RESULT_CAP + 8 }, (_, i) => place({ id: `a${i}` }));
  const out = await runSearch('x', REGION, deps({ appleSearch: async () => many }));
  assert.equal(out.length, RESULT_CAP);
});

test('offline: Apple rejects → ranked local results', async () => {
  const local = [place({ id: 'l', title: 'Sofia', source: 'gazetteer', kind: 'city' })];
  const out = await runSearch('so', REGION, deps({
    appleSearch: async () => { throw new Error('offline'); },
    localSearch: () => local,
  }));
  assert.deepEqual(out.map((p) => p.id), ['l']);
});
```

- [ ] **Step 2: Run it, verify it fails**

Run: `node --import tsx --test src/services/searchProvider.test.ts`
Expected: FAIL — `RESULT_CAP`/`appleSearch` mismatch (old module exports `appleComplete`).

- [ ] **Step 3: Rewrite `src/services/searchProvider.ts`**

```ts
// Pure search orchestration. Online = Apple's MKLocalSearch results (its order, with coordinates); offline
// (Apple rejects) = the local gazetteer + charger DB, ranked by place.ts. Dependency-injected so it stays
// node-testable. NO native imports here.
import { normalizeQuery, rankPlaces, type Place, type SearchRegion } from './place';

// Max rows shown in the autocomplete list.
export const RESULT_CAP = 12;

export interface SearchDeps {
  // Online: Apple MKLocalSearch (results carry coordinates). Rejects when offline / on MKError.
  appleSearch: (q: string, region: SearchRegion) => Promise<Place[]>;
  // Offline fallback: synchronous prefix query over the local gazetteer + charger DB. `q` is normalized.
  localSearch: (q: string, region: SearchRegion) => Place[];
}

// Empty query → []. Otherwise Apple (its order) online, or ranked local results offline. Capped.
export async function runSearch(
  rawQuery: string,
  region: SearchRegion,
  deps: SearchDeps,
): Promise<Place[]> {
  const q = normalizeQuery(rawQuery);
  if (!q) return [];
  try {
    return (await deps.appleSearch(q, region)).slice(0, RESULT_CAP);
  } catch {
    return rankPlaces(deps.localSearch(q, region), region).slice(0, RESULT_CAP);
  }
}
```

- [ ] **Step 4: Add `appleSearch` to `src/services/appleSearch.ts`** — insert this export (keep `appleComplete`/`appleResolve`; they're now unused by the list but harmless):

```ts
// Online list source: Apple MKLocalSearch (full results WITH coordinates → distance pill). Rejects offline →
// searchProvider catches and falls back to local. This is the real SearchDeps.appleSearch.
export async function appleSearch(q: string, region: SearchRegion): Promise<Place[]> {
  const raw = await AppleSearch.search(q, toRegion(region));
  return raw.map((r, i) => ({
    id: `apple:${i}:${r.title}`,
    title: r.title,
    subtitle: r.subtitle || undefined,
    coordinate: { latitude: r.latitude, longitude: r.longitude },
    kind: 'poi' as const,
    source: 'apple' as const,
  }));
}
```

- [ ] **Step 5: Run the test, verify it passes**

Run: `node --import tsx --test src/services/searchProvider.test.ts`
Expected: PASS (4 tests).

- [ ] **Step 6: Run the FULL suite (no regressions)**

Run: `npm test`
Expected: all PASS (existing + recents + the rewritten searchProvider).

- [ ] **Step 7: Commit**

```bash
git add src/services/searchProvider.ts src/services/searchProvider.test.ts src/services/appleSearch.ts
git commit -m "feat(navigate): online-Apple/offline-local search + appleSearch (MKLocalSearch)"
```

---

### Task 3: `recentsStore.ts` — SQLite-persisted recents

**Files:**
- Create: `src/services/recentsStore.ts`

**Interfaces:**
- Produces: `addRecent(place: Place, savedAt: number): void`; `loadRecents(): RecentEntry[]`.
- Consumes: `Place` from `./place`; `RecentEntry` from `./recents`; `expo-sqlite`.

> Native (expo-sqlite) — not node-testable; verified on-device in Task 7. All calls are synchronous; the DB is created lazily on first use (no asset import, unlike the gazetteer).

- [ ] **Step 1: Create `src/services/recentsStore.ts`**

```ts
// Locally-persisted Navigate recents, backed by a small SQLite table in expo-sqlite's default directory
// (survives app restarts; created on first use — no bundled asset). App-only (imports expo-sqlite); never
// imported by node:test or the build scripts. The pure day-grouping lives in recents.ts.
import * as SQLite from 'expo-sqlite';

import type { Place } from './place';
import type { RecentEntry } from './recents';

const RECENTS_DB = 'recents.db';
const CAP = 50; // keep the newest N

// undefined = not opened; null = unavailable; else the handle.
let db: SQLite.SQLiteDatabase | null | undefined;
function getDb(): SQLite.SQLiteDatabase | null {
  if (db !== undefined) return db;
  try {
    const handle = SQLite.openDatabaseSync(RECENTS_DB);
    handle.execSync(
      'CREATE TABLE IF NOT EXISTS recents (id TEXT PRIMARY KEY, title TEXT, subtitle TEXT, lat REAL, lng REAL, savedAt INTEGER)',
    );
    db = handle;
  } catch {
    db = null;
  }
  return db;
}

// Stable id from the coordinate so re-selecting the same place bumps its recency instead of duplicating
// (Apple result ids embed a volatile list index).
function recentId(place: Place): string {
  const c = place.coordinate!;
  return `${c.latitude.toFixed(5)},${c.longitude.toFixed(5)}`;
}

// Upsert a selected place as a recent (needs a coordinate), then prune to the newest CAP.
export function addRecent(place: Place, savedAt: number): void {
  const handle = getDb();
  if (!handle || !place.coordinate) return;
  handle.runSync(
    'INSERT OR REPLACE INTO recents (id, title, subtitle, lat, lng, savedAt) VALUES (?, ?, ?, ?, ?, ?)',
    recentId(place),
    place.title,
    place.subtitle ?? null,
    place.coordinate.latitude,
    place.coordinate.longitude,
    savedAt,
  );
  handle.runSync(
    'DELETE FROM recents WHERE id NOT IN (SELECT id FROM recents ORDER BY savedAt DESC LIMIT ?)',
    CAP,
  );
}

// Newest-first recents as RecentEntry[] (grouped for display by groupRecentsByDay).
export function loadRecents(): RecentEntry[] {
  const handle = getDb();
  if (!handle) return [];
  const rows = handle.getAllSync<{
    id: string; title: string; subtitle: string | null; lat: number; lng: number; savedAt: number;
  }>('SELECT id, title, subtitle, lat, lng, savedAt FROM recents ORDER BY savedAt DESC');
  return rows.map((r) => ({
    savedAt: r.savedAt,
    place: {
      id: r.id,
      title: r.title,
      subtitle: r.subtitle ?? undefined,
      coordinate: { latitude: r.lat, longitude: r.lng },
      kind: 'recent' as const,
      source: 'recent' as const,
    },
  }));
}
```

- [ ] **Step 2: Typecheck**

Run: `npx tsc --noEmit -p tsconfig.json`
Expected: no errors from `recentsStore.ts`.

- [ ] **Step 3: Commit**

```bash
git add src/services/recentsStore.ts
git commit -m "feat(navigate): SQLite-persisted recents store"
```

---

### Task 4: `useNavigateSearch` hook — new branch + recents + select

**Files:**
- Modify: `src/hooks/useNavigateSearch.ts`

**Interfaces:**
- Consumes: `runSearch`, `SearchDeps` from `@/services/searchProvider`; `searchLocal`, `initPlaceSources` from `@/services/placeSource`; `appleSearch` from `@/services/appleSearch`; `addRecent`, `loadRecents` from `@/services/recentsStore`; `groupRecentsByDay`, `RecentGroup` from `@/services/recents`; `Place`, `SearchRegion`, `normalizeQuery` from `@/services/place`.
- Produces: `useNavigateSearch(region)` → `{ query, setQuery, results, recentGroups, select }`.

- [ ] **Step 1: Replace the entire contents of `src/hooks/useNavigateSearch.ts`**

```ts
// Wires the real (native) search sources into the pure searchProvider and exposes debounced results plus
// persisted recents. Online = Apple (MKLocalSearch); offline = local gazetteer/charger. Logic seam for the
// LocationSheet search UI. `select` records a tapped place as a recent.
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';

import { appleSearch } from '@/services/appleSearch';
import { normalizeQuery, type Place, type SearchRegion } from '@/services/place';
import { initPlaceSources, searchLocal } from '@/services/placeSource';
import { groupRecentsByDay, type RecentGroup } from '@/services/recents';
import { addRecent, loadRecents } from '@/services/recentsStore';
import { runSearch, type SearchDeps } from '@/services/searchProvider';

const DEBOUNCE_MS = 300;

export function useNavigateSearch(region: SearchRegion) {
  const [query, setQuery] = useState('');
  const [results, setResults] = useState<Place[]>([]);
  const [recentGroups, setRecentGroups] = useState<RecentGroup[]>([]);
  const seq = useRef(0); // drop stale async responses

  const deps: SearchDeps = useMemo(() => ({ appleSearch, localSearch: searchLocal }), []);

  const refreshRecents = useCallback(() => {
    setRecentGroups(groupRecentsByDay(loadRecents(), Date.now()));
  }, []);

  // Open the gazetteer + load recents once.
  useEffect(() => {
    void initPlaceSources();
    refreshRecents();
  }, [refreshRecents]);

  // Debounced query → results (empty query clears the list; the UI shows recentGroups instead).
  useEffect(() => {
    const mine = ++seq.current;
    if (!normalizeQuery(query)) {
      setResults([]);
      return;
    }
    const timer = setTimeout(() => {
      void runSearch(query, region, deps).then((r) => {
        if (seq.current === mine) setResults(r);
      });
    }, DEBOUNCE_MS);
    return () => clearTimeout(timer);
  }, [query, region, deps]);

  // Record a tapped place as a recent, then refresh the recents groups.
  const select = useCallback(
    (place: Place) => {
      addRecent(place, Date.now());
      refreshRecents();
    },
    [refreshRecents],
  );

  return { query, setQuery, results, recentGroups, select };
}
```

- [ ] **Step 2: Typecheck**

Run: `npx tsc --noEmit -p tsconfig.json`
Expected: no errors. (`appleResolve` in `appleSearch.ts` is now unused by the hook — that's fine; leave it.)

- [ ] **Step 3: Commit**

```bash
git add src/hooks/useNavigateSearch.ts
git commit -m "feat(navigate): useNavigateSearch — Apple/local branch + persisted recents + select"
```

---

### Task 5: LocationSheet search/focused UI

**Files:**
- Modify: `src/components/LocationSheet.tsx`

**Interfaces:**
- Consumes: `Place` from `@/services/place`; `RecentGroup` from `@/services/recents`; `distanceMeters`, `formatKm`, `type LatLng` from `@/state/mockLocation`; RN `TextInput`.
- Produces: new `Props` fields `query`, `onChangeQuery`, `results`, `recentGroups`, `carCoord`, `onSelectPlace`; the `RecentsView` renders search/focused mode and drives the sheet to the full detent on focus.

- [ ] **Step 1: Add imports** — in `src/components/LocationSheet.tsx`, add `TextInput` to the `react-native` import and add `distanceMeters` + `LatLng` from mockLocation. Change the mockLocation import line:

```ts
import { busyTimesFor, distanceMeters, formatKm, type LatLng } from '@/state/mockLocation';
import type { Place } from '@/services/place';
import type { RecentGroup } from '@/services/recents';
```

(Remove `MOCK_RECENTS` and `RecentDestination` from the mockLocation import — they are no longer used here. Add `TextInput` to the existing `react-native` import list.)

- [ ] **Step 2: Extend `Props`** — add these fields to the `interface Props`:

```ts
  // Navigate search (recents tab): live query + Apple/local results + persisted recents + car pos for distance.
  query: string;
  onChangeQuery: (text: string) => void;
  results: Place[];
  recentGroups: RecentGroup[];
  carCoord: LatLng;
  onSelectPlace: (place: Place) => void;
```

- [ ] **Step 3: Thread the props + focus state through the component** — in the `LocationSheet` function, (a) destructure the new props, (b) add focused state + open/close helpers that drive the sheet, (c) pass them to `RecentsView`.

Replace the destructuring line and the `RecentsView` render. First, the destructure (add the new names):

```tsx
  { tab, onTabChange, chargers, availability, sort, onSortChange, filter, onFilterChange, selectedCharger, onSelectCharger, onCloseDetail, onNavigateCharger, query, onChangeQuery, results, recentGroups, carCoord, onSelectPlace },
```

Then, inside the component body (after `const pan = useRef(...).current;`), add:

```tsx
  const [searchFocused, setSearchFocused] = useState(false);
  const openSearch = () => {
    setSearchFocused(true);
    settle(snaps.full);
  };
  const closeSearch = () => {
    setSearchFocused(false);
    settle(snaps.middle);
  };
```

Then replace the `tab === 'recents' ? (...)` branch's `RecentsView` call with:

```tsx
        <RecentsView
          insetBottom={insetBottom}
          dragHandlers={pan.panHandlers}
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
```

- [ ] **Step 4: Rewrite `RecentsView` + add `SearchField` and `PlaceRow`, remove old `RecentRow`** — replace the whole `RecentsView` function (and the `RecentRow` below it) with:

```tsx
function RecentsView({
  onTabChange,
  insetBottom,
  dragHandlers,
  focused,
  onFocus,
  onExit,
  query,
  onChangeQuery,
  results,
  recentGroups,
  carCoord,
  onSelectPlace,
}: {
  onTabChange: (tab: LocationTab) => void;
  insetBottom: number;
  dragHandlers: GestureResponderHandlers;
  focused: boolean;
  onFocus: () => void;
  onExit: () => void;
  query: string;
  onChangeQuery: (text: string) => void;
  results: Place[];
  recentGroups: RecentGroup[];
  carCoord: LatLng;
  onSelectPlace: (place: Place) => void;
}) {
  const inputRef = useRef<TextInput>(null);
  const typing = focused && query.trim().length > 0;

  const clear = () => {
    if (query.length > 0) {
      onChangeQuery(''); // clear, stay focused
    } else {
      inputRef.current?.blur();
      onExit();
    }
  };
  const select = (place: Place) => {
    onSelectPlace(place);
    inputRef.current?.blur();
    onExit();
  };

  return (
    <View style={styles.tabContent}>
      <SearchField
        inputRef={inputRef}
        focused={focused}
        query={query}
        onChangeQuery={onChangeQuery}
        onFocus={onFocus}
        onClear={clear}
      />

      {/* Tabs only in browse mode; hidden while searching. Draggable so it still resizes the sheet. */}
      {!focused ? (
        <View {...dragHandlers} style={styles.tabs}>
          <Pressable style={styles.tab} onPress={() => onTabChange('recents')}>
            <Text style={[styles.tabLabel, styles.tabActive]}>Recents</Text>
          </Pressable>
          <View style={styles.tabDivider} />
          <Pressable style={styles.tab} onPress={() => onTabChange('charging')}>
            <Text style={[styles.tabLabel, styles.tabInactive]}>Charging</Text>
          </Pressable>
        </View>
      ) : null}

      <ScrollView
        style={styles.scrollList}
        contentContainerStyle={[styles.list, { paddingBottom: insetBottom + 24 }]}
        showsVerticalScrollIndicator={false}
        keyboardShouldPersistTaps="handled"
      >
        {typing
          ? results.map((place) => <PlaceRow key={place.id} place={place} carCoord={carCoord} onPress={() => select(place)} />)
          : recentGroups.map((group) => (
              <View key={group.title}>
                <View style={styles.groupHeader}>
                  <Text style={styles.groupTitle}>{group.title}</Text>
                  <View style={styles.groupLine} />
                </View>
                {group.items.map((place) => (
                  <PlaceRow key={place.id} place={place} carCoord={carCoord} onPress={() => select(place)} />
                ))}
              </View>
            ))}
      </ScrollView>
    </View>
  );
}

// The Navigate field: magnifier + a TextInput with a floating "Navigate" label (shown once there is text),
// and an ✕ (clear text, or exit search when already empty) while focused.
function SearchField({
  inputRef,
  focused,
  query,
  onChangeQuery,
  onFocus,
  onClear,
}: {
  inputRef: React.RefObject<TextInput>;
  focused: boolean;
  query: string;
  onChangeQuery: (text: string) => void;
  onFocus: () => void;
  onClear: () => void;
}) {
  return (
    <View style={styles.searchField}>
      <SymbolView name="magnifyingglass" tintColor="rgba(255,255,255,0.5)" size={18} />
      <View style={styles.searchInputWrap}>
        {query.length > 0 ? <Text style={styles.searchFloatLabel}>Navigate</Text> : null}
        <TextInput
          ref={inputRef}
          style={styles.searchInput}
          value={query}
          onChangeText={onChangeQuery}
          onFocus={onFocus}
          placeholder="Navigate"
          placeholderTextColor="rgba(255,255,255,0.5)"
          returnKeyType="search"
          autoCorrect={false}
          autoCapitalize="none"
          clearButtonMode="never"
        />
      </View>
      {focused ? (
        <Pressable hitSlop={10} onPress={onClear}>
          <SymbolView name="xmark" tintColor="rgba(255,255,255,0.6)" size={18} weight="medium" />
        </Pressable>
      ) : null}
    </View>
  );
}

// One row for both autocomplete results and recents: bold title, gray subtitle (1 line), distance pill.
function PlaceRow({ place, carCoord, onPress }: { place: Place; carCoord: LatLng; onPress: () => void }) {
  const km = place.coordinate ? formatKm(distanceMeters(carCoord, place.coordinate) / 1000) : '';
  return (
    <Pressable style={({ pressed }) => [styles.row, { opacity: pressed ? 0.6 : 1 }]} onPress={onPress}>
      <View style={styles.rowText}>
        <Text style={styles.rowName} numberOfLines={1}>
          {place.title}
        </Text>
        {place.subtitle ? (
          <Text style={styles.rowAddress} numberOfLines={1}>
            {place.subtitle}
          </Text>
        ) : null}
      </View>
      {km ? (
        <View style={styles.distancePill}>
          <SymbolView name="mappin" tintColor="rgba(255,255,255,0.55)" size={18} />
          <Text style={styles.distanceText}>{km}</Text>
        </View>
      ) : null}
    </Pressable>
  );
}
```

- [ ] **Step 5: Add styles** — in the `StyleSheet.create({...})`, replace the `searchPlaceholder` style with the input styles and keep `tabs` (adjust its margin since it's now its own draggable block):

```ts
  searchInputWrap: { flex: 1, justifyContent: 'center' },
  searchFloatLabel: { fontSize: 11, color: 'rgba(255,255,255,0.45)', marginBottom: -2 },
  searchInput: { fontSize: 17, color: 'white', padding: 0 },
```

(Delete the old `searchPlaceholder` rule. Leave `searchField`, `tabs`, `tab`, `tabDivider`, `tabLabel`, `tabActive`, `tabInactive` as-is.)

- [ ] **Step 6: Typecheck**

Run: `npx tsc --noEmit -p tsconfig.json`
Expected: no errors. (If TS flags an unused `RecentDestination`/`MOCK_RECENTS` import elsewhere, remove it.)

- [ ] **Step 7: Commit**

```bash
git add src/components/LocationSheet.tsx
git commit -m "feat(navigate): LocationSheet search UI (TextInput, results, recents, expand-on-focus)"
```

---

### Task 6: Wire `location.tsx`

**Files:**
- Modify: `src/app/location.tsx`

**Interfaces:**
- Consumes: `useNavigateSearch` from `@/hooks/useNavigateSearch`; passes its outputs + `carCoord` into `<LocationSheet>`.

- [ ] **Step 1: Import the hook** — add to `src/app/location.tsx` imports:

```ts
import { useNavigateSearch } from '@/hooks/useNavigateSearch';
```

- [ ] **Step 2: Call the hook** — inside the component body (after `region`/`carCoord` are defined, near the other hooks), add:

```tsx
  const nav = useNavigateSearch(region);
```

- [ ] **Step 3: Pass the props to `<LocationSheet>`** — add these props to the existing `<LocationSheet ... />` element:

```tsx
        query={nav.query}
        onChangeQuery={nav.setQuery}
        results={nav.results}
        recentGroups={nav.recentGroups}
        carCoord={carCoord}
        onSelectPlace={nav.select}
```

- [ ] **Step 4: Typecheck**

Run: `npx tsc --noEmit -p tsconfig.json`
Expected: no errors.

- [ ] **Step 5: Full test suite (no regressions)**

Run: `npm test`
Expected: all PASS.

- [ ] **Step 6: Commit**

```bash
git add src/app/location.tsx
git commit -m "feat(navigate): wire search UI + recents into the Location screen"
```

---

### Task 7: Deploy (JS-only) + on-device verification

**Files:** none (deploy + manual verification).

> No native rebuild: `expo-sqlite`, the `AppleSearch` module's `search`, and `TextInput` are all already in the installed binary. `recents.db` is created on-device on first use.

- [ ] **Step 1: JS deploy**

Run: `bash scripts/godot-ios/deploy-js.sh`
Expected: `✓ done` (bundles + installs + launches; also re-copies `places.db`).

- [ ] **Step 2: On-device interaction check** (requires looking at the phone — the UI can't be driven headlessly). Confirm:
  1. Open Location → sheet at middle, `Navigate` box + Recents/Charging tabs.
  2. Tap the box → sheet animates to **full**, keyboard up, tabs gone, ✕ visible.
  3. Type `kaufland` → rows appear (bold name, gray address, **km pill**), Apple-ordered.
  4. Tap a result → it's added to Recents; sheet returns to middle showing the updated Recents.
  5. Tap the box again with text present → `Navigate` floats above the text; ✕ clears it; ✕ again exits search.
  6. **Kill and reopen the app** → the tapped result is still in Recents (persistence).
  7. Airplane mode → typing still returns results (local gazetteer/charger fallback), no crash.

- [ ] **Step 3: Verify recents persisted via devicectl** (objective check that survives the manual step):

Run:
```bash
SCRATCH=/private/tmp/claude-501/-Users-ivan-Work-airgapp-mobile/07211387-f283-4274-bb5d-2fb65cf1c11e/scratchpad
xcrun devicectl device copy from --device F3867E6E-E95F-5B2A-9C4E-06D1D72475A1 \
  --domain-type appDataContainer --domain-identifier local.airgapp.mobile --user mobile \
  --source Documents/SQLite/recents.db --destination "$SCRATCH/recents.db"
node -e "const {DatabaseSync}=require('node:sqlite');const db=new DatabaseSync('$SCRATCH/recents.db');console.log(db.prepare('SELECT title,subtitle FROM recents ORDER BY savedAt DESC').all())"
```
Expected: the row(s) you tapped, present after the app restart.

- [ ] **Step 4: Commit** (only if any tweak was needed during verification; otherwise nothing to commit — code was committed per task).

---

## Self-Review

**Spec coverage:**
- Two modes (browse / search), tap-to-expand-full, tabs hidden when focused → Task 5 (`searchFocused`, `openSearch` → `settle(snaps.full)`). ✓
- Floating `Navigate` label + ✕ (clear / exit) → Task 5 `SearchField`. ✓
- Empty query shows recents; typing shows results → Task 5 (`typing` branch). ✓
- Result row (name / address / km-from-car) → Task 5 `PlaceRow` + `distanceMeters`/`formatKm`. ✓
- Online = Apple `search` (coords → distance); offline = local fallback → Task 2 (`appleSearch`, `runSearch`). ✓
- Recents persisted in SQLite, dedupe, cap 50, day-grouped → Task 3 (`recentsStore`) + Task 1 (`groupRecentsByDay`). ✓
- `useNavigateSearch(region)` exposes query/setQuery/results/recentGroups/select → Task 4. ✓
- On-tap = add recent, no map action → Task 4 `select` + Task 5 `select` (blur+exit). ✓
- Testing (grouping, online/offline branch pure; UI + persistence on device) → Tasks 1, 2, 7. ✓

**Deviation from spec:** the spec mentioned adding `expandFull()` to `LocationSheetHandle`; the plan instead drives the full detent **internally** in `LocationSheet` (`openSearch → settle(snaps.full)`) because focus originates inside the sheet — a public handle method would be dead code. Behavior is identical.

**Placeholder scan:** none. Distances/labels/schema are concrete. The only "later" item (routing on tap) is explicitly out of scope; `select` returns a real, complete behavior now (record recent).

**Type/name consistency:** `RecentEntry`/`RecentGroup`/`groupRecentsByDay` (Task 1) used identically in `recentsStore` (Task 3), the hook (Task 4). `SearchDeps { appleSearch, localSearch }` + `runSearch` + `RESULT_CAP` (Task 2) match the hook's `deps` (Task 4). `appleSearch(q, region)` (Task 2) matches the hook import. `useNavigateSearch(region)` → `{ query, setQuery, results, recentGroups, select }` (Task 4) matches the props wired in Task 6 and consumed in Task 5. `PlaceRow`/`SearchField`/`RecentsView` props (Task 5) are self-consistent. ✓

---

## Execution Handoff

Plan complete. Tasks 1-2 are pure/testable; Tasks 3-6 are code + typecheck; Task 7 is a **JS-only deploy (~30s, no rebuild)** + an on-device interaction check that needs eyes on the phone.
