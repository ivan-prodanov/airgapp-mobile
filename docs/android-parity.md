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
| **Godot survives navigation** | Home → Controls / Climate / Location / Charging / Explore → back, five further Location round trips, background/resume and root-Back/relaunch: the car is still there. `onSurfaceCreated` fires exactly ONCE for the process. See "The disappearing car" below. |
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

## The disappearing car (FIXED 2026-08-21)

Navigate Home → any route → back, and the Godot render disappeared. The app was otherwise fine.

**Root cause — it is in C++, which is why six attempts in the Java layer all failed.**
`platform/android/java_godot_lib_jni.cpp` (3.2.2-stable):

```c
JNIEXPORT void JNICALL Java_org_godotengine_godot_GodotLib_newcontext(JNIEnv *env, jclass clazz, jboolean p_32_bits) {
	if (os_android) {
		if (step == 0) {
			// During startup
			os_android->set_context_is_16_bits(!p_32_bits);
		} else {
			// GL context recreated because it was lost; restart app to let it reload everything
			os_android->main_loop_end();
			godot_java->restart(env);
			step = -1; // Ensure no further steps are attempted
		}
	}
}
```

Upstream's answer to a lost GL context is **to restart the process**. This embed cannot: `restart()`
is a no-op precisely because restarting would take React Native down with it. So the engine ended
its main loop, set `step = -1`, and was permanently dead — surface fine, view fine, frames
"stepping", nothing drawn, host message queue never drained again. No error anywhere.

The trigger: React Native detaches the view tree on navigation, `GLSurfaceView.onDetachedFromWindow()`
calls `mGLThread.requestExitAndWait()` which destroys the EGL context, and coming back gives the
renderer a **fresh GL thread** — which means `onSurfaceCreated()` runs again, which calls
`newcontext()`. Measured: the re-attach logged `onSurfaceCreated -> newcontext` a second time on a
new thread id.

**The fix is to never lose the context**, in three parts:

| Change | Why |
|---|---|
| `GodotView.onDetachedFromWindow()` overridden to do nothing (no super call) | Skips GLSurfaceView's GL-thread teardown. `setPreserveEGLContextOnPause(true)` then keeps the context across the surface loss, so re-attaching binds a new EGL surface to the live context and `onSurfaceCreated` never fires again. Leaving `mDetached` false is deliberate — `onAttachedToWindow` then does nothing rather than starting a SECOND GL thread. |
| `GodotHost` uses the retained `containerLayout`, not `Fragment.getView()` | `onDestroyView()` nulls the Fragment's own view when its host Activity goes away, so `start()` returned null and the relaunched app had no car. Our field survives, and so does the GodotView inside it. |
| `MainActivity.invokeDefaultOnBackPressed()` moves the task to back for a root activity | Destroying the Activity destroys the window and the surface, which the engine cannot survive. Also the correct iOS parity behaviour. The Expo template shipped this for SDK ≤ R only; on SDK 36 the default FINISHES a root activity. |

**Verified on device:** every route, five extra Location round trips, background/resume and
root-Back/relaunch — `onSurfaceCreated` fires exactly once per process, zero crashes.

**Ruled out with evidence** (six earlier attempts; recorded so nobody repeats them):

| Hypothesis | Disproved by |
|---|---|
| GL context loss is *irrelevant* | It is the whole cause — but the damage is done in `newcontext`, not by the context loss itself. |
| Lost GPU resources / `reload_gfx` | `GodotRenderer.onDrawFrame` keeps stepping frames throughout (instrumented). |
| MapLibre's second `GLSurfaceView` | A map-free route reproduces it. (An early "Controls works" test was INVALID — Controls is a card on the *same* route, so nothing is torn down.) |
| The `rendererDim` overlay | It is only 0.5 alpha, and the car survives 55s with no navigation. |
| The RN↔Godot message bridge | No messages are sent or needed across the transition. |
| Re-attach failing | Instrumented: same `ExpoGodotView` instance, `onAttachedToWindow 1080x2340`, engine view re-parented, `children=1`. Re-attach is clean. |
| A stale compositing layer from `setZOrderMediaOverlay` | Removing the call entirely (Tesla never calls it) did NOT fix it. The flag was dropped anyway — see below. |
| Hosting the surface outside the RN tree | Parking it in the Activity's content root DOES keep the car alive, but it takes the surface out of RN's layout, so it no longer slides with the push transition. Rejected: wrong behaviour, not a fix. |

⚠️ `adb shell dumpsys activity top` dumps every task and **times out before reaching ours**, so it
intermittently reports an empty view tree. Two of the six attempts were built on that false
signal. Instrument the module instead (`GodotAttach` log tag), and watch `GodotRenderer` — a second
`onSurfaceCreated` for one process is the canary for this whole class of bug.

**What the official Tesla app told us** (`~/Downloads/com.teslamotors.tesla_4.58.0-*`, `classes10.dex`):

Their engine is the same version (`3.2.2.stable.custom` vs our `.official`) and their Java layer is
a Fragment, which is why we ported ours to one — necessary, but not sufficient. Two further things
their source settled:

- `TMGodotViewManager.createViewInstance` returns a **cached** `mGodotFrameLayout` as the React view
  instance, and `onDropViewInstance` does nothing. The FrameLayout lives IN the RN tree, so it
  animates with the screen. Ours does the same via `ExpoGodotView` adopting the engine view.
- Neither their `Godot.java` nor their `GodotView.init()` ever calls `setZOrderMediaOverlay`. Ours
  did; the call is now gone. It was not the bug, but it is not needed either — RN's overlays are
  window-layer views and composite on top regardless, and the flag would put our surface above
  MapLibre's map.

Their build is `.custom`, so they may also have patched the native `newcontext` path; we did not
need to, because keeping the context alive means it is never reached.

**Residual risk:** the system can still destroy the Activity under memory pressure or on an
unhandled configuration change. The engine cannot survive that, and would need either a native
`newcontext` patch (rebuild from `godot-src`) or a full engine re-boot on Activity recreate. Not hit
in testing; recorded here because it is the one path left.
