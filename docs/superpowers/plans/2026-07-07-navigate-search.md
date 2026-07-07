# Navigate Search Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Build the Navigate search *logic* — type a query, get a ranked list of `Place` results (cities/towns offline via a bundled GeoNames gazetteer + our charger DB + recents, enriched online by Apple `MKLocalSearch`/`MKLocalSearchCompleter`). No visual UI.

**Architecture:** Local-first hybrid. Pure, node-testable logic (`place.ts` merge/rank/dedupe, `searchProvider.ts` orchestration with injected deps, `gazetteer.ts` GeoNames mapper) is separated from the native/expo-sqlite I/O (`placeSource.ts`) and the one Swift Expo module (`AppleSearch`). The gazetteer ships as a bundled SQLite asset opened via `expo-sqlite`'s `importDatabaseFromAssetAsync`. A thin `useNavigateSearch` hook wires the real sources into the pure orchestrator; the search field UI that consumes it is out of scope.

**Tech Stack:** Expo SDK 56, React Native 0.85 (New Arch, Hermes), TypeScript, `expo-sqlite@56.0.5`, Node's `node:sqlite` (build script), Node built-in test runner (`node --import tsx --test`), Swift + MapKit (Expo Modules API), GeoNames `cities1000` (CC BY 4.0).

## Global Constraints

