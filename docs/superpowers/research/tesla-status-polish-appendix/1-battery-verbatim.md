# Round 4 §1 — MiniBatteryView / battery glyph, VERBATIM

Platform coverage: **iOS-verified (v4.56, main.decompiled.js) + Android-verified (v4.58, bundle.hasm)** — the styles module and the render function match op-for-op across both. Every value below is `[both-match]` unless marked otherwise. We ship iOS; iOS is the primary source.

The module exports `MiniBatteryView`, `MiniBatteryStatus`, `getBatteryColor`. There are TWO components: `MiniBatteryView` (the actual glyph — body + fill + nub) and `MiniBatteryViewCt`/`MiniBatteryStatus` (a dot+text wrapper, NOT the glyph). The status-bar 35×16 battery = `MiniBatteryView` on its **default props** path.

---

## 1. COMPLETE StyleSheet.create literal — VERBATIM

### iOS (main.decompiled.js:4571838–4571869) — readable JS object literals:
```js
r4 = r1.StyleSheet;
r3 = r4.create;
r1 = {};
r5 = {'alignItems': 'center', 'flexDirection': 'row'};
r1['batteryContainer'] = r5;
r5 = {'borderRadius': 1, 'left': 1, 'position': 'absolute', 'zIndex': 1};
r1['batteryLevel'] = r5;
r5 = {'borderRadius': 0, 'left': 1, 'position': 'absolute', 'top': 1, 'zIndex': 1};
r1['batteryLevelCt'] = r5;
r5 = {'fontSize': 16, 'fontWeight': 'bold'};
...
r5['marginHorizontal'] = <Specifications.iconMargin>;   // computed token, see note
r1['batteryText'] = r5;
r5 = {'alignItems': 'center', 'flexDirection': 'row', 'height': 16, 'position': 'relative', 'width': 35};
r1['container'] = r5;
r5 = {'backgroundColor': null, 'borderRadius': 1, 'height': 12, 'left': 1, 'position': 'absolute', 'zIndex': 2};
...
r5['backgroundColor'] = <Colors.blue>;   // = '#0f52ba'
r1['usableBatteryLevel'] = r5;
r1 = r3.bind(r4)(r1);   // StyleSheet.create(...)
```

So the resolved styles module is:
```js
StyleSheet.create({
  batteryContainer:    { alignItems: 'center', flexDirection: 'row' },
  batteryLevel:        { borderRadius: 1, left: 1, position: 'absolute', zIndex: 1 },
  batteryLevelCt:      { borderRadius: 0, left: 1, position: 'absolute', top: 1, zIndex: 1 },
  batteryText:         { fontSize: 16, fontWeight: 'bold', marginHorizontal: Specifications.iconMargin },
  container:           { alignItems: 'center', flexDirection: 'row', height: 16, position: 'relative', width: 35 },
  usableBatteryLevel:  { backgroundColor: Colors.blue /* '#0f52ba' */, borderRadius: 1, height: 12, left: 1, position: 'absolute', zIndex: 2 },
})
```

### Android (bundle.hasm, fn #117264, offsets 0x0ed–0x199) — `NewObjectWithBufferLong` comments, VERBATIM:
```
0xed  # Object: {'alignItems': 'center', 'flexDirection': 'row'}                                    -> batteryContainer
0x102 # Object: {'borderRadius': 1, 'left': 1, 'position': 'absolute', 'zIndex': 1}                 -> batteryLevel
0x115 # Object: {'borderRadius': 0, 'left': 1, 'position': 'absolute', 'top': 1, 'zIndex': 1}       -> batteryLevelCt
0x12a # Object: {'fontSize': 16, 'fontWeight': 'bold'}  (+ marginHorizontal = Specifications.iconMargin) -> batteryText
0x15a # Object: {'alignItems': 'center', 'flexDirection': 'row', 'height': 16, 'position': 'relative', 'width': 35} -> container
0x16c # Object: {'backgroundColor': null, 'borderRadius': 1, 'height': 12, 'left': 1, 'position': 'absolute', 'zIndex': 2} (+ backgroundColor = Colors.blue) -> usableBatteryLevel
```
**[both-match] — byte-for-byte identical to iOS.**

Note: `batteryText.marginHorizontal` and `usableBatteryLevel.backgroundColor` are computed at create-time from theme tokens (`Specifications.iconMargin`, `Colors.blue`), then merged onto the literal — shown above resolved.

**IMPORTANT: none of `batteryContainer`, `batteryLevel`, `batteryLevelCt`, `container` is the battery BODY box.** The body box's `backgroundColor / borderColor / borderWidth / borderRadius / width / height` are applied **INLINE in the render function**, merged on top of the `container` base style (see §2/§3). The `container` StyleSheet entry only contributes `{alignItems, flexDirection, height:16, position:relative, width:35}` — no color, no border, no radius.

There is NO `ChargeStatus` StyleSheet in this module — the requested "ChargeStatus" glyph IS this MiniBattery module. **[UNRESOLVED: a separately-named `ChargeStatus` styles object was not found; if it exists it is a different component.]**

---

## 2. Does the battery BODY have a backgroundColor (not just borderColor)? — YES

