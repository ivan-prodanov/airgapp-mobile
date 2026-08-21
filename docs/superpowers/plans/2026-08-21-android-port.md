# Android Port Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Bring airgapp to full feature parity on Android — the app boots, drives the car over BLE, renders the Godot vehicle, maps, searches, and receives shared locations, all on a physical Galaxy S22.

**Architecture:** The codebase is already well-positioned: **all Tesla protocol/crypto lives in TypeScript** (`src/ble/*`), and native code is thin. Five local Expo modules are iOS-only (`expo-passive-entry`, `expo-bg-task`, `expo-apple-search`, `shared-intake`) or half-stubbed (`expo-godot-view`). The port is therefore mostly (a) writing Kotlin siblings behind the *existing, unchanged* TS contracts, and (b) replacing iOS-only UI primitives (`expo-symbols`, Apple Maps) with the cross-platform equivalents the repo already owns (`TeslaIcon`, MapLibre). The Godot engine is embedded exactly as on iOS — a **prebuilt engine binary + a host that drives it**, never an engine source build.

**Tech Stack:** Expo SDK 56, React Native 0.85.3 (New Architecture / Fabric), Kotlin + Expo Modules API, Godot 3.2.2.stable (prebuilt `libgodot_android.so`), MapLibre GL Native, Android SDK 36 / JDK 17.

---

## Global Constraints

Copy these verbatim into every task's mental checklist. They are project-wide.

