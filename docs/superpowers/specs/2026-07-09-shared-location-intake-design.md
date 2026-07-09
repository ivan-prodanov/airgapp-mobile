# Shared-Location Intake — Design Spec

**Date:** 2026-07-09
**Status:** Approved design (pending final spec review)

## Goal

Let a user share a location from **Apple Maps, Google Maps, or Waze** via the iOS Share Sheet and pick **airgapp**. The app opens the Location map with that place previewed (like a dropped pin selected by the user), offering two actions:

1. **Navigate** — start an in-app trip to the shared place (same as today's pin-preview Navigate).
2. **Add to Trip** — append it as a stop to the **last saved trip**; disabled when no trip exists.

## Approach (chosen: A — thin extension, parse in JS)

```
Maps/Waze  →  iOS Share Sheet  →  "airgapp" (Share Extension, native)
   → extension writes { raw, ts } to App Group + opens airgapp://shared
   → JS intake hook consumes the App Group payload (on the deep-link event / on foreground / cold launch)
   → services/sharedLocation parser → { coordinate, name?, source }
   → Location screen shows the shared pin + preview sheet
   → [ Navigate ]   [ Add to Trip ]   (Add to Trip disabled if no saved trip)
```

The native extension stays deliberately dumb (capture + hand-off). All parsing / network / geocoding is plain, unit-tested JS.

---

## Components

### 1. Share Extension — `ios/ShareExtension/` (native, thin)

- **New Xcode target** added manually to `airgapp.xcodeproj` (NO `expo prebuild` — `ios/` is hand-maintained and embeds Godot).
- **Activation rule** (`NSExtensionActivationRule` in the extension `Info.plist`): accept **exactly 1 URL** OR **1 plain-text** item (`NSExtensionActivationSupportsWebURLWithMaxCount = 1`, `...TextWithMaxCount = 1`). Maps shares arrive as a URL (sometimes "Label\nURL" text).
- **`ShareViewController.swift`** (no visible UI): on `viewDidLoad`, pull the shared item via `NSItemProvider.loadItem(forTypeIdentifier: public.url / public.plain-text)`, coerce to a string, write `{ raw, ts }` (JSON) to the App Group, open `airgapp://shared` via the responder-chain `openURL` technique, then `extensionContext.completeRequest`.
- **App Group entitlement** `group.local.airgapp.mobile` on **both** the app target and the extension target.

### 2. App Group data channel + `modules/shared-intake` (native read)

- Shared `UserDefaults(suiteName: "group.local.airgapp.mobile")`, key `pendingSharedLocation` = `{ raw: string, ts: number }`.
- **Local Expo module `modules/shared-intake`** (Swift) — follows the existing `modules/expo-apple-search` pattern already in the repo. One method:
  - `consumePendingShare(): Promise<string | null>` — **atomically** (single native call) reads the key, **clears it**, and returns `raw` (or null). The read+delete being atomic on the native side means the two intake triggers below (deep-link event *and* `AppState`-active, which fire near-simultaneously) can't both get the same payload — the first wins, the second gets null. Clearing also makes intake fire-once (re-foregrounding won't re-open a stale share).
- Why App Group + a native reader rather than encoding data in the deep-link URL: the App Group survives even if the extension's `openURL` hand-off is delayed or dropped — the app re-reads it on every foreground, so a share is never lost. (The `airgapp://shared` URL is only a wake signal; it carries no data.)

### 3. Parser — `services/sharedLocation.ts` (pure JS, unit-tested)

```ts
export interface SharedLocation {
  coordinate: LatLng;          // validated
  name?: string;               // display label only (sanitized)
  source: 'apple' | 'google' | 'waze' | 'unknown';
}
export function parseSharedLocation(raw: string): Promise<SharedLocation | null>;
```

Pipeline:

1. **Extract the first URL** from `raw` (shares can be `"<Label>\n<URL>"`); keep the label as a fallback name.
2. **Normalize host**: `http→https`; Waze `waze.com` / `ul.waze.com` → `www.waze.com` (path/query preserved).
3. **Branch by host** and extract in trust order (see the extraction table below).
4. **Short links** (`maps.app.goo.gl`, `goo.gl/maps`, `g.co/kgs`): resolve — `fetch(url)` with a browser/mobile `User-Agent`, let RN follow the 30x chain, then re-run the extractors over **both** `response.url` **and** `response.text()` (some links land on a consent interstitial that carries coords only in the HTML body). `redirect:'manual'` is unreliable in RN — just GET and read the final URL.
5. **Validate**: `lat ∈ [-90,90]`, `lng ∈ [-180,180]`, reject `NaN`/`0,0`; if the parsed "latitude" is out of range but "longitude" is a valid latitude, **swap** (old third-party links sometimes reversed order).
6. **Fallback geocode**: no coords but an address/name string → `expo-location.geocodeAsync` → first result.
7. Return `null` if nothing usable.

