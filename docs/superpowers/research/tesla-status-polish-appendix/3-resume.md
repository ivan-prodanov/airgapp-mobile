# R4 §3 — Resume / Foreground Behaviour (iOS v4.56 + Android v4.58)

Sources:
- iOS: `/Users/ivan/Downloads/tesla-haptics-work/main.decompiled.js` (Hermes decompiled JS, Tesla iOS v4.56). This is what we ship — treat as authoritative.
- Android: `/Users/ivan/Work/tesla-summon/work/bundle.hasm` (Hermes disasm, v4.58).

TL;DR of the user's question ("our app visibly REFRESHES on every open; official does not"):
**The official app DOES refetch vehicle_data immediately on every foreground/resume (no
network-level freshness guard).** What differs is the *visible* UI: the loading **spinner** and
the Godot 3D **loading animation** are each gated on separate conditions
(`fetchedDataRecently` within 2 min, and `dataQuality === NO_DATA` respectively). When you
resume with data younger than 2 minutes and non-empty cached data, the refetch happens
**silently** — no spinner, no 3D re-animate, status text stays put. That is why it "feels static."
Our leading hypothesis (a "don't refetch if fresh" guard on the resume code path) is **REFUTED**
at the network layer and **CONFIRMED** at the UI layer.

---

## 1. What the app DOES on foreground/resume

### 1a. Lifecycle wiring (RN AppState → Redux)
The app installs standard RN `AppState.addEventListener('change', …)` subscriptions via a
`useAppState({onActive, onBackground})` hook. Multiple independent consumers register.

**[iOS-verified]** `main.decompiled.js` — a `useAppState` consumer whose `onActive` dispatches the
foreground action (line 3702157-3702170):
```
r7 = function() { // Original name: onActive, environment: r1
    ...
    r1 = r3.onAppForeground;      // Actions.onAppForeground()
    r1 = r1.bind(r3)();
    r1 = r2.bind(r0)(r1);         // dispatch
```
`onAppForeground` (iOS 2452713) = `createAction(APP_FOREGROUND)`; `onAppBackground` (iOS 2452741) =
`createAction(APP_BACKGROUND)`; `onAppInactive` (iOS 2452728) = `createAction(APP_INACTIVE)`.

**[both-match]** Action-type constants `APP_FOREGROUND`, `APP_BACKGROUND`, `APP_INACTIVE`
exist on both (iOS 2452157-2452161; Android has 24× `APP_FOREGROUND` refs). A dedicated
`VehicleWakeReason.APP_FOREGROUND` enum member also exists (iOS 1297325, 1297420) — i.e. a
foreground can be logged as the *reason* a vehicle wake was issued.

### 1b. The `foregroundEffect` saga (takeLeading APP_FOREGROUND)
There are two `foregroundEffect` sagas in different modules.

**[iOS-verified]** App-lifecycle module `foregroundEffect` (iOS ~3974380, fun97416) does, on
APP_FOREGROUND:
- `resetCommandsExecuted()`
- `setCachedLocationDataSplunkSent(false)`, `setCachedDataSplunkSent(false)`,
  `setProtoDataSplunkSent(false)`, `setVehicleWakeSent(false)`, `setNIPermissionSplunkSent(false)`
- `resetPiiKeyRequests()`
- `startTrace(Trace.COMMANDS_IN_SESSION)`
- `updateAppIsInForeground(true)`  ← sets the in-foreground flag

It does **not** itself dispatch a vehicle-data fetch. It resets per-session flags.

**[iOS-verified]** BLE module `foregroundEffect` (iOS ~6836462, fun153198): `startTrace(Trace.CACHED_DATA_SESSION)`.
Its `backgroundEffect` (fun153200) calls `endTraceWithAttributeList(CACHED_DATA_SESSION, [reason:'background'])`.

### 1c. The actual refetch — `startDataAutoRefresh` on active
**[iOS-verified]** The `ProductListFetch` `useAppState` consumer's `onActive` (iOS fun90773,
lines 3701780-3702040):
- dispatches `fetchList()`, `fetchVehicleOrderList()`
- dispatches `cancelAllDataRequests()` (twice, two store modules) — a reset
- if selected product is a VEHICLE and NOT in pre-delivery:
  ```
  r10 = r11.startDataAutoRefresh;
  r6  = r6.VehiclePollingType.VEHICLE_DATA;
  r6  = r10.bind(r11)(r7, r6);   // startDataAutoRefresh(vehicleId, VEHICLE_DATA)
  dispatch(r6)
  ```
- if ENERGY_SITE: `startSiteDataAutoRefresh` / `startEnergySiteAutoRefresh`.

Its `onBackground` (iOS fun90774, 3701918-3702000): dispatches `cancelAllDataRequests()` (twice) →
**polling is suspended while backgrounded.**

