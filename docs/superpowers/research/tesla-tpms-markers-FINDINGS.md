# Tesla TPMS markers — recovered layout and type spec

**Date:** 2026-07-27
**Source:** `~/Downloads/tesla-haptics-work/main.jsbundle` (Tesla iOS v4.56), decompiled with
`~/.local/bin/hbc-decompiler` (403 MB output, deleted after extraction — re-run the decompiler to
reproduce; it takes ~90s).
**Method:** verbatim literal dump. Every number below is read off an assignment in the decompiled
bytecode. Nothing here is measured from a screenshot and nothing is inferred by adjacency.

---

## 0. Why this exists

The first implementation of `TirePressureOverlay.tsx` guessed the layout from a side-by-side
screenshot. It got **three things wrong at once**, and only one of them was visible enough to
guess at:

| | guessed | actual |
|---|---|---|
| horizontal margin | 16 | **5** |
| font size | 18 | **14** |
| front-vs-rear vertical offset | same for both (−10) | **−20 front, −10 rear** |

The third would never have come out of squinting: the rear labels matched the reference exactly
while the fronts sat 10pt low, which reads as "close enough" rather than as a bug. Recovering the
constants took less time than the screenshot comparison did.

The font size is the instructive one. It was not invented — it was borrowed from
`MarkerOverlay.label`, whose 18 was itself correctly recovered (R12 §2) for the frunk/trunk marker
**Buttons**. But that 18 comes from `styles.textColorGray`, a per-call-site override those buttons
apply. The tyre labels don't apply it, so they land on the unmodified category default of 14.
**Reusing an "already matched" style is only safe when both call sites resolve the same way.**

---

## 1. `TpmsMarkers` — positioning (module **8716**, the Controls module)

Decompiled at `main.decompiled.js:4037659`. Container style for each of the four labels is
`[{<pin>}, styles.tpms]`, verbatim:

```js
// front left                              // front right
{ left: 5,  top: (vertical ?? 0) + -20 }   { right: 5, top: (vertical ?? 0) + -20 }
// rear left                               // rear right
{ left: 5,  top: (vertical ?? 0) + -10 }   { right: 5, top: (vertical ?? 0) + -10 }
```

`vertical` comes from `getButtonPosition(marker)` @4037382, which is just
`{horizontal: marker[0], vertical: marker[1]}` over the renderer's own wheel anchors —

```js
useTpmsState: wheel_1_1 → FL,  wheel_1_2 → FR,  wheel_2_1 → RL,  wheel_2_2 → RR
```

— the same four markers we already emit. So **only the vertical position tracks the car**; the
horizontal is a flat screen-margin pin, independent of how wide the model renders.

`top` is the top edge of a content-sized box (no height is set), so with `lineHeight: 20` the front
pair's text occupies `[v−20, v]` and the rear pair's `[v−10, v+10]`. The front label therefore sits
a full 10pt higher **relative to its own wheel** than the rear one.

### Styles, from the module's StyleSheet @4041160

```js
tpms        = { alignContent: 'center', alignItems: 'center', position: 'absolute' }
tpmsButton  = { marginRight: 10, marginTop: 10 }
tpmsRcpText = { textAlign: 'center' }
tpmsRcpView = { alignContent: 'center', alignItems: 'center', marginTop: -20 }
```

> `marginTop` appears in the dump as `4294967276` — that is −20 as an unsigned 32-bit int.

`tpmsRcpView`'s −20 is relative to *their* header composition (the RCP line is a sibling after the
header, not a child of a title stack) and does **not** transfer to ours.

### Gating

```js
if (!showTpms) return null;
if (tpmsStatus == null) return null;
if (!supportsLastSeenTpms) return null;    // <- the whole marker set, not just the age line
```

---

## 2. `TpmsPressure` — the label itself (module **8717**)

Decompiled at `main.decompiled.js:4041508`. Shape, verbatim:

```jsx
<View style={styles.container}>            {/* {alignContent:'center', alignItems:'center'} */}
  <Text category="bodyLabel" style={{color: <see below>}}>
    {valueText}{unitSuffix}
  </Text>
  <Text category="p3" contrast="low" style={styles.tpmsLastSeenTime}>
    {relativeAge}
  </Text>
</View>
```

- **Value:** bar → `value.toFixed(1)`; psi → `convertBarToPsi(value).toFixed(0)`.
- **Missing value:** the literal `'--'` (two hyphens). Not an em dash.
- **Unit suffix:** `' bar'` / `' psi'`, with a leading space, appended as a second child.
- **Colour:** `hard_warning === true` → `theme.textColorError`; else `soft_warning === true` →
  `theme.textColorWarning`; else `theme.textColor`. **Hard wins, and the two warnings are
  different colours.**
- **Second line:** a relative "last seen" age, rendered only when
  `tpms_last_seen_pressure_time.getSeconds() > 0`. Style `{maxWidth: 7 * Gutter, textAlign:
  'center'}`. There is a `fixTpmsAge` helper that backdates anything under 45 000 ms by 45 s, so a
  fresh reading never renders as "in a few seconds".
  **We do not plumb this field — the age line is absent from our overlay.**

---

## 3. Typography (module 2454 @1339762, the non-Cybertruck `Typography`)

```js
BodyLabel     = { type:'Medium', prefix: TEXT, fontSize: 14, lineHeight: 20, letterSpacing: 0.1 }
CaptionLabel  = { type:'Medium', prefix: TEXT, fontSize: 12, lineHeight: 16, letterSpacing: 0.1 }
P3            = { type:'Medium', prefix: TEXT, fontSize: 10, lineHeight: 16, letterSpacing: 0   }
Body          = { type:'Regular',prefix: TEXT, fontSize: 14, lineHeight: 20, letterSpacing: -0.1 }
```

`type: 'Medium'` + `prefix: TEXT` resolves to the PostScript name `UniversalSansText-Medium`,
which we already ship. No `fontWeight` on any of these — the weight is the cut.

> Note: `_closure1_slot13` is **Cybertruck**Typography and `_closure1_slot14` is the regular one.
> `toThemedTextStyle` branches `appTheme === CYBERTRUCK ? slot13 : slot14`. Easy to read backwards.

---

## 4. Theme colours (module 2447 @1337947–1338135, the block whose `theme` key is `DARK`)

```js
textColor        = '#F3F3F3'     // not pure white
textColorLight   = '#8A8B8B'     // the RCP subtitle
textColorError   = '#FF3A3A'     // hard warning
textColorWarning = '#DAA300'     // soft warning
```

---

## 5. The RCP string (module **8718**, `useVehicleTpmsRcpText` @4041553)

Two formats, chosen on whether the placard values differ:

```js
front === rear:  `${tr('vehicle_controls_tpms_rcp')}: ${v}${unit}`
front !== rear:  `${tr('vehicle_controls_tpms_rcp')}:\n` +
                 `${tr('vehicle_controls_tpms_front')} ${fv}${unit}, ` +
                 `${tr('vehicle_controls_tpms_rear')} ${rv}${unit}`
```

Either value may be `'--'`. This matches what `src/ble/tirePressureText.ts` already does.

Rendered as `<Text category={TextCategory.CaptionLabel} style={[tpmsRcpText, {color:
theme.textColorLight}]}>` — i.e. **12/16/0.1 in #8A8B8B**, centred. Ours was 13pt in the system
font at `rgba(255,255,255,0.6)`; fixed in the same pass.

---

## 6. Applied

`src/godot/TirePressureOverlay.tsx` and `src/app/index.tsx` (`styles.subtitle`) now carry §1–§4
verbatim. Not applied: the last-seen age line (§2), which needs
`TirePressureState.tpms_last_seen_pressure_time_*` plumbed through telemetry first.
