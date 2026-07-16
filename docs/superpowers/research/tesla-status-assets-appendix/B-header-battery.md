# Tesla Android app — Home header layout & battery indicator (Round 3, assets/precision)

**Target:** official Tesla Android app `com.teslamotors.tesla` **v4.58.0 (build 4392)**. Static RE of the React-Native **Hermes bytecode** (`/Users/ivan/Work/tesla-summon/work/bundle.hasm`) + apktool-decoded native resources.

**Citation shorthand:** `hasm:N` = line N of `bundle.hasm`; `off 0xNNN` = bytecode offset inside the named function; `obj:` = extracted object literal in `scratchpad/all_objects.txt`. Plain = read directly from an opcode/literal; **INFERRED** = interpretation; **UNRESOLVED** = not recovered.

**Component IDs (this module, hasm:5217700+):** module-init/StyleSheet fn **#117212** (styles built hasm:5217726–5217818); `ChargeStatus` **#117220** (hasm:5218099, the battery presentational component); `SelectedVehicleChargeStatus` **#117228** (hasm:5218730, redux wrapper); `VehicleStatusText` **#117231** (hasm:5218968); `HomeHeader` **#117234** (hasm:5219986); `VehicleHomeHeader` **#117239** (hasm:5220556). Battery glyph module (separate): `MiniBatteryView` **#117269** (hasm:5222213), module-init/StyleSheet **#117264** (hasm:5221877), `MiniBatteryViewCt` **#117262** (hasm:5221772, Cybertruck).

---

## 0. Headline answers to the ground truth (both mechanisms proven at the opcode level)

