# R3 Sections A / B / E — spinner gate, cold start, colours

## §A. The spinner gate — RESOLVED (Round-2 §3 was WRONG)

### The key structural fact Round 2 missed
`VehicleStatusText` #117231 reads TWO values from a `useShallowEqualSelector` hook (hasm:5219035-5219036):
- **`lastUpdatedString`** (Reg11) — the freshness string produced by `vehicleDataLastUpdatedString` (#30315): "Last seen {{age}}" / "Asleep {{age}}", or **null** if the car has never been fetched.
- **`isDataStale`** (Reg19).
Plus `getSelectedVehicleCanWake` (Reg3) and `getSelectedVehicleDataFetchedRecently` (Reg5).

So the freshness IS produced/rendered inside #117231 — **not a separate component / parent-swap** (Round 1 §1.5 and Round 2 §4 said INFERRED parent-swap; that was WRONG).

### Control flow (opcode-precise)
Default before the dispatch (hasm:5219 0x4b1-0x4bb): `Reg13(text) = '' (empty)`, `Reg14(spinner) = false`, `Reg12(multiline) = false`.
Dispatch (first match wins), hasm:5219 0x4be-0x4e3+:
1. `Reg45===true` → jump to render with text `''` (empty, no spinner) — the "online & fresh, nothing to say" guard.
2. `Reg42` → **Parked** (no spinner)
3. `Reg31` → **Mobile Access Disabled** (no spinner)
4. `Reg27` → **In/Out of Service** (no spinner)
5. `Reg26` → **Service Mode / upgrade** (no spinner)
6. `Reg25` → branch 0x94a (no spinner)
7. **`Reg19 (isDataStale)` → branch 0x908** ← the freshness+spinner branch
8. else → Powershare / Charging checks (each `Reg14=false`, no spinner; charging sets `Reg12=true` multiline)

### The stale branch (0x908) — text AND spinner together
```
if (lastUpdatedString == null) lastUpdatedString = tr('connecting_label')   // fallback only when never fetched
Reg13 (text)    = lastUpdatedString            // "Last seen {{age}}" / "Asleep {{age}}" / "Connecting"
Reg14 (spinner) = canWake ? canWake : !fetchedDataRecently   ≡  canWake || !fetchedDataRecently
```
(hasm:5219 0x908-0x942.)

**So the spinner co-renders with "Last seen {{age}}" / "Asleep {{age}}".** The BusyIcon is a structural sibling (Round-2 §1 correct), but its flag is computed **only in the isDataStale branch** — and that branch's text is the freshness string, NOT "Connecting" (which is only the null fallback). **Round-2 §3's claim "spinner only in the Connecting branch / never with a concrete state" is WRONG.** Which strings can co-render with the spinner: **"Last seen {{age}}", "Asleep {{age}}", and "Connecting"** (all three are the same branch). Live states (Parked/Charging/Service/Mobile-Access/Powershare) never show the spinner.

### canWake / fetchedDataRecently / the threshold — RESOLVED
- **`fetchedDataRecently`** = fn #30697 (hasm:1461974): `(now − last_received_vehicle_data_timestamp) < TimeInMs.TWO_MINUTES` → **120000 ms (2 min)**.
- **`isVehicleDataStale`** = fn #30694 (hasm:1461883): true if `proto_vehicle_data`/`getVehicleConfig()` is null, OR `every(vehicleDataTimestamps, olderThan(TimeInMs.TWO_MINUTES))` — i.e. **all timestamps > 2 min old** (hasm:1461944, `TimeInMs.TWO_MINUTES`).
- **`canWake`** = `getVehicleCanWake` #31609 (hasm:1509062): true when a wake is **actively tracked** — any of `userForcedWakes`, `screensEnteredRequiringWake`, `userInitiatedCommands`, `overrideAutoWakes` (from the `wakeUpWindow` tracker). NOT "the car is wakeable"; it means a wake was requested (pull-to-refresh / tap-status / command / a screen that forces wake).

**Does an asleep/offline car spin permanently or briefly?** Since the stale branch is entered exactly when data is >2 min old, `!fetchedDataRecently` is essentially always true there → **the spinner shows the entire time the status reads "Last seen/Asleep {{age}}"** (i.e. continuously while data is stale), and also whenever a wake is actively tracked. It stops when fresh vehicle_data arrives (< 2 min) and the status flips to a live state (or empty). **Implementation note: show the spinner WHENEVER you show "Last seen/Asleep", not only during an explicit refresh gesture.**

### Which half of Round 2 was wrong (state loudly)
- Round-2 §1 (spinner is a structural sibling gated by a flag) — **CORRECT**.
- Round-2 §3 (spinner only appears with "Connecting"; concrete states never spin) — **WRONG**. The spinner appears with the stale-data freshness text "Last seen {{age}}"/"Asleep {{age}}". "Connecting" is only the null fallback of that same branch.

---

## §B. Cold start — RESOLVED

- **Persistence:** the app uses **redux-persist** (`persistReducer`, `persistStore`, `REHYDRATE`, `createMigrate`, `persist:` keys). Vehicle data is persisted under the **`vehicles`/`vehicleData`** slice, including **`last_received_vehicle_data_timestamp`** (the field set on each vehicle_data receipt — reducer at hasm:1517340). Storage engine name not positively identified (no `MMKV`/`AsyncStorage` literal isolated) — **GAP**; but the slice + timestamp persist across launches (the user's observation confirms it).
- **What renders at cold start (cached data present):** REHYDRATE restores vehicle data whose timestamps are almost always > 2 min old → `isDataStale = true` → the **stale branch** renders `lastUpdatedString` = **"Last seen {x} ago"** (or "Asleep {x}") **+ the spinner** (because `!fetchedDataRecently`). This is exactly the user's observation. **Corrects the shipped assumption that cold start shows "Connecting."**
- **When is "Connecting" reached?** Only when `lastUpdatedString` is **null** — i.e. a vehicle that has **never** been fetched (fresh install / newly added vehicle / no persisted timestamp). Confirmed: "Connecting" is the null fallback of the stale branch (hasm:5219 0x90a).
- **Timestamp source feeding #30315:** `last_received_vehicle_data_timestamp` = the **last successful vehicle_data receipt** (not a push, not a server field). `vehicleDataLastUpdatedString` formats `now − that` via moment `.fromNow()`.
- **Cached battery at cold start:** YES — the battery %/range come from the same persisted `proto_vehicle_data` (`usableBatteryLevelPercent` / `batteryLevelDistanceWithUnit`, via the `SelectedVehicleChargeStatus` #117228 hook), so the cached battery renders immediately on launch (no late pop-in). (Battery detail = agent C.)

---

## §E. Colours — RESOLVED

Theme palettes are built in fn #32987 (hasm:1565050, 3786 bytes) — a light block (uses `pillBackgroundLightMode`) and a dark block (`pillBackgroundDarkMode`). Text-colour tokens (from `Colors.*` / literal hex):

| Token | Light theme | Dark theme | hasm |
|---|---|---|---|
| `textColor` (appearance **Default** — e.g. car name) | **#222222** | near-white (var; not a literal here — INFERRED #FFFFFF/#F6F6F6) | 1565250 / 1565455 |
| **`textColorLight`** (appearance **Light** — the STATUS text) | **#606060** | **#8A8B8B** | 1565250 (0x3e0) / 1565455 (0x820) |
| `reverseTextColor` (appearance Alternative) | #828282 | #454546 | 1565250 / 1565455 |

- **The status text colour = `theme.textColorLight`** (because #117231's status Text uses `appearance:Light`): **dark mode `#8A8B8B`**, light mode `#606060`. The Tesla home screen is dark, so the status line renders **`#8A8B8B`** (a muted mid-grey). **This is the value to ship — not a guessed opacity.**
- **Battery % text vs status text:** the car NAME uses `textColor` (Default, bright #222222/white); the STATUS text uses `textColorLight` (muted grey). The battery % colour is agent C's item, but it is a distinct/brighter token from the status text — they are NOT the same. (Do not apply the status-text grey to the battery %.)
- **Opacity:** the status text itself carries no extra `opacity` (the muting is baked into the `#8A8B8B`/`#606060` token, not an rgba/opacity on top). The child-presence warning text separately uses `transparentWhite90` (rgba(255,255,255,0.9)), but that's a different element.
- **Header background:** not a distinct token found in this module — the header sits on the app's base background (dark). (No special background treatment behind the status area isolated — GAP unless agent C finds one.)

### Spinner colour (relevant to §D asset): the extracted `mini_spinner.png` is a **white graded-alpha arc mask** (36×36, max alpha ≈101). #117231 passes NO `color`/tint to BusyIcon, so it renders as the asset's own **white** arc. On the dark header that reads as a faint white spinner. (If we render our own, tint white with a soft alpha ramp; do not use RN's grey ActivityIndicator.)
