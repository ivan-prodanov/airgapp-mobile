# FINDINGS #14 — What the official Tesla app renders BEFORE first telemetry (no-data / loading state)

**Source:** decompiled iOS app `/Users/ivan/Downloads/tesla-haptics-work/main.decompiled.js` (Hermes-decompiled, ~400 MB). All line numbers below are into that file. Method: grep + read unfiltered, dump verbatim. Every hard claim tagged `[iOS-verified]` with its grep hit / line context; inferences tagged `[INFERRED]`.

---

## TL;DR (the two headline answers)

1. **It is a CACHED last-known value, NOT a dash.** `[iOS-verified]` The app persists the *entire* `vehicle_data` (battery, temps, range, config, everything) to **AsyncStorage** via **redux-persist** under key **`vehicleList`** (the `byId` slice), and rehydrates it on the next launch while a fresh read is in flight. The log line `' Successfully rehydrated from redux-persist:'` fires per vehicle (line 1297841). So on a *subsequent* launch the home screen shows real numbers immediately (last-known), dimmed as stale.

2. **The gate is PER-FIELD, not a global skeleton.** `[iOS-verified]` There is **no skeleton / shimmer component anywhere** in the bundle (only ICU `parseDateTimeSkeleton` for date formatting — line 252007). Each readable field runs through its own formatter, and **every formatter returns `undefined` when its input is null** — React then renders nothing (blank). There is no `'—'` / `'--'` fallback on any vehicle field (the only `'--'` literals belong to `formatInterestRate` (loan UI, line 9376590) and `Numeral.fromPartial` energy widgets (line 4767097) — never battery/temp/range).

So the true behavior is:
- **First-ever launch (no cache):** every field's formatter gets `null` → returns `undefined` → renders **blank/empty**. Status line shows **"Connecting"**. No dash, no skeleton, no spinner on the values themselves (there is a small `BusyIcon` next to the status *text* only — see below).
- **Subsequent launch (has cache):** rehydrated last-known values render immediately, at **opacity 0.5 (dimmed)** because the data is stale, animating to full opacity 1.0 once fresh data lands.

---

## Per-field table

| Field | No-data render (FIRST launch, no cache) | No-data render (has cache) | Code ref |
|---|---|---|---|
| **Battery %** (usable) | blank — `getVehicleUsableBatteryLevelPercent(null)` → `undefined` | last-known %, dimmed 0.5 | 1229459 `[iOS-verified]` |
| **Battery %** (nominal) | blank — `getVehicleBatteryLevelPercent(null)` → `undefined` | last-known %, dimmed 0.5 | 1229507 `[iOS-verified]` |
| **Battery glyph fill** | empty bar — fill width driven by `batteryLevelDec` (`undefined`→NaN→0 width) | last-known fill, dimmed 0.5 | `MiniBatteryView` 4571576, `batteryLevelDec` 1229532 `[iOS-verified]` |
| **Range (km/mi)** | blank — `getRemainingBatteryRangeDistanceWithUnit` returns `undefined` when distance is null | last-known "235 km", dimmed 0.5 | 1229437 `[iOS-verified]` |
| **Interior temp** | blank — `getInteriorTemperatureText(null)` → `undefined` | last-known "20°", dimmed | 1226834 `[iOS-verified]` |
| **Exterior temp** | blank — `getExteriorTemperatureText(null)` → `undefined` | last-known "18°", dimmed | 1226916 `[iOS-verified]` |
| **Climate temp text** (sheet) | blank — `getClimateTemperatureText(...)` → `undefined` when value null | last-known "21°C", dimmed | 1226758 `[iOS-verified]` |
| **Target temp** | blank — same climate formatter family; null in → `undefined` out | last-known value | 1226758 / 1227264 `convertToClimateTemperatureText` `[iOS-verified]` |
| **Vehicle status line** | **"Connecting"** — `vehicleDataLastUpdatedString` returns `tr('connecting_label')` when the last-update timestamp is null | **"Last seen {age}"** / **"Asleep {age}"** (cache has a timestamp) | 1221399 `[iOS-verified]` |
| **Lock state (icon)** | shows **unlocked** — `isVehicleLocked` compares closure to `LOCKED`; undefined closure → false | last-known lock icon | 1221029 `[iOS-verified]` |
| **Charge state / climate on-off / windows / sentry** | render from cached/undefined booleans; default to "off"/absent when undefined | last-known toggle state | `[INFERRED]` — same cache path; individual selectors follow the identical `x == null ? undefined/false` pattern seen across `VehicleSlice` selectors (e.g. 1229459, 1221029). Not each toggle individually traced. |
| **Odometer / TPMS / SW version** | blank when null (formatters follow same null→undefined pattern) | last-known value | `[INFERRED]` from the uniform formatter contract; odometer/firmware are part of the persisted `byId` blob (demo shape at 2451233 shows `odometer`, `firmwareVersion`). |