1. **Battery is on its own row ABOVE the status text.** Proven end-to-end: `VehicleHomeHeader` passes the battery as the `chargeStatus` prop and the status line as the `vehicleStatus` prop into `HomeHeader`. Inside `HomeHeader`, `chargeStatus` is the **2nd child of the left COLUMN** (below the car name), and `vehicleStatus` is a **separate full-width row placed AFTER `headerFirstRow`**. See §1.
2. **Tapping the battery toggles % ↔ distance.** The `% text` node is wrapped in its own `TouchableOpacity`; its `onPress` (fn #117224) flips a local `useState` boolean AND fires `changeVehicleEnergyDisplayFormat(newValue)`, which sends the vehicle command `VehicleCommand.energyDisplayFormat` = `FORMAT_DISTANCE`/`FORMAT_PERCENTAGE` (persisted vehicle-side). See §3.

**Two corrections to the established context** (both verified at the opcode level, self-consistent with the already-correct `batteryText.marginHorizontal:5`):
- `statusTextContainer.marginTop` = **5** (= `Gutter*0.5`), NOT 10. Proof: `Reg7`=0.5 (hasm:5217732, LoadConstDouble), never rewritten (only writes to Reg7 in fn#117212 are at off 0x429/0x42d/0x437, last = 0.5), then `Mul Reg12 = Reg7 * Gutter` at hasm:5217800.
- `batteryViewContainer.marginTop` = **5** (= `Gutter*0.5`), NOT Gutter(10). Same `Reg7=0.5` multiply at hasm:5217740.
All three of `batteryText.marginHorizontal`, `batteryViewContainer.marginTop`, `statusTextContainer.marginTop` are the identical `0.5×Gutter=5`.

---

## 1. Home-header render tree (deliverable #1)

### 1.1 `VehicleHomeHeader` #117239 → wires the two props (hasm:5220743–5220770)

```
<Fragment>                                                            // jsxs, hasm:5220744
 ├─ <HomeHeader                                                       // hasm:5220748
 │     name={getSelectedVehicleName}                                  // hasm:5220750
 │     chargeStatus={<SelectedVehicleChargeStatus showCharge toggleCharge/>}  // hasm:5220752-5220757  ← BATTERY
 │     vehicleId={getSelectedVehicleId}                               // hasm:5220758
 │     vehicleStatus={<VehicleStatusText setIsShowingLowPowerMode=…/>}// hasm:5220759-5220764  ← STATUS LINE
 │     onTitlePress={fn#117247}                                       // hasm:5220765
 │     onStatusPress={fn#117253 → vehicleWakeUp(vin,TAP_STATUS_TEXT)} // hasm:5220767
 │     hasChallenges={…}/>
 └─ <AlertModal …/>                                                   // rename dialog, hasm:5220777
</Fragment>
```

So `chargeStatus` (the battery) and `vehicleStatus` (the status line) are **two distinct elements**, positioned independently by `HomeHeader`.

### 1.2 `HomeHeader` #117234 render tree (hasm:5220074–5220411)

```
<Fragment>                                                            // jsxs, hasm:5220074
 ├─ <GestureDetector gesture={Gesture.Exclusive(drag,…)}>             // hasm:5220081
 │     └─ <Reanimated.View style={[animatedPositionStyle, animatedFadeStyle]}>  // hasm:5220092
 │          └─ <LootboxBanner isTopBanner/>                           // hasm:5220099 (top promo banner)
 │
 └─ <Reanimated.View style={animatedHeaderPositionStyle}>             // hasm:5220110  (whole header, animated)
      └─ <View style={[headerContainer, isPlaceholder && headerContainerNoTopMargin]}>   // hasm:5220117  ← COLUMN
           children = [
             ┌── ROW 1 ────────────────────────────────────────────────────────────────
             <View style={headerFirstRow}>                           // hasm:5220131  (row, space-between, align flex-start)
                ├─ <View style={headerLeftContainer}>                 // hasm:5220137  ← COLUMN (no flexDirection ⇒ default 'column')
                │     children = [
                │        <View style={vehicleTitleContainer}>{name}</View>,  // hasm:5220143  ROW-1a: CAR NAME (top)
                │        {chargeStatus}                                // hasm:5220151  ROW-1b: BATTERY INDICATOR (below name)
                │     ]
                │  </View>
                └─ <View style={headerRightContainer}>               // hasm:5220158  (row, center, justify flex-end)
                      children = [
                         menu / profile TouchableOpacity(iconMenu|menu, white, hitSlop{L:12,R:12}),  // hasm:5220218-5220284
                         MessageCenterEntryPoint (analyticsScreen:'vehicle_screen'),                 // hasm:5220196
                         {isCharging && <View style={chargingIndicator}><Icon charging_bolt SMALL powerRed/></View>}  // hasm:5220287-5220320
                      ]
                   </View>
             ┌── ROW 2 ────────────────────────────────────────────────────────────────
             <View style={educationalPopUpContainer}>{EducationalPopUp …}</View>,   // hasm:5220351-5220396 (coach-mark, absolute)
             ┌── ROW 3 ────────────────────────────────────────────────────────────────
             <TouchableOpacity onPress={onStatusPress}>{vehicleStatus}</TouchableOpacity>  // hasm:5220399-5220404  ← STATUS LINE (own row)
           ]
        </View>
</Fragment>
```

**Vertical stacking proof (this is the exact mechanism):**
- `headerContainer` = **column** (RN default; `alignItems:'stretch'`) → its 3 children stack vertically: `headerFirstRow` (top), `educationalPopUpContainer`, then the status-line `TouchableOpacity` (bottom).
- `headerLeftContainer` = **column** (`{flex:1, height:'100%', maxWidth:250}`, NO `flexDirection` ⇒ default `column`) → the **car name** (child 0) and the **battery** (`chargeStatus`, child 1) stack vertically; the battery's own root (`batteryViewContainer`, `marginTop:5`) sits directly under the name.
- Therefore, top→bottom: **NAME → BATTERY (own row) → STATUS TEXT (own row)**. The battery is on its own row, above the status line, exactly as observed. It is NOT inline beside the status text (they live in different parents).

### 1.3 Style table (fn #117212, `Gutter`=10 hasm:1566023; `Specifications.iconMargin`=10 obj @all_objects.txt:34609)

| StyleSheet key | Value | hasm |
|---|---|---|
| **headerContainer** | `{alignItems:'stretch', height:100*, justifyContent:'flex-start', paddingHorizontal:Gutter*n, paddingTop:Gutter(10), start:0, top:Specifications.statusBarOffset, width:'100%'}` | 5217747–5217763 |
| headerContainerNoTopMargin | `{top:<val>}` (placeholder variant) | 5217766 |
| **headerFirstRow** | `{alignItems:'flex-start', flexDirection:'row', justifyContent:'space-between'}` | 5217767–5217768 |
| **headerLeftContainer** | `{flex:1, height:'100%', maxWidth:250}` (no flexDirection ⇒ column) | 5217769–5217770 |
| headerRightContainer | `{alignItems:'center', flexDirection:'row', flexWrap:'nowrap', justifyContent:'flex-end', marginBottom:Gutter(10)}` | 5217771–5217776 |
| headerStatusText | `{alignItems:'center', flexDirection:'row', flexWrap:'wrap', justifyContent:'flex-start'}` | 5217777–5217778 |
| vehicleTitleContainer | `{flexGrow:1, marginRight:Gutter*n}` | 5217803–5217810 |
| **batteryViewContainer** | `{alignItems:'center', flexDirection:'row', marginTop:5 (=Gutter*0.5)}` **[corr: not 10]** | 5217736–5217742 |
| **batteryText** (header) | `{fontSize:16, fontWeight:'bold', marginHorizontal:5 (=Gutter*0.5)}` | 5217727–5217735 |
| **statusTextContainer** | `{alignItems:'center', flexDirection:'row', marginTop:5 (=Gutter*0.5)}` **[corr: not 10]** | 5217796–5217802 |
| chargingIndicator | `{position:'absolute', right:-4, top:-4}` | 5217743–5217744 |
| row | `{alignItems:'center', flexDirection:'row'}` | 5217794–5217795 |
| rightHeaderItemSpacing | `{marginLeft:Gutter*n, position:'relative'}` | 5217791–5217793 |
| educationalPopUpContainer | `{elevation:2, zIndex:2}` | 5217745–5217746 |

`*` `height:100` is the raw object-buffer decode (hasm:5217747); **INFERRED possibly-stale** (design-system `Specifications.homeHeaderHeight`=64, obj @all_objects.txt:34609). Not load-bearing for the battery/status question.

---

## 2. Battery indicator component (deliverable #2)

Two layers: **`ChargeStatus` #117220** (the row that holds glyph + % text + status icons) and **`MiniBatteryView` #117269** (the glyph itself). `SelectedVehicleChargeStatus` #117228 is the redux wrapper that pulls all selectors and renders `<ChargeStatus …/>` (hasm:5218871–5218896).

### 2.1 `ChargeStatus` #117220 render tree (hasm:5218456–5218562)

```
<Animated.View style={[batteryViewContainer, {opacity: opacityRef}]}>        // hasm:5218457-5218469
   children = [
     [0] <TouchableOpacity style={row} onPress={toggleCharge? fn#117222 : noop}>  // hasm:5218470-5218481  (tap → expand charge panel)
            <BatteryGlyph                                                     // hasm:5218452/5218455
                batteryLevelDec           = {batteryLevelDec}
                usableBatteryLevelDec     = {usableBatteryLevelPercent / 100}  // hasm:5218493-5218495
                charging                  = {charging}
                discharging               = {chargingOnSolar}
                dischargingStoppedAutomatically = {isPowershareStoppedAutomatically===true}/>
            // BatteryGlyph = (theme===CYBERTRUCK ? MiniBatteryViewCt(default of env[5]) : require[21].MiniBatteryView)  hasm:5218444-5218455
         </TouchableOpacity>,
     [1] <TouchableOpacity style={row} onPress={fn#117224}>                    // hasm:5218507-5218555  (tap → %↔distance toggle)
            <Text category=BodyLabel appearance=Light                          // hasm:5218525-5218536
                  style={[batteryText, {color: <statusTextColor>}]}>           // hasm:5218537-5218544
               { displayMode ? batteryLevelDistanceWithUnit : (usableBatteryLevelPercent + '%') }  // hasm:5218545-5218552
            </Text>
         </TouchableOpacity>,
     [2] batteryStates.map(fn#117225)                                          // hasm:5218557-5218560  (extra status icons, see §4.2)
   ]
</Animated.View>
```

- **Opacity dim on stale data** (fn #117221, useEffect hasm:5218572–5218596): `Animated.timing(opacityRef, {toValue: isVehicleDataStale ? 0.5 : 1, duration: isVehicleDataStale ? 0 : 500, easing: Easing.cubic, useNativeDriver:true}).start()`. The whole battery row fades to **50% opacity** when data is stale (instant), back to 100% over **500 ms** when fresh.
- **% text `color`** (`Reg19`, hasm:5218542) is the *battery status text color*, computed separately from the glyph fill: `textColorLight` (normal, theme muted), `batteryGreen #00E286` when charging (hasm:5218218), `vehiclePowershareDischarging #00E286` / `rangeAnalysisGradientYellow #FF9F0A` for powershare states (hasm:5218403–5218420). **It does NOT turn red/amber at low battery** — only the glyph fill does (§4).
- `TextCategory.BodyLabel` / `TextAppearance.Light`: fontSize **14**, lineHeight **20**, fontWeight **'500'**, letterSpacing **0.1**, family `UniversalSansText` (per R2 typography). The `batteryText` style adds `fontSize:16, fontWeight:'bold'` which **overrides** category → the % renders **16 px bold**.

### 2.2 `MiniBatteryView` #117269 — the glyph is drawn with Views + one Icon (hasm:5222322–5222423)

**Not an SVG (standard theme). It is a bordered `View` + absolute fill `View`(s) + a `battery_nipple` icon-font glyph for the terminal nub.** (The Cybertruck variant IS an SVG — §5.)

```
<View style={batteryContainer}>                                          // {flexDirection:'row', alignItems:'center'}  hasm:5222323-5222329
   ├─ <View                                                              // THE OUTLINE / BODY   hasm:5222330-5222345
   │     style={[container, {backgroundColor: pillBg,                    //   pillBg = customBackgroundColor ?? theme.pillBackgroundColor (CT: secondaryTextDarkMode)
   │                        borderColor: pillBg(CT:secondaryTextDarkMode #9B9B9B),
   │                        borderWidth: 1,   borderRadius: 3,
   │                        width: 35,        height: 16}]}
   │     onLayout={measure→setWidth}>                                    // fn#117270 measures real width for fill math  hasm:5222346
   │     ├─ <View                                                        // FILL layer A (zIndex 1)  hasm:5222348-5222365
   │     │     style={[batteryLevel, {backgroundColor: getBatteryColor(),
   │     │                            width:  round(innerW * getFillPercentage(min(batteryLevelDec, usableBatteryLevelDec))),
   │     │                            height: 16 - 2*borderWidth}]}/>
   │     └─ {usableBatteryLevelDec>0 && batteryLevelDec>usableBatteryLevelDec &&
   │           <View                                                     // FILL layer B (zIndex 2, blue reserve)  hasm:5222368-5222395
   │              style={[usableBatteryLevel, {left:  <layer-A width>,
   │                                           width: round(innerW * (batteryLevelDec - usableBatteryLevelDec))}]}/>}
   │  </View>
   └─ {theme!==CYBERTRUCK &&
         <Icon name="battery_nipple" height={16} width={4*35/35=4} color={pillBg}/>}   // THE + TERMINAL NUB  hasm:5222401-5222420
</View>
```

Where `innerW = measuredWidth − 2·borderWidth`, `getFillPercentage(x) = x>=0.1 ? Math.min(1,x) : 0.1` (fn #117268, hasm:5222199–5222207 — fill width never drops below 10% of inner width, caps at 100%).

**Exact glyph geometry / spacing / border (StyleSheet fn #117264, hasm:5221933–5221957):**

| Key | Value | Meaning | hasm |
|---|---|---|---|
| **container** | `{width:35, height:16, position:'relative', flexDirection:'row', alignItems:'center'}` | battery body box | 5221948–5221949 |
| (inline on container) | `borderWidth:1, borderRadius:3, borderColor:pillBg` | the outline | 5222340–5222341 |
| **batteryLevel** | `{position:'absolute', left:1, borderRadius:1, zIndex:1}` | fill layer A (charge) | 5221936–5221937 |
| batteryLevelCt | `{position:'absolute', left:1, top:1, borderRadius:0, zIndex:1}` | fill layer A (Cybertruck) | 5221938–5221939 |
| **usableBatteryLevel** | `{position:'absolute', left:1, height:12, borderRadius:1, zIndex:2, backgroundColor:Colors.blue #0f52ba}` | fill layer B (reserve/buffer) | 5221950–5221956 |
| batteryContainer | `{flexDirection:'row', alignItems:'center'}` | wraps body + nipple | 5221934–5221935 |
| batteryText (this module) | `{fontSize:16, fontWeight:'bold', marginHorizontal:Specifications.iconMargin=10}` | used only by `MiniBatteryStatus` #117271, NOT the header | 5221940–5221947 |

**Prop defaults (MiniBatteryView #117269, hasm:5222221–5222250):** `batteryBreakpointWarning=20`, `batteryBreakpointCritical=7`, `customHeight=16`, `customWidth=35`, `customBorderWidth=1`, `customBorderRadius=3`. `ChargeStatus` passes none of the customs → all defaults apply.

**Fill → % mapping (in words):** the fill bar width is `round((batteryWidth−2) × clamp(soc, 0.1, 1.0))`. Layer A (status color) shows the smaller of `batteryLevelDec`/`usableBatteryLevelDec`; when total > usable, layer B (blue `#0f52ba`) draws the extra "unusable/reserve" wedge to the right of layer A. `battery_nipple` icon nub = 4 px wide × 16 px tall.

---

## 3. The % ↔ distance tap toggle (deliverable #3)

**Owner:** the `% text`'s own `TouchableOpacity` (`ChargeStatus` child [1], hasm:5218507–5218518), `onPress` = fn **#117224** (hasm:5218629–5218644). (The glyph's TouchableOpacity, child [0], has a *different* handler fn #117222 → `toggleCharge(!showCharge)`, which expands/collapses the charge-details panel — hasm:5218607–5218614.)

**fn #117224 does two things (hasm:5218633–5218643):**
1. `setDisplayMode(!currentDisplayMode)` — flips a local `useState` boolean (optimistic, instant UI). The state is created in `ChargeStatus` as `useState(!showEnergy)` (hasm:5218421–5218431).
2. `if (changeVehicleEnergyDisplayFormat != null) changeVehicleEnergyDisplayFormat(!currentDisplayMode)` — persists.

**Persistence — fn #117230 `changeVehicleEnergyDisplayFormat` (a `useCallback`, hasm:5218923–5218963):**
```
if (getSelectedPhoneKeyPaired && carApiVersion >= MIN_SET_UNITS_AND_FORMATS_CAR_API_VERSION)   // hasm:5218929,5218939
    sendCommand( VehicleCommand.energyDisplayFormat,                                            // hasm:5218946-5218947
                 SetEnergyDisplayFormatAction.Format( newValue ? FORMAT_DISTANCE                 // hasm:5218959
                                                              : FORMAT_PERCENTAGE ) )            // hasm:5218957
```
So the toggle is a **persisted vehicle-side setting** (`VehicleCommand.energyDisplayFormat`), gated on: **phone key paired** AND **car API ≥ `MIN_SET_UNITS_AND_FORMATS_CAR_API_VERSION`**. If those don't hold, only the local `useState` flips (session-local, not persisted). `sendCommand` comes from `useVehicleCommand` (hasm:5218849–5218851).

**The two display modes & exact formatting (hasm:5218545–5218552):**

| `displayMode` (useState) | Persisted `Format` | Text rendered | Formatting |
|---|---|---|---|
| **falsy** (default when `showEnergy` true) | `FORMAT_PERCENTAGE` | `usableBatteryLevelPercent + '%'` | integer percent, **no space**, e.g. **`"75%"`** (hasm:5218549–5218550, `'%'` = string_id 2087) |
| **truthy** (default when `showEnergy` false) | `FORMAT_DISTANCE` | `batteryLevelDistanceWithUnit` | preformatted range+unit string from selector `getRemainingBatteryRangeDistanceWithUnit(state,vin)` (hasm:5217953). Unit (km/mi) follows vehicle's distance-unit preference. e.g. **`"312 km"`** |

Initial mode = `!showEnergy` (hasm:5218423). No i18n key `vehicle_home_battery_range` involved — the percent is built inline as `number + "%"`; the distance is a fully preformatted selector string. **UNRESOLVED (boundary):** the exact separator/rounding inside `getRemainingBatteryRangeDistanceWithUnit` (not opened; lives in the selectors module).

**Side effects:** (a) local re-render swaps the text instantly; (b) if gated conditions pass, a real command goes to the car and the format persists across sessions/devices. No redux `distanceUnitPreference`/`showRange` slice is toggled here — the source of truth is the vehicle setting `energyDisplayFormat` mirrored into the `showEnergy` selector.

---

## 4. Battery colours per state + low/warning threshold (deliverable #4)

### 4.1 Glyph FILL colour — `getBatteryColor` (fn #117267, hasm:5222079–5222190)

`percent = Math.round(batteryLevelDec * 100)` (hasm:5222093–5222096), then **checked in this order**:

| Priority | Condition | Colour token | **Hex (RN JS palette)** | hasm |
|---|---|---|---|---|
| 1 | `charging` | `batteryCharging` | **#00E286** | 5222097 → 5222189 |
| 2 | `percent <= batteryBreakpointCritical` (**7**) | `batteryCritical` | **#ff0000** | 5222098 → 5222179 |
| 3 | `percent <= batteryBreakpointWarning` (**20**) | `batteryWarning` | **#ffc107** | 5222099 → 5222169 |
| 4 | `discharging === true` | `vehiclePowershareDischarging` | **#00E286** | 5222101 → 5222159 |
| 5 | `dischargingStoppedAutomatically === true` | `rangeAnalysisGradientYellow` | **#FF9F0A** | 5222102 → 5222149 |
| 6a | else, theme = **DARK** | `batteryNormalDark` | **#8A8B8C** | 5222112 → 5222139 |
| 6b | else, theme = **CYBERTRUCK** | `secondaryTextDarkMode` | **#9B9B9B** | 5222119 → 5222132 |
| 6c | else, theme = **LIGHT** | `batteryNormalLight` | **#F1F1F1** | 5222126 |

**Low/warning threshold answer:** warning at **≤ 20 %**, critical at **≤ 7 %** — these are `batteryBreakpointWarning`/`batteryBreakpointCritical`, MiniBatteryView prop defaults **20 / 7** (hasm:5222222/5222227), compared against `round(soc×100)`. `ChargeStatus` supplies no overrides.

### 4.2 Status ICON colours (the extra glyphs beside the battery, `ChargeStatus` `batteryStates.map`, fn #117225 renders `NamedIcon size=SMALL(20)`)

Pushed into `batteryStates` in `ChargeStatus` (hasm:5218162–5218402) per `BatteryState`:

| BatteryState | Icon glyph | Colour token | Hex | hasm |
|---|---|---|---|---|
| `CHARGING` (plain) | `charging_bolt` | `batteryCharging` | #00E286 | 5218189/5218198 |
| `HEATER` (+ showBatteryHeatTime) | `battery_heat` | `orange` | *(UNRESOLVED hex)* | 5218238/5218243 |
| `COLD_WEATHER` | `snowflake` | `vehicleEnergyBlue` | *(UNRESOLVED hex)* | 5218277/5218282 |
| chargingOnSolar | `sun` | `solarOnlyChargingColor` | *(UNRESOLVED hex)* | 5218309/5218318 |
| showChargeOnSolarError | `warning` | `Colors.warning` | #FFC107 (per R2 StatusIcon) | 5218347/5218352 |
| powershare active/stopped | `powershare` | `vehiclePowershareDischarging`/`rangeAnalysisGradientYellow` | #00E286 / #FF9F0A | 5218381/5218418 |

### 4.3 Native vs RN palette (important)

The RN home header uses its **own JS palette** (`obj:6184` static `Colors`), **not** the native `colors.xml` tokens. They differ by ~1 unit:
- charging: RN `batteryCharging` **#00E286** vs native `battery_charging_color` #00e185.
- warning: RN `batteryWarning` **#ffc107** vs native `battery_level_warning_color` #ffc106.

### 4.4 Resolved colour hexes (from `scratchpad/all_objects.txt`)

| Token | Hex | Where used |
|---|---|---|
| batteryCharging / batteryGreen / vehiclePowershareDischarging | **#00E286** | charging fill, charging % text, powershare discharging |
| batteryWarning | **#ffc107** | fill ≤20% |
| batteryCritical | **#ff0000** | fill ≤7% |
| rangeAnalysisGradientYellow | **#FF9F0A** | dischargingStoppedAutomatically |
| batteryNormalDark | **#8A8B8C** | normal fill, DARK theme |
| batteryNormalLight | **#F1F1F1** | normal fill, LIGHT theme |
| secondaryTextDarkMode | **#9B9B9B** | normal fill CYBERTRUCK; CT outline/nipple |
| blue | **#0f52ba** | `usableBatteryLevel` reserve-wedge fill |
| pillBackgroundLightMode | **#E4E4E4** | outline/body + nipple, LIGHT (`theme.pillBackgroundColor`) |
| pillBackgroundDarkMode | **#2D2F34** | outline/body + nipple, DARK |
| powerRed | **#FF3A3A** | top-bar `charging_bolt` (header right) |

`theme.textColorLight` (the % text default colour) is a theme accessor, **UNRESOLVED** exact hex (per R2; muted/secondary).

---

## 5. Battery glyph asset identity (deliverable #5)

**Standard (all non-Cybertruck themes) — the battery is DRAWN, not a single asset:**
- **Outline/body:** a React-Native `<View>` with CSS `borderWidth:1, borderColor:pillBg, borderRadius:3`, size 35×16 (`container` style). No vector, no icon for the body.
- **Fill:** plain absolute `<View>`(s) (`batteryLevel`, `usableBatteryLevel`) whose `width` = charge fraction × inner width.
- **Terminal nub (+):** the ONLY icon asset in the standard glyph — an **icon-font glyph** `Icon name="battery_nipple"` (string_id 483989, `all_strings.txt:69997`), rendered 4 px × 16 px, coloured with the outline colour. This is a bundled RN icon-font glyph (not a native drawable). **→ extract: `battery_nipple` from the app icon font.**

**Cybertruck theme — this one IS an SVG.** `MiniBatteryViewCt` #117262 (module default of the segmented battery) renders `react-native-svg` `<Path d=… fill=color/>` segments (Path renderer fn #117263, hasm:5221861–5221871). The path builder `getPath(offset, percentageFull)` (fn #117260, hasm:5221666–5221690) concatenates the `d` string from these literals/constants:
- `"M"` + `(6.54545 * pct)` + `" "` + `(6.54545*pct − 12*pct)` + `"h1.45455L"` + …`" 12H"`… + `"Z"` (magic numbers 6.54545, 1.45455, 12; per-cell geometry). `getPaths` (fn #117261, hasm:5221695–5221767) splits into 10 cells with `offset`/`percentageFull`/`color` (empty=`Gray.buttonBorderGray`, partial=`Colors.blue`, full=status colour). **→ CT battery is SVG cells; not needed for the standard device unless Cybertruck.**

**Other status glyphs (icon-font names, for extraction):** `charging_bolt`, `battery_heat`, `snowflake`, `sun`, `warning`, `powershare` (see §4.2). All are icon-font/vector glyphs compiled into the JS bundle, rendered via `NamedIcon`/`Icon`; **glyph vector `d=` paths not recovered** (names only), except the CT battery path fragments above.

---

## 6. Citations index (auditable)

- **StyleSheet (fn#117212):** hasm:5217726–5217818; Gutter=10 hasm:1566023; `Reg7=0.5` hasm:5217732; marginTop Muls hasm:5217740/5217800; batteryText marginHorizontal hasm:5217733.
- **ChargeStatus #117220:** render hasm:5218456–5218562; glyph select (CT vs default) hasm:5218444–5218455; % text branch hasm:5218545–5218552; opacity useEffect fn#117221 hasm:5218572–5218596; glyph onPress fn#117222 hasm:5218607–5218614; text onPress fn#117224 hasm:5218633–5218643; status-icon map fn#117225 hasm:5218649–5218698.
- **SelectedVehicleChargeStatus #117228:** hasm:5218730–5218896; changeVehicleEnergyDisplayFormat useCallback fn#117230 hasm:5218923–5218963.
- **MiniBatteryView module:** module-init/StyleSheet fn#117264 hasm:5221877–5221957; `getBatteryColor` fn#117267 hasm:5222079–5222190; `getFillPercentage` fn#117268 hasm:5222199–5222207; `MiniBatteryView` render fn#117269 hasm:5222322–5222423; `onLayout` fn#117270 hasm:5222429–5222440; nipple hasm:5222412; CT `MiniBatteryViewCt` fn#117262 hasm:5221772, `getPath` fn#117260 hasm:5221666, `getPaths` fn#117261 hasm:5221695, Path render fn#117263 hasm:5221861.
- **HomeHeader #117234:** render hasm:5220074–5220411; headerFirstRow hasm:5220131; headerLeftContainer children hasm:5220143–5220152; status-line TouchableOpacity hasm:5220399–5220404; charging bolt hasm:5220304–5220317.
- **VehicleHomeHeader #117239:** chargeStatus prop hasm:5220752–5220757; vehicleStatus prop hasm:5220759–5220764; onStatusPress fn#117253 hasm:5220767.
- **Colours:** `all_objects.txt` (static Colors + theme objects); pillBackgroundColor build hasm:5565229? → theme fn hasm:1565228–1565231 (light `pillBackgroundLightMode`).

## 7. Gaps (stated plainly)

1. `theme.textColorLight` and `theme.pillBackgroundColor` exact per-mode hexes beyond the light/dark pill values (`textColorLight` is a theme accessor — muted, not a static literal).
2. Icon-font hexes for `orange`, `vehicleEnergyBlue`, `solarOnlyChargingColor` (battery_heat/snowflake/sun tints) — not fetched.
3. Exact separator/rounding of `getRemainingBatteryRangeDistanceWithUnit` (`batteryLevelDistanceWithUnit`) — selector not opened; format assumed "value␠unit".
4. `MIN_SET_UNITS_AND_FORMATS_CAR_API_VERSION` numeric value — not an inline literal at the read site.
5. Glyph vector `d=` paths for the status icons (`charging_bolt` etc.) — only glyph names recovered (CT battery path fragments are the exception).
6. `headerContainer.height:100` raw decode vs `homeHeaderHeight:64` — not reconciled (not load-bearing).
