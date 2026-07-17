# R11 §1b — Climate sheet: the animation config + every other translate candidate

Source: `/Users/ivan/Downloads/tesla-haptics-work/main.decompiled.js` (Tesla iOS v4.56). All line numbers are iOS.
Everything below is **[iOS-verified]** unless tagged otherwise.

---

## 0. Module map (established, load-bearing)

| id | what | line range (approx) |
|---|---|---|
| **11024** | **VehicleClimateScreen sheet component** (the Climate module) | 5220506 – 5225193, registered @5225196 |
| 11027 | `VehicleClimateControlsOverlay` | 5225610 – 5227036, registered @5227039 |
| 10680 | `VehicleScreens` (AppStack.Group + Climate route) | ~5040900 – 5041187, registered @5041190 |
| 4488 | Tesla `cardStyleInterpolators` (`forFade`) | 1978694 – 1986915, reg @1986918 |
| **4054** | `@gorhom/bottom-sheet` index (LIVE) | reg @1772174 |
| 4119 | re-export shim: `default` → 4120's `default` | reg @1782839, deps `[1, 4120]` |
| **4120** | **LIVE `BottomSheet.tsx`** | 1782845 – 1786852, reg @1786855 |
| **4126** | **LIVE `BottomSheetBody.tsx`** — *this is where the translate lives* | ~1787860 – 1788002, reg @1788005 |
| **4060** | LIVE gorhom `constants.ts` (`ANIMATION_CONFIGS`) | 1773519 – 1773762, reg @1773765 |
| **4062** | LIVE gorhom `utilities/animate.ts` | ~1773935 – 1774061, reg @1774064, deps `[4060, 2471]` |
| 4061 | gorhom `utilities/index` (re-exports 4062) | reg @1774101-ish, deps `[4062, 4063 … 4068]` |

**Chain proven:** Climate 11024 deps index 10 = `4054` → 4054 → 4119 → **4120**.
Module 4120 deps = `[1, 23, 3, 5, 2471, 4121, 255, 4089, 4111, 4058, 4060, 3874, 4061, 4079, 4123, 4126, 4128, 4132, 4107]`.
`animate` is pulled at the call site (@1784554) via dep **index 12 = 4061** → `.animate`.

> ⚠️ **There are TWO gorhom copies in the bundle.** The `tesla_*`-prefixed one (worklets @~1749329, constants @~1722797, `tesla_BottomSheetTsx15` @1752001) is **NOT** live for Climate. Do not read it. Everything below is the `gorhom_*` copy.

---

## A. THE CONFIG

### A1. Climate passes NO `animationConfigs` — CONFIRMED

Re-read unfiltered @**5222699-5222752**. The full prop set on `<BottomSheet>`:

Object literal @5222699 (VERBATIM):
```js
{'index': null, 'onChange': null, 'snapPoints': null, 'animateOnMount': false,
 'enableDynamicSizing': true, 'enableOverDrag': true, 'enableHandlePanningGesture': true,
 'enableContentPanningGesture': true, 'enablePanDownToClose': false, 'keyboardBehavior': 'extend'}
```
Then, the *only* subsequent `r7['…'] =` writes in 5222695-5222790:
```
5222700  r7['index']               = r11          // useState(0)[0]
5222717  r7['onChange']            = <fn onChange>  // if (i === -1) _closure2_slot35(0)
5222719  r7['snapPoints']          = [270]
5222734  r7['backgroundStyle']     = [bottomSheetBackgroundStyle, bottomSheetShadow, {backgroundColor, shadowColor}]
5222736  r7['handleStyle']         = styles.bottomSheetHandler
5222741  r7['handleComponent']     = SheetHandle
5222743  r7['style']               = styles.bottomSheet
5222751  r7['handleIndicatorStyle']= [handleIndicator, {backgroundColor: reverseTextColor}]
```
**No `animationConfigs`. No `overrideReduceMotion`. No `animatedPosition`/`animatedIndex`.** ✅ (R8/R10 facts hold.)

Corroboration: `'animationConfigs'` as a *written* key occurs exactly ONCE in the whole 9.6 M-line bundle (@1789155, inside the BottomSheetModal module) — never in module 11024.

`styles.bottomSheet` @**5221173** VERBATIM: `{backgroundColor: Colors.transparentWhite, elevation: 1}` — **no transform.**