- **NEVER `expo prebuild`** — it clobbers the custom Godot `ios/`. Add native code via local `modules/` + `pod install` + full `xcodebuild` (autolinking picks up `modules/*`, as it does for `expo-godot-view`).
- **Add NO new JS dependencies.** The gazetteer path uses `expo-sqlite`'s `importDatabaseFromAssetAsync` (already installed) + a bundled asset; `expo-asset` (56.0.15) and `expo-file-system` (56.0.7) are already linked. Do **not** run `expo install` for anything — it risks the ExpoModulesCore-56.0.14 version-skew dyld crash.
- **`db` is already in Metro's `assetExts`** — `require('../../assets/places.db')` resolves with no `metro.config.js`.
- **Signing:** automatic, `DEVELOPMENT_TEAM=859B8N529C`. Never override the team. iOS min 16.4.
- **Device:** CoreDevice `F3867E6E-E95F-5B2A-9C4E-06D1D72475A1`, bundle `local.airgapp.mobile`.
- **`pod install` requires `LANG=en_US.UTF-8`.**
- **Tests:** pure logic only, run via `node --import tsx --test`; register each new `*.test.ts` in the `package.json` `test` script. Modules under test must not import React Native / expo native modules.
- **Security:** Tesla must never reach Tesla's real servers; third-party geocoders (Apple/GeoNames) are fine. `.env.local` stays gitignored.
- **Attribution:** the gazetteer is GeoNames CC BY 4.0 → the credit string `© GeoNames (CC BY 4.0)` must be shipped (surfaced wherever OSM/map credits already live; the string is added in Task 1's build output header comment and must appear in an About/credits surface when the UI lands — tracked as an out-of-scope UI note, not a code placeholder here).

## File Structure

```
Build-time / pure (node:test):
  scripts/geonames/build-places-db.ts   CREATE  download cities1000 → SQLite → assets/places.db (node:sqlite)
  src/services/gazetteer.ts             CREATE  PURE: PlaceRecord type + mapGeoNamesRow(line) + parsePopulation
  src/services/gazetteer.test.ts        CREATE  tests for the mapper
  src/services/place.ts                 CREATE  PURE: Place, SearchRegion, foldAccents, normalizeQuery,
                                                dedupePlaces, rankPlaces, mergeResults
  src/services/place.test.ts            CREATE  tests for merge/rank/dedupe/fold
  src/services/searchProvider.ts        CREATE  PURE: SearchDeps + runSearch(query, region, deps) (DI)
  src/services/searchProvider.test.ts   CREATE  tests: recents / merge / offline-degrade / ranking
  assets/places.db                      BUILD   ~16 MB, gitignored (build output)
  .gitignore                            MODIFY  ignore assets/places.db
  package.json                          MODIFY  add build:places script; register 3 test files

Native / device (manual verify — not node-testable):
  src/services/chargerSource.ts         MODIFY  add chargersMatchingName(query, limit)
  src/services/placeSource.ts           CREATE  expo-sqlite: initPlaceSources(), searchLocal(), recents()
  modules/expo-apple-search/            CREATE  local Swift Expo module (MapKit)
    expo-module.config.json
    index.ts
    src/AppleSearch.types.ts
    src/AppleSearchModule.ts
    ios/AppleSearch.podspec
    ios/AppleSearchModule.swift
  src/services/appleSearch.ts           CREATE  JS wrapper: appleComplete(), appleResolve() → Place
  src/hooks/useNavigateSearch.ts        CREATE  thin wiring hook (debounce + progressive emit); NO UI

Deploy:
  scripts/godot-ios/deploy-js.sh        MODIFY  sync Metro assets into the .app (future gazetteer JS-refresh)
```

**Type/name contract shared across tasks** (define once, reuse verbatim):
- `PlaceRecord = { id: string; name: string; asciiname: string; lat: number; lng: number; country: string; admin1: string; population: number }` (Task 1)
- `SearchRegion = { latitude: number; longitude: number; latitudeDelta: number; longitudeDelta: number }` (Task 2) — structurally identical to `ViewportRegion` in `location.tsx`.
- `Place = { id: string; title: string; subtitle?: string; coordinate: { latitude: number; longitude: number } | null; kind: 'city' | 'charger' | 'poi' | 'address' | 'recent'; source: 'gazetteer' | 'charger' | 'recent' | 'apple'; population?: number }` (Task 2). `coordinate` is `null` for unresolved Apple completions.
- `SearchDeps = { localSearch: (q, region) => Place[]; appleComplete: (q, region) => Promise<Place[]>; recents: () => Place[] }` (Task 3)

---

### Task 1: Gazetteer — pure GeoNames mapper + build script + bundled DB

**Files:**
- Create: `src/services/gazetteer.ts`
- Test: `src/services/gazetteer.test.ts`
- Create: `scripts/geonames/build-places-db.ts`
- Modify: `.gitignore`, `package.json`
- Build output: `assets/places.db`

**Interfaces:**
- Produces: `PlaceRecord` type; `mapGeoNamesRow(line: string): PlaceRecord | null`; `parsePopulation(raw: string): number`. The build script consumes `mapGeoNamesRow`.

- [ ] **Step 1: Write the failing test** — `src/services/gazetteer.test.ts`

```ts
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mapGeoNamesRow, parsePopulation } from './gazetteer';

// A real cities1000.txt line has 19 tab-separated columns:
// geonameid,name,asciiname,alternatenames,lat,lng,featureClass,featureCode,country,cc2,
// admin1,admin2,admin3,admin4,population,elevation,dem,timezone,modDate
const SOFIA = [
  '727011', 'Sofia', 'Sofia', 'Sofiya,София', '42.69751', '23.32415',
  'P', 'PPLC', 'BG', '', '42', '', '', '', '1152556', '', '531', 'Europe/Sofia', '2019-09-05',
].join('\t');

test('mapGeoNamesRow maps a well-formed line', () => {
  const r = mapGeoNamesRow(SOFIA);
  assert.ok(r);
  assert.equal(r.id, '727011');
  assert.equal(r.name, 'Sofia');
  assert.equal(r.asciiname, 'Sofia');
  assert.equal(r.country, 'BG');
  assert.equal(r.admin1, '42');
  assert.equal(r.population, 1152556);
  assert.ok(Math.abs(r.lat - 42.69751) < 1e-6);
  assert.ok(Math.abs(r.lng - 23.32415) < 1e-6);
});

test('mapGeoNamesRow returns null for a coordinate-less / short line', () => {
  assert.equal(mapGeoNamesRow('123\tX'), null);
  const noCoord = ['1', 'X', 'X', '', 'NaN', '', 'P', 'PPL', 'BG', '', '', '', '', '', '0', '', '', '', ''].join('\t');
  assert.equal(mapGeoNamesRow(noCoord), null);
});

test('parsePopulation handles blanks and non-numbers', () => {
  assert.equal(parsePopulation('1152556'), 1152556);
  assert.equal(parsePopulation(''), 0);
  assert.equal(parsePopulation('abc'), 0);
});
```

- [ ] **Step 2: Run it, verify it fails**

Run: `node --import tsx --test src/services/gazetteer.test.ts`
Expected: FAIL — `Cannot find module './gazetteer'`.

- [ ] **Step 3: Write `src/services/gazetteer.ts`**

```ts
// Pure GeoNames `cities1000` row → gazetteer record mapper. Shared by the build script
// (scripts/geonames/build-places-db.ts) and its tests. NO React Native / expo imports so it stays
// node-testable. Data: GeoNames cities1000, CC BY 4.0 — "© GeoNames (CC BY 4.0)".

// One stored gazetteer row. `asciiname` is GeoNames' ASCII-folded name (indexed for prefix search);
// `admin1`/`country` are GeoNames codes (readable-name enrichment is a later UI concern).
export interface PlaceRecord {
  id: string;
  name: string;
  asciiname: string;
  lat: number;
  lng: number;
  country: string;
  admin1: string;
  population: number;
}

// GeoNames column indices (tab-separated, 0-based).
const COL = { id: 0, name: 1, asciiname: 2, lat: 4, lng: 5, country: 8, admin1: 10, population: 14 };

export function parsePopulation(raw: string): number {
  const n = parseInt(raw, 10);
  return Number.isFinite(n) && n > 0 ? n : 0;
}

// Map one tab-separated cities1000 line → a PlaceRecord, or null if it lacks a usable coordinate.
export function mapGeoNamesRow(line: string): PlaceRecord | null {
  const c = line.split('\t');
  if (c.length < 15) return null;
  const lat = parseFloat(c[COL.lat]);
  const lng = parseFloat(c[COL.lng]);
  if (!Number.isFinite(lat) || !Number.isFinite(lng)) return null;
  const name = c[COL.name];
  if (!name) return null;
  return {
    id: c[COL.id],
    name,
    asciiname: c[COL.asciiname] || name,
    lat,
    lng,
    country: c[COL.country] ?? '',
    admin1: c[COL.admin1] ?? '',
    population: parsePopulation(c[COL.population] ?? ''),
  };
}
```

- [ ] **Step 4: Run the test, verify it passes**

Run: `node --import tsx --test src/services/gazetteer.test.ts`
Expected: PASS (3 tests).

- [ ] **Step 5: Write the build script** — `scripts/geonames/build-places-db.ts`

```ts
/**
 * Build the bundled gazetteer SQLite database from GeoNames cities1000 (CC BY 4.0).
 *
 *   npx tsx scripts/geonames/build-places-db.ts            # download + build → assets/places.db
 *   npx tsx scripts/geonames/build-places-db.ts <out.db>   # custom output path
 *
 * Downloads cities1000.zip (~11 MB), unzips (system `unzip`), maps each line via mapGeoNamesRow, and
 * writes a `places` table (indexed on asciiname + name) to assets/places.db (~16 MB, gitignored). That
 * asset is bundled into the .app by the Xcode build and opened at runtime via expo-sqlite's
 * importDatabaseFromAssetAsync (src/services/placeSource.ts). Uses Node's built-in node:sqlite (≥ 22.5).
 * Data credit: "© GeoNames (CC BY 4.0)".
 */
import { DatabaseSync } from 'node:sqlite';
import { execFileSync } from 'node:child_process';
import { readFileSync, writeFileSync, mkdirSync, existsSync, rmSync, statSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import { mapGeoNamesRow, type PlaceRecord } from '../../src/services/gazetteer';

const HERE = dirname(fileURLToPath(import.meta.url));
const WORK = join(HERE, 'out');
const OUT_DB = process.argv[2] ?? join(HERE, '../../assets/places.db');
const URL = 'https://download.geonames.org/export/dump/cities1000.zip';

async function download(dest: string): Promise<void> {
  process.stdout.write(`Downloading ${URL}…\n`);
  const res = await fetch(URL, { headers: { 'User-Agent': 'airgapp-places-db/1.0' } });
  if (!res.ok) throw new Error(`HTTP ${res.status}`);
  writeFileSync(dest, Buffer.from(await res.arrayBuffer()));
}

function loadRecords(txtPath: string): PlaceRecord[] {
  const lines = readFileSync(txtPath, 'utf8').split('\n');
  const out: PlaceRecord[] = [];
  for (const line of lines) {
    if (!line) continue;
    const r = mapGeoNamesRow(line);
    if (r) out.push(r);
  }
  return out;
}

function buildDb(records: PlaceRecord[]): number {
  mkdirSync(dirname(OUT_DB), { recursive: true });
  if (existsSync(OUT_DB)) rmSync(OUT_DB);
  const db = new DatabaseSync(OUT_DB);
  db.exec(`
    PRAGMA journal_mode = OFF;
    PRAGMA synchronous = OFF;
    CREATE TABLE places (
      id TEXT PRIMARY KEY, name TEXT, asciiname TEXT, lat REAL, lng REAL,
      country TEXT, admin1 TEXT, population INTEGER
    );
  `);
  const insert = db.prepare(
    `INSERT OR IGNORE INTO places (id, name, asciiname, lat, lng, country, admin1, population)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
  );
  db.exec('BEGIN');
  let n = 0;
  for (const r of records) {
    insert.run(r.id, r.name, r.asciiname, r.lat, r.lng, r.country, r.admin1, r.population);
    n += 1;
  }
  db.exec('COMMIT');
  db.exec('CREATE INDEX idx_places_asciiname ON places(asciiname)');
  db.exec('CREATE INDEX idx_places_name ON places(name)');
  db.exec('VACUUM');
  db.close();
  return n;
}