---

## Cache mechanism (the big one) `[iOS-verified]`

**Library:** `redux-persist` (module names `persistReducer`/`persistStore` at 1878796, 1880807). **Storage engine:** `@react-native-async-storage/async-storage` `2.1.2` (dependency listed at 3409315; redux-persist's `default` storage export = AsyncStorage).

**The vehicle persist config** (lines 1297964–1297979):
```
key:       'vehicleList'
storage:   <AsyncStorage default>
transforms: [ byId-proto-transform , allIds-filter-transform ]
blacklist: ['connStateById', 'wakeUpWindow', 'oemWalletModalState',
            'vehicleDataLoop', 'authorizeKeyCard',
            'vehiclePhoneKeySettingStateByVin']
```
Because `byId` is **not** in the blacklist, the whole per-vehicle data map (each vehicle's full `vehicle_data`, including `proto_vehicle_data`) is persisted. `wakeUpWindow`, live conn state, and the data-fetch loop are the things *excluded*.

**Serialize transform ("in", state → disk)** — `serializeVehicleDataProtos`, lines 1297747–1297821. For each vehicle in `byId` it:
1. **Resets the connection state to `ConnectionState.UNKNOWN`** before writing (lines 1297785–1297787). This is why a rehydrated vehicle comes back as `state: 'unknown'` → treated as stale/needs-read.
2. Serializes the proto via `DataSerializationUtils.serializeVehicleDataProtos` (line 1297796). Wrapped in try/catch logging `'[ProtoTransform] Error serializeVehicleDataProtos id: '` (1297757).

**Rehydrate transform ("out", disk → state)** — `deserializeVehicleData`, lines 1297822–1297936. For each stored vehicle it calls `DataSerializationUtils.deserializeVehicleData` (1297855) and, on success, logs `'<id> Successfully rehydrated from redux-persist:'` (1297841 concat at 1297883). On null result logs `'Unable to parse Vehicle from Redux while rehydrating'` (1297842); on throw logs `'[ProtoTransform] Error deserializeVehicleData '` (1297834).

**allIds filter transform** (1297942–1297963): whitelist `['allIds']`, filters out the `demoVehicle.id` so the demo car isn't persisted into the real list.

**Cache-vs-live selector:** there is no explicit "prefer cache over live" branch — the rehydrated value simply *is* the store value until a fresh `vehicle_data` read overwrites `byId[id]`. Whether that value is treated as fresh or stale is decided by `isVehicleDataStale` (see below), which the header uses to dim.

**Related caches (not the telemetry):**
- `vehicleSnapshots` persist (key `'vehicleSnapshots'`, line 2775380) caches only the **Godot 3D render images** — `{configHash → {pose → uri}}` (reducer 2775341–2775376). Not battery/temp data.
- `vehiclePresentationPersistReducer` (1873436) — UI presentation state.

---

## Stale / dimmed styling (exact delta) `[iOS-verified]`

**Staleness predicate** — `isVehicleDataStale` (fun30240, lines 1240571–1240623):
- returns **true** if the vehicle is `null`, OR `proto_vehicle_data == null`, OR `getVehicleConfig()` is null (the `isNull` check at 1240586–1240600) — i.e. **before first data, it is stale**;
- otherwise true if **every** data category timestamp is older than `TimeInMs.TWO_MINUTES` (1240603–1240619).

So both "no data yet" and "cache older than 2 min" evaluate to **stale = true**.

**The dimming** — in the `ChargeStatus` component (home-header battery), lines 4567296–4567765:
- It reads `isVehicleDataStale` into the closure (`_closure2_slot2`, lines 4567359–4567360).
- The battery-view container is an `Animated.View` whose opacity is an `Animated.Value` **initialized to `0.5`** (lines 4567383–4567388: `new Animated.Value(0.5)`), i.e. **dimmed by default on mount**.
- A `useEffect` runs an `Animated.timing` (lines 4567700–4567729): `toValue = stale ? 0.5 : 1`, `duration = stale ? 0 : 500`, `easing: Easing.cubic`, `useNativeDriver: true`. So fresh data animates the battery **up to opacity 1.0 over 500 ms**; stale snaps to **0.5** instantly.
- Applied at line 4567765: `style = [batteryViewContainer, { opacity: <animatedValue> }]`.

**Exact delta to match:** stale value → **`opacity: 0.5`** on the battery container (animated, 500 ms cubic to 1.0 when it becomes fresh). This confirms and matches our existing "dim the battery row on `stale`" behavior; the precise number is **0.5**, and the initial mount state is already dimmed.

**Also note (unrelated but observed):** the interior-temp overlay drawn on the 3D car image (`interiorTemperature` style, line 5219530) is **permanently `opacity: 0.4`** regardless of staleness — that is a design choice for the overlay, not a no-data signal.

**Status text spinner:** next to the *status line* (not the values), when a read is in flight the header shows a small `BusyIcon` (size 2) inside `statusTextContainer` (lines 4568965–4568990). This is the only spinner-like element; the numeric fields never get a spinner.

---

## Verbatim formatter dumps (the null/undefined/NaN contract to match)

The decompiler emits Hermes register IR; below each is the faithful control-flow translation, with the exact source line so you can re-read the IR.

### Battery percent — `getVehicleUsableBatteryLevelPercent` (line 1229459) `[iOS-verified]`
```js
function getVehicleUsableBatteryLevelPercent(chargeState) {
  let lvl;                                   // r3, starts undefined
  if (chargeState == null) {
    // lvl stays undefined
  } else {
    lvl = chargeState.getUsableBatteryLevel();
  }
  if (lvl != null) return Math.round(lvl);   // rounded int
  return null;                               // lvl was null (but chargeState non-null)
}
// chargeState == null  -> undefined
// usableBatteryLevel null -> null
// otherwise -> Math.round(level)
```
`getVehicleBatteryLevelPercent` (1229507) is identical but calls `getBatteryLevel()`.
`getVehicleBatteryLevelDec` (1229532) / `getVehicleUsableBatteryLevelDec` (1229484): same, but return `level / 100` (or `undefined`/`null`). Used for the glyph fill fraction — `undefined` → `NaN` width → empty bar.

### Range — `getRemainingBatteryRangeDistance` (line ~1229380, ends 1229432) + `...WithUnit` (1229437) `[iOS-verified]`
```js
function getRemainingBatteryRangeDistance(chargeState, guiSettings) {
  let d = /* raw range from chargeState */;
  if (guiUnits === SpeedUnit.KILOMETERSPERHOUR && d != null)
    d = milesToKm(d);                        // _closure1_slot187
  if (d != null) return Math.round(d);
  return undefined;                          // r0 never set
}

function getRemainingBatteryRangeDistanceWithUnit(chargeState, guiSettings) {
  const d = getRemainingBatteryRangeDistance(chargeState, guiSettings);
  if (d != null) return d + ' ' + unitLabel(guiSettings);  // e.g. "235 km"
  return undefined;                          // <-- no-data render is BLANK
}
```

### Interior temp — `getInteriorTempC` / `getInteriorTemperature` / `getInteriorTemperatureText` (lines 1226794 / 1226811 / 1226834) `[iOS-verified]`
```js
function getInteriorTempC(state) {
  if (state == null) return undefined;
  return state.getInsideTempCelsius();       // may itself be null
}

function getInteriorTemperature(state, guiSettings) {
  const c = getInteriorTempC(state);
  if (c == null) return undefined;
  return convertToDisplayUnit(c, guiSettings, /*decimals*/0, /*forceSign*/false);
}

function getInteriorTemperatureText(state, guiSettings) {
  const t = getInteriorTemperature(state, guiSettings);
  if (t == null) return undefined;
  return formatNumber(t, getLocale()) + SpecialCharacters.degree;   // e.g. "20°"
}
```
`getExteriorTemperature` (1226887) / `getExteriorTemperatureText` (1226916) are the same via `getOutsideTempCelsius()`.
`getInteriorTemperatureWithUnitsText` (1226867): `null` → `undefined`, else appends the unit label.

### Climate sheet temp — `getClimateTemperatureText` (line 1226758) `[iOS-verified]`
```js
function getClimateTemperatureText(a0, tempC, a2, a3) {
  const v = convert(a0, tempC, a2, a3);      // _closure1_slot52
  if (v == null) return undefined;           // <-- blank when null
  return Math.round(v) + SpecialCharacters.degree + unitLabel(tempC);  // e.g. "21°C"
}
```
`convertToClimateTemperatureText` (1227264) and `convertTemperatureText` (1227200) are the target-temp helpers and follow the same `null → undefined` guard.

### Status line — `vehicleDataLastUpdatedString` (line 1221399) `[iOS-verified]`
```js
function vehicleDataLastUpdatedString(v, a1, a2, connState, isDriving,
                                      showAge, sentryLowPower, a7) {
  const ts = lastUpdatedTimestamp(v, a1, a2, connState);   // _closure1_slot225
  if (ts == null)
    return tr('connecting_label');            // "Connecting"  <-- NO DATA / no timestamp
  const m = moment(Math.min(ts, Date.now()));
  const asleepOrOffline = isAsleepOrOffline(connState);    // _closure1_slot117
  if (isDriving || !showAge) {
    // "Last seen {age}"
    return tr('vehicle_status_screen_last_seen_age', { age: m.fromNow() });
  }
  // asleep branch:
  let s = tr('vehicle_status_screen_asleep_age', { age: m.fromNow(true) });  // "Asleep {age}"
  if (sentryLowPower && a7 && asleepOrOffline)
    s += ' • ' + tr('sentry_mode_enabled_low_power');
  return s;
}
```
English strings (grep-verified):
- `'connecting_label': 'Connecting'`
- `'vehicle_status_screen_last_seen_age': 'Last seen {{age}}'`
- `'vehicle_status_screen_asleep_age': 'Asleep {{age}}'`

`ConnectionState` enum (line 1254614): `unknown / undetermined / online / waking / low_power / asleep / hibernating / deep_sleep / shutdown / offline`. Rehydrated vehicles come back as **`unknown`** (reset by the serialize transform), which — with a non-null cached timestamp — resolves to the "Last seen {age}" / "Asleep {age}" text; with a null timestamp (truly first launch) → **"Connecting"**.

---

## Direct answers to the brief's 5 "how" questions

1. **The cache** — Yes: full `vehicle_data` persisted to AsyncStorage under key `vehicleList` (the `byId` slice), rehydrated on launch via redux-persist `deserializeVehicleData` transform; conn state reset to `UNKNOWN` on write. Selector deciding stale-vs-fresh is `isVehicleDataStale`. `[iOS-verified]`
2. **Null/loading sentinel** — There is none for vehicle fields. Formatters return `undefined` (→ blank). No `'—'`/`'--'`/skeleton/spinner on values. Only the status *text* has a `BusyIcon`, and the status text itself defaults to `'connecting_label'`. `[iOS-verified]`
3. **Per-field vs global** — **Per-field.** No global skeleton/gate exists; each formatter independently null-guards. `[iOS-verified]`
4. **Dimming/stale styling** — Battery container animates `opacity` between **0.5 (stale) and 1.0 (fresh)** over 500 ms cubic; initial mount value is 0.5. `[iOS-verified]`
5. **Formatters** — dumped verbatim above; uniform contract is **`input == null ? undefined : format(input)`** (battery/range also `Math.round`; range/temp append unit/degree only on the non-null path). `[iOS-verified]`

## What this means for our PROPER version
- Make every readable field genuinely nullable and, on no-data, render **empty (not `—`)** per-field.
- Persist last-known `vehicle_data` and hydrate on launch; render it immediately at **opacity 0.5**, animating to 1.0 (≈500 ms) when fresh telemetry lands.
- Battery %: `null → ''`, else `Math.round(level) + '%'`. Range: `null → ''`, else `Math.round + ' ' + unit`. Temp: `null → ''`, else `Math.round/format + '°'(+unit)`.
- Status line: no timestamp → **"Connecting"**; have cache → **"Last seen {age}"** / **"Asleep {age}"**.
- Drop our current READ_PROBE `—` sentinel; it does not match Tesla (they show blank, or a dimmed cached value).