### 1d. BLE data-poll task is forked on foreground, cancelled on background
**[both-match]** `startVehicleDataPollingOverBLE` (iOS fun153182 @ 6836803; Android string ids
111183 / 231188 @ hasm 7597762 / 7597803). Structure (iOS):
- takeLeading APP_FOREGROUND → logs `"starting BLE vehicle data polling because of"` <type>,
  checks `isBadVehicleDataNetwork()`, then **forks** the poll task (`_closure1_slot42`).
- Then `take(APP_BACKGROUND)`; on background logs `"stopping BLE vehicle data polling due to
  background."` and **cancels** the forked poll task.

So on every foreground the poll task is (re)started; on every background it is torn down.

---

## 2. The poll loop — first fetch is IMMEDIATE, no freshness gate

**[both-match]** The loop is `periodicVehicleFetch` (iOS fun153163 @ 6831339) which repeatedly
calls `fetchDataAndWait` (iOS 6831160) then `delay(getPollingInterval(...))`. Forked by both
`startDataAutoRefreshEffect` (iOS 6834755) and the BLE polling starter.

**[iOS-verified]** `startDataAutoRefreshEffect` (fun153166): on START_DATA_AUTO_REFRESH it first
`select(getVehicleDataLooping, vehicleId)`; **if already looping** it logs
`"Looping, IGNORE startDataAutoRefreshEffect"` and returns (dedup guard). Otherwise
`startDataAutoRefreshTaskBegin`, then **forks the periodic fetch** and enters the loop. Since
background cancels the loop (1c/1d), on resume it is not looping → it starts fresh and fetches.

**[iOS-verified]** `periodicVehicleFetch` case 0→156 goes straight into
`select getVehicleFromByIdMap` → compute dataQuality/canWake → `getPollingInterval` → fetch, with
**no `fetchedDataRecently` check at the top of the loop.** The first iteration fetches immediately;
only *afterwards* does it `delay(interval)`. The loop's own comment string
`"Cancelled vehicle data fetch, starting new one immediately"` (iOS 6831372; Android str 133784)
confirms it re-issues immediately when interrupted.

Conclusion: **resume ⇒ immediate refetch on both platforms. No "skip if fresh" guard on the fetch path.**

### Poll cadence (confirms R1 §1.6)
**[both-match]**
- `VEHICLE_DATA_POLLING_INTERVAL_ONLINE  = TimeInMs.FIVE_SECONDS = 5000 ms`
  (iOS 1254518-1254521; Android hasm 1474433-1474434 / 1474572-1474573)
- `VEHICLE_DATA_POLLING_INTERVAL_OFFLINE = TimeInMs.ONE_SECOND (1000) * 1.2 = 1200 ms`
  (iOS 1254524-1254528; Android hasm 1474578-1474580: `LoadConstDouble 1.2` then `Mul`)
- `ENERGY_PAIRED_VEHICLE_POLLING_INTERVAL = ONE_SECOND * 4 = 4000 ms` (iOS 1254531-1254536)
- `getPollingInterval(pollingType, isOffline)` (iOS 2450887) returns ONLINE unless `isOffline`,
  in which case OFFLINE; ENERGY_PAIRED → 4000.

Polling is **suspended while backgrounded** on both platforms:
- `cancelAllDataRequests` on APP_BACKGROUND (ProductListFetch.onBackground; iOS 1194956; 15 refs iOS / 17 Android)
- BLE poll fork cancelled on APP_BACKGROUND (1d).

---

## 3. The 5-minute "user inactivity" path (separate from foreground)
**[both-match]** Distinct from AppState, there is a `USER_BECAME_ACTIVE`/`USER_BECAME_INACTIVE`
event pair (iOS 3960331-3960333; Android same strings).
- `userBecameInactiveListener` (iOS fun97303 @ 3960775): **if `threshold >= 5`** → logs
  `"[UserActivity] User inactive, cancelling vehicle data polling"` and dispatches
  `cancelAllDataRequests()`. (Android str id 143942 @ hasm 4386152.)
- `userBecameActiveListener` (iOS fun97304 @ 3960847): gets selected vehicleId; if non-null AND
  `currentVehicleInPreDelivery() === false` → logs
  `"[UserActivity] Starting auto-refresh after period of inactivity for vehicle <id>"` and
  dispatches `startDataAutoRefresh(id, VehiclePollingType.VEHICLE_DATA)`. (Android str id 244806 @
  hasm 4386246.) **No `fetchedDataRecently` gate here either.**

This threshold-based restart is in addition to the AppState foreground restart.

---

## 4. What the user SEES on resume — spinner + Godot loading

