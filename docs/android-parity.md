# Android parity — 2026-08-21

Device: Galaxy S22 (`SM-S901B`), arm64-v8a, Android 16 / SDK 36. Build: release variant
(JS bundled, `debuggable true`). iOS reference: iPhone 17 / `iPhone18,4`.

**Test suite: 976 passing, 0 failing. Typecheck clean.** iOS behaviour is unchanged throughout —
every platform split is either a `.android.tsx` file or a `Platform.OS` branch whose iOS arm is the
pre-existing code.

## At parity (verified on device)

| Area | Notes |
|---|---|
| Boot, navigation, layout | Every screen renders. Fabric/New Architecture. |
| **Godot vehicle render** | Engine v3.2.2.stable boots from the pushed `.pck`; Model Y renders full-size with real paint, glass and wheels. Controls' top-down view and Climate's interior cutaway both correct. |
| **RN ↔ Godot bridge** | `AndroidGodotInterface` registers as an engine singleton; `SHOW_PRODUCT`, `MOVE_CAMERA`, `GET_VEHICLE_MARKERS`, `SET_VEHICLE_LIGHTS` all round-trip. |
| **Marker overlays** | Lock/closure markers on Controls and seat-heater markers on Climate land on the right parts of the car — the strongest evidence the points→pixels fix is right. |
| Icons | All 61 SF Symbols migrated to Tesla glyphs; no missing chrome. |
| Fonts | Universal Sans loads via `expo-font` (render is gated on `fontsLoaded`). |
| **Map** | MapLibre + OpenFreeMap dark vector tiles; pan/zoom, user-location puck, POI labels. |
| **Charger DB** | 189,194 rows open from `files/chargers.db`; list populates with real distances. |
| Gazetteer / recents / log sink | `expo-sqlite` working; `files/SQLite/` populated. |
| Secure store | Device key persists across force-stop. |
| BLE scan | Scanner starts, matches the VIN-derived name (byte-identical to `bleScanName.ts`), reports what it saw. |
| System back | Pops Controls/Climate and the sheets; exits to launcher at the root. |
| **Share intake** | `ACTION_SEND` text/plain → Location screen with the pin dropped and Send to Car. Verified with a Google Maps URL. |

## Accepted deltas (Android behaves differently by design)

| Delta | Why |
|---|---|
| **Map is MapLibre/OSM, not Apple Maps** | `react-native-maps` renders through Google Maps on Android and hard-kills the process without an API key. Google's SDK is $0 but requires a GCP billing account, which this project deliberately does not have. OpenFreeMap is keyless and accountless. |
| **No satellite imagery** | OpenFreeMap serves no imagery, so the map-type toggle keeps the dark vector style rather than pretending. Needs a separately-vetted tile source to close. |
| **Online search is Photon, not Apple MKLocalSearch** | No MapKit off Apple platforms. Same `Place` shape, same offline-gazetteer fallback. |
| **`StatusBarFade` is iOS-only** | Deliberate: Tesla's own component is iOS-only. Enabling it on Android would *break* parity. |
| **Background passive entry will need a foreground-service notification** | iOS uses CoreBluetooth state restoration; Android has no equivalent. Unavoidable and visible. (Phase 4, not yet built.) |
| **The `Controls` title renders in Roboto** | Its style carries `fontWeight` and no `fontFamily`, so the system font is correct on both platforms — SF Pro on iOS, Roboto here. Not a bug. |

## Open / unverified

| Item | Status |
|---|---|
| **BLE command to the car** | Not yet done — needs the phone at the car with the key card. Everything up to discovery is verified; the car has not been in range during testing. Wake the car first (a sleeping Tesla stops advertising). |
| **Phase 4** — background passive entry, geofence re-arm, CPD notification, native self-signing | Not built. The three crypto goldens deliberately return "not implemented" rather than a false pass. |
| Charger list framing on entry | The map opens tighter than iOS, so the list can read empty until you zoom out. The DB and query are fine (proven by the populated list at wider zoom) — this is `fitToCoordinates` framing. |
| `BottomSheet`-based `PlacePreviewSheet` / `LocationSheet` back behaviour | Not verified. They are detented map sheets rather than modal dismissals, so consuming Back there may be wrong. |
| `expo-bg-task` wake lock at runtime | Compiles and autolinks; needs a real car command to exercise. |
| Godot snapshot thumbnails | `SnapshotDriver` not verified on Android; the Cars sheet currently shows the vehicle glyph. |

## Deleted as dead code

`src/components/ui/collapsible.tsx` and `src/components/app-tabs.web.tsx` — unreferenced Expo
starter-template files dating from the initial commit, and the only two platform-object
`SymbolView` call sites.
