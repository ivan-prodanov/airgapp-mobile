# R10 §1 — The screen-transition contract (Tesla iOS v4.56)

Source: `/Users/ivan/Downloads/tesla-haptics-work/main.decompiled.js` (PRIMARY, iOS v4.56)
Cross-check: `/Users/ivan/Work/tesla-summon/work/bundle.hasm` (Android v4.58)
Method: unfiltered `sed` reads, every branch target followed, Hermes negation inverted per rule.

---

## 0. TL;DR — the answer to the crux

**The fade is BOTH, and the two layers are independent and NOT synchronised.**

| Layer | Mechanism | Driver | Curve |
|---|---|---|---|
| **Card** | `cardStyleInterpolator: forFade` on 6 routes | stack spring `progress` (`TransitionIOSSpec`) | ~479ms settle |
| **Content (Home)** | `<Animated.View style={{opacity: fade}}>` wrapping ALL of `VehicleHomeScreen` | `useEffect` on `[fade, isFocused, topRouteName]` | **300ms `Easing.cubic`** in, **0ms** out |
| **Content (Controls)** | shared `Animated.Value` → `opacity` on **10** style objects | `getVehicleMarkers()` callback (**data-gated**) | **300ms `Easing.cubic`** |
| **Route wrapper (Home)** | Reanimated `useAnimatedStyle` | `useIsFocused()` | **`duration: 10`** (blanking gate, not a fade) |

**The team's fix is NOT one line.** `animation:'slide_from_right'` → a fade preset reproduces only the *card* layer. The perceived Tesla effect is dominated by the **content** layer: a 300ms `Easing.cubic` opacity ramp on a per-screen Animated.Value, which on Controls is gated on marker data arriving, not on the transition clock.

---

## 1. Per-route options, VERBATIM

### 1.0 Navigator + group chain (context)

`AppStack = createStackNavigator()`. **This is @react-navigation/stack v7** — proven by the presence of the `animation` option, `getDefaultAnimation`/`getAnimationEnabled` (exported as `getAnimationEnabled`, iOS 3331495), and the `NamedTransitions` map (iOS 3331520-3331609). [iOS-verified]

Navigator `screenOptions` (iOS 273262-273270) — **unchanged from ESTABLISHED**:
```js
Object.assign({headerShown: false, presentation: 'card'}, TransitionPresets.SlideFromRightIOS)
```

> ⚠️ **This is the single most important merge fact.** `TransitionPresets.SlideFromRightIOS` (iOS 3333380-3333392) *already contains* `cardStyleInterpolator: forHorizontalIOS`, `transitionSpec: {open: TransitionIOSSpec, close: TransitionIOSSpec}`, `gestureDirection: 'horizontal'`, `headerStyleInterpolator: forFade`. Because it is spread into `screenOptions`, **every descriptor in this navigator already has a non-undefined `cardStyleInterpolator` and `transitionSpec`.** See §1.6 for why this makes `animation:'none'` on Home almost entirely inert.

Outer `AppStack.Group` (iOS 273306-273316):
```js
screenOptions = {headerShown: false, cardStyle: {backgroundColor: <_closure2_slot18>}}
// _closure2_slot18 = <cond> ? Themes[AppTheme.DARK].v5BackgroundColor : Colors.transparent  (iOS 273267-273351)
```

`VehicleScreens` = an `AppStack.Group` (iOS 5040366-5040390):
```js
screenOptions = isOHOS() ? {cardStyleInterpolator: forFade} : undefined
```
→ **on iOS this is `undefined`** (`isOHOS()` false). Group-level forFade is an OpenHarmony-only path. [iOS-verified]

### 1.1 Home — `RouteName.ProductHomeScreen` (iOS 273320-273352)

```js
options = {
  cardStyle: {backgroundColor: Colors.transparent},
  animation: 'none'
}
```
Absent (inherited): `cardStyleInterpolator` (←`forHorizontalIOS`), `transitionSpec` (←`TransitionIOSSpec`×2), `gestureDirection` (←`'horizontal'`), `detachPreviousScreen`, `cardOverlayEnabled`, `presentation` (←`'card'`), `headerShown` (←`false`).

