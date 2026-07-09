# Shared-Location Share-Extension Popup — Design

**Date:** 2026-07-09
**Status:** Approved (brainstorm) → ready for plan
**Predecessor:** `2026-07-09-shared-location-intake-design.md` (the headless capture → app-preview flow this replaces on the share side)

## Goal

When a user shares a location to airgapp (Apple Maps / Google Maps / Waze), the Share Extension shows a **native popup card** — a map + an Apple-Maps-style place panel + two buttons, **Navigate** and **Add to Trip** — instead of the current blank capture-and-dismiss card. The chosen action is queued to the App Group and applied by the app on its next foreground. This is the standard iOS "share to Notes/Mail" mental model: you stay in the sharing app; airgapp reflects the choice when next opened.

## Non-goals (explicitly deferred)

- **The real signed send.** "Send to Car" is a mock no-op today (`onPress={() => {}}` at `location.tsx`). The eventual command channel (Keychain-signed command → BLE, HTTPS fallback) is a **separate future project**. This design leaves a clean native seam for it but ships the queue-to-app behavior now.
- **No RN in the extension.** The app embeds Godot + react-native-maps + expo-sqlite; loading that in an app extension would blow the extension memory ceiling. The popup is **pure UIKit/MapKit**, pod-free (as the extension already is).

## Global Constraints

- **Never run `expo prebuild`** — `ios/` is hand-maintained and embeds Godot. Native target/file additions go through the `xcodeproj` gem (`ios/scripts/`), following [[native-module-add-no-prebuild]].
- **Tesla/car must never reach real Tesla servers** — the future send targets the user's own car/RPi only; not in scope here, but the seam must not hardcode any Tesla endpoint.
- **`ios/` is gitignored** — the extension + entitlements + scripts live outside VCS; only `modules/` and `src/` changes are committed.
- **App Group** `group.local.airgapp.mobile` is the sole cross-process channel (already entitled on both app + extension).
- **Signing** team `859B8N529C`, automatic, free 7-day profile; `CFBundleExecutable=$(EXECUTABLE_NAME)` must stay in the extension Info.plist.
- Bundle id `local.airgapp.mobile`; device `F3867E6E-E95F-5B2A-9C4E-06D1D72475A1`.

## Architecture

```
Share: Apple map-item | Google goo.gl | Waze URL | text
        │
        ▼  ShareViewController (native popup, UIKit + MapKit)
        │    ├─ SharedLocationResolver.swift  ── NEW: the JS parser, ported to Swift
        │    │      resolve(mapItem) or resolve(raw) → { coordinate, name?, address?, source }
        │    │      (Apple map-item instant; goo.gl unwrap via URLSession; MKLocalSearch geocode;
        │    │       Waze geohash; CLGeocoder reverse-geocode for the address line)
        │    ├─ renders: MKMapView (top) + place panel (name/address) + [Navigate] [Add to Trip]
        │    │      "Add to Trip" disabled unless the App Group says a saved trip exists
        │    └─ on tap → write intent to App Group → completeRequest (dismiss; stay in sharing app)
        ▼
App Group UserDefaults key `pendingSharedIntent`:
     { location:{ lat, lng, name?, address?, source }, action:"navigate"|"addToTrip", ts }
        ▼  App foreground (cold launch / AppState active / url event)
        │    SharedIntake.consumeSharedIntent() → returns the resolved intent JSON (NO JS resolve)
        ▼  useSharedLocationIntake applies the action via the Location screen:
     navigate  → trip.start(car, place)   → Trip view
     addToTrip → trip.addToSaved(place)    → Trip view
```

Resolution runs **once, in the extension** (it needs resolved data to draw the card anyway); the app consumes an already-resolved intent. The JS resolver is retired from the runtime path.

---

## Component 1 — `SharedLocationResolver` (new native Swift, in the extension target)

A faithful port of `src/services/sharedLocation.ts`. Pure Foundation + MapKit + CoreLocation (no pods). Two entry points:

```swift
enum ShareSource: String { case apple, google, waze, unknown }
struct ResolvedLocation {
  let coordinate: CLLocationCoordinate2D
  let name: String?
  let address: String?
  let source: ShareSource
}

enum SharedLocationResolver {
  // Apple share hands us a full MKMapItem — richest path (name + coordinate + postalAddress), no network.
  static func resolve(mapItem: MKMapItem, completion: @escaping (ResolvedLocation?) -> Void)
  // URL or text share — mirrors parseSharedLocation(): sync extract, then goo.gl unwrap + geocode as needed.
  static func resolve(raw: String, completion: @escaping (ResolvedLocation?) -> Void)
}
```

