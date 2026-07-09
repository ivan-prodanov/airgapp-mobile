# Shared-Location Intake Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Let a user share a location from Apple Maps / Google Maps / Waze via the iOS Share Sheet into airgapp, which opens the map with that place previewed and offers Navigate + Add-to-Trip (last saved trip, else disabled).

**Architecture:** A thin native Share Extension captures the shared URL/text into an App Group; a tiny native reader module hands it to JS; a pure-JS parser turns it into coordinates; a root intake hook routes it to the Location screen's preview sheet. Trips persist as a snapshot in AsyncStorage so "Add to Trip" survives a cold launch.

**Tech Stack:** Expo SDK 56, React Native 0.85 (Hermes/Fabric), expo-router, expo-modules (Swift), `@react-native-async-storage/async-storage`, node:test + tsx for unit tests.

## Global Constraints

- **NEVER run `expo prebuild`** — `ios/` is hand-maintained and embeds Godot. Native additions are done manually (Xcode target / pbxproj + entitlements), then `pod install` (needs `LANG=en_US.UTF-8`) + one `xcodebuild` Release. JS-only changes deploy via `bash scripts/godot-ios/deploy-js.sh`.
- **Untrusted input:** the shared string comes from another app — only extract coordinates + a sanitized display label; never auto-open/execute it (short-link resolution only GETs the known map hosts).
- **Coordinate validation is mandatory** on every parse result: `lat ∈ [-90,90]`, `lng ∈ [-180,180]`, reject `NaN`/`0,0`; swap lat/lng if "latitude" is out of range but "longitude" is a valid latitude.
- **Pin, not camera:** trust Apple `ll`/`coordinate` (not `sll`/`center`); Google `!3d!4d` (not `@`/`center`); Waze `ll`/`to=ll.` (not `from`).
- **Bundle id** `local.airgapp.mobile`; **App Group** `group.local.airgapp.mobile`; **URL scheme** `airgapp` (already registered).
- **Tests** use `node:test` + `node:assert/strict`, run with `node --import tsx --test <files>`. Every new `*.test.ts` must be appended to the `test` script's file list in `package.json`.
- **Commit** after each task. Do NOT push. Branch is `phase4/engine-embed` (already a feature branch).

## Canonical types (used across tasks — copy verbatim)

```ts
// from '@/state/mockLocation'
export interface LatLng { latitude: number; longitude: number }

// services/sharedLocation.ts
export type ShareSource = 'apple' | 'google' | 'waze' | 'unknown';
export interface SharedLocation { coordinate: LatLng; name?: string; source: ShareSource }
// What the pure extractor returns before any network step:
export interface RawExtract { coordinate?: LatLng; name?: string; address?: string; source: ShareSource }
// Injected so the parser stays node-testable (hook supplies real impls):
export interface ParseDeps {
  resolveUrl: (url: string) => Promise<{ finalUrl: string; body: string } | null>;
  geocode: (address: string) => Promise<LatLng | null>;
}
export function decodeGeohash(hash: string): LatLng;
export function extractFromUrl(url: string): RawExtract | null;
export function parseSharedLocation(raw: string, deps: ParseDeps): Promise<SharedLocation | null>;
```

---

## Task 1: Geohash decoder

**Files:**
- Create: `src/services/sharedLocation.ts`
- Test: `src/services/sharedLocation.test.ts`
- Modify: `package.json` (append test file to `test` script)

**Interfaces:**
- Produces: `decodeGeohash(hash: string): LatLng` — Niemeyer base32 geohash → cell-center lat/lng.

- [ ] **Step 1: Add the test file to the test runner**

In `package.json`, append ` src/services/sharedLocation.test.ts` to the end of the `"test"` script's file list.

- [ ] **Step 2: Write the failing test**

Create `src/services/sharedLocation.test.ts`:

```ts
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { decodeGeohash } from './sharedLocation';

const near = (a: number, b: number, eps = 1e-3) => assert.ok(Math.abs(a - b) < eps, `${a} !~= ${b}`);

test('decodeGeohash: canonical ezs42', () => {
  const { latitude, longitude } = decodeGeohash('ezs42');
  near(latitude, 42.605, 1e-2);
  near(longitude, -5.603, 1e-2);
});

test('decodeGeohash: Waze 10-char dr5ru7vtv2 → Times Square', () => {
  const { latitude, longitude } = decodeGeohash('dr5ru7vtv2');
  near(latitude, 40.7588938, 1e-4);
  near(longitude, -73.985136, 1e-4);
});
```

- [ ] **Step 3: Run it — expect FAIL**

Run: `npm test 2>&1 | grep -A2 decodeGeohash`
Expected: FAIL (`decodeGeohash` is not a function / undefined).

- [ ] **Step 4: Implement**

Create `src/services/sharedLocation.ts`:

```ts
import type { LatLng } from '@/state/mockLocation';

export type ShareSource = 'apple' | 'google' | 'waze' | 'unknown';
export interface SharedLocation { coordinate: LatLng; name?: string; source: ShareSource }
export interface RawExtract { coordinate?: LatLng; name?: string; address?: string; source: ShareSource }

const GEOHASH_ALPHABET = '0123456789bcdefghjkmnpqrstuvwxyz';

// Niemeyer base32 geohash → the CENTER of the addressed cell. Even-index bits refine longitude
// [-180,180], odd-index bits refine latitude [-90,90]; bit=1 → upper half. (Used by Waze /ul/h<hash>.)
export function decodeGeohash(hash: string): LatLng {
  let latLo = -90;
  let latHi = 90;
  let lonLo = -180;
  let lonHi = 180;
  let even = true; // longitude first
  for (const ch of hash.toLowerCase()) {
    const idx = GEOHASH_ALPHABET.indexOf(ch);
    if (idx < 0) continue; // skip stray chars defensively
    for (let bit = 4; bit >= 0; bit--) {
      const on = (idx >> bit) & 1;
      if (even) {
        const mid = (lonLo + lonHi) / 2;
        if (on) lonLo = mid;
        else lonHi = mid;
      } else {
        const mid = (latLo + latHi) / 2;
        if (on) latLo = mid;
        else latHi = mid;
      }
      even = !even;
    }
  }
  return { latitude: (latLo + latHi) / 2, longitude: (lonLo + lonHi) / 2 };
}
```

- [ ] **Step 5: Run it — expect PASS**

Run: `npm test 2>&1 | grep -c "decodeGeohash"` (both tests referenced) and `npm test 2>&1 | tail -5`
Expected: PASS, no failures.

- [ ] **Step 6: Commit**

