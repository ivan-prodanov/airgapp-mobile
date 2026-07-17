# R8 §3 — Transition speed on the Home ↔ Controls path

Source: `/Users/ivan/Downloads/tesla-haptics-work/main.decompiled.js` (Tesla iOS v4.56). All line numbers are iOS bundle lines. `[iOS-verified]` unless tagged otherwise.

**Headline:** the team is right that its version is faster — but the camera is not where the difference is. **The camera/env/frame trio really is 0.5s / TRANS_QUART / EASE_OUT with no overrides (R7 §5.3 re-confirmed).** What the team is missing is a **second, much slower animation running concurrently**: the react-navigation card cross-fade, driven by `TransitionIOSSpec` (a spring), which is only ~50% done at 348 ms and ~90% done at **1143 ms**. That long tail is what makes the real app read slower.

---

## §3.1 — No per-transition duration / transition_type / ease_type override. CONFIRMED.

### RN module defaults (verbatim, iOS 5222927-5222933)
```
r16 = 0.5;
r1['defaultCameraAnimationDuration'] = r16;      // iOS 1172928  → 0.5
r11 = r11.QUART;
r1['defaultCameraAnimationTransition'] = r11;    // iOS 1172930  → TRANS_QUART
r6 = r6.OUT;
r1['defaultCameraAnimationEase'] = r6;           // iOS 1172932  → EASE_OUT
```
(actual lines: 1172928 / 1172930 / 1172932 — the `defaultCameraAnimationDuration = 0.5` assignment is at **iOS 1172928**.)

### `moveCamera` takes an OBJECT, not positionals (iOS 1172931 fn `moveCamera`, decl at ~1172930)
Destructures, in order: `position`, `updateEnvironment` (default `true`), `animated` (default `true`), `duration` (→ `defaultCameraAnimationDuration` when `undefined`, iOS 1172954), `transitionType` (→ default, iOS 1172958-1172963), `easeType` (→ default, iOS 1172966-1172971), `carType` (→ `CarType.CARTYPEMODEL3`).
⇒ **A caller can only override duration/transition/ease by naming the keys.** Neither Home nor Controls does.

### `updateMainViewFrame` IS positional — signature recovered verbatim (iOS ~1173200-1173330)
```
updateMainViewFrame(
  top_margin,                     // arg0
  left_margin,                    // arg1
  width,                          // arg2
  height,                         // arg3
  animated        = true,                                 // arg4  (iOS 1173248-1173253)
  duration        = defaultCameraAnimationDuration (0.5), // arg5  (iOS 1173265)
  transition_type = defaultCameraAnimationTransition (QUART), // arg6 (iOS 1173271)
  ease_type       = defaultCameraAnimationEase (OUT),     // arg7  (iOS 1173277)
  scroll_fraction = <undefined>                           // arg8  (iOS 1173290-1173296)
)
```
Emits `UPDATE_MAIN_VIEW_FRAME` with `{top_margin, left_margin, width, height, animated, duration, transition_type, ease_type, scroll_fraction}`, each of top/left/width/height multiplied by `_closure1_slot16` (the px→Godot scale factor).

### Controls call sites — fn #98623 (frame) and #98626 (camera)
`updateMainViewFrame` at **iOS 4039613**:
```
r1 = r15[r5](r14, r13, r12, r11, r10);
   r14 = <top>, r13 = 0, r12 = SCREEN_WIDTH, r11 = SCREEN_HEIGHT - <slot26|27|28>
```
**4 real args.** (`r10` is a spurious trailing register — the decompiler prints one register past the Hermes call frame. Proof: in the Home wrapper below, the last *real* arg `r10 = a0` is followed by an identical spurious `r9 = _closure1_slot1` (the module require array). Same pattern, one slot further out.) ⇒ Controls' frame runs `animated=true, duration=0.5, QUART, OUT`.

`moveCameraWithCompletion` at **iOS 4039675** — object literal built verbatim:
```
r2['position'] = CameraPosition.TOP_DOWN;
r2['carType']  = _closure2_slot5;
r2['completion'] = <marker loop fn>;
```
**No `duration` / `transitionType` / `easeType` / `animated` key.** ⇒ 0.5 / QUART / OUT.