async function main() {
  mkdirSync(WORK, { recursive: true });
  const zip = join(WORK, 'cities1000.zip');
  await download(zip);
  execFileSync('unzip', ['-o', '-q', zip, '-d', WORK]); // → WORK/cities1000.txt
  const records = loadRecords(join(WORK, 'cities1000.txt'));
  process.stdout.write(`Loaded ${records.length} places\n`);
  const n = buildDb(records);
  const { size } = statSync(OUT_DB);
  process.stdout.write(`Wrote ${n} rows → ${OUT_DB} (${(size / 1e6).toFixed(1)} MB)\n`);
}

main().catch((err) => {
  process.stderr.write(String(err) + '\n');
  process.exit(1);
});
```

- [ ] **Step 6: Ignore the build artifact** — add to `.gitignore`

```
# Bundled gazetteer DB — build artifact from scripts/geonames/build-places-db.ts (GeoNames cities1000)
assets/places.db
```

- [ ] **Step 7: Wire up npm scripts** — in `package.json`, add a `build:places` script and register the gazetteer test. Replace the `test` line and add `build:places`:

```json
    "build:places": "tsx scripts/geonames/build-places-db.ts",
    "test": "node --import tsx --test src/state/fleet.test.ts src/state/controlActions.test.ts src/state/preferences.test.ts src/state/persistence.test.ts src/services/gazetteer.test.ts"
```

- [ ] **Step 8: Build the gazetteer DB**

Run: `npm run build:places`
Expected: `Loaded ~170000 places` then `Wrote ~170000 rows → …/assets/places.db (~16.x MB)`. Confirm: `ls -lh assets/places.db` shows ~16 MB.

- [ ] **Step 9: Commit** (the DB is gitignored, so it is NOT committed)

```bash
git add src/services/gazetteer.ts src/services/gazetteer.test.ts scripts/geonames/build-places-db.ts .gitignore package.json
git commit -m "feat(navigate): GeoNames gazetteer mapper + build script (cities1000 → assets/places.db)"
```

---

### Task 2: `Place` type + pure merge / rank / dedupe

**Files:**
- Create: `src/services/place.ts`
- Test: `src/services/place.test.ts`
- Modify: `package.json` (register test)

**Interfaces:**
- Produces: `Place`, `SearchRegion` types; `foldAccents(s)`, `normalizeQuery(q)`, `dedupePlaces(list)`, `rankPlaces(list, region)`, `mergeResults(local, apple, opts)`.
- Consumes: nothing (pure, no imports).

- [ ] **Step 1: Write the failing test** — `src/services/place.test.ts`

```ts
import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  foldAccents, normalizeQuery, dedupePlaces, rankPlaces, mergeResults,
  type Place, type SearchRegion,
} from './place';

const REGION: SearchRegion = { latitude: 42.7, longitude: 23.3, latitudeDelta: 0.5, longitudeDelta: 0.5 };
const p = (over: Partial<Place>): Place => ({
  id: 'x', title: 'X', coordinate: { latitude: 42.7, longitude: 23.3 }, kind: 'city', source: 'gazetteer', ...over,
});

test('foldAccents strips diacritics and lowercases', () => {
  assert.equal(foldAccents('Kranevó'), 'kranevo');
  assert.equal(foldAccents('SOFIA'), 'sofia');
});

test('normalizeQuery trims + folds', () => {
  assert.equal(normalizeQuery('  Sófia '), 'sofia');
});

test('dedupePlaces collapses same title, prefers the one with a coordinate', () => {
  const withCoord = p({ id: 'g', title: 'Sofia', source: 'gazetteer' });
  const noCoord = p({ id: 'a', title: 'Sofia', source: 'apple', coordinate: null });
  const out = dedupePlaces([noCoord, withCoord]);
  assert.equal(out.length, 1);
  assert.equal(out[0].id, 'g'); // coordinate-bearing kept
});

test('rankPlaces orders recent < gazetteer/charger < apple, then in-region, then population', () => {
  const apple = p({ id: 'a', source: 'apple', coordinate: null });
  const recent = p({ id: 'r', source: 'recent', kind: 'recent' });
  const farCity = p({ id: 'far', source: 'gazetteer', coordinate: { latitude: 10, longitude: 10 }, population: 9_000_000 });
  const nearCity = p({ id: 'near', source: 'gazetteer', population: 1000 });
  const ranked = rankPlaces([apple, farCity, recent, nearCity], REGION).map((x) => x.id);
  assert.deepEqual(ranked, ['r', 'near', 'far', 'a']);
});

test('mergeResults dedupes, ranks, and caps', () => {
  const local = [p({ id: 'l1', title: 'Aa' }), p({ id: 'l2', title: 'Bb' })];
  const apple = [p({ id: 'a1', title: 'Aa', source: 'apple', coordinate: null })]; // dup of l1 by title
  const out = mergeResults(local, apple, { region: REGION, cap: 12 });
  assert.equal(out.length, 2); // dup collapsed
  assert.ok(!out.some((x) => x.id === 'a1'));
});
```

- [ ] **Step 2: Run it, verify it fails**

Run: `node --import tsx --test src/services/place.test.ts`
Expected: FAIL — `Cannot find module './place'`.

- [ ] **Step 3: Write `src/services/place.ts`**

```ts
// Pure search-result model + merge/rank/dedupe. NO React Native / expo imports (node-testable).
// The single result shape shown in the Navigate list and handed to the map on tap.

export interface SearchRegion {
  latitude: number;
  longitude: number;
  latitudeDelta: number;
  longitudeDelta: number;
}

