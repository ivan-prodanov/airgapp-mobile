# R13 — The PESSIMISTIC (busy-spinner) path + how a button picks its path

Source: iOS `/Users/ivan/Downloads/tesla-haptics-work/main.decompiled.js` (v4.56). All line numbers below are iOS. Tagged [iOS-verified] unless noted. Android (`bundle.hasm`) not re-cross-checked this round; architecture matches R1 (command EXECUTION native on Android; this is the RN/redux UI layer).

---

## §1 — `useVehicleCommand` (fn #96534 @ 3926737) — VERBATIM return [iOS-verified]

Returns a **3-key object, NO busy/status field**:
```
r0 = {};
r0['vehicleId']    = r3;   // getSelectedVehicleId(vin) or passed vehicleId   @3926898
r0['sendCommand']  = r2;   // useCallback(...)                                 @3926899
r0['carApiVersion']= r1;   // getVehicleCarApiVersion                          @3926900
return r0;
```
- `sendCommand` (inner fn #96538 @3926836) calls **`Actions.sendVehicleCommand(...)`** (@3926864 `r13 = r14.sendVehicleCommand`; invoked @3926891) with `CommandRequestSource.SOURCE_APP_JS` (@3926871), vin, vehicleId, command, currentActiveRouteName, tonneauMovementState, etc.
- `Actions.sendVehicleCommand` dispatches **`SEND_VEHICLE_COMMAND`** — the PESSIMISTIC action. `useVehicleCommand` **never** dispatches `SEND_VEHICLE_OPTIMISTIC_COMMAND`.
- Sibling `sendCommandWithId` (fn #96539 @3926905) also dispatches `sendVehicleCommand` and returns the generated commandId (v4/uuid). Same pessimistic action.
- **`useVehicleCommand` does NOT return in-flight status.** A caller that wants busy state calls a separate `use*BusyStatus` hook (§2).

**⇒ Answer Q1:** `useVehicleCommand` = `{vehicleId, sendCommand, carApiVersion}`; `sendCommand` → `SEND_VEHICLE_COMMAND` (pessimistic). No status. In-flight status is looked up separately.

---

## §2 — Busy-status selectors [iOS-verified]

### The full family (module @ ~1872xxx)
| Hook | line | descriptor it builds |
|---|---|---|
| `useCarServerActionBusyStatus(case)` | 1872143 | `{vehicleActionCases:[case], rkeActions:null, closures:null}` |
| `useCarServerActionsBusyStatus(cases)` | 1872155 | `{vehicleActionCases:cases,…}` |
| `useVCSECActionBusyStatus(rke)` | 1872165 | `{rkeActions:[rke],…}` |
| `useVCSECActionsBusyStatus(rkes)` | 1872177 | `{rkeActions:rkes,…}` |
| `useClosureActionBusyStatus(closure)` | 1872187 | `{closures:[closure], vehicleActionCases:null, rkeActions:null}` |
| `useClosureActionsBusyStatus(closures)` | 1872199 | `{closures:closures,…}` |
| `useCommandTypeBusyStatus(descriptor)` | 1872209 | **the shared resolver** (all above delegate here via `_closure1_slot2`) |
| `useClimateKeeperBusyStatus(levels)` | 1872264 | matches HVACCLIMATEKEEPERACTION + level set |
| `useSuspensionBusyStatus(...)` | 1872387 | suspension |

Descriptor builders (non-hook): `carServerCommandType(s)` @1872086/1872095, `closureCommandType` @1872102, `vcsecCommandType(s)` @1872127/1872136, `nullCommandTypes` @1872112, `buttonControlTypeMatchesCommandAction` @1872070 (maps a **ControlButton control-type** → command types via `commandTypesForControlButton` @1872530).

### What `{busy}` derives from (shared resolver `useCommandTypeBusyStatus` @1872209-1872261) [iOS-verified]
```
list  = getSelectedOngoingCommands(state)                 // @1872228
found = list?.find(c => commandTypesMatchCommandAction(descriptor, c.action))   // @1872235-1872245
busy  = found != null && !found.finished()                // @1872249-1872252
return { busy }                                           // @1872258
```
- **Lookup is by COMMAND TYPE, never by commandId.** The descriptor `{vehicleActionCases, rkeActions, closures}` is matched against each in-flight command's decoded action.
- `getSelectedOngoingCommands` (@1279940) = reselect `createSelector` → the selected vehicle's list of in-flight `CommandRecord`s.

### The matcher `commandTypesMatchCommandAction` (fn #46350 @1871678) [iOS-verified]
Decodes the command's carserver action and matches against the descriptor:
- **closures** → `getClosureAction` → `doorsFromClosureMoveRequest` / `vehicleClosureFromClosureMoveRequestDoor` includes-check (@1871948-1871963)
- **vehicleActionCases** → `getVehicleActionMsgCase` includes-check (@1872027-1872047)
- **rkeActions** → `getRkeAction` (@1871978)
- Early special-case block (@~905-1022) returns matched for certain payloads (GETREADERKEYREQUEST, CENTERDISPLAYREQUEST, WEBRTCREQUEST, CPDRESPONSE).

### `CommandRecord` model + `finished()` [iOS-verified]
`CommandRecord(commandId, action, startTime)` with `success=false` (@1184568-1184583). `finished()` = **`this.endTime != null`** (@1184591-1184596). So `busy` = a matching command exists AND its `endTime` is still unset.

**⇒ Answer Q2:** `{busy}` = "is there a not-yet-finished in-flight command whose decoded action matches this descriptor." Keyed by command TYPE (closure enum / VehicleAction msg case / RKE action), NOT by commandId.

---

## §3 — `ControlButtonStatus` enum + visual recipe [iOS-verified]

### Enum (VERBATIM @1340819-1340828) — note it is **4 values**, R10's 3-value set was incomplete:
```
{ EDITING:'editing', DISABLED:'disabled', BUSY:'busy', NONE:'none' }
```
(sibling enums: `ControlButtonAppearance` @1340800 = {STATELESS_FILLED, STATELESS_FEEDBACK, STATELESS_GHOST, STATEFUL_ON, STATEFUL_OFF}; `ControlButtonColorScheme` = {DEFAULT, ALTERNATIVE}; `ControlButtonSize` = {SMALL, MEDIUM, LARGE}.)

### `isDisabledStatus(status)` (@1340839) [iOS-verified]
Returns `[DISABLED, BUSY].includes(status)` — **BUSY is treated as disabled (non-pressable).**

### Per-status visual recipe (this round + R4):
| status | icon | opacity | pressable | spinner |
|---|---|---|---|---|
| **NONE** | normal icon | 1.0 | yes | none |
| **BUSY** | icon **REPLACED by `BusyIcon`** | 0.5 (`iconButtonBusyOpacity`, R4) | **no** (isDisabledStatus) | rotating spinner |
| **DISABLED** | normal icon | 0.5 | no | none |
| **EDITING** | edit/jiggle affordance | — | — | none |

**⇒ Answer Q3:** confirmed. BUSY = spinner-replaces-icon + 0.5 dim + non-pressable. DISABLED = 0.5 dim, no spinner. NONE = full. (Plus a 4th EDITING state.)

---

## §4 — THE DECISION: optimistic vs busy-spinner [iOS-verified]

Both actions land in the **same** ongoing-commands reducer (fn #29049 @1187113, immer `produce`), which responds to (@1184631-1184658):
```
[ SEND_VEHICLE_COMMAND, SEND_VEHICLE_OPTIMISTIC_COMMAND,
  VEHICLE_COMMAND_SUCCESS, VEHICLE_COMMAND_FAILED,
  VEHICLE_DATA_REQUEST_SUCCESS, VEHICLE_PHONE_KEY_STATUS ]
```
Both `SEND_VEHICLE_COMMAND` and `SEND_VEHICLE_OPTIMISTIC_COMMAND` hit the **same add-branch (case 8785 @1194262)** and push a `CommandRecord`. ⇒ **every in-flight command — optimistic or not — makes its matching button `busy` via `getSelectedOngoingCommands`.** Busy status is NOT what distinguishes the two paths.

The distinguishing mechanism, inside that add-branch:
```
case 8785:
  payload → vehicleId, commandId, tonneauMovementStateAtBeginning, command
  if (type === SEND_VEHICLE_COMMAND)                      // @1194278
      ignoreForOptimistic = payload.ignoreForOptimistic ?? false   // @1194280-1194289
  // (SEND_VEHICLE_OPTIMISTIC_COMMAND skips this → ignoreForOptimistic stays false)
  log('[MASK] ignoreForOptimistic', ignoreForOptimistic) // @1194297
  if (ignoreForOptimistic)  → jump 9580 (SKIP overlay)    // @1194299
  else                      → apply optimistic overlay of `command` onto displayed
                              state (closure / tonneau…)   // @1194300+ (case 8935)
```
- `ignoreForOptimistic` is **set on dispatch** at @1196674 and read here at @1194281 (matches R1 recon exactly).
- So **the deciding factor is `ignoreForOptimistic`**, evaluated inside the reducer:
  - `SEND_VEHICLE_OPTIMISTIC_COMMAND` (from `sendVehicleOptimisticCommand`, fn 1196689) → overlay applied → button shows the NEW state instantly, no spinner needed.
  - `SEND_VEHICLE_COMMAND` with `ignoreForOptimistic=true` → overlay skipped → displayed state unchanged → the button falls back to the **busy spinner** (its `use*BusyStatus` hook is `true` but there's no state flip to show).
  - `SEND_VEHICLE_COMMAND` with `ignoreForOptimistic` false/absent → overlay still applied by the reducer.
- There is **no per-command registry table** flipping optimistic on/off. The choice is (1) which action the caller dispatches (`sendVehicleOptimisticCommand` vs `sendVehicleCommand`) and (2) the `ignoreForOptimistic` boolean on the payload. The COMPONENT independently decides whether to render `status={busy?BUSY:NONE}` (spinner) and/or read the optimistically-overlaid `vehicle_data` (instant flip); many closure buttons (frunk/trunk, R10) render the busy spinner while relying on the overlay for the state icon.
- **30s revert tie-in:** matches are gated by `firstCommandRecordMatchingActions` (fn #30029 @1227630); its `isLegit` check `startTime > now - timeout` (@1227695-1227699) drops commands older than the timeout (OPTIMISTIC_TIMEOUT_MS=30000, R1) — so both the busy spinner and the optimistic overlay auto-clear after 30s.

**⇒ Answer Q4:** The path is decided by **`ignoreForOptimistic`** (read in reducer fn 29049 @1194281) plus which action was dispatched — NOT by a per-command config map, and NOT by busy status (both paths are "busy"). Optimistic = overlay `command` onto displayed state; busy-spinner = overlay suppressed (`ignoreForOptimistic`) so only the spinner shows.

---

## §5 — `BusyIcon` geometry (fn #35385 @1428412) [iOS-verified]

Props: `{size (default 20 @1428417), overridingTheme, color, large, speed (default 900 @1428434)}`.
- Animation: `Animated.Value(0)` → `Animated.loop(Animated.timing(v, {toValue:1, duration:speed(900ms), easing:Easing.linear, useNativeDriver:true}), {iterations:-1})` — **infinite, 900 ms per full turn, linear** (@1428461-1428495).
- `interpolate([0,1] → ['0deg','360deg'])` (@1428507-1428513).
- **Normal render (@1428531-1428560):** an **`Animated.Image`** whose `source` = a bundled asset (module slot 7, or slot 8 when `large`) — the rotating **mini_spinner** — with `style=[{width:size, height:size, tintColor:color}, {transform:[{rotate}]}]`. So the spinner **REPLACES the icon** (a rotating image swapped in), it is **NOT** a ring/border around the button.
- **CYBERTRUCK theme branch (@1428562-1428575):** renders a **Lottie** animation (`autoPlay:true, loop:true`, module slot 6) instead of the rotating image.
- Sizes: default 20; header spinners pass `size=18` (R4).

**⇒ Answer Q5:** Rotating `mini_spinner` `Animated.Image`, 20px default / 18px header, 900 ms/rev, linear, infinite, tinted by `color`. Replaces the icon (not a surrounding ring). Cybertruck theme swaps it for a Lottie.

---

## Corrections to prior rounds
- **R10**: `ControlButtonStatus` has **4** members (EDITING, DISABLED, BUSY, NONE), not 3.
- **New**: `isDisabledStatus` = `[DISABLED,BUSY].includes(status)` — BUSY buttons are non-pressable.
- **New**: busy status keys on command TYPE via `getSelectedOngoingCommands` + `commandTypesMatchCommandAction`, never commandId.
- **Confirmed R1**: `ignoreForOptimistic` (@1194281 read / @1196674 set) is the optimistic-vs-busy switch, inside reducer fn 29049.
