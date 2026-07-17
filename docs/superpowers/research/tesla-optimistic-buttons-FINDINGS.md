# Optimistic vs busy-spinner command buttons — per screen, and the mechanism (Round 13)

**Source of truth:** iOS `main.decompiled.js` (Tesla iOS **v4.56**) — the build we ship. Android `bundle.hasm` (v4.58) executes commands natively (R1); this document is the **iOS UI/redux layer** that decides how each button *looks* while a command is in flight. All line numbers are iOS. Read unfiltered, independently re-derived across 4 readers, and adversarially verified; where the verify pass overturned a reader, the corrected value is what appears here.

---

## TL;DR — the one thing to internalise

**There is no single "optimistic" switch. A button's in-flight behaviour is the product of two INDEPENDENT facts:**

1. **Does the field's display selector fold in the pending command?** If yes → the button **flips to the new state instantly** (optimistic), no spinner. If no → it just shows the last polled state and updates on the next poll.
2. **Does the component wire `status = busy ? BUSY : NONE`?** If yes → it also shows a **spinner** (the icon is replaced by a rotating spinner) until the command resolves.

Most Tesla buttons do **#1 only** (flip, no spinner). A few do **#2 only** (spinner, no flip — notably frunk/trunk). The two are orthogonal; a button *can* do both, but in practice Tesla picks one.

**Crucially: there is NO patch of `vehicle_data`.** The app never writes "frunk = open" into the vehicle state. It stores the *whole command* in a pending list and **derives** the effective state on the fly in selectors. That is why the revert is free — drop the pending command and the derived state snaps back.

**Direct answer to your frunk example:** the frunk button shows a **waiting spinner** (busy), *not* an optimistic "open". The **lock glyph**, by contrast, flips **optimistically** (locked/unlocked instantly, no spinner).

---

## §1. The mechanism — the recipe `[iOS-verified]`

