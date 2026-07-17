# R13 — Command classification: remaining screens (Charging / Security / Windows / Sunroof / Media / Remote Start)

All line numbers = iOS `main.decompiled.js` (Tesla iOS v4.56), our ship target. Android not separately re-derived this round (UI/redux layer parity assumed; command EXECUTION is native on Android per R1). Tag = [iOS-verified] unless noted.

## KEY ARCHITECTURE FINDING — there are THREE optimistic mechanisms, not one

1. **`SEND_VEHICLE_OPTIMISTIC_COMMAND` reducer overlay** (R1/R11 mechanism). The ONLY UI/saga consumer of `sendVehicleOptimisticCommand` is the **climate on/off saga** (iOS 3972866 and 3973049, both inside the HVAC `climateOn`/`HVACAUTOACTION` saga `_fun97381`). No other screen dispatches `SEND_VEHICLE_OPTIMISTIC_COMMAND`. So the "optimistic overlay reducer" is effectively climate-specific.

2. **`getSelectedOngoingCommands` selector overlay** (dominant pattern for Controls). Display selectors decode the in-flight (ongoing) `VehicleAction` protos and overlay their TARGET state onto raw `vehicle_data`. Two resolvers:
   - **`_closure1_slot221`** = the generic closure-state resolver. `isVehicleLocked`, `isSentryModeOn`, `isSunroofOpened/Closed`, `isChargePortDoorOpen`, `isVehicleWindowAllClosed`, `isRemoteStartActive` all funnel through it (each passes its `VehicleClosures.*` key + `ongoingCommands`). iOS: `isVehicleLocked` @1221029 → `slot221(closures, chargeState, phoneKey, VehicleClosures.LOCKED, ongoingCommands)`.
   - **`getVehicleChargingState`** (iOS 1225213, = `_closure1_slot41`): scans `ongoingCommands` for a `CHARGINGSTARTSTOPACTION`; `hasStart()===true` ⇒ returns `ChargingState.STARTING`, `hasStop()===true` ⇒ `ChargingState.STOPPED`, else the real `chargeState.getChargingState()` typeCase.
   ⇒ Tapping these buttons enqueues the command into ongoing → selector immediately returns the optimistic target → button flips WITHOUT a spinner. On command completion/expiry, ongoing clears → reconciles to real state.

3. **`useClosureActionBusyStatus` → `ControlButtonStatus.BUSY` spinner** (R10). Frunk/trunk only. NOT used by the buttons below.

