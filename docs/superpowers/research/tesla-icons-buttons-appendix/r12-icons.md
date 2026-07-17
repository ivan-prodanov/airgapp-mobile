# R12 §1 — Tesla seat/steering-wheel climate icon artwork

Source: `/Users/ivan/Downloads/tesla-haptics-work/main.decompiled.js` (iOS v4.56). All facts **[iOS-verified]** unless tagged.
Method: read unfiltered; every `d=`/`fill` below is VERBATIM from the bundle.

---

## 0. ⚠️ THE BRIEF'S PREMISE IS WRONG — READ THIS FIRST

> Brief §1 WHY: *"Theirs (`seat_climate_0`) is a red seat glyph with NO waves in the artwork — reads OFF while still red."*

**False.** There is no seat body anywhere in the seat_climate artwork. Tesla's `seat_climate_*` icons are
**exactly what our marker already is: three heat waves and nothing else.** Verified by reading modules
3356/3358/3360/3362 unfiltered AND by rasterising the reconstructed SVGs (see §7).

Tesla solves "red at level 0" **not with a seat body**, but by **baking the OFF grey into the level-0 asset**:

| level | wave 1 (left) | wave 2 | wave 3 (right) |
|---|---|---|---|
| `seat_climate_0` | `#999999` | `#999999` | `#999999` |
| `seat_climate_1` | `currentColor` | `#999999` | `#999999` |
| `seat_climate_2` | `currentColor` | `currentColor` | `#999999` |
| `seat_climate_3` | `currentColor` | `currentColor` | `currentColor` |

`seat_climate_0` **contains no `currentColor` at all** ⇒ the tint passed to it has **zero visual effect**.
That is why R10 §3c found the seat glyph "never uses the Off token": the off colour is *inside the asset*,
not in the theme lookup. `SeatHeaterControlButton` unconditionally passes `iconStyle.color =
buttonHeaterOn (#FF3A3A)` or `buttonCoolerOn (#3E6BE2)` — **never** `buttonHeaterOff` (@3987500-3987700,
case 1789/1797/1803) — and level 0 still renders grey, because the asset ignores the prop.

**Implication for us:** we do not need new artwork. Our wave-fill marker is already Tesla's design.
The fix is a **per-wave two-colour split**: N waves at the heat/cool tint, 3−N waves at `#999999`.
`buttonHeaterOff` is not "a token with no valid value for our design" — it is the value of the
*unlit waves*, at every level, including level 0. One path cannot be tinted per level; you need
(at minimum) two paths — lit and unlit — per level. That is exactly how Tesla ships it.

---

## 1. Resolution chain (all re-verified, not inherited)

- `IconName` plain-string enum: `seat_climate_0..3` @ **1433803-1433810**; `steering_wheel_heater_off/low/high`
  @ **1433883-1433888**; `yoke_heater_off/low/high` @ **1434117-1434122**; `squircle_heater_off/low/high`
  @ **1434127-1434132**. (`'yoke'` @1434115 and `'squircle'` @1433868 are separate unrelated icons.)
- Lazy registry = module **2676**, registered @ **1445560**, deps array @ **1445561** (`len == 792`, confirmed).
- Registry entry shape (VERBATIM, @1442176-1442285) — key set *before* the variant object:
  ```js
  r7 = r5.seat_climate_0;   // key
  r6 = {};
  r6['default']    = () => require(deps[568]).default;
  r6['cybertruck'] = () => require(deps[569]).default;
  ```
- deps[566..577] resolved by indexing the real array: `566→3354, 567→3355, 568→3356, 569→3357,
  570→3358, 571→3359, 572→3360, 573→3361, 574→3362, 575→3363, 576→3364, 577→3365`.

