# R10 §3 — Climate (iOS v4.56 `main.decompiled.js`, cross-ref Android v4.58)

All line numbers = iOS `/Users/ivan/Downloads/tesla-haptics-work/main.decompiled.js`.
Tags: [iOS-verified] unless noted. WE SHIP iOS.

---

## Module map established this round (new, load-bearing)

Define-call pattern at end of each module: `r6 = <moduleId>; r5 = [deps]; r5 = r8.bind(r2)(r7, r6, r5);`

| Module | Define @ | Body span | What |
|---|---|---|---|
| **4054** | 1772174 | ~1722500–1772174 | **Tesla-vendored** gorhom BottomSheet (`tesla_BottomSheetTsx*` worklets) |
| — | ~1795000 | 1772175–~1795000 | A **second, different** gorhom copy (`gorhom_*Tsx*`, v5-style `detents`/`evaluatePosition`). **NOT used by Climate.** |
| **8667** | 3991729 | 3980018–3991729 | Vehicle control buttons (`SeatHeaterControlButton`, steering-wheel, `SEAT_HEATER_BUTTON_SIZE`) |
| **11024** | 5225197 | ~5220600–5225197 | **Climate screen** (the BottomSheet host) |
| **11027** | 5227040 | ~5225611–5227040 | **`VehicleClimateControlsOverlay`** (the markers) |

Climate screen module **11024** deps (5225208, VERBATIM):
`[1, 41, 3, 5, 11025, 11026, 8667, 2395, 2295, 8567, 4054, 4353, 2434, 4349, 709, 255, 2370, 2348, 2313, 2394, 2429, 2441, 2447, 4232, 8561, 2369, 4227, 4357, 1135, 1124, 1146, 4967, 1123, 2309, 2392, 4488, 2443, 1147, 1125, 2432, 8715, 1113, 4164, 11027, 4355, 2452, 4346, 2469, 2468, 4354, 4376, 4359, 2456, 2676, 1554, 4342, 8743, 8562]`

`_closure1_slot11` (5220711) = `interop(require(deps[10]))` → **deps[10] = 4054**. ✅ R8's "module 4054" **confirmed**, and it is the **Tesla-vendored** copy, not the v5 `gorhom_*` one.

---

## A. THE CONTRADICTION — SETTLED

### A1. Are the props really `animateOnMount: false`? — **YES. R8 CONFIRMED.**

iOS **5222699**, VERBATIM, unfiltered:

```js
r7 = {'index': null, 'onChange': null, 'snapPoints': null, 'animateOnMount': false,
      'enableDynamicSizing': true, 'enableOverDrag': true, 'enableHandlePanningGesture': true,
      'enableContentPanningGesture': true, 'enablePanDownToClose': false, 'keyboardBehavior': 'extend'};
```
Then overwritten in place: `r7['index']=r11` (useState(0)[0]), `r7['onChange']=<fn#120844>`, `r7['snapPoints']=[270]`. `animateOnMount` is **never** reassigned. R8's dump is exact.

**And the flag is NOT swallowed by the default-merge.** iOS **5222084-5222093** (module 4054, `r3 = undefined`):
```
r54 = r9.animateOnMount;
if(!(r54 === r3)) { ip = 113 }   // ≡ if (animateOnMount !== undefined) goto 113  → keep prop
case 87:  r54 = r6.DEFAULT_ANIMATE_ON_MOUNT;   // only when undefined
case 113: var _closure2_slot2 = r54;
```
This is a `??`, **not** a `||`. `false !== undefined` ⇒ **`animateOnMount` stays `false`**. (`DEFAULT_ANIMATE_ON_MOUNT = true`, 1723424 — irrelevant here.)

Same shape two lines up gives `_providedIndex = props.index ?? 0` (1752076-1752082) ⇒ **`_providedIndex = 0`**.

### A2. So what produces the observed slide-up? — **RULED OUT: (a), (b), (c). No slide-up is produced by any path I can find.**

