# Screen-transition fades, Controls marker styling + car-colour logic, Climate sheet & marker colours (Round 10)

**Source of truth:** iOS `main.decompiled.js` (Tesla iOS **v4.56**); Android `bundle.hasm` (**v4.58**) for cross-checks. All line numbers are iOS unless tagged. Every load-bearing claim was read unfiltered, independently re-derived by a second agent, and adversarially verified by a third; where the verify pass overturned a reader, the corrected value is what appears below.

**Three headlines:**
1. **The fade is BOTH the card AND per-element — two independent, unsynchronised clocks.** Your fix is *not* one `cardStyleInterpolator`.
2. **The car-colour logic exists and is FOUR tiers deep** — a *sampled* HSB colour from the Godot render wins over the paint enum. It drives **exactly one element: the frunk label.**
3. **There is no Climate sheet slide-up in the bundle.** `animateOnMount: false` is honoured; the sheet is placed **instantaneously**. R8 was right, and the observation needs re-checking.

---

## ⚠️ Corrections to earlier rounds

**R8 §3 was WRONG about the 118px parallax — and I recommended you implement it. Don't.**
R8 said *"Home's outgoing card uses `forHorizontalIOS` → a 118px leftward parallax slide"*. It does not. The CardStack option merge (iOS 3332845-3332884, verbatim semantics) is react-navigation's standard form:
```js
optionsForTransitionConfig =
  (index !== self.length - 1 && nextOptions && nextOptions.presentation !== 'transparentModal')
    ? nextDescriptor.options     // ← ANY non-top card uses the NEXT card's options
    : descriptor.options;
```
So when Controls is pushed, **Home's card takes Controls' options → `forFade`**. And `forFade` reads **only `current`**, never `next` — for the Home card `current.progress === 1`, so Home's card sits at **opacity 1, completely static**. It neither slides nor fades. R8 (and I) reasoned from Home's *own* options, which the merge never consults for a non-top card. `forHorizontalIOS` is real and is the *preset* default, but it is **unreachable on the Home↔Controls/Climate path**.

**My R10 recon was incomplete** (caught by the reader): `hasLightExteriorColor` has a `getBlendColor` tier I missed. Corrected in §2.3.

---

## §1. The transition contract

### 1a. `forFade` — VERBATIM (iOS 1979635-1979644) `[iOS-verified]`
```js
const forFade = ({ current }) => ({ cardStyle: { opacity: current.progress } });
```
That is the **entire** interpolator: only `cardStyle.opacity`, assigned the **raw `Animated.Node`** — no `.interpolate()`, no clamp, no `transform`, no `overlayStyle`, no `shadowStyle`. It never reads `next`, `inverted`, `layouts`, or `insets`. It is Tesla's own function, not RN's `forFadeFromCenter`.

### 1b. Per-route options — VERBATIM `[iOS-verified]`

| Route | options as written | effective interpolator |
|---|---|---|
| **Home** (`ProductHomeScreen`) | `{cardStyle: {backgroundColor: Colors.transparent}, animation: 'none'}` (iOS 273320-273352) | `forFade` **when Controls/Climate is on top** (via the next-descriptor merge) |
| **Controls** (`VehicleControlsScreen`) | `Object.assign({cardStyleInterpolator: forFade, detachPreviousScreen: false}, isOHOS() ? {cardStyle:{backgroundColor:'transparent'}} : undefined)` (iOS 5040626-5040672) | `forFade` |
| **Climate** (`VehicleClimateScreen`) | same as Controls (iOS 5040700-5040746) | `forFade` |
| **Charging** (`VehicleChargingStatsScreen`) | *no options* (iOS 5040608) | inherited `SlideFromRightIOS` → **slide, no fade** |
| **Energy** (`EnergyHomeScreen`) | *no options* | inherited → **slide, no fade** |
| **Service** (`ServiceRoutes.HomeScreen`, `TrackerScreen`) | `cardStyleInterpolator: forFade` (iOS 7705690-7705715, 7707031, 7707194) | `forFade` |