Reconciles delta (b). From iOS render (main.decompiled.js:4571578–4571660), the inner "body" `<View>` inline style is:
```js
r19 = {};
r19['backgroundColor'] = r28;   // r28 = ThemeContext.pillBackgroundColor  (or customBackgroundColor if passed)
r19['borderColor']     = r9;    // r9  = r28  (non-Cybertruck) ; = Colors.secondaryTextDarkMode (Cybertruck only)
r19['borderWidth']     = r27;   // = customBorderWidth ?? 1
r19['borderRadius']    = r23;   // = customBorderRadius ?? 3
r19['width']           = r12;   // = customWidth ?? 35
r19['height']          = r10;   // = customHeight ?? 16
// style = [ styles.container , r19 ]
```
Android fn #117269 offsets 0x1f6–0x21b emit the identical inline keys onto `styles.container`:
`backgroundColor, borderColor, borderWidth, borderRadius, width, height`. **[both-match]**

- **backgroundColor token = `ThemeContext.pillBackgroundColor`.**
  - Standard **DARK** theme → `Colors.pillBackgroundDarkMode` = **`#2D2F34`** (iOS theme obj at :1338029/:1338214/:3348397 etc.; palette at :1338467).
  - Light theme → `Colors.pillBackgroundLightMode` = `#E4E4E4`.
- **borderColor token = same `pillBackgroundColor`** for the standard non-Cybertruck path → **`#2D2F34`** in dark theme. So the body's border and its fill are the SAME color; there is effectively no contrasting stroke — the body is a **solid `#2D2F34` rounded rect**, not a stroke around a transparent interior. Only on **Cybertruck** theme does borderColor differ: `Colors.secondaryTextDarkMode` = `#9B9B9B` (iOS :4571611; getBatteryColor :4571398).