### A2. `_providedAnimationConfigs` — NO default; falls through to `ANIMATION_CONFIGS`

`BottomSheet` props destructuring @**1783132**:
```
r56 = r1.animationConfigs;
var _closure2_slot0 = r56;      // ← _providedAnimationConfigs, NO ?? default applied
```
(compare @1783137-1783140 where `index` DOES get a `!== undefined` default of `0`, and @1783144 where `animateOnMount` gets `DEFAULT_ANIMATE_ON_MOUNT` — proving the decompiler *would* have shown a default if one existed).

`overrideReduceMotion` @**1783210**: `r47 = r1.overrideReduceMotion; var _closure2_slot8 = r47;` — also **no default → `undefined`**.

`animateToPosition`'s tail, call site @**1784548-1784570** (decoded):
```js
animatedPosition.value = animate({
  point: targetPosition,
  configs: configs || _providedAnimationConfigs,   // both undefined for Climate → undefined
  velocity: velocity,
  overrideReduceMotion: _providedOverrideReduceMotion,  // undefined
  onComplete: animateToPositionCompleted
});
```

### A3. `animate` util — VERBATIM (module 4062, iOS **1773943**)

```js
function gorhom_animateTs1({point, configs, velocity = 0, overrideReduceMotion, onComplete}) {
  const {ANIMATION_CONFIGS, ANIMATION_METHOD, withTiming, withSpring} = this.__closure;
  if (!configs) { configs = ANIMATION_CONFIGS; }
  if (overrideReduceMotion) { configs.reduceMotion = overrideReduceMotion; }
  const type = 'duration' in configs || 'easing' in configs ? ANIMATION_METHOD.TIMING : ANIMATION_METHOD.SPRING;
  if (type === ANIMATION_METHOD.TIMING) { return withTiming(point, configs, onComplete); }
  return withSpring(point, Object.assign({velocity: velocity}, configs), onComplete);
}
```
> Note the latent bug: `configs.reduceMotion = overrideReduceMotion` **mutates the shared `ANIMATION_CONFIGS` singleton**. Not triggered here (Climate passes no `overrideReduceMotion`).
> Note also `Object.assign({velocity}, configs)` — `configs` is second, so a `velocity` key inside `ANIMATION_CONFIGS` would win. There is none.

### A4. `ANIMATION_CONFIGS` — VERBATIM (module 4060, iOS **1773721-1773729**)

```js
ANIMATION_EASING  = Easing.out(Easing.exp);
ANIMATION_DURATION = 250;
ANIMATION_CONFIGS = Platform.select({
  android: { duration: 250, easing: Easing.out(Easing.exp) },
  default: { damping: 500, stiffness: 1000, mass: 3,
             overshootClamping: true,
             restDisplacementThreshold: 10, restSpeedThreshold: 10 },
});
```

**On iOS → the `default` branch → SPRING** (no `duration`/`easing` key ⇒ `animate` picks `ANIMATION_METHOD.SPRING` ⇒ `withSpring`).

Final effective call for Climate:
```js
withSpring(642, { velocity: 0, damping: 500, stiffness: 1000, mass: 3,
                  overshootClamping: true,
                  restDisplacementThreshold: 10, restSpeedThreshold: 10 },
           animateToPositionCompleted)
```

**`reduceMotion` handling — ⚠️ REGRESSION vs. the old copy.**
- The old `tesla_*` gorhom copy (@1722760-1722790) explicitly merged `{reduceMotion: ReduceMotion.Never}` into its iOS config.
- The **LIVE** copy (module 4060) does **not**. `config.reduceMotion` is `undefined` → reanimated's `getReduceMotionForAnimation(undefined)` → **`ReduceMotion.System`**.
- ⇒ **With iOS "Reduce Motion" ON, the sheet does NOT slide — it jumps** (`config.skipAnimation`/reduceMotion path sets `animation.current = toValue` on frame 1). Relevant if we want parity + a11y behaviour.

### A5. Reanimated's spring — the gotcha that decides the timing