export interface Place {
  id: string;
  title: string;            // "Sofia", "Kaufland Mladost", "ul. Filip Avramov 1"
  subtitle?: string;        // "BG", "Sofia, Bulgaria", category/context
  coordinate: { latitude: number; longitude: number } | null; // null for unresolved Apple completions
  kind: 'city' | 'charger' | 'poi' | 'address' | 'recent';
  source: 'gazetteer' | 'charger' | 'recent' | 'apple';
  population?: number;      // ranking hint (local results only)
}

// Diacritic-insensitive lowercase key for matching/dedupe. GeoNames asciiname is already ASCII, so a
// folded query prefix-matches it directly.
export function foldAccents(s: string): string {
  // ̀-ͯ = Unicode combining diacritical marks (stripped after NFD decomposition).
  return s.normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase();
}

export function normalizeQuery(q: string): string {
  return foldAccents(q).trim();
}

// Source tiers: recents first, local place data next, Apple online results last.
const TIER: Record<Place['source'], number> = { recent: 0, gazetteer: 1, charger: 1, apple: 2 };

function inRegion(p: Place, r: SearchRegion): boolean {
  if (!p.coordinate) return false;
  return (
    Math.abs(p.coordinate.latitude - r.latitude) <= r.latitudeDelta &&
    Math.abs(p.coordinate.longitude - r.longitude) <= r.longitudeDelta
  );
}

// Collapse the same place appearing from two sources (e.g. a city from gazetteer AND Apple) by folded
// title; keep the coordinate-bearing / lower-tier (more authoritative) entry. Title-only dedupe is a
// deliberate simplification — Apple completions carry no coordinate to disambiguate by.
export function dedupePlaces(list: Place[]): Place[] {
  const seen = new Map<string, Place>();
  for (const cur of list) {
    const key = foldAccents(cur.title);
    const prev = seen.get(key);
    if (!prev) {
      seen.set(key, cur);
      continue;
    }
    const better = (!prev.coordinate && !!cur.coordinate) || TIER[cur.source] < TIER[prev.source];
    if (better) seen.set(key, cur);
  }
  return [...seen.values()];
}

// Stable order: tier, then in-viewport before out, then population desc.
export function rankPlaces(list: Place[], region: SearchRegion): Place[] {
  return [...list].sort((a, b) => {
    if (TIER[a.source] !== TIER[b.source]) return TIER[a.source] - TIER[b.source];
    const ra = inRegion(a, region) ? 0 : 1;
    const rb = inRegion(b, region) ? 0 : 1;
    if (ra !== rb) return ra - rb;
    return (b.population ?? 0) - (a.population ?? 0);
  });
}

export function mergeResults(
  local: Place[],
  apple: Place[],
  opts: { region: SearchRegion; cap?: number },
): Place[] {
  const merged = dedupePlaces([...local, ...apple]);
  return rankPlaces(merged, opts.region).slice(0, opts.cap ?? 12);
}
```

- [ ] **Step 4: Run the test, verify it passes**

Run: `node --import tsx --test src/services/place.test.ts`
Expected: PASS (5 tests).

- [ ] **Step 5: Register the test** — in `package.json`, append `src/services/place.test.ts` to the `test` script:

```json
    "test": "node --import tsx --test src/state/fleet.test.ts src/state/controlActions.test.ts src/state/preferences.test.ts src/state/persistence.test.ts src/services/gazetteer.test.ts src/services/place.test.ts"
```

- [ ] **Step 6: Commit**

```bash
git add src/services/place.ts src/services/place.test.ts package.json
git commit -m "feat(navigate): Place model + pure merge/rank/dedupe"
```

---

### Task 3: `searchProvider.ts` — pure orchestration (dependency-injected)

**Files:**
- Create: `src/services/searchProvider.ts`
- Test: `src/services/searchProvider.test.ts`
- Modify: `package.json` (register test)

**Interfaces:**
- Consumes: `Place`, `SearchRegion`, `mergeResults`, `normalizeQuery` from `./place`.
- Produces: `SearchDeps` interface; `runSearch(rawQuery: string, region: SearchRegion, deps: SearchDeps): Promise<Place[]>`.

- [ ] **Step 1: Write the failing test** — `src/services/searchProvider.test.ts`

```ts
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { runSearch, type SearchDeps } from './searchProvider';
import type { Place, SearchRegion } from './place';

const REGION: SearchRegion = { latitude: 42.7, longitude: 23.3, latitudeDelta: 0.5, longitudeDelta: 0.5 };
const place = (over: Partial<Place>): Place => ({
  id: 'x', title: 'X', coordinate: { latitude: 42.7, longitude: 23.3 }, kind: 'city', source: 'gazetteer', ...over,
});

const baseDeps = (over: Partial<SearchDeps> = {}): SearchDeps => ({
  localSearch: () => [],
  appleComplete: async () => [],
  recents: () => [place({ id: 'recent', source: 'recent', kind: 'recent' })],
  ...over,
});

test('empty query returns recents', async () => {
  const out = await runSearch('   ', REGION, baseDeps());
  assert.deepEqual(out.map((p) => p.id), ['recent']);
});

test('merges local + apple results', async () => {
  const deps = baseDeps({
    localSearch: () => [place({ id: 'l', title: 'Sofia' })],
    appleComplete: async () => [place({ id: 'a', title: 'Kaufland', source: 'apple', coordinate: null, kind: 'poi' })],
  });
  const out = await runSearch('so', REGION, deps);
  assert.deepEqual(out.map((p) => p.id).sort(), ['a', 'l']);
});

test('offline: appleComplete rejection degrades to local-only', async () => {
  const deps = baseDeps({
    localSearch: () => [place({ id: 'l', title: 'Sofia' })],
    appleComplete: async () => { throw new Error('offline'); },
  });
  const out = await runSearch('so', REGION, deps);
  assert.deepEqual(out.map((p) => p.id), ['l']);
});

test('localSearch receives the NORMALIZED query', async () => {
  let seen = '';
  const deps = baseDeps({ localSearch: (q) => { seen = q; return []; } });
  await runSearch('  Sófia ', REGION, deps);
  assert.equal(seen, 'sofia');
});
```

- [ ] **Step 2: Run it, verify it fails**

Run: `node --import tsx --test src/services/searchProvider.test.ts`
Expected: FAIL — `Cannot find module './searchProvider'`.

- [ ] **Step 3: Write `src/services/searchProvider.ts`**

```ts
// Pure search orchestration. Runs the offline local source, attempts the online Apple source, and
// merges. Dependencies are injected (SearchDeps) so this stays node-testable — the real sources
// (placeSource, appleSearch) are wired in by useNavigateSearch. NO native imports here.
import { mergeResults, normalizeQuery, type Place, type SearchRegion } from './place';

