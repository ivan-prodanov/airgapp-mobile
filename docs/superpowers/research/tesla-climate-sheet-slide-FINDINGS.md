# The Climate sheet's slide-up, and the dark line at the top of Climate (Round 11)

**Source of truth:** iOS `main.decompiled.js` (Tesla iOS **v4.56**); Android `bundle.hasm` (**v4.58**) for `[differ]` checks. All line numbers are iOS. Read unfiltered, independently re-derived, and adversarially verified; where the verify pass overturned a reader, the corrected value is below.

> 🎁 **Method note for future rounds:** Reanimated worklets in this bundle **retain their full JS source as string literals**. `sed -n '<line>p' file | sed 's/\\n/\n/g'` prints real, readable JavaScript — no register-tracing. Every gorhom finding below is verbatim source, not a decode.

---

## ⚠️ R10 §3a was WRONG. The sheet really does slide. Here is the mechanism.

R10 §3a said *"`animateOnMount:false` is honoured… Climate takes the **else** branch: `setToPosition`, instantaneous… the observed slide-up is not in the bundle."*

**Every clause of that is wrong except the first.** The user was right; my "it's probably the card's forFade" hypothesis was a guess dressed as an inference, and it should not have shipped as a conclusion.

**The irony: `animateOnMount: false` is what CAUSES the slide.**

```js
// iOS 1783465-1783472, VERBATIM (register-decoded, then confirmed against the source)
const isAnimatedOnMount = useSharedValue(!animateOnMount || _providedIndex === -1);
```
Climate passes `animateOnMount: false` ⇒ `!false` ⇒ **`isAnimatedOnMount` is `true` from frame zero.** The flag does not mean "we have animated on mount"; it means **"the mount animation is already dealt with — stop special-casing mount."**

Therefore, in `evaluatePosition` (iOS 1783076), this branch is **dead code on Climate** — `setToPosition` **never executes**:
```js
if (!isAnimatedOnMount.value) {                       // ← never true for Climate
  if (animateOnMount) { animateToPosition(proposedPosition, ANIMATION_SOURCE.MOUNT, undefined, animationConfigs); }
  else { setToPosition(proposedPosition); isAnimatedOnMount.value = true; }
  return;
}
…
if (animatedContainerHeightDidChange.value) { setToPosition(proposedPosition); return; }
animateToPosition(proposedPosition, source, undefined, animationConfigs);   // ⭐ Climate ALWAYS lands here — even on the first pass
```
R10 read that `else` branch and assumed Climate took it. It never does.

---

## §1. The slide — exact mechanism `[both-match]`

### 1a. Why it animates on the very first evaluation

Three independent facts converge:

1. **`isAnimatedOnMount` is pre-set `true`** (above) ⇒ the mount branch is skipped ⇒ control reaches `animateToPosition`.
2. **`animatedPosition` is still at its initial value.** `animatedPosition = useSharedValue(INITIAL_POSITION)` (iOS 1783462), and `INITIAL_POSITION = SCREEN_HEIGHT = Dimensions.get('screen').height` (module 4060, iOS 1773575-1773582, 1777815). So the sheet starts **fully off-screen at the bottom**. `animateToPosition`'s guard `if (position === animatedPosition.get()) return;` therefore does **not** fire (852 ≠ 582).
3. **`animatedContainerHeightDidChange` is `false` by the time detents resolve** — so the instant-shortcut is skipped. *(Verify pass corrected the reader here: the flag is FALSE, not TRUE, and that is precisely why it animates.)* The container reaction `gorhom_BottomSheetTsx16` (iOS 1783092) sets `animatedContainerHeightDidChange.value = result !== previous` on **every** run: pass B (container `-999 → 852`) sets it **true**, but detents are still `{}` so the detents reaction bails on `!isLayoutCalculated`; a later pass (handle/content landing) re-runs Tsx16 with `852 === 852` ⇒ **false**. Only then do detents resolve and the detents reaction fire.

**The trigger** — `gorhom_BottomSheetTsx18` (iOS 1783100), the detents `useAnimatedReaction`, VERBATIM:
```js
function gorhom_BottomSheetTsx18(result, previous) {
  if (JSON.stringify(result) === JSON.stringify(previous) && isAnimatedOnMount.value) return;
  if (!isLayoutCalculated.value) return;
  evaluatePosition(ANIMATION_SOURCE.SNAP_POINT_CHANGE);   // ⭐
}
```