**Component:** `ProductHomeScreen` = iOS **4181793** (a pager). It is *not* the 4558000 region — that is `VehicleHomeScreen` (iOS 4560628), the content it hosts.

### 1.2 Controls — `RouteName.VehicleControlsScreen` (iOS 5040626-5040672)

```js
options = Object.assign(
  {cardStyleInterpolator: forFade, detachPreviousScreen: false},
  isOHOS() ? {cardStyle: {backgroundColor: 'transparent'}} : undefined
)
```
→ **on iOS: `{cardStyleInterpolator: forFade, detachPreviousScreen: false}`**. Confirms ESTABLISHED. `transitionSpec` NOT overridden. `gestureEnabled` absent → resolves `true` (§1.6).

### 1.3 Climate — `RouteName.VehicleClimateScreen` (iOS 5040700-5040746)

Byte-identical shape to Controls (shares the `r15 = false` register for `detachPreviousScreen`):
```js
options = Object.assign(
  {cardStyleInterpolator: forFade, detachPreviousScreen: false},
  isOHOS() ? {cardStyle: {backgroundColor: 'transparent'}} : undefined
)
```

### 1.4 Charging / Cameras / Energy — **NO options at all**

| Route | Line | `options` |
|---|---|---|
| `VehicleCamerasScreen` | iOS 5040840 | **absent** |
| `VehicleChargingStatsScreen` | iOS 5040921 | **absent** |
| `VehicleSecurityScreen` | iOS 5040608 | **absent** |
| `EnergyHomeScreen` | (EnergyScreens module 6603287-6605618) | **no `cardStyleInterpolator`** |

→ all inherit `screenOptions` = **`SlideFromRightIOS`** (slide, no fade). [iOS-verified]

Only Energy route with an override: `EnergyTeslaWrappedScreen` → `forFade` (iOS 6605503).
Energy *modals* use `forBottomUp` (iOS 6602779) / `forBottomUpNoFade` (iOS 6602802) — separate `modalScreenOptions` consts.

### 1.5 Service — `ServiceRoutes.HomeScreen` + `ServiceRoutes.TrackerScreen`

Module-level shared const (iOS 7705690-7705715), then bound at iOS 7707031 + 7707194:
```js
_closure1_slot3 = Object.assign(
  {cardStyleInterpolator: forFade, detachPreviousScreen: false},
  isOHOS() ? {cardStyle: {backgroundColor: 'transparent'}} : undefined
)
// ServiceRoutes.HomeScreen    → options = _closure1_slot3
// ServiceRoutes.TrackerScreen → options = _closure1_slot3
```

### 1.5b Other forFade routes (completeness)

`VehicleDemoHomeScreen` (iOS 273435-273455) — the only route that also kills the gesture:
```js
options = {cardStyleInterpolator: forFade, detachPreviousScreen: false, gestureEnabled: false}
```
`LoadingScreen` (iOS 273300): `options = {animation: 'none'}`.

**The complete iOS `forFade` set:** `VehicleControlsScreen`, `VehicleClimateScreen`, `VehicleDemoHomeScreen`, `ServiceRoutes.HomeScreen`, `ServiceRoutes.TrackerScreen`, `EnergyTeslaWrappedScreen`.

### 1.6 How `animation: 'none'` actually resolves (CardStack merge, iOS 3332855-3333041)