**(c) gorhom animating despite the flag — RULED OUT.**
The mount reaction, iOS **1752017**, VERBATIM:
```js
function tesla_BottomSheetTsx19(_isLayoutCalculated){
  const{isAnimatedOnMount,_providedIndex,animatedClosedPosition,animatedNextPositionIndex,
        animatedSnapPoints,runOnJS,print,BottomSheet,INITIAL_POSITION,animatedCurrentIndex,
        animateOnMount,animateToPosition,ANIMATION_SOURCE,animatedPosition}=this.__closure;
  if(!_isLayoutCalculated||isAnimatedOnMount.value){return;}
  let nextPosition;
  if(_providedIndex===-1){nextPosition=animatedClosedPosition.value;animatedNextPositionIndex.value=-1;}
  else{nextPosition=animatedSnapPoints.value[_providedIndex];}
  runOnJS(print)({...});
  if(nextPosition===INITIAL_POSITION||nextPosition===animatedClosedPosition.value){
    isAnimatedOnMount.value=true;animatedCurrentIndex.value=_providedIndex;return;}
  if(animateOnMount){animateToPosition(nextPosition,ANIMATION_SOURCE.MOUNT);}
  else{animatedPosition.value=nextPosition;}          // ← Climate takes THIS branch
  isAnimatedOnMount.value=true;
}
```
`animateOnMount === false` ⇒ **`animatedPosition.value = nextPosition`** — a bare shared-value write, **instantaneous, no animation**. This is what `animateOnMount` gates: *the entire mount transition*, nothing subtler.

Critically, the reaction **cannot fire early with a garbage position**, because its trigger is `isLayoutCalculated` (prepare fn `tesla_BottomSheetTsx18`, 1752013), and `isLayoutCalculated` (**`tesla_BottomSheetTsx5`**, iOS **1751965**, VERBATIM) requires snap points to already be **normalized**:
```js
let isSnapPointsNormalized=false;
if(animatedSnapPoints.value[0]!==INITIAL_SNAP_POINT){isSnapPointsNormalized=true;}
return isContainerHeightCalculated&&isHandleHeightCalculated&&isSnapPointsNormalized;
```
So by the time the reaction runs, `animatedSnapPoints.value[0]` is a real pixel position ⇒ the `nextPosition===INITIAL_POSITION` early-return is not taken ⇒ instant set. **The sheet POPS to its detent; it does not slide.**

**(a) the card transition — RULED OUT as a slide.**
Climate's `AppStack.Screen` options, iOS **5040725-5040733**: overrides **`cardStyleInterpolator` → `forFade`** + `detachPreviousScreen` — i.e. **exactly the same override as Controls**, *not* the inherited `SlideFromRightIOS` horizontal. (Plus, only when `isOHOS()`, an extra `Object.assign` of `{cardStyle:{backgroundColor:'transparent'}}`.) `forFade` is **opacity-only**. It cannot translate the sheet upward. ⇒ **NEW — corrects the natural assumption that only Controls overrides the interpolator; Climate does too.**

**(b) a separate Animated/Reanimated on the sheet container — RULED OUT.**
Module 11024 (5220600–5225197) contains **zero** occurrences of `Animated`, `entering`, `withTiming`, `withSpring`, `useSharedValue`, or `Reanimated` (case-insensitive count = 0). The Climate screen wraps the sheet in nothing animated.

**Where a slide COULD still come from (candidate, NOT confirmed):** the snap-point-change reaction `tesla_BottomSheetTsx21` (iOS **1752025**) *does* call `animateToPosition(..., ANIMATION_SOURCE.SNAP_POINT_CHANGE, 0, undefined)` — a real spring — but only when `snapPoints` **change again after** `isAnimatedOnMount` is already `true`, and it early-returns on `JSON.stringify(snapPoints)===JSON.stringify(_previousSnapPoints)`. With `enableDynamicSizing:true` the dynamic detent is recomputed from `contentHeight`, so a late content re-measure would fire it. **I have no evidence Climate's content re-measures on entry, so I am not claiming this is the observed slide.**

> ### VERDICT
> **The bundle does not contain a Climate sheet entrance slide.** `animateOnMount:false` is real, gorhom honours it with an instant `animatedPosition.value = nextPosition`, the card is a pure fade, and the screen adds no animation of its own. **R8 is vindicated; the contradiction resolves against the observation as stated.**
>
> Most likely reconciliations, in order — **all UNVERIFIED, needs a device**:
> 1. The user is seeing the **markers'** own 300 ms fade (§6 below — that one is real and does animate) and reading it as the sheet moving.
> 2. The user is seeing the **content-height spring**, `tesla_BottomSheetTsx16` (iOS 1752005): `{height: animate({point: animatedContentHeightMax.value, configs:_providedAnimationConfigs})}` — the sheet **content** height is spring-animated even when position is not. This *can* look like the sheet growing upward.
> 3. A late dynamic-sizing snap-point change firing reaction 21 (above).
> 4. The observation is of a different sheet. Note **7632647** has `animateOnMount: true`.