export interface SearchDeps {
  // Offline: synchronous prefix query over the local SQLite gazetteer + charger DB. `q` is normalized.
  localSearch: (q: string, region: SearchRegion) => Place[];
  // Online: Apple typeahead. Rejects when offline / on MKError → caller degrades to local-only.
  appleComplete: (q: string, region: SearchRegion) => Promise<Place[]>;
  // Recent destinations (mock for now).
  recents: () => Place[];
}

// Empty query → recents. Otherwise local (instant) + Apple (best-effort) merged, ranked, capped.
export async function runSearch(
  rawQuery: string,
  region: SearchRegion,
  deps: SearchDeps,
): Promise<Place[]> {
  const q = normalizeQuery(rawQuery);
  if (!q) return deps.recents();

  const local = deps.localSearch(q, region);
  let apple: Place[] = [];
  try {
    apple = await deps.appleComplete(q, region);
  } catch {
    apple = []; // offline / Apple error → local-only, never throw
  }
  return mergeResults(local, apple, { region });
}
```

- [ ] **Step 4: Run the test, verify it passes**

Run: `node --import tsx --test src/services/searchProvider.test.ts`
Expected: PASS (4 tests).

- [ ] **Step 5: Register the test** — in `package.json`, append `src/services/searchProvider.test.ts`:

```json
    "test": "node --import tsx --test src/state/fleet.test.ts src/state/controlActions.test.ts src/state/preferences.test.ts src/state/persistence.test.ts src/services/gazetteer.test.ts src/services/place.test.ts src/services/searchProvider.test.ts"
```

- [ ] **Step 6: Run the FULL suite (no regressions)**

Run: `npm test`
Expected: all suites PASS (existing state tests + gazetteer + place + searchProvider).

- [ ] **Step 7: Commit**

```bash
git add src/services/searchProvider.ts src/services/searchProvider.test.ts package.json
git commit -m "feat(navigate): searchProvider orchestration (DI, offline-degrade)"
```

---

### Task 4: `placeSource.ts` — real offline local search over SQLite

**Files:**
- Modify: `src/services/chargerSource.ts` (add `chargersMatchingName`)
- Create: `src/services/placeSource.ts`

**Interfaces:**
- Consumes: `Place`, `SearchRegion` from `./place`; `chargersMatchingName` from `./chargerSource`; `expo-sqlite`; `require('../../assets/places.db')`.
- Produces: `initPlaceSources(): Promise<void>`; `searchLocal(q: string, region: SearchRegion): Place[]`; `recents(): Place[]`. `searchLocal` is the real `SearchDeps.localSearch`; `recents` the real `SearchDeps.recents`.

> Not node-testable (imports `expo-sqlite`, a native module) — verified on-device in Task 7. Keep it thin; all rankable logic lives in the pure Task 2/3 modules.

- [ ] **Step 1: Add `chargersMatchingName` to `src/services/chargerSource.ts`**

Append this exported function (it reuses the module-local `getDb()`):

```ts
// Name-substring match over the charger DB, for the Navigate search (secondary to the gazetteer).
export function chargersMatchingName(
  query: string,
  limit: number,
): { id: string; name: string; lat: number; lng: number; place: string; region: string }[] {
  const handle = getDb();
  if (!handle) return [];
  return handle.getAllSync<{ id: string; name: string; lat: number; lng: number; place: string; region: string }>(
    `SELECT id, name, lat, lng, place, region
       FROM chargers
      WHERE name LIKE ?
      ORDER BY maxPowerKW DESC
      LIMIT ?`,
    `%${query}%`,
    limit,
  );
}
```

- [ ] **Step 2: Create `src/services/placeSource.ts`**

```ts
// Offline local search sources for Navigate: the bundled GeoNames gazetteer (places.db) + the charger
// DB (chargers.db) + recents. expo-sqlite is native, so this module is app-only (never imported by the
// Node build scripts or node:test). The pure ranking/merge lives in place.ts / searchProvider.ts.
import * as SQLite from 'expo-sqlite';

import { chargersMatchingName } from './chargerSource';
import type { Place, SearchRegion } from './place';

const PLACES_DB = 'places.db';
const GAZETTEER_LIMIT = 40; // rows pulled before the merge trims to the visible cap
const CHARGER_LIMIT = 8;

interface PlaceRow {
  id: string;
  name: string;
  lat: number;
  lng: number;
  country: string;
  admin1: string;
  population: number;
}

// undefined = not initialized; null = no usable DB; else the open handle.
let placesDb: SQLite.SQLiteDatabase | null | undefined;

// Copy the bundled gazetteer asset into the SQLite directory (idempotent — skipped if already present)
// and open it. Call once on mount before searchLocal. importDatabaseFromAssetAsync is a no-op copy when
// the file already exists (no forceOverwrite).
export async function initPlaceSources(): Promise<void> {
  if (placesDb !== undefined) return;
  try {
    await SQLite.importDatabaseFromAssetAsync(PLACES_DB, { assetId: require('../../assets/places.db') });
    placesDb = SQLite.openDatabaseSync(PLACES_DB);
  } catch {
    placesDb = null; // asset missing / import failed → gazetteer results simply empty
  }
}

function gazetteerMatching(q: string, region: SearchRegion): Place[] {
  if (!placesDb) return [];
  const rows = placesDb.getAllSync<PlaceRow>(
    `SELECT id, name, lat, lng, country, admin1, population
       FROM places
      WHERE asciiname LIKE ? OR name LIKE ?
      ORDER BY population DESC
      LIMIT ?`,
    `${q}%`,
    `${q}%`,
    GAZETTEER_LIMIT,
  );
  return rows.map((r) => ({
    id: `geo:${r.id}`,
    title: r.name,
    subtitle: r.country || undefined, // ISO2 code; readable-name enrichment is a later UI concern
    coordinate: { latitude: r.lat, longitude: r.lng },
    kind: 'city' as const,
    source: 'gazetteer' as const,
    population: r.population,
  }));
}

function chargerMatching(q: string): Place[] {
  return chargersMatchingName(q, CHARGER_LIMIT).map((c) => ({
    id: `chg:${c.id}`,
    title: c.name,
    subtitle: c.region || c.place || undefined,
    coordinate: { latitude: c.lat, longitude: c.lng },
    kind: 'charger' as const,
    source: 'charger' as const,
  }));
}

// The real SearchDeps.localSearch: gazetteer + charger matches (synchronous; DB opened by init).
export function searchLocal(q: string, region: SearchRegion): Place[] {
  return [...gazetteerMatching(q, region), ...chargerMatching(q)];
}

