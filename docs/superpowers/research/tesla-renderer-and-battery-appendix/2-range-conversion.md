# R5 §2 — The %↔distance conversion and the toggle (VERBATIM)

Primary source: iOS `/Users/ivan/Downloads/tesla-haptics-work/main.decompiled.js` (v4.56).
Android cross-check: `/Users/ivan/Work/tesla-summon/work/bundle.hasm` (Hermes disasm, v4.58).

All 4 core functions live in one closure environment ("closure1"), slot-indexed.
Function-name comments (`// Original name: X`) are REAL in the iOS decompile.

---

## 1. `getRemainingBatteryRangeDistanceWithUnit` — VERBATIM (iOS main.decompiled.js:1229437–1229459)

```
r9 = function(a0, a1) { // Original name: getRemainingBatteryRangeDistanceWithUnit, environment: r1
    _fun30053: for(var _fun30053_ip = 0; ; ) switch(_fun30053_ip) {
case 0:
        r4 = a1;
        r2 = _closure1_slot70;              // = getRemainingBatteryRangeDistance
        r3 = undefined;
        r0 = a0;
        r5 = r2.bind(r3)(r0, r4);           // r5 = getRemainingBatteryRangeDistance(a0=chargeState, a1=guiSettings)
        r0 = null;
        r2 = r5 != r0;
        if(!r2) { _fun30053_ip = 51; continue _fun30053 }   // if r5 == null -> return undefined
case 30:
        r2 = ' ';                           // <-- SEPARATOR = single ASCII space U+0020
        r2 = r5 + r2;                       // "<number> "
        r1 = _closure1_slot73;              // = getGUIDistanceUnit
        r1 = r1.bind(r3)(r4);               // unit token, from guiSettings (a1)
        r0 = r2 + r1;                       // "<number> <unit>"
case 51:
        return r0;                          // undefined when no range data (r0 init undefined)
    }
};
r2['getRemainingBatteryRangeDistanceWithUnit'] = r9;
```

**Signature:** `(a0 = chargeState, a1 = guiSettings)`. Returns `"<rounded number>" + " " + "<localized unit>"`, or **`undefined`** when the inner range value is null.

**Android #30507 (bundle.hasm:1451641) — byte-for-byte equivalent [both-match]:**
```
LoadParam r4, 2                                      ; a1 (guiSettings)
LoadFromEnvironment r2, r1, 69                       ; env[69] = getRemainingBatteryRangeDistance
LoadParam r0, 1                                      ; a0 (chargeState)
Call3 r5, r2, undef, r0, r4                          ; r5 = getRemainingBatteryRangeDistance(a0,a1)
Neq r2, r5, null ; JmpFalse -> Ret                   ; if null -> return undefined
LoadConstString r2, string_id 1768  # String: ' '   ; SEPARATOR = ' '
Add r2, r5, r2                                        ; r5 + ' '
LoadFromEnvironment r1, r1, 72                        ; env[72] = getGUIDistanceUnit
Call2 r1, r1, undef, r4                               ; unit(guiSettings)
Add r0, r2, r1                                        ; number + ' ' + unit
Ret r0
```

---

## 2. `getRemainingBatteryRangeDistance` — VERBATIM (iOS main.decompiled.js:1229357–1229435)
(_closure1_slot70; the value producer)

```
r9 = function(a0, a1) { // Original name: getRemainingBatteryRangeDistance, environment: r1
    _fun30052: ...
case 0:
        r5 = a0;                            // chargeState
        r7 = a1;                            // guiSettings
        r1 = _closure1_slot106;             // = getChargeRangeDisplaySettings
        r3 = r1.bind(undefined)(r7);        // r3 = guiSettings.getGuiRangeDisplay().getTypeCase()
        r4 = _closure1_slot0; r1 = _closure1_slot1;
        r1 = <protoModule[15]>.RangeDisplay.IDEAL;
        if(!(r3 !== r1)) { -> 79 }          // r3 !== IDEAL ? -> 56 (rated) : -> 79 (ideal)
case 56:  // NOT ideal (i.e. rated/EPA)
        if (r5 == null) -> 77
case 67:
        r1 = r5.getBatteryRange();          // <-- SOURCE FIELD = battery_range (getBatteryRange)
case 77: -> 103
case 79:  // IDEAL
        if (r5 == null) -> 100
case 90:
        r3 = r5.getIdealBatteryRange();     // <-- SOURCE FIELD = ideal_battery_range (only if RangeDisplay==IDEAL)
case 100: r1 = r3;
case 103:
        r5 = guiSettings.guiDistanceUnits(a1);   // via _closure1_slot0(protoModule[?]).guiDistanceUnits
        r4 = <proto>.SpeedUnit.KILOMETERSPERHOUR;
        r3 = r1;
        if(!(r5 === r4)) { -> 177 }         // if display units are NOT km -> skip conversion (value stays miles)
case 159:
        if(!(r1 != null)) { -> 177 }
case 168:
        r3 = _closure1_slot187(r1);         // = convertMilesToKm(value)   <-- km conversion
case 177:
        if(!(r3 != null)) { -> 205 }
case 186:
        r0 = global.Math.round(r3);         // <-- ROUNDING = Math.round (nearest int, 0 decimals)
case 205:
        return r0;                          // null/undefined if no range data
    }
};
```