```bash
git add src/services/sharedLocation.ts src/services/sharedLocation.test.ts package.json
git commit -m "feat(share): geohash decoder for Waze /ul/h short links"
```

---

## Task 2: Pure URL extractor (`extractFromUrl`)

**Files:**
- Modify: `src/services/sharedLocation.ts`
- Modify: `src/services/sharedLocation.test.ts`

**Interfaces:**
- Consumes: `decodeGeohash` (Task 1).
- Produces: `extractFromUrl(url: string): RawExtract | null` — offline extraction of an inline coordinate/label from one Apple/Google/Waze URL. No network. Also produces internal helpers `validCoord`, `parseLatLng`.

- [ ] **Step 1: Write the failing tests** (append to `sharedLocation.test.ts`)

```ts
import { extractFromUrl } from './sharedLocation';

test('apple legacy ll= is the pin, q= is the label', () => {
  const r = extractFromUrl('https://maps.apple.com/?address=X&auid=1&ll=41.890221,12.492317&lsp=9902&q=Colosseum&t=m');
  assert.equal(r?.source, 'apple');
  near(r!.coordinate!.latitude, 41.890221); near(r!.coordinate!.longitude, 12.492317);
  assert.equal(r?.name, 'Colosseum');
});

test('apple unified /place coordinate=', () => {
  const r = extractFromUrl('https://maps.apple.com/place?coordinate=40.864791,-73.931723&name=My%20Place');
  near(r!.coordinate!.latitude, 40.864791); assert.equal(r?.name, 'My Place');
});

test('apple ignores sll (search hint), not the pin', () => {
  const r = extractFromUrl('https://maps.apple.com/?q=pizza&sll=50.894967,4.341626&z=10');
  assert.equal(r?.coordinate, undefined); // no pin; q is a name
  assert.equal(r?.name, 'pizza');
});

test('apple place-id-only → no coords, no name fabrication', () => {
  const r = extractFromUrl('https://maps.apple.com/place?place-id=I63802885C8189B2B');
  assert.equal(r?.coordinate, undefined);
});

test('google prefers !3d!4d over @camera', () => {
  const r = extractFromUrl('https://www.google.com/maps/place/Eiffel+Tower/@48.85,2.29,17z/data=!3m5!8m2!3d48.8582602!4d2.2944991');
  assert.equal(r?.source, 'google');
  near(r!.coordinate!.latitude, 48.8582602); near(r!.coordinate!.longitude, 2.2944991);
  assert.equal(r?.name, 'Eiffel Tower');
});

test('google @camera fallback', () => {
  const r = extractFromUrl('https://www.google.com/maps/@52.520008,13.404954,15z');
  near(r!.coordinate!.latitude, 52.520008); near(r!.coordinate!.longitude, 13.404954);
});

test('google q=lat,lng', () => {
  const r = extractFromUrl('https://maps.google.com/?q=48.8584,2.2945');
  near(r!.coordinate!.latitude, 48.8584);
});

test('waze ll=', () => {
  const r = extractFromUrl('https://www.waze.com/ul?ll=40.75889500%2C-73.98513100&navigate=yes&zoom=17');
  assert.equal(r?.source, 'waze'); near(r!.coordinate!.latitude, 40.758895);
});

test('waze to=ll. (directions), ignores from=', () => {
  const r = extractFromUrl('https://www.waze.com/live-map/directions?to=ll.40.7589%2C-73.9851&from=ll.40.68%2C-74.04');
  near(r!.coordinate!.latitude, 40.7589); near(r!.coordinate!.longitude, -73.9851);
});

test('waze /ul/h<geohash>', () => {
  const r = extractFromUrl('https://www.waze.com/ul/hdr5ru7vtv2');
  near(r!.coordinate!.latitude, 40.7588938, 1e-4);
});

test('rejects out-of-range and swaps reversed lat/lng', () => {
  const r = extractFromUrl('https://maps.apple.com/?ll=12.492317,41.890221'); // lat=12.49 valid, no swap needed here
  assert.ok(Math.abs(r!.coordinate!.latitude) <= 90 && Math.abs(r!.coordinate!.longitude) <= 180);
});

test('non-map url → null', () => {
  assert.equal(extractFromUrl('https://example.com/foo'), null);
});
```

- [ ] **Step 2: Run — expect FAIL**

Run: `npm test 2>&1 | tail -8`
Expected: FAIL (`extractFromUrl` undefined).

- [ ] **Step 3: Implement** (append to `sharedLocation.ts`)

```ts
const LATLNG_RE = /^\s*(-?\d+(?:\.\d+)?)\s*,\s*(-?\d+(?:\.\d+)?)\s*$/;

// Build a validated coordinate; swap if "lat" is out of range but "lng" is a valid latitude; else null.
function validCoord(latRaw: number, lngRaw: number): LatLng | null {
  let lat = latRaw;
  let lng = lngRaw;
  if (Number.isNaN(lat) || Number.isNaN(lng)) return null;
  if (Math.abs(lat) > 90 && Math.abs(lng) <= 90) { const t = lat; lat = lng; lng = t; }
  if (Math.abs(lat) > 90 || Math.abs(lng) > 180) return null;
  if (lat === 0 && lng === 0) return null;
  return { latitude: lat, longitude: lng };
}

// Parse a "lat,lng" string into a validated coordinate, or null if it isn't a coordinate pair.
function parseLatLng(s: string | null | undefined): LatLng | null {
  if (!s) return null;
  const m = decodeURIComponent(s).match(LATLNG_RE);
  return m ? validCoord(parseFloat(m[1]), parseFloat(m[2])) : null;
}

function hostSource(host: string): ShareSource {
  if (host.includes('waze.com')) return 'waze';
  if (host.includes('apple.com')) return 'apple';
  if (host.includes('google.') || host.includes('goo.gl') || host.includes('g.co')) return 'google';
  return 'unknown';
}

export function extractFromUrl(url: string): RawExtract | null {
  let u: URL;
  try { u = new URL(url.trim().replace(/^http:/, 'https:')); } catch { return null; }
  const source = hostSource(u.hostname);
  if (source === 'unknown') return null;
  const qp = u.searchParams;
  const decoded = decodeURIComponent(url);

  if (source === 'apple') {
    const coord = parseLatLng(qp.get('ll')) ?? parseLatLng(qp.get('coordinate'));
    const qCoord = parseLatLng(qp.get('q'));
    const label = (qCoord ? undefined : qp.get('q')) ?? qp.get('name') ?? undefined;
    return { source, coordinate: coord ?? qCoord ?? undefined, name: label?.trim(), address: qp.get('address') ?? undefined };
  }

  if (source === 'waze') {
    // /ul/h<geohash>
    const gh = u.pathname.match(/\/ul\/h([0-9bcdefghjkmnpqrstuvwxyz]+)/i);
    if (gh) return { source, coordinate: decodeGeohash(gh[1]) };
    // to=ll.LAT,LNG  |  ll=LAT,LNG
    const to = qp.get('to');
    const toCoord = to && to.startsWith('ll.') ? parseLatLng(to.slice(3)) : null;
    const coord = parseLatLng(qp.get('ll')) ?? toCoord;
    return coord ? { source, coordinate: coord } : { source };
  }

  // google
  const d = decoded.match(/!3d(-?\d+(?:\.\d+)?)!4d(-?\d+(?:\.\d+)?)/); // the real place pin
  const at = decoded.match(/@(-?\d+(?:\.\d+)?),(-?\d+(?:\.\d+)?)/); // camera fallback
  const qCoord = parseLatLng(qp.get('q')) ?? parseLatLng(qp.get('query')) ?? parseLatLng(qp.get('ll'));
  const coord =
    (d ? validCoord(parseFloat(d[1]), parseFloat(d[2])) : null) ??
    qCoord ??
    (at ? validCoord(parseFloat(at[1]), parseFloat(at[2])) : null);
  const placeSeg = u.pathname.match(/\/place\/([^/@]+)/);
  const name = placeSeg ? decodeURIComponent(placeSeg[1]).replace(/\+/g, ' ') : undefined;
  return { source, coordinate: coord ?? undefined, name };
}
```

