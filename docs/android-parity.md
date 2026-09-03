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
| **Charger framing on entry** | Car and nearest charger both land in the visible map space above the sheet, pin fully clear of it. Needed `centerOffset` support in the Marker adapter — see below. |
| **Marker overlays** | Lock/closure markers on Controls and seat-heater markers on Climate land on the right parts of the car — the strongest evidence the points→pixels fix is right. |
| **Godot survives navigation** | Home → Controls / Climate / Location / Charging / Explore → back, five further Location round trips, background/resume and root-Back/relaunch: the car is still there. `onSurfaceCreated` fires exactly ONCE for the process. See "The disappearing car" below. |
| Icons | All 61 SF Symbols migrated to Tesla glyphs; no missing chrome. |
| Fonts | Universal Sans loads via `expo-font` (render is gated on `fontsLoaded`). |
| **Map** | MapLibre + OpenFreeMap dark vector tiles; pan/zoom, user-location puck, POI labels. |
| **Charger DB** | 189,194 rows open from `files/chargers.db`; list populates with real distances. |
| Gazetteer / recents / log sink | `expo-sqlite` working; `files/SQLite/` populated. |
| Secure store | Device key persists across force-stop. |
| **Phone key (BLE)** | Rewritten 2026-09-03 (spec: `docs/superpowers/specs/2026-09-03-android-native-parity-design.md`). Foreground service (`connectedDevice`) holds the link; standing `autoConnect` to the remembered address; bounded filtered discovery (iBeacon + `1122` + name); **indications** on 0213 (what the official app and `vehicle-command` use); native self-signing in the background (`VcsecResponder`, byte-for-byte port of the Swift, JVM-tested); warm session; boot receiver + a process-death-surviving `PendingIntent` beacon scan for the wake; BT-off reminder (+4 h repeat); CPD alert. Verified on device 2026-09-03 without JS: package-replaced receiver → foreground service (`isForeground=true`, type `connectedDevice`, notification 333) → background scan registered with the three hardware filters + REINIT/SCAN_RESTART alarms. **At-car verification pending** (Task 8 of the plan). |
| System back | Pops Controls/Climate and the sheets; exits to launcher at the root. |
| **Share intake** | `ACTION_SEND` text/plain → a self-dismissing share sheet, NOT the app. See "The share sheet" below. |

## Accepted deltas (Android behaves differently by design)

| Delta | Why |
|---|---|
| **Map is MapLibre/OSM, not Apple Maps** | `react-native-maps` renders through Google Maps on Android and hard-kills the process without an API key. Google's SDK is $0 but requires a GCP billing account, which this project deliberately does not have. OpenFreeMap is keyless and accountless. |
| **No satellite imagery** | OpenFreeMap serves no imagery, so the map-type toggle keeps the dark vector style rather than pretending. Needs a separately-vetted tile source to close. |
| **Online search is Photon, not Apple MKLocalSearch** | No MapKit off Apple platforms. Same `Place` shape, same offline-gazetteer fallback. |
| **`StatusBarFade` is iOS-only** | Deliberate: Tesla's own component is iOS-only. Enabling it on Android would *break* parity. |
| **A persistent "Phone Key" notification while armed** | Android has no CoreBluetooth state restoration; a `connectedDevice` foreground service is the only way to hold a link while backgrounded (the official Tesla app does exactly this — `BLEService`, notification 333). Low-importance channel, silent, tap opens the app. |
| **Reboot wake = boot receiver + background scan, not a geofence** | iOS needs Location Always for its beacon/circular regions; Android's `BOOT_COMPLETED` receiver and a hardware-filtered `PendingIntent` scan cover reboot and process death with no location permission. A geofence leg is optional (spec §5 Q2). |
| **`bondRemoved` never fires** | Nothing bonds with the car on Android (neither the official app nor `vehicle-command`), so there is no LE bond to lose. |
| **The `Controls` title renders in Roboto** | Its style carries `fontWeight` and no `fontFamily`, so the system font is correct on both platforms — SF Pro on iOS, Roboto here. Not a bug. |

## Open / unverified

| Item | Status |
|---|---|
| **Phone key at the car** | Connect → MTU → indications → foreground command through the pipe → background walk-up (`HANDSHAKE ✓`, `standing DRIVE asserted`, unlock). Needs the phone at the car with the official app's Bluetooth OFF (it does its own passive entry). Pull both logs with `bash scripts/android/pull-logs.sh`. |
| `BottomSheet` back behaviour | The place-preview sheet's close button dismisses correctly (verified). Back-key behaviour on the detented sheets is still unverified. |
| `expo-bg-task` wake lock at runtime | Compiles and autolinks; needs a real car command to exercise. |
| **Share sheet: send** | The sheet is verified end to end visually — spinner → "Sharing to car" + place + "Trying Bluetooth…" → "Error / Couldn't reach your car — try again" → auto-dismiss back to the sharing app. Only the SEND leg is unverified; it needs the car in range. |
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

## Never call `requestForegroundPermissionsAsync` on mount

`Location.requestForegroundPermissionsAsync()` is not a cheap check. On Android it starts the
system's `GrantPermissionsActivity` over our own **even when the permission is already granted** —
the dialog never becomes visible, but the Activity transition still happens. Ours pauses for ~100ms
(measured: `onHostPause` 02:04:23.306, `onHostResume` .412), React Native stops driving the surface
for that window, and the bare window shows instead.

Land that on a screen push and the screen you are LEAVING appears to lose all its content — on Home
that is the car and the entire menu — and then slide away blank.

**The correlation that identified it:** it reproduced on exactly the two screens that requested on
mount, Location and Set Schedules, and on no others. Charging and Security & Drivers never touch
location and slide cleanly. Set Schedules is a plain list screen, which is what ruled out every
map/surface/compositing theory — those had been chased and disproved first.