Helpers, VERBATIM decode:
```js
// getDefaultAnimation, iOS 3331444-3331484
getDefaultAnimation = (a) => a != null ? a : (isNative ? 'default' : 'none')
//   isNative = OS!=='web' && OS!=='windows' && OS!=='macos'  → true on iOS
// getAnimationEnabled, iOS 3331486-3331495
getAnimationEnabled = (a) => getDefaultAnimation(a) !== 'none'
// NamedTransitions (_closure1_slot11), iOS 3331520-3331609
{ default: DefaultTransition, fade: ModalFadeTransition, fade_from_bottom: FadeFromBottomAndroid,
  fade_from_right: FadeFromRightAndroid, none: DefaultTransition, reveal_from_bottom: ..., 
  scale_from_center: ..., slide_from_left: SlideFromLeftIOS, slide_from_right: SlideFromRightIOS,
  slide_from_bottom: Platform.select({ios: ModalSlideFromBottomIOS, default: BottomSheetAndroid}) }
```
Merge (`r14` = this card's options; `r28` = normalised animation; `r10` = animationEnabled):
```
690: cardStyleInterpolator = options.cardStyleInterpolator !== undefined
                             ? options.cardStyleInterpolator          //  ← ALWAYS taken here
                             : (animationEnabled ? preset.cardStyleInterpolator : forNoAnimation)
674: transitionSpec  = options.transitionSpec  ?? preset.transitionSpec
658: gestureDirection= options.gestureDirection?? preset.gestureDirection
617: gestureEnabled  = options.gestureEnabled !== undefined ? options.gestureEnabled
                       : (Platform.OS === 'ios' ? animationEnabled : <unset>)
```

**Consequence for Home:** `screenOptions` injects `cardStyleInterpolator: forHorizontalIOS`, so line 690 takes the option and the `forNoAnimation` branch is **unreachable for every route in this navigator**. `animation:'none'` therefore does **NOT** disable Home's card animation.

Its one real effect is line 617: `gestureEnabled` is absent from `screenOptions`, so Home resolves `gestureEnabled = getAnimationEnabled('none') = false` → **`animation:'none'` on Home is a swipe-back-gesture kill switch**, nothing more. (Correct: Home is the root.) Controls/Climate have no `animation` → `getDefaultAnimation(undefined)='default'` → `gestureEnabled = true`.

✅ This **confirms** the ESTABLISHED claim that Home's outgoing card is `forHorizontalIOS` (→ `translateX [0, −0.3×width]` = 118px @393). It survives `animation:'none'`.

`forNoAnimation` (iOS 3334344-3334348), for the record: `function forNoAnimation() { return {}; }`

---

## 2. THE CRUX — card interpolator, or per-element? → **BOTH**

### 2a. Controls (`VehicleControlsScreen`, `_fun98619`, iOS 4039275-4040997)

One `Animated.Value`, created at **iOS 4039609-4039620**:
```js
const fade = useRef(new Animated.Value(0)).current;   // r16 / _closure2_slot12 — initial 0
```
Started **inside the `getVehicleMarkers` callback** (`_fun98628`), iOS **4039747-4039760**, VERBATIM:
```js
Animated.timing(fade, {easing: Easing.cubic, toValue: 1, duration: 300, useNativeDriver: true}).start()
```
> Note: `Easing.cubic` — the raw cubic (ease-**in**, t³). NOT `Easing.out(Easing.cubic)`.

Full chain (extends ESTABLISHED `moveCameraWithCompletion` → `_fun98627` → `getVehicleMarkers`):
```
useEffect(deps=[r2]):
  if (!_closure2_slot9) return;
  updateProduct({id, type: ProductType.VEHICLE, mobile_app_state: {is_loading: false, show_terrain: false}})
  moveCameraWithCompletion({position: CameraPosition.TOP_DOWN, carType}, _fun98627)
  cleanup: () => setState(false)

_fun98627 (camera completion, iOS 4039688):
  if (!_closure2_slot13) return;
  getVehicleMarkers(productId, _fun98628)

_fun98628(markers) (iOS 4039699-4039762):
  if (!_closure2_slot13) return;
  if (!isEmpty(markers)) setMarkers(markers)
  else setMarkers(getVehicleMarkersFallback(carType ?? CarType.CARTYPEMODELY, RouteName.VehicleControlsScreen))
  Animated.timing(fade, {easing: Easing.cubic, toValue: 1, duration: 300, useNativeDriver: true}).start()   // ← HERE
```

**`fade` is written into `opacity` on 10 style objects** (register `r16`, top-level scope of `_fun98619`):

| iOS line | Target | Matches user report |
|---|---|---|
| 4040095 | `opacity` **prop**, beside `vehicleMarkers`, `verticalOffset` | car markers |
| 4040815 | `opacity` prop, beside `vehicleMarkers`, `leftOffset`, `verticalOffset` | car markers |
| 4040855 | `opacity` prop, beside `vehicleMarkers`, `leftOffset`, `verticalOffset` | car markers |
| 4040881 | `opacity` prop, beside `vehicleMarkers`, `verticalOffset` | car markers |
| 4040130 | `Animated.View` `style` | bottom buttons |
| 4040197 | `Animated.View` `style` | bottom buttons |
| 4040307 | `Animated.View` `style` | bottom buttons |
| 4040561 | `Animated.View` `style` | bottom buttons |
| 4040464 | `style` (`_closure1_slot30`) | bottom buttons |
| 4040922 | (`r16` reused — `bottomBatteryTestWarningText`, NOT the fade) | — |

→ **Exactly the user's report: "both the markers on the car AND the bottom buttons".** [iOS-verified]

### 2b. So, plainly

- The **card** fades: `forFade` on the Controls/Climate/Service/Demo routes, driven by the stack's `TransitionIOSSpec` spring.
- The **contents** ALSO fade, on a *separate* `Animated.Value` with a *different* curve (300ms `Easing.cubic` timing vs. the card's spring) and a *different* start trigger (marker data arrival vs. navigation dispatch).
- `detachPreviousScreen: false` keeps Home mounted and painted underneath while the Controls card cross-fades over it. This is what makes a *cross*-fade possible at all.

**Reanimated is NOT used on Controls.** The Controls module (iOS 4030000-4041174) contains `useSharedValue`×2 / `withTiming`×1 / `useAnimatedStyle`×1 — none in `VehicleControlsScreen` itself. No `FadeIn`/`entering`/`LayoutAnimation` anywhere in Controls or Home. [iOS-verified]

---

## 3. Home specifically

Home is two components: the **route** (`ProductHomeScreen`, iOS 4181793) and its **content** (`VehicleHomeScreen`, `_fun110988`, iOS 4560628-4564229).

### 3a. Route wrapper — `ProductHomeScreen`, a 10ms blanking gate (Reanimated)

iOS 4181966-4182005. `_closure2_slot12 = useIsFocused()` (iOS 4181963-4181971).
Worklet stored as **verbatim source** at iOS **4180421**:
```js
function ProductHomeScreenTsx1(){
  const {withTiming, isScreenFocused} = this.__closure;
  return {opacity: withTiming(isScreenFocused ? 1 : 0, {duration: 10})};
}
// __workletHash = 5228007646122
// applied via useAnimatedStyle(...)  @ iOS 4181972
```
**`duration: 10`** — sub-frame (<16.7ms @60fps). This is a *visibility gate*, **not** a fade. It hard-blanks Home's pager the instant focus is lost.

**[both-match]** — Android v4.58 `bundle.hasm` contains this string **byte-identical**.

### 3b. Content — `VehicleHomeScreen`, the real 300ms fade

Animated.Value (iOS 4561352-4561368), register `r15` / `_closure2_slot39`:
```js
const fade = useRef(new Animated.Value(isFocused ? 1 : 0)).current;   // r49 = 1 @ iOS 4561108
```
Gates:
```js
const isFocused = useIsFocused();                                              // _closure2_slot15, iOS 4560819-4560820
const topRoute  = useNavigationState(s => s.routes[s.index].name);             // _closure2_slot43, iOS 4561426-4561436
```
The effect — `_fun111026`, iOS **4562745-4562858**, deps **`[fade, isFocused, topRoute]`** (iOS 4562740-4562744). Full unfiltered decode, every branch followed:
```js
useEffect(() => {
  const duration = isFocused ? 300 : 0;                        // r5, iOS 4562747-4562752

  if (topRoute === ModalRoutes.ThirdPartySharingRequestModal) goto FADE_TO_1;   // iOS 4562753-4562763
  if (topRoute === RouteName.ProductHomeScreen)               goto FADE_TO_1;   // iOS 4562764-4562772
  if (topRoute === RouteName.VehicleClimateScreen)            goto FADE_TO_FOCUS;
  if (topRoute === RouteName.VehicleControlsScreen)           goto FADE_TO_FOCUS;
  if (topRoute === ServiceRoutes.HomeScreen)                  goto FADE_TO_FOCUS;
  if (topRoute === ServiceRoutes.TrackerScreen)               goto FADE_TO_FOCUS;
  if (topRoute !== RouteName.ManageProductScreen)             return;           // iOS 4562805-4562813 — NO-OP
  // fallthrough → FADE_TO_FOCUS

FADE_TO_FOCUS:   // case 275, iOS 4562814-4562836
  Animated.timing(fade, {easing: Easing.cubic, toValue: isFocused ? 1 : 0,
                         duration, useNativeDriver: true}).start();
  return;

FADE_TO_1:       // case 360, iOS 4562837-4562857
  Animated.timing(fade, {easing: Easing.cubic, toValue: 1,
                         duration, useNativeDriver: true}).start();
}, [fade, isFocused, topRoute]);
```
Applied at iOS **4563925-4563929** — wrapping the **entire** Home content tree:
```js
<Animated.View style={{opacity: fade}}> … </Animated.View>
```
(Verified by register-scope analysis: `r15` has **no** top-level write between the `useRef` at 4561367 and the use at 4563928; the intervening writes at 4561882/4562275 are inside nested functions, which have their own register files.)

### 3c. Answers

**(a) Cold start.** `isFocused = true` and `topRoute = ProductHomeScreen` from the first commit, so `fade` is *initialised* to `1` (`new Animated.Value(isFocused ? 1 : 0)`). The effect fires `FADE_TO_1` with `duration = 300` → a timing from 1→1, i.e. **visually a no-op**. Home appears fully opaque. **There is no cold-start entrance animation.** [iOS-verified]

**(b) Pop back from Controls/Climate.**
- **Going Home → Controls:** `topRoute` = `VehicleControlsScreen`, `isFocused` = false → `duration = 0`, `toValue = 0` → **Home's content snaps to opacity 0 in 0ms.** So Home's `forHorizontalIOS` 118px slide-out is applied to an *already-invisible* subtree — you never see Home slide. The `cardStyle.backgroundColor: Colors.transparent` on Home then lets the theme background show through.
- **Popping Controls → Home:** `topRoute` flips to `ProductHomeScreen` and `isFocused` to true → `FADE_TO_1`, `duration = 300` → **Home's content fades 0→1 over 300ms `Easing.cubic`**, concurrently with the Controls card fading out via `forFade`.

→ **This is precisely the user's "elements FADE IN when transitioning to Home".** It is Home's own content Animated.View, not the card.

**(c) Header / favourites row / menu rows — no separate entrance animation.** One `Animated.View` wraps everything; there is no per-row Animated.Value. The only other animated opacity in `VehicleHomeScreen` is **scroll**-driven, not transition-driven (iOS 4562027-4562046, applied at 4563941 to `styles.productFadeView`):
```js
scrollY.interpolate({inputRange: [-1, 0, <r55+r24>, 81 + r24], outputRange: [0, 0, 0.92, 0.92]})
// r24 = <r7> + Gutter*14   (iOS 4562014-4562026);  r55, r7 UNRESOLVED (layout-dependent)
```
This is the sticky-header scrim. Out of scope for transitions.

### 3d. The design is internally consistent

The route set that blanks Home in `_fun111026` —
`{VehicleClimateScreen, VehicleControlsScreen, ServiceRoutes.HomeScreen, ServiceRoutes.TrackerScreen, ManageProductScreen}`
— is (modulo `ManageProductScreen`) **exactly the iOS `forFade` route set** from §1. Tesla pairs *every* `forFade` card with a Home-side content blank. The two mechanisms are designed as one effect: Home's content is hard-cut to 0 so that the cross-fade underneath is clean, then fades back in over 300ms on return.

---

## 4. `forFade` VERBATIM (iOS 1979635-1979644)

The **complete** body — it is the shortest interpolator in the file:
```js
r11 = function(a0) { // Original name: forFade, environment: r2
    r0 = a0;
    r2 = r0.current;
    r0 = {};
    r1 = {};
    r2 = r2.progress;
    r1['opacity'] = r2;
    r0['cardStyle'] = r1;
    return r0;
};
r3['forFade'] = r11;
```
i.e.
```js
const forFade = ({current}) => ({ cardStyle: { opacity: current.progress } });
```
**It sets NOTHING else.** No `transform`, no `overlayStyle`, no `shadowStyle`. It does not read `next`, `inverted`, `layouts`, or `insets`. `opacity` is the **raw** `current.progress` `Animated.Node` — no `.interpolate()`, no clamp, no `inputRange`/`outputRange`. This is Tesla's own function (module iOS ~1979400-1979700), **not** react-navigation's `CardStyleInterpolators.forFadeFromCenter`. [iOS-verified]

Its timing therefore comes entirely from the *unoverridden* `transitionSpec` = `TransitionIOSSpec` (spring, stiffness 1000 / damping 500 / mass 3, overshootClamping) → the ESTABLISHED ~479ms settle, closed form `opacity = 1 − e^(−u)(1+u)`, `u = 18.257·t`.

**Contrast for the team:** because `forFade` returns only `cardStyle`, and `detachPreviousScreen:false` keeps the previous card mounted, a Tesla forFade transition is a **true cross-fade with zero translation**. `expo-router`'s `animation:'fade'` is the nearest stock equivalent.

### 4b. Neighbours (for reference, same module)

`forFade`'s siblings, dumped while reading the region:
```js
const forBottomUpNoFade = ({current, layouts}) => ({          // iOS 1979607-1979634
  cardStyle: { transform: [{ translateY: current.progress.interpolate({
      inputRange: [0, 1], outputRange: [layouts.screen.height, 0] }) }] }
});
// forBottomUp (iOS ~1979580-1979606) additionally sets overlayStyle.opacity (extrapolate set).
```
`fadeInCentered` = iOS **1978974** — used by `VehicleScheduleV3LocationSwitchDropdownList` (iOS 5040330-5040337) with `{gestureEnabled: false, cardStyleInterpolator: fadeInCentered}`. Body not dumped (out of §1 scope).

`forHorizontalIOS` (iOS 3333801-3333870+) — stock, confirms ESTABLISHED:
```js
translateX      = current.progress.interpolate({inputRange:[0,1], outputRange:[layouts.screen.width, 0], extrapolate:'clamp'})
translateXnext  = next   ? next.progress.interpolate({inputRange:[0,1], outputRange:[0, layouts.screen.width * -0.3], extrapolate:'clamp'}) : undefined
overlayOpacity  = current.progress.interpolate({inputRange:[0,1], outputRange:[0, 0.07], extrapolate:'clamp'})
shadowOpacity   = current.progress.interpolate({inputRange:[0,1], outputRange:[0, 0.3],  extrapolate:'clamp'})
// cardStyle.transform = [{translateX}, {translateX: translateXnext}]
```
→ `−0.3 × 393 = −117.9px` outgoing. ESTABLISHED value **confirmed**.

---

## 5. Staggering — **none. One synchronised curve per screen.**

- **Controls:** a *single* `Animated.Value` feeds all **10** opacity sites. One `.start()`, one curve. **No `Animated.stagger`, no `Animated.sequence`, no `delay`, no per-element offset.** Markers and bottom buttons move in perfect lockstep.
- **Home:** a *single* `Animated.Value` wraps the whole content tree in one `Animated.View`. Nothing is staggered because nothing is individually animated.
- `Animated.stagger` / `Animated.sequence` / `withDelay` / `FadeIn.delay` appear **nowhere** in the Controls or Home modules. [iOS-verified]

**The one real offset is not a stagger — it's a data dependency.** Controls' 300ms ramp does not start on navigation; it starts when `getVehicleMarkers()` invokes its callback. So the observed sequence on Home → Controls is:

```
t=0      dispatch. Home content opacity → 0 (duration 0, INSTANT).
t=0      Controls card starts forFade (spring, settles ~479ms).
t=0      Controls content is mounted at opacity 0.
t=0      moveCameraWithCompletion(TOP_DOWN) fires.
t=?      camera completion → getVehicleMarkers(productId, cb)   ← UNBOUNDED, IPC round-trip
t=?      cb: setMarkers(...) then fade.start()
t=?+300  markers + bottom buttons at opacity 1.  (Easing.cubic)
```
The card fade and the content fade are **independent clocks**. If markers are slow, the Controls card can be fully opaque while its markers/buttons are still at 0 and have not begun. That is a deliberate "don't show markers in the wrong place" gate, not a transition polish.

R7 §5.3's "camera/env/frame all fire same tick @ 0.5s/TRANS_QUART/EASE_OUT" is the **renderer**'s internal camera move — a third, separate clock from both of the above.

---

## 6. What the team must build (iOS)

To reproduce Tesla's Controls transition you need **three** things, not one:

1. **Card:** route `animation: 'fade'` (expo-router) — replaces `slide_from_right`. Nearest match to `forFade` + `TransitionIOSSpec`. Keep the previous screen mounted (Tesla: `detachPreviousScreen: false`).
2. **Home content:** wrap Home's tree in one `Animated.View`; on blur → `opacity = 0` **instantly** (`duration: 0`); on focus → `Animated.timing(…, {toValue: 1, duration: 300, easing: Easing.cubic, useNativeDriver: true})`. Gate on `useIsFocused()` **and** `useNavigationState(s => s.routes[s.index].name)` — Tesla only does this for a specific route allowlist (§3d); other routes leave the value untouched.
3. **Controls content:** one shared `Animated.Value(0)` on all markers + bottom buttons; `.start()` the 300ms `Easing.cubic` ramp from the **marker-fetch callback**, not from a mount/focus effect.

Steps 2 and 3 are what actually produce the effect the user describes. Step 1 alone will not.

---

## 7. Confidence / gaps

**Verified unfiltered:** all `options` objects §1.1-1.5b; the CardStack merge §1.6 with every branch target followed; `forFade` §4 (complete body); the Controls chain §2a incl. all 10 opacity sites; Home's `_fun111026` §3b with all 7 branches; `getDefaultAnimation`/`getAnimationEnabled`/`NamedTransitions`.

**Corrections to prior rounds:** none — but note ESTABLISHED's "Home's outgoing card = `forHorizontalIOS`" is only true *because* `screenOptions` spreads `SlideFromRightIOS`; the raw route options say `animation:'none'`, which reads as a contradiction until §1.6 is applied. Also: ESTABLISHED's Controls/Climate options omit the (iOS-inert) `isOHOS()` `Object.assign` tail. And R7's "Home #110988 (~4558829)" is `VehicleHomeScreen`, **not** the `ProductHomeScreen` route component (iOS 4181793) — they are different components with different animation mechanisms (§3a vs §3b).

**Gaps / UNRESOLVED:**
- `ManageProductScreen`'s own route `options` not located — it is in Home's blank-list but I did not confirm it is `forFade`. Everything else in that list is.
- The scroll interpolate `inputRange` in §3c: `r55` and the base `r7` inside `r24 = r7 + Gutter*14` are layout-derived and **not recoverable** statically. `81`, `14`, `0.92` are literal.
- `_closure2_slot9` (Controls' effect guard) and `_closure2_slot13` (its cancellation flag) were read as guards but their *sources* were not traced.
- Android v4.58 cross-check performed only on `ProductHomeScreenTsx1` (byte-identical) and the existence of `getVehicleMarkersFallback` (6 refs). The 300ms/`Easing.cubic` constants were **not** re-verified against `bundle.hasm`; they are [iOS-verified] only. We ship iOS, so this is low-risk.