`transitionSpec` is **never** overridden at route level — every route inherits `TransitionIOSSpec` from the `screenOptions` spread of `TransitionPresets.SlideFromRightIOS`. `gestureEnabled` is absent everywhere except via `animation`.

The complete iOS `forFade` set: **VehicleControlsScreen, VehicleClimateScreen, VehicleDemoHomeScreen, ServiceRoutes.HomeScreen, ServiceRoutes.TrackerScreen, EnergyTeslaWrappedScreen.** Cameras, Security, Charging and EnergyHomeScreen have **no options** and slide. `[iOS-verified]`

**`animation: 'none'` on Home does NOT disable Home's card animation.** Because `screenOptions` spreads `SlideFromRightIOS`, every descriptor already has a non-undefined `cardStyleInterpolator`, so CardStack line 690 always takes the option and the `forNoAnimation` branch is **unreachable for every route in this navigator**. Its only live effect is line 617: `gestureEnabled = getAnimationEnabled('none') = false` — i.e. it is a **swipe-back kill switch**, nothing more. (`forNoAnimation` itself returns `{}`.) `[iOS-verified]`

### 1c. THE CRUX — card *and* per-element, on two clocks `[both-match]`

**Answer: both. Your fix is not one line.**

| layer | driver | curve |
|---|---|---|
| **Card** | `cardStyleInterpolator: forFade` ← `current.progress` | `TransitionIOSSpec` **spring**, settles ~479ms |
| **Content** | a separate legacy `Animated.Value(0)` inside each screen | **300ms, `Easing.cubic`, `useNativeDriver: true`** |

They are **independent and unsynchronised**. Notably the content fade is **data-gated, not transition-gated**.

**Controls** — one shared `Animated.Value(0)` (created iOS 4039609-4039620) written into `opacity` at **10 sites: 5 markers + 5 bottom buttons** (iOS 4040095, 4040130, 4040197, 4040307, 4040464, 4040561, 4040815, **4040833**, 4040855, 4040881). *(The verify pass corrected an earlier 4+5 split — 4040833 is a marker.)* It starts **inside the markers callback**, not on mount/focus:
```
useEffect → moveCameraWithCompletion(TOP_DOWN) → _fun98627 → getVehicleMarkers → _fun98628 → setMarkers → .start()
```
```js
Animated.timing(fade, { easing: Easing.cubic, toValue: 1, duration: 300, useNativeDriver: true }).start()
```
(iOS 4039699-4039762.) **Consequence:** if markers are slow, the card can be fully opaque while markers *and* buttons are still at opacity 0. This is exactly the user's report #2.