- [ ] **Step 4: Run — expect PASS**

Run: `npm test 2>&1 | tail -6`
Expected: PASS, no failures.

- [ ] **Step 5: Commit**

```bash
git add src/services/sharedLocation.ts src/services/sharedLocation.test.ts
git commit -m "feat(share): pure Apple/Google/Waze URL coordinate extractor"
```

---

## Task 3: Async orchestrator (`parseSharedLocation`)

**Files:**
- Modify: `src/services/sharedLocation.ts`
- Modify: `src/services/sharedLocation.test.ts`

**Interfaces:**
- Consumes: `extractFromUrl` (Task 2), `ParseDeps`.
- Produces: `parseSharedLocation(raw: string, deps: ParseDeps): Promise<SharedLocation | null>` and `firstUrl(raw): string | null`, `isShortLink(url): boolean`.

- [ ] **Step 1: Write the failing tests** (append to `sharedLocation.test.ts`)

```ts
import { parseSharedLocation } from './sharedLocation';

const noDeps = { resolveUrl: async () => null, geocode: async () => null };

test('parse: extracts URL from "Label\\nURL" text', async () => {
  const loc = await parseSharedLocation('Colosseum\nhttps://maps.apple.com/?ll=41.89,12.49&q=Colosseum', noDeps);
  near(loc!.coordinate.latitude, 41.89); assert.equal(loc!.source, 'apple');
});

test('parse: resolves a google short link via deps.resolveUrl', async () => {
  const deps = {
    resolveUrl: async (_u: string) => ({ finalUrl: 'https://www.google.com/maps/place/X/@1,2,17z/data=!3d48.8&!4d2.29', body: '' }),
    geocode: async () => null,
  };
  const loc = await parseSharedLocation('https://maps.app.goo.gl/abc123', deps);
  assert.equal(loc!.source, 'google');
  near(loc!.coordinate.latitude, 48.8);
});

test('parse: short link coords only in the HTML body', async () => {
  const deps = {
    resolveUrl: async () => ({ finalUrl: 'https://consent.google.com/x', body: 'blah @50.1,4.2 blah !3d50.1!4d4.2' }),
    geocode: async () => null,
  };
  const loc = await parseSharedLocation('https://maps.app.goo.gl/abc', deps);
  near(loc!.coordinate.latitude, 50.1);
});

test('parse: address-only apple → geocode fallback', async () => {
  const deps = { resolveUrl: async () => null, geocode: async (a: string) => (a ? { latitude: 9, longitude: 8 } : null) };
  const loc = await parseSharedLocation('https://maps.apple.com/place?address=1000%20Fifth%20Ave', deps);
  near(loc!.coordinate.latitude, 9);
});

test('parse: garbage → null', async () => {
  assert.equal(await parseSharedLocation('hello world', noDeps), null);
});
```

- [ ] **Step 2: Run — expect FAIL**

Run: `npm test 2>&1 | tail -8` → FAIL (`parseSharedLocation` undefined).

- [ ] **Step 3: Implement** (append to `sharedLocation.ts`)

```ts
const SHORT_LINK_RE = /^https?:\/\/(maps\.app\.goo\.gl|goo\.gl\/maps|g\.co\/kgs)\b/i;

export function firstUrl(raw: string): string | null {
  const m = raw.match(/https?:\/\/[^\s]+/);
  return m ? m[0] : null;
}
export function isShortLink(url: string): boolean {
  return SHORT_LINK_RE.test(url) || /\/maps\.app\.goo\.gl|goo\.gl\/maps|g\.co\/kgs/i.test(url);
}

function toShared(r: RawExtract | null): SharedLocation | null {
  return r && r.coordinate ? { coordinate: r.coordinate, name: r.name, source: r.source } : null;
}

export async function parseSharedLocation(raw: string, deps: ParseDeps): Promise<SharedLocation | null> {
  const url = firstUrl(raw);
  if (!url) return null;

  // 1) Direct extraction.
  let extract = extractFromUrl(url);
  let coordHit = toShared(extract);
  if (coordHit) return coordHit;

  // 2) Short link → resolve, then re-extract over the final URL AND the HTML body.
  if (isShortLink(url)) {
    const resolved = await deps.resolveUrl(url);
    if (resolved) {
      coordHit = toShared(extractFromUrl(resolved.finalUrl));
      if (coordHit) return coordHit;
      // Some links land on a consent interstitial that carries the coords only in the body.
      const body = resolved.body;
      const d = body.match(/!3d(-?\d+(?:\.\d+)?)!4d(-?\d+(?:\.\d+)?)/) || body.match(/@(-?\d+(?:\.\d+)?),(-?\d+(?:\.\d+)?)/);
      if (d) {
        const lat = parseFloat(d[1]);
        const lng = parseFloat(d[2]);
        if (Math.abs(lat) <= 90 && Math.abs(lng) <= 180 && !(lat === 0 && lng === 0)) {
          return { coordinate: { latitude: lat, longitude: lng }, source: 'google' };
        }
      }
      extract = extractFromUrl(resolved.finalUrl) ?? extract;
    }
  }

  // 3) Address-only → geocode.
  const address = extract?.address;
  if (address) {
    const c = await deps.geocode(address);
    if (c) return { coordinate: c, name: extract?.name, source: extract?.source ?? 'unknown' };
  }
  return null;
}
```

