# The climate icons, the Button's default textStyle, and the fade's retrigger rule (Round 12)

**Source of truth:** iOS `main.decompiled.js` (Tesla iOS **v4.56**) — the build we ship; Android `bundle.hasm` (**v4.58**) for parity. All line numbers are iOS. Read unfiltered, independently re-derived, and adversarially verified.

**Deliverable assets:** **17 SVG files** in `tesla-status-assets/climate-icons/` — all verified non-empty on disk.

**Three headlines:**
1. **The brief's premise is wrong, and the truth is better news: `seat_climate_*` has NO seat body.** It is three heat waves and nothing else — *the same anatomy as our existing marker*. Tesla solves "red at level 0" by **baking the off-grey into the artwork**, not by drawing a seat. **No redesign needed.**
2. **R10 §3b's headline was wrong.** Seats *do* grey out. `seat_climate_0` is 100% hardcoded `#999999` and contains **no `currentColor` at all**.
3. **The Button's default is `fontFamily: 'UniversalSansText-Medium'` with NO fontWeight.** The user's `600` was a *proxy* for the Medium cut — right instinct, wrong lever. Ship the family; drop the weight.

---

## ⚠️ Correction to R10 §3b

R10 §3b said:
> *"seats are `buttonHeaterOn` **#FF3A3A at every level including OFF**; they never grey out… there is no `buttonCoolerOff` token."*

**Wrong.** R10 read the *tint predicate* and never opened the *assets*. The tint token really is always `buttonHeaterOn` — but **the artwork overrides it**:

- **`seat_climate_0` contains no `currentColor` path.** Its single 1454-char path is hardcoded `fill="#999999"`. So at level 0 the seat renders **grey**, whatever colour you pass.
- **`buttonHeaterOff` (#999999) is not an unusable token** — it is the colour of the **unlit waves at every level**, baked into the SVG.

**The grey the team has been hand-tuning (`rgba(235,235,235,0.92)`) is in Tesla's palette after all: `#999999`.** It was invisible because it lives *inside the artwork*, not in the theme lookup. The user's rejection was correct.

*(Narrowing R10 §3e the same way: the steering-wheel button **does** pass `iconStyle.color = buttonHeaterOff`, but every `*_heater_off` asset has no `currentColor`, so **the token is inert** — the visible grey comes from the asset. The theme value merely duplicates the baked constant.)*

---

## §1. The icons `[iOS-verified]`; **path data `[both-match]`**

### 1a. They are vector — no image files exist
All **17** assets are **`react-native-svg` `<Path>` components**, not PNG `require`s. The `battery_nipple` precedent (R4 §1d) holds. **No `.car` catalog, no images at any density.** Each module exports:
```jsx
function SvgComponent(props) {
  return jsxs(Svg, Object.assign(
    { width: 30, height: 30, viewBox: '0 0 30 30', fill: 'none', xmlns: 'http://www.w3.org/2000/svg' },
    props,                                  // ⚠️ props OVERRIDE the defaults (incl. color)
    { children: [ jsx(Path, { d: '…', fill: 'currentColor' }), … ] }
  ));
}
```
**`[both-match]`:** every path of all 17 assets is **byte-identical** between iOS v4.56 and Android v4.58.

### 1b. 🔑 The design — one artwork, re-split per level, two fills

**The seat artwork is always the same 1454 chars of path data.** The level is encoded by **where the path is split**, so each sub-path can take a different fill: `currentColor` (LIT) vs a **hardcoded** unlit colour. The arithmetic proves it — `482 + 972 = 1454` and `968 + 486 = 1454` — and the wave x-origins confirm it (level 1 splits at `M15.972`, level 2 at `M23.972`).

**`seat_climate_*` (default variant, viewBox `0 0 30 30`, 30×30):**

| IconName | module | paths (length, fill) | renders |
|---|---|---|---|
| `seat_climate_0` | **3356** | `[1454 #999999]` | **all 3 waves grey** — no `currentColor` ⇒ tint has zero effect |
| `seat_climate_1` | **3358** | `[482 currentColor]` + `[972 #999999]` | wave 1 lit, waves 2-3 grey |
| `seat_climate_2` | **3360** | `[968 currentColor]` + `[486 #999999]` | waves 1-2 lit, wave 3 grey |
| `seat_climate_3` | **3362** | `[1454 currentColor]` | **all 3 waves lit** |

**⭐ There is no seat body.** Rasterising the reconstructed SVGs confirms: three heat waves, nothing else. **Anatomically identical to our current marker.** The brief's model ("a red seat glyph with no waves") was wrong — the fix is not a redesign, it's the baked grey.

**Cybertruck seat variant** (viewBox `0 0 24 24`) — *different artwork* (sharp zigzag chevrons), with an always-grey stroked backdrop drawn **first** and the lit path **last** (opposite element order to the default):

| icon | module | paths |
|---|---|---|
| `seat_climate_0.cybertruck` | 3357 | `[128 stroke #898989 sw2 square]` + `[315 #898989]` |
| `seat_climate_1.cybertruck` | 3359 | `[128 stroke]` + `[211 #898989]` + `[104 currentColor]` |
| `seat_climate_2.cybertruck` | 3361 | `[128 stroke]` + `[105 #898989]` + `[209 currentColor]` |
| `seat_climate_3.cybertruck` | 3363 | `[128 stroke]` + `[315 currentColor]` |

CT unlit = **#898989** (`Night.textSecondary` = CT `buttonHeaterOff`) ✓ consistent with R10.

### 1c. Heating and cooling share the artwork **literally**
`seatCoolingIcon` (fn #97707, iOS 3987813-3987893) returns **`IconName.seat_climate_0/_1/_2/_3`** — the *same constants* as `seatHeatingIcon` (fn #97708, 3987895-3987975). **There are no `seat_cool_*` IconName entries.** They differ **only in tint**: `buttonHeaterOn #FF3A3A` vs `buttonCoolerOn #3E6BE2`. (Selector: `getSeatClimateIcon` fn #97709 @3987977.)

### 1d. The steering wheel — 3 types × 3 levels = 9 icons

**Only THREE visual states, not four.** `StwHeatLevel = {STWHEATLEVEL_UNKNOWN: 0, STWHEATLEVEL_OFF: 1, STWHEATLEVEL_LOW: 2, STWHEATLEVEL_HIGH: 3}` (iOS 709977) — **levels 0 and 1 share the OFF icon** (`getSteeringWheelIconNameFromHeaterLevel` fn #97710, iOS 3988017-3988245: 0→off, 1→off, 2→low, 3→high, else→undefined).

⚠️ **Correction to my own recon:** *not* every icon has a `cybertruck` variant — **the 9 wheel icons have `default` only.** Cybertruck's wheel is reached via the **SQUIRCLE** branch of `SteeringWheelType`, not the theme variant.

Unlike the seats, the wheel icons **do** contain a body (rim/yoke/squircle) **plus two squiggles**. Same split rule (round: `219 + 245 = 464`; yoke: `229 + 255 + 777 = 1261`):

| IconName | module | viewBox | paths |
|---|---|---|---|
| `steering_wheel_heater_off` | 3414 | 0 0 24 24 | `[880 #999999]` + `[464 #999999]` |
| `steering_wheel_heater_low` | 3415 | 0 0 24 24 | `[880 currentColor]` + `[219 currentColor]` + `[245 #999999]` |
| `steering_wheel_heater_high` | 3416 | 0 0 24 24 | `[880 currentColor]` + `[464 currentColor]` |
| `yoke_heater_off` | 3546 | 0 0 24 24 | `[1261 #999999]` |
| `yoke_heater_low` | 3547 | 0 0 24 24 | `[229 currentColor]` + `[255 #999999]` + `[777 currentColor]` |
| `yoke_heater_high` | 3548 | 0 0 24 24 | `[1261 currentColor]` |
| `squircle_heater_off` | 3553 | 0 0 24 24 | `[163 #898989]` ×2 + `[1492 #898989]` |
| `squircle_heater_low` | 3554 | 0 0 24 24 | `[163 #898989]` + `[163 currentColor]` + `[1492 currentColor]` |
| `squircle_heater_high` | 3555 | 0 0 24 24 | `[163 currentColor]` ×2 + `[1492 currentColor]` |

**Yoke selection** = a redux selector off vehicle config: **`getSteeringwheelType`** (note the lowercase `w`) via `useTypedSelector` (`SteeringWheelHeaterControlButton` fn #97711 @3988249, read @3988376) → `SteeringWheelType` `TYPE_NOT_SET`/`UNKNOWN`/`ROUND` → `steering_wheel_heater_*`; `YOKE` → `yoke_heater_*`; **`SQUIRCLE` → `squircle_heater_*`**. Our `'round' | 'yoke'` maps to ROUND/YOKE; **SQUIRCLE has no equivalent in our model** (product call — do we need it?).

⚠️ **Do not conflate the two registries.** The TDS descriptor `icon-steering-wheel-yoke` (@1128632) is a **different, unrelated asset** and plays no part in the heater button. The heater path is `IconName.yoke_heater_*` → lazy registry module 2676 → modules 3546-3548.

### 1e. How the tint is delivered — a **prop**, not a mask
```
iconStyle {color} → ControlButton → NamedIcon → CommonIconView
  → jsx(iconComp, Object.assign({}, themedStyle, …))
  → SvgComponent's Object.assign(defaults, props, children) lands `color` on <Svg>
  → resolves every fill="currentColor" beneath
```
(`SeatHeaterControlButton` @3987640-3987810; `ControlButtonComponent` @3991976/3992195; `NamedIconViewComponent` @1432707; `CommonIconViewComponent` @1432900-1432905.) **Not** a single-colour alpha ramp like `mini_spinner.png`.

**CT variant selection:** `findIconByIconName(name, isCT)` where `isCT = (theme === AppTheme.CYBERTRUCK)` (@1432730-1432752). Nothing else drives it.

### 1f. Render box
**`SEAT_HEATER_BUTTON_SIZE = 55` confirmed** (iOS 3980312-3980313) — but it is the **button box used only for centring** (half-offset onto a seat coordinate; sole consumer @5227006-5227019: `left = marker.horizontal − SIZE/2`). **It is never applied to the icon.**

**No `size`/`width`/`height` prop is passed to the icon anywhere in the chain**, so it renders at **intrinsic size**: **30×30** (`seat_climate_*` default), **24×24** (CT seats + all 9 wheel icons). Padding inside the 55pt button is therefore `(55−30)/2 = 12.5pt` per side (15.5pt under the CT theme) — `[inferred]` from centring arithmetic, not read from a literal.

### 1g. No paint dependence, no RTL flip
- **No paint dependence.** `isLightColorFor` has exactly **one** call site in the whole bundle (def @500287, export @500442, sole call @1240094 — Controls-only). Nothing in the seat/wheel path touches it. Tint is purely heat/cool level + theme tokens.
- **No RTL flip.** The flip list is `NavigationIcons` (5 entries); seat and wheel icons are absent from both sets ⇒ they never flip in **any** locale. `scaleX` is 1 everywhere.

### 1h. ✅ What to build
Render the SVG at its **intrinsic size** inside the 55pt button and pass:
```
color = buttonHeaterOn  #FF3A3A   (heat)
color = buttonCoolerOn  #3E6BE2   (cool)
```
`currentColor` picks it up; the unlit waves stay `#999999` automatically. **No per-level tint logic, and no hand-tuned grey** — level 0 goes grey by itself because its artwork contains no `currentColor`. Disabled ⇒ container `opacity: 0.5` (R10).

**Files written** (`tesla-status-assets/climate-icons/`, all verified non-empty):
```
seat_climate_0.svg  seat_climate_1.svg  seat_climate_2.svg  seat_climate_3.svg
seat_climate_{0,1,2,3}.cybertruck.svg
steering_wheel_heater_{off,low,high}.svg
yoke_heater_{off,low,high}.svg
squircle_heater_{off,low,high}.svg
```
Each carries a header comment explaining `currentColor` vs the hardcoded unlit fill.

---

## §2. The Button's default textStyle — **the user was right; ship the family, not the weight** `[iOS-verified]`

**`Button` = module 2655** (Controls `dep[21]=2469` barrel → its `dep[1]=2655`). Resolved default for the markers (`GHOST`, no `size` prop):

```js
{ fontFamily: 'UniversalSansText-Medium', fontSize: 14, lineHeight: 20, letterSpacing: 0.1, fontWeight: undefined }
```

**There is no `fontWeight` — at all.** `toTextThemedStyle` writes `textFontWeight: r1.fontWeight` → `undefined`, which flows into `getComponentStyle`'s `r1['fontWeight'] = r8` and **RN ignores it**.

The marker's own `textStyle` then overrides `color` and `fontSize → 18`, leaving **`fontFamily: 'UniversalSansText-Medium'`, `lineHeight: 20`, `letterSpacing: 0.1`** inherited.

⇒ **The frunk/trunk label's true resolved style:**
```js
{ fontFamily: 'UniversalSansText-Medium', fontSize: 18, lineHeight: 20, letterSpacing: 0.1,
  color: isLight ? 'rgba(0,0,0,0.7)' : 'rgba(255,255,255,0.7)' }   // no fontWeight
```
*(Note `fontSize: 18` against an inherited `lineHeight: 20` — tight, and worth a device check.)*

**It routes through the TDS path R5 §2a established** (module **2454**, the same module the status line uses): `TextCategory = **BodyLabel**` → cut **`UniversalSansText-Medium`** = **`UniversalSans-Text-Medium-540.ttf`**. Reached by two independent routes: `getButtonFontStyle`'s `isNil(size)` → BodyLabel, and `ButtonSize.MEDIUM` → BodyLabel. (Only `PILL` and `MEDIUMLARGE` map to `CaptionLabel`.)

**We already ship it.** All 10 Universal Sans files are already in `tesla-status-assets/fonts/ios/` and match the IPA. **Nothing needed extraction.**

**A 600/SemiBold cut does not exist.** Universal Sans ships exactly **five** cuts — Thin-130, Light-230, Regular-430, **Medium-540**, Bold-680 — for both Text and Display.

**`ButtonAppearance.GHOST` does not alter weight, family, size, or opacity.** (`ButtonAppearance` module 2455 @1340031 = `{PRIMARY, FILLED, SECONDARY, OUTLINE, TERTIARY, GHOST, OUTLINE_GHOST, TOGGLE}`; `getButtonAppearanceStyle` @1340094-1340247 sets only colours per appearance.)

**`ControlButton`** (bottom row + Climate seat buttons): **module 2456 is LIVE; module 6415 (@3355150) is DEAD.** *(This resolves the ambiguity R10 flagged.)* Proof: Controls reads `ControlButtonAppearance` from `dep[17]` (@4037362-9) and Controls' deps array @4041176 has index 17 = **2456**; module 2456's own deps `[1,102,2449,2450,2454]` point at the same live Typography module 2454. The 6415 copy sits in a parallel dead component-library tree nothing references. *(The 1340793 line R10 cited is module 2456's `__esModule` placeholder, not a rival definition.)*

### 2a. Reconciling the user's "600 matched"
**No conflict — the user is right, and the lever is the family, not the weight.**

The recovered default carries **no numeric weight**. What makes the label look heavy is the **PostScript name selecting the Medium cut** — and R5 §1b's trap is exactly why `fontWeight` can't do this job: **Medium is its own single-face family**, so `fontFamily` + `fontWeight` cannot reach a different cut; only the PostScript name selects the weight.

So the history is: the team's `fontWeight: '600'` was **approximating Medium** against RN's default face. Dropping it fell back to **RN's regular 400**, which is genuinely lighter than Medium — hence the user's immediate "not bold enough". Both observations are correct.

✅ **The fix: set `fontFamily: 'UniversalSansText-Medium'` and drop `fontWeight` entirely.** That reproduces Tesla exactly. Keeping `600` *alongside* the correct family is harmless-but-meaningless (it cannot select a cut) and should be removed to avoid future confusion.

*(An earlier pass argued the 540 filename axis sits "~2/3 toward CSS 600"; the verify pass **refuted** that — it measures 32-40% under every mapping tried — and demoted the variable-axis explanation to **unverifiable locally**, since no `fvar`/`STAT` table exists in any shipped file. The **measured** fact that stands: filename axis values are 130/230/**430**/**540**/680 while `OS/2.usWeightClass` reads 100/200/**400**/**500**/700 — i.e. Regular is 430, not 400, and Bold is 680, not 700.)*

---

## §3. The fade's retrigger/reset rule `[iOS-verified]`; one `[differ]`

**1. It starts EXACTLY ONCE per mount — and NOT because it is guarded.**
The `.start()` has **no** ref, flag, `useEffect` dep, or `if` protecting it. iOS case 171 (**4039749-4039759**) is the join point of *both* the has-markers and the `getVehicleMarkersFallback` branches, so it runs unconditionally once control passes the two `_closure2_slot13` early-returns (4039687, 4039701). **It fires once only because the chain is one-shot:**
```
useEffect(deps) → moveCameraWithCompletion(TOP_DOWN) → a one-shot MOVE_CAMERA_RESPONSE listener
                → getVehicleMarkers → setMarkers → .start()
```
⇒ **The markers will not blink mid-session.** A later `VEHICLE_MARKERS_RESPONSE` does not re-run it.
*(Verify correction: **Climate's deps are `[carType, vehicleId]`** — `new Array(2)` @5226309-5226311 — **not** `[vehicleId]`. Controls' `[vehicleId]` (`new Array(1)` @4039641) is correct.)*

**2. iOS has NO reset path at all.**
The value is `useRef(new Animated.Value(0)).current` with a **literal, unconditional 0** — Controls `r65 = 0` @**4039615**, Climate `r40 = 0` @**5226286**. `useRef` survives every re-render and nothing re-seeds it. Grepping the full component bodies for the fade slots (`_closure2_slot12` / `_closure2_slot7`) yields **exactly one read each** — the `Animated.timing` target. **No `setValue`, no `stopAnimation`, no reset, no second timing.** `useIsFocused()` (slot9 @4039482) is read **only** as an early-return guard.
`[differ]` Android v4.58 *does* call `fade.stopAnimation()` at the head of its focus branch; **iOS does not**. (R10's `bundle.hasm 5211977` reference confirmed as a location.)

**3. Home's leave case is confirmed `duration: 0` (instant blank), and is NOT gated on markers.**
The effect is **`_fun111026`** @**4562745-4562857** — *(citation correction: R10 called it `_fun110988`, which is the `VehicleHomeScreen` **component**, not the effect)*. `duration = isFocused ? 300 : 0` (4562748-4562752) and `toValue = isFocused ? 1 : 0` (4562823-4562829) read the **same** register (slot15 = `useIsFocused`), so blur ⇒ `{toValue: 0, duration: 0}` = instant blank. Its deps are `[fade Value, useIsFocused, topRoute]` — **no markers**.

**4. Nothing in Controls/Climate assumes a card is fading underneath — both are safe to lift as-is.**
Both start at a **hard literal 0**, unconditional. No interpolation against card progress; no opacity site composes it.

> ⚠️ **The one trap — do NOT copy Home's seed.** Home is `useRef(new Animated.Value(isFocused ? 1 : 0)).current` (@4561352-4561368; the `1` is a direct literal load @**4561108**), so it **mounts already-visible** and its 300ms enter never plays on cold mount. That seed exists only because Home is the always-mounted route underneath. For in-page panels, seed **0**.

---

## §4. Gaps (plainly)

- **Icon padding inside the 55pt button (12.5 / 15.5pt) is `[inferred]`** from centring arithmetic — no literal states it. The intrinsic sizes (30×30 / 24×24) and the 55 constant are read.
- **Whether we need `SteeringWheelType.SQUIRCLE`** is a product question, not recoverable from the bundle. Tesla has three wheel types; our model has two.
- **The variable-axis explanation for the 540 filename** is **unverifiable locally** — no `fvar`/`STAT` table exists in any shipped file. The filename-vs-`usWeightClass` mismatch itself is measured (10/10 files).
- **Byte-identity of our shipped `UniversalSans-Text-Medium-540.ttf` vs the IPA copy was not verified** — filenames and cut names match; bytes were not diffed.
- **`fontSize: 18` against inherited `lineHeight: 20`** is read but tight; worth a device check for clipping.
- **`getFontStyle` emits a numeric `fontWeight` only on iOS + Chinese/Korean** (a CJK fallback path) — irrelevant to us, but it means "no fontWeight" is locale-scoped.
- **Android parity:** the **artwork is `[both-match]`** (all 17 assets byte-identical across iOS v4.56 / Android v4.58). Layout/style facts (the 55 constant, the Button textStyle chain, the fade wiring) are `[iOS-verified]` only, except the `stopAnimation` `[differ]` above.

---

## §5. Citations (iOS v4.56)

- **Registry:** lazy icon registry module **2676** (registered @1445560, deps array @1445561, 792 entries); per-icon getters @1442176-1442285; dep→module resolution by indexing (568→3356 … 575→3363). TDS registry (unrelated) @1124607/1129409, yoke descriptor @1128632.
- **Seat assets:** 3356/3358/3360/3362 (default, @1591232-1592613); 3357/3359/3361/3363 (cybertruck). `seatCoolingIcon` fn #97707 @3987813-3987893; `seatHeatingIcon` fn #97708 @3987895-3987975; `getSeatClimateIcon` fn #97709 @3987977.
- **Wheel assets:** 3414/3415/3416 (round), 3546/3547/3548 (yoke), 3553/3554/3555 (squircle). `StwHeatLevel` @709977; `getSteeringWheelIconNameFromHeaterLevel` fn #97710 @3988017-3988245; `SteeringWheelHeaterControlButton` fn #97711 @3988249, selector read @3988376.
- **Tint chain:** `SeatHeaterControlButton` @3987640-3987810; `ControlButtonComponent` @3991976/3992195; `NamedIconViewComponent` @1432707, CT selection @1432730-1432752; `CommonIconViewComponent` @1432900-1432905. `SEAT_HEATER_BUTTON_SIZE` @3980312-3980313, sole consumer @5227006-5227019.
- **Button:** module **2655**; `ButtonAppearance` module 2455 @1340031; `getButtonAppearanceStyle` @1340094-1340247; Typography module **2454**; `ControlButton` module **2456** (def @1341167, export @1341215; dead copy 6415 @3355150); Controls deps @4041176; marker styles @4041142-4041151.
- **Fade:** Controls value @4039615, `.start()` join @4039749-4039759, early-returns @4039687/4039701, deps @4039641, `useIsFocused` @4039482; Climate value @5226286, deps @5226309-5226311, timing @5226415; Home effect `_fun111026` @4562745-4562857, seed @4561352-4561368 (literal `1` @4561108).
- **Paint/RTL:** `isLightColorFor` @500287 / 500442 / 1240094; `NavigationIcons` flip list (seat/wheel absent).