// The real SearchDeps.recents (mock until a trip/destination concept exists).
export function recents(): Place[] {
  return [];
}
```

- [ ] **Step 3: Typecheck**

Run: `npx tsc --noEmit -p tsconfig.json`
Expected: no errors from `placeSource.ts` / `chargerSource.ts`. (`require('../../assets/places.db')` resolves via the `@/assets` / asset typing; if TS complains about the `.db` require, it is still valid at runtime through Metro — but expo's TS setup already allows asset requires. If a type error surfaces, it will be on the require line only; do not silence unrelated errors.)

- [ ] **Step 4: Commit**

```bash
git add src/services/placeSource.ts src/services/chargerSource.ts
git commit -m "feat(navigate): offline local search (gazetteer + charger DB) via placeSource"
```

---

### Task 5: `AppleSearch` native module + JS wrapper

**Files:**
- Create: `modules/expo-apple-search/expo-module.config.json`
- Create: `modules/expo-apple-search/index.ts`
- Create: `modules/expo-apple-search/src/AppleSearch.types.ts`
- Create: `modules/expo-apple-search/src/AppleSearchModule.ts`
- Create: `modules/expo-apple-search/ios/AppleSearch.podspec`
- Create: `modules/expo-apple-search/ios/AppleSearchModule.swift`
- Create: `src/services/appleSearch.ts`

**Interfaces:**
- Produces (native → JS): `AppleSearch.complete(query, region): Promise<AppleCompletion[]>`, `AppleSearch.search(query, region): Promise<AppleResult[]>` where `AppleRegion = { latitude, longitude, latitudeDelta, longitudeDelta }`, `AppleCompletion = { title: string; subtitle: string }`, `AppleResult = { title: string; subtitle: string; latitude: number; longitude: number }`.
- Produces (wrapper): `appleComplete(q, region): Promise<Place[]>` (the real `SearchDeps.appleComplete`), `appleResolve(place, region): Promise<Place>`.

> The module is iOS-only (MapKit). Not node-testable; verified on-device in Task 7.

- [ ] **Step 1: `modules/expo-apple-search/expo-module.config.json`**

```json
{
  "platforms": ["apple"],
  "apple": {
    "modules": ["AppleSearchModule"]
  }
}
```

- [ ] **Step 2: `modules/expo-apple-search/src/AppleSearch.types.ts`**

```ts
export interface AppleRegion {
  latitude: number;
  longitude: number;
  latitudeDelta: number;
  longitudeDelta: number;
}

export interface AppleCompletion {
  title: string;
  subtitle: string;
}

export interface AppleResult {
  title: string;
  subtitle: string;
  latitude: number;
  longitude: number;
}
```

- [ ] **Step 3: `modules/expo-apple-search/src/AppleSearchModule.ts`**

```ts
import { requireNativeModule } from 'expo';

import type { AppleCompletion, AppleRegion, AppleResult } from './AppleSearch.types';

declare class AppleSearchModule {
  // MKLocalSearchCompleter typeahead — suggestions only (no coordinates).
  complete(query: string, region: AppleRegion): Promise<AppleCompletion[]>;
  // MKLocalSearch — full results WITH coordinates.
  search(query: string, region: AppleRegion): Promise<AppleResult[]>;
}

export default requireNativeModule<AppleSearchModule>('AppleSearch');
```

- [ ] **Step 4: `modules/expo-apple-search/index.ts`**

```ts
export { default } from './src/AppleSearchModule';
export * from './src/AppleSearch.types';
```

- [ ] **Step 5: `modules/expo-apple-search/ios/AppleSearch.podspec`**

```ruby
Pod::Spec.new do |s|
  s.name           = 'AppleSearch'
  s.version        = '1.0.0'
  s.summary        = 'MKLocalSearch / MKLocalSearchCompleter bridge for Navigate search.'
  s.description    = 'Wraps Apple MapKit search (POI/business + typeahead) via the Expo Modules API.'
  s.author         = ''
  s.homepage       = 'https://docs.expo.dev/modules/'
  s.platforms      = { :ios => '16.4' }
  s.source         = { git: '' }
  s.static_framework = true

  s.dependency 'ExpoModulesCore'
  s.frameworks = ['MapKit', 'CoreLocation']

  s.source_files = 'AppleSearchModule.swift'

  s.pod_target_xcconfig = {
    'DEFINES_MODULE' => 'YES',
    'SWIFT_COMPILATION_MODE' => 'wholemodule',
  }
end
```

- [ ] **Step 6: `modules/expo-apple-search/ios/AppleSearchModule.swift`**

```swift
import ExpoModulesCore
import MapKit

// Builds an MKCoordinateRegion from the JS { latitude, longitude, latitudeDelta, longitudeDelta }.
private func makeRegion(_ r: [String: Double]) -> MKCoordinateRegion {
  let center = CLLocationCoordinate2D(latitude: r["latitude"] ?? 0, longitude: r["longitude"] ?? 0)
  let span = MKCoordinateSpan(latitudeDelta: r["latitudeDelta"] ?? 1, longitudeDelta: r["longitudeDelta"] ?? 1)
  return MKCoordinateRegion(center: center, span: span)
}

// One-shot wrapper around MKLocalSearchCompleter (which streams updates via its delegate). Retains
// itself until the first results/error callback, then resolves the promise and releases.
private final class CompleterBox: NSObject, MKLocalSearchCompleterDelegate {
  private let completer = MKLocalSearchCompleter()
  private let promise: Promise
  private var done = false
  private var selfRef: CompleterBox?

  init(promise: Promise) {
    self.promise = promise
    super.init()
    completer.delegate = self
    completer.resultTypes = [.address, .pointOfInterest]
  }

  func run(query: String, region: MKCoordinateRegion) {
    selfRef = self // keep alive across the async delegate callback
    completer.region = region
    completer.queryFragment = query
  }

  private func finish(_ payload: [[String: String]]) {
    if done { return }
    done = true
    promise.resolve(payload)
    selfRef = nil
  }

  func completerDidUpdateResults(_ completer: MKLocalSearchCompleter) {
    finish(completer.results.map { ["title": $0.title, "subtitle": $0.subtitle] })
  }

  func completer(_ completer: MKLocalSearchCompleter, didFailWithError error: Error) {
    if done { return }
    done = true
    promise.reject("APPLE_SEARCH_COMPLETE", error.localizedDescription)
    selfRef = nil
  }
}

