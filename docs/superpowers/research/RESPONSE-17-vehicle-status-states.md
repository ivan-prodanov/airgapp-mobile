# RE RESPONSE #17 — the complete vehicle-status state machine

**Answers:** `REQUEST-17-vehicle-status-states.md` (Q1–Q8).
**Method:** direct Hermes bytecode analysis of the official iOS bundle by me. **Both agent workflows for this request died on transient `529 Overloaded` errors (9 agents, 0 completions), so I did the work myself** rather than relaunch blindly. That has a consequence worth stating up front: **this response has no independent adversarial verification.** Everything below is cited to an offset you can re-check, and I mark clearly what is proven vs inferred vs unresolved.
**Artifacts:** `main.jsbundle` (Hermes v96) via the `hermes_dec` toolkit in `…/scratchpad/hdvenv`; full recursive disassembly saved at `…/scratchpad/req17_vst.txt`.

> **Index note:** your `#117231 / #30694 / #30697` are **Android** bundle indices. The iOS equivalents are **`VehicleStatusText` = #111147**, `isVehicleDataStale` = #30240, `fetchedDataRecently` = #30243. Indices do not transfer between bundles; the logic does.

---

> ### ⚠ CORRECTION 2026-07-26 — prompted by Ivan's on-device screenshot (Polish app, car at speed)
> The screenshot shows, under the car name: **`111 KM/H`** (grey) and below it **`Samodzielna jazda`** (blue).
> **The substance below is confirmed — the phrasing was too strong.** Corrections:
> 1. **CONFIRMED:** while driving, the status line renders a **composed speed** (`111 KM/H` = `speedText` + `speedUnitsText`), exactly as the not-parked routing predicts. It does **not** say "Jazda" (Polish for *Driving*). This is direct on-device confirmation of the mechanism.
> 2. **OVER-CLAIM CORRECTED:** "the official app does NOT have a 'Driving' string" is wrong as written — `s[475950]='Driving'` and `s[209182]='Jazda'` **do** exist in the bundle. The accurate claim, now proven rather than merely unproven: **`VehicleStatusText` (#111147) references none of them — 0 hits for string ids 475950 / 209182 / 152126 in the whole recursive disassembly.** Those strings belong to other surfaces, not this status line.
> 3. **The blue second line is `Autopilot`, not "Driving".** `s[152126]='Samodzielna jazda'` is Tesla's Polish rendering of **Autopilot** — proven by `s[270990]`: *"Aby włączyć Summon, wybierz opcje **Samodzielna jazda** > Summon na ekranie dotykowym pojazdu"* (= "select **Autopilot** > Summon on the vehicle touchscreen", the car's Autopilot menu path); cf. `s[344527]='Pełna Zdolność do Samodzielnej Jazdy'` (Full Self-Driving Capability). It is **not** emitted by #111147, so it comes from a **separate component** — an Autopilot/FSD-engaged indicator that appears only when the car is actually on Autopilot, and would be absent on a manually-driven car.
> 4. **Q6 answered concretely:** the screenshot is the two-line status area I inferred from `oneLineTextContainer` — line 1 = composed speed (this component), line 2 = the Autopilot indicator (another component). For airgapp: the speed line is BLE-local; an Autopilot-engaged line would need FSD state you may not have on the wire.

---

# ADDENDUM (2026-07-26) — the two header text lines, and the FSD/Autopilot question

Follow-up research into the line under the speed. **The header is three separate components**, which is why "the status line" kept looking inconsistent:

| line in your screenshot | component | what it is |
|---|---|---|
| `111 KM/H` | **`DriveStatusText` #118286** | the **speed/drive** line — fully recovered below |
| *(the state line, e.g. Parked)* | **`VehicleStatusText` #111147** | the 19-branch state machine in the main body |
| `Samodzielna jazda` (blue) | **not located in this bundle** | see the honest limit at the end |

## A. `DriveStatusText` (#118286) — the speed line, fully recovered

It is **not** a fixed-string state machine. It builds an array of up to three parts, drops the empty ones, and joins them with a **middle-dot separator**:

```js
[ speedPart, shiftStatePart, distancePart ].filter(Boolean).join(' · ')
```
(`filter` @`0266`, `SpecialCharacters.dotSeparator` @`028a`, `concat` @`029e`, style `driveStatusText` @`024a`.)