| IconName | default module | cybertruck module |
|---|---|---|
| `seat_climate_0` | **3356** (@1591232-1591422) | 3357 (@1591424-1591620) |
| `seat_climate_1` | **3358** (@1591622-1591818) | 3359 (@1591820-1592021) |
| `seat_climate_2` | **3360** (@1592023-1592219) | 3361 (@1592221-1592422) |
| `seat_climate_3` | **3362** (@1592424-1592613) | 3363 (@1592615-1592811) |
| `steering_wheel_heater_off` | **3414** (@~1602914-1602964) | — none — |
| `steering_wheel_heater_low` | **3415** (@~1603117-1603167) | — none — |
| `steering_wheel_heater_high` | **3416** (@~1603315-1603365) | — none — |
| `yoke_heater_off` | **3546** (@~1629499-1629549) | — none — |
| `yoke_heater_low` | **3547** (@~1629702-1629752) | — none — |
| `yoke_heater_high` | **3548** (@~1629893-1629943) | — none — |
| `squircle_heater_off` | **3553** (@~1630921-1630971) | — none — |
| `squircle_heater_low` | **3554** (@~1631124-1631174) | — none — |
| `squircle_heater_high` | **3555** (@~1631327-1631377) | — none — |

**⚠️ Correction to recon:** the brief says "**Every** icon has a `default` AND a `cybertruck` variant."
Not true. The 9 steering-wheel icons have **`default` only**. Cybertruck gets its own wheel via the
`SQUIRCLE` branch of `SteeringWheelType` (§4), not via the `cybertruck` theme variant.

---

## 2. §1 — VECTOR, not raster

**All 17 assets are `react-native-svg` `<Path>` components.** No PNG `require`, no `.car` catalog, no image
files. Same pattern as `battery_nipple` (R4 §1d). Every module body is literally:

```js
r1 = function(a0) {   // Original name: SvgComponent
    ...
    r0 = {'d': '…', 'fill': '#999999', 'fillOpacity': 1};
    r0 = jsx(Path, r0);
    r5['children'] = r0;
    r4 = {'width': 30, 'height': 30, 'viewBox': '0 0 30 30', 'fill': 'none', 'xmlns': 'http://www.w3.org/2000/svg'};
    r0 = Object.assign(r4, a0, r5);     // ← defaults, then PROPS, then children
    return jsx(Svg, r0);
};
r2['default'] = r1;
```

Note `Object.assign(defaults, props, children)`: **props override `width`/`height`/`fill`**, and `children`
always wins. Single `jsx` when there is one path; `jsxs` + `new Array(n)` when there are several.

### 2a. `seat_climate_*` **default** variant — `viewBox="0 0 30 30"`, `width=30 height=30`, `fill="none"`

Three waves, one per column, left→right at x≈6 / x≈14 / x≈22. Wave sub-paths (VERBATIM, named here for reuse):

- **W1** (x≈6): `M7.972 7.972a1.375 1.375 0 1 0-1.944-1.944l1.944 1.944ZM6.028 22.028a1.375 1.375 0 0 0 1.944 1.944l-1.944-1.944ZM6.3 7.7l-.972-.972.972.972Zm0 6.6-.972.972.972-.972Zm-.272-8.272-.7.7 1.944 1.944.7-.7-1.944-1.944Zm-.7 9.244 1.4 1.4 1.944-1.944-1.4-1.4-1.944 1.944Zm1.4 6.056-.7.7 1.944 1.944.7-.7-1.944-1.944Zm0-4.656a3.292 3.292 0 0 1 0 4.656l1.944 1.944a6.042 6.042 0 0 0 0-8.544l-1.944 1.944Zm-1.4-9.944a6.042 6.042 0 0 0 0 8.544l1.944-1.944a3.292 3.292 0 0 1 0-4.656L5.328 6.728Z`
- **W2** (x≈14): `M15.972 7.972a1.375 1.375 0 0 0-1.944-1.944l1.944 1.944Zm-1.944 14.056a1.375 1.375 0 0 0 1.944 1.944l-1.944-1.944ZM14.3 7.7l-.972-.972.972.972Zm0 6.6-.972.972.972-.972Zm-.272-8.272-.7.7 1.944 1.944.7-.7-1.944-1.944Zm-.7 9.244 1.4 1.4 1.944-1.944-1.4-1.4-1.944 1.944Zm1.4 6.056-.7.7 1.944 1.944.7-.7-1.944-1.944Zm0-4.656a3.292 3.292 0 0 1 0 4.656l1.944 1.944a6.042 6.042 0 0 0 0-8.544l-1.944 1.944Zm-1.4-9.944a6.042 6.042 0 0 0 0 8.544l1.944-1.944a3.292 3.292 0 0 1 0-4.656l-1.944-1.944Z`
- **W3** (x≈22): `M23.972 7.972a1.375 1.375 0 0 0-1.944-1.944l1.944 1.944Zm-1.944 14.056a1.375 1.375 0 0 0 1.944 1.944l-1.944-1.944ZM22.3 7.7l-.972-.972.972.972Zm0 6.6-.972.972.972-.972Zm-.272-8.272-.7.7 1.944 1.944.7-.7-1.944-1.944Zm-.7 9.244 1.4 1.4 1.944-1.944-1.4-1.4-1.944 1.944Zm1.4 6.056-.7.7 1.944 1.944.7-.7-1.944-1.944Zm0-4.656a3.292 3.292 0 0 1 0 4.656l1.944 1.944a6.042 6.042 0 0 0 0-8.544l-1.944 1.944Zm-1.4-9.944a6.042 6.042 0 0 0 0 8.544l1.944-1.944a3.292 3.292 0 0 1 0-4.656l-1.944-1.944Z`