### A3. The sheet's entrance, exactly

| | |
|---|---|
| **Property** | `transform: [{ translateY: animatedPosition }]` on the sheet container (`tesla_BottomSheetTsx15`, iOS **1752001**, VERBATIM: `return{opacity:Platform.OS==='android'&&animatedIndex.value===-1?0:1,transform:[{translateY:animatedPosition.value}]};`) — note the `opacity` term is **Android-only**; on iOS opacity is constant `1`. [differ] |
| **From** | `INITIAL_POSITION` = **`SCREEN_HEIGHT`** (iOS **1723453-1723454**, VERBATIM: `r3 = r3.SCREEN_HEIGHT; r2['INITIAL_POSITION'] = r3;`) = **852** on 393×852 |
| **To** | `animatedSnapPoints.value[0]` — R8's collapsed 270 ⇒ top y **582** |
| **Duration / easing** | **NONE — instantaneous.** Single shared-value write on the first frame where `isLayoutCalculated` flips false→true. |
| **Trigger** | `useAnimatedReaction(() => isLayoutCalculated.value, tesla_BottomSheetTsx19)` — fires when container height **and** handle height **and** normalized snap points are all resolved. |

Gorhom constants VERBATIM (iOS **1723416-1723454**), for the offline port:
```
INITIAL_VALUE                        = Number.NEGATIVE_INFINITY
INITIAL_SNAP_POINT                   = -999
INITIAL_CONTAINER_HEIGHT             = -999
INITIAL_HANDLE_HEIGHT                = -999
INITIAL_CONTAINER_OFFSET             = {top:0, bottom:0, left:0, right:0}
INITIAL_POSITION                     = SCREEN_HEIGHT
DEFAULT_HANDLE_HEIGHT                = 24
DEFAULT_OVER_DRAG_RESISTANCE_FACTOR  = 2.5
DEFAULT_ANIMATE_ON_MOUNT             = true
DEFAULT_DYNAMIC_SIZING               = false
DEFAULT_ENABLE_CONTENT_PANNING_GESTURE = true
DEFAULT_ENABLE_HANDLE_PANNING_GESTURE  = true
DEFAULT_ENABLE_OVER_DRAG               = true
DEFAULT_ENABLE_PAN_DOWN_TO_CLOSE       = false
DEFAULT_KEYBOARD_BEHAVIOR    = KEYBOARD_BEHAVIOR.interactive
DEFAULT_KEYBOARD_BLUR_BEHAVIOR = KEYBOARD_BLUR_BEHAVIOR.none
DEFAULT_KEYBOARD_INPUT_MODE  = KEYBOARD_INPUT_MODE.adjustPan
```

**If it DID animate** (i.e. if you set `animateOnMount:true` in the port), the spring would be `ANIMATION_CONFIGS` (iOS **1722766**, VERBATIM):
`{damping:500, stiffness:1000, mass:3, overshootClamping:true, restDisplacementThreshold:10, restSpeedThreshold:10}`
— **numerically identical to `TransitionIOSSpec`** (R7). Dispatch is in `tesla_animateTs1` (iOS **1749329**): `'duration' in configs || 'easing' in configs ? withTiming : withSpring`.