**Part 1 — speed** (`speed` @`00a1`): formatted by `tr('speed_km_per_hour_pattern')` @`017a` or `tr('speed_miles_per_hour_pattern')` @`0186`, chosen by `isDistanceUnitInMiles` @`0153` off `getSelectedGuiSettings` @`002a`. Your `111 KM/H` is exactly this. **BLE-local** — you already parse `DriveState.speed` (`telemetry.ts:288`) and units come from `getGuiSettings` (req 1).

**Part 2 — shift state** (`shiftState` @`00cc`): rendered via `getShiftStateDisplayString` @`00e8` (with `getShiftStateAbbreviationString` @`00bb` as the short form), and **gated by `isShiftStateInPark` @`00fe`** — i.e. the gear is suppressed when parked and shown when not. **BLE-local** — you already have it (`telemetry.ts:289`, `oneofName(dr.shiftState)`).

**Part 3 — distance from you** (@`0197`–`01f7`): requires `locationIsValid` for **both** `getDeviceLocation` and `getCurrentVehicleLocation` (both @`0066`/`008a` via `useXStateSelector`), then `distanceBetweenCoordinatesInMeters` @`01c1` → `metersToHumanReadableDistance` @`01db` → `convertMilesToGuiDistanceUnitString` @`0136` in `guiDistanceUnits` @`01f7`. **BLE-local-ish** — car position is in `LocationState` (you fetch it); phone position needs Location permission, which you now have for the region monitor.

**So the value table for this line is compositional, not enumerated:**

| condition | rendered |
|---|---|
| moving, gear not P, both locations valid | `111 KM/H · D · 2.3 km` |
| moving, gear not P, no valid location pair | `111 KM/H · D` |
| speed present, `isShiftStateInPark` true | `111 KM/H` (gear suppressed) |
| stationary/no speed, gear not P, locations valid | `D · 2.3 km` |
| nothing available | *(empty — component renders nothing)* |

(Which parts are non-empty is what varies; there is no fixed string list. `useSummonService` @`0041` is also read here, so a Summon session can influence it.)

## B. Q2 — how the app detects Autopilot/FSD, and whether you can

**Decisive negative:** there is **no `autopilot_state`, `fsd_state`, `autosteer*` or equivalent field anywhere in the decompiled CarServer (`fc0/*`) or VCSEC (`vc0/*`) protos** — an exhaustive grep returns nothing. **So FSD/Autopilot engagement is not carried on the BLE state protos you read.** Combined with the standing air-gap rule, the honest conclusion is:

> **airgapp cannot reproduce an "Autopilot engaged" indicator from BLE data.** Treat it as **cloud-only / out of scope**, exactly like the walk-away and left-open notifications in RESPONSE-13.

What you *can* build from BLE, and what actually covers the user-visible need, is **part 1 + part 2 above**: speed and gear. That is what makes the line read `111 KM/H` instead of `Parked` — which was the actual bug.

## C. Honest limit — I could not locate the blue label's renderer

I did **not** find the component that emits `Samodzielna jazda`, and I'm not going to guess again after the last over-claim. What I ruled out, with evidence:
- **Not `VehicleStatusText`** — 0 references to string ids 152126 / 209182 / 475950 in its full recursive disassembly.
- **Not `DriveStatusText`** — its only literals are the two speed patterns.
- **Not the FSD-stats row** — `vehicle_home_fsd_stats_title` is used by `#95549`, the home-screen **row registry** (alongside `vehicle_home_controls_title`, `vehicle_home_climate_title`, `GodotView`, `QuickControlButtons`…), and `fsd_stats_percentage_on_self_driving` by `HomeDefaultRow` #95561. Those are list rows further down the page, not the header.

Two reasons it may be un-findable here, both worth noting:
1. **The i18n catalog is not in bytecode.** Scanning every function for a reference to the Polish literal returns **0 hits** — the per-locale catalog lives in Hermes' *serialized literal buffers*, not in instructions. So key→locale-value mapping cannot be done by code-reference scanning (this also explains why I could not give byte-exact English copy for the status keys).
2. **Version skew.** I am analysing app **4.58.0**; your screenshot is a live phone (car firmware 2026.20.6.6) and may be a **newer app build**. If the indicator was added after 4.58.0, it simply is not in this bundle.