**Home** (#1) — the real fade lives in **`VehicleHomeScreen`** (`_fun110988`), *not* the route component: one `Animated.Value` wraps the **entire content tree** in `<Animated.View style={{opacity: fade}}>` (created iOS 4561352-4561368; applied iOS 4563925-4563929), driven by a `useEffect` keyed on `[fade, isFocused, topRoute]` (iOS 4562745-4562858):
```js
duration = isFocused ? 300 : 0;
Animated.timing(fade, { easing: Easing.cubic, toValue: isFocused ? 1 : 0, duration, useNativeDriver: true }).start()
```
⇒ **Leaving Home: content snaps to 0 in 0ms. Returning: content fades 0→1 over 300ms `Easing.cubic`.** That is the user's "elements fade in on Home".

**The whole mechanism, assembled:** Home's *card* stays static at opacity 1 (forFade, `current.progress === 1`); Home's *content* blanks instantly; Controls' card fades in over it (spring ~479ms); Controls' *content* then fades in over 300ms once markers arrive. `detachPreviousScreen: false` keeps Home mounted so the cross-fade has something to composite against. Tesla pairs every `forFade` card with a Home-side content blank — the blank-list in `_fun111026` (iOS 4562753-4562813) is `{VehicleClimateScreen, VehicleControlsScreen, ServiceRoutes.HomeScreen, ServiceRoutes.TrackerScreen, ManageProductScreen}`. *(Verify note: `ManageProductScreen` is **not** a forFade route — it's a stock SlideFromRightIOS route, iOS 8038906-8038924 — so the two sets are close but not identical.)*

The `ProductHomeScreen` **route** component (iOS 4181793) is a *different* component from `VehicleHomeScreen` and uses Reanimated: `useAnimatedStyle → {opacity: withTiming(isScreenFocused ? 1 : 0, {duration: 10})}` (worklet source iOS 4180421). **`duration: 10` is sub-frame — a blanking gate, not a fade.** `[both-match]`

### 1d. Staggering — **none** `[iOS-verified]`
One `Animated.Value`, one `.start()`, one curve per screen. `Animated.stagger` / `Animated.sequence` / `withDelay` / `FadeIn.delay` appear **nowhere** in the Controls or Home modules. The only real offset is the `getVehicleMarkers` data dependency, which is not a stagger. Reanimated is **not** used on Controls at all (legacy `Animated` only).

`[differ]` **Android v4.58 calls `fade.stopAnimation()` at the head of the focus branch; iOS v4.56 does not** (`bundle.hasm` 5211977). The 300ms / `Easing.cubic` constants themselves are **[both-match]**.

---

## §2. The Controls markers

### 2a. RN views, not Godot-drawn `[iOS-verified]`
**RN — same as ours.** Godot returns marker coordinates in **device pixels**; JS divides every one by `PixelRatio.get()` and rounds (iOS 1173770-1173780). A scene-drawn marker would never need a DP conversion.

**`VEHICLE_MARKERS_RESPONSE` payload** — a flat dict, not an array:
```js
{ lock:[x,y], frunk:[x,y], trunk:[x,y], chargePort:[x,y], wheel_1_1:[x,y], …, frunk_color:[h,s,b] }
```
Every value is mapped `n => Math.round(n / PixelRatio.get())` **except `frunk_color`**, which the handler explicitly skips and passes through **raw** (iOS 1173739, 1173747-1173752). Controls reads `lock, frunk, trunk, chargePort, wheel_1_1, frunk_color`; Climate additionally reads `seatRow1L/1R, seatRow2L/2M/2R, steeringWheel, dashboard, wheel_*`.

**`getVehicleMarkersFallback(carType, routeName)`** (iOS 1169733) is used whenever the Godot response is **empty** — the guard is a bare `isEmpty(markers)`, not an error/timeout handler (iOS 4039714-4039760). `carType` defaults to `CARTYPEMODELY`. It returns a hardcoded `{markerName: [frac_w × SCREEN_WIDTH, frac_h × SCREEN_HEIGHT]}` table via a flat `===` chain; an unlisted CarType/route returns `undefined`. **The fallback dicts contain no `lock` and no `frunk_color` key** — so in fallback mode the frunk label falls back to the paint-enum tier (§2.3).

### 2b. Marker tree + style literals — VERBATIM `[iOS-verified]`
```jsx
<Animated.View style={[ buttonPositionStyle(getButtonPosition(markers.frunk), 0, -15),
                        { opacity: <the shared Animated.Value> } ]}>
  <Button appearance={ButtonAppearance.GHOST}
          style={[styles.textButton, disabled ? styles.disabledStyle : {}]}
          disabled={!enabled}
          textStyle={isLight ? styles.textColorDark : styles.textColorGray}
          status={busy ? BUSY : NONE}
          hitSlop={50}
          onPress={…} {...automationID('open-frunk-button')}>
    {tr(…)}
  </Button>
</Animated.View>
```
```js
// iOS 4041133-4041151, contiguous
styles.textButton     = { height: 30, minHeight: 0, paddingVertical: 0 };
styles.textColorDark  = { color: Colors.transparentBlack70 /* 'rgba(0,0,0,0.7)'       */, fontSize: 18 };
styles.textColorGray  = { color: Colors.transparentWhite70 /* 'rgba(255,255,255,0.7)' */, fontSize: 18 };
styles.disabledStyle  = { opacity: 0.4 };
```
**That is the entire literal** — no `fontWeight`, no `fontFamily`, no `letterSpacing`, no `lineHeight`, no backdrop, no shadow. Weight/family come from the shared `Button` component's defaults.

**Your `{fontSize: 19, fontWeight: '600', color: 'rgba(255,255,255,0.92)'}` is wrong on all three counts:** fontSize is **18**, there is **no fontWeight**, and the alpha is **0.7**, not 0.92.

### 2c. 🔑 THE CAR-COLOUR LOGIC — four tiers `[iOS-verified]`

The brief asked "a paint id? or a computed luminance?" — **it's both, and the computed one wins.**

```js
// Tier 1 — Controls component (iOS 4039810-4039843)
isLight = (frunk_color && frunk_color.length >= 3)
            ? isLightHSB(frunk_color[0], frunk_color[1], frunk_color[2])
            : hasLightExteriorColor(config);

// Tiers 2-4 — hasLightExteriorColor, fn #30232 (iOS 1240055-1240114) VERBATIM
function hasLightExteriorColor(config) {
  const blend = getBlendColor(config);                                    // ← wires in paint_color_override
  if (isSomething(blend) && blend.length === 3)                           // case 64  → 169
      return isLightHSB(blend[0], blend[1], blend[2]);
  if (getCarTypeFromConfigOrVin(config, null) === CARTYPECYBERTRUCK)      // case 76  → 165
      return false;
  return isLightColorFor(getExteriorColor(config));                       // case 124
}
```

**`isLightHSB(h, s, b)` — fn #30231 (iOS 1240024), VERBATIM.** *(Note the double negation: `if(!(!(x)))` ≡ `if (x)`.)*
```js
function isLightHSB(h, s, b) {
  if (b > 0.55) return true;    // bright        → light
  if (b < 0.38) return false;   // dark          → dark
  if (s < 0.3)  return true;    // desaturated   → light
  return h < 180;               // warm hue light, cool hue dark
}
```

**`isLightColorFor(paint)` — fn #12652 (iOS 500287-500440).** The paint enum is the **protobuf oneof case `CarServer.ExteriorColor.TypeCase`** (iOS 676566), and `getExteriorColor` (fn #30229, iOS 1239995) is `config.getExteriorColor().getTypeCase()`.

| → `true` (light) | → `false` (dark) |
|---|---|
| `null`, `undefined`, `TYPE_NOT_SET`(0), `UNKNOWN`(3), `PEARLWHITE`(9), `WHITE`(12), `PEARL`(18), `SILKROADSILVER`(33) | `REDMULTICOAT`(4), `SOLIDBLACK`(5), `SILVERMETALLIC`(6), `MIDNIGHTSILVER`(7), `DEEPBLUE`(8), `DEFAULTCOLOR`(10), `BLACK`(11), `SILVER`(13), `GREY`(14), `BLUE`(15), `GREEN`(16), `BROWN`(17), `SIGRED`(19), `RED`(20), `STEELGREY`(21), `METALLICBLACK`(22), `TITANIUMCOPPER`(23), `SIGNATUREBLUE`(24), `MIDNIGHTCHERRYRED`(25), `QUICKSILVER`(26), `ULTRARED`(27), `STEALTHGREY`(28), `LUNARSILVER`(29), `GLACIERBLUE`(30), `DIAMONDBLACK`(31), `FROSTBLUE`(32), `MARINEBLUE`(34), `GARNETRED`(35) |

An enum member not listed → **`undefined`** (case 575; falsy ⇒ treated as dark). Note the default: **null/undefined/UNKNOWN ⇒ `true` (light)**.

**The colour decision** (iOS 4040340-4040353):
```
     if (!isLight) goto 3082;                    // → textColorGray
3069: if (!r7) goto 3094;                        // → textColorDark
3072: if (r23.frunk_opened !== r41) goto 3094;   // → textColorDark
3082: r31 = styles.textColorGray;
3094: r31 = styles.textColorDark;
3106: r36['textStyle'] = r31;
```

**Answering the user directly:**
- **Red Model Y** = `REDMULTICOAT`(4) / `ULTRARED`(27) → `false` → frunk label = **`rgba(255,255,255,0.7)` @ 18px**.
- **White car** = `WHITE`(12) / `PEARLWHITE`(9) → `true` → frunk label = **`rgba(0,0,0,0.7)` @ 18px**.

**He is right — the label is not white on a white car.**

⚠️ **Parity caveat:** on-device, `frunk_color` is **not** CT-only — Godot samples a **41×41-px box of the actually-rendered viewport** around the frunk marker and returns its HSB. So on the real app the switch is usually driven by the **sampled render**, not the paint enum; the enum is the fallback (and the *only* path when the marker fallback is used, since fallback dicts carry no `frunk_color`). If you can't sample the render, the enum table reproduces it for stock paints.

### 2d. What else takes the treatment — **nothing** `[iOS-verified]`
`textColorGray`/`textColorDark` appear at exactly **4 sites**:
- **4040348 + 4040352** — the **frunk** label's `textStyle` (the *only* conditional pair);
- **4040478** — the **lock** glyph's `iconStyle`: **hardcoded `textColorGray`**;
- **4040644** — the **trunk** label's `textStyle`: **hardcoded `textColorGray`**.

**The frunk label is the sole adaptive element on the screen.** No backdrop, shadow, scrim or container colour is driven by `isLight` anywhere. The bottom row takes no override at all.

### 2e. The bottom button row `[iOS-verified]`
```jsx
{(!isCybertruck || !isRunningSohTest) &&
  <View style={styles.bottomControlButtonsRow2}><VehicleControlsScreenButtons/></View>}   // iOS 4040237-4040252
```
`VehicleControlsScreenButtons` = fn #98598 (iOS 4037329, export 4037380) → `useShallowEqualSelector(getOptionalVehicleControlButtonsForSelectedVehicle)`, mapping each non-null type to:
```jsx
<ControlButton style={styles.controlButton} type={t} appearance={ControlButtonAppearance.STATELESS_GHOST} />
```
Types = `VehicleControlButtonType.{FLASH_LIGHTS, HONK_HORN, REMOTE_START}` + a conditional `HOME_LINK`/`VENT` splice (fn #98597, iOS 4037262).
```js
styles.bottomControlButtonsRow2 = { bottom: 20 /* 2 × Gutter(10) */, flexDirection: 'row',
                                    height: 0.25 × SCREEN_WIDTH /* 98.25 @ 393w */, … };
styles.controlButton = { flexShrink: 1, marginHorizontal: -20, width: 80 };
```
It **fades with the shared content `Animated.Value`** (5 of the 10 opacity sites), *not* with the card and *not* on its own clock. `r6` in the guard = **`isSelectedVehicleRunningSohTest`** (iOS 4039488) — *verify corrected an earlier "tentModeOn" guess*.

---

## §3. Climate

### 3a. ⚠️ ~~The `animateOnMount` contradiction — R8 is right; there is no slide-up~~ **WRONG — see Round 11**

> 🛑 **This entire subsection is WRONG and is superseded by `tesla-climate-sheet-slide-FINDINGS.md` (Round 11). The sheet DOES slide — 270pt, spring, ~467ms.** The error: I read `evaluatePosition`'s `else { setToPosition(...) }` branch and asserted Climate takes it. **It never does.** `isAnimatedOnMount = useSharedValue(!animateOnMount || _providedIndex === -1)` (iOS 1783465-1783472) — so `animateOnMount:false` sets the flag **`true`**, making that whole branch **dead code** and sending every position evaluation, *including the first*, to `animateToPosition`. Since `animatedPosition` starts at `INITIAL_POSITION = SCREEN_HEIGHT`, the first evaluation springs the sheet from off-screen up to the detent. **`animateOnMount:false` is what CAUSES the slide.** The translate lives in `BottomSheetBody.tsx` (module 4126, iOS 1787885) — `transform: [{translateY: animatedPosition}]` — which is why searching `BottomSheet.tsx` found no transform and I wrongly concluded "not in the bundle". The correct claim below is only that `animateOnMount: false` is real and honoured; everything after that is void.

<details><summary>Original (incorrect) text, kept for the record</summary>

#### The `animateOnMount` contradiction — R8 is right; there is no slide-up `[iOS-verified]`

**`animateOnMount: false` is real and is honoured.** iOS 5222699 literally contains `'animateOnMount': false`, never reassigned. And it is **not** swallowed downstream: the default-merge is guarded `if(!(r54 === undefined)) …` — a **`??`, not a `||`** — so `false !== undefined` means the prop wins and `DEFAULT_ANIMATE_ON_MOUNT` (=`true`) is never substituted.

The mount path, verbatim:
```js
if (animateOnMount) { animateToPosition(nextPosition, ANIMATION_SOURCE.MOUNT); }
else                { animatedPosition.value = nextPosition; }   // ← Climate takes this
```
Climate takes the **else** branch: a bare shared-value write, **instantaneous**.

**The sheet's real "entrance":**
- **Property:** `transform: [{ translateY: animatedPosition }]` on the sheet container.
- **From:** `INITIAL_POSITION = SCREEN_HEIGHT` = **852**. **To:** `animatedSnapPoints[0]` = the 270 detent → **top y 582**.
- **Duration / easing: NONE.** A single shared-value write on the first frame where `isLayoutCalculated` flips false→true.

**So the observed slide-up is not in the bundle.** All three candidate mechanisms were ruled out with citations. Honest reading: the sheet is *placed*, not animated, and what reads as a "slide-up" is most likely the **card's `forFade`** bringing the whole Climate screen (sheet included) up from opacity 0 — plus the fact that the sheet's pre-layout position is off-screen at 852, so a slow layout frame would show it *appear*, not travel. **This is a hypothesis, flagged as such — I recommend re-checking on device (slow-motion capture) before building a slide.** If a real slide exists, it is not in this bundle version.

*Verify note:* two gorhom copies exist; the **live** one for Climate is module **4120** (live mount path `evaluatePosition_Gorhom_BottomSheetTsx12`, iOS 1783076; merge iOS 1783143-1783151), not the 4054 copy R8 cited. **The conclusion is unchanged** under either copy.

</details>

> *(R11 footnote on the module numbering above: Climate's `deps[10]` is **4054**, registered at iOS 1772174 — the same `gorhom_*` worklets. R8's citation was right; the "4120" relabel was cosmetic and changed nothing.)*

### 3b. The marker colours `[iOS-verified]`

> 🛑 **CORRECTED by Round 12 (`tesla-icons-buttons-FINDINGS.md`).** The claim below that seats are "**#FF3A3A at every level including OFF**" and "**never grey out**" is **WRONG** — it read the tint *predicate* and never opened the *assets*. **`seat_climate_0`'s artwork is 100% hardcoded `fill="#999999"` and contains no `currentColor` path at all**, so at level 0 the seat renders **grey** regardless of the tint passed. Likewise **`buttonHeaterOff` (#999999) is NOT an unusable token** — it is the colour of the **unlit waves at every level**, baked into the SVG. (Same narrowing for the wheel: the button *does* pass `buttonHeaterOff`, but every `*_heater_off` asset has no `currentColor`, so the token is **inert**.) The rest of this subsection — the token values, the heat/cool split, disabled ⇒ opacity 0.5 — stands.

**Headline: there is NO per-level tint.** Only three tint tokens exist; **the level is carried entirely by the icon asset.**

| token | LIGHT | DARK | CYBERTRUCK |
|---|---|---|---|
| `buttonHeaterOn` | **#FF3A3A** | **#FF3A3A** | **#FF3A3A** |
| `buttonHeaterOff` | **#999999** | **#999999** | **#898989** (`Night.textSecondary`) |
| `buttonCoolerOn` | **#3E6BE2** | **#3E6BE2** | **#3E6BE2** |
| `buttonDefrostOn` | #FF4C4C | #FF4C4C | #FF4C4C |

(iOS: `#FF3A3A`@1337798, `#999999`@1337752, `#3E6BE2`@1337921, `#FF4C4C`@1337923; CT override 1338294-1338298; `Night.textSecondary`@1338467.) **There is no `buttonCoolerOff` token anywhere in the bundle.**

**By element — and they differ, which matters:**
- **Steering wheel:** ON → `buttonHeaterOn` **#FF3A3A**; **OFF → `buttonHeaterOff` #999999** (#898989 on CT). *This is the user's "different colour when not enabled".*
- **Seats:** `iconStyle.color = buttonCoolerOn` **iff** the seat is in cooling mode, **else `buttonHeaterOn`**. Both are *"On"* tokens — **the seat glyph is #FF3A3A in heat mode and #3E6BE2 in cool mode at *every* level, including OFF.** It **never** uses `buttonHeaterOff`. Off-ness is conveyed by the **icon asset**, not the tint.
  The predicate (iOS 3987670-3987684): `seatCoolerPositions.includes(pos) && hasSeatCooling(config) === true && getSeatCoolingLevel(…) > SEATCOOLINGLEVELOFF`.
- **Disabled vs off:** a **disabled** marker keeps the **same tint** (`iconStyle.color` wins over the themed `iconTintColor`) but its icon-container View gets **`opacity: 0.5`** — `busyDisabledStyle = {opacity: Specifications.iconButtonBusyOpacity}`, and `iconButtonBusyOpacity = 0.5` (matches R4).

### 3c. Glyph geometry `[iOS-verified]`
- **`SEAT_HEATER_BUTTON_SIZE = 55`** (iOS 3980311-3980312, verbatim `r3 = 55; r2['SEAT_HEATER_BUTTON_SIZE'] = r3;`).
- **Levels are four discrete icon assets, not runtime wave fills.** `seatHeatingIcon` (fn #97708, iOS 3987896-3987975): `SEATHEATERLEVELOFF → IconName.seat_climate_0`; `LOW → seat_climate_1`; `MED → seat_climate_2`; `HIGH → seat_climate_3`; anything else → `undefined`. `seatCoolingIcon` (iOS 3987814-3987893) is structurally identical and returns the **same four assets** over `SeatCoolingLevel_E`.
- Appearance: `ControlButtonAppearance.STATELESS_GHOST` (iOS 5226155-5226160).

### 3d. Climate markers run their OWN entrance `[iOS-verified]`
`VehicleClimateControlsOverlay` (fn #120884, iOS 5225920) holds its own **legacy** `Animated.Value(0)` (`_closure2_slot7`, iOS 5226287-5226296), applied as opacity on `style={[buttonsOverlay, {opacity}]}` (iOS 5226525-5226534):
```js
Animated.timing(value, { toValue: 1, duration: 300, easing: Easing.cubic, useNativeDriver: true }).start()   // iOS 5226415-5226425
```
**Trigger is not mount** — it fires inside the vehicle-markers callback, same as Controls. Same 300ms `Easing.cubic` clock, independent of the card's spring.

### 3e. Paint does **not** affect Climate markers `[iOS-verified]`
`isLightColorFor` has exactly **one** call site in the entire bundle (iOS 1240094, the Controls-side selector). Occurrence count is **0** in the Climate screen module, **0** in `VehicleClimateControlsOverlay`, **0** in the `SeatHeaterControlButton` module. **Paint colour reaches the Climate markers by no path at all** — their tint is the closed 3-token set above, read straight off the theme. This is the **opposite** of the Controls answer.

---

## §4. What to build (the deltas)

1. **Card layer:** set `cardStyleInterpolator = ({current}) => ({cardStyle: {opacity: current.progress}})` + `detachPreviousScreen: false` on **Controls, Climate, Service** only. Leave Charging/Energy/Cameras/Security sliding. **Do not add a parallax slide** (§ correction above).
2. **Content layer (the part you're missing entirely):** each screen needs its **own** `Animated.Value(0)` → `opacity`, run at **300ms `Easing.cubic`, `useNativeDriver: true`**, started **when the marker data arrives**, not on mount. On Home, wrap the whole content tree and use `duration = isFocused ? 300 : 0` (instant blank on leave, 300ms fade on return).
3. **Controls markers:** `fontSize: 18`, no fontWeight, `rgba(255,255,255,0.7)` — switching to `rgba(0,0,0,0.7)` **only for the frunk label** when `isLight`. Implement `isLightHSB` + the paint-enum fallback.
4. **Climate markers:** steering wheel `#FF3A3A`/`#999999`; seats `#FF3A3A` (heat) / `#3E6BE2` (cool) at *all* levels, with level via `seat_climate_0..3`; disabled → same tint + container `opacity: 0.5`. Button size 55.
5. **Climate sheet:** do **not** build a slide-up; place it instantly at the 270 detent (R8's geometry).

---

## §5. Gaps (plainly)

- **The Climate slide-up the user reports is not in the bundle.** I can prove `animateOnMount:false` is honoured and the position write is instantaneous; I *cannot* prove what the user saw. The card-fade explanation is a **hypothesis**. Re-check on device before building anything.
- **`frunk_color` on a stock Model Y**: the sampling mechanism (41×41-px viewport box) is read from the Godot side, but whether it is populated on *every* vehicle in practice is **inferred**, not observed. It determines whether the HSB tier or the enum tier is live for you.
- **`r7` and `r41`** in the frunk `textStyle` branch (the `frunk_opened` sub-condition) are **UNRESOLVED** — they only refine the light-car case; the primary `isLight` split is solid.
- **Disabled-tint precedence** (`iconStyle.color` vs themed `iconTintColor`) rests on reading `ControlButton`'s render, and two copies of `generateControlButtonThemedStyles` exist (iOS 1340789 and 3355150); the verify pass resolved the opacity-0.5 behaviour but the exact winning path is **partially inferred**.
- **`ManageProductScreen`** is in Home's blank-list but is a stock slide route — so "blank-list == forFade set" is **not** exactly true.
- Android was cross-checked only for the 300ms/`Easing.cubic` constants and `ProductHomeScreen`'s worklet; the rest is `[iOS-verified]` only.

---

## §6. Citations (iOS v4.56)

- `forFade` 1979635-1979644; CardStack merge 3332800-3332940 (r14 branch 3332845-3332884, line 690 at 3332927); `TransitionIOSSpec` 3333650-3333655; `forHorizontalIOS` 3333801-3333870; `forNoAnimation` 3334344-3334348; screenOptions 273262-273270; Home route options 273320-273352.
- Controls: fade Animated.Value 4039609-4039620; `_fun98627` 4039688; `_fun98628` 4039699-4039762; marker styles 4041133-4041151; colour branch 4040340-4040353; lock 4040478; trunk 4040644; bottom row 4040237-4040252, fn #98598 4037329, fn #98597 4037262; SOH guard 4039488.
- Car colour: `isLightHSB` fn #30231 1240024-1240050; `hasLightExteriorColor` fn #30232 1240055-1240114; `isLightColorFor` fn #12652 500287-500440 (export 500442); `getExteriorColor` fn #30229 1239995; `getBlendColor` fn #62901 2604912; paint enum `CarServer.ExteriorColor.TypeCase` 676566 (oneofGroups 676561); selector 4037238-4037249; consumer 4039294; tier merge 4039810-4039843.
- Markers transport: `GET_VEHICLE_MARKERS` 1169356; `VEHICLE_MARKERS_RESPONSE` 1169313; `getVehicleMarkers` 1173701 (DP conversion 1173770-1173780, `frunk_color` skip 1173739/1173747-1173752); fallback 1169733.
- Home: fade value 4561352-4561368; `_fun111026` 4562745-4562858; apply 4563925-4563929; blank-list 4562753-4562813; `ProductHomeScreen` worklet 4180421, 4181963-4182005.
- Climate: sheet props 5222699; overlay fn #120884 5225920 (fade 5226287-5226296, timing 5226415-5226425, apply 5226525-5226534); appearance 5226155-5226160; gorhom live module 4120 (1783076, 1783100, 1783143-1783151); `INITIAL_POSITION` 1723453-1723454.
- Colours: `#FF3A3A` 1337798; `#999999` 1337752; `#3E6BE2` 1337921; `#FF4C4C` 1337923; CT override 1338294-1338298; `Night` 1338467; `SEAT_HEATER_BUTTON_SIZE` 3980311-3980312; `seatHeatingIcon` fn #97708 3987896-3987975; `seatCoolingIcon` 3987814-3987893; seat predicate 3987670-3987684.