Helper `decodeGeohash(hash): LatLng` (~30 lines, Niemeyer base32, alphabet `0123456789bcdefghjkmnpqrstuvwxyz`, even-index bits refine longitude, odd-index bits refine latitude, result = cell-center midpoint) for Waze `/ul/h<hash>`.

#### Extraction table (validated by research)

| App | Pattern | Extract |
|---|---|---|
| Apple | `maps.apple.com/?ll=LAT,LNG` (legacy; also `&q= &address= &auid= &lsp=9902`) | **trust `ll`** (lat,lng); name = `q` unless `q` matches `lat,lng`. |
| Apple | `maps.apple.com/place?...&ll=LAT,LNG` (legacy `/place`) | same as legacy — on any `/place` URL check **both** `ll` and `coordinate`. |
| Apple | `maps.apple.com/place?coordinate=LAT,LNG[&name=]` (unified, WWDC24) | **trust `coordinate`**; `name` cosmetic. |
| Apple | `?place-id=I…` / `?q=NAME` / `address=` only | **no coords** — geocode `address`, else name-only / fail. Never fabricate. |
| Google | `.../place/NAME/@LAT,LNG,Zz/data=…!3dLAT!4dLNG` | **prefer `!3d(lat)!4d(lng)`** (the pin); `@lat,lng` is the **camera** — fallback only; name = `/place/<NAME>`. |
| Google | `.../maps/@LAT,LNG,Zz` (dropped pin) | `@lat,lng`; no name. |
| Google | `?q= / query= / ll=` VALUE | if value is `lat,lng` → pin; else name-only. `center=` = viewport (ignore). |
| Google | `maps.app.goo.gl/… • goo.gl/maps/… • g.co/kgs/…` | **resolve** (step 4). |
| Google | `?cid= • !1s0x…:0x… • ?q=place_id:ChIJ…` | identifiers, **no coords** (needs Google API — out of scope) → name-only / fail. |
| Waze | `waze.com/ul?ll=LAT,LNG` • `waze://?ll=` | URL-decode `%2C`, `ll` literal lat,lng. |
| Waze | `waze.com/ul/h<GEOHASH>` | strip **one** leading `h`, `decodeGeohash` the rest (~10 chars ≈ sub-meter). |
| Waze | `waze.com/live-map/directions?to=ll.LAT%2CLNG` | `to=` value, strip `ll.`, decode `%2C`; **`from=` is the origin, not the pin**. |

**Cross-cutting gotchas baked into the parser:** always URL-decode before splitting on comma; treat `q`/`query`/`name` as a label unless it regex-matches a decimal `lat,lng`; never read the pin from Apple `sll`/`center`, Google `@`/`center`, or Waze `from`; identifier-only shares must fail cleanly (name-only), never return `0,0`.

### 4. Intake hook — `hooks/useSharedLocationIntake.ts`

Mounted once at the root (`app/_layout.tsx`). Triggers a **consume** on: the `airgapp://shared` `Linking` `url` event, `Linking.getInitialURL()` (cold launch), and `AppState` → `active`. On trigger:

```
const raw = await SharedIntake.consumePendingShare();
if (!raw) return;
const loc = await parseSharedLocation(raw);
if (loc) sharedLocationStore.set(loc); router.navigate('/location');
else notify("Couldn't read a location from that share");
```