**Cheapest way to close it:** it is a tappable blue element — the header's press handlers are `onTitlePress` and `onStatusPress` (#111169, which fires `vehicleWakeUp(VehicleWakeReason.TAP_STATUS_TEXT)`). Tap it on the real phone and see where it navigates; that identifies the feature in one action. If it opens **FSD Statistics**, it is the FSD-stats entry point and cloud-backed; if it opens Autopilot settings, it is an Autopilot-engaged indicator. Either way, **cloud-only for you.**

---

## The headline for your bug

**The official app's status line has no "Driving" string — it has a `isShiftStateParked` gate**, and when the car is *not* parked it renders a **composed, speed-bearing status** instead of a fixed string:

```
05f6  JmpFalseLong  → 0a38        guard = isShiftStateParked(shiftState)
```
i.e. **"Parked" is a gated branch, not a default.** When `isShiftStateParked` is false, control jumps past all the fixed-string blocks into the composed render block at `0a38`, which renders `<Text automationID="vehicle_home_header_status_text" style={styles.headerStatusText}>` with a **computed** value — and the component's prologue reads exactly the three fields you'd need for it:

```
00d5  GetById  shiftState        (s[61920])
00db  GetById  speedText         (s[516200])
00e3  GetById  speedUnitsText    (s[477981])
```

**So your bug is real and your fix is not "add a Driving string" — it's "add the not-parked branch".** Your code has no `isShiftStateParked` equivalent at all, so a driving car falls into your `fetchedRecently → "Parked"` branch. You already compute `patch.driving` at `telemetry.ts:440` from `DriveState.gear` — that is the field you need, and it is BLE-local (you already fetch `DriveState`).

⚠ **Honest limit:** I proved the *routing* (not-parked → composed block) and that `speedText`/`speedUnitsText` are read into the component. I did **not** trace the final concatenation that produces the rendered string, so I cannot give you verbatim driving copy. `s[475950]='Driving'` exists in the string table but I could **not** tie it to #111147 — treat "the line literally says Driving" as **unproven**. What is proven: the app renders a *speed-bearing composed* status while driving, not "Parked".

---

## Q1+Q2 — the precedence chain (the primary deliverable)

Recovered flow-sensitively: I replayed the bytecode, tracking each register back to the selector that populated it, then resolved every guard's jump target. **First match wins, top to bottom.** All offsets are in #111147.

| # | offset | predicate (selector + comparison) | renders | BLE-local? |
|---|---|---|---|---|
| 1 | `04be` | `getIsSelectedVehicleRunningSohTest === <const>` | → composed block `0a38` | **CLOUD** (SoH test state) |
| 2 | `04c5` | `getIsUsingStaticVehicleData` | `tr(vehicle_home_parked_state)` | **CLOUD** (static/demo data) |
| 3 | `04cb` | `currentVehicleMobileAccessDisabled` | `tr(vehicle_home_mobile_access_status)` | **CLOUD** |
| 4 | `04d1` | `getSelectedInServicePerGarage` | `tr(vehicle_home_in_service_status)` | **CLOUD** |
| 5 | `04d7` | `currentVehicleInService` | `tr(vehicle_home_service_mode)` | **CLOUD** |
| 6 | `04dd` | `currentVehicleSignedCommandsRequired` | `tr(vehicle_home_upgrade_app_warning)` | **CLOUD** (app-version gate) |
| 7 | `04e3` | **`isDataStale`** | `tr(connecting_label)` | **BLE-local** |
| 8 | `0510` | `isPowershareStatusHandshaking(...)` | `tr(powershare_state_handshaking)` | CT-only |
| 9 | `0532` | `isPowershareStatusInitializing(...)` | `tr(powershare_state_initializing)` | CT-only |
| 10 | `054c` | `isPowershareStatusActive(getSelectedPowershareStatusEnum)` | `tr(powershare_state_active)` + stop-reason sub-chain | CT-only |
| 11 | `055a` | `vehicleStoppedPowershareSelector` | `tr(powershare_state_stopped)` (+ `_retrying` / `_faulted_title` / `_reconnecting_to_grid_title` / `_adapter_updating_title` via `PowershareStopReason` at `06eb–0766`) | CT-only |
| 12 | `057d` | `getSelectedChargingStateEnum === CHARGING` | → composed block `0a38` | **BLE-local** |
| 13 | `05a7` | `getSelectedChargingStateEnum === CALIBRATING` | → composed block `0a38` | **BLE-local** |
| 14 | `05cb` | `getSelectedChargingStateEnum === STARTING` | `tr(vehicle_home_start_charging)` | **BLE-local** |
| 15 | `05dd` | *(charging-related reg)* | → composed block `0a38` | BLE-local |
| 16 | `05e3` | `chargeOnSolarHasError` | `tr(cos_error_status)` | **CLOUD** (solar) |
| 17 | `05e9` | *(unresolved reg r40)* | `' '` (single space) | — |
| 18 | `05ec` | `getSelectedVehicleLowPowerModeOn === <const>` | `tr(vehicle_home_low_power_mode)` | **BLE-local** |
| 19 | `05f6` | **`isShiftStateParked(shiftState)`** — TRUE falls through to `tr(vehicle_home_parked_state)` @`0a2b`; **FALSE → composed block `0a38`** | Parked / composed | **BLE-local** |

