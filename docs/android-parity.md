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
| **Godot vanishes after visiting another route** | UNFIXED. See "The disappearing car" below. |
| Charger list framing on entry | The map opens tighter than iOS, so the list can read empty until you zoom out. The DB and query are fine (proven by the populated list at wider zoom) — this is `fitToCoordinates` framing. |
| `BottomSheet`-based `PlacePreviewSheet` / `LocationSheet` back behaviour | Not verified. They are detented map sheets rather than modal dismissals, so consuming Back there may be wrong. |
| `expo-bg-task` wake lock at runtime | Compiles and autolinks; needs a real car command to exercise. |
| Godot snapshot thumbnails | `SnapshotDriver` not verified on Android; the Cars sheet currently shows the vehicle glyph. |

## Deleted as dead code

`src/components/ui/collapsible.tsx` and `src/components/app-tabs.web.tsx` — unreferenced Expo
starter-template files dating from the initial commit, and the only two platform-object
`SymbolView` call sites.

## The disappearing car (unfixed, root cause identified)

Navigate Home → any route → back, and the Godot render disappears. The app is otherwise fine.

**Ruled out with evidence** (six attempts; recording these so nobody repeats them):

| Hypothesis | Disproved by |
|---|---|
| GL context loss | With `enableScreens(false)` the context is never recreated — car still vanishes. |
| Lost GPU resources / `reload_gfx` | `GodotRenderer.onDrawFrame` keeps stepping frames throughout (instrumented). |
| MapLibre's second `GLSurfaceView` | A map-free route reproduces it. (An early "Controls works" test was INVALID — Controls is a card on the *same* route, so nothing is torn down.) |
| The `rendererDim` overlay | It is only 0.5 alpha, and the car survives 55s with no navigation. |
| The RN↔Godot message bridge | No messages are sent or needed across the transition. |
| Re-attach failing | Instrumented: same `ExpoGodotView` instance, `onAttachedToWindow 1080x2340`, engine view re-parented, `children=1`. Re-attach is clean. |

⚠️ `adb shell dumpsys activity top` dumps every task and **times out before reaching ours**, so it
intermittently reports an empty view tree. Two of the six attempts were built on that false
signal. Instrument the module instead (`GodotAttach` log tag).

**Root cause, from the official Tesla app** (`~/Downloads/com.teslamotors.tesla_4.58.0-*`):

Tesla solved this and their engine is the *same version we use* —
`libgodot_android.so` reports **`3.2.2.stable.custom`** vs our `3.2.2.stable.official`. The
engine is identical; **their Java layer is patched**:

- `com.tesla.godot.TMGodot extends org.godotengine.godot.Godot`, and it is a **Fragment** —
  added with `supportFragmentManager.beginTransaction().add(tMGodot, "godot_fragment").commit()`.
  Stock 3.2.2 declares `Godot extends FragmentActivity`; Tesla backported the 3.2.3+ refactor that
  turns it into a Fragment. `FullScreenGodotApp` in their dex confirms it.
- `TMGodotViewManager.createViewInstance` returns a **cached** `mGodotFrameLayout` — the same
  instance for every mount ("returning existing frame layout") — and **`onDropViewInstance` does
  nothing**. The view is never torn down.
- `onFragmentAttached` calls `fragment.getActivity().getWindow().getDecorView().requestLayout()`
  — they hit the stale-surface problem too. (We now do this; it is necessary but not sufficient.)

A Fragment owns its view independently of the React Native view tree, which is what lets it
survive navigation churn. Our `Godot` is a `ContextWrapper` whose view RN detaches and re-attaches,
and `setZOrderMediaOverlay()` is only honoured *before* the containing window is attached — so a
re-attached surface keeps a stale compositing layer, drawing frames nobody shows.

**The Fragment port is DONE** (`Godot extends Fragment`, added with
`supportFragmentManager.add(godot, "godot_fragment").commitNow()`, view returned from
`onCreateView`). It boots and renders correctly on first load — **but it does not fix the bug on
its own**, because `ExpoGodotView` still re-parents the fragment's view into the React Native tree,
and that re-parenting is what tears the surface down. Tried with and without detaching on
`onDetachedFromWindow`; neither works.

Worth recording from the port: the engine binds **18** methods on `Godot`, not 17.
`getClassLoader()` is resolved LAZILY at `java_godot_wrapper.cpp:93` (outside the init list) and
`GodotLib.setup()` calls it while loading modules. `ContextWrapper` supplied it for free; `Fragment`
does not, and the omission aborted the GL thread with
`NoSuchMethodError: no non-static method Godot.getClassLoader()`.

**What remains:** stop React Native owning the engine view at all. In Tesla's app
`TMGodotViewManager.createViewInstance` returns the *same cached* `FrameLayout` for every mount and
`onDropViewInstance` is a no-op — RN never creates or destroys it. Our Expo module instead builds a
fresh `ExpoGodotView` per mount and adopts the engine view into it. Closing that gap — or hosting
the surface outside the RN tree entirely — is the remaining work.