`sharedLocationStore` = a tiny module-level store (subscribe/get/set) the Location screen reads on mount (route params can't carry the object cleanly across the deep-link path). The Location screen consumes it once → sets the previewed pin + fits the map.

### 5. Trip persistence — last-trip **snapshot** (per approved §5)

- Add `@react-native-async-storage/async-storage` (pod) and make it the real `AppStorage` backend behind the existing `state/persistence.ts` seam (replaces `memoryBackend`).
- Whenever the active trip changes, **debounce-save a `lastTrip` snapshot** to storage. **Do not auto-restore** it into the running session — a normal launch stays clean (no stale route drawn on the map).
- `hasSavedTrip = (active trip exists) || (lastTrip snapshot exists)`.
- **Add to Trip** targets the **active** trip if one is in progress, else **loads the snapshot** (makes it active) and appends the shared stop; then shows the trip. Disabled only when `!hasSavedTrip`.

### 6. Preview UI — shared mode

- The shared location renders as an Apple-style dropped `Marker` at its coordinate; the Location screen opens `PlacePreviewSheet` for it.
- Extend the preview footer to a **shared mode with two buttons**: **Navigate** (blue, primary) + **Add to Trip** (secondary; disabled + dimmed when `!hasSavedTrip`), reusing the existing pinned-bottom-bar structure.
- **Navigate** → start a **fresh single-destination trip** to the shared place (`trip.start(carCoord, place)`), **replacing** any in-progress trip. (Common case is a cold launch with no active trip anyway. This is what keeps Navigate distinct from Add to Trip when a trip *is* active.) **Add to Trip** → append the shared stop to the active-or-restored trip.
- Reuse the existing dropped-pin plumbing (`droppedPin` + reverse-geocode for a nicer name when the share had none).

### 7. Error handling & safety

- Unparseable / no-coords / network failure → a brief "Couldn't read a location from that share" message, landing on the normal Location screen. **Never crash.**
- The shared string is **untrusted external input**: only extract coordinates + a display label (sanitized text). Never auto-open, execute, or follow arbitrary URLs from it beyond the controlled short-link resolution to the known map hosts.
- **Fire-once**: `consumePendingShare` clears the key, so foreground/relaunch cycles don't re-open a stale share.
- Coordinate validation (range + swap + NaN/`0,0` reject) as the final safety net.

### 8. Testing

- **`services/sharedLocation.test.ts`** (node, pure logic): fixtures for every row of the extraction table — Apple legacy `ll` / unified `coordinate` / legacy `/place` / place-id-only / address-only; Google `!3d!4d` / `@` / `q=lat,lng` / short-link (mocked `fetch` returning a resolved URL + body) / `cid`; Waze `ll` / `to=ll.` / geohash / `from=` (must be ignored) — plus malformed input, `q`-is-a-name, and pin-vs-camera cases.
- **`decodeGeohash` unit tests** with known vectors: `ezs42 → 42.605,-5.603`; `dr5ru7vtv2 → 40.7588938,-73.985136`.
- **Manual device pass**: share a place from Apple Maps, Google Maps, and Waze → app opens → correct pin + label → Navigate and Add to Trip both behave (Add to Trip disabled with no saved trip, enabled after a trip exists).

---

## Build & rollout

- One full **`xcodebuild` Release**: the Share Extension target + App Group entitlement + `modules/shared-intake` + the AsyncStorage pod all land together (`expo install async-storage` → manual Info.plist/entitlement edits → `pod install` → `xcodebuild`). After that, JS iterations deploy via `deploy-js.sh`.

## File structure

- `ios/ShareExtension/` — extension target (`ShareViewController.swift`, `Info.plist`, entitlements). *(new, native)*
- `modules/shared-intake/` — Expo module: `consumePendingShare`. *(new, native)*
- `services/sharedLocation.ts` + `services/sharedLocation.test.ts` — parser + geohash decoder. *(new, JS)*
- `hooks/useSharedLocationIntake.ts` — root intake hook. *(new, JS)*
- `state/sharedLocationStore.ts` — hand-off store. *(new, JS)*
- `state/persistence.ts` — swap in the AsyncStorage backend. *(modify)*
- `state/useTrip.ts` (+ trip persistence) — snapshot save/load, `hasSavedTrip`. *(modify)*
- `components/PlacePreviewSheet.tsx` + `app/location.tsx` — shared two-button mode, consume `sharedLocationStore`. *(modify)*
- `app/_layout.tsx` — mount `useSharedLocationIntake`. *(modify)*
- App entitlements + `app.json`/Info.plist — App Group, scheme already present. *(modify)*

## Open risks

- **Responder-chain `openURL` from an extension** is a standard-but-semi-private technique; the App-Group + `AppState`-active read is the fallback so a share is never stranded even if it misfires.
- **Short-link resolution needs network**; offline → graceful "couldn't read" fail.
- **Google identifier-only shares** (`place_id`/`cid`/`ftid`) carry no coordinates without a Google API key (out of scope) → name-only / fail cleanly. In practice Google's share short-links resolve to a URL with `!3d!4d` coords, so this is an edge case.
