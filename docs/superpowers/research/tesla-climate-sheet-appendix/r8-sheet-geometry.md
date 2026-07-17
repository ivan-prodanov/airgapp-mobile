# R8 — Climate bottom-sheet geometry (VERBATIM dump)

Sources:
- iOS (PRIMARY): `/Users/ivan/Downloads/tesla-haptics-work/main.decompiled.js` (Tesla iOS v4.56)
- Android (cross-check): `/Users/ivan/Work/tesla-summon/work/bundle.hasm` (v4.58 Hermes disasm)

Reference phone: 393×852, `Specifications.statusBarOffset = statusBarHeight = 59`.

---

## 0. Module map (iOS)

| Thing | Location |
|---|---|
| Climate module id | **11024**, footer at iOS 5225196 |
| Climate deps array | iOS 5225197 (verbatim below) |
| `VehicleClimateScreen` component fn | iOS **5221432** |
| `useStyles` (Climate StyleSheet) | iOS **5221105**–5221429 |
| BottomSheet JSX props | iOS **5222699**–5222760 |
| Frame effect (`updateMainViewFrame`) | iOS **5222005**–5222065 |
| `setScreenOverlayColor` focus effect | iOS **5222078**–5222095 |
| `useBottomSheetForceUpdate` call | iOS 5222569–5222571 |
| Godot bridge module (slot9) | deps[9] = **8567** |
| gorhom bottom-sheet used by Climate (slot11) | deps[10] = **4054** ⇒ the **v5** copy (modules 4046–4160). *NOT* the v4 copy (modules 3853–4000). |
| `SheetHandle` (Tesla's own) | deps[46] = **4346**; impl at iOS **1766121**, styles at iOS 1766142–1766172 |
| `useBottomSheetForceUpdate` impl | deps[40] = **8715**; iOS 4036936–4036999 |

Climate deps array (iOS 5225197, verbatim):
```
[1, 41, 3, 5, 11025, 11026, 8667, 2395, 2295, 8567, 4054, 4353, 2434, 4349, 709, 255, 2370,
 2348, 2313, 2394, 2429, 2441, 2447, 4232, 8561, 2369, 4227, 4357, 1135, 1124, 1146, 4967,
 1123, 2309, 2392, 4488, 2443, 1147, 1125, 2432, 8715, 1113, 4164, 11027, 4355, 2452, 4346,
 2469, 2468, 4354, 4376, 4359, 2456, 2676, 1554, 4342, 8743, 8562]
```

---

## 1. The BottomSheet props — VERBATIM

iOS 5222699 (the literal props object as emitted):
```js
r7 = {'index': null, 'onChange': null, 'snapPoints': null, 'animateOnMount': false,
      'enableDynamicSizing': true, 'enableOverDrag': true, 'enableHandlePanningGesture': true,
      'enableContentPanningGesture': true, 'enablePanDownToClose': false,
      'keyboardBehavior': 'extend'};
r7['index'] = r11;                 // 5222700   ← React.useState(0)[0]  (see §1a)
r11 = function() { /* onChange */ };  // 5222701
r7['onChange'] = r11;              // 5222717
r11 = [270];                       // 5222718   ← ***THE SNAP POINTS***
r7['snapPoints'] = r11;            // 5222719
r15 = r25.bottomSheetBackgroundStyle;  // 5222720
r11 = new Array(3);
r11[0] = r15;
r15 = r25.bottomSheetShadow;       // 5222723
r11[1] = r15;
r15 = {};
r32 = r14.backgroundColor;         // theme.backgroundColor
r15['backgroundColor'] = r32;
r32 = Colors.black;                // '#000000'
r15['shadowColor'] = r32;
r11[2] = r15;
r7['backgroundStyle'] = r11;       // 5222734
r11 = r25.bottomSheetHandler;
r7['handleStyle'] = r11;           // 5222736
r11 = deps[46].SheetHandle;
r7['handleComponent'] = r11;       // 5222741
r11 = r25.bottomSheet;
r7['style'] = r11;                 // 5222743
r12 = r25.handleIndicator;
r11 = new Array(2); r11[0] = r12;
r12 = {}; r12['backgroundColor'] = r14.reverseTextColor; r11[1] = r12;
r7['handleIndicatorStyle'] = r11;  // 5222752
// child:
r11 = r10.BottomSheetView;         // 5222753
r10 = {}; r13 = {}; r13['backgroundColor'] = r14.backgroundColor; r10['style'] = r13;
```

### 1a. `index`
iOS 5222126–5222133:
```js
r11 = r11.useState;
r15 = r11.bind(r4)(r60);   // r60 === 0  →  useState(0)
r15 = _slicedToArray(r15, 2);
r11 = r15[0];              // index      ← passed as BottomSheet `index`
r15 = r15[1];              // setIndex   ← _closure2_slot35
```
`_closure2_slot35` is referenced **exactly once** (iOS 5222708), inside `onChange`:
```js
r11 = function(a0) {  // Original name: onChange
    if (a0 === -1) { _closure2_slot35(0); }   // setIndex(0)
    return undefined;
};
```
⇒ **`index` is `0` for the entire life of the screen.** Nothing ever calls `setIndex(1)`.

---

## 2. What the numbers resolve to

### 2.1 `containerHeight` — where it comes from
gorhom `BottomSheetContainerComponent` (v4 copy iOS 1756484; **v5 copy iOS 1787386**) — identical shape:
- `topInset = props.topInset !== undefined ? props.topInset : 0` → **0** (Climate passes none)
- `bottomInset = props.bottomInset !== undefined ? props.bottomInset : 0` → **0**
- container View style = `[style, styles.container, {top: topInset, bottom: bottomInset, overflow: detached ? 'visible' : 'hidden'}]`
- `styles.container` (module 3981 iOS 1756711 / v5 twin) = `Object.assign({}, StyleSheet.absoluteFillObject)`
- `handleContainerLayout` sets `containerHeight.value = e.nativeEvent.layout.height`

So **containerHeight = the measured height of the BottomSheet's parent** — here the Climate screen root `<View style={styles.container}>` (`{backgroundColor: Colors.transparent, flex: 1}`, iOS 5221219–5221227).

Climate is an `AppStack.Screen` (@react-navigation/stack) — iOS 5040700–5040742:
```js
r6['name'] = RouteName.VehicleClimateScreen;
r6['getComponent'] = () => require(deps[33]).default;
r6['options'] = Object.assign({}, {cardStyleInterpolator: forFade, detachPreviousScreen: r15},
                              isOHOS() ? {cardStyle: {backgroundColor: 'transparent'}} : ...);
```
Header is not shown; no SafeAreaView wraps the Climate root. ⇒ **containerHeight = 852** on the reference phone. *(INFERRED — measured at runtime, not a literal. Note it is robust: even if the card started at y=59 with height 793, the sheet TOP is anchored to the container's BOTTOM edge, which is the window bottom either way → same absolute y. Only a **bottom** safe-area inset on the card would move it; react-navigation's stack card does not apply one to content.)*

### 2.2 `normalizeSnapPoint` (v5 copy) — VERBATIM, iOS 1774333
```js
function gorhom_normalizeSnapPointTs1(snapPoint, containerHeight) {
  let normalizedSnapPoint = snapPoint;
  if (typeof normalizedSnapPoint === 'string') {
    normalizedSnapPoint = Number(normalizedSnapPoint.split('%')[0]) * containerHeight / 100;
  }
  return Math.max(0, containerHeight - normalizedSnapPoint);
}
```
⇒ snapPoints are **HEIGHTS**; normalized values are **TOP POSITIONS**.

### 2.3 `useAnimatedDetents` (v5 copy) — VERBATIM, iOS 1773286
```js
function gorhom_useAnimatedDetentsTs1() {
  const {layoutState, INITIAL_LAYOUT_VALUE, detents, normalizeSnapPoint, $modal, detached,
         bottomInset, enableDynamicSizing, maxDynamicContentSize} = this.__closure;
  const {containerHeight, handleHeight, contentHeight} = layoutState.get();
  if (containerHeight === INITIAL_LAYOUT_VALUE) { return {}; }
  const _detents = detents ? ('value' in detents ? detents.value : detents) : [];
  let _normalizedDetents = _detents.map(function (snapPoint) {
    return normalizeSnapPoint(snapPoint, containerHeight);
  });
  let highestDetentPosition = _normalizedDetents[_normalizedDetents.length - 1];
  let closedDetentPosition = containerHeight;
  if ($modal || detached) { closedDetentPosition = containerHeight + bottomInset; }
  if (!enableDynamicSizing) {
    return {detents: _normalizedDetents, highestDetentPosition, closedDetentPosition};
  }
  if (contentHeight === INITIAL_LAYOUT_VALUE) { return {}; }
  if (handleHeight === INITIAL_LAYOUT_VALUE) { return {}; }
  const dynamicSnapPoint = containerHeight -
      Math.min(contentHeight + handleHeight,
               maxDynamicContentSize !== undefined ? maxDynamicContentSize : containerHeight);
  if (!_normalizedDetents.includes(dynamicSnapPoint)) { _normalizedDetents.push(dynamicSnapPoint); }
  _normalizedDetents = _normalizedDetents.sort(function (a, b) { return b - a; });
  highestDetentPosition = _normalizedDetents[_normalizedDetents.length - 1];
  const dynamicDetentIndex = _normalizedDetents.indexOf(dynamicSnapPoint);
  return {detents: _normalizedDetents, dynamicDetentIndex, highestDetentPosition, closedDetentPosition};
}
```
Climate passes **no `maxDynamicContentSize`** ⇒ cap = containerHeight = 852.

### 2.4 `handleHeight`
`handleComponent = SheetHandle`. gorhom wraps it in an `onLayout` View — `BottomSheetHandleContainerComponent` (iOS 1757541); the props it forwards are:
```js
r5['animatedIndex'] = ...; r5['animatedPosition'] = ...;
r5['style'] = handleStyle;          // ← handleStyle is passed as `style` PROP
r5['indicatorStyle'] = handleIndicatorStyle;
```
Tesla's `SheetHandle` (iOS 1766121) **ignores every prop**:
```js
r1 = function() {  // Original name: SheetHandle
    r4 = useStyles().styles;
    return jsx(View, {style: r4.handle});
};
```
`SheetHandle` styles (iOS 1766142–1766171, `useThemedStyle`):
```js
handle: {
  width:  size.baseSize * 10,   //  5 * 10 = 50
  height: size.baseSize,        //  5
  backgroundColor: colors.highlight,  // '#FFFFFF' (dark scheme) / '#000000' (light)
  borderRadius: size.baseSize,  //  5
  alignSelf: 'center',
  marginTop: size.baseSize * 2, // 10
  opacity: 0.2
}
```
`size.baseSize = 5` (iOS 1643619 `r16['baseSize'] = 5`; also 1865223).
⇒ measured **handleHeight = 5 + 10 (marginTop) = 15**.

⇒ **`handleStyle` (`bottomSheetHandler`, height 12) and `handleIndicatorStyle` (`handleIndicator`) are DEAD** — they are handed to `SheetHandle`, which drops them.

### 2.5 `contentHeight`
Measured from `BottomSheetView`'s children. The content is the whole climate panel:
`bottomSection` (paddingTop 10, paddingBottom 40 = `Specifications.bottomMapOffset` with notch, paddingHorizontal 30) → status text, interior/exterior temps, `climateControls` (height `8*Gutter = 80`), temp text (`fontSize 40 / lineHeight 40`), up to 4× `largeButton` (height `6*Gutter = 60`, CT: `5*Gutter = 50`), interior-camera button, COP/Keeper switch rows.
⇒ **contentHeight ≫ 255**, so `dynamicSnapPoint = 852 − (contentHeight + 15)` is **< 582**. Exact value is **NOT statically recoverable** (depends on text wrap, feature flags, vehicle config, font metrics).

### 2.6 RESOLVED detents (393×852, statusBarOffset 59)

```
containerHeight = 852
normalized(270) = 852 − 270 = 582
dynamic         = 852 − min(contentHeight + 15, 852)      ← < 582, runtime-dependent
detents (sorted b−a, descending)  = [ 582, dynamic ]
index prop = 0  →  animatedPosition = detents[0] = 582
```

| detent | index | TOP y (abs) | HEIGHT |
|---|---|---|---|
| collapsed / peek (from `snapPoints:[270]`) | **0** | **582** | **270** |
| expanded (dynamic, `enableDynamicSizing`) | 1 | `852 − (contentHeight+15)` | `contentHeight + 15` (capped at 852) |

`animateOnMount: false` ⇒ it lands at 582 with no animation.
`enablePanDownToClose: false` ⇒ no closed detent; `closedDetentPosition = 852` is unreachable by gesture.

---

## 3. The `320` / `+80` frame formula (iOS 5222005–5222065) — VERBATIM

```js
r10 = function() {                      // useEffect callback, deps = [vehicleId]
    r0 = _closure2_slot29;              // isFocused
    if (!r0) return undefined;
    r1  = _closure1_slot9;              // deps[9] = 8567  (Godot bridge)
    r8  = r1.default;
    r7  = r8.updateMainViewFrame;
    r6  = require(deps[22]).Specifications.statusBarOffset;
    r12 = require(deps[39]).SCREEN_WIDTH;
    r4  = require(deps[39]).SCREEN_HEIGHT;
    r2  = require(deps[22]).Specifications.statusBarOffset;
    r4  = r4 - r2;
    r2  = 320;                          //  ← iOS 5222037  INLINE LITERAL
    r9  = r4 - r2;
    r13 = 0;
    r2  = 80;                           //  ← iOS 5222043  INLINE LITERAL
    r11 = r9 + r2;
    r2  = r8[r7](/*top*/ r6, /*left*/ r13, /*width*/ r12, /*height*/ r11);
    r2  = r1.default.forceCloseAllClosures(_closure2_slot2 /*vehicleId*/);
    r1  = r1.default.fadeRoof(vehicleId);
    r3  = global.setTimeout;
    r2  = function() { require(deps[9]).default.showFXAbove(vehicleId); };
    r1  = 150;
    r1  = r3(r2, r1);
    return undefined;
};
r10 = useEffect(r10, [vehicleId]);      // ← deps array built at 5222003–5222004: r12[0] = r10 (= r0.vehicleId, set at 5221452)
```

**Android v4.58 cross-check — IDENTICAL** (`bundle.hasm`, Function #126945 @ 5880847):
```
0000007c: <LoadConstInt>:    <Reg8: 2, Imm32: 320>
00000082: <Sub>:             <Reg8: 9, Reg8: 4, Reg8: 2>
00000086: <LoadConstZero>:   <Reg8: 13>
00000088: <LoadConstUInt8>:  <Reg8: 2, UInt8: 80>
0000008b: <AddN>:            <Reg8: 11, Reg8: 9, Reg8: 2>
00000095: <Call>:            <Reg8: 2, Reg8: 7, UInt8: 5>       # updateMainViewFrame(top, 0, w, h)
```
**Android v4.58 Climate `snapPoints` — ALSO `[270]`** (`bundle.hasm` @ 5878954):
```
00000bed: <NewObjectWithBufferLong>: # Object: {'index': null, 'onChange': null, 'snapPoints': null,
                                     #  'animateOnMount': false, 'enableDynamicSizing': true,
                                     #  'enableOverDrag': true, 'enableHandlePanningGesture': true,
                                     #  'enableContentPanningGesture': true, 'enablePanDownToClose': false,
                                     #  'keyboardBehavior': 'extend'}
00000c0e: <NewArrayWithBufferLong>: <Reg8: 11, UInt16: 1, UInt16: 1, UInt32: 686907>  # Array: [270]
00000c18: <PutById>: <Reg8: 7, Reg8: 11, UInt8: 3, string_id: 49892>  # 'snapPoints'
```
⇒ **`320` and `[270]` coexist inside the same shipping version, on both platforms.** This is not version skew.

*(For contrast — the Android **Controls** sheet, a different screen, uses `snapPoints: [145]` + `maxDynamicContentSize` + `enableOverDrag: false`: `bundle.hasm` 4428779 / 4428771.)*

### Arithmetic (393×852, statusBarOffset 59)
```
car band top    = 59
car band height = 852 − 59 − 320 + 80 = 553
car band bottom = 59 + 553 = 612
sheet top       = 852 − 270 = 582
overlap         = 612 − 582 = 30 pt
"SCREEN_HEIGHT − 320" = 532;  612 = 532 + 80
```

---

## 4. Sheet chrome / paint — VERBATIM styles (iOS `useStyles`, 5221105–5221429)

`Gutter = 10` (iOS 1338473 `r2['Gutter'] = 8`? → actual: **1338474 `r2['Gutter'] = r8` where `r8 = 10`**, iOS 1338473–1338474).
`Specifications.bottomMapOffset = HAS_NOTCH ? 40 : 20` → **40** (iOS 1338645–1338652).
`Specifications.statusBarOffset = Platform.OS === 'android' ? 0 : getStatusBarHeight()` → **59** on iOS ref phone (iOS 1338580–1338592).

```js
// iOS 5221163–5221169
bottomSheet: {
  backgroundColor: Colors.transparentWhite,   // 'rgba(255,255,255,0.5)'   (iOS 1338467)
  elevation: 1                                // Android-only
}
// iOS 5221174–5221177
bottomSheetBackgroundStyle: {
  borderRadius: 0
}
// iOS 5221178–5221181
bottomSheetHandler: {
  height: 12                                  // ***DEAD*** — SheetHandle ignores it
}
// iOS 5221182–5221186
bottomSheetShadow: {
  shadowOffset: {width: 0, height: 10},
  shadowOpacity: 1,
  shadowRadius: 20
}
// iOS 5221260–5221261
handleIndicator: {
  marginTop: 2, width: 60                     // ***DEAD*** — SheetHandle ignores it
}
// iOS 5221262–5221263
headerGradient: {
  height: 300, position: 'absolute', width: '100%', zIndex: 4294967286   // = -10
}
// iOS 5221149–5221155
bottomSection: {
  alignItems: 'center',
  paddingBottom: Specifications.bottomMapOffset,   // 40
  paddingHorizontal: 30,
  paddingTop: Gutter                               // 10
}
// iOS 5221156–5221162
bottomTextSection: {
  alignItems: 'center', justifyContent: 'center',
  marginTop: isCT ? 0 : 1.5 * Gutter               // 15  (0 on CYBERTRUCK)
}
// iOS 5221219–5221227
container: { backgroundColor: Colors.transparent, flex: 1 }
```

Effective `backgroundStyle` array passed to the sheet:
```js
[ {borderRadius: 0},
  {shadowOffset: {width: 0, height: 10}, shadowOpacity: 1, shadowRadius: 20},
  {backgroundColor: theme.backgroundColor /* '#161718' */, shadowColor: '#000000'} ]
```
gorhom's `BottomSheetBackground` default (v5 copy, iOS 1788331–1788332):
```js
background: {'backgroundColor': 'white', 'borderRadius': 15}
```
and it renders `<View style={[styles.background, style]} accessibilityRole="adjustable" accessibilityLabel="Bottom Sheet"/>` (iOS 1788505–1788527) — so Climate's array **overrides** `borderRadius 15 → 0` and `backgroundColor 'white' → '#161718'`.

Theme resolution (iOS 1337948 = DARK, 1338137 = CYBERTRUCK — both):
```
backgroundColor            = '#161718'
backgroundColorTransparent = '#16171800'
```
DARK `v5BackgroundColor = '#161718'` (iOS 1337954).

**No BlurView / vibrancy / opacity anywhere in the sheet chain.** The sheet is **fully opaque `#161718`, square corners**.

---

## 5. `setScreenOverlayColor` and `useBottomSheetForceUpdate`

`setScreenOverlayColor` — iOS 5222078–5222095, inside `useFocusEffect(useCallback(..., [isVehicleDataUnreliable]))`:
```js
r15 = function() {
    r0 = _closure1_slot9;                 // Godot bridge (8567)
    r3 = r0.default;
    r2 = r3.setScreenOverlayColor;
    r1 = _closure2_slot30;                // v5BackgroundColor  ('#161718')
    r4 = _closure2_slot13;                // isVehicleDataUnreliable
    r0 = 0;
    if (r4) { r0 = 0.5; }
    r0 = r2.bind(r3)(r1, r0);
    return undefined;
};
```
⇒ tints the **Godot renderer** (not the sheet) with `#161718` at **α 0.5 when vehicle data is unreliable, α 0 otherwise**. Android twin: `bundle.hasm` Function #99895 @ 4464491 (`LoadConstDouble 0.5`).

`useBottomSheetForceUpdate` — iOS 4036936–4036999 (module **8715**), **VERBATIM**:
```js
r1 = function() {  // Original name: useBottomSheetForceUpdate
    r4 = useSharedValue(-1);
    useDerivedValue(worklet /* 'function useBottomSheetForceUpdateTs1(){const{forceUpdate}=this.__closure;return forceUpdate.value;}' */, [r4]);
    useEffect(function() {
        setTimeout(function() {
            logEng('[BOTTOM SHEET] forceUpdate mapper rerun');
            r4.value = 1;
        }, 500);
    }, [r4]);
};
```
⇒ a **reanimated-mapper kick 500 ms after mount**. It has NO geometry inputs/outputs; it exists to force reanimated to re-run the sheet's mappers. Climate calls it and discards the (undefined) return (iOS 5222569–5222571).

---

## 6. Is the frame re-sent on drag?

**No.** Exhaustive search of the Climate module (iOS 5219700–5225196) for `updateMainViewFrame` / `moveCamera*`:
```
5222016:  r7 = r8.updateMainViewFrame;      ← useEffect(cb, [vehicleId])   (§3)
5226346:  r3 = r4.moveCameraWithCompletion; ← module 11026 (VehicleClimateControlsOverlay), not Climate
```
That is the **only** `updateMainViewFrame` in the module, and its dep array is `[vehicleId]` (built at iOS 5222003–5222004 from `r10 = r0.vehicleId`, iOS 5221452).

The sheet has **no `onAnimate`**, no `animatedPosition`/`animatedIndex` prop, and no `useAnimatedReaction` in the module. `onChange` (iOS 5222701–5222717) does exactly one thing: `if (index === -1) setIndex(0)`.

⇒ **The car band is STATIC at the collapsed geometry.** Drag the sheet up over the car and the car band does not change; the sheet simply covers more of it.

---

## 7. Verdict on the team's hypothesis

**KILLED on the number, confirmed on the shape.**

- The collapsed sheet height is **270, not 320.** Both iOS 4.56 and Android 4.58 agree.
- Sheet top = **852 − 270 = 582**, not 532.
- Car band = **y 59..612**. Actual overlap behind the sheet = **30 pt**, not 80.
- The `+80` *is* shaped like an intentional overlap: `band_bottom = (SCREEN_HEIGHT − 320) + 80`. Someone reserved 320 for the sheet and then deliberately pushed the band 80 pt down **into** that reserve so the car isn't clipped at the sheet's edge. But the 320 reserve **does not match any live constant** in the app — it is a stale/wrong magic number. There is no name, no comment, no shared const: **`320` occurs exactly once in iOS 5220000–5232000, at 5222037** — the formula itself.
- Net effect: the formula reduces to **`SCREEN_HEIGHT − statusBarOffset − 240`**, and that is the only thing that matters. It is *not* derived from the sheet at runtime.

**Ship guidance:** reproduce Climate as `height = SCREEN_HEIGHT − statusBarOffset − 240` (= **553** on 393×852/59; band y 59..612; `root_node.scale = 553/852 = 0.6491`; `center_y = 335.5`) — exactly R7's value. Do **not** derive it from the sheet's 270. Do not re-send the frame on drag.