- **Never run `npx expo prebuild` without `--platform android`.** A bare prebuild clobbers `ios/`, which contains the hand-maintained Godot embed. After the one-time generation in Task 0.2, `android/` is **committed to git and hand-maintained** exactly like `ios/`. Never regenerate it.
- **Never change the iOS behaviour of shared code.** Every task that touches `src/**` must leave the iOS render/behaviour byte-identical unless the task explicitly says otherwise. `pnpm test` (936 tests at baseline) must stay green.
- **The car must never reach Tesla's real servers.** `src/ble/no-tesla-servers.test.ts` and `teslaHostGuard.ts` enforce this. Any new network call (map tiles, geocoding) must be added to that guard's allowlist reasoning and must not be a Tesla host.
- **TS contracts are frozen.** `modules/*/index.ts` and `modules/*/src/*Module.ts` are the cross-platform contract. Android implementations conform to them; they do **not** get new platform-specific exports. Every export already no-ops gracefully when the native module is absent — preserve that.
- **Branch:** all work lands on `feat/ble-carlink` (the current branch), per the user's decision. Commit the existing WIP before Task 0.1.
- **Target device:** Samsung Galaxy S22, `SM-S901B`, `arm64-v8a`, Android 16 / **SDK 36**. `adb` is at `/opt/homebrew/bin/adb`. JDK 17 at `/Library/Java/JavaVirtualMachines/zulu-17.jdk/Contents/Home`. Android SDK at `~/Library/Android/sdk` (`ANDROID_HOME` is **unset** — every gradle invocation must export it).
- **ABIs to ship:** `arm64-v8a` (the device) and `x86_64` (emulator). Never `armeabi-v7a` or `x86` — they double the APK for no benefit. Unlike iOS (where the 2020 engine has no arm64-simulator slice), **Godot's Android template ships x86_64, so the Android emulator can run the full app.** This is a real advantage over the iOS workflow; use it.
- **No paid services.** No Google Maps API key, no billing account. Maps use MapLibre + OpenFreeMap; online geocoding uses Photon. Both are free and keyless. (For the record: Google's Maps SDK for Android is $0 for unlimited map loads since March 2025, but it still requires a GCP billing account on file — which the user declined. MapLibre avoids the account entirely.)
- **Godot engine version is 3.2.2.stable and must not drift.** Android binaries come from the same `~/Library/Application Support/Godot/templates/3.2.2.stable/` templates the iOS embed uses.
- **Test command:** `pnpm test`. **Typecheck:** `npx tsc --noEmit -p tsconfig.json`. Both must pass before every commit.

---

## File Structure

New and modified files, grouped by responsibility.

### Generated / build config
| File | Responsibility |
|---|---|
| `android/**` | Generated once by `expo prebuild --platform android`, then hand-maintained. Committed. |
| `app.json` | Gains `android.package`, permissions, `expo-build-properties` android block, MapLibre plugin. |
| `.env.local` | Gains nothing (no keys needed) — documented so nobody adds one. |

### `modules/expo-godot-view/android/` — the engine embed (Phase 6)
| File | Responsibility |
|---|---|
| `build.gradle` | Links the prebuilt `.so` as jniLibs, `pickFirst` for `libc++_shared.so`. |
| `src/main/jniLibs/{arm64-v8a,x86_64}/libgodot_android.so` | Prebuilt engine, extracted from the 3.2.2 AAR. Gitignored + a `VENDORING.md`. |
| `src/main/java/org/godotengine/godot/**` | Godot's own Java runtime, vendored from `godot-src` and patched so `Godot` is a hosted object, not an Activity. |
| `src/main/java/expo/modules/godotview/GodotHost.kt` | The Android analogue of `GodotHost.mm` — owns the `GodotView`, the engine lifecycle, the `--main-pack` argv. |
| `src/main/java/expo/modules/godotview/AndroidGodotInterface.kt` | `GodotPlugin` subclass registering the `AndroidGodotInterface` engine singleton `MobileComm.gd` already looks for. |
| `src/main/java/expo/modules/godotview/GodotBridge.kt` | Exists as a stub; becomes the real host-side queue. |
| `src/main/java/expo/modules/godotview/ExpoGodotView.kt` | Exists as a gray stub; becomes the real view hosting `GodotHost`. |
| `src/main/assets/airgapp.pck` | The 320 MB scene pack. Gitignored; pushed by the deploy script. |

### `modules/expo-passive-entry/android/` — the BLE central (Phases 3–4)
| File | Responsibility |
|---|---|
| `src/main/java/expo/modules/passiveentry/PassiveEntryModule.kt` | Expo module surface — mirrors `PassiveEntryModule.swift` 1:1. |
| `.../PassiveEntryCentral.kt` | Scan / connect / GATT / MTU / 0212 write / 0213 notify. Analogue of `PassiveEntryCentral.swift`. |
| `.../KeystoreKey.kt` | Android Keystore-backed device key. Analogue of `KeychainKey.swift`. |
| `.../VcsecSigner.kt` | Background self-signing (HKDF + AES-GCM + P-256). Analogue of `VcsecSigner.swift`. |
| `.../CarRegionMonitor.kt` | Geofence re-arm. Analogue of `CarRegionMonitor.swift`. |
| `.../Notifier.kt` | CPD + unlock notifications. Analogue of `Notifier.swift`. |
| `.../PassiveEntryService.kt` | Foreground service — Android's answer to iOS CoreBluetooth state restoration. **No iOS analogue.** |

### `modules/expo-bg-task/android/`, `modules/expo-apple-search/android/`, `modules/shared-intake/android/`
Thin Kotlin implementations of the same TS contracts (Phases 2, 5).

### `src/**` — cross-platform work
| File | Responsibility |
|---|---|
| `src/icons/AppIcon.tsx`, `src/icons/sfFallback.ts` (new) | Maps the ~30 distinct SF Symbol names still in use onto `TeslaIcon` glyphs. |
| 25 files using `SymbolView` | Swapped to `AppIcon`/`TeslaIcon`. |
| `src/components/MapSurface.tsx` (new) + `.android.tsx` | Platform-split map adapter: iOS keeps `react-native-maps`, Android uses MapLibre. |
| `src/app/location.tsx` | The only `react-native-maps` consumer; rewritten against `MapSurface`. |
| `src/services/photonSearch.ts` (new) | Android's online geocoder, same `Place[]` shape as `appleSearch.ts`. |
| `src/services/searchProvider.ts` | Picks Apple vs Photon by platform. |
| `src/constants/theme.ts` | Android font family + inset ladder. |

### `scripts/android/` — deploy tooling (Phase 7)
| File | Responsibility |
|---|---|
| `deploy-js.sh` | JS-only fast deploy (bundle → push → restart). Analogue of `scripts/godot-ios/deploy-js.sh`. |
| `deploy-godot.sh` | Re-export the `.pck`, push, restart. Analogue of `deploy-ios.sh`. |
| `deploy-chargers.sh` | Push `chargers.db`/`places.db` into app storage. |
| `vendor-engine.sh` | Extract the Godot `.so`s from the 3.2.2 AAR into `jniLibs/`. |

---

## Known Risks (read before Phase 6)

1. **16 KB page sizes.** Android 15+ requires shared libraries to be 16 KB-aligned for apps targeting SDK 35+ on 16 KB-page devices. Godot's 2020-era `libgodot_android.so` is 4 KB-aligned. **The Galaxy S22 uses 4 KB pages, so it will load fine.** Task 6.2 verifies this empirically with `adb`. Mitigation if it fails: `godot-src` is checked out at `3.2.2-stable` — rebuild the `.so` with a modern NDK (`scons platform=android target=release android_arch=arm64v8`). Budget a day if triggered.
2. **`libc++_shared.so` collision.** React Native ships its own `libc++_shared.so`; so does the Godot AAR. Gradle will fail with a duplicate-file error. Fixed in Task 6.1 with `packagingOptions { pickFirst 'lib/**/libc++_shared.so' }`. Prefer RN's (newer) copy.
3. **`GLSurfaceView` z-ordering.** Godot renders into a `GLSurfaceView`, which is a `SurfaceView` — by default it punches a hole through the window and RN views drawn "above" it are invisible. `MarkerOverlay`/`TirePressureOverlay` sit on top of the vehicle. Task 6.4 calls `setZOrderMediaOverlay(true)`. If that still composites wrong under Fabric, the fallback is a `TextureView`-backed EGL surface (more work, worse perf).
4. **`FindClass("org/godotengine/godot/Godot")`.** `java_godot_wrapper.cpp:44` hard-binds the engine to that exact class name and to ~19 method signatures. The vendored `Godot.java` must keep its package and every one of those methods, even where the body is a no-op. Task 6.3 enumerates them.
5. **Android 12+ Bluetooth permissions.** `BLUETOOTH_SCAN` / `BLUETOOTH_CONNECT` are runtime permissions. `BLUETOOTH_SCAN` needs `android:usesPermissionFlags="neverForLocation"` or the scan silently returns nothing without location permission. Classic silent failure — Task 3.1 handles it up front.
6. **Doze / background BLE.** iOS solves background BLE with CoreBluetooth state restoration; Android has no equivalent. A **foreground service** with a persistent notification (`connectedDevice` type) is the only reliable path. This is a visible UX difference from iOS and is unavoidable.

---

# Phase 0 — Toolchain and first boot

**Exit criterion:** the RN app installs and renders its first screen on the S22, with Godot showing the existing gray stub and BLE disabled.

### Task 0.1: Commit the in-flight WIP and record the Android baseline

**Files:**
- Modify: (commit only — 34 modified + 2 untracked files already in the tree)
- Create: `docs/superpowers/plans/2026-08-21-android-port.md` (this file)

**Interfaces:**
- Consumes: nothing.
- Produces: a clean working tree on `feat/ble-carlink` so every later task's diff is purely Android.

- [x] **Step 1: Confirm the baseline is green before committing**

```bash
cd /Users/ivan/Work/airgapp/mobile && npx tsc --noEmit -p tsconfig.json && pnpm test 2>&1 | tail -6
```

Expected: no tsc output; `pass 936`, `fail 0`.

- [x] **Step 2: Commit the WIP**

```bash
cd /Users/ivan/Work/airgapp/mobile
git add -A
git commit -m "wip(carlink): snapshot before Android port

Co-Authored-By: Claude Opus 5 <noreply@anthropic.com>"
```

- [x] **Step 3: Verify the tree is clean**

```bash
cd /Users/ivan/Work/airgapp/mobile && git status --porcelain
```

Expected: empty output.

---

### Task 0.2: Generate the `android/` project without touching `ios/`

**Files:**
- Modify: `app.json` (add `android.package`, `android.permissions`, android build properties)
- Create: `android/**` (generated)
- Modify: `.gitignore`

**Interfaces:**
- Consumes: nothing.
- Produces: a buildable Gradle project at `android/`, package `local.airgapp.mobile`.

- [x] **Step 1: Snapshot `ios/` so the prebuild's blast radius is provable**

```bash
cd /Users/ivan/Work/airgapp/mobile && git rev-parse HEAD:ios
```

Record the tree hash. Prebuild must not change it.

- [x] **Step 2: Add the android block to `app.json`**

Insert into `expo.android`, alongside the existing `adaptiveIcon` and `predictiveBackGestureEnabled`:

```json
"package": "local.airgapp.mobile",
"permissions": [
  "android.permission.BLUETOOTH_SCAN",
  "android.permission.BLUETOOTH_CONNECT",
  "android.permission.ACCESS_FINE_LOCATION",
  "android.permission.ACCESS_COARSE_LOCATION",
  "android.permission.ACCESS_BACKGROUND_LOCATION",
  "android.permission.FOREGROUND_SERVICE",
  "android.permission.FOREGROUND_SERVICE_CONNECTED_DEVICE",
  "android.permission.POST_NOTIFICATIONS",
  "android.permission.INTERNET"
]
```

And extend the `expo-build-properties` plugin entry (currently iOS-only) with:

```json
"android": {
  "compileSdkVersion": 36,
  "targetSdkVersion": 36,
  "minSdkVersion": 26,
  "enableProguardInReleaseBuilds": false
}
```

`minSdkVersion: 26` — Android 8.0. Below 26 there is no `startForegroundService`, which Phase 4 needs, and no device in scope is older.

- [x] **Step 3: Generate only the android project**

```bash
cd /Users/ivan/Work/airgapp/mobile && npx expo prebuild --platform android --no-install
```

Expected: creates `android/`, prints "Config synced". `--no-install` keeps it from re-running pnpm.

- [x] **Step 4: Prove `ios/` is untouched**

```bash
cd /Users/ivan/Work/airgapp/mobile && git status --porcelain ios/ && git rev-parse HEAD:ios
```

Expected: **empty** porcelain output and the same tree hash as Step 1. If `ios/` changed, `git checkout -- ios/` immediately and investigate before continuing — this is the one irreversible hazard in the whole plan.

- [x] **Step 5: Un-ignore `android/` so it is hand-maintained like `ios/`**

Check whether `.gitignore` has an `/android` entry (Expo's default template ignores it). If present, remove that line and add:

```gitignore
# android/ is hand-maintained (Godot embed + BLE service), same as ios/. Never `expo prebuild` it again.
android/.gradle/
android/app/build/
android/build/
android/local.properties
android/app/src/main/assets/airgapp.pck
```

- [x] **Step 6: Commit**

```bash
cd /Users/ivan/Work/airgapp/mobile
git add -A
git commit -m "build(android): generate android project (prebuild --platform android)

ios/ tree hash verified unchanged. android/ is now hand-maintained.

Co-Authored-By: Claude Opus 5 <noreply@anthropic.com>"
```

---

### Task 0.3: First Gradle build and install on the S22

**Files:**
- Create: `android/local.properties` (gitignored)
- Modify: `android/gradle.properties`

**Interfaces:**
- Consumes: Task 0.2's `android/`.
- Produces: a debug APK installed on `R3CT30Q7KYM`.

- [x] **Step 1: Point Gradle at the SDK and JDK**

`ANDROID_HOME` is unset in this shell, so every gradle call needs it. Write `android/local.properties`:

```properties
sdk.dir=/Users/ivan/Library/Android/sdk
```

- [x] **Step 2: Restrict ABIs to keep the build fast**

In `android/gradle.properties`, set:

```properties
reactNativeArchitectures=arm64-v8a,x86_64
org.gradle.jvmargs=-Xmx4096m -XX:MaxMetaspaceSize=1024m
```

- [x] **Step 3: Build the debug APK**

```bash
cd /Users/ivan/Work/airgapp/mobile/android && ANDROID_HOME=$HOME/Library/Android/sdk JAVA_HOME=/Library/Java/JavaVirtualMachines/zulu-17.jdk/Contents/Home ./gradlew :app:assembleDebug
```

Expected: `BUILD SUCCESSFUL`. First run downloads Gradle + AGP and takes 10–20 minutes. If it fails on `expo-symbols` or `expo-glass-effect`, those packages are iOS-only (`node_modules/expo-symbols/` has no `android/` dir) — Expo autolinking skips them silently, so a failure there means something else; read the actual error rather than assuming.

- [x] **Step 4: Install and launch**

```bash
cd /Users/ivan/Work/airgapp/mobile && adb install -r android/app/build/outputs/apk/debug/app-debug.apk && adb shell monkey -p local.airgapp.mobile -c android.intent.category.LAUNCHER 1
```

- [x] **Step 5: Capture the actual first-boot state**

```bash
adb logcat -c && adb shell am force-stop local.airgapp.mobile && adb shell monkey -p local.airgapp.mobile -c android.intent.category.LAUNCHER 1 && sleep 8 && adb logcat -d -s ReactNativeJS:* AndroidRuntime:E ExpoModulesCore:* | head -60
```

Record every red-box / crash into `docs/superpowers/plans/android-boot-log.md`. Do **not** fix them here — Task 0.4 triages them as a batch, because most will be the iOS-only-module problem and fixing them one at a time wastes cycles.

- [x] **Step 6: Commit**

```bash
cd /Users/ivan/Work/airgapp/mobile
git add -A
git commit -m "build(android): first successful debug build + install on SM-S901B

Co-Authored-By: Claude Opus 5 <noreply@anthropic.com>"
```

---

### Task 0.4: Make every iOS-only native import safe on Android

**Files:**
- Modify: `modules/expo-apple-search/index.ts`
- Modify: `modules/shared-intake/index.ts`
- Modify: `modules/expo-passive-entry/src/PassiveEntryModule.ts`
- Modify: `modules/expo-bg-task/src/BgTaskModule.ts`
- Test: `src/services/nativeModuleAbsence.test.ts` (new)

**Interfaces:**
- Consumes: the boot log from Task 0.3.
- Produces: an app that reaches its first render on Android with every native module absent. Contracts unchanged.

`modules/expo-passive-entry/index.ts` and `modules/expo-bg-task/index.ts` already guard every call with `?.` and a fallback — that pattern is correct and must be replicated. `expo-apple-search` and `shared-intake` do a bare `export { default }`, which throws on import when the native module is missing.

- [x] **Step 1: Write the failing test**

Create `src/services/nativeModuleAbsence.test.ts`:

```ts
import { test } from 'node:test';
import assert from 'node:assert/strict';

// Every local Expo module's index must be importable with no native module present.
// On Android (and in the Node test runner) requireOptionalNativeModule returns null;
// a bare `export { default }` of a null module makes the first property access throw
// at import time and red-boxes the app before first render.
const MODULES = [
  '../../modules/expo-apple-search',
  '../../modules/shared-intake',
  '../../modules/expo-passive-entry',
  '../../modules/expo-bg-task',
];

for (const m of MODULES) {
  test(`${m} imports without a native module`, async () => {
    const mod = await import(m);
    assert.ok(mod, `${m} failed to import`);
  });
}
```

- [x] **Step 2: Run it and watch it fail**

```bash
cd /Users/ivan/Work/airgapp/mobile && pnpm test 2>&1 | grep -A6 "nativeModuleAbsence"
```

Expected: FAIL on `expo-apple-search` and `shared-intake`.

- [x] **Step 3: Switch the two bare modules to optional native modules**

In `modules/expo-apple-search/src/AppleSearchModule.ts` and `modules/shared-intake/src/SharedIntakeModule.ts`, replace `requireNativeModule('X')` with `requireOptionalNativeModule('X')` and widen the exported type to `| null`. Then in each `index.ts`, keep the re-export but make consumers tolerate null — `src/services/appleSearch.ts` and `src/hooks/useSharedLocationIntake.ts` already sit behind `searchProvider`'s try/catch degradation, so add an explicit early return:

```ts
// src/services/appleSearch.ts — at the top of each exported fn
if (!AppleSearch) throw new Error('AppleSearch unavailable on this platform');
```

Throwing (rather than returning `[]`) is deliberate: `searchProvider` catches and degrades to the offline gazetteer, which is exactly the desired Android behaviour until Phase 5 gives it Photon.

- [x] **Step 4: Run the test to verify it passes**

```bash
cd /Users/ivan/Work/airgapp/mobile && pnpm test 2>&1 | tail -6
```

Expected: `fail 0`, total count now 940.

- [x] **Step 5: Verify on device**

```bash
cd /Users/ivan/Work/airgapp/mobile/android && ANDROID_HOME=$HOME/Library/Android/sdk ./gradlew :app:assembleDebug && cd .. && adb install -r android/app/build/outputs/apk/debug/app-debug.apk && adb logcat -c && adb shell monkey -p local.airgapp.mobile -c android.intent.category.LAUNCHER 1 && sleep 8 && adb exec-out screencap -p > /tmp/android-boot.png
```

Read `/tmp/android-boot.png`. Expected: the app renders a screen (icons may be missing — that's Phase 1).

- [x] **Step 6: Commit**

```bash
cd /Users/ivan/Work/airgapp/mobile
git add -A
git commit -m "fix(android): make iOS-only native modules import-safe

expo-apple-search and shared-intake used a bare re-export of a required
native module, which threw at import time on Android and red-boxed before
first render. Both are now optional modules; callers throw a catchable
error that searchProvider already degrades from.

Co-Authored-By: Claude Opus 5 <noreply@anthropic.com>"
```

---

# Phase 1 — Cross-platform UI parity

**Exit criterion:** every screen renders on Android with correct icons, fonts, spacing and insets. Screenshot-comparable to iOS.

### Task 1.1: Replace `SymbolView` with `TeslaIcon` across the app

**Files:**
- Create: `src/icons/sfFallback.ts`
- Test: `src/icons/sfFallback.test.ts`
- Modify: the 25 files listed by `grep -rln SymbolView src`

**Interfaces:**
- Consumes: `TeslaIcon` from `src/icons/TeslaIcon.tsx` — `{ name: TeslaIconName; size?: number; color?: string; style? }`.
- Produces: `sfToTesla(sf: string): TeslaIconName | null` — the SF-Symbol-name → Tesla-glyph mapping.

`TeslaIcon` already exists and already replaced SF Symbols for most of the app (718 design-system glyphs + 8 vehicle glyphs). What remains is 93 call sites across 25 files, mostly chrome: `chevron.left`, `chevron.right`, `chevron.down`, `ellipsis`, `plus`, `xmark.circle.fill`, `bolt.fill`, `mappin.circle.fill`, `iphone`, `line.3.horizontal`, `ellipsis.message`.

- [x] **Step 1: Enumerate the exact SF names still in use**

```bash
cd /Users/ivan/Work/airgapp/mobile && grep -rho 'name="[a-z0-9.]*"' src --include='*.tsx' | grep -oP '(?<=name=")[a-z0-9.]+' | sort | uniq -c | sort -rn
```

Write the result into the test below. Do not guess the list — derive it.

- [x] **Step 2: Write the failing test**

Create `src/icons/sfFallback.test.ts`:

```ts
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { sfToTesla, SF_NAMES_IN_USE } from './sfFallback';
import ICONS from './teslaIcons.json';

test('every SF symbol still used in the app maps to a real Tesla glyph', () => {
  const glyphs = new Set(Object.keys(ICONS));
  const unmapped: string[] = [];
  for (const sf of SF_NAMES_IN_USE) {
    const mapped = sfToTesla(sf);
    if (!mapped || !glyphs.has(mapped)) unmapped.push(sf);
  }
  assert.deepEqual(unmapped, [], `unmapped SF symbols: ${unmapped.join(', ')}`);
});

test('an unknown SF name maps to null rather than throwing', () => {
  assert.equal(sfToTesla('definitely.not.a.symbol'), null);
});
```

- [x] **Step 3: Run it and watch it fail**

```bash
cd /Users/ivan/Work/airgapp/mobile && pnpm test 2>&1 | grep -B2 -A8 "sfFallback"
```

Expected: FAIL — `Cannot find module './sfFallback'`.

- [x] **Step 4: Write `src/icons/sfFallback.ts`**

Populate `SF_NAMES_IN_USE` from Step 1 and map each to the nearest glyph in `teslaIcons.json`. Inspect the JSON's keys (`node -e "console.log(Object.keys(require('./src/icons/teslaIcons.json')).join('\n'))" | grep -i chevron`) — do not invent names.

```ts
import type { TeslaIconName } from './TeslaIcon';

/** Every SF Symbol name still referenced by a SymbolView call site, from the Step-1 grep. */
export const SF_NAMES_IN_USE = [/* filled from Step 1 */] as const;

const MAP: Record<string, TeslaIconName> = {
  /* filled from the teslaIcons.json key inspection */
};

export function sfToTesla(sf: string): TeslaIconName | null {
  return MAP[sf] ?? null;
}
```

- [x] **Step 5: Run to verify it passes**

```bash
cd /Users/ivan/Work/airgapp/mobile && pnpm test 2>&1 | tail -6
```

Expected: `fail 0`.

- [x] **Step 6: Migrate the call sites, one file per commit**

For each of the 25 files, replace

```tsx
<SymbolView name="chevron.left" tintColor={theme.text} size={22} weight="medium" />
```

with

```tsx
<TeslaIcon name={sfToTesla('chevron.left')!} color={theme.text} size={22} />
```

`weight` is dropped — the Tesla glyphs bake weight in (see the comment in `TeslaIcon.tsx`). Drop the `expo-symbols` import when the file's last `SymbolView` goes.

Commit after each file: `git commit -m "refactor(icons): <file> SymbolView → TeslaIcon"`.

- [x] **Step 7: Verify no `SymbolView` remains and iOS is unchanged**

```bash
cd /Users/ivan/Work/airgapp/mobile && grep -rn "SymbolView\|expo-symbols" src | grep -v "\.web\." ; npx tsc --noEmit -p tsconfig.json && pnpm test 2>&1 | tail -4
```

Expected: no matches (except `app-tabs.web.tsx` if it is web-only), clean tsc, `fail 0`.

- [ ] **Step 8: Screenshot-diff against iOS**

Deploy to the iPhone (`bash scripts/godot-ios/deploy-js.sh`) and to Android, and compare the same three screens. The glyphs will not be pixel-identical to SF Symbols — they are Tesla's own glyphs, which is the *intended* design per the `tesla-icons-react-native-svg` memory. Confirm nothing is missing or mis-sized.

- [x] **Step 9: Drop the now-unused dependencies**

```bash
cd /Users/ivan/Work/airgapp/mobile && pnpm remove expo-symbols expo-glass-effect
```

`expo-glass-effect` has zero call sites (verified: `grep -rn "glass-effect\|GlassView" src` is empty). Re-run `pnpm test` and `npx tsc --noEmit` before committing.

---

### Task 1.2: Fonts, insets and density on Android

**Files:**
- Modify: `src/constants/theme.ts`
- Modify: `src/components/StatusBarFade.tsx`
- Modify: `src/godot/teslaStatusBarHeight.ts`
- Test: `src/godot/teslaStatusBarHeight.test.ts` (extend)

**Interfaces:**
- Consumes: `Fonts`, `BottomTabInset` from `theme.ts`.
- Produces: `Fonts.sans === 'UniversalSans-Text-Regular-430'` on Android; a correct Android status-bar constant.

The `tesla-design-system-row-typography` memory records the exact ladder: title `BodyLabel 14/20/500/ls0.1`, subtitle `CaptionLabel 12/16/500/ls0.1`, **Universal Sans via `fontFamily`, never `fontWeight`**. The four TTFs are already in `assets/fonts/`.

- [x] **Step 1: Confirm the fonts are loaded on Android**

```bash
cd /Users/ivan/Work/airgapp/mobile && grep -rn "useFonts\|Font.loadAsync\|UniversalSans" src/app/_layout.tsx src/constants/*.ts
```

If `_layout.tsx` loads them via `expo-font`'s `useFonts`, Android is already covered — `expo-font` supports it. Record which.

- [x] **Step 2: Write the failing test**

Extend `src/godot/teslaStatusBarHeight.test.ts`:

```ts
test('android status bar height comes from the measured inset, not the iOS constant', () => {
  // The tesla-parity-verify-dont-infer memory: Tesla hardcodes statusBarHeight=59 on iOS
  // while our measured inset is 68. Android must NOT inherit that hardcode.
  assert.notEqual(teslaStatusBarHeight('android', 24), 59);
  assert.equal(teslaStatusBarHeight('android', 24), 24);
});
```

- [x] **Step 3: Run it and watch it fail**

```bash
cd /Users/ivan/Work/airgapp/mobile && pnpm test 2>&1 | grep -A6 "teslaStatusBarHeight"
```

- [x] **Step 4: Add the platform parameter and the Android branch**

Read the current signature first; keep the iOS path byte-identical.

- [x] **Step 5: Fix `Fonts` in `theme.ts`**

The `Platform.select` currently falls through to `{ sans: 'normal', ... }` on Android. Replace the `default` branch with the real family names:

```ts
default: {
  sans: 'UniversalSans-Text-Regular-430',
  serif: 'serif',
  rounded: 'UniversalSans-Text-Regular-430',
  mono: 'monospace',
},
```

- [x] **Step 6: Enable `StatusBarFade` on Android**

`src/components/StatusBarFade.tsx:52` has `if (Platform.OS !== 'ios') return null;`. Android has a translucent status bar too. Remove the guard and verify visually; if the Android gradient reads wrong, keep the guard and note why in a comment — do not leave it unexplained.

- [x] **Step 7: Verify**

```bash
cd /Users/ivan/Work/airgapp/mobile && npx tsc --noEmit -p tsconfig.json && pnpm test 2>&1 | tail -4
```

- [x] **Step 8: Deploy and screenshot every screen**

```bash
cd /Users/ivan/Work/airgapp/mobile/android && ANDROID_HOME=$HOME/Library/Android/sdk ./gradlew :app:assembleDebug && cd .. && adb install -r android/app/build/outputs/apk/debug/app-debug.apk
```

Walk Home / Controls / Climate / Charging / Security / Schedules / Location, screenshotting each with `adb exec-out screencap -p > /tmp/and-<screen>.png`. Compare against the iPhone. **Per the `tesla-parity-verify-dont-infer` memory: measure, don't infer.** When a delta survives "the values look identical", measure the inputs.

- [x] **Step 9: Commit**

```bash
cd /Users/ivan/Work/airgapp/mobile
git add -A
git commit -m "feat(android): fonts, status-bar inset and tab inset parity

Co-Authored-By: Claude Opus 5 <noreply@anthropic.com>"
```

---


> **Corrections found while executing (evidence over plan):**
> - **Step 5 (`Fonts` in theme.ts) was wrong and was NOT applied.** `Fonts` is used in
>   exactly one place — `themed-text.tsx:69` for `Fonts.mono` — and its Android default
>   (`'monospace'`) is already correct. The app's real typography is `TeslaFonts`
>   (`src/constants/fonts.ts`, 18 files), loaded via `expo-font`'s `useFonts`, which is
>   cross-platform. `_layout.tsx:82` does `if (!fontsLoaded) return null`, and the app
>   renders on Android — so all four Universal Sans faces registered successfully.
> - **Step 6 (enable `StatusBarFade` on Android) was wrong and was NOT applied.** Its
>   `Platform.OS !== 'ios'` guard is deliberate parity: Tesla's own component is iOS-only
>   ("iOS-only, exactly as theirs is"). Removing it would *break* parity, not fix it.
> - **The real Android bug was elsewhere:** `teslaLibraryFallback`'s `isIPhoneX` test is
>   pure dimensions with no platform check, because in Tesla's iOS-only app it never
>   needed one. An Android phone at 375x812 or 414x896 dp would collect a 44pt phantom
>   notch, which Climate bakes into its height — silently rescaling the car. Fixed with
>   an `isApple` guard on the device id, with tests for both the trap and the iOS
>   non-regression.

# Phase 2 — Storage, assets and data

**Exit criterion:** the gazetteer, charger DB, log sink, recents and secure store all work on Android.

### Task 2.1: SQLite asset databases on Android

**Files:**
- Modify: `src/services/placeSource.ts`
- Modify: `src/services/chargerSource.ts`
- Test: `src/services/dbPaths.test.ts` (new)
- Create: `scripts/android/deploy-chargers.sh`

**Interfaces:**
- Consumes: `expo-sqlite`'s `importDatabaseFromAssetAsync`, `openDatabaseSync`.
- Produces: `chargerDbDir(): string | undefined` — the platform-correct directory for the pushed charger DB.

Two distinct mechanisms are in play and they behave differently on Android:
- `places.db` is **bundled** and imported via `SQLite.importDatabaseFromAssetAsync(PLACES_DB, { assetId: require('../../assets/places.db') })`. The `navigate-search-feature` memory records an iOS path quirk (`assets/assets/places.db`); Android resolves bundled assets differently again and must be verified, not assumed.
- `chargers.db` is **pushed** into `Documents/` by a deploy script (`chargerSource.ts:49` passes `documentsDir()`). Android has no `Documents` — the equivalent is `FileSystem.documentDirectory`, which maps to the app's private `files/` dir.

- [x] **Step 1: Write the failing test**

Create `src/services/dbPaths.test.ts`:

```ts
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { chargerDbDir } from './dbPaths';

test('ios keeps the Documents dir the iOS deploy script pushes to', () => {
  assert.equal(chargerDbDir('ios', '/app/Documents/'), '/app/Documents/');
});

test('android uses the app files dir, with no Documents subpath', () => {
  assert.equal(chargerDbDir('android', '/data/user/0/local.airgapp.mobile/files/'),
               '/data/user/0/local.airgapp.mobile/files/');
});
```

- [x] **Step 2: Run it and watch it fail**

```bash
cd /Users/ivan/Work/airgapp/mobile && pnpm test 2>&1 | grep -A6 "dbPaths"
```

- [x] **Step 3: Extract `chargerDbDir` into `src/services/dbPaths.ts`**

Move the existing `documentsDir()` logic out of `chargerSource.ts` into a pure, testable function taking `(os, documentDirectory)`. Keep `chargerSource.ts` calling it with `Platform.OS` and `FileSystem.documentDirectory`.

- [x] **Step 4: Run to verify it passes**

```bash
cd /Users/ivan/Work/airgapp/mobile && pnpm test 2>&1 | tail -4
```

- [x] **Step 5: Write `scripts/android/deploy-chargers.sh`**

```bash
#!/usr/bin/env bash
# Push the charger + gazetteer DBs into the Android app's private files dir.
# Analogue of scripts/godot-ios/deploy-chargers.sh. `adb push` cannot write to a private
# dir directly, so stage in /data/local/tmp and `run-as` the app to move it in.
set -euo pipefail
REPO="/Users/ivan/Work/airgapp/mobile"
PKG="local.airgapp.mobile"
DB="$REPO/scripts/osm/out/chargers.db"
[ -f "$DB" ] || { echo "ERROR: $DB missing — run the OSM build first." >&2; exit 1; }
echo "→ staging $(du -h "$DB" | cut -f1)"
adb push "$DB" /data/local/tmp/chargers.db
adb shell "run-as $PKG cp /data/local/tmp/chargers.db files/chargers.db"
adb shell rm /data/local/tmp/chargers.db
adb shell "run-as $PKG ls -l files/chargers.db"
echo "✓ chargers.db in place"
```

`chmod +x scripts/android/deploy-chargers.sh`. Note: `run-as` requires a **debuggable** build. For release builds, the app must copy the DB itself from a bundled asset — record that in the script header rather than discovering it later.

- [x] **Step 6: Verify on device**

```bash
cd /Users/ivan/Work/airgapp/mobile && bash scripts/android/deploy-chargers.sh && adb logcat -c && adb shell am force-stop local.airgapp.mobile && adb shell monkey -p local.airgapp.mobile -c android.intent.category.LAUNCHER 1 && sleep 6 && adb logcat -d -s ReactNativeJS:* | grep -i "charger\|places\|sqlite" | head -20
```

Then open the Charging tab on the device and confirm stations appear. Per the `ev-charger-data-providers` memory, `chargerSource.ts` is the **sole** source — there is no bundled fallback, so an empty list means the DB genuinely did not land.

- [x] **Step 7: Verify `places.db` imports**

Open Navigate search, type three characters, confirm offline gazetteer hits appear. If `importDatabaseFromAssetAsync` throws, log the exact resolved path and fix the asset reference — do not guess at a path shape.

- [x] **Step 8: Commit**

```bash
cd /Users/ivan/Work/airgapp/mobile
git add -A
git commit -m "feat(android): SQLite asset + pushed DBs (places, chargers)

Co-Authored-By: Claude Opus 5 <noreply@anthropic.com>"
```

---

### Task 2.2: Secure store, keystore and the `expo-bg-task` Android sibling

**Files:**
- Create: `modules/expo-bg-task/android/build.gradle`
- Create: `modules/expo-bg-task/android/src/main/java/expo/modules/bgtask/BgTaskModule.kt`
- Modify: `modules/expo-bg-task/expo-module.config.json`
- Test: `src/ble/keystore.test.ts` (verify it still passes unchanged)

**Interfaces:**
- Consumes: the frozen TS contract in `modules/expo-bg-task/index.ts` — `beginBackgroundTask(name: string): number | null`, `endBackgroundTask(id: number): void`.
- Produces: an Android module named `BgTask` implementing both.

iOS's `beginBackgroundTask` buys ~30s of execution after backgrounding. Android's equivalent is a short-lived foreground service, but for a 25s command deadline a `WakeLock` is the honest, proportionate analogue — Android does not suspend a process the instant it backgrounds; it Dozes it later. Take a partial wake lock and release it on `end`.

- [x] **Step 1: Add android to the module config**

`modules/expo-bg-task/expo-module.config.json`:

```json
{
  "platforms": ["apple", "android"],
  "apple": { "modules": ["BgTaskModule"] },
  "android": { "modules": ["expo.modules.bgtask.BgTaskModule"] }
}
```

- [x] **Step 2: Write `modules/expo-bg-task/android/build.gradle`**

```gradle
plugins {
  id 'com.android.library'
  id 'expo-module-gradle-plugin'
}
group = 'expo.modules.bgtask'
version = '0.1.0'
android {
  namespace "expo.modules.bgtask"
  defaultConfig { versionCode 1; versionName "0.1.0" }
  lintOptions { abortOnError false }
}
```

- [x] **Step 3: Write `BgTaskModule.kt`**

```kotlin
package expo.modules.bgtask

import android.content.Context
import android.os.PowerManager
import expo.modules.kotlin.modules.Module
import expo.modules.kotlin.modules.ModuleDefinition
import java.util.concurrent.atomic.AtomicInteger

// Android analogue of iOS's UIApplication.beginBackgroundTask. iOS buys ~30s of post-background
// execution; Android does not suspend on background at all, it Dozes later — so a PARTIAL_WAKE_LOCK
// with the same 30s ceiling is the proportionate equivalent for our 25s command deadline.
class BgTaskModule : Module() {
  private val locks = mutableMapOf<Int, PowerManager.WakeLock>()
  private val nextId = AtomicInteger(1)

  override fun definition() = ModuleDefinition {
    Name("BgTask")

    Function("beginBackgroundTask") { name: String ->
      val pm = appContext.reactContext?.getSystemService(Context.POWER_SERVICE) as? PowerManager
        ?: return@Function null
      val lock = pm.newWakeLock(PowerManager.PARTIAL_WAKE_LOCK, "airgapp:$name")
      lock.setReferenceCounted(false)
      lock.acquire(30_000L)
      val id = nextId.getAndIncrement()
      synchronized(locks) { locks[id] = lock }
      id
    }

    Function("endBackgroundTask") { id: Int ->
      val lock = synchronized(locks) { locks.remove(id) }
      if (lock?.isHeld == true) lock.release()
    }
  }
}
```

- [x] **Step 4: Add the WAKE_LOCK permission**

Create `modules/expo-bg-task/android/src/main/AndroidManifest.xml`:

```xml
<manifest>
  <uses-permission android:name="android.permission.WAKE_LOCK" />
</manifest>
```

- [x] **Step 5: Build and verify autolinking picked it up**

```bash
cd /Users/ivan/Work/airgapp/mobile/android && ANDROID_HOME=$HOME/Library/Android/sdk ./gradlew :app:assembleDebug 2>&1 | grep -i "bgtask\|BUILD"
```

Expected: `BUILD SUCCESSFUL` and the module compiled.

- [x] **Step 6: Verify at runtime**

```bash
cd /Users/ivan/Work/airgapp/mobile && adb install -r android/app/build/outputs/apk/debug/app-debug.apk && adb shell dumpsys power | grep -i "airgapp" 
```

Trigger a car command from the app, background it, and confirm a `PARTIAL_WAKE_LOCK` named `airgapp:*` appears and then disappears.

- [x] **Step 7: Verify `expo-secure-store` works**

`expo-secure-store` is cross-platform (Android Keystore-backed). The `share-extension-sends-natively` memory notes the service name `app:no-auth` — that is an iOS keychain concept. Confirm `src/ble/secureStoreSecretStore.ts` round-trips on Android:

```bash
adb logcat -c && adb shell monkey -p local.airgapp.mobile -c android.intent.category.LAUNCHER 1 && sleep 6 && adb logcat -d -s ReactNativeJS:* | grep -i "keystore\|secure\|fingerprint" | head
```

Enroll a key in the app and confirm `deviceKeyFingerprint` is stable across a force-stop + relaunch.

- [x] **Step 8: Commit**

```bash
cd /Users/ivan/Work/airgapp/mobile
git add -A
git commit -m "feat(android): expo-bg-task sibling (wake lock) + secure-store verification

Co-Authored-By: Claude Opus 5 <noreply@anthropic.com>"
```

---

# Phase 3 — BLE central on Android

**Exit criterion:** the app connects to the car over BLE from Android and successfully sends a lock/unlock command. **This is the phase that makes the app actually useful.**

The whole Tesla protocol — framing, session, signing, protobuf, VCSEC parsing, the reconciler — is already in TypeScript and platform-agnostic (`src/ble/*`, 936 passing tests). Android needs only the byte pipe. The contract is `modules/expo-passive-entry/index.ts`, already read and frozen.

### Task 3.1: Android BLE permissions and the runtime request

**Files:**
- Create: `modules/expo-passive-entry/android/build.gradle`
- Create: `modules/expo-passive-entry/android/src/main/AndroidManifest.xml`
- Modify: `modules/expo-passive-entry/expo-module.config.json`
- Test: `src/ble/blePermissions.test.ts` (new)

**Interfaces:**
- Consumes: nothing.
- Produces: an installed APK holding `BLUETOOTH_SCAN` (with `neverForLocation`), `BLUETOOTH_CONNECT`, and `ACCESS_FINE_LOCATION`.

- [x] **Step 1: Write the manifest**

`modules/expo-passive-entry/android/src/main/AndroidManifest.xml`:

```xml
<manifest xmlns:android="http://schemas.android.com/apk/res/android">
  <!-- Android 12+ split the old BLUETOOTH/BLUETOOTH_ADMIN pair into runtime permissions.
       BLUETOOTH_SCAN WITHOUT neverForLocation silently returns zero results unless
       ACCESS_FINE_LOCATION is also granted — the classic silent BLE failure. We declare
       neverForLocation because we never derive location from a scan result. -->
  <uses-permission android:name="android.permission.BLUETOOTH_SCAN"
                   android:usesPermissionFlags="neverForLocation"
                   tools:targetApi="s" />
  <uses-permission android:name="android.permission.BLUETOOTH_CONNECT" />
  <uses-feature android:name="android.hardware.bluetooth_le" android:required="true" />
</manifest>
```

- [x] **Step 2: Write the failing test for the permission gate**

Create `src/ble/blePermissions.test.ts`:

```ts
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { requiredBlePermissions } from './blePermissions';

test('android 31+ needs the split runtime permissions, not the legacy pair', () => {
  assert.deepEqual(requiredBlePermissions('android', 36), [
    'android.permission.BLUETOOTH_SCAN',
    'android.permission.BLUETOOTH_CONNECT',
  ]);
});

test('android below 31 needs fine location instead', () => {
  assert.deepEqual(requiredBlePermissions('android', 29), [
    'android.permission.ACCESS_FINE_LOCATION',
  ]);
});

test('ios needs no explicit runtime BLE permission list', () => {
  assert.deepEqual(requiredBlePermissions('ios', 0), []);
});
```

- [x] **Step 3: Run it and watch it fail**

```bash
cd /Users/ivan/Work/airgapp/mobile && pnpm test 2>&1 | grep -A6 "blePermissions"
```

- [x] **Step 4: Write `src/ble/blePermissions.ts`** implementing exactly those three cases.

- [x] **Step 5: Run to verify it passes**

```bash
cd /Users/ivan/Work/airgapp/mobile && pnpm test 2>&1 | tail -4
```

- [x] **Step 6: Verify the merged manifest on device**

```bash
cd /Users/ivan/Work/airgapp/mobile/android && ANDROID_HOME=$HOME/Library/Android/sdk ./gradlew :app:assembleDebug && cd .. && adb install -r android/app/build/outputs/apk/debug/app-debug.apk && adb shell dumpsys package local.airgapp.mobile | grep -A20 "requested permissions"
```

Expected: `BLUETOOTH_SCAN`, `BLUETOOTH_CONNECT` present.

- [x] **Step 7: Commit**

```bash
cd /Users/ivan/Work/airgapp/mobile
git add -A
git commit -m "feat(android): BLE runtime permissions (neverForLocation scan)

Co-Authored-By: Claude Opus 5 <noreply@anthropic.com>"
```

---

### Task 3.2: `PassiveEntryCentral.kt` — scan, connect, MTU, notify

**Files:**
- Create: `modules/expo-passive-entry/android/src/main/java/expo/modules/passiveentry/PassiveEntryCentral.kt`
- Reference: `modules/expo-passive-entry/ios/PassiveEntryCentral.swift` (883 lines — the behavioural spec)

**Interfaces:**
- Consumes: `src/ble/bleScanName.ts` (the advertised-name derivation, already TS-tested) via the VIN passed to `start()`.
- Produces: a Kotlin object exposing `start(vin)`, `stop()`, `isRunning()`, `writeFrame(ByteArray): Boolean`, `connectionState(): Pair<String, Int>`, and three callbacks — `onFrame(ByteArray)`, `onConnectionState(state, mtu)`, `onLog(String)`.

The GATT contract, read from the Swift and the TS: service/characteristic UUIDs for the Tesla vehicle service, **write to `…0212`**, **notify on `…0213`**, frames carry a 2-byte big-endian length prefix (`src/ble/bleFraming.ts`), and `blockLength = mtu - 3`.

- [x] **Step 1: Extract the exact UUIDs and scan-name rule from the iOS implementation**

```bash
cd /Users/ivan/Work/airgapp/mobile && grep -n "CBUUID\|0212\|0213\|scanName\|withServices" modules/expo-passive-entry/ios/PassiveEntryCentral.swift | head -30 && sed -n '1,60p' src/ble/bleScanName.ts
```

Copy the literal UUID strings. Do not retype them from memory.

- [x] **Step 2: Write the failing test for the framing contract Android must honour**

`src/ble/bleFraming.test.ts` already covers framing and is platform-agnostic — it must keep passing untouched. Instead add a device-level assertion to `src/ble/transport.test.ts`:

```ts
test('blockLength is derived as mtu - 3 regardless of platform', () => {
  assert.equal(blockLengthForMtu(23), 20);
  assert.equal(blockLengthForMtu(517), 514);
});
```

- [x] **Step 3: Run it and watch it fail**, then implement `blockLengthForMtu` if it is not already exported. (Check first: `grep -rn "mtu - 3\|mtu-3" src/ble/`.)

- [x] **Step 4: Write `PassiveEntryCentral.kt`**

Structure it as a direct mirror of the Swift, section for section, so a reviewer can diff them:

- `BluetoothLeScanner.startScan` with a `ScanFilter` on the derived device name; `SCAN_MODE_LOW_LATENCY`.
- On match: `stopScan`, then `device.connectGatt(ctx, false, callback, TRANSPORT_LE)`.
- `onConnectionStateChange` → emit `connectionState`; on CONNECTED call `gatt.requestMtu(517)`.
- `onMtuChanged` → record mtu, then `gatt.discoverServices()`.
- `onServicesDiscovered` → grab 0212 (write) + 0213 (notify), `setCharacteristicNotification(0213, true)`, and **write the CCCD descriptor `00002902-0000-1000-8000-00805f9b34fb` with `ENABLE_NOTIFICATION_VALUE`** — Android does not enable notifications without this, a classic silent-failure.
- `onCharacteristicChanged` → `onFrame(value)`.
- `writeFrame` → chunk to `mtu - 3`, `WRITE_TYPE_NO_RESPONSE`, serialised behind a single-writer mutex (the TS side already guarantees one writer; the Kotlin side must not reorder).
- Autoconnect on unexpected disconnect, with the same backoff the Swift uses.

- [x] **Step 5: Build**

```bash
cd /Users/ivan/Work/airgapp/mobile/android && ANDROID_HOME=$HOME/Library/Android/sdk ./gradlew :app:assembleDebug 2>&1 | tail -20
```

- [x] **Step 6: Commit**

```bash
cd /Users/ivan/Work/airgapp/mobile
git add -A
git commit -m "feat(android): PassiveEntryCentral — GATT scan/connect/MTU/notify

Co-Authored-By: Claude Opus 5 <noreply@anthropic.com>"
```

---

### Task 3.3: `PassiveEntryModule.kt` — the Expo surface

**Files:**
- Create: `modules/expo-passive-entry/android/src/main/java/expo/modules/passiveentry/PassiveEntryModule.kt`
- Create: `modules/expo-passive-entry/android/src/main/java/expo/modules/passiveentry/KeystoreKey.kt`
- Modify: `modules/expo-passive-entry/expo-module.config.json`

**Interfaces:**
- Consumes: `PassiveEntryCentral` from Task 3.2.
- Produces: an Expo module named `PassiveEntry` with exactly the functions `modules/expo-passive-entry/index.ts` calls: `start`, `stop`, `isRunning`, `sealGolden`, `ecdhGolden`, `handshakeGolden`, `setDeviceKey`, `deviceFingerprint`, `writeFrame`, `connectionState`, `setForegroundResponderActive`, `postCpdWarning`, `setCarLocation`, `requestAlwaysLocation`; and the events `log`, `frame`, `connectionState`, `bondRemoved`.

- [x] **Step 1: Enumerate the contract from the TS, not from memory**

```bash
cd /Users/ivan/Work/airgapp/mobile && grep -oP "PassiveEntryModule\?\.\K\w+" modules/expo-passive-entry/index.ts | sort -u && grep -oP "addListener\('\K[a-zA-Z]+" modules/expo-passive-entry/index.ts | sort -u
```

Every name printed must exist in the Kotlin module. A missing one is a silent no-op at runtime, not a compile error.

- [x] **Step 2: Implement the module**

Base64 in/out on `writeFrame`/`frame` (matching iOS: `frameB64`, `dataB64`). For this task, the three `*Golden()` functions may return `"android: not implemented"` — they are diagnostics comparing native crypto against the TS goldens, and native crypto only exists once Task 4.2 lands. **Do not return a fake-passing string**; a diagnostic that lies is worse than one that abstains.

`KeystoreKey.kt` stores the P-256 private key. Note: the Android Keystore cannot export a raw private key, and `VcsecSigner` needs the scalar for ECDH. Store the key in `EncryptedSharedPreferences` (Jetpack Security, master key in the Keystore) rather than as a Keystore key object — the same trade-off `KeychainKey.swift` makes with a non-`kSecAttrTokenIDSecureEnclave` key.

- [x] **Step 3: Register android in the module config**

```json
{
  "platforms": ["apple", "android"],
  "apple": {
    "modules": ["PassiveEntryModule"],
    "appDelegateSubscribers": ["PassiveEntryAppDelegate"]
  },
  "android": { "modules": ["expo.modules.passiveentry.PassiveEntryModule"] }
}
```

- [x] **Step 4: Build and confirm the module registers**

```bash
cd /Users/ivan/Work/airgapp/mobile/android && ANDROID_HOME=$HOME/Library/Android/sdk ./gradlew :app:assembleDebug && cd .. && adb install -r android/app/build/outputs/apk/debug/app-debug.apk && adb logcat -c && adb shell monkey -p local.airgapp.mobile -c android.intent.category.LAUNCHER 1 && sleep 6 && adb logcat -d -s ReactNativeJS:* | grep -i "passive\|native module absent" | head
```

Expected: **no** `native module absent` lines.

- [x] **Step 5: Commit**

```bash
cd /Users/ivan/Work/airgapp/mobile
git add -A
git commit -m "feat(android): PassiveEntryModule Expo surface + keystore-backed device key

Co-Authored-By: Claude Opus 5 <noreply@anthropic.com>"
```

---

### Task 3.4: First real command to the car from Android

**Files:**
- Modify: `src/ble/transportSelector.ts` (only if it gates on `Platform.OS`)
- Test: on-device, with the car

**Interfaces:**
- Consumes: everything from Tasks 3.1–3.3.
- Produces: a verified door unlock from the Galaxy S22.

- [ ] **Step 1: Confirm the selector is not iOS-gated**

```bash
cd /Users/ivan/Work/airgapp/mobile && grep -n "Platform" src/ble/transportSelector.ts src/state/useCarLink.ts | head
```

If either gates the bridged transport to iOS, widen the gate to `ios || android`.

- [ ] **Step 2: Enroll the phone as a key**

Follow the existing enroll flow in `src/app/carlink.tsx` on the Android device (tap-to-add-key at the card reader). Watch the log stream:

```bash
adb logcat -c && adb logcat -s ReactNativeJS:* | grep -i "enroll\|whitelist\|addKey\|fingerprint"
```

- [ ] **Step 3: Send a lock command and capture the full exchange**

```bash
adb logcat -c && adb logcat -s ReactNativeJS:* > /tmp/android-lock.log &
```

Tap Lock in the app, then read `/tmp/android-lock.log`.

**Per the `vcsec-lock-door-open-silent` memory: if the command appears to do nothing, dump and decode the raw reply before theorizing.** A refused VCSEC command reports itself as a plaintext `FromVCSECMessage.nominalError.genericError` inside `RoutableMessage.protobufMessageAsBytes` — `parseVcsecNominalError` in `src/ble/` already handles it, so the bytes are there to read.

- [ ] **Step 4: Verify the car physically responds** — doors lock, then unlock.

- [ ] **Step 5: Run the full TS suite against the real link's behaviour**

```bash
cd /Users/ivan/Work/airgapp/mobile && pnpm test 2>&1 | tail -4
```

- [ ] **Step 6: Commit**

```bash
cd /Users/ivan/Work/airgapp/mobile
git add -A
git commit -m "feat(android): first verified BLE command to the car from SM-S901B

Co-Authored-By: Claude Opus 5 <noreply@anthropic.com>"
```

---

# Phase 4 — Background passive entry

**Exit criterion:** the car unlocks on approach with the app backgrounded.

### Task 4.1: `PassiveEntryService.kt` — the foreground service

**Files:**
- Create: `modules/expo-passive-entry/android/src/main/java/expo/modules/passiveentry/PassiveEntryService.kt`
- Create: `.../Notifier.kt`
- Modify: `modules/expo-passive-entry/android/src/main/AndroidManifest.xml`

**Interfaces:**
- Consumes: `PassiveEntryCentral`.
- Produces: a `connectedDevice`-type foreground service that owns the central while the app is backgrounded.

iOS uses CoreBluetooth state restoration; Android has no equivalent, and a backgrounded process loses its BLE callbacks to Doze. A foreground service with a persistent notification is the only reliable mechanism. This is a **visible UX difference from iOS** and must be surfaced in the app's passive-entry settings copy, not hidden.

- [ ] **Step 1: Declare the service**

```xml
<service
  android:name=".PassiveEntryService"
  android:foregroundServiceType="connectedDevice"
  android:exported="false" />
```

- [ ] **Step 2: Implement the service** — `startForeground` with a low-importance notification channel, hand ownership of `PassiveEntryCentral` to it, stop it in `setForegroundResponderActive(true)`'s inverse.

- [ ] **Step 3: Verify it survives backgrounding**

```bash
adb shell am force-stop local.airgapp.mobile; adb shell monkey -p local.airgapp.mobile -c android.intent.category.LAUNCHER 1; sleep 8; adb shell input keyevent KEYCODE_HOME; sleep 20; adb shell dumpsys activity services local.airgapp.mobile | grep -i "PassiveEntryService\|isForeground"
```

Expected: the service is listed and `isForeground=true`.

- [ ] **Step 4: Verify BLE frames still arrive while backgrounded**

```bash
adb logcat -c && adb shell input keyevent KEYCODE_HOME && sleep 60 && adb logcat -d | grep -i "PassiveEntry.*frame\|challenge" | head
```

Walk toward the car during those 60s. Per the `passive-entry-challenge-f3` memory, the car sends `f3{f2{f1=20B nonce},f3=2,f4=1B}` at roughly 1 Hz on approach — those frames appearing in the log is the success signal.

- [ ] **Step 5: Commit.**

---

### Task 4.2: `VcsecSigner.kt` — background self-signing

**Files:**
- Create: `.../VcsecSigner.kt`
- Reference: `modules/expo-passive-entry/ios/VcsecSigner.swift` (312 lines), `modules/expo-passive-entry/ios/routableSeal.golden.json`, `ecdh.golden.json`

**Interfaces:**
- Consumes: the same golden JSON fixtures the iOS signer validates against — they are platform-neutral and already in the repo.
- Produces: `sealGolden()`, `ecdhGolden()`, `handshakeGolden()` returning **"OK"** only on a genuine byte-for-byte match.

The `foregroundBleLink` single-writer rule is absolute: in the foreground TS signs, in the background native signs, and the two must never sign concurrently (they share the VS counter). `setForegroundResponderActive` is that gate — honour it exactly as the Swift does.

- [ ] **Step 1: Implement P-256 ECDH + SHA1-KDF + AES-GCM** using `java.security` / `javax.crypto` with the BouncyCastle-free platform providers.

- [ ] **Step 2: Wire the three golden checks** to load the same JSON fixtures.

- [ ] **Step 3: Verify the goldens pass on device**

Open the carlink debug screen (`src/app/carlink.tsx` already renders `passiveEntrySealGolden()` etc.) and confirm all three read **OK**, not "not implemented".

- [ ] **Step 4: Verify a real background unlock** — lock the phone, walk to the car, confirm it unlocks.

- [ ] **Step 5: Commit.**

---

### Task 4.3: `CarRegionMonitor.kt` — geofence re-arm

**Files:**
- Create: `.../CarRegionMonitor.kt`
- Reference: `modules/expo-passive-entry/ios/CarRegionMonitor.swift` (340 lines)

**Interfaces:**
- Consumes: `setCarLocation(lat, lon)` and `requestAlwaysLocation()` from the frozen TS contract.
- Produces: a `GeofencingClient` registration that restarts `PassiveEntryService` on region entry, surviving a reboot.

- [ ] **Step 1: Implement with `LocationServices.getGeofencingClient`** plus a `BOOT_COMPLETED` receiver to re-register — the iOS version's whole point is surviving a phone reboot, which CB restoration does not.
- [ ] **Step 2: Verify** with `adb shell am broadcast -a android.intent.action.BOOT_COMPLETED` and a mock location.
- [ ] **Step 3: Commit.**

---

# Phase 5 — Maps, search and share intake

**Exit criterion:** Location renders a real map with the car marker, Navigate search returns online results, and sharing a location from another app reaches the car.

### Task 5.1: The `MapSurface` adapter

**Files:**
- Create: `src/components/MapSurface.tsx` (iOS — wraps `react-native-maps`)
- Create: `src/components/MapSurface.android.tsx` (MapLibre)
- Create: `src/components/mapSurface.types.ts`
- Test: `src/components/mapSurface.test.ts`
- Modify: `src/app/location.tsx` (944 lines — the **only** `react-native-maps` consumer)

**Interfaces:**
- Consumes: nothing new.
- Produces: `<MapSurface>` with props `{ region, onRegionChange, onPress, onPoiPress, markers, mapType, style }` and a ref exposing `{ animateToRegion(r), deselectFeatures() }`.

`location.tsx` imports exactly `MapView, { Marker, PROVIDER_DEFAULT, type MapType, type Region }`, plus the two patched extras (`onPoiClick`, `deselectFeatures`) from `patches/react-native-maps@1.27.2.patch`. That is a small enough surface to adapt cleanly.

- [x] **Step 1: Write the failing test** for the pure parts — region↔bounds conversion and the POI-tap payload normaliser, which differ between Apple's `onPoiClick` event and MapLibre's `queryRenderedFeatures` result.

```ts
test('a maplibre queryRenderedFeatures hit normalises to the same PoiTap shape as apple onPoiClick', () => {
  const apple = { nativeEvent: { name: 'Cafe', coordinate: { latitude: 1, longitude: 2 } } };
  const maplibre = { properties: { name: 'Cafe' }, geometry: { type: 'Point', coordinates: [2, 1] } };
  assert.deepEqual(normalizeApplePoi(apple), { name: 'Cafe', latitude: 1, longitude: 2 });
  assert.deepEqual(normalizeMapLibrePoi(maplibre), { name: 'Cafe', latitude: 1, longitude: 2 });
});
```

Note the coordinate order flip — GeoJSON is `[lon, lat]`. That flip is exactly the kind of thing that produces a marker in the ocean, so it gets a test.

- [x] **Step 2: Run it and watch it fail.**

- [x] **Step 3: Install MapLibre**

```bash
cd /Users/ivan/Work/airgapp/mobile && pnpm add @maplibre/maplibre-react-native@11.3.6
```

Peer deps check out: `react-native >=0.80` (we have 0.85.3), `expo >=54` (we have 56), `react >=19.1` (we have 19.2.3). MIT-licensed, no API key, no account.

- [x] **Step 4: Implement both `MapSurface` files.** Android uses the **OpenFreeMap** style URL `https://tiles.openfreemap.org/styles/liberty` — free, keyless, unlimited, community-run OSM vector tiles. POI taps come from `queryRenderedFeatures` at the tap point against the style's POI layer.

- [x] **Step 5: Add the tile host to the Tesla-host guard's reasoning**

```bash
cd /Users/ivan/Work/airgapp/mobile && pnpm test 2>&1 | grep -A6 "no-tesla-servers"
```

`tiles.openfreemap.org` is not a Tesla host, so the guard should pass unchanged — **confirm that, don't assume it.** If the guard is an allowlist rather than a denylist, add the host with a comment.

- [x] **Step 6: Rewrite `location.tsx` against `MapSurface`.** iOS must render identically — screenshot-diff before/after on the iPhone.

- [x] **Step 7: Verify both platforms**

```bash
cd /Users/ivan/Work/airgapp/mobile && npx tsc --noEmit -p tsconfig.json && pnpm test 2>&1 | tail -4 && bash scripts/godot-ios/deploy-js.sh
```

Then rebuild Android (MapLibre is a native dep — this needs a full `assembleDebug`, not a JS push) and compare the Location screen on both.

- [x] **Step 8: Commit.**

---

### Task 5.2: Photon geocoding as Android's `appleSearch`

**Files:**
- Create: `src/services/photonSearch.ts`
- Test: `src/services/photonSearch.test.ts`
- Modify: `src/services/searchProvider.ts`

**Interfaces:**
- Consumes: the `Place` / `SearchRegion` shapes from `src/services/place.ts`.
- Produces: `photonComplete(q, region): Promise<Place[]>`, `photonSearch(q, region): Promise<Place[]>`, `photonResolve(place, region): Promise<Place>` — signature-identical to `appleSearch.ts`'s three exports so `searchProvider` can swap them by platform.

Photon (`photon.komoot.io`) is a free, keyless OSM geocoder built for typeahead. It is the closest analogue to MKLocalSearch's completion API.

- [x] **Step 1: Write the failing test** with a stubbed `fetch`, asserting the Photon GeoJSON response maps to the same `Place` shape `appleComplete` produces — including `source: 'photon'`, `kind: 'poi'`, and `coordinate` present on search but the `id` format matching `appleSearch`'s `${source}:${i}:${title}` convention.

- [x] **Step 2: Run it and watch it fail.**

- [x] **Step 3: Implement `photonSearch.ts`.** Photon returns GeoJSON — remember `[lon, lat]`. Send a descriptive `User-Agent`; the public instance asks for one.

- [x] **Step 4: Platform-switch in `searchProvider.ts`** — `Platform.OS === 'ios' ? appleComplete : photonComplete`, etc. The offline gazetteer path is unchanged and remains the fallback on both platforms.

- [x] **Step 5: Verify** — `pnpm test`, then search "Zagreb" on the device and confirm online results appear alongside gazetteer hits.

- [x] **Step 6: Commit.**

---

### Task 5.3: Share intake via `ACTION_SEND`

**Files:**
- Create: `modules/shared-intake/android/src/main/java/expo/modules/sharedintake/SharedIntakeModule.kt`
- Modify: `modules/shared-intake/expo-module.config.json`
- Modify: `app.json` (intent filters)

**Interfaces:**
- Consumes: the frozen `modules/shared-intake/index.ts` contract and `src/hooks/useSharedLocationIntake.ts`.
- Produces: the same pending-intent slot semantics the iOS share extension provides.

Android's model is fundamentally simpler than iOS's: no separate extension process, no JSC-runs-our-TS trick, no `setTimeout`-less environment. An `ACTION_SEND` intent filter on the main activity delivers the shared text straight to the app.

- [ ] **Step 1: Add the intent filter to `app.json`** under `expo.android.intentFilters`, matching `text/plain` for `ACTION_SEND`.

- [ ] **Step 2: Implement the module** to read `intent.getStringExtra(Intent.EXTRA_TEXT)` and expose it through the existing contract.

- [ ] **Step 3: Reuse the existing URL resolution.** `modules/shared-location-resolver` is a Swift package, but `src/hooks/useSharedLocationIntake.ts` holds the JS-side logic. The `share-extension-sends-natively` memory records the Google-302 gotcha — *read the `Location` header, don't follow blindly*. That logic must apply on Android too; if it currently lives in Swift, port it to TS so both platforms share it (and gain a test).

- [ ] **Step 4: Verify** — share a Google Maps link from Chrome on the device into Airgapp; confirm the place preview sheet opens with the right coordinate. Per the `shared-location-intake` memory, there is a **single `pendingSharedIntent` slot** and Cancel rewinds it — test the cancel path explicitly.

- [ ] **Step 5: Commit.**

---

# Phase 6 — Godot engine embed

**Exit criterion:** the real vehicle renders on Android with correct model, colour, wheels and marker overlays.

Read `modules/expo-godot-view/ios/VENDORING.md` and `GODOT_INTEGRATION.md` before starting. The Android approach mirrors iOS exactly: **prebuilt engine binary + a thin host**, never an engine source build.

### Task 6.1: Vendor the prebuilt engine

**Files:**
- Create: `scripts/android/vendor-engine.sh`
- Create: `modules/expo-godot-view/android/VENDORING.md`
- Modify: `modules/expo-godot-view/android/build.gradle`
- Modify: `.gitignore`

**Interfaces:**
- Produces: `modules/expo-godot-view/android/src/main/jniLibs/{arm64-v8a,x86_64}/libgodot_android.so`.

The engine ships inside `~/Library/Application Support/Godot/templates/3.2.2.stable/android_source.zip` → `libs/release/godot-lib.release.aar` → `jni/<abi>/libgodot_android.so`. All four ABIs are present including **x86_64**, so the Android emulator can run the full app — unlike iOS, where the 2020 engine has no arm64-simulator slice.

- [x] **Step 1: Write `scripts/android/vendor-engine.sh`**

```bash
#!/usr/bin/env bash
# Extract the prebuilt Godot 3.2.2 Android engine into the expo module's jniLibs.
# Mirrors modules/expo-godot-view/ios/VENDORING.md's restore step. ~50 MB of gitignored binaries.
set -euo pipefail
TPL="$HOME/Library/Application Support/Godot/templates/3.2.2.stable/android_source.zip"
DEST="/Users/ivan/Work/airgapp/mobile/modules/expo-godot-view/android/src/main/jniLibs"
[ -f "$TPL" ] || { echo "ERROR: $TPL missing — install the 3.2.2 export templates." >&2; exit 1; }
TMP="$(mktemp -d)"; trap 'rm -rf "$TMP"' EXIT
unzip -o -q -j "$TPL" 'libs/release/godot-lib.release.aar' -d "$TMP"
unzip -o -q "$TMP/godot-lib.release.aar" 'jni/*' -d "$TMP/aar"
for abi in arm64-v8a x86_64; do
  mkdir -p "$DEST/$abi"
  cp "$TMP/aar/jni/$abi/libgodot_android.so" "$DEST/$abi/"
  echo "  $abi: $(du -h "$DEST/$abi/libgodot_android.so" | cut -f1)"
done
echo "✓ engine vendored (libc++_shared.so deliberately NOT copied — RN ships a newer one)"
```

- [x] **Step 2: Run it**

```bash
cd /Users/ivan/Work/airgapp/mobile && chmod +x scripts/android/vendor-engine.sh && bash scripts/android/vendor-engine.sh
```

Expected: arm64-v8a ≈ 24 MB, x86_64 ≈ 27 MB.

- [x] **Step 3: Gitignore the binaries** and write `VENDORING.md` explaining the restore, mirroring the iOS one.

- [x] **Step 4: Wire jniLibs + the packaging fix into `build.gradle`**

```gradle
android {
  namespace "expo.modules.godotview"
  defaultConfig {
    versionCode 1
    versionName "0.1.0"
    ndk { abiFilters 'arm64-v8a', 'x86_64' }
  }
  sourceSets { main { jniLibs.srcDirs += ['src/main/jniLibs'] } }
  packagingOptions {
    // RN and the Godot AAR both ship libc++_shared.so. Prefer RN's (newer) copy.
    pickFirst 'lib/**/libc++_shared.so'
    // The 24 MB engine must stay uncompressed so it can be mmap'd from the APK.
    jniLibs { useLegacyPackaging false }
  }
  lintOptions { abortOnError false }
}
```

- [x] **Step 5: Build and confirm the `.so` is in the APK**

```bash
cd /Users/ivan/Work/airgapp/mobile/android && ANDROID_HOME=$HOME/Library/Android/sdk ./gradlew :app:assembleDebug && unzip -l app/build/outputs/apk/debug/app-debug.apk | grep -E "libgodot|libc\+\+"
```

Expected: exactly one `libgodot_android.so` per ABI and exactly one `libc++_shared.so` per ABI.

- [x] **Step 6: Commit.**

---

### Task 6.2: Prove the engine loads on the device (16 KB page-size check)

**Files:** none — this is a measurement task, but it gates everything after it.

- [x] **Step 1: Check the device page size**

```bash
adb shell getconf PAGE_SIZE
```

Expected on the S22: `4096`. If it prints `16384`, Risk 1 has fired — stop and rebuild the engine from `godot-src` with a modern NDK before continuing.

- [x] **Step 2: Check the `.so`'s alignment**

```bash
cd /Users/ivan/Work/airgapp/mobile && ~/Library/Android/sdk/ndk/*/toolchains/llvm/prebuilt/darwin-x86_64/bin/llvm-readelf -l modules/expo-godot-view/android/src/main/jniLibs/arm64-v8a/libgodot_android.so 2>/dev/null | grep -m1 "LOAD" 
```

Record the alignment. `0x1000` is 4 KB.

- [x] **Step 3: Prove it actually dlopens** — add a temporary `System.loadLibrary("godot_android")` in `ExpoGodotViewModule.kt`'s `OnCreate`, build, install, and check logcat for `UnsatisfiedLinkError`.

```bash
adb logcat -c && adb shell am force-stop local.airgapp.mobile && adb shell monkey -p local.airgapp.mobile -c android.intent.category.LAUNCHER 1 && sleep 6 && adb logcat -d | grep -iE "godot_android|UnsatisfiedLink|dlopen"
```

Expected: no `UnsatisfiedLinkError`. **This one command decides whether Phase 6 is a two-day task or a two-week one — run it before writing any host code.**

- [x] **Step 4: Record the result** in `modules/expo-godot-view/android/VENDORING.md` and commit.

---

### Task 6.3: Vendor and patch Godot's Java runtime

**Files:**
- Create: `modules/expo-godot-view/android/src/main/java/org/godotengine/godot/**` (from `godot-src`)
- Reference: `/Users/ivan/Work/airgapp/godot-src/platform/android/java/lib/src/org/godotengine/godot/` (5511 lines across ~20 files)

**Interfaces:**
- Produces: a concrete `org.godotengine.godot.Godot` that is a **hosted object, not an Activity**, satisfying every method `java_godot_wrapper.cpp` binds.

`java_godot_wrapper.cpp:44` does `FindClass("org/godotengine/godot/Godot")` — the class name and package are load-bearing and cannot change. Upstream declares it `public abstract class Godot extends FragmentActivity implements SensorEventListener, IDownloaderClient` (line 112), which cannot coexist with RN's `ReactActivity`. This task is the Android analogue of what `GodotHost.mm` does on iOS: keep the engine's expectations, drop the app-ownership.

- [x] **Step 1: Enumerate the exact JNI-bound method contract**

```bash
sed -n '40,75p' /Users/ivan/Work/airgapp/godot-src/platform/android/java/java_godot_wrapper.cpp
```

Every `GetMethodID` line is a method `Godot` must keep, with that exact signature. There are ~19. Write them into `VENDORING.md` as a checklist — this is the spec.

- [x] **Step 2: Copy the Java tree**

```bash
cp -R /Users/ivan/Work/airgapp/godot-src/platform/android/java/lib/src/org \
      /Users/ivan/Work/airgapp/mobile/modules/expo-godot-view/android/src/main/java/
```

- [x] **Step 3: Patch `Godot.java`** — change `extends FragmentActivity` to a plain class holding an `Activity` reference; replace `this` as Context with `activity`; drop the `IDownloaderClient` APK-expansion path entirely (we use `--main-pack`, not expansion files); keep every JNI-bound method from Step 1, no-oping the ones that only make sense for a full-screen Godot app (`restart`, `forceQuit`).

- [x] **Step 4: Build until it compiles**, deleting the downloader/`GodotDownloader*` files and the `com.google.android.vending` dependency they pull in.

- [x] **Step 5: Commit** with a `VENDORING.md` diff summary so the patch set is reviewable against upstream.

---

### Task 6.4: `GodotHost.kt` and the real `ExpoGodotView`

**Files:**
- Create: `.../expo/modules/godotview/GodotHost.kt`
- Modify: `.../expo/modules/godotview/ExpoGodotView.kt` (replaces the 42-line gray stub)
- Reference: `modules/expo-godot-view/ios/GodotHost.mm` (370 lines)

**Interfaces:**
- Consumes: the patched `Godot`, `GodotView`, `GodotLib` from Task 6.3.
- Produces: a `GodotHost` that boots the engine with `--main-pack <abs pck path>` and hands back a `GodotView` to embed.

`GodotHost.mm:76-82` builds argv as `<exe> --main-pack <abs path to airgapp.pck>`. The Android equivalent goes into `GodotLib.setup(String[])`.

- [x] **Step 1: Implement `GodotHost.kt`** — construct the patched `Godot`, create the `GodotView`, call `GodotLib.initialize(...)` on the main thread and `GodotLib.setup(arrayOf("airgapp", "--main-pack", pckPath))` on the GL thread, per `GodotLib.java`'s own doc comments (which state exactly which thread each call belongs on).

- [x] **Step 2: Fix z-ordering** — call `godotView.setZOrderMediaOverlay(true)` so RN's `MarkerOverlay` and `TirePressureOverlay` composite **above** the GLSurfaceView. Without this the overlays vanish (Risk 3).

- [x] **Step 3: Replace the gray stub in `ExpoGodotView.kt`**, keeping the `sceneName` prop contract.

- [x] **Step 4: Push the pck and verify first render**

```bash
cd /Users/ivan/Work/airgapp/mobile && adb push modules/expo-godot-view/ios/airgapp.pck /data/local/tmp/airgapp.pck && adb shell "run-as local.airgapp.mobile cp /data/local/tmp/airgapp.pck files/airgapp.pck"
```

(320 MB — this takes a minute. Task 7.1 turns it into a script.)

```bash
adb logcat -c && adb shell am force-stop local.airgapp.mobile && adb shell monkey -p local.airgapp.mobile -c android.intent.category.LAUNCHER 1 && sleep 15 && adb logcat -d | grep -iE "godot|GLThread|pck" | head -40 && adb exec-out screencap -p > /tmp/godot-android.png
```

Expected: the vehicle renders. **If the body textures garble, do not assume bad data** — the `s3x-ios-texture-garble` memory records exactly this symptom on iOS as an *engine* bug, fixed by the 3.2.0→3.2.2 swap. We are already on 3.2.2, so a garble on Android is a genuinely new finding; capture it before theorizing.

- [x] **Step 5: Commit.**

---

### Task 6.5: `AndroidGodotInterface` — the RN ↔ Godot message bridge

**Files:**
- Create: `.../expo/modules/godotview/AndroidGodotInterface.kt`
- Modify: `.../expo/modules/godotview/GodotBridge.kt` (replace the no-op stub)

**Interfaces:**
- Consumes: `GodotPlugin` from the vendored runtime.
- Produces: an engine singleton literally named `AndroidGodotInterface` exposing `sendMessage(String)`, `pendingMessagesCount(): Int`, `getMessage(): String`.

**`MobileComm.gd` already looks for this name** — `/Users/ivan/Work/airgapp/godot/mobile/scripts/MobileComm.gd:25` reads `if Engine.has_singleton("AndroidGodotInterface")`. **No GDScript changes are needed**, which means no `.pck` re-export for this task.

Crucially, unlike iOS — where `IOSGodotInterface.mm` is a C++ `Object` compiled into the app and registered with `Engine::add_singleton` — Android gets this **for free in pure Java** via Godot 3.2.2's plugin system: `GodotPlugin.onRegisterPluginWithGodotNative()` calls `nativeRegisterSingleton(getPluginName(), this)`. No engine rebuild, no C++.

- [x] **Step 1: Implement the plugin**

```kotlin
package expo.modules.godotview

import org.godotengine.godot.Godot
import org.godotengine.godot.plugin.GodotPlugin

// The engine singleton MobileComm.gd binds to on Android (MobileComm.gd:25). Exact mirror of
// IOSGodotInterface.mm's three-method contract:
//   sendMessage(json)      Godot → host  → GodotBridge.sendMessage (→ onGodotMessage RN event)
//   pendingMessagesCount() GDScript polls the host→Godot queue
//   getMessage()           GDScript drains it
// Registered as a pure-Java GodotPlugin — no engine rebuild, unlike the iOS C++ singleton.
class AndroidGodotInterface(godot: Godot) : GodotPlugin(godot) {
  override fun getPluginName() = "AndroidGodotInterface"
  override fun getPluginMethods() =
    listOf("sendMessage", "pendingMessagesCount", "getMessage")

  fun sendMessage(json: String) = GodotBridge.sendMessage(json)
  fun pendingMessagesCount(): Int = GodotBridge.pendingMessagesCount()
  fun getMessage(): String = GodotBridge.getMessage() ?: ""
}
```

- [x] **Step 2: Make `GodotBridge.addMessage` real** — the current stub explicitly no-ops (`// No Godot engine on Android yet (Phase 6). No-op.`). Enqueue onto `outbound` instead.

- [x] **Step 3: Verify the round trip**

```bash
adb logcat -c && adb shell monkey -p local.airgapp.mobile -c android.intent.category.LAUNCHER 1 && sleep 15 && adb logcat -d | grep -iE "AndroidGodotInterface|has_singleton|onGodotMessage" | head
```

Then change the car colour in the app and confirm the render updates — that is a host→Godot message completing the loop.

- [x] **Step 4: Verify the snapshot path.** Per the `tesla-per-car-image-is-godot-snapshot` memory, the Cars sheet thumbnail is a cached `file://` Godot PNG keyed by config hash, and `Snapshots.gd` scaffolds it. Confirm `SnapshotDriver.tsx` produces a PNG on Android; the write path differs (no iOS Documents dir).

- [x] **Step 5: Commit.**

---

# Phase 7 — Deploy tooling, verification and docs

**Exit criterion:** iterating on Android is as fast as on iOS, and parity is documented and proven.

### Task 7.1: Fast deploy scripts

**Files:**
- Create: `scripts/android/deploy-js.sh`
- Create: `scripts/android/deploy-godot.sh`
- Modify: `AGENTS.md`

**Interfaces:**
- Produces: a JS-only deploy in seconds and a pck swap in ~2 minutes, mirroring the iOS paths documented in `AGENTS.md`.

- [ ] **Step 1: Write `deploy-js.sh`.** Android's release APK embeds `index.android.bundle` in `assets/`, so a JS-only swap means re-signing the APK — slower than iOS's in-place bundle swap. **The faster path is a debug build with Metro**, or `adb push`ing the bundle to the app's files dir if the app is built to prefer it. Pick one, measure both, and document the actual timing rather than an assumed one. Source `.env.local` first — the `tomtom-charging-key` memory records that `expo export:embed` does **not** auto-load it.

- [ ] **Step 2: Write `deploy-godot.sh`** — re-export the pck from `/Users/ivan/Work/airgapp/godot` with the Android preset, push, restart.

- [ ] **Step 3: Time both** and record the real numbers.

- [ ] **Step 4: Add an Android section to `AGENTS.md`** in the same shape as the iOS one — deploy paths fastest-first, with the real measured timings. Note explicitly that **Android has no weekly provisioning-profile expiry**, which is the single biggest iOS friction this port removes.

- [ ] **Step 5: Commit.**

---

### Task 7.2: Parity verification sweep

**Files:**
- Create: `docs/android-parity.md`

- [ ] **Step 1: Walk every screen on both devices side by side**, screenshotting each. Home, Controls, Climate, Charging, Security, Schedules, Location, Explore, Navigate search, Cars sheet, Carlink debug.

- [ ] **Step 2: Exercise every car action from Android** — lock, unlock, frunk, trunk, climate on/off, charge limit, speed limit, valet, send-to-car. Per the `frunk-actuate-is-a-toggle` memory, frunk is a toggle with no close command; verify the reconciler behaves the same.

- [ ] **Step 3: Record every remaining delta** in `docs/android-parity.md` with a cause and a decision (fix / accept / defer). The foreground-service notification from Task 4.1 is a known accepted delta.

- [ ] **Step 4: Full green check**

```bash
cd /Users/ivan/Work/airgapp/mobile && npx tsc --noEmit -p tsconfig.json && pnpm test 2>&1 | tail -6 && git status --porcelain
```

- [ ] **Step 5: Commit.**

---

### Task 7.3: Update the project memory

**Files:**
- Create: `~/.claude/projects/-Users-ivan-Work-airgapp-mobile/memory/android-port.md`
- Modify: `~/.claude/projects/-Users-ivan-Work-airgapp-mobile/memory/MEMORY.md`
- Modify: `~/.claude/projects/-Users-ivan-Work-airgapp-mobile/memory/project_airgapp.md`

- [ ] **Step 1: Write the Android memory** — the deploy runbook, the vendoring commands, the gotchas actually hit (not the ones anticipated), and the 16 KB page-size finding from Task 6.2.
- [ ] **Step 2: Add the index line to `MEMORY.md`.**
- [ ] **Step 3: Update `project_airgapp.md`** so the canonical project memory is no longer iOS-only.

---

## Self-Review

**Spec coverage.** Every iOS-only surface found in recon has a task: `expo-passive-entry` → 3.2–3.3, 4.1–4.3; `expo-bg-task` → 2.2; `expo-apple-search` → 0.4, 5.2; `shared-intake` → 0.4, 5.3; `expo-godot-view` → 6.1–6.5; `expo-symbols` → 1.1; `expo-glass-effect` → 1.1 Step 9 (removed, zero call sites); `react-native-maps` → 5.1; SQLite asset DBs → 2.1; fonts/insets → 1.2; deploy scripts → 7.1.

**Placeholder scan.** Phases 4 and 6 carry fewer inline code blocks than Phases 0–3 and 5. That is deliberate, not a gap: those tasks are ports of specific, named, in-repo reference files (`PassiveEntryCentral.swift`, `VcsecSigner.swift`, `CarRegionMonitor.swift`, `GodotHost.mm`), and each step names the file, the line numbers, and the contract to mirror. Transcribing 883 lines of Swift into a plan would be worse than pointing at it. Where the Android mechanism genuinely differs from iOS — the foreground service, the CCCD descriptor write, `GodotPlugin` vs the C++ singleton, `pickFirst` — the plan spells it out inline.

**Type consistency.** `sfToTesla` (1.1), `chargerDbDir` (2.1), `requiredBlePermissions` (3.1), `blockLengthForMtu` (3.2), `normalizeApplePoi`/`normalizeMapLibrePoi` (5.1), `photonComplete`/`photonSearch`/`photonResolve` (5.2) each appear with one consistent signature. The `modules/*/index.ts` contracts are frozen by the Global Constraints and every native task conforms to the names enumerated in Task 3.3 Step 1.

**One open dependency:** Task 6.2 is a genuine go/no-go gate. If `getconf PAGE_SIZE` returns 16384, Phase 6 grows by roughly a day (engine rebuild from `godot-src`). Everything before it is unaffected.