### 4a. Loading spinner is gated by `fetchedDataRecently` (2-min) AND `canWake`
**[both-match]** The status-text/spinner component (iOS ChargeStatus, fun111147 around
4568270-4568960) reads three selectors: `getSelectedVehicleCanWake`,
`getSelectedVehicleDataFetchedRecently`, and data-error, and logs:
```
'[VDU] Show loading spinner: ' <isDataStale> ' - fetchedDataRecently: ' <recent> ', canWake: ' <canWake>
```
(iOS 4568921-4568938; Android str ids 244827 + 123851 @ hasm 5219975-5219976.) The spinner is
shown only when the data is NOT fetched-recently (and can-wake / error conditions). So a resume
with fresh (<2 min) data shows **no spinner** even though a refetch is happening in the background.

`fetchedDataRecently` fn:
- **[iOS-verified]** iOS fun30243 @ 1240656: reads `last_received_vehicle_data_timestamp`, calls
  helper(timestamp, `TimeInMs.TWO_MINUTES`), then `!`-negates → returns true when data is younger
  than 2 min.
- **[both-match]** Android fn `#30697`: `GetById last_received_vehicle_data_timestamp` →
  `Call helper(timestamp, TimeInMs.TWO_MINUTES)` → `Not` → `Ret`. Identical semantics.
- Selector `getSelectedVehicleDataFetchedRecently` wraps it (iOS 1279229 / 1284095-1284118).
- **Usage is UI-only** (spinner decision + `[VDU] wake pull down` pull-to-refresh wake gate,
  Android str 107505). It is **not** used to skip the resume refetch.

### 4b. Godot 3D loading animation is gated by `dataQuality === NO_DATA`
**[both-match]** `shouldShowLoadingGodotAnimation(x)`:
- **[iOS-verified]** iOS fun @ 1240683: returns `getVehicleDataQuality(x) === VehicleDataQuality.NO_DATA`.
- **[both-match]** Android `#30698`: `GetById VehicleDataQuality` → `GetById NO_DATA` → `Ret`
  (equality). Selector `getSelectedVehicleShouldShowLoadingAnimation` wraps it (iOS 1279329 /
  1284095; consumed by product-home component iOS 4561450).
- Debug string `'[VDU] Show loading Godot animation:'` (Android str 244826 @ hasm 5211752).

Because resume keeps cached Redux data, `dataQuality` is `LIVE`/`CACHED_RELIABLE`/`CACHED_UNRELIABLE`
(not `NO_DATA`), so the **3D vehicle loading animation does NOT replay on resume.** It only plays on
a true cold state (no data at all — fresh install / newly selected vehicle).

### 4c. Godot renderer is a persistent native view, not remounted
**[iOS-verified / INFERRED]** The Godot renderer is a native view (`TMGodotView` / `GodotView`,
iOS 2779998-2780002, 1169031) bridged via `onGodotMessage` and a `godotVehicleUpdateChannel`
(iOS 271533). Nothing in the `foregroundEffect`/`backgroundEffect` sagas or the AppState
onActive/onBackground callbacks tears down, remounts, or reloads the Godot view. **INFERRED:** the
3D view is kept alive across backgrounding and simply resumes; no reload/re-init on resume.
(UNRESOLVED: whether the native layer pauses the render/display-link while backgrounded — that is
below the JS bundle and not observable here.)

---

## 5. BLE / session across backgrounding
**[iOS-verified]** On APP_BACKGROUND the app only:
- ends analytics traces (`backgroundEffect` fun97418 / fun153200),
- cancels the **vehicle-data poll task** (`startVehicleDataPollingOverBLE` `take(APP_BACKGROUND)` →
  cancel; 1d),
- dispatches `cancelAllDataRequests` (ProductListFetch.onBackground).

None of these disconnect the BLE peripheral. `disconnectFromPeripheral` exists (iOS 6802030) but is
**not** wired to APP_BACKGROUND in any handler observed. `onAppBackground` (iOS 2452741) is a plain
`createAction(APP_BACKGROUND)` with no BLE teardown.

**INFERRED (high confidence):** The official app **keeps the BLE connection/session alive across
backgrounding** — it tears down only the *data-polling saga*, not the transport. This is consistent
with the passive phone-key requirement (the phone must stay connectable while backgrounded). On
foreground it does **not** rebuild the BLE session; it just re-forks the poll loop over the existing
connection. **This is the opposite of our implementation**, which tears down BLE on background and
rebuilds it on foreground — that rebuild is a likely additional source of our visible "refresh."
(UNRESOLVED: native CoreBluetooth/state-restoration details are below the JS bundle.)

---

## Net comparison for our app
1. Resume ⇒ they refetch immediately too — so refetching is NOT the differentiator.
2. They suppress the **spinner** when `fetchedDataRecently` (<2 min) is true — port this exact 2-min
   `last_received_vehicle_data_timestamp` gate to our status UI.
3. They suppress the **Godot loading animation** unless `dataQuality === NO_DATA` — only show the 3D
   load on true cold state, keep the cached render otherwise.
4. Keep the 3D view mounted across background; do not remount on resume.
5. Keep BLE alive across background; only pause/resume the poll loop. Stop tearing down + rebuilding
   the BLE session on each foreground.