Element order and attrs, per level:

| module | children | Path[0] | Path[1] |
|---|---|---|---|
| 3356 `_0` | `jsx`, 1 child | `d=W1+W2+W3` `fill='#999999'` `fillOpacity=1` | — |
| 3358 `_1` | `jsxs`, `Array(2)` | `d=W1` `fill='currentColor'` | `d=W2+W3` `fill='#999999'` `fillOpacity=1` |
| 3360 `_2` | `jsxs`, `Array(2)` | `d=W1+W2` `fill='currentColor'` | `d=W3` `fill='#999999'` `fillOpacity=1` |
| 3362 `_3` | `jsx`, 1 child | `d=W1+W2+W3` `fill='currentColor'` | — |

No `fillRule`/`clipRule`/`opacity` on any of these four. The lit path is always **first**.
Waves light **left → right**.

### 2b. `seat_climate_*` **cybertruck** variant — `viewBox="0 0 24 24"`, `width=24 height=24`, `fill="none"`

**Different artwork** — sharp zigzag chevrons, not the round waves; grey is `#898989` (not `#999999`);
and there is an extra **stroked backdrop path drawn first, always `#898989`, in all four levels**:

- **CT_STROKE** (Path[0] in ALL four; `stroke='#898989'` `strokeWidth=2` `strokeLinecap='square'`, no fill):
  `M17.783 6 16.25 8.875l3.067 5.75-1.534 2.875M12.033 6 10.5 8.875l3.066 5.75-1.533 2.875M6.283 6 4.75 8.875l3.067 5.75L6.283 17.5`
- **C3** (right, x≈19): `m19.136 5.588-1.753 3.287 3.067 5.75-2.255 4.228-1.765-.941 1.753-3.287-3.066-5.75 2.255-4.228 1.764.941Z`
- **C2** (middle, x≈13): `M13.386 5.588l-1.753 3.287 3.067 5.75-2.255 4.228-1.765-.941 1.753-3.287-3.066-5.75 2.254-4.228 1.765.941Z`
  — ⚠️ appears as **`m13.386 …`** (lowercase, relative) when it is the *first* sub-path of a `d` (module 3361), and as
  **`M13.386 …`** (uppercase) when concatenated after C3 (modules 3357, 3359, 3363). Both forms are in the bundle verbatim; the files reproduce each exactly as read.
- **C1** (left, x≈7): `M7.636 5.588 5.883 8.875l3.067 5.75-2.255 4.228-1.765-.941 1.753-3.287-3.066-5.75 2.255-4.228 1.764.941Z`

All non-stroke paths carry `fillRule='evenodd'` `clipRule='evenodd'`.

| module | children | Path[0] | Path[1] | Path[2] |
|---|---|---|---|---|
| 3357 `_0` | `jsxs`, `Array(2)` | CT_STROKE | `d=C3+C2+C1` `fill='#898989'` | — |
| 3359 `_1` | `jsxs`, `Array(3)` | CT_STROKE | `d=C3+C2` `fill='#898989'` | `d=C1` `fill='currentColor'` |
| 3361 `_2` | `jsxs`, `Array(3)` | CT_STROKE | `d=C3` `fill='#898989'` | `d=C2+C1` `fill='currentColor'` |
| 3363 `_3` | `jsxs`, `Array(2)` | CT_STROKE | `d=C3+C2+C1` `fill='currentColor'` | — |