Snap-point normalization, `tesla_useNormalizedSnapPointsTs1` (iOS **1748976**, VERBATIM) — note it **sorts DESCENDING** (`b-a`), so index 0 = largest position = **lowest** sheet:
```js
const isContainerLayoutReady=containerHeight.value!==INITIAL_CONTAINER_HEIGHT;
if(!isContainerLayoutReady){return[INITIAL_SNAP_POINT];}
let _normalizedSnapPoints=_snapPoints.map(sp=>normalizeSnapPoint(sp,containerHeight.value));
if(enableDynamicSizing){
  if(handleHeight.value===INITIAL_HANDLE_HEIGHT){return[INITIAL_SNAP_POINT];}
  if(contentHeight.value===INITIAL_CONTAINER_HEIGHT){return[INITIAL_SNAP_POINT];}
  _normalizedSnapPoints.push(containerHeight.value-Math.min(contentHeight.value+handleHeight.value,
     maxDynamicContentSize!==undefined?maxDynamicContentSize:containerHeight.value));
  _normalizedSnapPoints=_normalizedSnapPoints.sort((a,b)=>b-a);
}
return _normalizedSnapPoints;
```
`animatedClosedPosition` (`tesla_BottomSheetTsx3`, 1751953) = `animatedContainerHeight` (Climate is neither `$modal` nor `detached`).

---

## B. THE MARKER COLOURS

### B4. Seat / steering-wheel heater glyph — FULL colour set

**The tint tokens exist in exactly 3 theme variants**, and the values are **identical across LIGHT and DARK**; only CYBERTRUCK differs.

| Token | LIGHT (@1337919-1337924) | DARK (@1338116-1338119) | CYBERTRUCK (@1338293-1338300) |
|---|---|---|---|
| `buttonHeaterOn` | **`#FF3A3A`** | **`#FF3A3A`** | **`#FF3A3A`** |
| `buttonHeaterOff` | **`#999999`** | **`#999999`** | **`#898989`** (`Night.textSecondary`) |
| `buttonCoolerOn` | **`#3E6BE2`** | **`#3E6BE2`** | **`#3E6BE2`** |
| `buttonDefrostOn` | `#FF4C4C` | `#FF4C4C` | `#FF4C4C` |

Provenance, VERBATIM:
- `r23 = '#FF3A3A';` @ **1337798**; `r14 = '#999999';` @ **1337752**; `r21 = '#3E6BE2';` @ **1337921**; `r20 = '#FF4C4C';` @ **1337923**.
- Theme keys: `r5 = r3.LIGHT; r6['theme'] = r5;` @ **1337943-1337944**; `r6 = r3.DARK;` @ **1337947**; `r10 = r3.CYBERTRUCK; r5['theme'] = r10;` @ **1338313-1338314**.
- DARK block (1337948–1338118) contains **no reassignment** of `r23`/`r14`/`r21` (verified by scan) ⇒ DARK inherits LIGHT's literals. `r14` is only re-bound to `'#2D2F34'` at **1338125**, *after* the DARK block closes.
- CYBERTRUCK: `r22 = ....Night.textSecondary; r5['buttonHeaterOff'] = r22;` @ **1338294-1338298**; `Night = {..., 'textSecondary': '#898989', ...}` @ **1338467**.
- **There is NO `buttonCoolerOff` token anywhere in the bundle.**

#### ⚠️ The headline finding: **there is no per-level tint. Level lives in the ICON ASSET.**

**Seat glyph** — `SeatHeaterControlButton`, iOS **3986556**; tint site iOS **3987775-3987784**, VERBATIM:
```
r21 = {};
if(!r5) { ip = 1789 }
case 1782: if(!r24) { ip = 1789 }
case 1785: if(!(!(r23 > r22))) { ip = 1797 }    // ≡ if (r23 > r22) goto 1797
case 1789: r22 = r17.buttonHeaterOn;  ip = 1803
case 1797: r22 = r17.buttonCoolerOn;
case 1803: r21['color'] = r22;
r7['iconStyle'] = r21;
```
⇒ `iconStyle.color` is **`buttonCoolerOn` iff (r5 && r24 && r23 > r22), else `buttonHeaterOn`**. Both outcomes are **"On" tokens**. The seat glyph is `#FF3A3A` when in heat mode and `#3E6BE2` when in cool mode — **at every level including OFF**. It never uses `buttonHeaterOff`.
> `r5`/`r22`/`r23`/`r24` — **UNRESOLVED** (heat-vs-cool mode + level compare). The *set of possible tints* at this site is read directly and is closed at those two tokens; only the selector between them is unresolved.

**Steering-wheel glyph** — iOS **3988352-3988361**, VERBATIM:
```
if(!(r4 !== r26)) { ip = 447 }                  // ≡ if (r4 === r26) goto 447
case 433: r7 = {}; r5 = r17.buttonHeaterOff; r7['color'] = r5;  ip = 462
case 447: r5 = {}; r14 = r17.buttonHeaterOn;  r5['color'] = r14; r7 = r5;
case 462: ...
```
with `r4 = isSteeringWheelHeaterOn(<state>)` (iOS **3988322**) and `r26 = true` (iOS **3988344**).

