# expo-godot-view — Godot engine integration

Status of the native module, and exactly what's left to make the **device** path render real Godot.

## What's wired now (Phase 2)

JS ↔ native message plumbing + the `#if targetEnvironment(simulator)` split:

- **TS API** (`src/`): `<ExpoGodotView sceneName=... />` + module functions/events.
  - `ExpoGodotViewModule.sendMessageToGodot(json)` — host → Godot (enqueue).
  - `onGodotMessage` event — Godot → host (`{ message: json }`).
  - Messages are opaque JSON envelopes `{ "type": ..., "data": ... }`; this layer never parses them.
- **iOS** (`ios/`):
  - `GodotBridge.swift` — `@objcMembers` singleton implementing the 4-method contract
    (`addMessage` / `pendingMessagesCount` / `getMessage` / `sendMessage`) with a thread-safe queue.
  - `ExpoGodotView.swift` — **simulator**: gray placeholder + synthesizes `GODOT_READY`.
    **device**: black placeholder with the engine-embed TODO (below).
  - `ExpoGodotViewModule.swift` — exposes `sendMessageToGodot` + `onGodotMessage`, wires
    `GodotBridge.onMessageToHost` → `sendEvent`.
- **Android** (`android/`): pure no-op stub mirroring the iOS API. Android Godot = Phase 6.

Verified: `xcodebuild -scheme ExpoGodotView -sdk iphonesimulator` → BUILD SUCCEEDED.

## Why the simulator is a stub (not laziness)

The Godot 3.2 iOS export template ships a 2020-era `libgodot.iphone.*.fat.a` whose only slices are
`x86_64` and **device** `arm64` — there is **no `arm64-iphonesimulator` slice**. Apple-Silicon
simulators need exactly that slice, so the engine cannot run on the simulator without rebuilding
Godot 3.2 from source. We deliberately don't: BLE forces us onto a physical device anyway, so the
simulator only needs to keep RN/UI work building. (Spike confirmed: device build links + runs; sim
install fails "Failed to find matching arch".)

## Remaining device work (the `#else` branch in ExpoGodotView.swift)

Embed Godot 3.2 **as a library** and register the `IOSGodotInterface` engine singleton. From the
spike (`/Users/ivan/Work/rpi-filter/tesla-godot-spike/SPIKE_LOG.md`):

1. **Vendor the engine + assets** into the module:
   - `libgodot.iphone.*.fat.a` (from the 3.2.stable export templates; `lipo -info` → `x86_64 arm64`).
   - The packaged `.pck` exported with custom feature `mobile` (selects `mobile.tscn`). Export from
     the **Mac** copy of the project (`/Users/ivan/Work/rpi-filter/tesla-godot/` — has all assets;
     the Windows copy is missing Palladium wheel textures → broken car).
2. **podspec linker / signing workarounds** (bake into the pod, not one-off project edits):
   - `OTHER_LDFLAGS = -weak_framework StoreKit` — satisfies Godot's baked-in IAP module's runtime
     `SK*` symbols WITHOUT triggering Xcode's IAP capability inference (which scans the Frameworks
     build phase but not `OTHER_LDFLAGS`). This is the magic incantation for free-team signing.
   - Empty `.entitlements` (no `aps-environment`, game-center, inAppPurchase, ubiquity-kvstore).
   - iOS deployment target ≥ 15 (app is 16.4 — fine).
   - AppIcon at 76 / 120 / 1024 (app-level, already satisfied).
3. **Register the singleton** named exactly `IOSGodotInterface` (per `MobileComm.gd`) via a Godot 3.x
   iOS Plugin (Obj-C++, `register_*_types()`), forwarding GDScript calls to `GodotBridge.shared`:
   - `sendMessage(NSString*)`  → `GodotBridge.shared.sendMessage(_:)`
   - `pendingMessagesCount()`  → `GodotBridge.shared.pendingMessagesCount()`
   - `getMessage() -> NSString*`→ `GodotBridge.shared.getMessage()`
   - `addMessage(NSString*)` is the host→Godot entry (already called via `sendMessageToGodot`).
   Ref: https://docs.godotengine.org/en/3.5/tutorials/plugins/ios/ios_plugin.html
4. **Embed the render surface**: drive the Godot main loop / GLES view inside `ExpoGodotView`'s
   `#else` branch (Godot-as-a-library, not Godot-as-the-app like the spike). This is the one piece
   the spike did NOT prove — it ran Godot as the whole app. Expect bespoke work here.

## Smoke-test ladder

- **No-iOS**: `LocalGodotInterface.gd` (pure GDScript queue) drives `MobileComm` from an editor-only
  scene — validates JSON payloads before any native code.
- **Simulator**: builds green; stub emits `GODOT_READY`; `sendMessageToGodot` is a no-op.
- **Device**: real engine; success = tap/console round-trip
  `{"type":"GODOT_READY","data":{}}` then a `SHOW_PRODUCT` renders the car.