Here the **unlit** path comes first and the lit path last (opposite of the default variant). Lights left→right.
`seat_climate_0.cybertruck` likewise contains **no `currentColor`**.

---

## 3. §2 — Do heating and cooling share artwork? **YES — literally the same four IconNames.**

Read both fns unfiltered:

- `seatCoolingIcon` (fn #97707) @ **3987813-3987893**: switches on `ClimateState.SeatCoolingLevel_E`
  (`SEATCOOLINGLEVELOFF/LOW/MED/HIGH`) and returns `IconName.seat_climate_0 / _1 / _2 / _3` respectively;
  falls through to `return undefined` (`r2`) at case 173 for any other value.
- `seatHeatingIcon` (fn #97708) @ **3987895-3987975**: identical body over `ClimateState.SeatHeaterLevel_E`
  (`SEATHEATERLEVELOFF/LOW/MED/HIGH`) → the same `seat_climate_0.._3`.

There are **no `seat_cool_*` IconName entries** — nothing to extract separately. R10 §3c is confirmed and
is stronger than "structurally identical": the returned constants are byte-identical.

Selector `getSeatClimateIcon(a0, a1, a2, a3)` (fn #97709) @ **3987977-3988015**, VERBATIM logic:
```
if (a0 && a1 === true && a2 > SeatCoolingLevel_E.SEATCOOLINGLEVELOFF)
      return seatCoolingIcon(a2);              // cooling wins
else  return (a3 == null) ? undefined : seatHeatingIcon(a3);
```
⇒ **Cooling and heating differ only in the tint** (`buttonCoolerOn #3E6BE2` vs `buttonHeaterOn #FF3A3A`),
never in the glyph. Confirmed at the callsite (@3987789-3987803): `iconStyle = {color: buttonHeaterOn}`
unless the cooling branch, then `{color: buttonCoolerOn}`.

---

## 4. §3 — Steering wheel: 9 icons, 3 wheel types × 3 levels, + how the yoke is selected

`getSteeringWheelIconNameFromHeaterLevel(level, steeringWheelType)` — fn #97710 @ **3988017-3988245**.

**Level enum is NOT 0–3 = off/low/med/high.** Read verbatim @ **709977**:
```js
r5 = {'STWHEATLEVEL_UNKNOWN': 0, 'STWHEATLEVEL_OFF': 1, 'STWHEATLEVEL_LOW': 2, 'STWHEATLEVEL_HIGH': 3};
r6['StwHeatLevel'] = r5;
```
Dispatch (Hermes `if(!(r0 !== r1))` ≡ `if (r0 === r1)`): level **0 → ip 44** and level **1 → ip 44** (same
branch, i.e. UNKNOWN and OFF share the OFF icon); level **2 → ip 232**; level **3 → ip 420**; else → ip 602
→ `return undefined`. **So the wheel has only THREE visual states — off / low / high. There is no
level-3-of-3 wheel icon and no `steering_wheel_heater_med`.**

`SteeringWheelType` (dep 33) branches, per level:

| `SteeringWheelType` | level 0/1 (UNKNOWN/OFF) | level 2 (LOW) | level 3 (HIGH) |
|---|---|---|---|
| `TYPE_NOT_SET` | `steering_wheel_heater_off` (ip 878) | `steering_wheel_heater_low` (ip 776) | `steering_wheel_heater_high` (ip 674) |
| `UNKNOWN` | `steering_wheel_heater_off` | `steering_wheel_heater_low` | `steering_wheel_heater_high` |
| `ROUND` | `steering_wheel_heater_off` | `steering_wheel_heater_low` | `steering_wheel_heater_high` |
| **`YOKE`** | `yoke_heater_off` (ip 844) | `yoke_heater_low` (ip 742) | `yoke_heater_high` (ip 640) |
| **`SQUIRCLE`** | `squircle_heater_off` (ip 810) | `squircle_heater_low` (ip 708) | `squircle_heater_high` (ip 606) |
| anything else | `undefined` (ip 602) | `undefined` | `undefined` |

**How Tesla selects the yoke** — `SteeringWheelHeaterControlButton` (fn #97711) @ **3988249**+, VERBATIM @3988376:
```js
r5 = r5.getSteeringwheelType;          // ← note lowercase 'w'
r25 = useTypedSelector(getSteeringwheelType);
```
i.e. a **redux selector off vehicle config** (`getSteeringwheelType`), *not* a prop and *not* the app theme.
Level comes from `getSteeringWheelHeaterLevel(...)` (@3988400) when
`vehicleSupportsAutoAndLevelSteeringWheelHeat` is true, else defaults to `StwHeatLevel.STWHEATLEVEL_HIGH`
(@3988392 — `_closure2_slot9 = STWHEATLEVEL_HIGH`, i.e. a binary on/off wheel renders the HIGH glyph when on).

**Our `steeringWheelType: 'round' | 'yoke'` maps onto `ROUND` / `YOKE`. `SQUIRCLE` is Cybertruck's — we have
no equivalent value. [UNRESOLVED: whether our app must model SQUIRCLE at all.]**

⚠️ The TDS registry's `icon-steering-wheel-yoke` (@1128632) is a **different, unrelated** asset —
it is a plain `steering-wheel` glyph with a `variant:'yoke'` in the *TDS* icon set, and it plays **no part**
in the heater-button path. The heater button goes `IconName.yoke_heater_*` → registry 2676 → modules 3546-3548.
Do not confuse the two registries.

### 4a. Wheel artwork — all `viewBox="0 0 24 24"`, `width=24 height=24`, `fill="none"`

Unlike the seats, **the wheel icons DO contain a body**: a wheel/yoke/squircle rim plus **two** heat squiggles
above it. All three types are the same anatomy: `squiggle-left`, `squiggle-right`, `body`.

**ROUND** (`SW_BODY` carries `fillRule='evenodd' clipRule='evenodd'`; the squiggle paths do not):

| module | children | Path[0] | Path[1] | Path[2] |
|---|---|---|---|---|
| 3414 `off` | `jsxs`, `Array(2)` | `d=SW_BODY` `fill='#999999'` `fillOpacity=1` (evenodd) | `d=SW_S1+SW_S2` `fill='#999999'` `fillOpacity=1` | — |
| 3415 `low` | `jsxs`, `Array(3)` | `d=SW_BODY` `fill='currentColor'` (evenodd) | `d=SW_S1` `fill='currentColor'` | `d=SW_S2` `fill='#999999'` `fillOpacity=1` |
| 3416 `high` | `jsxs`, `Array(2)` | `d=SW_BODY` `fill='currentColor'` (evenodd) | `d=SW_S1+SW_S2` `fill='currentColor'` | — |

**YOKE** (no `fillRule` on any path):

| module | children | Path[0] | Path[1] | Path[2] |
|---|---|---|---|---|
| 3546 `off` | `jsx`, 1 child | `d=Y_S1+Y_S2+Y_BODY` `fill='#999999'` `fillOpacity=1` | — | — |
| 3547 `low` | `jsxs`, `Array(3)` | `d=Y_S1` `fill='currentColor'` | `d=Y_S2` `fill='#999999'` `fillOpacity=1` | `d=Y_BODY` `fill='currentColor'` |
| 3548 `high` | `jsx`, 1 child | `d=Y_S1+Y_S2+Y_BODY` `fill='currentColor'` | — | — |

**SQUIRCLE** (all paths `fillRule='evenodd' clipRule='evenodd'`; grey is `#898989`, the CT grey — consistent
with SQUIRCLE being the Cybertruck wheel; **note the paint order is right-squiggle, left-squiggle, body**):

| module | children | Path[0] (`Q_S2`, right) | Path[1] (`Q_S1`, left) | Path[2] (`Q_BODY`) |
|---|---|---|---|---|
| 3553 `off` | `jsxs`, `Array(3)` | `fill='#898989'` | `fill='#898989'` | `fill='#898989'` |
| 3554 `low` | `jsxs`, `Array(3)` | `fill='#898989'` | `fill='currentColor'` | `fill='currentColor'` |
| 3555 `high` | `jsxs`, `Array(3)` | `fill='currentColor'` | `fill='currentColor'` | `fill='currentColor'` |

**Every `*_heater_off` module (3414, 3546, 3553) contains no `currentColor` whatsoever** — including the body.
So the wheel's OFF state is also fully baked. ⚠️ This **narrows R10 §3e's claim** that "the steering wheel
*does* use the Off token": the button *does* pass `iconStyle.color = buttonHeaterOff` (@3988343-3988346,
`r7['color'] = r17.buttonHeaterOff`), but the OFF artwork has nothing bound to it, so it is **inert**.
The visible grey comes from the asset, and `buttonHeaterOff (#999999)` happens to equal it — the theme value
and the baked constant are duplicated, not linked. **CT's `#898989` off-token likewise duplicates the
`#898989` baked into 3357/3359/3361/3363 and 3553-3555.**
Verbatim `d` for SW_BODY / SW_S1 / SW_S2 / Y_S1 / Y_S2 / Y_BODY / Q_S1 / Q_S2 / Q_BODY is in the written
`.svg` files (§6) — each was copied byte-for-byte from the bundle.

---

## 5. §4 + §5 — Tint mechanism and render box

**§4 — How the artwork takes the tint. It is `currentColor`, delivered as a PROP, not a mask.**

Chain, read unfiltered:
1. `SeatHeaterControlButton` (@3986555) builds `props.iconStyle = {color: <token>}` and renders `<ControlButton iconName={getSeatClimateIcon(…)} iconStyle={{color}} …/>` (@3987640-3987810).
2. `ControlButtonComponent` (@3991976) reads `r17 = r9.iconStyle` (@3991986) and renders `<NamedIcon name={iconName} {…} {…iconStyle-derived} />` (@3992195-3992208). **It passes no `size`/`width`/`height`.**
3. `NamedIconViewComponent` (@1432707) → `findIconByIconName(name, theme === AppTheme.CYBERTRUCK)` (@1432730-1432752). **⇒ the `cybertruck` variant is chosen iff the app theme is CYBERTRUCK — nothing else.**
4. `CommonIconViewComponent` (@1432760) → `jsx(iconComp, Object.assign({}, themedStyle, r13))` (@1432900-1432905), wrapped in an `Animated.View` with `transform:[{scaleX: shouldIconFlip ? -1 : 1}]`.
5. The SvgComponent does `Object.assign({width,height,viewBox,fill:'none',xmlns}, props, {children})` ⇒ `color` lands as a **prop on `<Svg>`**, and react-native-svg resolves every `fill:'currentColor'` beneath it.

Answers to §4 as asked:
- **Not a single-colour mask** (nothing like `mini_spinner.png`'s alpha ramp). It is **multi-path, two-colour** vector art: a `currentColor` layer + a hard-coded-grey layer.
- **Seat body vs waves:** there **is no body**. The three waves are the whole glyph, and they are split across **two paths by lit/unlit**, not by shape. Level is the asset; the split is per-level.
- **Can one path be tinted per-level? No.** Per level you need one `currentColor` path and one grey path
  (levels 0 and 3 collapse to a single path only because the split is empty on one side). The CT variant
  needs a third, always-grey stroked backdrop path.
- `shouldIconFlip` (@1432599) is gated on `I18nManager.isRTL` **and** membership in `NavigationIconNames`
  — irrelevant to seat/wheel icons; LTR ⇒ `scaleX: 1`. [INFERRED that seat/wheel are absent from
  `NavigationIconNames`; I read the RTL gate but did not enumerate that list.]

**§5 — Render box.**
- `SEAT_HEATER_BUTTON_SIZE = 55` **CONFIRMED VERBATIM** @ **3980312-3980313** (`r3 = 55; r2['SEAT_HEATER_BUTTON_SIZE'] = r3;`). The site at 3980238 is only the `exports[…] = undefined` pre-declaration stub, not a second value.
- It is the **BUTTON box**, used for centring: the sole consumer @ **5227006-5227019** does
  `r3 = SEAT_HEATER_BUTTON_SIZE / 2; style = {position:'absolute', left: horizontal - r3, top: vertical - r3 + offset}`.
  i.e. it half-offsets the button onto a seat coordinate. **It is never applied to the icon.**
- **The ICON has no size prop anywhere in the chain** ⇒ it renders at its **intrinsic** size:
  **30×30 for `seat_climate_*` default, 24×24 for `seat_climate_*.cybertruck` and for all 9 wheel icons.**
- ⇒ **Icon padding inside the 55pt button = (55 − 30)/2 = 12.5pt** per side (default theme);
  (55 − 24)/2 = 15.5pt under the Cybertruck theme. [INFERRED from centring — I read that no size prop is
  passed and that the button is 55, but did not find an explicit padding literal.]
- Disabled ⇒ container `opacity 0.5` (R10) — the icon `opacity` I found in `ControlButtonComponent`
  (@3992066) is on a **`backgroundColor: Colors.blue` overlay**, a different element. Not re-verified here.

**§6 — Paint dependence: NO.**
`isLightColorFor` is defined @ **500287** and exported @ **500442**; it has **exactly ONE callsite in the whole
bundle**, @ **1240094** (`grep -n isLightColorFor` ⇒ 3 hits: def, export, callsite). That callsite sits inside
a fn that first checks `CarType.CARTYPECYBERTRUCK` and returns `false` for CT, else
`isLightColorFor(<paint>)`. **R10 §3e re-confirmed: Controls-only, and nothing in the seat or steering-wheel
icon path touches it.** The seat/wheel tint is purely a function of heat/cool level + theme tokens; **no
paint dependence, unlike the frunk label (R10 §2c).**

---

## 6. Files written (all 17 verified to parse as XML and to rasterise correctly)

Directory: `/Users/ivan/Work/airgapp/mobile/docs/superpowers/research/tesla-status-assets/climate-icons/`

```
seat_climate_0.svg                  seat_climate_0.cybertruck.svg
seat_climate_1.svg                  seat_climate_1.cybertruck.svg
seat_climate_2.svg                  seat_climate_2.cybertruck.svg
seat_climate_3.svg                  seat_climate_3.cybertruck.svg
steering_wheel_heater_off.svg       yoke_heater_off.svg      squircle_heater_off.svg
steering_wheel_heater_low.svg       yoke_heater_low.svg      squircle_heater_low.svg
steering_wheel_heater_high.svg      yoke_heater_high.svg     squircle_heater_high.svg
```

Each reproduces the bundle's `viewBox`, `width`/`height`, `fill="none"`, element order, and every
`d`/`fill`/`fillRule`/`clipRule`/`fillOpacity`/`stroke`/`strokeWidth`/`strokeLinecap` verbatim
(JSX camelCase → SVG kebab-case: `fillRule`→`fill-rule` etc.). `currentColor` is preserved as-is, so
setting CSS/SVG `color` on the root tints exactly the lit paths — same contract as the app.

---

## 7. Verification performed (not assumed)

- Every `d=` above was read from `main.decompiled.js`, never inferred from adjacency.
- deps[568..575] resolved by **parsing the real 792-entry array** and indexing it, not by counting.
- The registry parser was validated against the known-good `seat_climate_*` → 3356-3363 ground truth
  before its `steering_wheel/yoke/squircle` → 3414-3416/3546-3548/3553-3555 output was trusted.
- All 17 written SVGs parse under `xml.dom.minidom`.
- All 17 were **rasterised** (`currentColor` → `#FF3A3A`, on a dark ground) and inspected. The render
  confirms, visually: `seat_climate_0` = 3 grey waves and no seat body; `_1` = 1 red + 2 grey; `_2` = 2 red
  + 1 grey; `_3` = 3 red; wheels = rim + 2 squiggles, off all-grey, low = rim + 1 squiggle red, high all red.
  Sheet: `…/scratchpad/render/sheet.html.png`.

## 8. Gaps / UNRESOLVED
- Whether `seat_climate_*` appears in `NavigationIconNames` (RTL flip list) — not enumerated; irrelevant for LTR.
- Whether our app needs a `SQUIRCLE` steering-wheel type at all (product question, not recoverable from the bundle).
- Android v4.58 (`bundle.hasm`) not cross-checked — all findings are **[iOS-verified]** on v4.56, which is what we ship.
- Icon padding within the 55pt button is **[INFERRED]** from centring arithmetic; no explicit padding literal was found.