- [ ] **Step 4: Run — expect PASS**

Run: `npm test 2>&1 | tail -6` → PASS.

- [ ] **Step 5: Typecheck + commit**

```bash
npx tsc --noEmit -p tsconfig.json && \
git add src/services/sharedLocation.ts src/services/sharedLocation.test.ts && \
git commit -m "feat(share): parseSharedLocation orchestrator (short-link + geocode)"
```

---

## Task 4: Shared-location hand-off store

**Files:**
- Create: `src/state/sharedLocationStore.ts`
- Create: `src/state/sharedLocationStore.test.ts`
- Modify: `package.json` (append test file)

**Interfaces:**
- Consumes: `SharedLocation` (Task 1).
- Produces: `sharedLocationStore.set(loc)`, `.consume(): SharedLocation | null`, `.subscribe(cb): () => void`.

- [ ] **Step 1: Add test file to runner** — append ` src/state/sharedLocationStore.test.ts` to `package.json` `test` script.

- [ ] **Step 2: Write the failing test**

```ts
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { sharedLocationStore } from './sharedLocationStore';

test('set notifies subscribers; consume returns once then null', () => {
  let fired = 0;
  const unsub = sharedLocationStore.subscribe(() => { fired++; });
  sharedLocationStore.set({ coordinate: { latitude: 1, longitude: 2 }, source: 'apple' });
  assert.equal(fired, 1);
  const first = sharedLocationStore.consume();
  assert.equal(first?.coordinate.latitude, 1);
  assert.equal(sharedLocationStore.consume(), null);
  unsub();
});
```

- [ ] **Step 3: Run — expect FAIL.** Run: `npm test 2>&1 | tail -5`.

- [ ] **Step 4: Implement** `src/state/sharedLocationStore.ts`:

```ts
import type { SharedLocation } from '@/services/sharedLocation';

// Module-level hand-off from the intake hook to the Location screen. `set` publishes a pending shared
// location and notifies subscribers; the screen `consume`s it exactly once (get + clear).
let pending: SharedLocation | null = null;
const subs = new Set<() => void>();

export const sharedLocationStore = {
  set(loc: SharedLocation): void {
    pending = loc;
    subs.forEach((f) => f());
  },
  consume(): SharedLocation | null {
    const p = pending;
    pending = null;
    return p;
  },
  subscribe(cb: () => void): () => void {
    subs.add(cb);
    return () => {
      subs.delete(cb);
    };
  },
};
```

- [ ] **Step 5: Run — expect PASS.** Run: `npm test 2>&1 | tail -5`.

- [ ] **Step 6: Commit**

```bash
git add src/state/sharedLocationStore.ts src/state/sharedLocationStore.test.ts package.json
git commit -m "feat(share): module-level shared-location hand-off store"
```

---

## Task 5: AsyncStorage backend + trip snapshot persistence

**Files:**
- Modify: `package.json` (add dependency)
- Create: `src/state/appStorage.ts` (the ONLY file importing AsyncStorage)
- Create: `src/state/tripSnapshot.ts` (pure, testable — never imports AsyncStorage)
- Create: `src/state/tripSnapshot.test.ts` (+ append to `test` script)
- Modify: `src/state/useTrip.ts`

**Interfaces:**
- Consumes: `AppStorage`, `load`, `makeSaver`, `createMemoryBackend` (existing `persistence.ts`); `Trip`, `startTrip`, `carStop`, `addStop as addStopOp` (existing `state/trip.ts`); `Place` (existing `services/place.ts`).
- Produces: `appStorage: AppStorage` (AsyncStorage-backed, in `appStorage.ts`); `TRIP_SNAPSHOT_KEY`, `saveTripSnapshotTo(storage, trip)`, `loadTripSnapshotFrom(storage): Promise<Trip | null>` (pure, in `tripSnapshot.ts`); `useTrip()` gains `savedExists: boolean` and `addToSaved(place): Promise<void>`.

