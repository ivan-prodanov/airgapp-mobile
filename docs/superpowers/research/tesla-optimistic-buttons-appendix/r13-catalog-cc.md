# R13 §3 — Controls + Climate button catalog (iOS v4.56 main.decompiled.js)

All lines are iOS absolute lines in `/Users/ivan/Downloads/tesla-haptics-work/main.decompiled.js` unless noted. Android not cross-checked this round (WE SHIP iOS). Command EXECUTION is native on Android (R1); this is the iOS UI/redux layer.

## Feedback taxonomy discovered (three distinct optimistic mechanisms + spinner)
1. **STATE-OVERLAY OPTIMISTIC** — dispatch `SEND_VEHICLE_OPTIMISTIC_COMMAND` (`sendVehicleOptimisticCommand` iOS 1196689) which overlays pending `command` onto `vehicle_data`; reverts at `startTime + OPTIMISTIC_TIMEOUT_MS(30000)`. **ONLY dispatcher = the heater saga** `sendVehicleHeaterCommandEffect` (iOS 3972866, 3973049). So only climate/heater commands get the true state overlay.
2. **SELECTOR-LEVEL OPTIMISTIC** — the displayed state is computed by a selector that takes `getSelectedOngoingCommands` as an argument and folds the pending `SEND_VEHICLE_COMMAND` into the shown value (e.g. `isClimateOn(state, ongoing)`, `isVehicleWindowAllClosed(closures, cfg, ongoing)`, `getSeatHeaterLevel(heater, state, ongoing)`, `isSteeringWheelHeaterOn/Auto(...)`, `isRemoteStartActive(closures, ongoing)`). Flips immediately, reverts when the command finishes/expires.
3. **BUSY-SPINNER** — a `useXBusyStatus(...).busy` hook (all wrap `useCommandTypeBusyStatus`, iOS 1872209: finds an ongoing command of that type that is not `finished()`) feeds `status = busy ? ControlButtonStatus.BUSY : NONE`. Generic `ControlButtonComponent` (module 2456, iOS 3991976) swaps the icon for **`BusyIcon`** when `status===BUSY` (iOS 3992216) — the R4 rotating mini_spinner + 0.5 opacity.
4. **FIRE-AND-FORGET** — momentary command, no state field, no status, no spinner.