`getForegroundPermissionsAsync()` is a pure query and starts nothing, which is why HomeScreen —
which always used it — never caused this. `services/locationPermission.ts` now owns the rule:
query, and ask only when we do not already have it.

Verified: tapping Location or Set Schedules produces NO `onHostPause`/`onHostResume` pair and no
`GrantPermissionsActivity` launch, where before there was one at the tap.

## The map is a TextureView, not a SurfaceView

`androidView="texture"` on the MapLibre `Map`. A `GLSurfaceView` does not draw into the window: it
gets its own compositor layer and the window punches a transparent HOLE where it sits. Until
MapLibre renders its first frame that hole shows the window background — which is the "the map is
white before it initializes" effect. Proved with a magenta window background: the exposed area went
magenta.

A `TextureView` renders into the view hierarchy like an ordinary view and cuts no hole, at the cost
of a little memory and one extra copy per frame.

⚠️ This was NOT the cause of the outgoing screen going blank, though it was committed as if it
were. Set Schedules has no map and blanked identically — see the permission note above. Recorded so
the wrong explanation does not get re-derived.

`android:windowBackground` is pinned dark (`#161718`) for the same family of reasons: the Godot
renderer is a real GLSurfaceView, and a dark-only app should never resolve DayNight to a white
window.

## `centerOffset` on markers

react-native-maps' `centerOffset` nudges a marker relative to its centre — it is how `location.tsx`
puts a charger pin's BOTTOM TIP on the coordinate instead of its middle. The Android adapter ignored
it, so every charger pin drew half a pin too low, and the nearest one sat half-behind the bottom
sheet even once the fit padding was right: `fitToCoordinates` only guarantees the COORDINATE clears
the padding, and the pin is drawn around it.

MapLibre's `Marker` has an `offset` prop with the same meaning and the same sign convention
(negative is up/left), and its Android binding multiplies by display density itself — so it takes
dp, like every other measurement crossing this boundary.

Related: `fitBottomPad` now treats its `targetFrac` as a FLOOR rather than a fallback for an
unmounted ref. Switching to the Charging tab both fits the map and raises the sheet to its tall
detent, and the fit runs first, so `reserveFrac()` could still report the old minimal detent and
compute zero extra padding.

## The share sheet (Android's Share Extension)

Sharing a place into airgapp IS the decision, so a share must not open the app. It used to: the
`ACTION_SEND` filter lived on MainActivity, so forwarding one coordinate booted the whole app —
Godot engine included — and left the user on a Location screen they had not asked for.

Now the filter is on `ShareActivity`, which renders one React component (`src/share/ShareSheet.tsx`,
registered as `shareSheet` in `index.js`) over a transparent window and dismisses itself. The four
states mirror `ShareViewController.swift` exactly: **Sharing to car → Sent | Error | Timed out**,
with a live stage line ("Finding the location…", "Trying Bluetooth…") and the resolved place name.

### Why it runs in its own process

`android:process=":share"` is load-bearing, and it was NOT the first design. Two `ReactActivity`s
sharing one React host does not work: with MainActivity alive, launching ShareActivity logs

```
ReactHost{0}.onHostResume(activity)
ReactHost{0}.onHostPause(activity)     ← 4ms later
```

and **no `startSurface` ever runs**, so the sheet mounts nothing and the window is black. With the
app force-stopped the same build logs `startSurface(surfaceId = 0)` and the component runs. RN's
Bridgeless `ReactHost` tracks a single current activity, and MainActivity's pause immediately
clobbers the sheet's resume.

A separate process gives the sheet its own React host — which is exactly the iOS architecture, where
the Share Extension is a separate process with its own JS engine. The cost is a ~5s cold start
(measured: intent → `Running "shareSheet"`), the same cost iOS pays.

### Reading the intent: not via `currentActivity`

`consumeSharedIntent` reads a process-static slot (`ShareIntentBus`) that ShareActivity fills in
`onCreate`/`onNewIntent`, not `appContext.currentActivity`. Two separate defects made the first
version report **"Nothing was shared"**:

- **Race.** `currentActivity` is only set once the React host resumes, and on a COLD start of the
  `:share` process the sheet's JS runs almost immediately — so it could ask before the activity was
  registered. Warm starts won, cold starts lost.
- **Stale intent.** ShareActivity is `singleTop`, so a second share reuses the instance via
  `onNewIntent` — and `Activity.onNewIntent` does NOT update `getIntent()`; RN's delegate does not
  call `setIntent` either. The reused sheet re-read the previous intent, which this module neuters
  after a successful read.

`textOf` also falls back to `ClipData` when `EXTRA_TEXT` is absent, rather than calling a share with
an obvious payload empty.

### A second share into a live sheet needs a generation token

The React surface is NOT recreated on `onNewIntent`, so native fires an `onShareIntent` event and
the component re-runs its flow. Resetting a single `settled` boolean was not enough: the FIRST run
is usually still in flight (waiting on the BLE link) and goes on to call `finish()` from inside its
awaits, stamping its verdict and its place name over the new share. Measured exactly that on device.
Each run now carries the generation it started in and can only touch the UI while it is current.

### The share sheet's BLE arm

The `:share` process runs the same `PassiveEntryCentral` in EPHEMERAL mode — the iOS `BleBytePipe.swift` shape: no service, no persistence, no responder; a direct connect to the remembered address plus a 3 s discovery scan, closed when the sheet's activity is destroyed. Two GATT clients from two processes share one ACL on Android (the Bluetooth process owns the link), exactly as two `CBCentralManager`s do across processes on iOS, so this is not the in-process two-central contention that broke passive entry on iOS.