`reactNativeReanimated_springTs2` @**1374661**, VERBATIM excerpt:
```js
const defaultConfig = {damping:10, mass:1, stiffness:100, overshootClamping:false,
                       restDisplacementThreshold:0.01, restSpeedThreshold:2, velocity:0,
                       duration:2000, dampingRatio:0.5, reduceMotion:undefined, clamp:undefined};
const config = {...defaultConfig, ...userConfig,
                useDuration: !!(userConfig?.duration || userConfig?.dampingRatio), skipAnimation:false};
…
const deltaTime = Math.min(now - lastTimestamp, 64);
const t = deltaTime/1000;
const v0 = -velocity;
const x0 = toValue - current;
const {position:newPosition, velocity:newVelocity} =
   zeta < 1 ? underDampedSpringCalculations(animation,{zeta,v0,x0,omega0,omega1,t})
            : criticallyDampedSpringCalculations(animation,{v0,x0,omega0,t});   // ⭐
…
const springIsNotInMove = isOvershooting || (isVelocity && isDisplacement);
if (!config.useDuration && springIsNotInMove) { animation.velocity=0; animation.current=toValue; return true; }
```
`useDuration` is **false** (config has no `duration`/`dampingRatio`).

`initialCalculations_…springUtilsTs3` @**1375~** VERBATIM (non-useDuration branch):
```js
const {damping:c, mass:m, stiffness:k} = config;
const zeta = c/(2*Math.sqrt(k*m));
const omega0 = Math.sqrt(k/m);
const omega1 = omega0*Math.sqrt(1 - zeta**2);
```

`criticallyDampedSpringCalculations_…springUtilsTs7` @**1375864** VERBATIM:
```js
const criticallyDampedEnvelope = Math.exp(-omega0*t);
const criticallyDampedPosition = toValue - criticallyDampedEnvelope*(x0 + (v0 + omega0*x0)*t);
const criticallyDampedVelocity = criticallyDampedEnvelope*(v0*(t*omega0 - 1) + t*x0*omega0*omega0);
```

`isAnimationTerminatingCalculation_…springUtilsTs9` @**1375980** VERBATIM:
```js
const isOvershooting = config.overshootClamping
   ? (current > toValue && startValue < toValue) || (current < toValue && startValue > toValue) : false;
const isVelocity = Math.abs(velocity) < config.restSpeedThreshold;
const isDisplacement = Math.abs(toValue - current) < config.restDisplacementThreshold;
```

🔑 **`zeta = 500/(2·√(1000·3)) = 4.5644` ⇒ `zeta ≥ 1` ⇒ Reanimated uses the CRITICALLY-DAMPED closed form with `omega0 = √(1000/3) = 18.2574 rad/s`.**
Reanimated has **no over-damped branch**. If you re-derive the true over-damped solution (roots −2.03 / −164.6 s⁻¹) you get a ~2 s crawl and you will be **wrong**. Copy Reanimated's formula, not the physics.

### A6. Motion on 420×912 / statusBarOffset 59

- `containerHeight = 912`; detent `270` ⇒ target `animatedPosition = 912 − 270 = 642`. (Same arithmetic as the verified 393×852 ⇒ 582.)
- `INITIAL_POSITION = SCREEN_HEIGHT` = `Dimensions.get('screen').height` (module 4060 @1773575-1773582) = **912** on iOS.
- Whatever §1a settles on, the sheet's animated transition is on `animatedPosition`, and **`from = 912` (INITIAL_POSITION / off-screen) → `to = 642`**, i.e. **270 pt of upward travel** (`translateY 912 → 642`).

Simulated with the exact Reanimated algorithm above @60 Hz (`x0 = −270`, `v0 = 0`):

| milestone | t |
|---|---|
| 50 % of travel | **~0.100 s** (analytic 0.092 s) |
| 90 % | **~0.217 s** |
| 95 % | **~0.267 s** |
| 99 % | **~0.367 s** |
| **terminates** (`isVelocity && isDisplacement`, both thresholds = 10) | **t ≈ 0.467 s, frame 28** — then snaps `current = toValue` |

Closed form for remaining travel: `remaining(t) = 270 · e^(−18.2574·t) · (1 + 18.2574·t)`.
`overshootClamping: true` never fires (critically damped from rest cannot overshoot).
Perceptually: a **fast ~250 ms slide with a long soft tail**, formally done at ~467 ms.