**Android #30506 (bundle.hasm:1451580) — identical field/enum reads [both-match]:**
```
GetById ... 'RangeDisplay'         (string_id 25216)
GetById ... 'IDEAL'                (string_id 18015)
GetById ... 'getBatteryRange'      (string_id 31896)
GetById ... 'getIdealBatteryRange' (string_id 50314)
GetById ... 'guiDistanceUnits'     (string_id 48844)
GetById ... 'SpeedUnit'            (string_id 27439)
GetById ... 'KILOMETERSPERHOUR'    (string_id 20777)
TryGetById ... 'Math' ; GetById ... 'round'   (Math.round)
```

### RangeDisplay selector `getChargeRangeDisplaySettings` (_closure1_slot106, iOS:1231171–1231190)
```
r9 = function(a0) { // Original name: getChargeRangeDisplaySettings
    r2 = a0.getGuiRangeDisplay();
    if (r2 == null) return undefined;
    r0 = r2.getTypeCase();       // compared against RangeDisplay.IDEAL
    return r0;
};
```
So: **default path uses `getBatteryRange()` = `battery_range` (rated/EPA range, in MILES).** Only when the vehicle's `getGuiRangeDisplay().getTypeCase() === RangeDisplay.IDEAL` does it switch to `getIdealBatteryRange()` = `ideal_battery_range`. **`est_battery_range` is NEVER read here.**

---

## 3. Conversion constant — `convertMilesToKm` (_closure1_slot187, iOS:1247417–1247437)

```
r7 = function(a0) { // Original name: convertMilesToKm
    r1 = (a0 != null) ? a0 : 0;
    r0 = <constModule[52]>.KM_PER_MILES;
    r0 = r1 * r0;                // value_miles * KM_PER_MILES
    return r0;
};
```

**`KM_PER_MILES = 1.609344`** — VERBATIM (iOS main.decompiled.js:1292079):
```
r1 = 1.609344;
r2['KM_PER_MILES'] = r1;
```
[both-match: Android reads `KM_PER_MILES` identically, bundle.hasm:1247433 analog / string usage confirmed.]

> NOTE: the app's source range is in **MILES**; km is DERIVED by `miles * 1.609344`. (Your pipeline `chargeState.batteryRange * 1.60934` matches to 5 d.p.; Tesla uses the exact `1.609344`.)

---

## 4. Unit token — `getGUIDistanceUnit` (_closure1_slot73, iOS:1229607–1229645)

```
r9 = function(a0) { // Original name: getGUIDistanceUnit
    r2 = guiDistanceUnits(a0);                 // from guiSettings
    r0 = <proto>.SpeedUnit.MILESPERHOUR;
    if(!(r2 !== r0)) { -> 100 }                // if units === MILESPERHOUR -> miles branch
case 64:  // km branch
    r2 = <module[20]>.tr;
    r0 = r2('distance_unit_km_short_string');  // <-- i18n KEY, localized via .tr()
    -> 134;
case 100: // miles branch
    r2 = <module[20]>.tr;
    r0 = r2('distance_unit_miles_short_string'); // <-- i18n KEY
case 134:
    return r0;
};
```

**UNIT token is LOCALIZED (i18n), not a hardcoded 'km'/'mi':**
- km  -> `tr('distance_unit_km_short_string')`
- mi  -> `tr('distance_unit_miles_short_string')`

[both-match: Android env[72] = getGUIDistanceUnit, same two keys.]

