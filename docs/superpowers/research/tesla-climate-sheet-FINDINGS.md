# The Climate sheet's geometry, and whether anything scales the car per-view (Round 8)

**Source of truth:** iOS `main.decompiled.js` (Tesla iOS **v4.56**) — the app we ship. Cross-checked against Android `bundle.hasm` (**v4.58**) and the 67 decompiled Godot `.gdc` scripts (R6 toolchain). All line numbers are **iOS bundle lines** unless tagged. Every load-bearing number was independently re-derived by a second agent (adversarial verify pass); where the verifier overturned a reader, the corrected value is what appears below.

**Headline: your `320 = sheet height` hypothesis is KILLED — but the real number is better news.**
The Climate sheet's collapsed height is **`270`**, from `snapPoints: [270]`. Yours is `height*0.25 = 213` → **57pt too short**, which is exactly the user's *"the sheet is smaller"*. The `320` in the frame formula is **not** the sheet's height; it appears exactly once in the whole Climate module — inside the frame formula itself.

**And: nothing scales the car on the Climate path. Confirmed exhaustively — stop hunting the scale bug.**

---

## §1. The Climate sheet — exact geometry `[iOS-verified]`

The panel is a **`@gorhom/bottom-sheet` v5** (module 4054, via Climate's `deps[10]`) rendered by `VehicleClimateScreen` (fn at iOS 5221432).

### 1a. The BottomSheet props — VERBATIM (iOS 5222699-5222719) `[both-match]`
```js
{ 'index': <useState(0)[0]>, 'onChange': <fn #120844>, 'snapPoints': [270],
  'animateOnMount': false, 'enableDynamicSizing': true, 'enableOverDrag': true,
  'enableHandlePanningGesture': true, 'enableContentPanningGesture': true,
  'enablePanDownToClose': false, 'keyboardBehavior': 'extend' }
```
```js
r11 = [270];              // iOS 5222718
r7['snapPoints'] = r11;   // iOS 5222719
```
- **`snapPoints = [270]` — one element.** It is the **only** `snapPoints` in the entire Climate module, and no `'CONTENT_HEIGHT'` string is used. `[both-match]` — Android v4.58 `bundle.hasm:5878954` = `NewArrayWithBufferLong … # Array: [270]`.
- **`index` = `useState(0)[0]`, never changed** (iOS 5222126-5222133). The setter is referenced exactly once — inside `onChange`, which only fires `setIndex(0)` if the sheet reports `-1`, and that is **unreachable** because `enablePanDownToClose: false`. ⇒ **the sheet always mounts collapsed at detent 0 and can never be dismissed.**
- `onChange` (fn #120844, iOS 5222701-5222717), verbatim: `if (index === -1) setIndex(0); return undefined;`

### 1b. Snap points resolved on a 393×852 / statusBarOffset 59 phone

gorhom v5 `normalizeSnapPoint` (iOS 1774333, verbatim): `return Math.max(0, containerHeight - normalizedSnapPoint)` — **snapPoints are HEIGHTS, normalized to TOP positions.**
`enableDynamicSizing` pushes a second detent (iOS 1773286): `containerHeight - Math.min(contentHeight + handleHeight, maxDynamicContentSize ?? containerHeight)`, then sorts **descending**.

| detent | height | sheet top y | source |
|---|---|---|---|
| **0 — collapsed / peek (mount state)** | **270** | **582** (= 852 − 270) | `snapPoints:[270]` literal |
| 1 — expanded | `contentHeight + 15` | `852 − (contentHeight + 15)` | dynamic, measured at runtime |

- **`containerHeight = 852`** `[inferred, well-evidenced]`: gorhom's container is `StyleSheet.absoluteFillObject + {top: topInset, bottom: bottomInset}` and Climate passes **neither** inset, so both default to 0 (iOS 1787395-1787410). Climate's root is `<View style={{backgroundColor: Colors.transparent, flex: 1}}>` (iOS 5221219-5221227), and its `AppStack.Screen` has `headerShown: false` with no `SafeAreaView` (iOS 5040700-5040742). This is the one load-bearing **inference** in §1 — it is not a literal.
- **The expanded detent is NOT statically recoverable** — `contentHeight` is measured by `BottomSheetView`'s `onLayout`. `handleHeight = 15` (= the SheetHandle's `height 5` + `marginTop 10`; see §1e).

### 1c. Is the `320` the sheet's height? — **NO. KILLED.** `[both-match]`

| | value |
|---|---|
| Collapsed sheet height | **270** (not 320) |
| Sheet top | **582** (not 532) |
| Car band (R7) | y **59 .. 612** (top 59, height `852−59−320+80` = 553) |
| **Actual car-band / sheet overlap** | **30 pt** (612 − 582) — **not 80** |

**This is not version skew.** Android v4.58 carries **both** the identical frame formula **and** `[270]` in the same shipping binary — `bundle.hasm` Function #126945 @5880847: `LoadConstInt Imm32: 320` / `Sub` / `LoadConstUInt8 UInt8: 80` / `AddN`, and `bundle.hasm:5878954` `Array: [270]`. iOS 4.56 and Android 4.58 agree.

### 1d. Is the `+80` an intentional overlap? — **Intent yes; magnitude no.**

Read as the author grouped it, `band_bottom = (SCREEN_HEIGHT − 320) + 80`: *reserve 320 at the bottom for the sheet, then push the band 80pt back down into that reserve so the car renders **behind** the sheet's top edge instead of being clipped flush against it.* That reading is supported by the literals being written as a separate subtract-then-add rather than the reduced `− 240`.

**But it is not calibrated to the real sheet.** A 320 reserve with an 80 overlap implies a sheet top at 532; the actual sheet top is 582. **Tesla's own `320` does not match Tesla's own `270` sheet** — the constant looks stale/uncalibrated in their code. The *shipped* result is what matters: **band 59..612, sheet top 582, 30pt of car hidden behind an opaque sheet.**

⚠️ **Do not "fix" this by deriving your band from your sheet height.** Ship the literals exactly: band `height = SCREEN_HEIGHT − statusBarOffset − 240` **and** sheet `270`. That reproduces Tesla pixel-for-pixel, including their own miscalibration.

### 1e. Sheet chrome — opaque, square-cornered `[iOS-verified]`

**Opacity: FULLY OPAQUE.** `theme.backgroundColor` = **`#161718`** (dark theme, iOS 1337948). **No BlurView, no vibrancy, no opacity** anywhere in the chain — the renderer behind it is completely hidden. gorhom's default background (`{backgroundColor:'white', borderRadius:15}`, iOS 1788331) is fully overridden.

Style literals (iOS 5221165-5221190, contiguous, verbatim):
```js
r0['bottomSheet']                = { backgroundColor: Colors.transparentWhite, elevation: 1 };
r0['bottomSheetBackgroundStyle'] = { borderRadius: 0 };                                   // ← SQUARE corners
r0['bottomSheetHandler']         = { height: 12 };                                        // ← DEAD (see below)
r0['bottomSheetShadow']          = { shadowOffset:{width:0,height:10}, shadowOpacity:1, shadowRadius:20 };
r0['handleIndicator']            = { marginTop: 2, width: 60 };                           // ← DEAD (see below)
```
Composed at the call site (iOS 5222720-5222760):
- `backgroundStyle` = `[{borderRadius:0}, bottomSheetShadow, {backgroundColor: theme.backgroundColor, shadowColor: '#000000'}]`
- `style` = `bottomSheet`; `BottomSheetView` style = `{backgroundColor: theme.backgroundColor}`
- `handleComponent` = `SheetHandle`; `handleStyle` = `bottomSheetHandler`; `handleIndicatorStyle` = `[handleIndicator, {backgroundColor: theme.reverseTextColor}]`

⚠️ **`handleStyle {height:12}` and `handleIndicatorStyle {marginTop:2, width:60, reverseTextColor}` are DEAD CODE.** Climate passes them, but it also passes `handleComponent = SheetHandle`, and **`SheetHandle` consumes no props** — its whole body (iOS 1766121, verbatim) is:
```js
function SheetHandle() { const { styles } = useStyles(); return <View style={styles.handle} />; }
```
**The real grabber** — `SheetHandle`'s own style (iOS 1766142-1766172), with `size.baseSize = 5` (iOS 1643606):
```js
handle = { width: baseSize*10 = 50, height: baseSize = 5, borderRadius: baseSize = 5,
           backgroundColor: colors.highlight, alignSelf: 'center',
           marginTop: baseSize*2 = 10, opacity: 0.2 }
```
⇒ **grabber = 50 × 5, radius 5, marginTop 10, opacity 0.2**, centred. The handle wrapper therefore measures **15** tall (5 + 10) — which is the `handleHeight` in the expanded-detent formula.

**Summary of what to build:** an opaque `#161718` panel, **`borderRadius: 0`** (square top corners), top at **y 582** (270 tall), shadow `offset (0,10) / radius 20 / opacity 1 / black`, with a **50×5 r5** grabber at 20% opacity, 10pt below the sheet's top edge.

### 1f. Is the frame re-sent when the sheet is dragged? — **NO. STATIC.** `[iOS-verified]`
1. `updateMainViewFrame` appears **exactly once** in the whole Climate module (iOS 5219700-5225196) — at 5222016.
2. Its `useEffect` dep array is **`[vehicleId]` only** (iOS 5222003-5222004): `r12 = new Array(1); r12[0] = r10;` where `r10 = r0.vehicleId`. ⇒ sent once on mount, and on vehicle switch. Never on drag.
3. The sheet passes **no** `onAnimate`, **no** `animatedPosition`, **no** `animatedIndex`; there is no `useAnimatedReaction` in the module. `onChange` does only the `-1 → 0` reset.

**⇒ The car band is fixed at the collapsed geometry.** When the user drags the sheet up, the car does **not** move or resize — it simply gets covered. Do not re-send the frame on drag.

---

## §2. Does anything scale the car on the CLIMATE path? — **NO. Unambiguously.** `[iOS-verified]` + `[both-match]` (Godot)

Answering the brief's §2.4 plainly, as requested: **there is no per-view, per-camera-position, per-screen, or Climate-specific scale anywhere.** Stop looking for a scale bug.

1. **No per-view transform.** Godot's `on_move_camera` touches **only** `pivot.rotation_degrees`, `camera.translation`, `camera.fov` — never `root`, `Slot`, `ProductSwitcher`, or the vehicle (`CameraManager.gd:44-69`). **`MOVE_CAMERA` has no scale field**, so it cannot carry one. An exhaustive grep for `scale` across **all 67 decompiled `.gdc` scripts** yields exactly **6 write sites**, and none is keyed on camera position or screen:
   - `root_node.scale` — the frame lever (`height/screen_height`), identical on all screens;
   - `slot.scale` — per **car_type**, set once at product swap in `show_product` (not per-view);
   - 2× `Snapshots.gd` — the offscreen `TAKE_SNAPSHOTS` path only;
   - `terrain.scale.y = 1.5` — the Terrain child (Climate sends `show_terrain: false`).
   `get_vehicle_scale()` (default **1.1**) is a **per-model export**, never per-view.

2. **`fadeRoof` IS official — you are right to send it.** ⚠️ **This corrects R7 §3a**, which implied `forceCloseAllClosures`/`fadeRoof`/`showFXAbove` were Service-carousel-only: **Climate calls all three.** The exact message, defaults resolved:
   ```json
   { "type": "FADE_ROOF", "data": { "vehicle_id": <id>, "fade": true, "animated": true, "duration": 0.25 } }
   ```
   (Climate passes only `vehicleId`; `duration = defaultCameraAnimationDuration(0.5) × 0.5 = 0.25`.) It affects **roof opacity only** — the Godot receiver tweens nothing but `albedo_color:a` / `shader_param/color:a` on `roof_fade_materials`. **No geometry, no transform, no scale.**

3. **`cam_fov 40` is never overridden — proven by construction**, not by absence of evidence. `moveCamera` resolves `pose = Object.assign({}, BASE_POSES[position], PER_CARTYPE_OVERRIDES[carType]?.[position] ?? {})`. The per-carType override table (`_closure1_slot23`) is built from exactly **two** `_defineProperty` calls and has exactly **two** keys — `CARTYPESEMITRUCK` (iOS 1169597) and `CARTYPECYBERTRUCK` (iOS 1169664); a grep for `CARTYPE` across the whole builder range 1169560-1169735 returns only those two lines. For `CARTYPEMODEL3`/`CARTYPEMODELY` the lookup is `undefined` → `{}` → **the base CLIMATE pose, byte-for-byte**. *(This independently re-confirms R7's ruling that Model 3/Y uses `offset [0,6,0.6]`, and that `[0,11,0.3]`/`[0,7,−0.5]` are Semi-only.)* Service's `ScaledSmallVehicleCamFov` remains the only viewport-dependent FOV.

### 2a. So why does the car *look* smaller? — occlusion, not scale

**The car pixels are identical**: same `root_node.scale` 0.6491, same `center_y` 335.5, same `cam_fov` 40, same pose. Only **occlusion** differs:

| | sheet height | sheet top | car band | band hidden | band visible |
|---|---|---|---|---|---|
| **Tesla** | **270** | **582** | 59..612 (553) | **30 pt** | 59..582 (**523**) |
| **Ours** | 213 | 639 | 59..612 (553) | **0 pt** | 59..612 (**553**) + 27pt gap |

⇒ You show **30pt more of the car's bottom** — the hood, in this straight-down CLIMATE view — plus **57pt more open space** below it. **That is "ours shows more hood", with no size change**, and it is consistent with the user's own *"the car bottom starts at the same position"*.

**On "mirrors slightly inward — the entire car":** *(hypothesis, stated as such)* no code path can produce it — the render is provably identical. The most likely explanation is a **relative-size illusion**: an identical car surrounded by 57pt more empty space and 30pt more visible body reads as smaller/narrower against a differently-proportioned panel. **Set the sheet to 270 and re-measure before treating this as a real defect** — if the mirrors are still inward at 270, that is a new finding and worth a fresh round, because nothing in this bundle explains it.

---

## §3. Transition speed `[iOS-verified]`

**1. No per-transition camera override — re-confirmed by reading the actual arg lists.** `moveCamera`/`moveCameraWithCompletion` take an **object** and destructure `{position, updateEnvironment, animated, duration, transitionType, easeType, carType}`; a caller can only override by naming a key. Controls (fn #98626, iOS 4039675) passes exactly `{position: TOP_DOWN, carType, completion}`; Home passes `{position, carType, animated}` (4562326), `{position, carType, animated:false}` (4562393), `{position, carType}` (4562423), `{position: PARKED, carType}` (4559148). **None names `duration`/`transitionType`/`easeType`** ⇒ the RN defaults **0.5s / TRANS_QUART / EASE_OUT** stand. R7 §5.3 holds.

**2. Yes — the RN navigator runs its own animation alongside.** `AppStack = createStackNavigator()` (`@react-navigation/stack`; v7 `[inferred]` from the ANIMATION_PRESETS map, iOS 3331558-3331608).
- Navigator `screenOptions` (iOS 273262-273270) = `Object.assign({headerShown:false, presentation:'card'}, TransitionPresets.SlideFromRightIOS)`.
- **`TransitionIOSSpec` — VERBATIM (iOS 3333650-3333655), stock react-navigation, unmodified by Tesla:**
  ```js
  { animation: 'spring',
    config: { stiffness: 1000, damping: 500, mass: 3, overshootClamping: true,
              restDisplacementThreshold: 10, restSpeedThreshold: 10 } }
  ```
- The **Controls route** (iOS 5040644-5040670) overrides **only** `cardStyleInterpolator` → Tesla's own **`forFade`** (`opacity = current.progress`, iOS 1979635) plus **`detachPreviousScreen: false`**. **`transitionSpec` is NOT overridden at the route level** — CardStack merges `options.transitionSpec ?? preset.transitionSpec` (iOS 3332924-3332927) and `options.transitionSpec` is inherited from the `SlideFromRightIOS` spread. ⇒ **Controls animates with `TransitionIOSSpec`, rendered as a fade.**
- **Card-fade timing** (closed form; the spring is critically damped, ω₀ = √(1000/3) = 18.257 rad/s):
  `opacity = 1 − e^(−u)(1+u)`, `u = ω₀·t` → **50% ≈ 92 ms, 90% ≈ 213 ms, rest ≈ 479 ms** (at layout width 393).
  ⚠️ An earlier pass claimed 348 ms / 1143 ms / **2183 ms**; the verify pass **overturned** those as a simulation error. The card settles at **~479 ms**, i.e. essentially in step with the 0.5s camera tween — so **"Tesla has a long slow tail" is NOT the explanation.**
- **Home's outgoing card uses `forHorizontalIOS`**, not `forNoAnimation` (an earlier claim, **refuted** on verify). Under `forHorizontalIOS` the unfocused card takes `translateX = next.progress → [0, −0.3 × layout.width]` = a **118 px leftward parallax slide** of the Home card, running concurrently with the Controls card's fade-in. **This is the most likely thing you're missing** — Tesla's transition is a fade-in over a *sliding* Home card, not a static cross-fade.

**3. Other concurrent animation:** `setScreenOverlayColor` (signature confirmed: `(color, alpha, animated=true, duration=0.5, transition_type=LINEAR, ease_type=OUT)`, iOS 1173339-1173408) is a **no-op on Home↔Controls** in the normal case — Controls sets `alpha = isSelectedVehicleDataUnreliable ? 0.5 : 0` (iOS 4039593) and Home sets `alpha 0` (iOS 4558808); both 0. *(A claimed post-camera vehicle-marker fade was **refuted** on verify — there is nothing there to match.)*

**To match:** on the Controls (and Climate) route set `cardStyleInterpolator = ({current}) => ({cardStyle:{opacity: current.progress}})` and `detachPreviousScreen: false`, inherit `transitionSpec` from `TransitionPresets.SlideFromRightIOS`, and ensure the **outgoing Home card slides left 0.3×width** via `forHorizontalIOS`.

---

## §4. Gaps (stated plainly)

- **Why `320` exists is UNRESOLVED.** No comment, no name, no dead constant, no adjacent 320 anywhere in the module or its dep graph — it occurs exactly once. Best available reading is a stale "sheet reserve" that no longer matches the 270 sheet (§1d). We ship the literal regardless.
- **The expanded detent is not statically recoverable** — `contentHeight + 15`, measured at runtime by `BottomSheetView.onLayout`. If you need it, measure on-device; the collapsed 270 is what mounts and is what matters.
- **`containerHeight = 852` is an inference**, not a literal (§1b) — it rests on gorhom's container being `absoluteFillObject` with both insets defaulting to 0 and Climate having no SafeAreaView. It is the single load-bearing assumption in §1. If your sheet top doesn't land at 582 on-device, this is the thing to check first.
- **Grabber colour `colors.highlight` — hex UNRESOLVED.** The token's palette entry wasn't located this pass; it is *not* `handleIndicator`/`reverseTextColor` (dead code). The geometry (50×5, r5, marginTop 10, **opacity 0.2**) is verified.
- **`@react-navigation/stack` v7 is inferred** from the presets map, not read from a version literal.
- **The bundle cannot prove the two builds render identically** — it can only prove nothing in Tesla's code scales the car per-view. The "mirrors inward" report needs an on-device re-measure after the sheet is set to 270.

---

## §5. Citations (iOS v4.56 unless noted)

- Sheet: props 5222699; `snapPoints [270]` 5222718; `onChange` 5222701-5222717; `index` useState(0) 5222126-5222133; styles 5221165-5221190; `handleIndicator` 5221261; Climate root View 5221219-5221227.
- gorhom v5: module 4054 reg 1772174; `normalizeSnapPoint` 1774333; `useAnimatedDetents` 1773286; container insets 1787395-1787410; default background 1788331; handle container 1757541.
- `SheetHandle` 1766121, styles 1766142-1766172; `baseSize = 5` 1643606; `theme.backgroundColor #161718` 1337948.
- Frame: fn #120832 5222006-5222048 (320@5222037, 80@5222043); deps `[vehicleId]` 5222003-5222004.
- Camera/pose: `moveCamera` pose merge + carType table 1169560-1169735 (`CARTYPESEMITRUCK` 1169597, `CARTYPECYBERTRUCK` 1169664); `setScreenOverlayColor` 1173339-1173408.
- Navigator: `screenOptions` 273262-273270; `TransitionIOSSpec` 3333650-3333655; CardStack merge 3332924-3332927; Controls route 5040644-5040670; `forFade` 1979635.
- Android `[both-match]`: `snapPoints [270]` `bundle.hasm:5878954`; frame formula `bundle.hasm` Fn #126945 @5880847.
- Godot: `CameraManager.gd:44-69`; R6 appendix `tesla-renderer-frame-appendix/`.