⇒ **`isSteeringWheelHeaterOn === true` → `buttonHeaterOn` (`#FF3A3A`); otherwise → `buttonHeaterOff` (`#999999`, or `#898989` on Cybertruck).**

**This is the user's observation** — and note it is **only true of the steering wheel**, not the seats.

| Element | State | Token | LIGHT/DARK | CYBERTRUCK |
|---|---|---|---|---|
| **Steering wheel** | on (any level) | `buttonHeaterOn` | `#FF3A3A` | `#FF3A3A` |
| **Steering wheel** | off | `buttonHeaterOff` | `#999999` | `#898989` |
| **Seat** — heat mode | **all levels incl. OFF** | `buttonHeaterOn` | `#FF3A3A` | `#FF3A3A` |
| **Seat** — cool mode | **all levels incl. OFF** | `buttonCoolerOn` | `#3E6BE2` | `#3E6BE2` |
| **Seat caption text** | always | `buttonHeaterOff` | `#999999` | `#898989` |

The seat **caption** (`<Text category={TextCategory.P3} style={{color: buttonHeaterOff}}>`, iOS **3987727-3987729**) is a *label*, **not** the glyph — do not confuse the two. Third `buttonHeaterOff` use @ **3988835** (steering-wheel label, same pattern).

#### *disabled* vs *off* — **UNRESOLVED, flagged**
`SeatHeaterControlButton` passes a **`disabled`** prop to `ControlButton` alongside `iconStyle` (iOS 3987708-3987712: `r11['disabled'] = r25`). The generic `generateControlButtonThemedStyles` (iOS **1340900-1341040**) does have a disabled path — for `STATELESS_GHOST` it returns `{textColor: r5, iconTintColor: r5}` where `r5` is swapped to `buttonIconColorDisabled` when `status === ControlButtonStatus.DISABLED` (iOS 1340919-1340926, VERBATIM: `r10 = r9.DISABLED; r9 = a2; if(!(r9 === r10)) {ip=239}; case 236: r5 = r0;` with `r0 = <theme>.buttonIconColorDisabled`). **But**: (i) that theming fn lives in a module I did **not** confirm is the one `ControlButton` (module 8667 dep index 14) actually consumes — there are **two copies** (1340789 and 3355150); (ii) the button passes `disabled`, *not* `status`; (iii) whether `iconStyle.color` (a raw style) or `iconTintColor` (themed) wins is inside `ControlButton`'s render, which I did not read.
**⇒ Whether a *disabled* (unavailable) seat/wheel marker differs from an *off* one is NOT RECOVERABLE from what I read. Do not guess it.** Next step: read `ControlButton`'s render in module 8667 dep[14].

`ControlButtonAppearance` enum VERBATIM (iOS **1340798-1340810**): `STATELESS_FILLED:'stateless_filled'`, `STATELESS_FEEDBACK:'stateless_feedback'`, `STATELESS_GHOST:'stateless_ghost'`, `STATEFUL_ON:'stateful_on'`, `STATEFUL_OFF:'stateful_off'`.
`ControlButtonStatus` VERBATIM (1340815-1340826): `EDITING:'editing'`, `DISABLED:'disabled'`, `BUSY:'busy'`, `NONE:'none'`.
`ControlButtonColorScheme` VERBATIM (1340811-1340814): `DEFAULT:'default'`, `ALTERNATIVE:'alternative'`.
The Climate overlay passes `appearance: ControlButtonAppearance.STATELESS_GHOST` (iOS 5226155-5226160).

### B5. Geometry

- **`SEAT_HEATER_BUTTON_SIZE = 55`** — VERBATIM, iOS **3980311-3980312**: `r3 = 55; r2['SEAT_HEATER_BUTTON_SIZE'] = r3;` (exported).
- **Levels are NOT wave-fills drawn at runtime — they are 4 discrete icon assets.** `seatHeatingIcon` (fn `_fun97708`, iOS **3987896-3987975**) read **fully unfiltered**, every branch followed:

| `SeatHeaterLevel_E` | jump | returns |
|---|---|---|
| `SEATHEATERLEVELOFF` | `→277` | `IconName.seat_climate_0` |
| `SEATHEATERLEVELLOW` | `→243` | `IconName.seat_climate_1` |
| `SEATHEATERLEVELMED` | `→209` | `IconName.seat_climate_2` |
| `SEATHEATERLEVELHIGH` | `→175` | `IconName.seat_climate_3` |
| anything else | falls to `case 173` | **`undefined`** (`return r2`, `r2 = undefined`) |

  `seatCoolingIcon` (fn `_fun97707`, iOS **3987814-3987893**) is **structurally identical** and returns the **SAME four assets** `seat_climate_0..3` keyed on `SeatCoolingLevel_E.SEATCOOLINGLEVEL{OFF,LOW,MED,HIGH}`.
  ⇒ **Heat and cool share one icon set; only the tint (`#FF3A3A` vs `#3E6BE2`) distinguishes them.** There is **no** `auto` glyph at this site and **no** level-4+.
- Wrapper/selector helpers: `getSeatClimateIcon(a0,a1,a2,a3)` iOS **3987978**; `getSteeringWheelIconNameFromHeaterLevel(a0,a1)` iOS **3988019** (its own `IconName` chain @ 3988171-3988244 — **NOT decoded**, needs a pass).
- Overlay-side layout (`SeatHeaterControlButton` render): marker container `left = <pos>.left - r32/r33 + 27.5`, `top = <pos>.top - (-30)`, `height = 30`, `width = r32`; caption block `top = <pos>.top + 37`, `width = 80`, `alignItems:'center'` (iOS 3987500-3987513, 3987700-3987713). `hitSlop = {top:5, left:5, right:5, bottom:4294967276}` (iOS 3987655 — `4294967276` is **−20** read as u32; a **20px upward** hit extension). Level-picker popover `animationDuration = 250` (iOS 3987600).
- Level cycling, `increaseHeaterLevel` (iOS **3986393**, unfiltered): **OFF→HIGH, HIGH→MED, MED→LOW, LOW→OFF** (cycles *down* from HIGH). `increaseCoolerLevel` (iOS **3986470**) identical over `SeatCoolingLevel_E`. `nextStwHeaterLevel` @ **3987745**.
- Overlay position helpers: `getButtonPosition(a0)` iOS **5225795** → `a0 != null ? {horizontal:a0[0], vertical:a0[1]} : null`. `getSeatHeaterPositions(a0)` iOS **5225815** → maps `seatRow1L/1R/2L/2M/2R/2BackL/2BackR/3L/3R` → `front_left, front_right, rear_left, rear_center, rear_right, rear_left_back, rear_right_back, third_row_left, third_row_right` (each via `getButtonPosition`), or `null` if `a0 == null`. Both VERBATIM.

### B6. Do the Climate markers fade with the card? — **NO. They run their OWN entrance.**

`VehicleClimateControlsOverlay` (fn `_fun120884`, iOS **5225920**) holds its own **legacy `Animated.Value(0)`** (iOS 5226287-5226296, `_closure2_slot7`), applied as **opacity** on the overlay's `Animated.View` (iOS **5226525-5226534**, VERBATIM):
```
r4 = r4.Animated; r5 = r4.View; r4 = {};
r22 = _closure1_slot13; r23 = r22.buttonsOverlay;
r22 = new Array(2); r22[0] = r23;
r23 = {}; r23['opacity'] = r24;      // r24 = Animated.Value(0)
r22[1] = r23; r4['style'] = r22;
```
driven at iOS **5226415-5226425**, VERBATIM:
```
r5 = _closure1_slot4; r4 = r5.Animated; r3 = r4.timing;
r2 = _closure2_slot7;
r1 = {'easing': null, 'toValue': 1, 'duration': 300, 'useNativeDriver': true};
r5 = r5.Easing; r5 = r5.cubic; r1['easing'] = r5;
r2 = r3.bind(r4)(r2, r1); r1 = r2.start; r1 = r1.bind(r2)();
```

