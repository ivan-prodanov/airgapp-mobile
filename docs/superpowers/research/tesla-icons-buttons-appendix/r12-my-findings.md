# R12 — my independent extraction (iOS main.decompiled.js v4.56)

## 🚨 R10 §3b's HEADLINE IS WRONG — and this is exactly why the user rejected it.
R10 §3b: *"seats are `buttonHeaterOn` **#FF3A3A at every level including OFF**; they never grey out."*
**FALSE.** `seat_climate_0`'s artwork is **100% hardcoded `#999999`** and contains **no `currentColor` path at all** —
so at level 0 the seat renders **GREY**, no matter that `iconStyle.color` is `#FF3A3A`. The tint token IS always
`buttonHeaterOn`, but the ARTWORK overrides it. R10 read the tint predicate and never opened the assets.
**The grey the team has been hand-tuning (`rgba(235,235,235,0.92)`) IS in Tesla's palette: `#999999` = `buttonHeaterOff`.**
It was invisible because it lives **inside the SVG**, not in the theme lookup.

## THE ICONS ARE `react-native-svg` `<Path>` COMPONENTS — no image files needed (the battery_nipple pattern, R4 §1d).
Lazy registry = **module 2676** (registered iOS 1445560, deps @1445561, 792 entries). Per icon:
```js
r7 = r5.seat_climate_0;
r6['default']    = () => require(deps[568]).default;
r6['cybertruck'] = () => require(deps[569]).default;
defineProperty(target, r7, r6);
```
deps indexed (NOT assumed contiguous): 568→**3356**, 569→3357, 570→**3358**, 571→3359, 572→**3360**, 573→3361, 574→**3362**, 575→3363.
Each module exports `SvgComponent(props)`:
```jsx
jsxs(Svg, Object.assign({width:30, height:30, viewBox:'0 0 30 30', fill:'none', xmlns:'…'}, props, {children:[ <Path …/> ]}))
```
⚠️ `Object.assign(defaults, props, children)` ⇒ **props override the root `fill:'none'`**.

## ⭐ THE DESIGN — one artwork, split at a different point per level, two fills
The complete art is **always the same 1454 chars** of path data. The LEVEL is encoded by **where the path is split**,
so each sub-path can take a different fill: `currentColor` (LIT) vs a **hardcoded** unlit colour.
`482 + 972 = 1454` and `968 + 486 = 1454` — arithmetic proof it is one artwork, re-split.
Wave x-origins confirm: level 1 splits at `M15.972`, level 2 at `M23.972`.

| IconName | module | viewBox | paths (len, fill) |
|---|---|---|---|
| seat_climate_0 | 3356 | 0 0 30 30 | **[1454 `#999999`]** ← no currentColor ⇒ ALL GREY (OFF) |
| seat_climate_1 | 3358 | 0 0 30 30 | [482 `currentColor`] + [972 `#999999`] |
| seat_climate_2 | 3360 | 0 0 30 30 | [968 `currentColor`] + [486 `#999999`] |
| seat_climate_3 | 3362 | 0 0 30 30 | **[1454 `currentColor`]** ⇒ ALL LIT (HIGH) |

**Cybertruck variants (24×24)** — independently confirm the design (seat OUTLINE is a stroke, always unlit):
| icon | module | paths |
|---|---|---|
| seat_climate_0.cybertruck | 3357 | [128 `stroke:#898989` sw2 square] + [315 `#898989`] |
| seat_climate_1.cybertruck | 3359 | [128 stroke] + [211 `#898989`] + [104 `currentColor`] |
| seat_climate_2.cybertruck | 3361 | [128 stroke] + [105 `#898989`] + [209 `currentColor`] |
| seat_climate_3.cybertruck | 3363 | [128 stroke] + [315 `currentColor`] |
CT unlit colour = **#898989** = `Night.textSecondary` = the CT `buttonHeaterOff` (R10) ✓ consistent.
CT path 1 (128ch, `stroke #898989`, `strokeWidth 2`, `strokeLinecap 'square'`) = the seat outline — **never tinted**.

## FILES WRITTEN (real, verified non-empty)
`docs/superpowers/research/tesla-status-assets/climate-icons/`
  seat_climate_0.svg (1839B) · seat_climate_1.svg (1874B) · seat_climate_2.svg (1874B) · seat_climate_3.svg (1828B)
  seat_climate_{0,1,2,3}.cybertruck.svg (942/1015/1014/947B)
Each carries a header comment explaining currentColor vs the hardcoded unlit fill.

## HOW TO USE (airgapp)
Render the SVG at 30×30 inside the 55pt button (`SEAT_HEATER_BUTTON_SIZE = 55`, iOS 3980311) and pass
`color = buttonHeaterOn (#FF3A3A)` for heat / `buttonCoolerOn (#3E6BE2)` for cool. `currentColor` picks it up;
the unlit waves stay `#999999` automatically. **No per-level tint logic and no hand-tuned grey needed** —
level 0 goes grey by itself because its artwork has no `currentColor`.