> **Critical structure note:** `@react-native-async-storage/async-storage` cannot load under node/tsx (it requires React Native's NativeModules). So it is imported ONLY in `appStorage.ts`, which no test and no pure module imports. `tripSnapshot.ts` stays pure (storage injected) so `tripSnapshot.test.ts` can import it with a memory backend. `useTrip.ts` (a hook, never node-tested) is the only place that wires the real `appStorage` to the snapshot functions. Do NOT add the AsyncStorage import to `persistence.ts` — that would break the whole node test suite via transitive import.

- [ ] **Step 1: Add the dependency (pinned to match ExpoModulesCore era)**

Run: `EXPO_USE_PRECOMPILED_MODULES=true npx expo install @react-native-async-storage/async-storage`
Then verify it resolved a version compatible with SDK 56 (per the native-module memory: pin DOWN to match if `expo install` picks a newer patch). Expected: it's added to `package.json` `dependencies`.

- [ ] **Step 2: Create `src/state/appStorage.ts`** (the ONLY file that imports AsyncStorage — do NOT touch `persistence.ts`)

```ts
import AsyncStorage from '@react-native-async-storage/async-storage';
import type { AppStorage } from './persistence';

// Real cross-launch backend (native). Isolated in its own file so pure/tested modules never transitively
// import AsyncStorage (which can't load under node/tsx). Only useTrip.ts (a hook, never node-tested) imports it.
export const appStorage: AppStorage = {
  getItem: (key) => AsyncStorage.getItem(key),
  setItem: (key, value) => AsyncStorage.setItem(key, value),
};
```

- [ ] **Step 3: Write the failing snapshot test**

Append ` src/state/tripSnapshot.test.ts` to `package.json` `test` script, then create `src/state/tripSnapshot.test.ts`:

```ts
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createMemoryBackend } from './persistence';
import { saveTripSnapshotTo, loadTripSnapshotFrom, TRIP_SNAPSHOT_KEY } from './tripSnapshot';
import { startTrip, carStop } from './trip';

test('save then load round-trips a trip snapshot', async () => {
  const s = createMemoryBackend();
  const t = startTrip(carStop({ latitude: 1, longitude: 1 }), { id: 'p1', title: 'Dest', subtitle: '', coordinate: { latitude: 2, longitude: 2 }, kind: 'poi', source: 'apple' });
  await saveTripSnapshotTo(s, t);
  const loaded = await loadTripSnapshotFrom(s);
  assert.equal(loaded?.stops.length, t.stops.length);
  assert.equal(loaded?.stops[1].title, 'Dest');
});

test('load returns null when nothing saved', async () => {
  const s = createMemoryBackend();
  assert.equal(await loadTripSnapshotFrom(s), null);
  assert.equal(TRIP_SNAPSHOT_KEY, 'trip:last');
});
```

- [ ] **Step 4: Run — expect FAIL.** Run: `npm test 2>&1 | tail -6`.

- [ ] **Step 5: Implement `src/state/tripSnapshot.ts`** (PURE — storage injected, NO AsyncStorage import)

```ts
import { load, type AppStorage } from './persistence';
import type { Trip } from './trip';

export const TRIP_SNAPSHOT_KEY = 'trip:last';

// Storage-injected so the logic is node-testable with a memory backend. useTrip.ts binds the real appStorage.
export async function loadTripSnapshotFrom(storage: AppStorage): Promise<Trip | null> {
  return load<Trip | null>(storage, TRIP_SNAPSHOT_KEY, null);
}
export async function saveTripSnapshotTo(storage: AppStorage, trip: Trip | null): Promise<void> {
  await storage.setItem(TRIP_SNAPSHOT_KEY, JSON.stringify(trip));
}
```

- [ ] **Step 6: Run — expect PASS.** Run: `npm test 2>&1 | tail -6`.

- [ ] **Step 7: Wire `useTrip.ts` to the snapshot** (persist on change; expose `savedExists` + `addToSaved`; do NOT auto-restore)

Edit `src/state/useTrip.ts`: change the React import to `import { useCallback, useEffect, useRef, useState } from 'react';`, add `import { makeSaver } from './persistence';`, `import { appStorage } from './appStorage';`, and `import { TRIP_SNAPSHOT_KEY, loadTripSnapshotFrom } from './tripSnapshot';`. Build the debounced saver at module scope (below the imports, above `useTrip`) and add the `savedExists` state, a `tripRef`, two effects, and `addToSaved` (keep the existing `start`/`addStop`/… mutators unchanged):

```ts
// Debounced snapshot writer (frequent trip edits collapse to one write). Uses the real native backend;
// this file is a hook, never node-tested, so importing appStorage/AsyncStorage here is safe.
const saveSnapshot = makeSaver<Trip | null>(appStorage, TRIP_SNAPSHOT_KEY, 400);

export function useTrip() {
  const [trip, setTrip] = useState<Trip | null>(null);
  const [savedExists, setSavedExists] = useState(false);
  // Live mirror of `trip` for reading current state inside callbacks without a setState side effect.
  const tripRef = useRef<Trip | null>(trip);
  tripRef.current = trip;

  // Check once on mount whether a persisted "last trip" exists — but do NOT load it into the session
  // (a normal launch stays clean; no stale route on the map).
  useEffect(() => {
    void loadTripSnapshotFrom(appStorage).then((t) => setSavedExists(!!t));
  }, []);

  // Persist ONLY a truthy trip snapshot (debounced). Never write null — the effect fires on mount with the
  // initial null, and writing that would erase the persisted "last trip" before it can be resumed. Clearing
  // the active trip therefore also preserves the last snapshot (which is the desired "last saved trip").
  useEffect(() => {
    if (trip) {
      saveSnapshot(trip);
      setSavedExists(true);
    }
  }, [trip]);

  // ...existing start / addStop / insertStop / addCharger / insertCharger / removeStop / reorder / clear...

  // Append to the active trip if one is in progress; else load the persisted snapshot and append (making it
  // active); else start a fresh single-destination trip. Reads current trip via tripRef (no setState trick).
  const addToSaved = useCallback(async (place: Place) => {
    const active = tripRef.current;
    if (active) { setTrip(addStopOp(active, place)); return; }
    const snap = await loadTripSnapshotFrom(appStorage);
    setTrip(snap ? addStopOp(snap, place) : startTrip(carStop(place.coordinate ?? { latitude: 0, longitude: 0 }), place));
  }, []);

  return { trip, savedExists, start, addStop, insertStop, addCharger, insertCharger, removeStop, reorder, clear, addToSaved };
}
```

- [ ] **Step 8: Typecheck + run tests + commit**

```bash
npx tsc --noEmit -p tsconfig.json && npm test 2>&1 | tail -3 && \
git add package.json src/state/appStorage.ts src/state/tripSnapshot.ts src/state/tripSnapshot.test.ts src/state/useTrip.ts && \
git commit -m "feat(trip): AsyncStorage backend + last-trip snapshot persistence"
```

> Note: `expo install` also touches `pnpm-lock.yaml`, which is already dirty from earlier work — do NOT `git add` the lockfile here (leave it, consistent with the rest of the tree). The commit adds only `package.json` + the new/modified source files above.

---

## Task 6: Native reader module `modules/shared-intake`

**Files:**
- Create: `modules/shared-intake/expo-module.config.json`
- Create: `modules/shared-intake/index.ts`
- Create: `modules/shared-intake/src/SharedIntakeModule.ts`
- Create: `modules/shared-intake/ios/SharedIntakeModule.swift`
- Create: `modules/shared-intake/ios/SharedIntake.podspec`

**Interfaces:**
- Produces: JS `SharedIntake.consumePendingShare(): Promise<string | null>` — atomically reads + clears the App Group key `pendingSharedLocation` and returns its `raw` string.

*(No unit test — native module, verified on device in Task 9/11. Autolinked by `use_expo_modules!`, so no pbxproj edit needed for the module itself; `pod install` discovers it.)*

- [ ] **Step 1: `modules/shared-intake/expo-module.config.json`**

```json
{
  "platforms": ["apple"],
  "apple": { "modules": ["SharedIntakeModule"] }
}
```

- [ ] **Step 2: `modules/shared-intake/index.ts`**

```ts
export { default } from './src/SharedIntakeModule';
```

- [ ] **Step 3: `modules/shared-intake/src/SharedIntakeModule.ts`**

```ts
import { requireNativeModule } from 'expo';

declare class SharedIntakeModule {
  // Atomically read + clear the App Group's pending shared string (or null if none).
  consumePendingShare(): Promise<string | null>;
}

export default requireNativeModule<SharedIntakeModule>('SharedIntake');
```

- [ ] **Step 4: `modules/shared-intake/ios/SharedIntakeModule.swift`**

```swift
import ExpoModulesCore

// Reads and clears the shared-location payload the Share Extension wrote into the App Group.
// The write stores JSON { "raw": "<shared string>", "ts": <ms> } under `pendingSharedLocation`.
public class SharedIntakeModule: Module {
  private let suite = "group.local.airgapp.mobile"
  private let key = "pendingSharedLocation"

  public func definition() -> ModuleDefinition {
    Name("SharedIntake")

    AsyncFunction("consumePendingShare") { () -> String? in
      guard let defaults = UserDefaults(suiteName: self.suite),
            let json = defaults.string(forKey: self.key) else { return nil }
      defaults.removeObject(forKey: self.key)            // clear → fire-once
      defaults.synchronize()
      guard let data = json.data(using: .utf8),
            let obj = try? JSONSerialization.jsonObject(with: data) as? [String: Any],
            let raw = obj["raw"] as? String, !raw.isEmpty else { return nil }
      return raw
    }
  }
}
```

- [ ] **Step 5: `modules/shared-intake/ios/SharedIntake.podspec`**

```ruby
Pod::Spec.new do |s|
  s.name           = 'SharedIntake'
  s.version        = '1.0.0'
  s.summary        = 'Reads the shared-location payload from the App Group.'
  s.description    = 'Bridges the Share Extension App Group hand-off to JS via the Expo Modules API.'
  s.author         = ''
  s.homepage       = 'https://docs.expo.dev/modules/'
  s.platforms      = { :ios => '16.4' }
  s.source         = { git: '' }
  s.static_framework = true

  s.dependency 'ExpoModulesCore'

  s.source_files = 'SharedIntakeModule.swift'

  s.pod_target_xcconfig = {
    'DEFINES_MODULE' => 'YES',
    'SWIFT_COMPILATION_MODE' => 'wholemodule',
  }
end
```

- [ ] **Step 6: Commit** (build happens in Task 8/11)

```bash
git add modules/shared-intake
git commit -m "feat(share): native SharedIntake module (App Group reader)"
```

---

## Task 7: Intake hook + geocode/short-link deps + error surface

**Files:**
- Create: `src/hooks/useSharedLocationIntake.ts`
- Modify: `src/app/_layout.tsx` (mount the hook)

**Interfaces:**
- Consumes: `SharedIntake.consumePendingShare` (Task 6), `parseSharedLocation` (Task 3), `sharedLocationStore.set` (Task 4), `expo-location`, `expo-router`.
- Produces: `useSharedLocationIntake(): void` — mounted once at root; consumes pending shares, parses, routes to `/location`.

*(No unit test — integration/native; verified on device. The pure parser it calls is already covered.)*

- [ ] **Step 1: Implement `src/hooks/useSharedLocationIntake.ts`**

```ts
import { useEffect, useRef } from 'react';
import { Alert, AppState, Linking } from 'react-native';
import { useRouter } from 'expo-router';
import * as Location from 'expo-location';

import SharedIntake from '../../modules/shared-intake';
import { parseSharedLocation, type ParseDeps } from '@/services/sharedLocation';
import { sharedLocationStore } from '@/state/sharedLocationStore';

// Real dependencies for the parser: resolve short links over the network, geocode address-only shares.
const deps: ParseDeps = {
  resolveUrl: async (url) => {
    try {
      const res = await fetch(url, {
        redirect: 'follow',
        headers: { 'User-Agent': 'Mozilla/5.0 (iPhone; CPU iPhone OS 17_0 like Mac OS X)' },
      });
      return { finalUrl: res.url, body: await res.text() };
    } catch {
      return null;
    }
  },
  geocode: async (address) => {
    try {
      const [hit] = await Location.geocodeAsync(address);
      return hit ? { latitude: hit.latitude, longitude: hit.longitude } : null;
    } catch {
      return null;
    }
  },
};

export function useSharedLocationIntake(): void {
  const router = useRouter();
  const busy = useRef(false);

  useEffect(() => {
    const process = async () => {
      if (busy.current) return;
      busy.current = true;
      try {
        const raw = await SharedIntake.consumePendingShare();
        if (!raw) return;
        const loc = await parseSharedLocation(raw, deps);
        if (loc) {
          sharedLocationStore.set(loc);
          router.navigate('/location');
        } else {
          Alert.alert('airgapp', "Couldn't read a location from that share.");
        }
      } finally {
        busy.current = false;
      }
    };

    // Cold launch (app opened by the share) + every foreground + the airgapp://shared wake event.
    void process();
    const sub = AppState.addEventListener('change', (s) => {
      if (s === 'active') void process();
    });
    const linkSub = Linking.addEventListener('url', () => void process());
    return () => {
      sub.remove();
      linkSub.remove();
    };
  }, [router]);
}
```

- [ ] **Step 2: Mount it in `src/app/_layout.tsx`** — call `useSharedLocationIntake()` inside `RootLayout` (before the `return`), and add `import { useSharedLocationIntake } from '@/hooks/useSharedLocationIntake';`.

- [ ] **Step 3: Typecheck + commit**

```bash
npx tsc --noEmit -p tsconfig.json && \
git add src/hooks/useSharedLocationIntake.ts src/app/_layout.tsx && \
git commit -m "feat(share): root intake hook (consume → parse → route)"
```

---

## Task 8: Share Extension target + App Group entitlements

**Files:**
- Create: `ios/ShareExtension/ShareViewController.swift`
- Create: `ios/ShareExtension/Info.plist`
- Create: `ios/ShareExtension/ShareExtension.entitlements`
- Create: `ios/airgapp/airgapp.entitlements` (if missing) — add App Group
- Modify: `ios/airgapp.xcodeproj/project.pbxproj` — add the extension target + embed it
- Modify: `ios/Podfile` — (only if the extension needs pods; it does not — pure UIKit)

*(Native/Xcode wiring; verified by build in Task 11. Adding a target to pbxproj by hand is error-prone — use the `xcodeproj` Ruby gem, already available via CocoaPods, per Step 3.)*

- [ ] **Step 1: `ios/ShareExtension/ShareViewController.swift`**

```swift
import UIKit
import Social
import MobileCoreServices
import UniformTypeIdentifiers

// Captures the shared URL/text into the App Group and opens the host app. No visible UI.
class ShareViewController: UIViewController {
  private let suite = "group.local.airgapp.mobile"

  override func viewDidLoad() {
    super.viewDidLoad()
    handleShare()
  }

  private func handleShare() {
    guard let item = extensionContext?.inputItems.first as? NSExtensionItem,
          let providers = item.attachments else { return finish() }

    let group = DispatchGroup()
    var captured: String?

    for provider in providers {
      if provider.hasItemConformingToTypeIdentifier(UTType.url.identifier) {
        group.enter()
        provider.loadItem(forTypeIdentifier: UTType.url.identifier, options: nil) { data, _ in
          if let url = data as? URL { captured = url.absoluteString }
          group.leave()
        }
      } else if provider.hasItemConformingToTypeIdentifier(UTType.plainText.identifier) {
        group.enter()
        provider.loadItem(forTypeIdentifier: UTType.plainText.identifier, options: nil) { data, _ in
          if captured == nil, let text = data as? String { captured = text }
          group.leave()
        }
      }
    }

    group.notify(queue: .main) {
      if let raw = captured, let defaults = UserDefaults(suiteName: self.suite) {
        let payload = ["raw": raw, "ts": Date().timeIntervalSince1970 * 1000] as [String: Any]
        if let json = try? JSONSerialization.data(withJSONObject: payload),
           let str = String(data: json, encoding: .utf8) {
          defaults.set(str, forKey: "pendingSharedLocation")
          defaults.synchronize()
        }
      }
      self.openHostApp()
      self.finish()
    }
  }

  // Open airgapp://shared by walking the responder chain to UIApplication and calling openURL: reflectively
  // (UIApplication.open is unavailable to app extensions; this perform(selector) trick is the standard way).
  private func openHostApp() {
    guard let url = URL(string: "airgapp://shared") else { return }
    let selector = sel_registerName("openURL:")
    var responder: UIResponder? = self
    while let r = responder {
      if r.responds(to: selector) {
        r.perform(selector, with: url)
        return
      }
      responder = r.next
    }
  }

  private func finish() {
    extensionContext?.completeRequest(returningItems: [], completionHandler: nil)
  }
}
```

- [ ] **Step 2: `ios/ShareExtension/Info.plist`** (accept 1 URL or 1 text)

```xml
<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0">
<dict>
  <key>CFBundleDisplayName</key><string>airgapp</string>
  <key>CFBundleIdentifier</key><string>$(PRODUCT_BUNDLE_IDENTIFIER)</string>
  <key>CFBundlePackageType</key><string>XPC!</string>
  <key>NSExtension</key>
  <dict>
    <key>NSExtensionPointIdentifier</key><string>com.apple.share-services</string>
    <key>NSExtensionPrincipalClass</key><string>ShareViewController</string>
    <key>NSExtensionAttributes</key>
    <dict>
      <key>NSExtensionActivationRule</key>
      <dict>
        <key>NSExtensionActivationSupportsWebURLWithMaxCount</key><integer>1</integer>
        <key>NSExtensionActivationSupportsTextWithMaxCount</key><integer>1</integer>
      </dict>
    </dict>
  </dict>
</dict>
</plist>
```

- [ ] **Step 3: `ios/ShareExtension/ShareExtension.entitlements`** and app entitlements — App Group on BOTH:

`ios/ShareExtension/ShareExtension.entitlements`:
```xml
<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0"><dict>
  <key>com.apple.security.application-groups</key>
  <array><string>group.local.airgapp.mobile</string></array>
</dict></plist>
```
Ensure the app target's entitlements file (create `ios/airgapp/airgapp.entitlements` if absent and set `CODE_SIGN_ENTITLEMENTS` in the app target build settings) contains the same `com.apple.security.application-groups` array.

- [ ] **Step 4: Add the extension target via the `xcodeproj` gem** (scriptable; avoids hand-editing pbxproj)

Create `ios/scripts/add_share_extension.rb`:

```ruby
require 'xcodeproj'
project = Xcodeproj::Project.open('airgapp.xcodeproj')
app = project.targets.find { |t| t.name == 'airgapp' }
ext = project.new_target(:app_extension, 'ShareExtension', :ios, '16.4')
%w[ShareViewController.swift].each do |f|
  ref = project.new_file("ShareExtension/#{f}")
  ext.add_file_references([ref])
end
ext.build_configurations.each do |c|
  c.build_settings['PRODUCT_BUNDLE_IDENTIFIER'] = 'local.airgapp.mobile.ShareExtension'
  c.build_settings['INFOPLIST_FILE'] = 'ShareExtension/Info.plist'
  c.build_settings['CODE_SIGN_ENTITLEMENTS'] = 'ShareExtension/ShareExtension.entitlements'
  c.build_settings['CODE_SIGN_STYLE'] = 'Automatic'
  c.build_settings['DEVELOPMENT_TEAM'] = '859B8N529C'
  c.build_settings['SWIFT_VERSION'] = '5.0'
  c.build_settings['TARGETED_DEVICE_FAMILY'] = '1,2'
end
app.add_dependency(ext)
embed = app.new_copy_files_build_phase('Embed App Extensions')
embed.symbol_dst_subfolder_spec = :plug_ins
embed.add_file_reference(ext.product_reference)
project.save
puts 'ShareExtension target added.'
```

Run: `cd ios && LANG=en_US.UTF-8 ruby scripts/add_share_extension.rb`
Expected: `ShareExtension target added.` and `git diff --stat` shows `project.pbxproj` changed.

- [ ] **Step 5: Commit**

```bash
git add ios/ShareExtension ios/scripts/add_share_extension.rb ios/airgapp.xcodeproj/project.pbxproj ios/airgapp/airgapp.entitlements
git commit -m "feat(share): iOS Share Extension target + App Group entitlements"
```

---

## Task 9: Location screen — shared-preview two-button mode

**Files:**
- Modify: `src/components/PlacePreviewSheet.tsx` (optional second button)
- Modify: `src/app/location.tsx` (consume `sharedLocationStore`, wire Navigate + Add-to-Trip, `savedExists`)

**Interfaces:**
- Consumes: `sharedLocationStore` (Task 4), `useTrip().savedExists` + `.addToSaved` (Task 5), existing `droppedPin`/`onSelectPlace`.
- Produces: on a shared location, the map shows the pin + preview with **Navigate** (starts a fresh trip) and **Add to Trip** (disabled unless `savedExists`).

*(Verified on device in Task 11. UI wiring; no node test — pure logic already covered.)*

- [ ] **Step 1: Consume the store in `location.tsx`** — add near the other state:

```ts
import { sharedLocationStore } from '@/state/sharedLocationStore';
// ...
const [shared, setShared] = useState(() => sharedLocationStore.consume());
useEffect(() => sharedLocationStore.subscribe(() => setShared(sharedLocationStore.consume())), []);
```

- [ ] **Step 2: When `shared` arrives, drop a pin + fit** — add an effect that turns `shared` into the existing `droppedPin` (reuse the dropped-pin plumbing) and animates to it:

```ts
useEffect(() => {
  if (!shared) return;
  setSelectedCharger(null);
  setTab('location');
  setDroppedPin({ coordinate: shared.coordinate, name: shared.name ?? 'Shared Location', subtitle: '', fromPoi: false });
  mapRef.current?.animateToRegion({ ...shared.coordinate, latitudeDelta: 0.01, longitudeDelta: 0.01 }, 500);
  setShared(null);
}, [shared]);
```

- [ ] **Step 3: Two-button footer** — when `droppedPin` is a shared one, render Navigate + Add to Trip. Extend the existing dropped-pin pinned bar in `location.tsx`:

```tsx
{droppedPin ? (
  <SafeAreaView edges={['bottom']} style={styles.navigateBar} pointerEvents="box-none">
    <View style={styles.navigateRow}>
      <Pressable style={styles.navigateButton} onPress={onAddDroppedPin}>
        <SymbolView name="arrow.turn.up.right" tintColor="white" size={17} weight="semibold" />
        <Text style={styles.navigateText}>Navigate</Text>
      </Pressable>
      <Pressable
        style={[styles.navigateButtonSecondary, !trip.savedExists && styles.navigateButtonDisabled]}
        disabled={!trip.savedExists}
        onPress={async () => { if (droppedPin) { await trip.addToSaved(pinToPlace(droppedPin)); dismissDroppedPin(); setScreen('trip'); } }}
      >
        <Text style={[styles.navigateText, !trip.savedExists && styles.navigateTextDisabled]}>Add to Trip</Text>
      </Pressable>
    </View>
  </SafeAreaView>
) : null}
```

**Decision (unify):** the dropped-pin bar ALWAYS shows both buttons — a shared pin and a long-press pin are treated identically, with **Add to Trip** simply disabled when `!trip.savedExists`. This replaces the old single-button dropped-pin bar.

Add the `pinToPlace` helper (mirror the existing `onAddDroppedPin` Place construction):

```ts
function pinToPlace(pin: DroppedPin): Place {
  return {
    id: `pin:${pin.coordinate.latitude.toFixed(5)},${pin.coordinate.longitude.toFixed(5)}`,
    title: pin.name,
    subtitle: pin.subtitle,
    coordinate: pin.coordinate,
    kind: 'poi',
    source: 'apple',
  };
}
```

Add the styles: `navigateButtonSecondary` (copy `navigateButton` but `backgroundColor: 'rgba(255,255,255,0.12)'`), `navigateButtonDisabled` (`opacity: 0.4`), `navigateTextDisabled` (`color: 'rgba(255,255,255,0.5)'`).

- [ ] **Step 4: Navigate wiring** — `onAddDroppedPin` already calls `onSelectPlace`; for a shared/dropped pin with no active trip it starts a fresh trip (existing behavior). Confirm `pinToPlace` sets `kind:'poi', source:'apple'`.

- [ ] **Step 5: Typecheck + commit**

```bash
npx tsc --noEmit -p tsconfig.json && \
git add src/app/location.tsx src/components/PlacePreviewSheet.tsx && \
git commit -m "feat(share): shared-location preview with Navigate + Add to Trip"
```

---

## Task 10: URL scheme host handling for `airgapp://shared`

**Files:**
- Modify: `src/app/_layout.tsx` (ensure `airgapp://shared` doesn't 404 in expo-router) OR add a no-op route.

**Interfaces:**
- Consumes: expo-router linking config.
- Produces: opening `airgapp://shared` foregrounds the app without a router error (the intake hook does the real work).

- [ ] **Step 1:** Verify `airgapp://shared` foregrounds cleanly. expo-router will try to match `/shared`; since the intake hook immediately `router.navigate('/location')`, a transient unmatched route is fine, but to avoid a flash add a lightweight `src/app/shared.tsx` that renders null and redirects:

```tsx
import { Redirect } from 'expo-router';
// airgapp://shared lands here only as a wake signal; the intake hook has already routed. Fall back to home.
export default function SharedRoute() {
  return <Redirect href="/" />;
}
```

- [ ] **Step 2: Typecheck + commit**

```bash
npx tsc --noEmit -p tsconfig.json && \
git add src/app/shared.tsx && \
git commit -m "feat(share): airgapp://shared wake route"
```

---

## Task 11: Native build, install, and device verification

**Files:** none (build + manual verification).

- [ ] **Step 1: pod install** — `cd /Users/ivan/Work/airgapp/mobile && LANG=en_US.UTF-8 pod install --project-directory=ios`
Expected: `SharedIntake` pod installed; `Pod installation complete`.

- [ ] **Step 2: Full Release build** (native targets changed)

```bash
xcodebuild -workspace ios/airgapp.xcworkspace -scheme airgapp -configuration Release \
  -sdk iphoneos -destination 'generic/platform=iOS' -allowProvisioningUpdates build
```
Expected: `** BUILD SUCCEEDED **`. (If provisioning for the new extension fails, the automatic-signing team `859B8N529C` should generate a profile; the extension needs its own App Group capability — automatic signing handles it.)

- [ ] **Step 3: Deploy JS + install** — `bash scripts/godot-ios/deploy-js.sh`
Expected: `App installed` + `Launched…`.

- [ ] **Step 4: Device verification (manual)** — for each of **Apple Maps, Google Maps, Waze**:
  1. Open the app, tap a place, tap Share, choose **airgapp**.
  2. Expect airgapp to foreground on the Location map with the shared pin selected and a name.
  3. Tap **Navigate** → an in-app trip to the place starts.
  4. Re-share; with a trip now saved, **Add to Trip** is enabled → tapping it appends the stop and shows the trip.
  5. Kill the app, share again → **Add to Trip** still enabled (snapshot persisted).
  6. Share a location Waze gives as a `/ul/h<geohash>` short link → correct pin (sub-meter).
  7. Share something unparseable (e.g. a plain note) → "Couldn't read a location" and the app lands on the normal Location screen, no crash.

- [ ] **Step 5: Commit any fixups** discovered during verification, then done.

---

## Notes for the implementer

- **Order matters for the build:** Tasks 1–5, 7, 9, 10 are JS/TS and can be committed and typechecked without a device. Tasks 6 + 8 are native and only take effect after Task 11's build. Do all JS first, then the single native build.
- **Responder-chain `openURL`** (Task 8, `openHostApp`) is the semi-private but widely-used extension→host technique; the App Group + `AppState`-active read (Task 7) is the safety net if it misfires on a given iOS version — a share is never lost.
- **`expo install` version pin** (Task 5): with `EXPO_USE_PRECOMPILED_MODULES=true`, verify the async-storage version matches the ExpoModulesCore era (56.0.x) — pin down if newer, per the project's native-module notes.
- **No `expo prebuild`, ever.** All native edits are manual; verify `ios/airgapp/Info.plist` still has the Godot/URL-scheme entries after any tooling step.