### 1a. State shape
The command reducer (`onGoingCommandReducer`, fn #29049, iOS 1187114-1194489) keeps, per vehicle:
```
state.vehicleCommands.onGoingByVehicleId[vehicleId] = [ CommandRecord, … ]   // newest first, capped at 200
CommandRecord = { success: false, commandId, action /*=full CommandAction proto*/, startTime, endTime? }
CommandRecord.finished() => endTime != null
```
It reacts to **exactly 6 actions** (whitelist, iOS 1184631-1184658); everything else passes through untouched:
```
SEND_VEHICLE_COMMAND · SEND_VEHICLE_OPTIMISTIC_COMMAND   → add pending
VEHICLE_COMMAND_SUCCESS · VEHICLE_COMMAND_FAILED          → resolve
VEHICLE_DATA_REQUEST_SUCCESS                              → reconcile against the poll  ← "query the real state"
VEHICLE_PHONE_KEY_STATUS                                  → reconcile against BLE
```

### 1b. Dispatch (t = 0)
A button press calls **`useVehicleCommand().sendCommand`** (fn #96534, iOS 3926737) → dispatches **`SEND_VEHICLE_COMMAND {command, commandId, ignoreForOptimistic}`**. (Climate/heater buttons go through the heater saga, which *additionally* dispatches `sendVehicleOptimisticCommand` — see §1f.)

Reducer SEND branch (iOS 1194262-1194485): remove any existing **same-endpoint** pending command (`isSameEndpoint`), then `unshift` a fresh `CommandRecord(commandId, action, startTime = Date.now())`; cap at 200. **`command` = the exact `CommandAction` protobuf sent to the car** — nothing is written into `vehicle_data`.

### 1c. The optimistic flip — how a button "shows the new state"
Display selectors take **`getSelectedOngoingCommands`** (createSelector, iOS 1279940) as an argument and **fold the pending command's target state onto the raw poll data**:
- **Generic closure resolver** `_closure1_slot221` (iOS 1214837) — scans ongoing commands for a matching action (e.g. `RKE_ACTION_LOCK` / `RKE_ACTION_AUTO_SECURE_VEHICLE`, iOS 1214825-1214835) and returns the pending *target* state. Powers `isVehicleLocked(closures, chargeState, phoneKey, ongoing)` (iOS 1221029), `isSentryModeOn`, `isChargePortDoorOpen`, `isSunroofOpened/Closed`, `isVehicleWindowAllClosed`, `isRemoteStartActive` — each passes its `VehicleClosures.*` key **plus `ongoing`**.
- **Charging** `getVehicleChargingState(chargeState, ongoing)` (iOS 1225213) — a pending `CHARGINGSTARTSTOPACTION` with `hasStart()` ⇒ returns `ChargingState.STARTING`; `hasStop()` ⇒ `STOPPED`; else the real value.
- **Climate** `isClimateOn(state, ongoing)`, `getSeatHeaterLevel(heater, state, ongoing)`, `isSteeringWheelHeaterOn/Auto(...)`.

⇒ Tap → command enters `ongoing` → the selector immediately returns the *target* → **the icon/label flips, no spinner**. The verify pass confirmed there is **no vehicle_data mutation** — the reader's "state-overlay" wording was refuted; it is **all selector-level**.

### 1d. The spinner — the "waiting circle"
Independently, a component may wire `status = busy ? ControlButtonStatus.BUSY : NONE`, where `busy` comes from a `use*BusyStatus` hook — all wrapping **`useCommandTypeBusyStatus`** (iOS 1872209): *"is there an ongoing command of this type that is `!finished()`?"*. When `status === BUSY`, the generic `ControlButtonComponent` (module 2456, iOS 3991976/3992216) **replaces the icon with `BusyIcon`**.

### 1e. Reconcile — "what it queries to get the real state, and revert"
- **Poll** `VEHICLE_DATA_REQUEST_SUCCESS` (the R1 vehicle_data poll: **5000 ms online / 1200 ms waking**) — reads `payload.vehicle.proto_vehicle_data`, and for each pending command compares the **real** getter against the command's **desired** state via exact matchers:
  - `checkLockCommand` (iOS 1186667): `RKE_ACTION_LOCK` cleared when `isLocked === true`; `RKE_ACTION_UNLOCK` when `false`.
  - `checkChargePortCommand` (iOS 1186761): OPEN variants cleared when `isOpen === true`; CLOSE when `false`.
  - `checkFrunkTrunkCommand` (iOS 1186905): front/rear reconciled against `PHONE_KEY_CLOSURE_STATE_CLOSED`.
  Matched `commandId`s are **filtered out** of `ongoing` → the derived state now comes from real data.
- **BLE** `VEHICLE_PHONE_KEY_STATUS` (iOS 1194034) — when `bleVehicleStatus.is_connected` and `closure_state != null`, reconciles `closure_state.{locked, cp, ft, rt}` the same way. **This is the offline/local reconcile path.**
- **Explicit ack** `VEHICLE_COMMAND_SUCCESS` (iOS 1194238): set `endTime`, `success = true`, **keep** the record (so `finished()` stops the spinner) until poll/BLE confirms the field or the 30 s sweep. `VEHICLE_COMMAND_FAILED` (iOS 1194186): **remove the record and all same-endpoint records immediately** ⇒ the optimistic overlay **reverts at once** (no 30 s wait) + error card.
- **Fire-and-forget** commands (`commandCausesVehicleDataUpdate(command) === false`, iOS 1185153): the record is spliced out **immediately on ack** (success or fail) — no poll wait.

### 1f. `ignoreForOptimistic` and the heater saga
- **`ignoreForOptimistic`** (set only on `SEND_VEHICLE_COMMAND`, iOS 1196674; read at iOS 1194279) is an **opt-out of tracking entirely** — when `true`, no `CommandRecord` is added, so the command drives **neither** the overlay **nor** a spinner. *(The busy reader's "true ⇒ falls back to spinner" was **refuted** — it shows nothing.)* `SEND_VEHICLE_OPTIMISTIC_COMMAND` never sets it.
- **Heater/climate** buttons go through `sendVehicleHeaterCommand` → the saga `sendVehicleHeaterCommandEffect` (iOS 3972866/3973049) which dispatches **`sendVehicleOptimisticCommand`** *and* the real command. Net effect is the same selector-level fold — it just guarantees the pending record exists for the climate selectors to read.

### 1g. Timeout / auto-revert
`OPTIMISTIC_TIMEOUT_MS = TimeInMs.THIRTY_SECONDS = 30000` (iOS 1221613). Inside the poll handler, commands where `startTime + 30000 < Date.now()` are collected (logged `"timed out command"`) and merged into the removal filter (iOS 1193948-1193972). **Evaluated on each poll tick, not a `setTimeout`.** The same 30 s bound gates matching via `firstCommandRecordMatchingActions` (fn #30029, iOS 1227630; `isLegit`: `startTime > now − timeout`). So **both the spinner and the optimistic flip auto-clear at 30 s.**

**⚠️ The 30 s revert and R1's 7 s `ERROR_CARD_TIMEOUT` are INDEPENDENT layers** (verify CONFIRMED): a stuck command shows the **error card at 7 s** while the **button overlay/spinner persists to 30 s**.

### 1h. The two timelines
```
OPTIMISTIC button (e.g. Lock):
  t=0     tap → icon flips to LOCKED instantly (no spinner)
  t≤5s    next poll (or BLE) confirms locked → pending cleared, icon stays (now from real state)
  FAIL    VEHICLE_COMMAND_FAILED → icon reverts immediately + error card
  no-ack  t=30s → expiry sweep clears pending → icon snaps back to real state (7s error card meanwhile)

BUSY-SPINNER button (e.g. Frunk):
  t=0     tap → BusyIcon spinner REPLACES the "Open" label; real frunk state still shown; button non-pressable, 0.5 dim
  ack     VEHICLE_COMMAND_SUCCESS → finished() → spinner stops; frunk state updates on next poll
  FAIL    spinner clears immediately + error card
  no-ack  t=30s → spinner clears
```

---

## §2. The visual recipe — `ControlButtonStatus` + `BusyIcon` `[iOS-verified]`

**`ControlButtonStatus`** has **4** members (R10 correction): `{ NONE, BUSY, DISABLED, EDITING }`.

| status | icon | opacity | pressable | spinner |
|---|---|---|---|---|
| **NONE** | normal | 1.0 | yes | — |
| **BUSY** | **replaced by `BusyIcon`** | **0.5** (`iconButtonBusyOpacity`) | **no** (`isDisabledStatus`) | **yes** |
| **DISABLED** | normal | **0.5** | no | — |
| **EDITING** | (edit affordance) | — | — | — |

So **DISABLED and BUSY both dim to 0.5** (R12), but only BUSY swaps in the spinner and only DISABLED is set by a separate `disabled` prop. *(This is why a seat button "greyed out because climate is off" looks different from a "waiting" button — same 0.5 dim, but one has a spinner.)*

**`BusyIcon`** (fn #35385, iOS 1428412) — the waiting circle:
- Props `{ size (default **20**), color, large, speed (default **900**) }`.
- Animation: `Animated.loop(Animated.timing(v, { toValue: 1, duration: 900, easing: Easing.linear, useNativeDriver: true }), { iterations: -1 })` — **infinite, 900 ms/turn, linear** (iOS 1428461-1428495).
- Render: an **`Animated.Image`** whose source is the bundled **`mini_spinner`** (R4), `style = [{ width: size, height: size, tintColor: color }, { transform: [{ rotate }] }]`. **It REPLACES the icon — it is NOT a ring/border around the button.** Header spinners pass `size = 18`.
- **Cybertruck theme** swaps the image for a **Lottie** animation (`autoPlay`, `loop`, iOS 1428562).

**The decision, stated plainly:** a button flips optimistically iff its **display selector folds `ongoing` commands**; it spins iff the **component wires a `use*BusyStatus` → `status=BUSY`**. There is **no per-command registry** toggling optimism. `ignoreForOptimistic` merely removes a command from *all* feedback.

---

## §3. Per-button catalog

**Legend:**
- **OPTIMISTIC** = flips to the new state instantly (selector folds `ongoing`), no spinner, reverts at 30 s / on failure.
- **SPINNER** = shows a `BusyIcon` (real state unchanged) until ack/timeout.
- **REFLECT** = poll-only; no flip, no spinner; updates on next poll.
- **F&F** = fire-and-forget momentary action; no feedback.
- **RELEASE** = local value during drag/hold, command fired once on release.
- **NAV** = opens another screen; no command from this button.

### Controls screen

| Button | Class | Command / action | State field + selector | Notes |
|---|---|---|---|---|
| **Lock / Unlock (centre glyph)** ★ | **OPTIMISTIC** | `rkeCommandAction(RKE_ACTION_LOCK / _UNLOCK)` (signed RKE) via `SEND_VEHICLE_COMMAND`; auto-secure variant `RKE_ACTION_AUTO_SECURE_VEHICLE` | `locked` via `isVehicleLocked(closures, chargeState, phoneKey, **ongoing**)` (iOS 1221029 → slot221) | **Flips instantly, NO spinner.** *(Resolved a reader conflict: slot221 checks the pending RKE lock action — iOS 1214825 — so it is ongoing-aware.)* `disabled` only when lock state unknown; blocking preconditions show a phone-key nudge instead. |
| **Frunk "Open"** | **SPINNER** | `sendFrunkCommand` → closure actuate `FRONT_TRUNK` (`SEND_VEHICLE_COMMAND`) | `frunk_opened`; `status = useClosureActionBusyStatus(FRONT_TRUNK).busy ? BUSY : NONE` (iOS 4040361) | Label → `action_busy` while busy. GHOST. **Waiting spinner, does NOT flip.** |
| **Trunk "Open"** | **SPINNER** | closure actuate `REAR_TRUNK` | `trunk_opened`; `status` from `useClosureActionBusyStatus(REAR_TRUNK)` (iOS 4040659) | As frunk. |
| **Charge-port Open / Close** | **OPTIMISTIC** † | `rkeCommandAction(RKE_ACTION_OPEN_CHARGE_PORT / _CLOSE_)` | `charge_port_door_open` via `isChargePortDoorOpen(chargeState, phoneKey, **ongoing**)` (iOS 1238509) | `disabled` when charging/plugged/powershare. † One reader read the wrapper `getSelectedVehicleChargePortOpen` as poll-only; but it's in the reconcile predicates (`checkChargePortCommand`) and `isChargePortDoorOpen` folds `ongoing` → **optimistic**. |
| **Sentry Mode** | **OPTIMISTIC** | `VehicleCommand.sentryModeOn(!current)` | `sentry_mode` via `isSentryModeOn(closures, **ongoing**)` (iOS 1279176) | Icon/testID flip `sentry_on↔off`. `disabled` when state `null`. |
| **Window Vent / Close** | **OPTIMISTIC** | `VehicleCommand.windowControl(action)` | `isVehicleWindowAllClosed(closures, cfg, **ongoing**)` (iOS 3982207) | Close first runs `canCloseWindows` + native confirm `Alert`. No spinner. |
| **Sunroof Vent / Close** (if equipped) | **OPTIMISTIC** | `changeSunroofState(VENT / CLOSE)` | `sun_roof_percent_open` via `isSunroofOpened/Closed(closures, **ongoing**)` | `disabled` mid-transition (`!open && !closed`). |
| **Remote Start** | **OPTIMISTIC + countdown** (SPINNER while dispatching) | `remote_start_drive` | `isRemoteStartActive(closures, **ongoing**)` + `getSelectedCountDownTimeStamp` | `status = useVCSECActionBusyStatus(RKE_ACTION_REMOTE_DRIVE).busy ? BUSY : …` (iOS 3980750) — brief spinner, then active + live countdown. |
| **Climate quick-toggle** | **OPTIMISTIC** (SPINNER only for sub-actions) | `climateOn(true/false)` via `SEND_VEHICLE_COMMAND` | `isClimateOn(state, **ongoing**)` → `button_on/off_title_case` | Spins only if a max-precondition / bioweapon / climate-keeper sub-action is in flight (iOS 3982571). |
| **Flash Lights** | **F&F** | `flash_lights` | — | Momentary. No feedback. |
| **Honk Horn** | **F&F** | `honk_horn` | — | Momentary. |
| **HomeLink** | **F&F** | `trigger_homelink` | — | Momentary. |
| **Boombox / Fart** | **F&F** | `remote_boombox` | — | Momentary. |
| **Speed Limit** | **NAV** | — | — | Opens `VehicleSpeedLimitModeScreen`; commands live there. |
| **Valet** | **NAV** | — | — | Opens `VehicleValetModeScreen`. |
| **Suspension / Zone-light** | **SPINNER** | via `useCarServerActionBusyStatus` → `status` | — | Wire a busy status (iOS 3989639 / 3989369). |
| **Bioweapon / CPD** | **REFLECT** | bioweapon HVAC mode | `getSelectedBioWeaponMode` (non-ongoing) | Flips only on next poll. |

### Climate screen

The climate screen routes heater-family commands through `sendVehicleHeaterCommand` → the saga adds an optimistic record, so climate selectors flip instantly.

| Button | Class | Command / action | State field + selector | Notes |
|---|---|---|---|---|
| **Climate On / Off (power)** | **OPTIMISTIC** | `climateOn(bool)` | `isClimateOn(state, **ongoing**)` | *(Verify: dispatched as plain `SEND_VEHICLE_COMMAND`, displayed selector-level — not a special 30 s "state-overlay". Same net behaviour.)* |
| **Temperature ± / setpoint** | **RELEASE (optimistic-local)** | `changeClimateTemperatureSetting(temp, temp)` (heater), **debounced 1200 ms leading+trailing** (iOS 5221724) | local setpoint immediately; server value on reconcile | Slider shows local value at once; command debounced. |
| **Seat heaters** (per seat) | **OPTIMISTIC (never spins)** | `sendVehicleHeaterCommand(…seatHeaterLevel…)` (iOS 3987248) | `getSeatHeaterLevel(heater, state, **ongoing**)` (iOS 3986641) — shows the new level at once | **`status` is explicitly forced BUSY→NONE** (iOS 3986600) — it never spins. `disabled` when `!isClimateOn`. |
| **Steering-wheel heater** | **OPTIMISTIC** | `sendVehicleHeaterCommand` | `isSteeringWheelHeaterOn/Auto(state, bitmask, cfg, **ongoing**)` (iOS 3988322) | Color flips `buttonHeaterOn/Off`. No spinner. |
| **Defrost / Max-Defrost** | **REFLECT** (SPINNER when wired) | max-defrost (carserver `HVACSETPRECONDITIONINGMAXACTION`) | `maxDefrostOn` | Standalone reflects; busy tracked via `useCarServerActionBusyStatus(HVACSETPRECONDITIONINGMAXACTION)` where the ClimateToggle consumes it. |
| **Keep Climate / Dog / Camp** | **SPINNER** | `HvacClimateKeeperAction(DOG / CAMP / OFF)` (iOS 5222391) | `getClimateKeeperMode` | **These are the climate buttons that spin** — `useClimateKeeperBusyStatus([DOG,CAMP,OFF])` → `BUSY` (iOS 5221597). |
| **Cabin Overheat Protection** (Off / FanOnly / On + Low/Med/High) | **REFLECT** | plain `sendCommand` | CPD state | *(Verify: the reader's "Auto/Fan/Recirc" was a misID of the COP segmented control; the COP enable switch carries a busy status.)* |

### Charging screen

| Control | Class | Command / action | State field + reconcile | Notes |
|---|---|---|---|---|
| **Start / Stop charging** | **OPTIMISTIC** | `startCharging()` / `stopCharging()` (`charge_start`/`charge_stop`) | `charging_state` via `getVehicleChargingState(state, **ongoing**)` / `isChargingStopped(state, ongoing)` (iOS 1238447) | Label flips START↔STOP. No spinner. `disabled` unless STARTING/CHARGING/CALIBRATING/STOPPED. |
| **Charge-limit slider (SOC)** | **RELEASE** | `changeChargeLimit(pct)` on `onSlidingComplete` (`set_charge_limit`) | `charge_limit_soc` | Thumb tracked **locally** during drag; command fires **once on release, no debounce**. |
| **Charge current / amps stepper** | **RELEASE (press-hold)** | `setChargingAmps(a)` on release (`set_charging_amps`) | `charge_amps` (min 5, max nominal) | Local `useState(-1)`; +/- and press-hold `setInterval(95 ms)` mutate local; on release dispatch once + reset to `-1` (reconcile to server). |
| **Scheduled charging toggle** | **RELEASE (settings write)** | `scheduledCharging(enabled, time)` (`set_scheduled_charging`) | `scheduled_charging_mode` == `SCHEDULEDCHARGINGMODESTARTAT` + `scheduled_charging_start_time` (iOS 1237223) | *(Verify corrected the reconcile field from `scheduled_charging_pending`.)* Local switch state; settings write. |

### Home / Security / other
- **Home**: no separate command buttons; tiles reflect state and route into Controls/Charging. The start/stop CTA is the same `ChargingControlButton` (optimistic).
- **Lock / Sentry** also appear as standalone `LockControlButton` / `SentryControlButton` — same optimistic behaviour as the Controls entries above.
- **PIN-to-Drive, Guest Mode, Summon**: live on their own screens, not classified this round (UNRESOLVED — see Gaps).

---

## §4. What to build (airgapp parity)

1. **Model commands as a pending list**, not a state patch: `onGoingByVehicleId[vehicleId] = [{ commandId, action, startTime, endTime? }]`, newest-first, drop same-endpoint on re-issue, cap 200.
2. **Two orthogonal UI hooks off that list:**
   - `useEffectiveState(field)` — a selector that folds any pending command's target onto the polled value (drives the **optimistic flip**).
   - `useBusy(commandType)` — "is there an unfinished pending command of this type?" (drives the **spinner**).
3. **Per button, pick from §3:** most closures/toggles = optimistic-flip-no-spinner; frunk/trunk + climate-keeper = spinner; flash/honk/homelink/boombox = fire-and-forget; sliders/steppers = local-during-interaction, command-on-release.
4. **Reconcile on every poll** (`5000 ms online / 1200 ms waking`) and on **BLE** (`closure_state.{locked, cp, ft, rt}`) by comparing desired vs real and dropping matched commands; **remove on `COMMAND_FAILED` immediately**; **sweep `startTime + 30000 < now` each poll tick**.
5. **`BusyIcon`** = rotating `mini_spinner` image, **20 px** (18 in headers), **900 ms/turn linear infinite**, tinted by `color`, **replacing the icon** (not a ring). BUSY ⇒ also 0.5 dim + non-pressable. DISABLED ⇒ 0.5 dim, no spinner.
6. **Error card is a separate 7 s layer** — do not couple it to the 30 s overlay revert.

---

## §5. Gaps (plainly)

- **Android UI/redux parity** not re-disassembled this round — all `[iOS-verified]`. (Command *execution* is native on Android per R1; the redux/selector layer is expected to match but was not diffed.)
- **Charge-port** carried a reader conflict (poll-only wrapper vs ongoing-aware `isChargePortDoorOpen`). I classed it **OPTIMISTIC** because it appears in the reconcile predicates (`checkChargePortCommand`) and the folding selector takes `ongoing` — but the exact wrapper (`getSelectedVehicleChargePortOpen`) wasn't fully traced. Flagged.
- **Flash / Honk** fire-and-forget is INFERRED from the endpoints (`flash_lights` 1275244, `honk_horn` 1275270) + no status wiring; render sites not opened.
- **PIN-to-Drive, Guest Mode, Summon, Speed-Limit/Valet sub-screens** — not command buttons in the Controls module; each lives on its own screen. Not classified.
- **Standalone Max-Defrost** button: whether it wires its own `status=BUSY` or only reflects `maxDefrostOn` is INFERRED (the busy status exists and is consumed by the ClimateToggle; the standalone button's own wiring wasn't confirmed).
- `getOptimisticResult` (iOS 2526341/2528684/2534227) is **TanStack/React-Query internal — NOT Tesla vehicle state**; excluded (verify CONFIRMED).

---

## §6. Citations (iOS v4.56)

- Reducer `onGoingCommandReducer` fn #29049 @1187114-1194489; whitelist @1184631-1184658; `CommandRecord` @1184568-1184606; `onGoingByVehicleId` @1194497; SEND branch @1194262-1194485; cap 200 @1194471.
- Reconcile: poll branch @1187177-1194032; `checkLockCommand` @1186667; `checkChargePortCommand` @1186761; `checkFrunkTrunkCommand` @1186905; BLE branch @1194034-1194108; SUCCESS @1194238; FAILED @1194186; `commandCausesVehicleDataUpdate` @1185153; timeout filter @1193948-1193972; `OPTIMISTIC_TIMEOUT_MS` @1221613; `firstCommandRecordMatchingActions` fn #30029 @1227630.
- Dispatch: `sendVehicleOptimisticCommand` @1196689; `sendVehicleHeaterCommand` @1196712; heater saga @3972866/3973049; `ignoreForOptimistic` set @1196674, read @1194279; `useVehicleCommand` fn #96534 @3926737.
- Overlay selectors: `getSelectedOngoingCommands` @1279940; slot221 @1214837 (RKE lock check @1214825); `isVehicleLocked` @1221029; `isSentryModeOn` @1279176; `isChargePortDoorOpen` @1238509; `isVehicleWindowAllClosed` @3982207; `getVehicleChargingState` @1225213; `isChargingStopped` @1238447; `getSeatHeaterLevel` @3986641; `isSteeringWheelHeaterOn/Auto` @3988322.
- Busy/visual: `useCommandTypeBusyStatus` @1872209; `useClosureActionBusyStatus` @1872187; `ControlButtonStatus` (4 members); `ControlButtonComponent` module 2456 @3991976 (icon swap @3992216); `BusyIcon` fn #35385 @1428412 (loop @1428461, image @1428531, Lottie @1428562).
- Buttons: Lock @3984019; Frunk on-image @4040361; Trunk @4040659; ChargePort @3983349; Sentry @3981851; WindowVent @3982184; Sunroof @3988854; RemoteStart @3980503; ClimateToggle @3982490; Flash @3981330; Honk @3981446; HomeLink @3981624; Boombox @3981525; SeatHeater @3986555 (status→NONE @3986600); SteeringWheelHeater @3988249; ClimateKeeper busy @5221597; ChargingControlButton @3983809; charge-limit slider @4157833; amps stepper @4167600; scheduled charging `getScheduledChargingMode` @1237223.