### Home call sites — fn #111017 (frame wrapper) / #111018 (useFocusEffect) / #111020
Local wrapper (iOS 4562236):
```
updateMainViewFrame(a0) {
  top   = Specifications.statusBarHeight + 60        // iOS 4562252 (60 inline)
        + (lootboxBanner ? LOOTBOX_TOP_BANNER_HEIGHT : 0)
  left  = 0
  width = SCREEN_WIDTH
  height= GODOT_VIEW_SIZE
  arg4  = a0                                          // ← animated
}
```
Called as `_closure2_slot67(GodotModule.cameraInitialized)` at iOS 4562320 and 4562340. **args 5-8 (duration/transition/ease/scroll) are NOT passed → defaults 0.5 / QUART / OUT.**
⚠️ Note the 5th arg: Home passes `animated = GodotModule.cameraInitialized`. On the very first entry after Godot init, `cameraInitialized` is `false` → **the frame and camera JUMP rather than tween.** Afterwards it's `true`.

`moveCamera` calls (all object literals, all key-complete):
- iOS 4562326 — `{position: _closure2_slot65, carType: _closure2_slot13, animated: GodotModule.cameraInitialized}`
- iOS 4562393 — `{position: _closure2_slot65, carType: _closure2_slot13, animated: false}` (the `showingVehicleProduct === false` branch)
- iOS 4562423 (fn #111020) — `{position: _closure2_slot65, carType: _closure2_slot13}`
- iOS 4559148 (#111050) — `{position: CameraPosition.PARKED, carType: _closure2_slot7}`

**None of the four passes `duration`, `transitionType`, or `easeType`.**

> **§3.1 verdict: CONFIRMED. 0.5s / TRANS_QUART / EASE_OUT on camera + env + frame for the whole Home↔Controls path. R7 §5.3 stands. The team's camera timing is already correct.**

---

## §3.2 — YES. The navigator has its OWN, LONGER animation running alongside. **This is the answer.**

### Navigator identity
`AppStack = createStackNavigator()` — **@react-navigation/stack (JS stack), NOT native-stack.** iOS 272536-272539:
```
r4 = r10[22]; r4 = require(r4); r4 = r4.createStackNavigator; r4 = r4();
r2['AppStack'] = r4;
```
Version is **v7** `[INFERRED, high confidence]` — the bundle contains the v7-only `ANIMATION_PRESETS` map (iOS 3331558-3331608: `default / fade / fade_from_bottom / fade_from_right / none / reveal_from_bottom / scale_from_center / slide_from_left / slide_from_right / slide_from_bottom`) and the v7 `DefaultTransition` `Platform.Version >= 34` branch (iOS 3333571-3333601).

### Navigator-level `screenOptions` (iOS 273262-273270, verbatim)
```
r10 = require(22).TransitionPresets;
r11 = r10.SlideFromRightIOS;
r10 = {'headerShown': false, 'presentation': 'card'};
r10 = Object.assign(r10, r11);
r7['screenOptions'] = r10;
r7['initialRouteName'] = RouteName.LoadingScreen;
```

### `TransitionPresets.SlideFromRightIOS` (iOS 3333371-3333395, verbatim)
```
{
  gestureDirection: 'horizontal',
  transitionSpec: { open: TransitionIOSSpec, close: TransitionIOSSpec },
  cardStyleInterpolator: forHorizontalIOS,
  headerStyleInterpolator: forFade,        // header only
}
```

### ⭐ `TransitionIOSSpec` — the transitionSpec, VERBATIM (iOS 3333650-3333655)
```js
{
  animation: 'spring',
  config: {
    stiffness: 1000,
    damping: 500,
    mass: 3,
    overshootClamping: true,
    restDisplacementThreshold: 10,
    restSpeedThreshold: 10
  }
}
```
This is react-navigation's stock `TransitionIOSSpec`, unmodified by Tesla.

### `RouteName.VehicleControlsScreen` route options (iOS 5040644-5040670, verbatim)
```js
options = Object.assign(
  { cardStyleInterpolator: <module 4488>.forFade,   // ← ROUTE-LEVEL OVERRIDE
    detachPreviousScreen: false },
  isOHOS() ? { cardStyle: { backgroundColor: 'transparent' } } : undefined
)
```
`RouteName.VehicleClimateScreen` (iOS 5040724-5040745) is **byte-identical** in shape.

> **`transitionSpec` is NOT overridden at the route level.** The route only swaps the *interpolator*. In CardStack's option resolution (iOS 3332924-3332927) the merge is `transitionSpec = options.transitionSpec ?? preset.transitionSpec` — and `options.transitionSpec` is present (inherited from the navigator's `screenOptions` spread of `SlideFromRightIOS`). ⇒ **Controls animates with `TransitionIOSSpec`, but rendered as a FADE.**

### `forFade` — Tesla's OWN, not react-navigation's (iOS 1979635-1979644, verbatim)
Module **4488** (Tesla nav-utils; also exports `forBottomUp`, `forBottomUpNoFade`, `modalScreenOptions`, `getActiveRouteParams`). Confirmed by deps index: the VehicleScreens module (id **10680**, deps `[1, 3, 255, 2447, 4488, 708, ...]`, iOS 5041190-5041191) reads `r12[4]` → **4488**, then `.forFade`.
```js
forFade = ({ current }) => ({ cardStyle: { opacity: current.progress } })
```
Card opacity **is** the spring progress, 1:1, no easing on top.

### The animated node is in **PIXELS**, not 0..1
`gestureDirection: 'horizontal'` ⇒ react-navigation drives the card's gesture `Animated.Value` over `getDistanceForDirection(layout, 'horizontal') = layout.width` (fn at iOS 3334645-3334682). On the 393×852 reference phone: **393 → 0** on push. `progress = gesture.interpolate([0, 393] → [1, 0])`. This is why `restDisplacementThreshold: 10` / `restSpeedThreshold: 10` are sane — they're **px** and **px/s**.

### ⭐ Resolved timing of the Controls card fade — `[INFERRED — simulated, not read]`
Derived by evaluating RN's `SpringAnimation` closed-form solution with the verbatim config above, `startValue = 393`, `toValue = 0`, `v0 = 0`. **This is a computation from read constants, not a bundle-read duration — there is no literal duration to read on this path.**

- ζ = 500 / (2·√(1000·3)) = **4.5644 → OVERDAMPED** (no bounce; `overshootClamping` never fires)
- ω₀ = √(1000/3) = **18.257 rad/s**
- slow eigenvalue = −ω₀(ζ − √(ζ²−1)) = **−2.0246 /s → τ = 494 ms** ← this is the tail that costs you

| t (ms) | gesture (px) | progress = **card opacity** |
|---|---|---|
| 0 | 393.00 | 0.0000 |
| 100 | 324.97 | 0.1731 |
| 200 | 265.41 | 0.3247 |
| 300 | 216.76 | 0.4484 |
| **348** | ~198 | **0.5000** |
| 400 | 177.03 | 0.5495 |
| **500** | 144.59 | **0.6321** |
| 600 | 118.09 | 0.6995 |
| 800 | 78.77 | 0.7996 |
| 1000 | 52.54 | 0.8663 |
| **1143** | ~41 | **0.9000** |
| 1486 | ~19 | 0.9500 |
| **2183** | 4.79 | rest condition met → **snaps to 1** |

Rest: `|v| ≤ 10 px/s && |Δ| ≤ 10 px` first true at **t = 2183 ms** (v = −9.69 px/s, Δ = 4.79 px), at which point RN snaps the value to `toValue` and ends. `[INFERRED]`

**Perceptual read:** half the fade lands in ~350 ms (feels iOS-native), but the app is still visibly cross-fading at 1 s and only settles at ~2.2 s. **A flat 0.5s tween finishes ~2× sooner than Tesla's card fade in the region the eye actually tracks (0.6→1.0 opacity).** That is exactly the reported "ours looks slightly faster".

**Open/close symmetry:** `transitionSpec.open === transitionSpec.close === TransitionIOSSpec`. Pop (Controls→Home) uses the same curve mirrored, same 2183 ms rest. `[iOS-verified]`

### What Home does during the push
`RouteName.ProductHomeScreen` options (iOS 273330-273345, verbatim):
```js
{ cardStyle: { backgroundColor: Colors.transparent }, animation: 'none' }
```
`animation: 'none'` → `animationEnabled = false` → since ProductHomeScreen sets **no** `cardStyleInterpolator`, CardStack resolves it to **`forNoAnimation`** (iOS 3332940-3332944: `cardStyleInterpolator = options.cardStyleInterpolator ?? (animationEnabled ? preset.cardStyleInterpolator : forNoAnimation)`). Combined with Controls' `detachPreviousScreen: false`, **Home stays mounted and fully opaque underneath while the Controls card fades in over it.** It is a true cross-fade, not a slide. Home's own `animation:'none'` does **not** affect the Home→Controls push (only the top/animating card's spec is used).

Group-level `cardStyle` for the vehicle routes (iOS 273322-273327): `{backgroundColor: _closure2_slot18}` where `_closure2_slot18 = GodotModule.enabled && <flag> ? Colors.transparent : Themes[AppTheme.DARK].v5BackgroundColor` (iOS 273197-273215). With Godot enabled it's **transparent**, so the persistent GodotView shows through both cards throughout.

> **§3.2 verdict: the navigator's animation IS specified in the bundle** (`TransitionIOSSpec`, spring, verbatim above) — it is *not* an unspecified platform default. It is **~2× longer than the 0.5s camera tween** in the perceptible range, and it is what makes the real app read slower.

---

## §3.3 — Every concurrent animation on Home → Controls, on one timeline

`useIsFocused()` flips true at the *start* of the push in the JS stack, so t=0 for all of these is the moment `navigate()` fires.

| t | What | Duration / curve | Where |
|---|---|---|---|
| **0** | `moveCameraWithCompletion({position: TOP_DOWN, carType, completion})` → `MOVE_CAMERA` | **0.5 s / TRANS_QUART / EASE_OUT** | fn #98626, iOS 4039675 |
| **0** | `SET_ENV_PARAMS` (emitted inside `moveCamera` since `updateEnvironment` defaults true) | **0.5 s / TRANS_QUART / EASE_OUT** (same body, same timing) | iOS ~1172940 |
| **0** | `updateMainViewFrame(top, 0, SCREEN_WIDTH, SCREEN_HEIGHT−X)` → `UPDATE_MAIN_VIEW_FRAME` | **animated=true, 0.5 s / QUART / OUT** | fn #98623, iOS 4039613 |
| **0** | `updateProduct({id, type: VEHICLE, mobile_app_state:{is_loading:false, show_terrain:false}})` — only when productId ≠ null | not animated | iOS 4039651-4039674 |
| **0 → 2183** | **RN card opacity 0→1** (`forFade`, `TransitionIOSSpec` spring) | **spring; 50% @348ms, 90% @1143ms, rest @2183ms** | iOS 3333650 + 1979635 |
| **0** | `setScreenOverlayColor(ThemeContext.v5BackgroundColor, isSelectedVehicleDataUnreliable ? 0.5 : 0)` (useFocusEffect fn #98625, iOS 4039593) | **animated=true, duration=0.5 (= `defaultCameraAnimationDuration`), transition_type = LINEAR, ease_type = OUT** — defaults at iOS 1173390 / 1173398 / 1173408 | — |
| **150** | `showFXAbove(productId)` — `setTimeout(fn, 150)`, `150` inline at iOS 4039624 | instant call | fn #98623 |
| **~500** | camera tween completes → `MOVE_CAMERA_RESPONSE` → completion fires → `getVehicleMarkers(productId)` / `getVehicleMarkersFallback(productId, RouteName.VehicleControlsScreen)` | — | iOS 4039736-4039747 |
| **~500 → ~800** | **vehicle-marker overlay fade-in** — `Animated.timing(<Animated.Value(0)>, {toValue: 1, duration: 300, easing: Easing.cubic, useNativeDriver: true})` (verbatim object literal at **iOS 4039753**: `{'easing': null, 'toValue': 1, 'duration': 300, 'useNativeDriver': true}`, then `r1['easing'] = Easing.cubic`) | **300 ms / Easing.cubic** | iOS 4039752-4039759 |

### Home side (mirror, for the pop)
- fn #111018 (useFocusEffect, iOS 4562300+): `updateMainViewFrame(cameraInitialized)`, `moveCamera({position, carType, animated: cameraInitialized})`, then `forceCloseAllClosures(id, false)`, `fadeRoof(id, false)`, `updateProduct(...)`, `setTimeout(() => showFXAbove(id, false), 150)` — **`150` inline at iOS 4562391**.
- Home also runs `setScreenOverlayColor(<color>, 0)` in a useFocusEffect (iOS 4558808) → **0.5 s / LINEAR / OUT**.
- In the normal (data-reliable) case both screens set overlay alpha **0** → **no visible overlay change on Home↔Controls.** The overlay only matters when `isSelectedVehicleDataUnreliable` is true (Controls → 0.5).

### Root navigator overlay — does NOT fire on this path
`NavigationContainer.onStateChange` (iOS 4558xxx / 284674) does `setScreenOverlayColor(<color>, 1)` when the current route is **NOT** in a 30-entry whitelist. **`RouteName.ProductHomeScreen`, `RouteName.VehicleControlsScreen` and `RouteName.VehicleClimateScreen` are all in the whitelist** (iOS 284498 / 284504 / 284509). ⇒ **no full dim on Home↔Controls↔Climate.** (It *does* fire — 0.5 s / LINEAR / OUT to alpha 1 — when you leave to any non-renderer route.)

### No bottom sheet on Controls
Controls' screen module (4037008-4041000) contains no `@gorhom/bottom-sheet` usage (unlike Climate — R8 recon). Nothing else animates on this path.

---

## Recommendation for the team

The 0.5s / QUART / OUT camera is **correct — do not change it.** The gap is the RN card. To match:

1. Set the Controls (and Climate) route `cardStyleInterpolator` to `({current}) => ({cardStyle: {opacity: current.progress}})` and `detachPreviousScreen: false`.
2. Leave `transitionSpec` inherited from `TransitionPresets.SlideFromRightIOS` — i.e. **spring, `{stiffness: 1000, damping: 500, mass: 3, overshootClamping: true, restDisplacementThreshold: 10, restSpeedThreshold: 10}`**, on a **horizontal** gestureDirection (so the node spans `layout.width`, and the 10 px/10 px·s⁻¹ thresholds behave as Tesla's do).
3. Home route: `{cardStyle: {backgroundColor: 'transparent'}, animation: 'none'}`.
4. Add the 150 ms `showFXAbove` timeout and the post-camera 300 ms `Easing.cubic` marker fade.

If the team's stack is native-stack rather than JS stack, item 2 cannot be reproduced — native-stack has no `transitionSpec`. In that case the closest match is a **custom `Animated.spring` on a 0..layout.width value with the exact config above**, which yields the table in §3.2.

---

## UNRESOLVED / caveats

- **`layout.width = 393`** is `[INFERRED]` from the 393×852 reference phone. It's the CardStack container width; the spring's *shape* is width-independent (progress is normalized) but the **rest time is not**: rest is reached when the remaining displacement/velocity crosses the 10 px / 10 px·s⁻¹ thresholds, so a wider container ⇒ slightly later snap. The 852-tall (vertical) variant rests at 2567 ms. The 50%/90% progress marks (348 ms / 1143 ms) are **width-independent** and are the numbers to trust.
- All spring timings in §3.2 are **derived by simulation of RN's `SpringAnimation` math from the verbatim config**, not read from the bundle. **There is no duration literal on this path to read** — react-navigation specifies the motion as a spring. Documented as such rather than guessed.
- @react-navigation/stack **v7** is `[INFERRED]` (from the `ANIMATION_PRESETS` map + `Platform.Version >= 34` branch). `TransitionIOSSpec` is byte-identical across v5/v6/v7, so this does not affect any number above.
- Android `[Android-only]` cross-check of the navigator config against `bundle.hasm` was **NOT** performed this round — out of scope (we ship iOS), and `Platform.select` branches in `DefaultTransition`/`ModalTransition` mean the Android path differs by construction. `SlideFromRightIOS` and the route-level `forFade` override are platform-unconditional in the source read, so Controls almost certainly fades on Android too — but that is **UNVERIFIED**.
- The exact identity of `_closure2_slot65` (Home's `position`) is the R7 Home state machine (PARKED / CHARGING / DRIVE / …); not re-derived here.

## Line-number appendix (iOS)

| Fact | Line |
|---|---|
| `defaultCameraAnimationDuration = 0.5` | 1172928 |
| `defaultCameraAnimationTransition = QUART` | 1172930 |
| `defaultCameraAnimationEase = OUT` | 1172932 |
| `moveCamera` default-fill for duration / transition / ease | 1172954 / 1172958 / 1172966 |
| `updateMainViewFrame` positional defaults (animated/duration/transition/ease/scroll) | 1173248 / 1173265 / 1173271 / 1173277 / 1173290 |
| `updateMainViewFrame` message build | 1173318-1173330 |
| `setScreenOverlayColor(color, alpha, animated=true, duration=default 0.5, transition=LINEAR, ease=OUT)` | 1173339 (fn), 1173352 / 1173390 / 1173398 |
| Tesla `forFade` (card) — module 4488 | 1979635-1979644 |
| `AppStack = createStackNavigator()` (module 22) | 272536-272539 |
| Main-nav `screenOptions = assign({headerShown:false, presentation:'card'}, SlideFromRightIOS)` | 273262-273270 |
| `ProductHomeScreen` options `{cardStyle:{transparent}, animation:'none'}` | 273330-273345 |
| Group `cardStyle` = `_closure2_slot18` (transparent when Godot on) | 273197-273215, 273322-273327 |
| `onStateChange` overlay alpha 1 + 30-route whitelist (incl. ProductHome/Controls/Climate) | 284674, 284498 / 284504 / 284509 |
| `ANIMATION_PRESETS` map (v7 marker) | 3331558-3331608 |
| CardStack option merge: `transitionSpec ??`, `cardStyleInterpolator ?? (animationEnabled ? preset : forNoAnimation)` | 3332924-3332944 |
| `SlideFromRightIOS` preset | 3333371-3333395 |
| **`TransitionIOSSpec` verbatim** | **3333650-3333655** |
| `getDistanceForDirection` | 3334645-3334682 |
| Controls `setScreenOverlayColor` (fn #98625) | 4039593 |
| Controls `updateMainViewFrame` (fn #98623) | 4039613 |
| Controls `setTimeout(showFXAbove, 150)` | 4039624 |
| Controls `moveCameraWithCompletion({TOP_DOWN, carType, completion})` (fn #98626) | 4039675 |
| Controls marker fade `Animated.timing({toValue:1, duration:300, Easing.cubic})` | 4039752-4039759 |
| Home `setScreenOverlayColor(color, 0)` | 4558808 |
| Home `updateMainViewFrame` wrapper (statusBarHeight+60, GODOT_VIEW_SIZE, arg4=animated) | 4562236-4562278 |
| Home `moveCamera` call sites | 4562326 / 4562393 / 4562423 / 4559148 |
| Home `setTimeout(showFXAbove, 150)` | 4562391 |
| `VehicleControlsScreen` route options (forFade + detachPreviousScreen:false) | 5040644-5040670 |
| `VehicleClimateScreen` route options (identical) | 5040724-5040745 |
| VehicleScreens module id 10680 + deps array (index 4 → 4488) | 5041190-5041191 |
