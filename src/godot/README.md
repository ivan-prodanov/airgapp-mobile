# src/godot

TypeScript side of the Godot bridge. Wraps the native `expo-godot-view` module (in `/modules/expo-godot-view/`).

Will host:
- `GodotRendererBridge.ts` — port of `web-shell/src/bridge/GodotRendererBridge.ts`, with `installComm` swapped for native-module calls
- `vehicleStateAdapter.ts` — port of `web-shell/src/state/vehicleStateAdapter.ts` (creates the 19 RN→Godot message types)
- `cameraPresets.ts` — the camera position constants (PARKED/TOP_DOWN/CLIMATE/CHARGING/...)
- Message type definitions (RN→Godot enum, Godot→RN enum) — see authoritative source at `tesla-godot/mobile/scripts/ReactMsg.gd` + `GodotMsg.gd`

The native module contract (per `MobileComm.gd` in the Godot project) requires the module to expose a Godot engine singleton named exactly `IOSGodotInterface` (iOS) / `AndroidGodotInterface` (Android) with these 4 methods:

| Method | Caller | Returns | Purpose |
|---|---|---|---|
| `sendMessage(string)` | GDScript | void | Godot → host. Forward JSON to JS via native event. |
| `pendingMessagesCount() → int` | GDScript | int | Godot polls each frame in `_check_for_messages` |
| `getMessage() → string` | GDScript | string | Godot dequeues next inbound JSON |
| `addMessage(string)` | Native | void | Host → Godot. Push JSON onto queue. |