`useVehicleCommand().sendCommand` (fn #96534, iOS 3926737) dispatches plain `SEND_VEHICLE_COMMAND` via `Actions.sendVehicleCommand` (iOS 1196584); payload carries `ignoreForOptimistic`. It does NOT dispatch the optimistic overlay — that is the heater saga's job.

---

## CONTROLS screen — on-vehicle-image buttons (VehicleControlsScreen fn #98619, iOS 4039275)

| Button | API command | State field reflected | Action dispatched | status wiring | Class |
|---|---|---|---|---|---|
| **Frunk (on-image)** | `sendFrunkCommand(frunk_opened,phonekey,…)` → closure actuate | `frunk_opened` (selVehicleTrunkStatus) | SEND_VEHICLE_COMMAND (sendCommand slot3) | `status = FRONT_TRUNK busy ? BUSY : NONE`; busy=`useClosureActionBusyStatus(VehicleClosures.FRONT_TRUNK).busy` (r40, iOS 4039327-4039333; wired iOS 4040361-4040368). Label→`action_busy` while busy (iOS 4040432). appearance GHOST, `disabled=!r35`. | **BUSY-SPINNER** |
| **Trunk (on-image)** | TrunkControlButtonWithNudge (fn iOS 4040565) → closure actuate REAR_TRUNK | `trunk_opened` | SEND_VEHICLE_COMMAND | `status` BUSY from `useClosureActionBusyStatus(REAR_TRUNK).busy` (slot4, iOS 4039316-4039324; status wired ~iOS 4040659). Button appearance GHOST. | **BUSY-SPINNER** |
| **Lock / Unlock centre glyph** ★ | `sendCommand(rkeCommandAction(RKEAction_E.RKE_ACTION_LOCK / RKE_ACTION_UNLOCK))`; auto-secure variant `RKE_ACTION_AUTO_SECURE_VEHICLE` when slot48(r13) set | `locked` selector `_closure1_slot49` (r14): true→lock icon+`vehicle_controls_locked`, false→unlock+`vehicle_controls_unlocked` | SEND_VEHICLE_COMMAND (LockControlButton fn iOS 3984019) | **NONE.** ControlButton props = appearance STATELESS_GHOST, size LARGE, iconName lock/unlock, text, onPress, testID, `disabled = (r14==null) ? !r13 : false` (iOS 3984234-3984239). **No `status`, no busy hook, no BusyIcon.** | **FIRE-AND-FORGET / no immediate feedback** — icon flips only when the `locked` selector updates (next poll, 1.2s active / 5s online); RKE lock is never dispatched as SEND_VEHICLE_OPTIMISTIC_COMMAND and no ongoing-aware selector, so NO optimistic flip and NO spinner. Rendered at the centre `lockButton` slot; if vehicle `hasSunroof` this same slot renders a SUNROOF_CONTROL ControlButton instead (VehicleControlsScreen iOS 4040471-4040529). |

★ = the button the user specifically asked about.

## CONTROLS screen — quick-control ControlButton components (generic ControlButtonComponent module 2456, iOS 3991976)

| Button | API command | State field reflected | Action | status wiring | Class |
|---|---|---|---|---|---|
| **Flash Lights** (FlashLightControlButton 3981330) | `VehicleCommand.flashLights()` | none | SEND_VEHICLE_COMMAND | none | **FIRE-AND-FORGET** |
| **Honk Horn** (HonkHornControlButton 3981446) | `VehicleCommand.honkHorn()` | none | SEND_VEHICLE_COMMAND | none | **FIRE-AND-FORGET** |
| **HomeLink** (HomeLinkControlButton 3981624) | homelink trigger (sendCommand) | none (uses `useVehicleOrDeviceLocation`) | SEND_VEHICLE_COMMAND | none | **FIRE-AND-FORGET** |
| **Boombox / Fart** (BoomboxControlButton 3981525) | `VehicleCommand.boombox(action)` | none | SEND_VEHICLE_COMMAND | none | **FIRE-AND-FORGET** |
| **Remote Start** (RemoteStartControlButton 3980503) | remote-start (sendCommand) | `isRemoteStartActive(closures, ongoing)` + `getSelectedCountDownTimeStamp` countdown | SEND_VEHICLE_COMMAND | `status = useVCSECActionBusyStatus(RKEAction_E.RKE_ACTION_REMOTE_DRIVE).busy ? BUSY : props.status` (iOS 3980750-3980765) | **BUSY-SPINNER** in flight, then reflects active + countdown |
| **Window Vent / Close** (WindowVentControlButton 3982184) | vent/close windows (sendCommand) | `isVehicleWindowAllClosed(closures, cfg, ongoing)` (r12, iOS 3982207-3982232): text `vehicle_controls_window_vent` ↔ `_window_close` | SEND_VEHICLE_COMMAND | none (`disabled=false`; icon greyed if `!canCloseWindows`) | **SELECTOR-LEVEL OPTIMISTIC** (no spinner) |
| **Charge Port** (ChargePortControlButton 3983349) | charge-port door open/close via hook `_closure1_slot91` (returns onPress + `chargePortDoorOpen`) | `chargePortDoorOpen`, `isChargingSelector`, powershare states | (via hook) | none, `disabled` only | **STATE-REFLECTING, no spinner** (optimism inside slot91 hook — UNRESOLVED) |
| **Sentry** (SentryControlButton 3981851) | sentry toggle | sentry state | SEND_VEHICLE_COMMAND | `disabled` only, no status | **STATE-REFLECTING, no spinner** (INFERRED) |
| **Climate toggle (quick)** (ClimateToggleControlButton 3982490) | `sendClimateToggleCommand`→`VehicleCommand.climateOn(true/false)` via sendCommand (iOS 3982735-3982766) | `isClimateOn(climateState, ongoing)` (r12) → text `button_on_title_case`/`button_off_title_case` | SEND_VEHICLE_COMMAND | `status = (max-precondition ∥ bioweapon ∥ keeper busy) ? BUSY : props.status`; hooks `useCarServerActionBusyStatus(HVACSETPRECONDITIONINGMAXACTION)`, `(HVACBIOWEAPONMODEACTION)`, `useClimateKeeperBusyStatus([DOG,CAMP,OFF])` (iOS 3982571-3982646); `disabled` if CPD active | **SELECTOR-LEVEL OPTIMISTIC** for on/off; **BUSY-SPINNER** only when a max-defrost / bioweapon / keeper sub-action is in flight |

Other quick controls present (fire-and-forget unless noted): Valet, SpeedLimit, LightShow, Bioweapon(disabled), Outlet, Tonneau (TonneauControlButton 3985082, disabled), ActuateAllDoors, DoorActuate, UnlatchDriverDoor, Charging, ZoneLight (has `status`, iOS 3989369-3989371), Suspension (`useCarServerActionBusyStatus`→status, iOS 3989639-3989661 = BUSY-SPINNER).

---

## CLIMATE screen (VehicleClimateScreen fn iOS 5221432 / VehicleClimateControlsOverlay 5225920)

The climate screen routes through **`sendVehicleHeaterCommand`** (iOS 1196712) → `SEND_VEHICLE_HEATER_COMMAND` → saga `sendVehicleHeaterCommandEffect` which dispatches `sendVehicleOptimisticCommand` (STATE-OVERLAY) **then** the real `sendVehicleCommand` (iOS 3972866 / 3972893). So heater-family buttons get the true optimistic overlay.

| Button | API command | State field reflected | Action | status wiring | Class |
|---|---|---|---|---|---|
| **Climate On/Off (power)** | `VehicleCommand.climateOn(bool)` (heater) | `isClimateOn` (overlaid vehicle_data) | SEND_VEHICLE_HEATER_COMMAND → optimistic overlay + real | — | **STATE-OVERLAY OPTIMISTIC** (reverts at 30s) |
| **Temperature ± / setpoint** | `setClimate(temp)` → `VehicleCommand.changeClimateTemperatureSetting(temp,temp)` (heater), **debounced 1200ms leading+trailing** (iOS 5221724-5221770) | local slider setpoint immediately; `changeClimateTemperatureSetting` | SEND_VEHICLE_HEATER_COMMAND | — | **OPTIMISTIC** (local setpoint + heater overlay, debounced) |
| **Seat heaters** (SeatHeaterControlButton 3986555) | `sendVehicleHeaterCommand(...seatHeaterLevel...)` (iOS 3987248) | `getSeatHeaterLevel(heater, state, ongoing)` (r29, iOS 3986641) → shows NEW level immediately | SEND_VEHICLE_HEATER_COMMAND | **`status` explicitly forced BUSY→NONE** (iOS 3986600-3986608) — NEVER spins; `disabled` when `!isClimateOn` | **SELECTOR-LEVEL OPTIMISTIC level; never spins** |
| **Steering-wheel heater** (SteeringWheelHeaterControlButton 3988249) | `sendVehicleHeaterCommand` (iOS 3988460/3988488) | `isSteeringWheelHeaterOn/Auto(state, bitmask, cfg, ongoing)` (iOS 3988322-3988338) → color flips buttonHeaterOn/Off | SEND_VEHICLE_HEATER_COMMAND | `disabled` only, no status/spinner | **SELECTOR-LEVEL OPTIMISTIC** (on/auto/off) |
| **Keep Climate / Dog / Camp** | `sendDogModeCommand` / `sendCampModeCommand` / `sendClimateKeeperOffCommand` → `HvacClimateKeeperAction(ClimateKeeperAction_E.…DOG/CAMP/OFF)` (iOS 5222391-5222448) | `getClimateKeeperMode` | heater path | **`useClimateKeeperBusyStatus([DOG/CAMP/OFF])`** → BUSY (iOS 5221597-5221626) | **BUSY-SPINNER** (these are the climate buttons that spin) |
| **Max Defrost** (MaxDefrostControlButton 3982949 / `useMaxDefrostOnPressFn`) | max-defrost (heater/carserver `HVACSETPRECONDITIONINGMAXACTION`) | `maxDefrostOn` | heater path | dedicated button `disabled` only; busy tracked via `useCarServerActionBusyStatus(HVACSETPRECONDITIONINGMAXACTION)` (used by ClimateToggle) | **STATE-REFLECTING**; BUSY-SPINNER when wired (INFERRED for standalone) |
| **Auto** | `HVACAUTOACTION` (heater) | auto on | SEND_VEHICLE_HEATER_COMMAND | — | **STATE-OVERLAY OPTIMISTIC** (INFERRED) |
| **Defrost / Fan / Recirc** | onChange handlers → `sendVehicleHeaterCommand` | respective climate fields | SEND_VEHICLE_HEATER_COMMAND | — | **OPTIMISTIC** (INFERRED — onChange fns iOS 5223938/5224783/5225000) |

---

## Key distinctions for airgapp parity
- **The lock glyph does NOT spin and does NOT flip optimistically** — it is the plainest button: sendCommand(RKE lock/unlock), icon driven purely by the `locked` selector, disabled only when lock state is unknown. Any "did it work" feedback comes from the next poll, not the button.
- **Closures (frunk/trunk) spin** (ControlButtonStatus.BUSY → BusyIcon). Frunk has two renderings: on-image (status BUSY spinner) and quick-control (label→`action_busy`, no icon spinner), both off `useClosureActionBusyStatus(FRONT_TRUNK)`.
- **Climate/heater family is optimistic** (seat level, wheel on/auto, on/off, temp) — shows the new value instantly; seat heater even force-suppresses the spinner. **Only the climate-keeper modes (Dog/Camp/Keep) and max-defrost/bioweapon spin.**
- **Momentary actions (flash, honk, homelink, boombox) are fire-and-forget** — no feedback at all.
- `DISABLED` vs `BUSY`: both dim to 0.5 (R12 `iconButtonBusyOpacity`), but DISABLED sets `disabled=true` (blocks press, `isDisabledStatus`, iOS 3992232) while BUSY sets `status=BUSY` (swaps icon→BusyIcon, still shows spinner). Seat heater is the notable case that is `disabled` (when climate off) but never `BUSY`.
