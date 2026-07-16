# Tesla Android app — status area: assets, colours, header layout, cold start (Round 3)

**Target:** official Tesla Android app `com.teslamotors.tesla` **v4.58.0 (build 4392)**. Static RE of the Hermes bytecode (`bundle.hasm`) + apktool-decoded native resources + physical asset extraction. Follow-up to Rounds 1–2; **this round corrects them where they were wrong — see the correction banner below.**

**Citation shorthand:** `hasm:N` = line in `/Users/ivan/Work/tesla-summon/work/bundle.hasm`; `off 0xNNN` = bytecode offset in the named fn; `res/…` = decoded APK; `obj:` = object literal in the extracted dump. Plain = read directly from an opcode/literal; **INFERRED** = interpretation; **UNRESOLVED**/**GAP** = not recovered.

---

## ⚠️ CORRECTIONS to Rounds 1–2 (we implement directly from these docs — read this first)

1. **Cold start shows "Last seen {x} ago", NOT "Connecting".** Round 2 documented "Connecting" as the cold-start fallback. Wrong. The status line's primary text is the persisted **`lastUpdatedString`** ("Last seen {{age}}" / "Asleep {{age}}"); "Connecting" is only shown when that is **null** (never-fetched vehicle). (§A, §B)
2. **The spinner co-renders WITH "Last seen/Asleep {{age}}".** Round-2 §3 said the spinner appears *only* with "Connecting" and never with a concrete state. Wrong. The spinner is gated inside the **stale-data branch**, whose text is the freshness string. So whenever the header reads "Last seen/Asleep {{age}}", the spinner spins beside it. (Round-2 §1 — spinner is a structural sibling — was correct.) (§A)
3. **`statusTextContainer.marginTop = 5`, not 10.** Round-2 §2 said 10; it missed a `Mul` by 0.5. The real value is `0.5 × Gutter = 5` (verified hasm:5217800). Same for `batteryViewContainer.marginTop = 5`. (§C)
4. **The freshness is rendered by `VehicleStatusText` itself**, via the `lastUpdatedString`/`isDataStale` hook — NOT a separate component / parent-swap. Round 1 §1.5 and Round 2 §4 marked a parent-swap as INFERRED; that was wrong. (§A)
5. **The status-text colour is `#8A8B8B` (dark) / `#606060` (light)** — Round 2 left this UNRESOLVED. (§E)
6. **The spinner is a white `mini_spinner.png` arc mask (36×36), not RN's `ActivityIndicator`.** If you shipped `ActivityIndicator`, that's visibly non-Tesla. (§D, §F)

---

## §A. The spinner gate — RESOLVED

### The mechanism Round 2 missed
`VehicleStatusText` #117231 reads from a `useShallowEqualSelector` hook (hasm:5219035-5219036):
- **`lastUpdatedString`** — the freshness string from `vehicleDataLastUpdatedString` (#30315): `"Last seen {{age}}"` / `"Asleep {{age}}"`, or **null** if never fetched.
- **`isDataStale`**, plus `getSelectedVehicleCanWake` and `getSelectedVehicleDataFetchedRecently`.

### Render control flow (opcode-precise)
Defaults before the dispatch (hasm:5219 off 0x4b1-0x4bb): text `''`, spinner `false`, multiline `false`. Dispatch, first match wins:

| Priority | Condition | Text | Spinner |
|---|---|---|---|
| 1 | (online & fresh, no special state) | `''` (empty — renders nothing) | no |
| 2 | Parked | "Parked" | no |
| 3 | Mobile Access Disabled | "Mobile Access Disabled" | no |
| 4 | In/Out of Service | "In Service"/"Out of Service" | no |
| 5 | Service Mode / upgrade | "Service Mode" / "Please upgrade the app" | no |
| 6 | Powershare / Charging | powershare/charging text (charging = multiline) | no |
| **7** | **`isDataStale`** | **`lastUpdatedString`** ("Last seen/Asleep {{age}}"), fallback **"Connecting"** if null | **YES = `canWake \|\| !fetchedDataRecently`** |

The stale branch (off 0x908): `text = lastUpdatedString ?? tr('connecting_label')`; `spinner = canWake || !fetchedDataRecently`.

**So the spinner co-renders with "Last seen {{age}}" / "Asleep {{age}}" / "Connecting"** (all one branch). Live states never spin.

### Thresholds & inputs — RESOLVED
- **`fetchedDataRecently`** (fn #30697, hasm:1461974): `(now − last_received_vehicle_data_timestamp) < TimeInMs.TWO_MINUTES` = **120 000 ms (2 min)**.
- **`isVehicleDataStale`** (fn #30694, hasm:1461883): true if `proto_vehicle_data`/`getVehicleConfig()` is null **or** `every(timestamps, olderThan 2 min)` (`TimeInMs.TWO_MINUTES`, hasm:1461944).
- **`canWake`** (`getVehicleCanWake` #31609, hasm:1509062): true when a wake is **actively tracked** — any of `userForcedWakes`, `screensEnteredRequiringWake`, `userInitiatedCommands`, `overrideAutoWakes`. It means "a wake was requested," not "the car is wakeable."

**Does an asleep/offline car spin permanently or briefly?** The stale branch is entered exactly when data is >2 min old, so `!fetchedDataRecently` is essentially always true there → **the spinner shows continuously the whole time the status reads "Last seen/Asleep {{age}}"**, plus whenever a wake is actively tracked. It stops when fresh vehicle_data (<2 min) arrives and the header flips to a live state (or empty). **Implementation: show the spinner whenever you show "Last seen/Asleep", not only during an explicit refresh gesture.**

---

## §B. Cold start — RESOLVED

- **Persistence:** the store uses **redux-persist** (`persistReducer`, `persistStore`, `REHYDRATE`, `createMigrate`). Vehicle data is persisted under the **`vehicles`/`vehicleData`** slice including **`last_received_vehicle_data_timestamp`** (set on each vehicle_data receipt, reducer hasm:1517340). Storage engine name not positively isolated (no `MMKV`/`AsyncStorage` literal) — **GAP** — but the slice + timestamp survive cold start (the user's observation confirms it).
- **What renders at cold start (cache present):** REHYDRATE restores vehicle data whose timestamps are >2 min old → `isDataStale = true` → the stale branch renders **"Last seen {x} ago"** (or "Asleep {x}") **+ spinner** (`!fetchedDataRecently`). This is the ground-truth observation.
- **"Connecting" is reached only** when `lastUpdatedString` is null — a vehicle that has **never** been fetched (fresh install / newly added vehicle).
- **Timestamp source:** `last_received_vehicle_data_timestamp` = **last successful vehicle_data receipt** (not a push, not a server field). `vehicleDataLastUpdatedString` formats `now − that` with moment `.fromNow()`.
- **Cached battery at cold start:** YES — battery %/range come from the same persisted `proto_vehicle_data` (`usableBatteryLevelPercent` / `batteryLevelDistanceWithUnit`), so cached battery renders immediately (no late pop-in).

---

## §C. Header layout + battery

### C1. Header render tree (battery on its OWN ROW ABOVE the status — proven)
`VehicleHomeHeader` #117239 passes the battery as the `chargeStatus` prop and the status line as the `vehicleStatus` prop into `HomeHeader` #117234 (hasm:5220752 / 5220764). Inside `HomeHeader` (hasm:5220074-5220411):

```
headerContainer  (COLUMN, alignItems:'stretch')
├─ headerFirstRow (ROW, space-between, align flex-start)
│   ├─ headerLeftContainer  {flex:1, height:'100%', maxWidth:250}  ← COLUMN (no flexDirection)
│   │    ├─ View{vehicleTitleContainer} → CAR NAME          (top)
│   │    └─ {chargeStatus} → BATTERY INDICATOR (own row, marginTop:5, directly under name)
│   └─ headerRightContainer (ROW, justify flex-end) → menu/profile, MessageCenter, {isCharging && charging_bolt}
├─ educationalPopUpContainer (coach-mark, absolute)
└─ TouchableOpacity{onPress:onStatusPress} → {vehicleStatus} = STATUS TEXT   ← own full-width row (bottom)
```

Top→bottom: **NAME → BATTERY (own row) → STATUS TEXT (own row)**. Battery and status live in different parents (not inline). Tapping the status row → `vehicleWakeUp(vin, TAP_STATUS_TEXT)`.

### C2. Header style values (`Gutter`=10; **all three margins = 0.5×Gutter = 5**)
| Key | Value | hasm |
|---|---|---|
| headerContainer | `{alignItems:'stretch', justifyContent:'flex-start', paddingTop:10, paddingHorizontal:Gutter·n, width:'100%', top:statusBarOffset}` | 5217747 |
| headerFirstRow | `{flexDirection:'row', alignItems:'flex-start', justifyContent:'space-between'}` | 5217767 |
| headerLeftContainer | `{flex:1, height:'100%', maxWidth:250}` (column) | 5217769 |
| headerRightContainer | `{flexDirection:'row', alignItems:'center', flexWrap:'nowrap', justifyContent:'flex-end', marginBottom:10}` | 5217771 |
| vehicleTitleContainer | `{flexGrow:1, marginRight:Gutter·n}` | 5217803 |
| **batteryViewContainer** | `{flexDirection:'row', alignItems:'center', marginTop:5}` | 5217736 |
| **statusTextContainer** | `{flexDirection:'row', alignItems:'center', marginTop:5}` | 5217796 |
| chargingIndicator | `{position:'absolute', right:-4, top:-4}` | 5217743 |

### C3. Battery indicator component
`ChargeStatus` #117220 renders `Animated.View[batteryViewContainer, {opacity}]` with 3 children:
1. **Glyph** — `TouchableOpacity(row, onPress→toggleCharge)` wrapping `MiniBatteryView` #117269.
2. **% / distance text** — `TouchableOpacity(row, onPress→toggle % ↔ distance)` wrapping a `Text`.
3. **Status icons** — `batteryStates.map` (charging bolt, heat, snowflake, sun, warning, powershare).

**Opacity dim on stale data** (fn #117221): the whole battery row `Animated.timing` to **opacity 0.5** when `isVehicleDataStale` (instant), back to **1.0 over 500 ms** when fresh.

**The glyph is DRAWN with Views (standard theme), not an SVG/asset** (`MiniBatteryView` #117269, StyleSheet #117264):
- **Body/outline:** a `<View style={container}>` = `{width:35, height:16, position:'relative', flexDirection:'row', alignItems:'center'}` + inline `{borderWidth:1, borderRadius:3, borderColor:pillBg}`.
- **Fill layer A** (`batteryLevel` `{position:'absolute', left:1, borderRadius:1, zIndex:1}`): `width = round((35−2) × clamp(soc, 0.1, 1.0))`, height `16−2`, `backgroundColor = getBatteryColor()`.
- **Fill layer B** (`usableBatteryLevel` `{position:'absolute', left:1, height:12, borderRadius:1, zIndex:2, backgroundColor:blue #0f52ba}`): the "reserve/unusable" wedge, drawn when total charge > usable, to the right of layer A.
- **Terminal nub (+):** an **icon-font glyph `battery_nipple`** (4 px × 16 px), coloured with the outline colour. (This is the only asset in the standard glyph.)
- **Fill floor:** `getFillPercentage(x) = x≥0.1 ? min(1,x) : 0.1` (never below 10% of inner width).
- Prop defaults: `customWidth 35, customHeight 16, customBorderWidth 1, customBorderRadius 3, batteryBreakpointWarning 20, batteryBreakpointCritical 7`.
- **Cybertruck theme:** `MiniBatteryViewCt` #117262 IS a `react-native-svg` `<Path>` segmented battery (10 cells). Standard devices don't need it.

### C4. The % ↔ distance tap toggle
The **% text's own** `TouchableOpacity.onPress` (fn #117224):
1. flips a local `useState` boolean (instant, optimistic);
2. calls `changeVehicleEnergyDisplayFormat(new)` → `sendCommand(VehicleCommand.energyDisplayFormat, Format(new ? FORMAT_DISTANCE : FORMAT_PERCENTAGE))` — **persisted vehicle-side**, gated on **phone-key paired** AND **car API ≥ `MIN_SET_UNITS_AND_FORMATS_CAR_API_VERSION`** (fn #117230, hasm:5218923). If gating fails, only the local state flips (session-local).

| Mode | Persisted format | Rendered text | Formatting |
|---|---|---|---|
| percent (default when `showEnergy`) | `FORMAT_PERCENTAGE` | `usableBatteryLevelPercent + '%'` | integer, **no space**, e.g. **"75%"** |
| distance | `FORMAT_DISTANCE` | `batteryLevelDistanceWithUnit` (selector `getRemainingBatteryRangeDistanceWithUnit`) | preformatted range+unit, km/mi per vehicle preference, e.g. **"312 km"** |

The **glyph's** own tap (child 1, fn #117222) is a *different* action → `toggleCharge` (expands the charge-details panel), not the %↔distance toggle. **Text is 16 px BOLD**: `batteryText` = `{fontSize:16, fontWeight:'bold', marginHorizontal:5}` overrides the `BodyLabel` category.

### C5. Battery colours + thresholds
**Glyph FILL** (`getBatteryColor` #117267, checked in order):

| Priority | Condition | Token | Hex |
|---|---|---|---|
| 1 | charging | batteryCharging | **#00E286** |
| 2 | `round(soc·100) ≤ 7` | batteryCritical | **#ff0000** |
| 3 | `round(soc·100) ≤ 20` | batteryWarning | **#ffc107** |
| 4 | discharging (solar) | vehiclePowershareDischarging | #00E286 |
| 5 | dischargingStoppedAutomatically | rangeAnalysisGradientYellow | #FF9F0A |
| 6 | normal — dark / light / CT | batteryNormalDark **#8A8B8C** / batteryNormalLight **#F1F1F1** / secondaryTextDarkMode #9B9B9B |

Warning **≤20%**, critical **≤7%** (prop defaults). Reserve wedge = `blue #0f52ba`. Outline/nub = `pillBackgroundColor` = **#2D2F34** (dark) / **#E4E4E4** (light).
**% TEXT** colour: `theme.textColorLight` normally (same token as the status line — §E), `#00E286` when charging, powershare tints for those states. **The % text does NOT turn red/amber at low battery — only the glyph fill does.**
Top-bar charging bolt (header right) = `Icon charging_bolt`, SMALL (20), **`powerRed #FF3A3A`** — distinct from the native widget bolt (grey/green).
**RN uses its own JS palette, not native `colors.xml`** (e.g. RN `#00E286` vs native `#00e185`; RN `#ffc107` vs native `#ffc106`).

---

## §D. Assets (real files extracted → `tesla-status-assets/`)

| File | APK source | Intrinsic | Format | Notes |
|---|---|---|---|---|
| `mini_spinner.assets-img.png` | `split_assets_pack.apk!assets/img/mini_spinner.png` | **36×36** | PNG RGBA | **The header spinner.** Pure **white** `#FFFFFF`, graded-alpha arc (max α ≈101 ≈40%). A **tint mask** — rendered white, single-density. |
| `spinner.assets-img.png` | `split_assets_pack.apk!assets/img/spinner.png` | 100×100 | PNG RGBA | Large white spinner (α up to 254). |
| `mini_spinner.payment.mdpi.png` / `spinner.payment.mdpi.png` | `base.apk!res/drawable-mdpi-v4/node_modules_tesla_paymentreactnative_…` | 36×36 / 100×100 | PNG gray+α | Payment-package copies, mdpi-only, **same artwork**. |
| `spinner.json` / `spinner_ct.json` | `base.apk!res/raw/` | 100×100, 30fps | Lottie v5.12.2 | Cybertruck spinner is the 6-layer `_ct`. |
| `ic_battery.xml` + `shape_battery_rect_inner*.xml` | `base.apk!res/drawable/` | 39×14 | vector/shape | **Widget/notification** battery (grey 30% outline + white fill bars) — NOT the RN home-header glyph. |
| `ic_charging_bolt.xml` (#8a8b8b), `ic_charge_bolt_no_margin.xml` (**green #66de8e**), `ic_charge_plug.xml`, `ic_charging_bolt_cybertruck.xml` | `base.apk!res/drawable/` | 10–24dp | vector | Widget charging glyphs. |
| `ic_low_power_mode_{on,off,on_disabled}[_cybertruck].xml` | `base.apk!res/drawable/` | 28–30dp | vector | Low-power set (on = amber #ffc107). |
| `quantum_ic_cloud_off_vd_theme_24.xml` | `base.apk!res/drawable/` | 24dp | vector | No-connection cloud-off. |

**Key packaging facts:**
- The RN home-header spinner ships **single-density** in `assets/img/` (no `@2x/@3x`/`drawable-*dpi`). It is a **white alpha mask** → tint at runtime. #117231 passes **no tint** → it renders white. On the dark header it's a faint white arc.
- **The RN home-header BATTERY glyph is NOT an extractable file** — it is drawn from `<View>`s (border + fill) + the `battery_nipple` **icon-font glyph** (§C3). To reproduce: draw a 35×16 rounded-rect (border 1, radius 3, colour `pillBackgroundColor`), an inner fill `<View>` (radius 1, width = charge×inner, colour per §C5), a blue reserve wedge, and a 4×16 nub. (Battery vector `d=` paths for `charging_bolt` etc. are icon-font glyphs — names only recovered, except the CT battery SVG path fragments.)

---

## §E. Colours — RESOLVED

Theme palettes (fn #32987, hasm:1565050): a light block (`pillBackgroundLightMode`) and dark block (`pillBackgroundDarkMode`).

| Token | Light | Dark | Applies to |
|---|---|---|---|
| `textColor` (appearance Default) | **#222222** | near-white (INFERRED #FFFFFF/#F6F6F6) | car **name** (bright) |
| **`textColorLight`** (appearance Light) | **#606060** | **#8A8B8B** | **the status text** AND the battery % (normal) |
| `reverseTextColor` (appearance Alternative) | #828282 | #454546 | reversed contexts |

- **The status-line colour = `theme.textColorLight`** (its `Text` uses `appearance:Light`): **dark mode `#8A8B8B`**, light mode `#606060`. Tesla's home screen is dark → ship **`#8A8B8B`**. There is **no extra `opacity`** on the status text — the muting is baked into the token.
- **Battery % vs status text: SAME token** (`textColorLight`) when normal — both `#8A8B8B` (dark). Difference is size/weight only (battery % = 16 px bold; status = 14 px / weight 500). Do NOT apply different opacities; use the same `#8A8B8B`. (Battery % changes to `#00E286` etc. only for charging/powershare states.)
- **Car name colour = `textColor`** (bright, `#222222` light / near-white dark) — distinct from the two greys above.
- **Header background:** no dedicated token in this module — the header sits on the app's base dark background. (No special treatment found — GAP if any.)

---

## §F. Traps — what else you'd get wrong

1. **Spinner asset, not `ActivityIndicator`.** Ship the white `mini_spinner.png` (36×36, white alpha arc) rotating ~900 ms/turn, linear, infinite (Round 2 §3). RN's grey `ActivityIndicator` is visibly wrong.
2. **Spinner shows with "Last seen/Asleep", continuously while data is stale** — not only on an explicit refresh, and not only with "Connecting" (§A).
3. **Cold start = "Last seen {x} ago" + spinner**, never "Connecting" for a previously-seen car (§B).
4. **Status text colour `#8A8B8B` (dark), 14 px, weight 500, UniversalSans, marginTop 5** — not a guessed opacity, not 10 (§C2, §E).
5. **Battery is drawn Views (35×16, border 1 px, radius 3) + `battery_nipple` nub**, not an icon/SVG (standard theme). Fill floor 10%, reserve wedge blue `#0f52ba` (§C3).
6. **Battery low colour = glyph FILL only** (amber ≤20 %, red ≤7 %); the % **text** stays grey/`textColorLight` (turns green only when charging) (§C5).
7. **% ↔ distance toggle persists to the car** (`energyDisplayFormat` command), gated on phone-key + car API — not a purely local UI flip (§C4).
8. **Battery row dims to 50 % opacity when data is stale** (instant), restoring over 500 ms (§C3).
9. **RN palette ≠ native `colors.xml`** (off by ~1 unit); use the RN hexes above (§C5).
10. **Two taps, two actions:** tapping the **battery glyph** expands the charge panel (`toggleCharge`); tapping the **% text** toggles %↔distance; tapping the **status line** wakes the car (`TAP_STATUS_TEXT`). Three distinct hit targets (§C1, §C4).

---

## §G. Citations
Full opcode-level citations are in the appendix files (`tesla-status-assets-appendix/`): `A-spinner-coldstart-colours.md` (§A/§B/§E), `B-header-battery.md` (§C), `C-asset-manifest.md` (§D). Load-bearing anchors: hook read hasm:5219035; stale branch hasm:5219411-5219450; thresholds fn #30694 hasm:1461883 / #30697 hasm:1461974 (both `TimeInMs.TWO_MINUTES`); canWake #31609 hasm:1509062; textColorLight hasm:1565250 (light)/1565455 (dark); header tree #117234 hasm:5220074-5220411; battery `getBatteryColor` #117267 hasm:5222079; toggle #117224/#117230 hasm:5218633/5218923; marginTop Mul hasm:5217800.

## §H. Gaps (stated plainly)
1. **Storage engine** backing redux-persist (MMKV vs AsyncStorage): not isolated.
2. **`getRemainingBatteryRangeDistanceWithUnit`** exact separator/rounding (the "312 km" string builder): selector not opened.
3. **`MIN_SET_UNITS_AND_FORMATS_CAR_API_VERSION`** numeric value: not an inline literal at the read site.
4. **`textColorLight` dark `textColor`** (car-name dark hex): a variable at the read site (INFERRED near-white).
5. Icon-font hexes for `orange`/`vehicleEnergyBlue`/`solarOnlyChargingColor` (heat/snowflake/sun tints), and the `d=` vector paths for icon-font glyphs (`battery_nipple`, `charging_bolt`, …): names recovered, paths not.
6. **Header background** special treatment (if any): none found.