**A second, independent path to the same animation** (which prior rounds — and my recon — never listed): a **mount `useEffect`** (iOS 1786644-1786670):
```js
if (animateOnMount && !isAnimatedOnMount.value) return;   // Climate: animateOnMount=false ⇒ NO early return
handleSnapToIndex(_providedIndex);                        // ⇒ always runs on mount
```
`handleSnapToIndex` (iOS 1785363-1785448) ends in `runOnUI(animateToPosition)(detents[0], ANIMATION_SOURCE.USER, 0, animationConfigs)` — the same 852→582 animation. Its deps `[animateOnMount, _providedIndex, isAnimatedOnMount, handleSnapToIndex]` are all constant (index is a frozen `useState(0)[0]`, `handleSnapToIndex` is a `useStableCallback`) ⇒ it runs **exactly once**. Whichever path wins the race, **the sheet animates from the bottom to the detent.**

**My "detents[0] must change" premise was VOID** — and the detents set is **atomic** anyway: `gorhom_useAnimatedDetentsTs1` (iOS 1773286) returns bare `{}` until **all three** of `containerHeight`, `contentHeight`, `handleHeight` are ≠ `INITIAL_LAYOUT_VALUE` (`-999`, iOS 1773757). It can never publish a partial set and then grow. No detent change is needed for the slide.

### 1b. Where the translate actually lives — the module nobody opened

**This is why every prior round concluded "not in the bundle":** `BottomSheet.tsx` (module 4120) contains **no `transform` and no `translateY` anywhere**. The translate is in **`BottomSheetBody.tsx`, module 4126** (dep 15 of 4120), iOS **1787885**, VERBATIM:
```js
function gorhom_BottomSheetBodyTsx1() {
  const {Platform, animatedIndex, animatedPosition} = this.__closure;
  return { opacity: Platform.OS === 'android' && animatedIndex.get() === -1 ? 0 : 1,
           transform: [{ translateY: animatedPosition.get() }] };
}
```
`animatedPosition` → `translateY`. That is the slide.

### 1c. The animation config `[differ]`

Climate passes **no `animationConfigs`** — re-confirmed unfiltered against the prop literal (iOS 5222699 + every subsequent write: `index`, `onChange`, `snapPoints`, `backgroundStyle`, `handleStyle`, `handleComponent`, `style`, `handleIndicatorStyle`; nothing else). And there is **no component-level default**: iOS 1783132 is a bare read `r56 = r1.animationConfigs` with no `!== undefined` guard (unlike `index`@1783137 and `animateOnMount`@1783144, which *do* get defaults in the same destructuring — proof the decompiler would have shown one). So `_providedAnimationConfigs === undefined` and the default is applied one level down:

`animate` (module 4062, iOS 1773943) VERBATIM:
```js
function gorhom_animateTs1({point, configs, velocity = 0, overrideReduceMotion, onComplete}) {
  if (!configs) { configs = ANIMATION_CONFIGS; }
  if (overrideReduceMotion) { configs.reduceMotion = overrideReduceMotion; }
  const type = 'duration' in configs || 'easing' in configs ? ANIMATION_METHOD.TIMING : ANIMATION_METHOD.SPRING;
  if (type === ANIMATION_METHOD.TIMING) { return withTiming(point, configs, onComplete); }
  return withSpring(point, Object.assign({velocity: velocity}, configs), onComplete);
}
```
`ANIMATION_CONFIGS` (module 4060, iOS 1773721-1773729) VERBATIM:
```js
ANIMATION_EASING   = Easing.out(Easing.exp);
ANIMATION_DURATION = 250;
ANIMATION_CONFIGS  = Platform.select({
  android: { duration: 250, easing: Easing.out(Easing.exp) },                    // ⇒ TIMING
  default: { damping: 500, stiffness: 1000, mass: 3, overshootClamping: true,
             restDisplacementThreshold: 10, restSpeedThreshold: 10 }             // ⇒ SPRING
});
```
⇒ **iOS = `withSpring` {damping 500, stiffness 1000, mass 3, overshootClamping true, rest thresholds 10/10}.**
⇒ **Android `[differ]` = `withTiming` {duration 250, `Easing.out(Easing.exp)`}.**