public class AppleSearchModule: Module {
  public func definition() -> ModuleDefinition {
    Name("AppleSearch")

    AsyncFunction("complete") { (query: String, region: [String: Double], promise: Promise) in
      DispatchQueue.main.async {
        let box = CompleterBox(promise: promise)
        box.run(query: query, region: makeRegion(region))
      }
    }

    AsyncFunction("search") { (query: String, region: [String: Double], promise: Promise) in
      let request = MKLocalSearch.Request()
      request.naturalLanguageQuery = query
      request.region = makeRegion(region)
      MKLocalSearch(request: request).start { response, error in
        if let error = error {
          promise.reject("APPLE_SEARCH_SEARCH", error.localizedDescription)
          return
        }
        let items = (response?.mapItems ?? []).map { item -> [String: Any] in
          let c = item.placemark.coordinate
          return [
            "title": item.name ?? "",
            "subtitle": item.placemark.title ?? "",
            "latitude": c.latitude,
            "longitude": c.longitude,
          ]
        }
        promise.resolve(items)
      }
    }
  }
}
```

- [ ] **Step 7: `src/services/appleSearch.ts`** — JS wrapper mapping native results → `Place`

```ts
// Online enrichment via the AppleSearch native module (MapKit). Maps native completions/results to the
// shared Place shape. appleComplete is the real SearchDeps.appleComplete; appleResolve turns a tapped
// (coordinate-less) Apple completion into a coordinate via MKLocalSearch. Native import path is relative
// (local Expo module — same pattern as ../../modules/expo-godot-view).
import AppleSearch, { type AppleRegion } from '../../modules/expo-apple-search';
import type { Place, SearchRegion } from './place';

function toRegion(r: SearchRegion): AppleRegion {
  return {
    latitude: r.latitude,
    longitude: r.longitude,
    latitudeDelta: r.latitudeDelta,
    longitudeDelta: r.longitudeDelta,
  };
}

// Typeahead: title/subtitle only, no coordinate (resolved on tap via appleResolve). Rejects offline →
// searchProvider catches and degrades to local-only.
export async function appleComplete(q: string, region: SearchRegion): Promise<Place[]> {
  const raw = await AppleSearch.complete(q, toRegion(region));
  return raw.map((r, i) => ({
    id: `apple:${i}:${r.title}`,
    title: r.title,
    subtitle: r.subtitle || undefined,
    coordinate: null,
    kind: 'poi' as const,
    source: 'apple' as const,
  }));
}

// Resolve a tapped Apple completion (coordinate === null) to a coordinate via MKLocalSearch. Local
// results already have a coordinate and don't need this.
export async function appleResolve(place: Place, region: SearchRegion): Promise<Place> {
  if (place.coordinate) return place;
  const query = place.subtitle ? `${place.title} ${place.subtitle}` : place.title;
  const [first] = await AppleSearch.search(query, toRegion(region));
  if (!first) return place;
  return { ...place, coordinate: { latitude: first.latitude, longitude: first.longitude } };
}
```

- [ ] **Step 8: Commit** (native build happens in Task 7)

```bash
git add modules/expo-apple-search src/services/appleSearch.ts
git commit -m "feat(navigate): AppleSearch native module (MapKit) + JS wrapper"
```

---

### Task 6: `useNavigateSearch` hook — wire real sources into the orchestrator

**Files:**
- Create: `src/hooks/useNavigateSearch.ts`

**Interfaces:**
- Consumes: `runSearch`, `SearchDeps` from `@/services/searchProvider`; `initPlaceSources`, `searchLocal`, `recents` from `@/services/placeSource`; `appleComplete`, `appleResolve` from `@/services/appleSearch`; `Place`, `SearchRegion` from `@/services/place`.
- Produces: `useNavigateSearch(region: SearchRegion): { query: string; setQuery: (q: string) => void; results: Place[]; resolve: (p: Place) => Promise<Place> }`.

> This is the logic seam only — no visual component. The (out-of-scope) search field will call `setQuery`, render `results`, and call `resolve` on tap. Not node-testable (wires native sources); its behavior is exercised on-device in Task 7.

- [ ] **Step 1: Create `src/hooks/useNavigateSearch.ts`**

```ts
// Wires the real (native) search sources into the pure searchProvider orchestrator and exposes debounced
// results. Logic only — the search field UI is out of scope. Progressive: local results render instantly,
// then the merged (local + Apple) list replaces them when Apple returns.
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';

import { appleComplete, appleResolve } from '@/services/appleSearch';
import type { Place, SearchRegion } from '@/services/place';
import { normalizeQuery } from '@/services/place';
import { initPlaceSources, recents, searchLocal } from '@/services/placeSource';
import { runSearch, type SearchDeps } from '@/services/searchProvider';

const DEBOUNCE_MS = 200;

export function useNavigateSearch(region: SearchRegion) {
  const [query, setQuery] = useState('');
  const [results, setResults] = useState<Place[]>([]);
  const seq = useRef(0); // drop stale async responses

  const deps: SearchDeps = useMemo(
    () => ({ localSearch: searchLocal, appleComplete, recents }),
    [],
  );

  // Open the gazetteer once.
  useEffect(() => {
    void initPlaceSources();
  }, []);

  useEffect(() => {
    const mine = ++seq.current;
    const q = normalizeQuery(query);

    // Instant offline feedback (empty query → recents).
    setResults(q ? searchLocal(q, region) : recents());

    if (!q) return;
    const timer = setTimeout(() => {
      void runSearch(query, region, deps).then((merged) => {
        if (seq.current === mine) setResults(merged);
      });
    }, DEBOUNCE_MS);
    return () => clearTimeout(timer);
  }, [query, region, deps]);

  const resolve = useCallback((p: Place) => appleResolve(p, region), [region]);

  return { query, setQuery, results, resolve };
}
```

- [ ] **Step 2: Typecheck**

Run: `npx tsc --noEmit -p tsconfig.json`
Expected: no new errors.

- [ ] **Step 3: Commit**

```bash
git add src/hooks/useNavigateSearch.ts
git commit -m "feat(navigate): useNavigateSearch hook (wires sources, debounce, progressive)"
```

---

### Task 7: Native build, deploy-js asset sync, on-device verification

**Files:**
- Modify: `scripts/godot-ios/deploy-js.sh`

**Interfaces:** none (build + deploy + manual verification).

- [ ] **Step 1: Make `deploy-js.sh` sync Metro assets into the .app** (so future gazetteer refreshes deploy without a full rebuild). After the Hermes-swap block (`cp "$TMP/main.hbc" "$APP/main.jsbundle"`), and BEFORE re-signing, insert:

```bash
# Sync bundled assets (e.g. assets/places.db) into the .app so JS-only deploys pick up new/changed
# assets. expo export:embed wrote them to $TMP/assets; mirror that tree into the app's assets root.
if [ -d "$TMP/assets" ]; then
  rsync -a --delete "$TMP/assets/" "$APP/assets/" 2>/dev/null || cp -R "$TMP/assets/." "$APP/assets/"
  echo "  synced assets → $APP/assets"