Behavior to port (each maps to an existing `sharedLocation.ts` unit-test vector — those vectors ARE this component's acceptance spec):

| Input | Expected | JS test that pins it |
|---|---|---|
| `maps.apple.com/?ll=41.890221,12.492317&q=Colosseum` | coord=(41.89,12.49), name="Colosseum" | "apple legacy ll= is the pin" |
| `maps.apple.com/place?coordinate=40.864791,-73.931723&name=My%20Place` | coord + name="My Place" | "apple unified /place coordinate=" |
| `maps.apple.com/?q=pizza&sll=...` | no coord (sll≠pin), name="pizza" | "apple ignores sll" |
| `maps.apple.com/place?place-id=...` | no coord, no fabricated name | "apple place-id-only" |
| `google.com/maps/place/Eiffel+Tower/@48.85,2.29,17z/data=!3d48.8582602!4d2.2944991` | coord=!3d!4d (48.8582602,2.2944991), name="Eiffel Tower" | "google prefers !3d!4d over @camera" |
| `google.com/maps/@52.520008,13.404954,15z` | coord=@camera fallback | "google @camera fallback" |
| `maps.google.com/?q=48.8584,2.2945` | coord from q= | "google q=lat,lng" |
| `waze.com/ul?ll=40.75889500%2C-73.98513100` | coord, source=waze | "waze ll=" |
| `waze.com/live-map/directions?to=ll.40.7589,-73.9851&from=...` | coord from `to=ll.`, ignores `from=` | "waze to=ll." |
| `waze.com/ul/hdr5ru7vtv2` | geohash decode → (40.7589,...) | "waze /ul/h<geohash>" |
| geohash `dr5ru7vtv2` | (40.7588938,-73.985136) | "decodeGeohash Times Square" |
| stray `%` in URL / place name | never throws | "never throws on stray %" (×2) |
| non-map URL | nil | "non-map url → null" |
| `consent.google.com/ml?continue=<maps url with q=Name>` | unwrap `continue`, name→address | "unwraps google consent continue param" |
| goo.gl short link (deps.resolveUrl) → `!3d!4d` | resolve then extract | "resolves a google short link" |
| goo.gl → consent body carries `!3d!4d`/`@` | extract from body | "coords only in the HTML body" |
| goo.gl → consent wall, name only | geocode the name (MKLocalSearch) | "geocode the place name" |
| `maps.apple/p/<id>` short link → `coordinate=` | resolve then extract | "resolves Apple maps.apple/p" |

Native specifics that differ from JS (built-in instead of injected deps):
- **`resolveUrl`** = `URLSession` GET, `redirect: follow`, headers `User-Agent: Mozilla/5.0 (iPhone…)` + `Cookie: CONSENT=YES+cb; SOCS=CAISNQgDEitib3E` (the consent-bypass cookie), **8 s timeout**. Return `(finalUrl, body)`.
- **`geocode(name)`** = `MKLocalSearch` with an all-numeric region biased to the last-known location (default Sofia `42.7,23.32`, `span 30×30`), **8 s timeout**. (Same MKLocalSearch the app's `expo-apple-search` module uses — no `[String:Double]` cast pitfall here since it's straight Swift.)
- **`address`** = if the resolver has a coordinate but no street address, **reverse-geocode** via `CLGeocoder` to populate the panel's secondary line. (New vs. JS, which only ever surfaced `name`.)
- Short-link set (`SHORT_LINK_RE`): `maps.app.goo.gl | goo.gl/maps | g.co/kgs | maps.apple/p`. `firstUrl` = first `https?://…` in the text. `validCoord` = swap-if-reversed / reject out-of-range / reject (0,0). All ported verbatim.

**Retirement:** `src/services/sharedLocation.ts` + its node test stay in-tree as the reference oracle. The native resolver becomes the **primary** runtime path; the JS parser is demoted to the degraded raw-fallback only (Error handling), then physically deleted **only after** the native resolver is verified on-device against every row above (at which point the fallback goes too).

---

## Component 2 — Popup UI (`ShareViewController`, native UIKit)

Replaces the headless capture flow. Presented as the standard share-sheet card.

**Layout ("as if Apple Maps"):**
- **Top ~55%:** `MKMapView`, non-interactive-scroll optional, centered on the pin with one `MKPointAnnotation`. (A static `MKMapSnapshotter` image is an acceptable substitute if a live map proves heavy — decided in the plan.)
- **Bottom panel** (rounded, system background):
  - **Name** — headline weight (falls back to "Shared Location" if the resolver returned none).
  - **Address** — secondary label (from placemark / reverse-geocode; hidden if empty).
  - Optional muted third line: source ("Google Maps") or `lat, lng`.
  - **Buttons row:** **Navigate** (filled, system blue, primary) and **Add to Trip** (tinted/secondary). **Add to Trip is disabled** when the App Group flag `savedTripExists` is false/absent.
- **States:** while a Google link resolves over the network → a brief spinner/skeleton in the panel, then fill in. On resolve failure/timeout → name="Shared Location", map hidden or zoomed-out world, buttons still function (the app re-resolves defensively via the queued raw fallback — see Error handling).

**Interaction:**
- **Navigate** tap → write intent `{location, action:"navigate", ts}` → `completeRequest`.
- **Add to Trip** tap → write intent `{…, action:"addToTrip"}` → `completeRequest`.
- **Cancel** (swipe-down / Cancel affordance) → `completeRequest` with nothing written.
- `openHostApp()` (the responder-chain `openURL:` best-effort) is **removed** — it never worked on iOS 26 and the popup is intentionally fire-and-forget.

---

## Component 3 — App Group data contract

Two keys in `UserDefaults(suiteName: group.local.airgapp.mobile)`:

1. **`pendingSharedIntent`** (written by extension, read+cleared by app) — replaces the old `pendingSharedLocation` `{raw,ts}` payload:
   ```json
   { "location": { "lat": 41.89, "lng": 12.49, "name": "Colosseum",
                   "address": "Piazza del Colosseo, Roma", "source": "apple" },
     "action": "navigate", "raw": "<original share string>", "ts": 1752000000000 }
   ```
   `location` may be null-coordinate when the extension couldn't resolve (offline / goo.gl timeout); `raw` is always included so the app can re-resolve defensively (see Error handling). The reader ignores/clears any stale `pendingSharedLocation` key.

2. **`savedTripExists`** (bool) + **`savedTripName`** (string?) — written by the **app** whenever `useTrip`'s `savedExists` changes; read by the **extension** to enable/label **Add to Trip** (e.g. "Add to Trip" or "Add to <name>"). Absent ⇒ treated as false.

---

## Component 4 — Native module (`modules/shared-intake`) changes

`SharedIntakeModule.swift` (+ its `.ts` decl) gains/renames:
- `consumeSharedIntent(): Promise<string | null>` — atomic read+clear of `pendingSharedIntent`, returns the JSON string (or null). (Replaces `consumePendingShare`; also clears the legacy key.)
- `setSavedTrip(exists: Bool, name: String?)` — writes `savedTripExists`/`savedTripName` for the extension.

Pure App Group `UserDefaults` I/O; no resolution here.

---

## Component 5 — App-side wiring (`src/`)

- **`sharedLocationStore`** — its payload gains the action: `{ location: SharedLocation, action: 'navigate' | 'addToTrip' }`.
- **`useSharedLocationIntake`** — the native intent is the primary path: drain loop is `consumeSharedIntent()` → JSON.parse → (if `location` has a valid coordinate) `sharedLocationStore.set({location, action})`, else `parseSharedLocation(raw, deps)` on the intent's `raw` as the degraded fallback, then set. Keeps `resolveUrl`/`geocode`/`AppleSearch`/`Location` deps only for that fallback (removed with the file once the native path is trusted). Still runs on cold launch + `AppState` active + `url` event; still drains until empty; still guarded by the `busy` ref.
- **`location.tsx`** — the shared effect (currently always drops a pin) switches on `action`:
  - `navigate` → build a `Place` from the location (reuse `pinToPlace` shape) → `onSelectPlace(place)` (starts a trip if none, else appends) → Trip view.
  - `addToTrip` → `trip.addToSaved(place)` → Trip view.
  - The shared→dropped-pin wiring + `sharedCenterRef`/`centerOnShared` for shares is removed. **The long-press / POI dropped-pin preview + its two-button bar are untouched** (still used for map long-press and POI taps).
- **savedTripExists mirror** — an effect (where `trip.savedExists` is in scope, e.g. `location.tsx` or `_layout`) calls `SharedIntake.setSavedTrip(trip.savedExists, <name>)` whenever it changes.

`modules/expo-apple-search` stays (still used by `useNavigateSearch`).

---

## Component 6 — Future signed-send seam

The button handlers call one extension function, e.g. `func dispatch(_ location: ResolvedLocation, _ action: Action)`. **Today** it only writes the App Group intent. **Later**, this is where the Keychain-signed command + transport (prefer HTTPS from the extension, BLE best-effort — the *inverse* of the app's BLE-first order, because a share extension's short foreground lifetime suits HTTPS) plugs in, with the key/token read from a **shared Keychain access group** added to both entitlements. No popup-UI change required. Not built now.

---

## Data flow (end to end)

1. User shares → iOS presents `ShareViewController`.
2. Controller resolves (map-item instant; goo.gl ~1–2 s with spinner) → renders card; reads `savedTripExists` to enable/disable **Add to Trip**.
3. User taps **Navigate**/**Add to Trip** → intent written to App Group → card dismisses → user is back in the sharing app.
4. Next time airgapp foregrounds, `useSharedLocationIntake` drains `pendingSharedIntent`, applies the action, lands in the Trip view.
5. Dismiss without choosing ⇒ nothing queued ⇒ app unaffected.

## Error handling

- **Resolution fails/times out** (Google unwrap or geocode): the card degrades (name "Shared Location", map hidden) but the buttons still write an intent. To keep the action correct even when the extension couldn't resolve, the intent carries an optional `raw` string; if `location` has no coordinate, the app falls back to the **kept** JS `parseSharedLocation` on that `raw` before applying. (This is the one place the JS parser survives as a safety net until the native path is fully trusted; remove with the file afterward.)
- **No network in the extension**: only Apple map-item / coord-bearing / Waze-geohash shares resolve; goo.gl degrades as above; the raw fallback covers it in-app when the network returns.
- **Extension memory/time pressure**: MKMapView heavy → fall back to `MKMapSnapshotter` still image (plan decides). Resolution capped at 8 s per network step so the card never hangs.
- **Malformed/stale App Group payload**: reader tolerates parse failure (returns null, clears key); legacy `pendingSharedLocation` cleared on read.

## Testing strategy

- **Resolver (pure parts):** port the `sharedLocation.test.ts` vectors (geohash + URL extraction, the whole table above) into an `XCTest` target added to the extension via the `xcodeproj` gem, run offline. (If the test-target add proves disproportionate, fall back to the on-device checklist below and keep the JS node tests as the oracle — plan decides.)
- **Resolver (network parts):** on-device against a fixed URL checklist — an Apple map-item share, an Apple `maps.apple/p` short link, a Google `goo.gl` place, a Google city (geocode path), a Waze `ll`, a Waze geohash, and a `consent.google.com` wall.
- **App-side (node):** existing `sharedLocationStore.test.ts` / `tripSnapshot.test.ts` extended for the new `{location, action}` payload; `useTrip` unchanged.
- **End-to-end on device:** share from all three apps → card renders correct name/map → tap each button → open airgapp → correct Trip view; **Add to Trip disabled** when no saved trip exists; sharing a **photo/file** still does NOT surface airgapp (activation rule).

## Build / deploy

- New Swift files + (optional) XCTest target land in the hand-maintained `ios/` via the `xcodeproj` gem → **one `xcodebuild` Release** (per AGENTS.md), then `deploy-js.sh` for the `src/` + `modules/*.ts` iterations.
- Smoke-test the extension scheme alone before the full build (fast signing check), per [[shared-location-intake]].

## Risks

- **JS→Swift parser divergence** — mitigated by using the JS test vectors as the resolver's acceptance spec + keeping the JS oracle until on-device proof.
- **MKMapView weight in an extension** — snapshotter fallback.
- **Google resolve latency** in the card — spinner + 8 s cap + graceful degrade + in-app raw fallback.
- **Bluetooth-in-extension** feasibility for the future seam is unverified — out of scope here; HTTPS-first from the extension sidesteps it.