**Note the symmetry:** these iOS spring constants are **identical to react-navigation's `TransitionIOSSpec`** (R8 §3). The sheet slide and the card fade ride the same curve.

**The maths.** ζ = 500 / (2·√(1000·3)) = **4.564 ≥ 1** (over-damped) — but **Reanimated has no over-damped branch** (`springTs2`, iOS 1374661: `zeta < 1 ? underDamped : criticallyDamped`), so it runs the **critically-damped** closed form at ω₀ = √(1000/3) = **18.257 rad/s** — the same form as R10 §1: `progress = 1 − e^(−u)(1+u)`, `u = ω₀·t`. Settle ≈ **467 ms** at the 10/10 rest thresholds.

### 1d. From → to, in points

The travel is always **exactly the collapsed sheet height**, because it runs from `containerHeight` (fully off-screen) to `containerHeight − 270`:

| device | containerHeight = SCREEN_HEIGHT | from | to | travel |
|---|---|---|---|---|
| 393×852 (R8's basis) | 852 | 852 | **582** | **270 pt up** |
| **420×912 (our target)** | **912** | **912** | **642** | **270 pt up** |

⚠️ **`INITIAL_POSITION` uses `Dimensions.get('screen').height`, not `window`** (module 4060, iOS 1773575-1773582). On iOS these are equal, so it doesn't bite — but do not copy `window` here by reflex; it is a different source from the one R9 pinned for `statusBarHeight`.

⚠️ **iOS "Reduce Motion" ON ⇒ the sheet jumps, no slide** (`configs.reduceMotion` is undefined ⇒ Reanimated's default `ReduceMotion.System`). Worth matching if you care about that setting.

### 1e. Everything else — ruled out `[iOS-verified]`
- **No** `withTiming`/`withSpring`/`withDecay`/`useAnimatedStyle` on the sheet container or its parents in the Climate module (5220506-5225193). The only four hits are the **Microphone button** (`useAnimatedStyle`@5220187, `withRepeat(withTiming(0.5,{duration:800}),-1,true)`@5220237).
- **No** `LayoutAnimation`, `configureNext`, `entering`/`exiting`, `Layout`, `FadeInDown`, `SlideInDown`/`SlideInUp` in module 11024 or 11027. The stock Reanimated preset worklets exist in the bundle but are **not referenced** from Climate.
- **The card contributes no translate.** Re-verified unfiltered: Climate's route options (iOS 5040707-5040742) = `Object.assign({cardStyleInterpolator: forFade, detachPreviousScreen: false}, isOHOS() ? {...} : undefined)`; `isOHOS()` is false on iOS ⇒ effectively `{forFade, detachPreviousScreen:false}`. `forFade` (iOS 1979635) sets **opacity only**. R10 was correct here.
- **`useBottomSheetForceUpdate`** (Tesla's 500 ms poke logging `'[BOTTOM SHEET] forceUpdate mapper rerun'`, module 8715, iOS 4036936; called by Climate @5222570) is **not** the slide trigger — the slide has already settled by ~467 ms. Its *mechanism* is confirmed (its `useDerivedValue` start forces a global `updateMappersOrder()`); Tesla's *intent* is **UNVERIFIABLE** from the bundle. Don't port it.

### 1f. What to build
```
sheet container: transform: [{ translateY: animatedPosition }]
animatedPosition: starts at SCREEN_HEIGHT (fully off-screen, bottom)
on first layout-complete: withSpring(containerHeight − 270,
    { damping: 500, stiffness: 1000, mass: 3, overshootClamping: true,
      restDisplacementThreshold: 10, restSpeedThreshold: 10 })
⇒ 912 → 642 on our device: 270 pt of upward travel, ~467 ms, critically damped.
```
Do **not** set `animateOnMount: true` expecting this — in gorhom it produces the *same* animation by a different route. If you're hand-rolling, just spring `translateY` from `SCREEN_HEIGHT` to `SCREEN_HEIGHT − 270` on mount.

---

## §2. The dark line at the top of Climate = **`StatusBarFade`** `[differ: iOS-only]`

### 2a. First, a red herring I chased and killed
The Climate module's `headerGradient` (`{height: 300, position:'absolute', width:'100%', zIndex: -10}`, style @5221263) **is** a `LinearGradient` (@5222605-5222634) with `colors = [Colors.black, Themes[AppTheme.CYBERTRUCK].v5BackgroundColorTransparent]` = `['#000000', '#16171800']`, `start={{x:0,y:0.2}}`, `end={{x:0,y:1}}`, no `locations`.

**But it is Cybertruck-theme-only.** Its gate (iOS 5221531-5221532):
```js
r63 = (useContext(ThemeContext).theme === AppTheme.CYBERTRUCK);
… if (r63) → <LinearGradient style={headerGradient} …/>   // case 2671
   else     → <StatusBarFade />                            // case 2649
```
A Model Y never renders it. **The `else` branch is what the user sees.**

### 2b. The actual component
`<StatusBarFade />` = Climate's `deps[9]` = **module 8567**, default export, fn **#96623** @ iOS **3931473**, rendered as `children[0]` of Climate's transparent container **with no props at all**:
```jsx
function StatusBarFade({colors, start, end, style}) {
  const theme = useContext(ThemeContext);
  if (colors == null) colors = [theme.v5BackgroundColor, theme.v5BackgroundColorTransparent];
  return <Fragment>{Platform.OS === 'ios' &&        // ⚠️ iOS-ONLY — Android renders an empty Fragment
    <Animated.View style={[styles.statusBarContainer, style]}>
      <LinearGradient style={styles.statusBarFade} colors={colors}
                      start={{x: 0, y: start ?? 0}} end={{x: 0, y: end ?? 1}} />
    </Animated.View>}</Fragment>;
}
```
Styles (iOS 3931461-3931470) VERBATIM:
```js
statusBarContainer = { height: Specifications.statusBarHeight, left: 0, right: 0, top: 0, position: 'absolute' };
statusBarFade      = { height: '100%', width: '100%' };
```

**Its height is literally `Specifications.statusBarHeight` — the function R9 recovered.** (Sourced via `dep[3]=2447` → module 2450; *not* dep[2]=255 as first reported.)

### 2c. Resolved geometry + colour

| theme | colors (top → bottom) |
|---|---|
| **DARK / CYBERTRUCK** | **`#161718`** → **`#16171800`** (fully transparent) |
| LIGHT | `#FAFAFA` → `#FAFAFA00` |

On a **420×912 / statusBarHeight 59** device: a **420 × 59 pt** band at `y = 0`, full width, flush to the top edge; a **linear alpha ramp 1 → 0** across those 59 pt (`start y=0`, `end y=1`); soft bottom edge. It sits **over the car** because Climate's container is `{backgroundColor: Colors.transparent, flex: 1}` and Home (which hosts the `GodotView`, iOS 4559286) stays mounted beneath via `detachPreviousScreen: false`.

**Fixed chrome — entirely car-independent.** Its only inputs are `ThemeContext.v5BackgroundColor` and `getDeviceId()`. It reads no VIN, no paint, no vehicle config. It is a status-bar legibility scrim; the user's guess that it is "very likely unrelated to the car" is **correct**.

### 2d. Is it Climate-only? No — but Climate's usage is unique
- **Climate** (module 11024): `<StatusBarFade />` — **no props** ⇒ `start y=0` and no opacity override ⇒ **permanently on at full strength**.
- **Home** (module 10328, dep[8]=8567): `<StatusBarFade start={0.7} style={{opacity: <animated>}} />` (iOS 4564202-4564209) — scroll-driven, usually invisible.
- **Controls** (module 8716): does **not** import 8567 at all (deps @4041176) ⇒ never renders it.
- Eight modules import 8567 in total.

### 2e. How to confirm on device
The reader proposed "switch to the light theme" as decisive; the **verify pass corrected that** — a theme switch changes too much at once. Better discriminators, in order:
1. **Controls vs Climate** (no theme change): the band should be **absent on Controls**. *(Caveat: only if Home is scrolled to top — a band appearing on Controls after scrolling Home would be Home's own `StatusBarFade`, not a refutation.)*
2. **Measure the extent**: it should end at exactly `statusBarHeight` (59 pt) and fade smoothly. A Godot-side effect has no reason to land on that exact number.
3. Cybertruck theme → the 59 pt band is replaced by the much taller 300 pt `#000000 → #16171800` gradient starting 20% down.

**To match:** absolutely-position a full-width, `statusBarHeight`-tall vertical `LinearGradient` at `top: 0`, `colors: [bg, bg + '00']`, `start {x:0,y:0}`, `end {x:0,y:1}`, above the car renderer but behind other chrome. **To omit:** just don't render it — it carries no state and is already absent on Android.

---

## §3. Gaps (plainly)

- **Climate's first measured `contentHeight` is UNRESOLVED** (it decides `detents[1]`, the expanded detent). It does **not** affect the slide — `detents[0]` is `max(582, dynamic)` and the slide runs from `SCREEN_HEIGHT` regardless.
- **Which of the two animation paths wins the race** (the detents reaction's `SNAP_POINT_CHANGE` vs the mount effect's `handleSnapToIndex` → `ANIMATION_SOURCE.USER`) is **not statically determinable** — it depends on whether React's passive-effect flush beats the UI-thread mapper pass. **Both produce the identical 852→582 spring**, so it doesn't matter for parity; it would only matter if you needed the `source` value.
- **`useBottomSheetForceUpdate`'s intent is UNVERIFIABLE** (mechanism confirmed; the bug it works around is not in the bundle).
- **The user's theme is assumed DARK/CT** (inferred from "dark line"). If they are on LIGHT, the band is `#FAFAFA` and the culprit is something else.
- **420×912 is not a standard iPhone point size** — R8/R9's basis was 393×852, and `statusBarHeight = 59` holds only if `getDeviceId()` matches `iPhone15/16/17/18` (R9). Worth confirming the identifier on the target device.
- **Godot-side suspects were not re-opened** (Background MeshInstance, `SET_SCREEN_OVERLAY_COLOR`, `ap_scene_env.tres` fog, vignette). RN accounts for the band completely — right screen, edge, size, colour, and platform — but they are ruled out by *sufficiency*, not by new evidence. If test (1) or (2) above fails, they come back on the table.
- Navigator layering (exactly how Home composites beneath Climate) remains untraced by both reader and verifier; `detachPreviousScreen: false` is the established mechanism (R10).

---

## §4. Citations (iOS v4.56)

- **gorhom BottomSheet = Climate `deps[10]` = module 4054** (deps array @5225197), registered @1772174; `_closure1_slot11` @5220706-5220711. *(R10's "module 4120" numbering referred to the same worklets.)*
- Slide: `isAnimatedOnMount` init **1783465-1783472**; `animatedPosition = useSharedValue(INITIAL_POSITION)` **1783462**; `INITIAL_POSITION = SCREEN_HEIGHT = Dimensions.get('screen').height` **1773575-1773582**, **1777815**; `evaluatePosition` **1783076**; detents reaction **1783100** (prepare **1783096**); container reaction **1783092**; `setToPosition` **1783064**; `animateToPosition` **1783056**; `getEvaluatedPosition` **1783072**; mount `useEffect` **1786644-1786670**; `handleSnapToIndex` **1785363-1785448**; `isLayoutCalculated` **1783032** (+ **1783473-1783567**).
- Detents: `gorhom_useAnimatedDetentsTs1` **1773286**; `INITIAL_LAYOUT_VALUE = -999` **1773757**.
- Translate: `BottomSheetBody.tsx` module **4126**, `gorhom_BottomSheetBodyTsx1` **1787885**.
- Config: `animationConfigs` bare read **1783132**; `animate` module 4062 **1773943**; `ANIMATION_CONFIGS` module 4060 **1773721-1773729**; Reanimated `springTs2` **1374661**.
- Top line: `headerGradient` style **5221263**, render **5222605-5222634**, CT gate **5221531-5221532**; `StatusBarFade` module **8567** fn #96623 **3931473**, styles **3931461-3931470**, registration **3931569**; Home's usage **4564202-4564209**; Controls deps **4041176**; `GodotView` **4559286**; `v5BackgroundColor`/`Transparent` **1337927-1337929** (light), **1338121-1338122** (dark).
- Climate route options **5040707-5040742**; `forFade` **1979635**; `useBottomSheetForceUpdate` module 8715 **4036936**, called **5222570**.
