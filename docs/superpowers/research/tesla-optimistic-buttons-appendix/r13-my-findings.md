# R13 — my independent recon (iOS main.decompiled.js v4.56)

## THE COMMAND-STATE REDUCER reacts to these 6 ActionTypes (iOS 1184637-1184675):
```
SEND_VEHICLE_COMMAND            → register pending (unless ignoreForOptimistic)
SEND_VEHICLE_OPTIMISTIC_COMMAND → register pending + set optimistic overlay
VEHICLE_COMMAND_SUCCESS         → command acked
VEHICLE_COMMAND_FAILED          → command failed → revert
VEHICLE_DATA_REQUEST_SUCCESS    → ⭐ the POLL result — RECONCILE the optimistic overlay against real vehicle_data
VEHICLE_PHONE_KEY_STATUS        → BLE key status
```
⇒ The "what does it query to get the actual state" answer = **VEHICLE_DATA_REQUEST_SUCCESS** (the 5000ms online / 1200ms waking vehicle_data poll, R1). Reconcile happens on each poll success.

## Action creators (iOS ~1196689):
- `sendVehicleOptimisticCommand(vehicleId, commandId, command, tonneauMovementStateAtBeginning)` → SEND_VEHICLE_OPTIMISTIC_COMMAND
- `sendVehicleHeaterCommand(vin, vehicleId, climateOn, remoteHeaterControlEnabled, command, currentRoute)` → SEND_VEHICLE_HEATER_COMMAND
- (plain) SEND_VEHICLE_COMMAND — carries `ignoreForOptimistic` (iOS 1196674) which the saga reads (iOS 1194281 case 8862)

## The optimistic saga/selector = fn #29049 (iOS ~1193930-1194900):
- collects in-flight commands, filters `startTime + OPTIMISTIC_TIMEOUT_MS(30000) < now` = EXPIRED (iOS 1193959) → revert.
- `ignoreForOptimistic` on a SEND_VEHICLE_COMMAND payload excludes it from optimistic tracking ⇒ shows BUSY spinner instead.

## Per-field optimistic reducers seen: `seatHeaterLevel` fn #29028 (iOS 1184675+) — overlays the pending seat level.

## Red herring: `getOptimisticResult` @2526341/2528684/2534227 = TanStack/React-Query internal, NOT Tesla state.

## Established constants (R1): OPTIMISTIC_TIMEOUT_MS=30000, ERROR_CARD_TIMEOUT=7000, poll online 5000 / waking 1200.
## Busy visual (R4): in-flight ControlButton REPLACES icon with BusyIcon (rotating mini_spinner ~900ms) + dims to opacity 0.5.
