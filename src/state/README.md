# src/state

App-level state stores (Zustand). Sits between the screens and the BLE/Godot layers.

Will host:
- `useVehicleState.ts` — port of `web-shell/src/state/useVehicleState.ts`, adapted for Zustand
- Per-screen state slices (climate, charging, security, etc.)
- React Query setup if/when we add polled state

The BLE layer's `VehicleState` (from `worktree/client/state.js`) is the lower-level per-VIN data store with IDB persistence. This folder is for *app* state (which screen is focused, transient UI flags, animations) — the BLE store handles per-VIN protocol-level state.
