# Android first-boot state — 2026-08-21

Device: Galaxy S22 `SM-S901B` (`R3CT30Q7KYM`), arm64-v8a, Android 16 / SDK 36.
Build: `:app:assembleDebug`, **BUILD SUCCESSFUL in 14m 51s**, 451 tasks, 145 MB debug APK.
Runtime: Metro over `adb reverse tcp:8081`, New Architecture (`fabric: true`).

## Result: the app boots and renders. No crash, no red box.

```
I ExpoModulesCore: ✅ AppContext was initialized
I ExpoModulesCore: ✅ JSI interop was installed
I ExpoModulesCore: ✅ Constants were exported
I ReactNativeJS: Running "main" with {"rootTag":1,"initialProps":{},"fabric":true}
```

This is a better starting position than the plan assumed. Everything below is a
*rendering* gap, not a boot failure — Phase 0's exit criterion is met.

## What already works

- **Navigation and layout** — Home renders the car name ("Red Velvet"), battery pill,
  "Parked", the five quick actions, and every nav row (Controls, Climate, Location,
  Summon, Charging, Set Schedules, Security & Drivers, Service, Dashcam Viewer,
  Photobooth). Controls renders its title, top-right action and the Flash/Honk/Start/Vent
  row. Scrolling works.
- **All `TeslaIcon` glyphs render** — steering wheel, bolt, clock, shield, wrench, camera,
  photo, lock, fan, frunk, trunk, car, location arrow. `react-native-svg` needed nothing.
- **The Airgapp wordmark PNG renders.**
- **The Godot Android stub renders** its `#808080` placeholder and reports
  `scene: mobile`, proving the `sceneName` prop crosses the bridge.
- **`expo-secure-store`, `expo-sqlite`, `expo-location`** all loaded without error
  (`Security & Drivers` shows the persisted driver name "Ivan P").

## Confirmed gaps (all already have plan tasks)

| Symptom | Cause | Task |
|---|---|---|
| **Back chevron missing** on Controls (and every stack header) | `SymbolView` is iOS-only and renders *nothing* on Android — silently, no warning | 1.1 |
| Whole screen washed gray | The Godot stub's `#808080` fills the vehicle canvas that the engine would occupy | 6.4 |
| Text noticeably heavier than iOS | `themed-text.tsx:70` `Platform.select({ android: 700 })` plus `Fonts` falling through to `'normal'` instead of Universal Sans | 1.2 |

## Non-blocking warnings (pre-existing, both platforms)

- `Require cycle: src/ble/transport.ts -> src/ble/teslaHostGuard.ts -> src/ble/transport.ts`
  — predates the port; drives the "Open debugger to view warnings" toast.
- `Introspectable data is missing for expo.modules.location.records.LocationTaskOptions`
  — an expo-location perf hint, not ours.

## Reproduce

```bash
adb reverse tcp:8081 tcp:8081
npx expo start --dev-client --port 8081        # separate shell
adb shell am start -n local.airgapp.mobile/.MainActivity
```

`monkey -c android.intent.category.LAUNCHER` starts the process but does not reliably
foreground the activity — use `am start` and confirm with
`adb shell dumpsys activity activities | grep topResumedActivity`.