⇒ **Markers: `opacity 0 → 1`, `Animated.timing`, `duration: 300`, `easing: Easing.cubic`, `useNativeDriver: true`.**
**Trigger:** *not* mount — it fires in the **vehicle-markers callback**, immediately after `getVehicleMarkersFallback(<carType>, RouteName.VehicleClimateScreen)` resolves (iOS 5226405-5226413). Gated on `useIsFocused()` (`_closure2_slot2`, iOS 5226115-5226120).

This **contrasts with R7 §5.3** (camera/env/frame all fire same tick @ 0.5s / TRANS_QUART / EASE_OUT) and with the card's `forFade` spring (~479ms). **Three different timings on one screen entry** — the markers' 300ms cubic is its own thing. `Easing.cubic` = `t³` (ease-**in**, not out).

For the port: fallback path uses `CarType.CARTYPEMODELY` as the default when carType is absent (iOS 5226395-5226397).

### B7. Does paint colour reach the Climate markers? — **NO.**

`isLightColorFor` has **exactly one callsite in the entire bundle**:

| Line | Kind |
|---|---|
| 500287 | definition (`// Original name: isLightColorFor`) |
| 500442 | export (`r2['isLightColorFor'] = r3`) |
| **1240094** | **the only call** — fn #30232, the Controls-side selector you recon'd |

Occurrence counts, measured:
- module **11024** (Climate screen): **0**
- module **11027** (`VehicleClimateControlsOverlay`): **0**
- module **8667** (`SeatHeaterControlButton` / steering wheel): **0**

⇒ **Paint colour does not reach the Climate markers, by any path.** Their tint is a closed 3-token set (`buttonHeaterOn` / `buttonCoolerOn` / `buttonHeaterOff`) read straight off the theme, with **no paint input**. This is the opposite of §2.3's Controls answer. The only paint-sensitive knob nearby is the **theme variant** (LIGHT / DARK / **CYBERTRUCK**) — and Cybertruck is selected by `carType`, not paint (consistent with fn #30232 case 165 short-circuiting Cybertruck to `false` before ever consulting paint).

---

## Corrections / deltas vs prior rounds

1. **R8 CONFIRMED, not refuted.** `animateOnMount:false` is verbatim and is honoured. The "contradiction" resolves against the observation.
2. **NEW — Climate's route overrides `cardStyleInterpolator` → `forFade`** (iOS 5040725-5040733), same as Controls. Prior rounds only established this for Controls; do not assume Climate inherits `SlideFromRightIOS`.
3. **NEW — module 4054 is the *Tesla-vendored* BottomSheet**, and a **second, distinct gorhom v5 copy** (`gorhom_*`, `detents`/`evaluatePosition`, define ~1795000) also ships. They differ (the v5 one has `setToPosition`/`reduceMotion`/`ANIMATION_STATUS`). **Reading the wrong one gives the wrong mount semantics.** Climate → 4054.
4. **NEW — `tesla_BottomSheetTsx15` opacity term is Android-only** (`Platform.OS==='android' && animatedIndex.value===-1 ? 0 : 1`). On iOS the sheet container opacity is constant `1`. [differ]

## Open / not recoverable (do not guess these)

- **disabled vs off** for seat & wheel markers — needs `ControlButton`'s render (module 8667 dep[14]) + confirmation of which `generateControlButtonThemedStyles` copy is live (1340789 vs 3355150), and whether `iconStyle.color` beats themed `iconTintColor`.
- Seat tint predicate regs `r5`/`r22`/`r23`/`r24` @ 3987775 (heat-vs-cool selector). Outcome set is closed & read; the selector is not.
- `getSteeringWheelIconNameFromHeaterLevel` icon chain (iOS 3988019, `IconName` refs @ 3988171-3988244) — not decoded; needed for the wheel/yoke glyph per level.
- `getSeatClimateIcon(a0,a1,a2,a3)` (iOS 3987978) arg semantics — not decoded.
- Whether an **`auto`** seat state exists: `AUTOSEATCLIMATEACTION` **is** referenced (iOS 5226…/3987545-3987560, in the picker `onChange` alongside `HVACSEATHEATERACTIONS`/`HVACSEATCOOLERACTIONS`, keyed off i18n `vehicle_climate_screen_seat_heat` / `vehicle_climate_screen_seat_cool`), but **no auto-specific glyph or tint was found** at the marker tint site. Unresolved.
- The actual cause of the user's observed slide-up (4 candidates listed in A2) — **needs a device trace**.