If you reimplement outside Reanimated, an equivalent-looking curve is roughly `duration ≈ 420 ms`, `Easing.out(Easing.exp)`-ish — but the exact match is the critically-damped envelope above.
(Android [Android-only, not re-verified this round]: the `android` branch gives `withTiming(642, {duration: 250, easing: Easing.out(Easing.exp)})` — a genuinely different curve.)

---

## B. NON-GORHOM CANDIDATES

### B5. `withTiming`/`withSpring`/`withDecay` outside gorhom on the sheet — **RULED OUT**

Unfiltered grep over the **whole** Climate module **11024 (5220506-5225193)** for `withTiming|withSpring|withDecay|useAnimatedStyle|useSharedValue|useDerivedValue|Animated.|'transform'`:

| line | hit | verdict |
|---|---|---|
| 5219957 | `useSharedValue` | belongs to module **11020** (reg @5219700) — outside 11024 |
| 5220187 | `useAnimatedStyle` | **Microphone** component |
| 5220206 | `r0['transform'] = r1` | **`MicrophoneTsx1`** worklet: `{opacity: sv.value, transform:[{scale: interpolate(sv.value,[1,0.5],[1,1.5])}]}` |
| 5220237-5220250 | `withRepeat(withTiming(0.5,{duration:800}), -1, true)` | Microphone pulse, gated on `_closure2_slot6` |