**Your explicit precedence questions, answered:**
- **Charging vs Driving:** **Charging wins** (#12–14 sit above the `isShiftStateParked` gate at #19).
- **Stale vs live states:** **stale sits at #7 — ABOVE charging, powershare, low-power and parked**, but *below* the cloud/service states. Your own doc's guess that "live states take priority, stale is last" is **wrong** — `isDataStale → connecting_label` beats every physical-state branch.
- **Sentry:** no Sentry branch exists in this component (`s[110033]='Sentry Mode'` is not loaded here).
- **CPD** (`vehicle_child_presence_detected` @`1019`) and the **charge-ETA** strings (@`0d17/0d78`) live *inside* the composed block, not in the main chain.

**All 28 emission sites** with their nature (`tr()` = real copy; `automationID` = test id, **not** display text):

`0615 tr(vehicle_home_parked_state)` · `0640 tr(vehicle_home_low_power_mode)` · `0664 ' '` · `0691 tr(cos_error_status)` · `06bc tr(vehicle_home_start_charging)` · `0783/07ae/07d9/0804/082f tr(powershare_state_stopped / _adapter_updating_title / powershare_status_faulted_title / _reconnecting_to_grid_title / _retrying)` · `086b tr(powershare_state_active)` · `0896 tr(powershare_to_grid_active_title)` · `08b9 tr(powershare_state_initializing)` · `08f6 tr(powershare_state_handshaking)` · `0927 tr(connecting_label)` · `0966 tr(vehicle_home_upgrade_app_warning)` · `0971 phone_key_pairing_intro_title` · `099f tr(vehicle_home_service_mode)` · `09cd tr(vehicle_home_in_service_status)` · `09d8 vehicle_home_out_of_service_status` · `0a03 tr(vehicle_home_mobile_access_status)` · `0a2b tr(vehicle_home_parked_state)` · `0af3 ' '` · **`0c30 vehicle_home_header_status_text` ← automationID, NOT copy** · `0d17 tr(vehicle_charge_eta_trip_charging_ready_full)` · `0d78 tr(vehicle_charge_eta_trip_charging_ready)` · `0e50 tr(cos_charging_from_solar_status)` · `1019 tr(vehicle_child_presence_detected)`

---

## Q5 — freshness: your assumption is CONFIRMED

Both functions resolve the **same** constant, `TimeInMs.TWO_MINUTES` (`s[23858]`):
- `isVehicleDataStale` #30240 → nested closure #30241 @`0023` reads `TimeInMs.TWO_MINUTES`; it `.every()`s over the data subtree with `proto_vehicle_data` / `getVehicleConfig` null guards (so **missing data counts as stale**).
- `fetchedDataRecently` #30243 @`0037` reads `TimeInMs.TWO_MINUTES`.

**There is no second, longer threshold** for the Asleep-vs-Last-seen split in these two functions — that split is driven by the *awake/asleep* flag, not a different age cutoff. **Unresolved:** the `fromNow` thresholds (s:45/m:45/h:22/d:26/M:11) and the exact `Asleep …` / `Last seen …` templates — the component reads a precomputed `lastUpdatedString` (`0129`, `s[517812]`), so the formatting happens in the selector, not here. I did not chase it.

## Q6 — subtitle: yes, the render block has one- and two-line variants
The composed block switches on layout: `statusTextContainer` (`0b59`), **`oneLineTextContainer` (`0cbc`)**, and a `header` style (`0d09/0d73`), with `BusyIcon` (`0bba`) for the spinner. So the status area is **not always one line** — the charge-ETA variants render as a second line under the header. Exact composition unresolved.

## Q8 — a car it can never reach
The composed block handles error codes explicitly: `HttpStatusCode.MOBILE_ACCESS_DISABLED` (`0a80`), `TIMEOUT` (`0a9d`), `CLIENT_TIMEOUT` (`0ab6`), `CLIENT_NO_NETWORK` (`0ae6`), combined via `.includes` (`0ac0`). For an unreachable car the app lands on **`isDataStale → tr(connecting_label)`** (#7) — i.e. **"Connecting" is the steady state**, not a terminal error string. That matches what you'd see comparing screenshots: the official app on your air-gapped car should sit on Connecting, not on a distinct offline state.

---

## Q7 — what to suppress

**CLOUD-ONLY — hard-suppress (you cannot compute these offline):** SoH-test state, static/demo data, **Mobile Access Disabled**, **In Service**, **Service Mode**, **Out of Service**, **upgrade-app warning**, charge-on-solar (`cos_*`), and all **powershare** states (Cybertruck + cloud config).

**BLE-LOCAL — buildable, all from data you already fetch:** `isDataStale` → Connecting; charging states (`ChargeState`); low-power mode; **parked vs not-parked** (`DriveState` gear); CPD (you already have `FromVCSECMessage` field 55).

---

## The concrete fix to `src/ble/vehicleStatusText.ts`

Ordered, first-match-wins, using only what's already on your wire:

1. `!lastVehicleDataAt` → **Connecting** *(you have this)*
2. `isDataStale` → **Connecting** ← **new, and it belongs ABOVE every physical state** (this is the one ordering surprise)
3. `chargingState ∈ {CHARGING, CALIBRATING}` → charging status (with ETA if you have it)
4. `chargingState === STARTING` → **Start Charging**
5. `lowPowerModeOn` → **Low Power Mode**
6. **`!isShiftStateParked` → the driving/composed status** ← **your bug**; gate on your existing `patch.driving` / `DRIVING_GEARS.has(snap.drive.gear)`, and compose speed + units the way the app does
7. `isShiftStateParked` → **Parked**
8. stale + awake → `Last seen {age} ago`; stale + asleep → `Asleep {age}` *(keep — Tesla has no equivalent; this is your own, and it's reasonable)*

Keep `TWO_MINUTES` for both staleness checks — **confirmed identical to Tesla**.

---

## Unresolved (stated plainly rather than guessed)
- **Verbatim English copy per i18n key.** The keys do **not** resolve in the native `.strings` plists; the catalog is in-bundle and I did not resolve key→value. The English strings *are* present in the table (`s[84836]='Parked'`, `s[5508]='Charging'`, `s[136818]='Mobile Access Disabled'`, `s[157432]='Low Power Mode'`, `s[76426]='Start Charging'`, `s[129784]='In Service'`, `s[129786]='Service Mode'`, `s[95000]='Out of Service'`, `s[5897]='Connecting'`) but I have **not** proven which key maps to which — so **do not treat these pairings as byte-exact**.
- The **driving text composition** (and whether `s[475950]='Driving'` is used at all).
- `Asleep …` / `Last seen …` templates and the `fromNow` thresholds.
- Guard #17's register (`r40`) and what the bare `' '` emissions mean (likely a deliberate blank).
- What resets the age besides a successful fetch.
- **No adversarial verification** — the 529s killed both workflows. The precedence table is the load-bearing output; re-check `04be–05f6` in `req17_vst.txt` before hard-coding it.

## Provenance
`VehicleStatusText` #111147 (+ closures #111148/#111149), `isVehicleDataStale` #30240 (+#30241), `fetchedDataRecently` #30243, iOS `main.jsbundle` Hermes v96. Register→selector mapping done flow-sensitively by replaying the bytecode; jump targets computed as `offset + rel`. Disassembly at `…/scratchpad/req17_vst.txt`; toolkit at `…/scratchpad/{vds_dis,findfn,find_str}.py`.