### km vs mi SOURCE (answer to §2.3)
Distance-unit selection is driven by the **vehicle GUI setting `guiDistanceUnits`** (proto `gui_distance_units`), exposed as a `SpeedUnit` enum: **`MILESPERHOUR`** => miles, **`KILOMETERSPERHOUR`** => km. It is read from the **guiSettings object (chargeState's sibling `getSelectedGuiSettings`)** — i.e. the CAR's setting, NOT phone locale, NOT a separate app preference.

---

## Selector wiring (answers §2.1/§2.2 arg identity) — iOS:1229437 caller @ 4567099 (`_fun111131`, a createSelector)

```
createSelector inputs:
  [0] getSelectedChargeState        -> a0 (chargeState)  -> getBatteryRange / getIdealBatteryRange
  [1] getSelectedGuiSettings        -> a1 (guiSettings)  -> guiDistanceUnits, getGuiRangeDisplay
  [2] getSelectedOngoingCommands
  [3] getSelectedVehicleSohTestPhase
Body:
  r8 = getRemainingBatteryRangeDistanceWithUnit;
  r1 = r8(chargeState, guiSettings);
  r0['batteryLevelDistanceWithUnit'] = r1;          // <-- the display prop
```

**Exact source field:** `battery_range` (`getBatteryRange()`) by default; `ideal_battery_range` (`getIdealBatteryRange()`) only when RangeDisplay==IDEAL. **NOT** `est_battery_range`.

---

## RESULT SUMMARY (§2.1–2.3)
- **Field read:** `getBatteryRange()` = `battery_range` (miles) [rated/EPA]; `getIdealBatteryRange()` = `ideal_battery_range` only if `gui_range_display` typeCase == `RangeDisplay.IDEAL`.
- **Conversion:** value_miles × **1.609344** (constant `KM_PER_MILES`) applied ONLY when display units are km; miles path applies no factor.
- **Rounding:** **`Math.round`** on the final displayed number (nearest integer, 0 decimals). No floor/ceil, no decimals.
- **Separator:** single **ASCII space `' '`** (U+0020, NOT nbsp), between number and unit.
- **Unit token:** LOCALIZED i18n keys `distance_unit_km_short_string` / `distance_unit_miles_short_string` via `.tr()`.
- **km/mi source:** vehicle `guiDistanceUnits` (`gui_distance_units`) SpeedUnit enum (MILESPERHOUR/KILOMETERSPERHOUR). Not locale.
[all both-match iOS+Android]

===============================================================================

# THE TOGGLE (§2.4–2.7) — ChargeStatus render component `_fun111136` (iOS main.decompiled.js:4567349–4567890)

Component consumes props (top of `_fun111136`):
```
r13 = props.batteryLevelDistanceWithUnit;   // 4567349  (may be undefined if no range data)
r16 = props.usableBatteryLevelPercent;      // 4567350
r4  = props.showEnergy;                     // 4567357
r1  = props.changeVehicleEnergyDisplayFormat; var _closure2_slot3 = r1;  // 4567366
r0  = props.isVehicleDataStale; var _closure2_slot2 = r0;                // 4567358
```

## §2.7 — Local toggle state = LOCAL useState, initialized from vehicle setting (iOS:4567539–4567558)
```
r6 = React.useState;
r4 = !r4;                    // init value = !showEnergy
r8 = r6(!showEnergy);
r6 = <tupleHelper>(r8, 2);
r15 = r6[0];  var _closure2_slot5 = r15;   // <-- LOCAL state: "show distance?" (true=distance)
r4 = r6[1];   var _closure2_slot6 = r4;    // <-- setter
```
- `showEnergy` prop = `getShowEnergy(guiSettings)` (iOS:4568016–4568026), and
  `getShowEnergy` (iOS:1229587–1229604) = **`guiChargeRateUnits === ChargeRateUnit.KW`**.
- So **initial/default display mode = `!(guiChargeRateUnits === KW)`**:
    - vehicle charge-rate units == kW  => showEnergy true  => local init false => **PERCENT shown**.
    - vehicle charge-rate units == distance (mi/hr) => showEnergy false => local init true => **DISTANCE shown**.
  There is NO hardcoded app default; it is DERIVED from the car's `guiChargeRateUnits` setting each mount.
- **Local persistence:** the choice lives in a component-local `useState`, re-initialized from `getShowEnergy(guiSettings)` on every mount. **No AsyncStorage / redux-persist of the format** — persistence is VEHICLE-side (see command below); local state is only an optimistic in-session flip. [INFERRED from useState init pattern; no local-store write found near this component.]

## The onPress toggle handler `_fun111140` (iOS:4567836–4567853)
```
r0 = _closure2_slot5;          // current local state
r2 = !r0;                      // flipped
r3 = _closure2_slot6;          // setter
r3(r2);                        // (1) OPTIMISTIC local flip — instant
r4 = _closure2_slot3;          // changeVehicleEnergyDisplayFormat
if (r4 != null) r4(r2);        // (2) send vehicle command (only if callback non-null)
```

### The vehicle command `changeVehicleEnergyDisplayFormat` (useCallback `_fun111146`, iOS:4568116–4568162)
```
if (!phoneKeyPaired) return;                                   // _closure2_slot2 gate
if (!(carApiVersion >= MIN_SET_UNITS_AND_FORMATS_CAR_API_VERSION)) return;
cmd = VehicleCommand.energyDisplayFormat;
Fmt = SetEnergyDisplayFormatAction.Format;
value = a0 ? Fmt.FORMAT_DISTANCE : Fmt.FORMAT_PERCENTAGE;
sendCommand( cmd(value) );
```
- Format enum VERBATIM (iOS:4568149 / 860617): **`{'FORMAT_PERCENTAGE': 0, 'FORMAT_DISTANCE': 1}`**.
- Command gated on **phone key paired** AND **carApiVersion >= MIN_SET_UNITS_AND_FORMATS_CAR_API_VERSION**. If either fails, only the local optimistic flip happens (no round-trip). Confirms R4 §C4.

## §2.4 — Switch animation: INSTANT SWAP (no crossfade/LayoutAnimation on % <-> distance)
- There is **NO `LayoutAnimation` / `configureNext` anywhere** in the ChargeStatus component (grep of 4567300–4568200 = empty).
- The ONLY `Animated` in the component is a **data-staleness opacity dimmer**, NOT tied to the format toggle. VERBATIM (`_fun111137` useEffect, iOS:4567700–4567730):
```
Animated.Value initial = 0.5  (useRef, iOS:4567393-4567406)
useEffect:
  easing   = Easing.cubic
  toValue  = isVehicleDataStale ? 0.5 : 1
  duration = isVehicleDataStale ? 0   : 500      // ms
  useNativeDriver = true
  Animated.timing(value, {...}).start()
```
  Applied to the whole battery block: `Animated.View style=[batteryViewContainer, {opacity: <thatValue>}]` (iOS:4567763–4567766).
  => Fresh data fades opacity to 1 over **500ms cubic**; stale data snaps to **0.5 opacity instantly (duration 0)**.
- The %↔distance text itself just re-renders the new string — **instant, no transition.** [INFERRED from total absence of Animated/LayoutAnimation on the text node.]

## §2.6 — No-data fallback: NO fallback to % in distance mode (renders BLANK)
Text child selection VERBATIM (iOS:4567880–4567890):
```
r13 = batteryLevelDistanceWithUnit;   // set 4567349, NOT reassigned before here
if (r15 /* local: show distance */) { -> 2089 (use r13) }
case 2067:                            // percent mode
    r15 = (r16 /*percent*/ != null);
    r14 = '';
    if (!r15) -> 2086;                // percent null -> children = ''
case 2078:
    r14 = r16 + '%';                  // e.g. "80%"
case 2086:
    r13 = r14;
case 2089:
    r10['children'] = r13;            // Text child
```
- **Distance mode + no range data:** `batteryLevelDistanceWithUnit` is `undefined` (getBatteryRange null) => Text child = `undefined` => renders **NOTHING (blank)**. It does **NOT** fall back to %.
- **Percent mode + no percent:** child = **`''`** (empty string).
> This DIFFERS from your implementation (you fall back to %). Tesla shows blank in distance mode when range data is missing. [differ — Tesla=blank, ours=%]

## §2.5 — Layout shift: label is CONTENT-SIZED, left-aligned => width CHANGES on switch
The Text style = `[batteryText, {color}]`; container = `row`. VERBATIM StyleSheet (iOS:4570724–4570793, `_closure1_slot21`; Gutter=10 @ iOS:1338473):
```
batteryText:          {'fontSize': 16, 'fontWeight': 'bold', 'marginHorizontal': Gutter*0.5 = 10*0.5 = 5}
batteryViewContainer: {'alignItems': 'center', 'flexDirection': 'row', 'marginTop': Gutter*0.5 = 5}
row:                  {'alignItems': 'center', 'flexDirection': 'row'}
```
- No `width`, no `minWidth`, no `textAlign:'right'`, no `flex` on the Text. The `row` container is `flexDirection:'row'` with default `justifyContent:'flex-start'` (left-aligned).
- => When the label flips "80%" (short) <-> "240 km"/"149 mi" (longer), **the text box resizes to content and the layout SHIFTS** (siblings to the right reflow). No fixed-width box, no right-alignment. [iOS-verified]
- (Charging bolt icon sits in `chargingIndicator: {position:'absolute', right:-4, top:-4}` — `4294967292` = uint32 wrap of -4 — so the icon is absolutely positioned and does NOT reflow with the text.)

---

## Cross-platform tag summary
- Range math (field/conversion/rounding/separator/unit/km-source): **[both-match]** (iOS #30506/#30507/#30052/#30053; Android #30506/#30507 verified).
- Toggle command `energyDisplayFormat` + FORMAT_PERCENTAGE/FORMAT_DISTANCE: **[iOS-verified]**, Android has same `SetEnergyDisplayFormatAction.Format` strings present [both-match on enum].
- Animation (staleness opacity 500ms cubic; instant text swap), layout shift, blank fallback, styles: **[iOS-verified]** (render component read in iOS decompile; Android render fn not re-sliced this round — UNRESOLVED whether Android render byte-identical, but selector/command layer matches).