**That is the entire set.** The mic-button pulse is `opacity`+`scale`, on the mic button, not the sheet. **No other reanimated animation exists in module 11024.** Nothing in 11024 touches `animatedPosition` / `animatedIndex` (Climate doesn't even pass those props — A1).

### B6. `LayoutAnimation` / `configureNext` / Reanimated layout animations — **RULED OUT**

Zero occurrences of `LayoutAnimation`, `configureNext`, `entering`, `exiting`, `.Layout`, `FadeInDown`, `SlideInDown`, `SlideInUp` anywhere in module 11024 (5220506-5225193) or module 11027 (5225610-5227036). The `SlideIn*`/`Fade*`/`Bounce*` worklet strings in the bundle (@1378525, 1381289, 1391924 …) are stock `react-native-reanimated` presets and are not referenced from Climate.

### B7. Anything else translating the sheet — **the translate IS gorhom, and it's in `BottomSheetBody` (module 4126)**

⚠️ **Module 4120 (`BottomSheet.tsx`) contains NO `transform` and no `translateY`** — grep over 1782800-1786855 is empty. R10/R8 looked in the wrong file.

**The mechanism is here — `gorhom_BottomSheetBodyTsx1`, module 4126, iOS `1787885`, VERBATIM:**
```js
function gorhom_BottomSheetBodyTsx1() {
  const {Platform, animatedIndex, animatedPosition} = this.__closure;
  return {
    opacity: Platform.OS === 'android' && animatedIndex.get() === -1 ? 0 : 1,
    transform: [{ translateY: animatedPosition.get() }]     // ⭐⭐⭐ THE SLIDE
  };
}
```
This is the `useAnimatedStyle` on the sheet's root `Animated.View`. **`animatedPosition` IS a `translateY` in points, 1:1, no interpolation.** So: `animateToPosition` → `withSpring` on `animatedPosition` → `translateY` springs 912 → 642. An opacity ramp was never the story; the translate was in a sibling module.
(On iOS the `opacity` term is a constant `1` — the `Platform.OS === 'android'` guard short-circuits. **[differ]** vs Android.)

Other candidates checked and cleared:
- `BottomSheetContainer` — no worklets with any transform; `gorhom_useBottomSheetContentContainerStyleTs1-3` (@1775574-1775582) only touch `footerHeight`/`contentHeight`.
- `BottomSheetFooter` (`gorhom_BottomSheetFooterTsx1` @1781079) translates by `animatedFooterPosition`, not the sheet.
- Keyboard: `gorhom_BottomSheetTsx19/20` (@1783104/1783108) — a *source* that can call `animateToPosition` (`ANIMATION_SOURCE.KEYBOARD`), but it drives the same `animatedPosition`; it is not a separate transform. `keyboardBehavior:'extend'` with no keyboard shown ⇒ inert on open.
- `styles.bottomSheet` @5221173 = `{backgroundColor, elevation:1}` — no transform. `containerStyle` prop not passed.
- **`VehicleClimateControlsOverlay` (module 11027)** — uses **RN `Animated`** (not reanimated), and *only* for opacity:
  - `Animated.Value(0)` ref @5226281-5226290
  - style @5226520-5226529: `[styles.buttonsOverlay, {opacity: <that Animated.Value>}]`
  - driver @5226414-5226424 VERBATIM-decoded: `Animated.timing(v, {toValue: 1, duration: 300, easing: Easing.cubic, useNativeDriver: true}).start()`
  - **Opacity only. No transform. Ruled out** as the slide (it is the seat-button overlay fade-in).

### B8. Route options re-verified UNFILTERED — **no transform contribution**

**`VehicleScreens` = `<AppStack.Group>`**, module **10680**, @**5040369-5040401** VERBATIM-decoded:
```js
<AppStack.Group screenOptions={ isOHOS() ? {cardStyleInterpolator: forFade} : undefined }>
```
`isOHOS()` is **false on iOS** ⇒ **`screenOptions === undefined`**. **No group-level screenOptions on iOS at all.** ✅ (R10 was right that the group adds nothing.)

**`VehicleClimateScreen` route**, @**5040707-5040742** VERBATIM-decoded:
```js
<AppStack.Screen
  name={RouteName.VehicleClimateScreen}
  getComponent={() => require(deps[33]).default}
  options={Object.assign(
     { cardStyleInterpolator: forFade, detachPreviousScreen: false },   // r15 = false, set @5040654
     isOHOS() ? {cardStyle: {backgroundColor: 'transparent'}} : undefined
  )}
/>
```
On iOS the second operand is `undefined` ⇒ effective options = **`{cardStyleInterpolator: forFade, detachPreviousScreen: false}`**. No `gestureEnabled`, no `cardStyle`, no `transitionSpec`.

**`forFade`** — resolved via module 10680 dep **index 4 = 4488**; definition iOS **1979635** VERBATIM:
```js
function forFade(a0) {
  const {current} = a0;
  return { cardStyle: { opacity: current.progress } };
}
```
**Pure opacity. The card contributes ZERO translate.** ✅ R10 §3a confirmed on this point.
(Beware two decoys: `forFade` @3330717 is react-navigation-stack's own, `forFade` @9204482 is a `sceneStyle` variant — neither is module 4488.)

---

## VERDICT for §1b

1. Climate passes **no `animationConfigs` and no `overrideReduceMotion`**; `_providedAnimationConfigs` has **no default**, so `animate()` uses gorhom's `ANIMATION_CONFIGS`.
2. On iOS that is **`withSpring(target, {velocity:0, damping:500, stiffness:1000, mass:3, overshootClamping:true, restDisplacementThreshold:10, restSpeedThreshold:10})`**.
3. Because `zeta = 4.5644 ≥ 1`, Reanimated runs the **critically-damped** closed form at `omega0 = 18.2574 rad/s`: on 420×912 the sheet travels **translateY 912 → 642 (270 pt)**, ~50 % @100 ms, ~90 % @217 ms, **terminating at ~467 ms**.
4. **The slide is real and it is gorhom's.** `animatedPosition` is bound *directly* to `translateY` by **`gorhom_BottomSheetBodyTsx1` @ iOS 1787885 (module 4126, `BottomSheetBody.tsx`)** — *not* in `BottomSheet.tsx`, which is why earlier rounds concluded "not in the bundle".
5. Every non-gorhom candidate is ruled out with a citation: Climate module 11024 has only the Microphone pulse; module 11027 is an opacity-only RN-`Animated` fade; the route is `forFade` = opacity-only; the AppStack.Group's `screenOptions` is `undefined` on iOS.

## Open / unresolved
- **What re-fires `evaluatePosition` after `isAnimatedOnMount` flips** (i.e. the `from` value at the moment the spring starts) is **§1a's** question. §1b asserts only: whatever the transition, the config is the iOS spring above and the vehicle is `translateY`. Prime suspects remain `useBottomSheetForceUpdate` (module **8715**, dep index **40** of Climate 11024, 500 ms timer) and `gorhom_BottomSheetTsx16` (container-height reaction, @1783092, **calls `animateToPosition`**).
- If the spring's `from` is not `912` but some intermediate (e.g. a first `setToPosition` to a dynamic-sizing detent), rescale: the milestone *fractions* above are `from`-independent; only the pt values change.