All the `VehicleCommand.*` builders below (startCharging, sentryModeOn, changeChargeLimit, setChargingAmps, scheduledCharging, windowControl, changeSunroofState, boombox) produce a `VehicleAction` proto dispatched through `sendCommand` (from `useVehicleCommand`, fn #96534) → `SEND_VEHICLE_COMMAND`. Lock / charge-port use the **signed RKE path** `rkeCommandAction(RKEAction_E.*)` instead (BLE-signable) — still surfaces in ongoing commands for the overlay.

---

## Charging screen

| Control | Render site (iOS) | Classification | Command / action dispatched | State field reflected & reconciled |
|---|---|---|---|---|
| **Start / Stop charging** (`ChargingControlButton`) | 3983809; onPress 3983871 | **OPTIMISTIC** (ongoing-overlay via `getVehicleChargingState`) | `VehicleCommand.startCharging()` / `.stopCharging()` → `sendCommand` → `SEND_VEHICLE_COMMAND` (`charge_start`/`charge_stop`) | `charging_state`. Label flips START↔STOP via `isChargingStopped(chargeState, ongoingCommands)` (1238447). `disabled = !canStartStopCharging(...)` (1236911; enabled only for STARTING/CHARGING/CALIBRATING/STOPPED). Text keys `command_name_START_CHARGE`/`command_name_STOP_CHARGE`. No spinner. |
| **Charge-port Open / Close** (`ChargePortControlButton` + `useChargePortControlHandler` 3980159) | button 3983349; handler → `sendChargePortCommand` 3983730 | **OPTIMISTIC** (ongoing-overlay, slot221) | `rkeCommandAction(RKEAction_E.RKE_ACTION_OPEN_CHARGE_PORT / RKE_ACTION_CLOSE_CHARGE_PORT)` (signed RKE) | `charge_port_door_open`. `chargePortDoorOpen = getSelectedVehicleChargePortOpen` (3884911) = `isChargePortDoorOpen(chargeState, phoneKey, ongoingCommands)` (1238509, slot221 overlay). `disabled` when charging / plugged-in / powershare active/initializing (3983396-3983567). |
| **Charge-limit slider** (SOC) | slider props 4157744; `onSlidingComplete` 4157833 | **COMMAND-ON-RELEASE** (local-optimistic during drag, NO debounce) | on release: `VehicleCommand.changeChargeLimit(percent)` (1310091; clamps `max(0, min(100, round(v)))`) → `SEND_VEHICLE_COMMAND` (`set_charge_limit`, internal key `CHANGE_CHARGE_LIMIT` 1274644) | `charge_limit_soc` (slider `target`). Thumb tracked locally via `onSliding`; command fires ONCE in `onSlidingComplete`. (Powershare-mode branch instead emits energy events + `setPowershareDischargeLimit`.) |
| **Charge current / amps stepper** | component 4167600; `setChargeAmps` 4167687, `adjustCurrent` 4167720, `startAdjustingChargeAmps` 4167762, `stopAdjustingChargeAmps` 4167822 | **OPTIMISTIC-LOCAL + COMMAND-ON-RELEASE** (press-hold debounced @95 ms) | on release: `VehicleCommand.setChargingAmps(amps)` (1312949) → `SEND_VEHICLE_COMMAND` (`set_charging_amps`, key `CHARGING_AMPS` 1274654) | `charge_amps` via `getChargeAmps` (min 5, max `getNominalChargeCurrent`). Displayed value = local `useState(-1)`; +/- and press-hold `setInterval(…,95)` mutate local; `stopAdjustingChargeAmps` clears interval, dispatches once, resets local to `-1` (reconcile to server). Error copy `command_error_CHARGING_AMPS_charging_amps_out_of_bounds` (4048743). |
| **Scheduled charging toggle** | `VehicleCommand.scheduledCharging` 1312915 | **COMMAND-ON-TOGGLE** (settings write; local switch state) | `VehicleCommand.scheduledCharging(enabled, chargingTime)` → `ScheduledChargingAction.setEnabled/.setChargingTime` → `SEND_VEHICLE_COMMAND` (`set_scheduled_charging` 1275638) | `scheduled_charging_pending` / enabled + start time. (NB: `setScheduledCharging` @2769687 is a **different, unrelated** Tesla-Electric/energy redux action — do not conflate.) |

## Home / product view
- The Home charging widget renders a status/CTA string `vehicle_home_start_charging` (4568617) derived from charge state (`getVehicleChargingState` family, powershare stop-reason branches at 4568622+). The actual start/stop control is the **same `ChargingControlButton`** (optimistic, above). No separate Home-only command button found; Home tiles reflect state and route into Controls/Charging.

## Security / Sentry
| Control | Render site (iOS) | Classification | Command / action | State reflected |
|---|---|---|---|---|
| **Sentry Mode toggle** (`SentryControlButton`) | 3981851; `sendSentryCommand` 3981947 | **OPTIMISTIC** (ongoing-overlay, slot221) | `VehicleCommand.sentryModeOn(!current)` → `SEND_VEHICLE_COMMAND` (`set_sentry_mode` 1275890) | `sentry_mode` via `isSentryModeOn(closures, ongoingCommands)`. Icon/testID flip `sentry_on↔sentry_off`. `disabled` when state `== null` (unknown). Selector `getSelectedSentryModeOn` @1279176. |
| **Lock / Unlock** (`LockControlButton`) | 3984019; onPress 3984084 | **OPTIMISTIC** (ongoing-overlay, slot221) | `rkeCommandAction(RKEAction_E.RKE_ACTION_LOCK / RKE_ACTION_UNLOCK)` (signed RKE); also `sendLockCommand` @3984271 supports `RKE_ACTION_AUTO_SECURE_VEHICLE` | `locked` via `getVehicleLocked` (3983980) = `isVehicleLocked(closures, chargeState, phoneKey, ongoingCommands)` (1221029, VehicleClosures.LOCKED). If a blocking precondition holds (`slot48`/phone-key), onPress shows a phone-key nudge instead of dispatching. |
| **Speed Limit** (`SpeedLimitControlButton`) | 3989035 | **NAVIGATION only** (no direct command from Controls) | onPress → `navigate(RouteName.VehicleSpeedLimitModeScreen)` | Commands live on that screen: `speed_limit_activate` / `_deactivate` / `_set_limit` / `_clear_pin` (1275922-1275928). |
| **Valet** (`ValetControlButton`) | 3981980 | **NAVIGATION only** | onPress → `navigate(RouteName.VehicleValetModeScreen)` | Endpoints `set_valet_mode` (1275892), `reset_valet_pin` (1275568). |
| **PIN to Drive / Guest Mode** | not Controls buttons | dedicated settings screens (not in Controls module) | UNRESOLVED this round — no Controls-level command button; managed on their own screens. | — |
| **Bioweapon / Cabin Overheat (CPD)** (bonus, `BioweaponControlButton`) | 3989093 | dispatch via `sendCommand`, reflects `getSelectedBioWeaponMode` + `getSelectedVehicleIsCPDActive` | (bioweapon HVAC mode) | non-ongoing selector; flips on server state. |

## Windows
| Control | Render site (iOS) | Classification | Command / action | State reflected |
|---|---|---|---|---|
| **Vent / Close** (`WindowVentControlButton`) | 3982184; `ventWindows` 3982038, `checkVentCloseWindows` 3982055 | **OPTIMISTIC** (ongoing-overlay, slot221) **+ confirm-Alert on close** | `VehicleCommand.windowControl(action, …)` → `SEND_VEHICLE_COMMAND` (`window_control` 1276126) | Window state via `isVehicleWindowAllClosed(closures, config, ongoingCommands)` (3982207). Close path first runs `canCloseWindows` (498325) and shows a native `Alert` (`vehicle_controls_windows_cant_close_*` / `vehicle_controls_windows_confirm_*`). Disable respects `getSelectedVehicleDisableWindowClose`. |

## Sunroof
| Control | Render site (iOS) | Classification | Command / action | State reflected |
|---|---|---|---|---|
| **Sunroof Vent / Close** (`SunroofControlButton`) | 3988854; `sendSunroofCommand` 3988985 | **OPTIMISTIC** (ongoing-overlay, slot221) | `VehicleCommand.changeSunroofState(VehicleControlSunroofOpenCloseAction.ActionCase.VENT / CLOSE)` (1310134) → `SEND_VEHICLE_COMMAND` (`sun_roof_control` 1274648, key `CHANGE_SUNROOF_STATE`) | `sun_roof_percent_open` via `isSunroofOpened` / `isSunroofClosed(closures, ongoingCommands)`. `disabled = !isOpen && !isClosed` (i.e. mid-transition). Icon `vent_sunroof↔close_sunroof`. |

## Media / Boombox / Remote Start / Summon
| Control | Render site (iOS) | Classification | Command / action | State reflected |
|---|---|---|---|---|
| **Boombox / Fart** (`BoomboxControlButton`) | 3981525; `sendBoomboxCommand` 3981601 | **FIRE-AND-FORGET** (momentary; STATELESS_GHOST) | `VehicleCommand.boombox(action)` → `SEND_VEHICLE_COMMAND` (`remote_boombox` 1275550) | none (no toggle state). |
| **HomeLink** (`HomeLinkControlButton`) | 3981624 | **FIRE-AND-FORGET** (momentary) | `sendCommand` → `trigger_homelink` (1276028); uses `useVehicleOrDeviceLocation` | none. |
| **Remote Start (Start / keep-alive)** (`RemoteStartControlButton`) | 3980503 | **OPTIMISTIC** (ongoing-overlay) **+ live countdown** | `sendCommand` → `remote_start_drive` (1275556) | `isRemoteStartActive(closures, ongoingCommands)` (3980579) + `getSelectedCountDownTimeStamp` (3980531); local `useState` for countdown seconds. `isRemoteStartEnabled(vehicleState)` gates. |
| **Flash / Honk** | endpoints only (`flash_lights` 1275244, `honk_horn` 1275270) | **FIRE-AND-FORGET** (inferred; momentary) | `sendCommand` → flash/honk | none. |
| **Summon** | not in this Controls module | UNRESOLVED here — separate subsystem (prior Summon RE rounds). | — | — |

---

## Confidence / gaps
- All render sites, command builders, endpoint keys, and overlay selectors above are READ verbatim from iOS 4.56 [iOS-verified].
- **PIN-to-Drive, Guest Mode, Summon**: not implemented as Controls command buttons; each lives on its own screen — not classified this round (out of the Controls module scanned). Marked UNRESOLVED.
- **Flash/Honk** momentary classification is INFERRED from the endpoint + typical usage; render site not opened (low value).
- Android parity assumed (not separately disassembled this round).