fi
```

- [ ] **Step 2: Ensure the gazetteer asset exists** (Task 1 built it; confirm before the native build bundles it)

Run: `ls -lh assets/places.db`
Expected: the ~16 MB file exists. If missing, run `npm run build:places` first.

- [ ] **Step 3: Autolink the native module**

Run:
```bash
cd /Users/ivan/Work/airgapp/mobile/ios && LANG=en_US.UTF-8 pod install
```
Expected: output includes `AppleSearch` being installed (from `../modules/expo-apple-search/ios`). Confirm: `grep -n AppleSearch Podfile.lock` shows the pod.

- [ ] **Step 4: Full Release build** (bundles `places.db` + compiles the Swift module; also renews the weekly provisioning profile)

Run:
```bash
xcodebuild -workspace ios/airgapp.xcworkspace -scheme airgapp -configuration Release \
  -sdk iphoneos -destination 'generic/platform=iOS' -allowProvisioningUpdates build
```
Expected: `BUILD SUCCEEDED`. Do NOT pass `DEVELOPMENT_TEAM=` overrides.

- [ ] **Step 5: Install on device**

Run:
```bash
APP="$(ls -dt "$HOME"/Library/Developer/Xcode/DerivedData/airgapp-*/Build/Products/Release-iphoneos/airgapp.app 2>/dev/null | head -1)"
xcrun devicectl device install app --device F3867E6E-E95F-5B2A-9C4E-06D1D72475A1 "$APP"
```
Expected: `App installed`. (A benign `CoreDeviceError 10002` on auto-launch just means "tap the icon".) If install fails with `provisioning profile has expired`, re-run Step 4 (it regenerates the free 7-day profile) and retry.

- [ ] **Step 6: Verify the gazetteer asset landed in the .app**

Run: `ls -lh "$APP/assets"/**/places.db 2>/dev/null || find "$APP" -name 'places.db'`
Expected: a `places.db` (~16 MB) exists inside the installed `.app` bundle.

- [ ] **Step 7: On-device functional check** (temporary harness — do NOT commit)

Since the search UI is out of scope, verify the logic from a temporary debug hook. In `src/app/location.tsx`, temporarily add near the top of the component body:

```tsx
// TEMP verify — remove before final commit
const _dbg = useNavigateSearch(region);
useEffect(() => { _dbg.setQuery('sofia'); }, []);
useEffect(() => { console.log('NAV-SEARCH', _dbg.results.map((r) => `${r.source}:${r.title}`)); }, [_dbg.results]);
```
(Add `import { useNavigateSearch } from '@/hooks/useNavigateSearch';`.)

Deploy JS: `bash scripts/godot-ios/deploy-js.sh`. Then read the device log (Console.app / `xcrun devicectl device console` filtered to `NAV-SEARCH`):
- **Online:** expect a mix — `gazetteer:Sofia` (offline hit) AND `apple:…` entries (online enrichment).
- **Offline (Airplane mode):** expect gazetteer-only entries, no crash, no hang (Apple rejects → local-only).

- [ ] **Step 8: Remove the temporary harness** from `location.tsx` (the `_dbg` lines + import).

- [ ] **Step 9: Commit**

```bash
git add scripts/godot-ios/deploy-js.sh
git commit -m "chore(navigate): deploy-js asset sync; native build wiring for AppleSearch + gazetteer"
```

---

## Self-Review

**Spec coverage:**
- Offline layer (gazetteer + charger DB + recents) → Task 1 (gazetteer data), Task 4 (`placeSource`). ✓
- Online layer (`MKLocalSearchCompleter` + `MKLocalSearch`, region-biased) → Task 5 (`AppleSearch` + wrapper). ✓
- Merge/rank/dedupe/cap → Task 2 (`place.ts`). ✓
- Data flow (debounce, local-instant, Apple-enrich, tap-resolve) → Task 3 (`runSearch`), Task 6 (`useNavigateSearch` debounce + progressive), Task 5 (`appleResolve`). ✓
- Online detection = none explicit (always attempt, catch) → Task 3 `runSearch` try/catch. ✓
- `Place` type → Task 2. ✓ (Refined per spec's own data-flow: `coordinate` is `null` for unresolved Apple completions.)
- Gazetteer = `cities1000`, CC BY 4.0, bundled, SQLite, indexed → Task 1. ✓ (Attribution string carried in build output + Global Constraints note.)
- Error handling (offline → local-only; empty → recents; no matches → empty) → Task 2/3 + tests. ✓
- Testing (unit pure JS; manual on-device native) → Tasks 1-3 tests; Task 7 manual. ✓
- Out of scope (tap action, routing, visual UI, real recents) → not implemented; `recents()` stubbed, `resolve` handoff exposed but destination behavior absent. ✓

**Placeholder scan:** No TBD/TODO in code. The only "later" items (readable admin1/country names, real recents, credits-surface UI) are explicitly out-of-scope data/UI notes, and every function returns concrete values now. ✓

**Type/name consistency:** `Place`, `SearchRegion`, `SearchDeps`, `PlaceRecord`, `mapGeoNamesRow`, `parsePopulation`, `foldAccents`, `normalizeQuery`, `dedupePlaces`, `rankPlaces`, `mergeResults`, `runSearch`, `initPlaceSources`, `searchLocal`, `recents`, `chargersMatchingName`, `appleComplete`, `appleResolve`, `AppleRegion`/`AppleCompletion`/`AppleResult` — used identically across tasks. `TIER` treats `gazetteer` and `charger` as the same tier (1), `apple` as 2, `recent` as 0; the `rankPlaces` test asserts this order. `runSearch` passes the normalized query to `localSearch` (asserted). ✓

---

## Execution Handoff

Plan complete. Two execution options:

1. **Subagent-Driven (recommended)** — a fresh subagent per task, review between tasks, fast iteration.
2. **Inline Execution** — execute tasks in this session with checkpoints for review.

Note: Tasks 1-3 are pure/testable and fully autonomous. Task 7 requires the physical iPhone (a full ~25-min `xcodebuild` + on-device checks) and a device that's unlocked/available.
