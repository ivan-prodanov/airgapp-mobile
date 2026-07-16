# Tesla status area — pixel polish: battery glyph, font, resume, asleep, spinner (Round 4)

**Deliverable for Round 4** — the pixel-precision last mile, verified on **BOTH platforms**. Round 1–3 mined Android; **we ship iOS**, so this round adds the iOS bundle.

**Sources (every fact below is tagged `[iOS-verified]` / `[Android-only]` / `[both-match]` / `[differ]`):**
- **iOS (what we ship, PRIMARY):** `/Users/ivan/Downloads/tesla-haptics-work/main.decompiled.js` — the iOS Hermes bundle decompiled to readable JS, **Tesla iOS v4.56**. IPA `com.teslamotors.TeslaApp_4.57.5` (v4.57.5) used for font/asset extraction.
- **Android:** `/Users/ivan/Work/tesla-summon/work/bundle.hasm` (Hermes disasm, **v4.58**).
- **Godot project:** `split_assets_pack.apk!assets/godot/` (compiled `.gdc`).
- **Method:** every StyleSheet is dumped **verbatim** (per the brief's note). This round was produced by 6 dual-platform readers + 6 adversarial verifiers; the battery §1 was additionally hand-verified by me independently. Version note: iOS decompile is v4.56, Android v4.58, IPA v4.57.5 — for layout/fonts/assets these do not differ; flagged where it could matter.

**Extracted files in `tesla-status-assets/`:** `battery_nipple.svg` (the nub), `battery_reference_dark.svg` (corrected battery mockup), `fonts/ios/UniversalSans-*.ttf` + `fonts/android/UniversalSans*.ttf` (real font files).

---

## §1. Battery glyph — VERBATIM, and the three deltas fixed

**Component:** `MiniBatteryView` (iOS `main.decompiled.js` fn @ :4571513; Android `bundle.hasm` fn #117269). Styles module: iOS StyleSheet.create @ :4571844; Android fn #117264 @ :5221877. **`[both-match]` op-for-op.** There is **no separate `ChargeStatus` StyleSheet** — that component *is* this module. The status-bar battery renders `MiniBatteryView` with **no custom props** → all defaults.

### 1a. Complete StyleSheet.create literal — VERBATIM `[both-match]`
```js
StyleSheet.create({
  batteryContainer:   { alignItems: 'center', flexDirection: 'row' },
  batteryLevel:       { borderRadius: 1, left: 1, position: 'absolute', zIndex: 1 },
  batteryLevelCt:     { borderRadius: 0, left: 1, position: 'absolute', top: 1, zIndex: 1 },   // Cybertruck only
  batteryText:        { fontSize: 16, fontWeight: 'bold', marginHorizontal: Specifications.iconMargin /*=10*/ },
  container:          { alignItems: 'center', flexDirection: 'row', height: 16, position: 'relative', width: 35 },
  usableBatteryLevel: { backgroundColor: Colors.blue /*'#0f52ba'*/, borderRadius: 1, height: 12, left: 1, position: 'absolute', zIndex: 2 },
})
```
**None of these carries the body's colour/border/radius** — those are applied **inline in render**, merged onto `styles.container`.

### 1b. Body — VERBATIM inline style (iOS :4571655; Android fn #117269 0x1f6–0x21b) `[both-match]`
```js
style = [ styles.container, {
  backgroundColor: r28,   // = ThemeContext.pillBackgroundColor  (dark: Colors.pillBackgroundDarkMode = '#2D2F34')
  borderColor:     r9,    // = r28 (SAME as backgroundColor) on non-Cybertruck; '#9B9B9B' secondaryTextDarkMode only on Cybertruck
  borderWidth:     r27,   // = customBorderWidth ?? 1
  borderRadius:    r23,   // = customBorderRadius ?? 3
  width:           r12,   // = customWidth ?? 35
  height:          r10,   // = customHeight ?? 16
} ]
```
**⇒ DELTA (b) FIX — the body IS filled.** Body `backgroundColor = borderColor = pillBackgroundColor = **#2D2F34** (dark)`. It is a **solid `#2D2F34` rounded rect**, not a stroke around a transparent interior. (Light theme: `#E4E4E4`.) `[iOS-verified + Android both-match]`

### 1c. Charge fill box — VERBATIM `[both-match]` — **corrects Round 3 (was 14, is 12)**
Inset constant (iOS :4571633; Android fn #117269 Mul/AddN): `r24 = borderWidth*2 + 2 = **4**`.
```js
fill = [ styles.batteryLevel /* {borderRadius:1, left:1, position:absolute, zIndex:1} */, {
  backgroundColor: getBatteryColor(),                              // normal dark = '#8A8B8C'
  width:  Math.round((measuredWidth - 4) * getFillPercentage(level)),   // getFillPercentage: <0.1→0.1, else min(level,1)
  height: 16 - 4,                                                  // = 12   ← NOT 14
} ]
```
**⇒ DELTA (a) FIX — the fill is INSET.** height **12** (not 14), `left:1`, `borderRadius:1`, and width inset by 4 total → visible top/bottom/left/right margin over the solid body. Round 3's "flush height-14" was wrong on **both** platforms (I hand-verified `r24=4` on iOS at :4571633 and Android at hasm:5222 Mul/AddN). The reserve wedge `usableBatteryLevel` (blue `#0f52ba`, height 12, zIndex 2) draws only when total charge > usable.

### 1d. The nub `battery_nipple` — it is an **SVG path**, not a font, not a bar `[both-match]`
`battery_nipple` resolves (via Tesla's `Icon` name→lazy-`react-native-svg`-component registry — **no icon font exists in the APK/IPA**) to module 2845's `<Path>`. **VERBATIM** (iOS :1489641; Android `bundle.hasm:1742340`):
```svg
<svg viewBox="0 0 3 16" width="3" height="16" fill="none">
  <path d="M1 5a2 2 0 0 1 2 2v2a2 2 0 0 1-2 2V5Z" fill="currentColor"/>
</svg>
```
Geometry: a **rounded bump at x∈[1,3], y∈[5,11]** (2 wide × 6 tall, vertically centered in the 16 box), flat left edge, r=2 rounded right — the battery positive terminal. Extracted to **`tesla-status-assets/battery_nipple.svg`**.
Render (iOS :4571788; Android fn #117269 0x338): `<Icon name="battery_nipple" height={16} width={4 /*=4*customWidth/35*/} color={borderColor /*#2D2F34*/}/>`. It is `children[1]` of the `flexDirection:'row'` `batteryContainer` → a **4×16 slot abutting the body with 0 gap, vertically centered** (`fill:currentColor` ⇒ takes the `#2D2F34` colour). **Suppressed on Cybertruck.** **⇒ DELTA (c) FIX — not a detached full-height bar; a small centered rounded tab in `#2D2F34`.**

### 1e. Dimensions/radius on the standard dark path (defaults) `[both-match]`
`customHeight ?? 16, customWidth ?? 35, customBorderWidth ?? 1, customBorderRadius ?? 3` (iOS :4571534). Status battery passes no customs ⇒ **35×16, border 1, radius 3, radius on fill 1**. There is **no larger radius** on the standard branch — radius 3 on a 16px body is the official value; the "more rounded" look comes from radius 3 + the solid fill + the 12px inset bar, not a bigger radius. (Only non-status callers override: a 10×24/r1.4 mini indicator and a 1.5-border/r0 charge-screen variant.)

### 1f. Battery palette (iOS Colors :1338467) — VERBATIM hex `[both-match]`
`pillBackgroundDarkMode #2D2F34` · `pillBackgroundLightMode #E4E4E4` · `batteryNormalDark #8A8B8C` · `batteryNormalLight #F1F1F1` · `batteryCharging/batteryGreen #00E286` · `vehiclePowershareDischarging #00E286` · `rangeAnalysisGradientYellow #FF9F0A` · `batteryWarning #ffc107` (≤20%) · `batteryCritical #ff0000` (≤7%) · `secondaryTextDarkMode #9B9B9B` (Cybertruck) · `blue #0f52ba` (reserve wedge).

**Corrected render tree (see `battery_reference_dark.svg`):**
```
<View style={batteryContainer /* row, center */}>
  <View style={[container(35×16), {backgroundColor:#2D2F34, borderColor:#2D2F34, borderWidth:1, borderRadius:3, width:35, height:16}]} onLayout>
     <View style={[batteryLevel(left:1,radius:1,abs,z1), {backgroundColor:getBatteryColor()/*#8A8B8C*/, width:round((W-4)*pct), height:12}]}/>
     {reserve && <View style={[usableBatteryLevel(left:1,height:12,radius:1,abs,z2,#0f52ba), {left:fillW, width:…}]}/>}
  </View>
  {!cybertruck && <Icon name="battery_nipple" height={16} width={4} color="#2D2F34"/>}  // = the SVG path above
</View>
```

---

## §2. Typography — the ~1px width delta is a **font substitution**

**Root cause `[iOS-verified]`:** the official iOS app renders the status text in the **bundled `UniversalSans-Text-Medium-540.ttf`** (PostScript name **`UniversalSansText-Medium`**), *not* the system font. Your build uses `fontWeight:'500'` with no matching bundled family → iOS falls back to **San Francisco Medium** → different per-glyph advances → the ~1px width delta.

### 2a. Resolved iOS status text style — VERBATIM `[iOS-verified; Android both-match on the resolution path]`
The status line is a Tesla-Design-System `<Text category='bodyLabel' appearance='Light'>`. Resolution: `generateTextThemedStyles` → `Typography['bodyLabel']` → `getFontStyle({type:'Medium', fontFamilyPrefix:'UniversalSansText-', fontSize:14, lineHeight:20, letterSpacing:0.1})` → `getUniversalSansFontFamily('Medium','UniversalSansText-') = 'UniversalSansText-Medium'`. Non-CJK path returns:
```js
{ fontFamily: 'UniversalSansText-Medium', fontSize: 14, lineHeight: 20, letterSpacing: 0.1 }   // NO fontWeight
```
- `fontFamily` = exact PostScript name → iOS `UIFont` renders the bundled Medium-540 cut directly.
- **No `fontWeight`** on the non-CJK path (weight is baked into the Medium cut). `fontWeight:'500'` is added **only** when `isShowingChineseOrKorean()` is true.
- `+ color` = `theme.textColorLight` (`#8A8B8B` dark / `#606060` light, per R3).
- **`[differ, but same physical file]`**: R3's Android baseline `{fontFamily:'UniversalSansText', fontWeight:'500'}` comes from a **legacy `Themes` typography table** (iOS :1643335), not the TDS `Text` path — both point at Universal Sans, but the TDS/`Typography` path (which the status line uses) yields `'UniversalSansText-Medium'`+no-weight. (Which table the exact status line reads is the one item still `INFERRED-strong`, not byte-isolated — but the fix below works for either.)

### 2b. Font files + weight→file `[iOS-verified]` (extracted to `fonts/ios/`)
| RN token / weight | iOS file (PostScript / usWeightClass) |
|---|---|
| Bold '700' | `UniversalSans-Text-Bold-680.ttf` (UniversalSansText-Bold / 700) |
| **Medium '500' ← status text** | **`UniversalSans-Text-Medium-540.ttf` (UniversalSansText-Medium / 500)** |
| Regular '400' | `UniversalSans-Text-Regular-430.ttf` (/ 400) |
| Light '300' | `UniversalSans-Text-Light-230.ttf` (/ 200) |
| Thin '200' | `UniversalSans-Text-Thin-130.ttf` (/ 100) |
Name-table caveat: Regular & Bold share family "Universal Sans Text"; **Thin/Light/Medium each get their own family** ("… Medium", subfamily Regular). So match by **PostScript name** `UniversalSansText-Medium`, not by family+weight. `Display` faces exist too (h1–h4 use `UniversalSansDisplay`); Cybertruck uses `Blender-TSL`.

### 2c. No scaling/transform gotchas `[both-match]`
No `Platform.select` alters fontSize/weight/family/letterSpacing/lineHeight (except the CJK weight add). TDS bodyLabel sites set `maxFontSizeMultiplier: 1` (Dynamic-Type pinned). No `textTransform`/`fontVariant` on BodyLabel. So advance widths don't change from casing/scaling at default settings.

### 2d. The fix
Register & ship `UniversalSans-Text-Medium-540.ttf` (in `fonts/ios/`) and render:
```
fontFamily: 'UniversalSansText-Medium', fontSize: 14, lineHeight: 20, letterSpacing: 0.1   // drop fontWeight
```
Do **not** rely on `fontWeight:'500'` alone — that yields SF and reintroduces the delta. (Honest caveat: in a desktop metric model the bundled face came out slightly *narrower* than SF-opsz17 — opposite sign to your report — likely because on-device SF small-optical tracking differs from the desktop SFNS sample. The load-bearing conclusion is **font identity**: matching the official font removes the delta regardless of sign.)

---

## §3. Resume — they refetch too, but suppress the *visible* work `[both-match; iOS-verified paths]`

**The official app DOES refetch `vehicle_data` immediately on every foreground.** There is **no network-level "skip if fresh" guard.** What differs is what's *visible*:

- **Lifecycle:** RN `AppState 'change'` → `onAppForeground`/`onAppBackground` (`APP_FOREGROUND`/`APP_BACKGROUND` actions). On foreground the `ProductListFetch` `onActive` dispatches `cancelAllDataRequests()` then `startDataAutoRefresh(vehicleId, VEHICLE_DATA)`; on background it dispatches `cancelAllDataRequests()` → **polling is suspended while backgrounded** (iOS fun90773/90774; Android same). The BLE poll fork is (re)started on foreground and cancelled on background (`startVehicleDataPollingOverBLE`, iOS fun153182).
- **First fetch is immediate:** `periodicVehicleFetch` fetches then `delay(interval)`; there is **no `fetchedDataRecently` check at the top of the loop.** A dedup guard only prevents *double*-looping ("Looping, IGNORE startDataAutoRefreshEffect").
- **Poll cadence `[both-match]`, confirms R1:** `VEHICLE_DATA_POLLING_INTERVAL_ONLINE = 5000 ms`, `_OFFLINE = ONE_SECOND*1.2 = 1200 ms`, `ENERGY_PAIRED = 4000 ms`.
- **What you SEE — suppressed by two guards:**
  - **Spinner** shows only when `!fetchedDataRecently` (data older than **2 min**, `last_received_vehicle_data_timestamp`) with `canWake`/error (R3 §A). Resume with <2-min data → **no spinner** although a refetch runs.
  - **Godot 3D loading animation** (`mobile_app_state.is_loading`) shows only when `getVehicleDataQuality === NO_DATA` (`shouldShowLoadingGodotAnimation`). Cached data ≠ NO_DATA → **no 3D re-animate on resume.** Only a truly never-fetched vehicle plays it.
  - The **Godot renderer is a persistent native view** (`TMGodotView`); nothing in the foreground/background sagas remounts or reloads it. `INFERRED`: kept alive across background, resumes in place.
- **BLE across background `[INFERRED, high-confidence]`:** on background the app cancels only the *data-polling saga*, not the transport — no handler calls a vehicle-BLE disconnect on `APP_BACKGROUND` (`disconnectFromPeripheral` at iOS :6802030 is the **Energy/Powerwall** BLE bridge, not the vehicle). So the official app **keeps BLE alive across backgrounding and re-forks the poll over the existing connection.** **This is opposite to our build**, which tears down BLE on background and rebuilds on foreground — that rebuild is a likely additional source of the visible "refresh."

**Why theirs feels static / ours reloads — port these:** (1) gate the spinner on the 2-min `fetchedDataRecently`; (2) show the 3D loading animation only on `NO_DATA`, keep the cached render otherwise; (3) keep the 3D view mounted across background; (4) keep BLE alive, only pause/resume the poll loop.

---

## §4. Asleep presentation — a Godot overlay quad, alpha **0.5**, driven by **data-unreliable** (not `ASLEEP`)

**Mechanism `[both-match contract; iOS-verified values]`:** NOT an RN overlay, NOT an `opacity` on the renderer view. It is a **renderer-side (Godot) full-surface overlay quad**, driven from RN by the native message **`SET_SCREEN_OVERLAY_COLOR`**.

- Call: `setScreenOverlayColor(color, alpha)` (iOS :1173339). With 2 args → `{animated:true, duration:0.5 (defaultCameraAnimationDuration, iOS :1174109), transition_type:LINEAR, ease_type:OUT}`.
- Values at the vehicle-detail call site (iOS `_fun111021` :4562440): **`color = ThemeContext.v5BackgroundColor`** (the theme background — NOT hard black), **`alpha = 0.5` when the boolean is true, else `0`**.
- **Driving boolean = `isSelectedVehicleDataUnreliable`** → `isVehicleDataUnreliable(getVehicleDataQuality)` → true when quality ∈ **{CACHED_UNRELIABLE, UNABLE_TO_FETCH, NO_DATA}** (iOS fn #30239 :1240562; Android #30693). **NOT `ConnectionState.ASLEEP`.** Asleep affects it only transitively: asleep → no fresh data → quality degrades → dim.
- Godot side (Android `.gdc`): `assets/godot/mobile/scripts/ScreenOverlay.gdc` handles `on_set_screen_overlay_color`, tweening the overlay quad's `alpha` (its own default duration 0.333 is overridden by RN's 0.5). Routed via `ReactMsg.gd`.
- **Covers the Godot render surface only** — RN text/battery/buttons above the renderer are NOT dimmed by it.
- **Transition:** alpha 0→0.5 (and back) over **0.5 s, LINEAR, ease-OUT**.

**Three distinct "0.5" treatments — do not conflate (the team may have):**
1. **Godot renderer dim** — `SET_SCREEN_OVERLAY_COLOR`, color `v5BackgroundColor`, **alpha 0.5**, 0.5 s tween ← **`isVehicleDataUnreliable`**.
2. **RN battery-row opacity 0.5** (R3 §C3, `Animated.timing`, 500 ms restore) ← **`isVehicleDataStale`** (>2 min).
3. **Spinner + Godot loading animation** ← `!fetchedDataRecently` / `dataQuality === NO_DATA`.

The literal word **"Asleep" is only the freshness label text** `"Asleep {{age}}"` (stale branch), never a renderer flag.

**Our `rgba(0,0,0,0.6)` full-screen blackout is wrong on 4 counts:** (a) it's a full-screen RN overlay — official is a **renderer-only Godot quad**; (b) colour should be **`ThemeContext.v5BackgroundColor`**, not hard black; (c) alpha **0.5**, not 0.6; (d) it should **animate in/out over 0.5 s LINEAR/OUT**, not be an instant hard overlay. And trigger it on **data-unreliable**, not on a raw `ASLEEP`/blackout. `UNRESOLVED`: the exact Godot scene reaction to `is_loading=true` (`.gdc` compiled — only field names recovered); whether control buttons dim under the renderer boolean.

---

## §5. Spinner usage app-wide `[both-match]`

**`BusyIcon` component:** default `size 20`, `speed 900`, `large false`; **`tintColor` = the `color` prop only** — no `color` ⇒ renders the native **white** `mini_spinner.png` (36×36). Cybertruck theme → a **Lottie** instead of the PNG.

- **Header status spinner:** `size 18`, **no tint → white** (R3 confirmed).
- **Control button, command in flight — REPLACE + dim `[iOS-verified; Android both-match]`:** the `NamedIcon` is **replaced by `jsx(BusyIcon, {})`** in the same child slot (empty props ⇒ **size 20, no tint, white**) — the spinner is *not* placed alongside. **Additionally, `busyDisabledStyle = {opacity: Specifications.iconButtonBusyOpacity = 0.5}` is applied to the icon-container AND the label while `status === BUSY`** — so the whole busy button fades to **50% opacity** on top of the icon→spinner swap. *(This opacity-0.5-on-busy is the behaviour your build is missing.)*
- **Other sizes seen at call sites:** 12, 15, **18** (header/loading-bar), **20** (default/control button/suspension), 24, **25** (`mediumSmallIconSize`), **30** (`mediumIconSize`/`iconSize`), `IconSize.LARGE`. Tint is **per-site** (driven by whether the caller passes `color`): control button and header status pass **no** colour → white; info rows (e.g. Wall Connector) pass `color = row.textColor` → tinted.
- **`iconButtonBusyOpacity = 0.5`** (in both `Specifications` objects, iOS :3349016 / :1338587): used by (1) ControlButton `busyDisabledStyle` (icon-container + label on BUSY — above), and (2) a generic list "disabled" style. Nowhere else.
- ControlButton stylesheet (VERBATIM, iOS :3992540) for reference: `busyDisabledStyle{opacity:0.5}`, `container{alignItems:center,flexDirection:column,justifyContent:center}`, `iconContainer{…column,center}`, `pressContainer{borderRadius:90,position:absolute,inset:0}`, `text{lineHeight:14,paddingTop:Gutter*0.2,textAlign:center}`. Loading-bar wrapper `busyIcon{marginRight:7}`.

---

## §6. Traps — where our current build still diverges visibly
1. **Spinner asset, not `ActivityIndicator`** (R3) — plus: on a **busy control button, also dim the icon-container + label to opacity 0.5** (`iconButtonBusyOpacity`), and **replace** the icon with the white 20 px `mini_spinner` (don't place it alongside).
2. **Battery fill height is 12, not 14** (`16 − (2·borderWidth + 2)`), inset ~2 px; **body is filled `#2D2F34`** (bg == border), not a hollow stroke; **nub is the `battery_nipple.svg` path** (4×16, `#2D2F34`, abutting, centered), not a detached bar. Ship `battery_reference_dark.svg` as the target.
3. **Status font**: ship & use `UniversalSans-Text-Medium-540.ttf` via `fontFamily:'UniversalSansText-Medium'` (no `fontWeight`); relying on SF is the 1px delta.
4. **Asleep**: replace the `rgba(0,0,0,0.6)` full-screen blackout with a **renderer-scoped dim** at `v5BackgroundColor` **alpha 0.5**, animated 0.5 s LINEAR/OUT, triggered on **data-unreliable** (CACHED_UNRELIABLE/UNABLE_TO_FETCH/NO_DATA) — not a raw ASLEEP blackout. Keep the separate RN battery-row 0.5 (stale) as its own thing.
5. **Resume**: stop the visible reload — gate the spinner on the 2-min `fetchedDataRecently`, show the 3D loading only on `NO_DATA`, keep the 3D view + BLE alive across background (don't tear down/rebuild BLE on every foreground).
6. Battery **% text** colour = `textColorLight` normally (same token as the status line; green `#00E286` when charging) — do not colour it by charge level; only the **glyph fill** changes colour by level (amber ≤20 %, red ≤7 %).

---

## §7. Citations (representative; full verbatim per section in `tesla-status-polish-appendix/`)
- Battery styles: iOS `main.decompiled.js:4571844`; Android `bundle.hasm` fn #117264 :5221877. Body inline iOS :4571655 / Android fn #117269 0x1f6. Fill inset `r24=4` iOS :4571633 / Android hasm:5222 Mul+AddN. Nub SVG iOS :1489641 / Android :1742340; render iOS :4571788 / Android fn #117269 0x338.
- Typography: `getFontStyle`/`Typography` iOS :1339xxx (BodyLabel `type:'Medium'`); IPA fonts `Payload/TeslaV4.app/UniversalSans-Text-Medium-540.ttf`.
- Resume: `onAppForeground` iOS :2452713; `startDataAutoRefresh` on active iOS fun90773 :3701780; `periodicVehicleFetch` iOS fun153163 :6831339; intervals iOS :1254518.
- Asleep: `setScreenOverlayColor` iOS :1173339 (alpha 0.5 @ :4562440, color `v5BackgroundColor` @ :4560812); `isVehicleDataUnreliable` iOS #30239 :1240562; `ScreenOverlay.gdc`.
- Spinner: `BusyIcon` iOS :1428412 / Android #35845; ControlButton busy swap iOS :3992182 / Android :4417456; `iconButtonBusyOpacity` iOS :3992540 / Android :4417124.

## §8. Gaps
- The exact status-line render site was not byte-isolated; `fontFamily:'UniversalSansText-Medium'` is `INFERRED-strong` from the TDS `<Text category='bodyLabel'>` path (the legacy `Themes` table would give `'UniversalSansText'`+weight — still bundled US; the fix ships the font either way).
- Godot scene's exact reaction to `is_loading=true` / the overlay quad node — `.gdc` is compiled; only field names + the `on_set_screen_overlay_color` handler recovered.
- The 1px-delta **sign** is modeled from desktop SFNS metrics, not device-measured; font identity is the robust conclusion.
- Whether control/favourite buttons disable under the renderer-dim boolean — not found.
- Native CoreBluetooth state-restoration / whether the render display-link pauses while backgrounded — below the JS bundle, not observable.