This is the delta-(b) fix: the current render (stroke #2D2F34 around transparent) should be a **filled `#2D2F34` body** (backgroundColor), with the border the same color.

The CHARGE-LEVEL fill on top (see §3) has its OWN color = `getBatteryColor(...)`. For a normal, non-charging, non-actively-discharging cell in DARK theme this is `Colors.batteryNormalDark` = **`#8A8B8C`** (getBatteryColor DARK default branch, iOS :4571405 case 241). Other states: charging → `batteryCharging`/`batteryGreen` `#00E286`; discharging → `vehiclePowershareDischarging` `#00E286`; dischargingStoppedAutomatically → `rangeAnalysisGradientYellow` `#FF9F0A`; ≤warning(20%) → `batteryWarning` `#ffc107`; ≤critical(7%) → `batteryCritical` `#ff0000`.

---

## 3. The FILL's exact box + inset math — VERBATIM

Reconciles delta (a). From iOS render:

Inset constant (main.decompiled.js:4571633–4571635, case 356):
```js
r0  = r27 * r1;      // r27 = borderWidth (=1), r1 = 2   -> 2
r24 = r0 + r1;       // 2 + 2                              -> r24 = 4
```
=> **`inset (r24) = borderWidth*2 + 2 = 4`** (with borderWidth 1). Android confirms via the same `Mul`/`Add` then `Sub` for height (fn #117269: `Sub reg20 = reg10(16) - reg24`). **[both-match]**

Charge-fill `<View>` (the level bar), iOS :4571649–4571657:
```js
r19 = (isCybertruck ? styles.batteryLevelCt : styles.batteryLevel);   // base
r19b = {};
r19b['backgroundColor'] = r20;          // = getBatteryColor(...)  e.g. '#8A8B8C'
r19b['width']  = r22;                   // = Math.round((measuredWidth - r24) * getFillPercentage(level))
r20   = r10 - r24;                      // 16 - 4
r19b['height'] = r20;                   // = 12
// style = [ base , r19b ]
```
Fill width base (iOS :4571605–4571613, case 376/414):
```js
r4 = r26 - r24;                         // measuredWidth(onLayout) - 4
r0 = getFillPercentage(batteryLevelDec);
r22 = Math.round(r4 * r0);              // fill width in px
```
`getFillPercentage` (iOS :4571464): `level < 0.1 → 0.1` (floor), else `Math.min(level, 1)`.

**Resolved fill box (standard dark, borderWidth 1, height 16, width 35):**
- **height = `16 - (2*1 + 2)` = `12`**  (NOT 14 — this is the delta-(a) fix; current render used 16-2=14, which is wrong)
- **top:** from base style — `batteryLevel` has **no `top`** (auto); `batteryLevelCt` (Cybertruck) has `top: 1`. With height 12 in a 16-tall, `position:relative` container, the absolute fill (no top/bottom) sits at the content-box origin → ~2px slack below → visible top/bottom margin.
- **left = `1`** (from `batteryLevel`/`batteryLevelCt` base) — inside the 1px border → visible left margin.
- **width = `round((measuredWidth - 4) * pct)`** — at 100% and measuredWidth≈35 → 31px, leaving ~2px gap at the right before the inner border.
- **borderRadius on the fill = `1`** (`batteryLevel`) / `0` (`batteryLevelCt`), zIndex 1.

So YES there is a real inset: **the fill is height 12 at left:1, ~2px smaller than the 14px inner content height, giving the top/bottom/left margin the screenshot shows.** The current 35×16 render with a flush `height 14` fill is incorrect; correct is `height 12`, `left 1`, and the fill color layered over a solid `#2D2F34` body.

(There is also a secondary `usableBatteryLevel` overlay `<View>` — the blue `#0f52ba`, borderRadius 1, height 12, left = fill width, width = round((measuredWidth-4)*(batteryLevel-usableBattery)), zIndex 2 — only rendered when `usableBatteryLevelDec != null && > 0 && batteryLevelDec > usableBatteryLevelDec`, i.e. the reserved/limit segment. iOS :4571667–4571760.)

---

## 4. The NUB — reconciles delta (c)

iOS render :4571788–4571815 (rendered only when NOT Cybertruck):
```js
r6 = {};
r6['name']   = 'battery_nipple';        // an Icon glyph, NOT a plain View bar
r6['height'] = r10;                     // = 16  (full battery height)
r10 = 4 * r12;                          // 4 * width(35)
r10 = r10 / r11;                        // / 35   -> width = 4
r6['width']  = r10;                     // = 4
r6['color']  = r9;                      // = borderColor = pillBackgroundColor '#2D2F34' (dark)
// <Icon name="battery_nipple" height={16} width={4} color="#2D2F34" />
```
Android fn #117269 offsets 0x338–0x355: `name='battery_nipple'`, `height=reg10(16)`, `width = Mul 4 * reg12 (/reg11)`, `color=reg9`. **[both-match]**

The nub is a **vector Icon glyph** (`battery_nipple`), **height 16, width 4** (= `4*width/35`), colored the same `#2D2F34` as the body/border, laid out as the **second flex child** of `batteryContainer` (a row) — i.e. a small rounded tab immediately to the right of the body. This is the delta-(c) fix: it is NOT a detached bar; it is a 4×16 rounded icon abutting the body. It is **suppressed entirely on Cybertruck theme**.

Render tree (both platforms):
```
<View style={batteryContainer /* alignItems:center, flexDirection:row */}>
  <View style={[container, {backgroundColor:#2D2F34, borderColor:#2D2F34, borderWidth:1, borderRadius:3, width:35, height:16}]} onLayout=...>
     <View style={[batteryLevel, {backgroundColor:getBatteryColor(), width:round((W-4)*pct), height:12}]} />   // left:1
     {usableBatteryLevel overlay if applicable}
  </View>
  {!cybertruck && <Icon name="battery_nipple" height={16} width={4} color="#2D2F34" />}
</View>
```

---

## 5. Confirm size / border / radius on the STANDARD non-Cybertruck DARK path

Defaults read at the top of `MiniBatteryView` (iOS :4571534–4571556):
- `customHeight     ?? 16`  → **height 16**
- `customWidth      ?? 35`  → **width 35**
- `customBorderWidth?? 1`   → **borderWidth 1**
- `customBorderRadius?? 3`  → **borderRadius 3**
- `batteryBreakpointWarning ?? 20`, `batteryBreakpointCritical ?? 7`

The standard status-bar battery is rendered with **no custom props**, so it takes exactly **35×16, border 1, radius 3**. `MiniBatteryViewCt` (the wrapper at :4571092) also passes no custom dims. **[both-match]**

Two OTHER callers DO override (not the status battery):
- iOS :4839741 — `{customHeight:10, customWidth:24, customBorderWidth:0, customBorderRadius:1.4}` (a mini indicator).
- iOS :5097069 — `{customHeight:null, customWidth:null /* → 16/35 */, customBorderWidth:1.5, customBorderRadius:0}` (a charge-screen variant, square corners, 1.5 border).

The user's more-rounded official look is still radius **3** on the standard path — there is **no larger radius** on the standard iOS branch. `radius 3` on a 16px-tall body reads as fairly rounded; combined with the solid `#2D2F34` fill and the 12px inset charge bar, that is the correct appearance. The only branch that changes radius/border is the explicit custom-prop callers above, and Cybertruck (which changes borderColor to `#9B9B9B` and drops the nub, but keeps radius 3 / border 1 unless custom).

---

## Palette tokens referenced (iOS Colors, :1338467) — VERBATIM hex
- `pillBackgroundDarkMode`  = `#2D2F34`   (body bg + border, dark)
- `pillBackgroundLightMode` = `#E4E4E4`   (body bg + border, light)
- `batteryNormalDark`  = `#8A8B8C`   (fill, normal, dark)
- `batteryNormalLight` = `#F1F1F1`
- `batteryCharging` = `#00E286` ; `batteryGreen` = `#00E286`
- `vehiclePowershareDischarging` = `#00E286`
- `rangeAnalysisGradientYellow` = `#FF9F0A`
- `batteryWarning` = `#ffc107` ; `batteryCritical` = `#ff0000`
- `secondaryTextDarkMode` = `#9B9B9B`  (Cybertruck border / Cybertruck fill)
- `blue` = `#0f52ba`  (usableBatteryLevel reserved-segment overlay)
