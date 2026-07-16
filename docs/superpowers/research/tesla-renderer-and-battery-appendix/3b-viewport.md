# R5 §3 — Godot renderer viewport / frame / layout (VERBATIM)

Files:
- iOS PRIMARY: `/Users/ivan/Downloads/tesla-haptics-work/main.decompiled.js` (Tesla iOS v4.56)
- Android: `/Users/ivan/Work/tesla-summon/work/bundle.hasm` (Hermes disasm v4.58)

TL;DR architecture: the native Godot surface is a **single full-screen RN host view** (`TMGodotView` on iOS / `GodotView` on Android). It is NOT a band. The car's visible region is a **native sub-rectangle** driven by the `UPDATE_MAIN_VIEW_FRAME` bridge message (`updateMainViewFrame(...)`), which differs per screen (Home / Controls / Climate / Energy). All spatial values in that message are multiplied by a render-scale factor.

---

## 1. The native renderer host component

### iOS component registration [iOS-verified] — main.decompiled.js:2779995-2780002
```
case 277:
    r6 = r5.requireNativeComponent;
    r5 = r5.Platform;
    r8 = r5.OS;
    r5 = 'TMGodotView';
    r7 = 'ios';
    if(!(r8 === r7)) { _fun66837_ip = 311; continue _fun66837 }
case 307:
    r5 = 'GodotView';
case 311:
    r4 = r6.bind(r0)(r5);
```
Resolution: `if (Platform.OS === 'web') return View; else requireNativeComponent(Platform.OS === 'ios' ? 'TMGodotView' : 'GodotView')`.
So the native host is **`TMGodotView`** (iOS) / **`GodotView`** (Android/other). Exported under the name `GodotView` (used as `<GodotView .../>`).

### Android parity [both-match] — bundle.hasm:3102872-3102875
```
0x00000125 LoadConstStringLongIndex Reg8:5 string_id:134900  # String: 'TMGodotView'
0x00000133 LoadConstString          Reg8:5 string_id:18322    # String: 'GodotView'
```
Same TMGodotView/GodotView pair present.

### (Separate) web/OHOS canvas GodotView — NOT the iOS/Android native path [iOS-verified, INFERRED role]
main.decompiled.js:2831866-2831875 — a different `GodotView` module using ResizeObserver + `canvasRef` + `devicePixelRatio` + `useGodotEngine`. Its StyleSheet:
```
r6 = {'aspectRatio': '1 / 1', 'marginTop': 0, 'padding': 0, 'position': 'relative', 'width': '100%'};
r3['godotView'] = r6;
```
Its default useState size is `{'height': 340, 'width': 340}` (main.decompiled.js:2831878). This is the browser/OHOS engine host, gated on `Platform.OS === 'web'` elsewhere — **not** the shipped iOS/Android RN surface. Recorded for completeness; do not use for iOS layout.

---

## 2. Container LAYOUT / STYLE of the native GodotView (the `godotView` StyleSheet)

The GodotView host is styled with `styles.godotView`. It is defined **identically** in the two ProductHome modules:

### Module #101606 (ProductHomeScreen) [iOS-verified] — main.decompiled.js:4181771-4181780
```
r7 = {'height': null, 'left': 0, 'position': 'absolute', 'right': 0, 'top': 0};
r13 = SCREEN_HEIGHT;                          // r10[r8].SCREEN_HEIGHT
r12 = Specifications.androidStatusBarHeight;  // r10[34].Specifications.androidStatusBarHeight
r12 = r13 - r12;
r7['height'] = r12;
r3['godotView'] = r7;
```

### Module #111050 (the one that actually renders `<GodotView>`) [iOS-verified] — main.decompiled.js:4560490-4560499
```
r10 = {'height': null, 'left': 0, 'position': 'absolute', 'right': 0, 'top': 0};
r21 = SCREEN_HEIGHT;                            // r13[r19].SCREEN_HEIGHT
r19 = Specifications.androidStatusBarHeight;    // r13[r11].Specifications.androidStatusBarHeight
r19 = r21 - r19;
r10['height'] = r19;
r4['godotView'] = r10;
```

**Resolved `styles.godotView`:**
```
{
  position: 'absolute',
  top: 0,
  left: 0,
  right: 0,               // -> full screen width
  height: SCREEN_HEIGHT - Specifications.androidStatusBarHeight
}
```
`Specifications.androidStatusBarHeight` = **0 on iOS** (see §5), so on iOS the container = **entire screen**: `{top:0, left:0, right:0, height: SCREEN_HEIGHT}`. Position absolute, sits behind all overlay content. The car is NOT vertically centered by the container; it fills the screen and the car is positioned by the native frame (§3).

### How it is rendered [iOS-verified] — main.decompiled.js:4559282-4559300 (module #111050)
```
case 1234:
    r4 = _closure1_slot7;
    r4 = r4.default;
    r5 = r4.enabled;
case 1248:
    if(!r5) { ...skip... }
case 1251:
    r7 = _closure1_slot18.jsx;
    r6 = _closure1_slot7.GodotView;
    r4 = {};
    r9 = _closure1_slot32.godotView;      // styles.godotView
    r8 = new Array(2);
    r8[0] = r9;
    r9 = {};
    r9['backgroundColor'] = r22;          // v5BackgroundColor
    r8[1] = r9;
    r4['style'] = r8;
    r5 = r7.bind(r3)(r6, r4);             // <GodotView style={[styles.godotView, {backgroundColor}]} />
```
Guard: rendered only when `Platform.OS === 'ios'` AND `Godot.default.enabled` (main.decompiled.js:4559262-4559275). Wrapped in a `Fragment` → then siblings under `ThemeContext.Provider` / `Animated.View` (`productFadeView`). **No SafeAreaView wraps it.**

### Sibling full-screen overlays in the same StyleSheet (module #101606) [iOS-verified] — main.decompiled.js:4181738-4181800
```
container:        { backgroundColor: Colors.transparent, direction: 'ltr'|'rtl', height: SCREEN_HEIGHT, width: SCREEN_WIDTH }
ctBottomGradient: { height: SCREEN_HEIGHT, position: 'absolute', width: SCREEN_WIDTH }
forceLtr:         { direction: 'ltr'|'rtl' }
godotView:        { height: SCREEN_HEIGHT - Specifications.androidStatusBarHeight, left: 0, position: 'absolute', right: 0, top: 0 }
productFadeView:  { height: SCREEN_HEIGHT, position: 'absolute', width: SCREEN_WIDTH }
```
(module #111050 additionally: `headerGradientCT: { height: MAX_LIST_HEADER_HEIGHT + Specifications.statusBarHeight + 30, position:'absolute', width:'100%', zIndex: 4294967286 }` — main.decompiled.js:4560500-4560512.)

---

## 3. Per-screen native frame (`UPDATE_MAIN_VIEW_FRAME`) — where the car actually sits

The car's composited rectangle inside the full-screen surface is set by `default.updateMainViewFrame(top, left, width, height, animated, duration?, transition_type?, ease_type?, scroll_fraction?)`.

### The bridge message [iOS-verified] — main.decompiled.js:1173290-1173330 (fn #28712)
```
r3 = sendMessage;
r2 = UPDATE_MAIN_VIEW_FRAME;
r1 = {};
r1['top_margin']      = arg0 * slot16;
r1['left_margin']     = arg1 * slot16;
r1['width']           = arg2 * slot16;
r1['height']          = arg3 * slot16;
r1['animated']        = arg4;
r1['duration']        = arg5;   // default defaultCameraAnimationDuration
r1['transition_type'] = arg6;   // default defaultCameraAnimationTransition
r1['ease_type']       = arg7;   // default defaultCameraAnimationEase
r1['scroll_fraction'] = arg8;   // default 0
sendMessage(UPDATE_MAIN_VIEW_FRAME, r1);
```
`slot16` = the render scale (§ below). So `top_margin/left_margin/width/height` are emitted in **physical pixels** (dp × scale).

Android parity [both-match] — bundle.hasm:1385559-1385560 (`UPDATE_MAIN_VIEW_FRAME`), 1390343 (`top_margin`), and the default-object bundle.hasm:3159872:
`{'animated': false, 'duration': 3, 'ease_type': 2, 'left_margin': 0, 'top_margin': 0, 'transition_type': 3}`.

### 3a. HOME / ProductHomeScreen [iOS-verified] — main.decompiled.js:4559040-4559056 (fn #111057, module #111050) and repeated 4558838-4558858
```
r5 = Specifications.statusBarHeight;   // r3[24].Specifications.statusBarHeight
r5 = r4 + 60;                          // top = statusBarHeight + 60
r10 = SCREEN_WIDTH;                    // r3[21].SCREEN_WIDTH
r9  = GODOT_VIEW_SIZE;                 // r3[19].GODOT_VIEW_SIZE = 355
updateMainViewFrame( r12=statusBarHeight+60, r11=0, r10=SCREEN_WIDTH, r9=GODOT_VIEW_SIZE, r8=animated );
```
**Home frame = { top_margin: (statusBarHeight + 60), left_margin: 0, width: SCREEN_WIDTH, height: GODOT_VIEW_SIZE = 355 }** (× slot16).
The car occupies a **355-pt-tall band** starting 60 pt below the status bar; the surface itself is full screen.

Lootbox-banner variant [iOS-verified] — main.decompiled.js:4562249-4562272 (fn #111017, same module):
```
r3 = Specifications.statusBarHeight + 60;
if (slot36 /* lootbox showing */) r2 = LOOTBOX_TOP_BANNER_HEIGHT; else r2 = 0;
r4 = r3 + r2;                          // top = statusBarHeight + 60 + LOOTBOX_TOP_BANNER_HEIGHT
updateMainViewFrame( r4, 0, SCREEN_WIDTH, GODOT_VIEW_SIZE=355, animated );
```
i.e. when a lootbox top banner is up, the band is pushed down by `LOOTBOX_TOP_BANNER_HEIGHT`; width/height unchanged.

### 3b. CONTROLS / VehicleControlsScreen [iOS-verified] — main.decompiled.js:4039518-4039563 (fn #98623)
```
top r3 = 0;
if (slot7 && slot8) r3 = _closure1_slot29;            // else top = 0
r2 = SCREEN_WIDTH;                                     // r10[32].SCREEN_WIDTH
r7 = SCREEN_HEIGHT;                                    // r10[32].SCREEN_HEIGHT
if (!slot7)         r1 = _closure1_slot26;             // sheet height A
else if (!slot8)    r1 = _closure1_slot28;             // sheet height B
else                r1 = _closure1_slot27;             // sheet height C
r11 = SCREEN_HEIGHT - r1;                              // height = SCREEN_HEIGHT - sheetHeight
updateMainViewFrame( r14=r3(top), r13=0, r12=SCREEN_WIDTH, r11=SCREEN_HEIGHT - sheetHeight, r10=animated );
```
**Controls frame = { top_margin: 0 (or slot29 when slot7&&slot8), left_margin: 0, width: SCREEN_WIDTH, height: SCREEN_HEIGHT − sheetHeight }**.
The car band is anchored near the top and its height is **reduced by a controls-sheet height** (one of three state-dependent constants slot26/27/28; slot7/slot8 are boolean UI-state flags). The exact numeric values of slot26/27/28/29 are **UNRESOLVED** (defined at module scope, not local literals). Interpretation: Controls repositions/shrinks the same persistent renderer to sit above the controls sheet. **INFERRED**.

### 3c. CLIMATE / VehicleClimateScreen [iOS-verified] — main.decompiled.js:5222013-5222040 (fn #120832)
```
r6  = Specifications.statusBarOffset;              // r10[22].Specifications.statusBarOffset
r12 = SCREEN_WIDTH;                                // r10[39].SCREEN_WIDTH
r4  = SCREEN_HEIGHT;                               // r10[39].SCREEN_HEIGHT
r2  = Specifications.statusBarOffset;
r4  = SCREEN_HEIGHT - statusBarOffset;
r9  = r4 - 320;                                    // SCREEN_HEIGHT - statusBarOffset - 320
r11 = r9 + 80;                                     // height = SCREEN_HEIGHT - statusBarOffset - 320 + 80
updateMainViewFrame( r14=statusBarOffset, r13=0, r12=SCREEN_WIDTH, r11=(SCREEN_HEIGHT - statusBarOffset - 240), r10=animated );
```
**Climate frame = { top_margin: statusBarOffset, left_margin: 0, width: SCREEN_WIDTH, height: SCREEN_HEIGHT − statusBarOffset − 320 + 80 = SCREEN_HEIGHT − statusBarOffset − 240 }**.
Note Climate uses `Specifications.statusBarOffset` for the top, whereas Home uses `Specifications.statusBarHeight + 60`.

### 3d. ENERGY / EnergyHomeScreen (for contrast) [iOS-verified] — main.decompiled.js:4591391-4591404 (fn #111594)
```
r15 = SCREEN_WIDTH;         // r7[20].SCREEN_WIDTH
r14 = _closure2_slot9;      // dynamic height
r17 = _closure2_slot26;     // dynamic top
updateMainViewFrame( r17=slot26(top), r16=0, r15=SCREEN_WIDTH, r14=slot9(height), r13=false );
```
Energy uses fully dynamic top/height (scroll-driven). Not vehicle Home/Controls/Climate; recorded to show the frame is per-product.

**Cross-screen summary (all × slot16 render scale):**
| Screen | top_margin | left | width | height |
|---|---|---|---|---|
| Home | statusBarHeight + 60 | 0 | SCREEN_WIDTH | GODOT_VIEW_SIZE = 355 |
| Home + lootbox | statusBarHeight + 60 + LOOTBOX_TOP_BANNER_HEIGHT | 0 | SCREEN_WIDTH | 355 |
| Controls | 0 (or slot29) | 0 | SCREEN_WIDTH | SCREEN_HEIGHT − sheetHeight(slot26/27/28) |
| Climate | statusBarOffset | 0 | SCREEN_WIDTH | SCREEN_HEIGHT − statusBarOffset − 240 |

The GodotView **host container is the same full-screen absolute view on all screens**; only the native main-view frame (and camera pose via `MOVE_CAMERA`) changes between Home/Controls/Climate. This is a **single persistent renderer**, not a per-screen remount. **INFERRED** (Controls/Climate modules render no `godotView` StyleSheet of their own; only Home module #111050 / #101606 do).

### GODOT_VIEW_SIZE value [both-match]
- iOS: `r2['GODOT_VIEW_SIZE'] = 355;` — main.decompiled.js:4068110.
- Android: `LoadConstInt Reg8:3 Imm32:355` → `PutById ... 'GODOT_VIEW_SIZE'` — bundle.hasm:4490398.
- **355** on both.

---

## 4. Render scale / device-pixel-ratio on the Godot surface — `slot16`

[iOS-verified + both-match] — main.decompiled.js:1169288-1169303 (fn #28693, the same module that defines UPDATE_MAIN_VIEW_FRAME):
```
r1 = r2.NativeModules;
r4 = r1.GodotModule;
var _closure1_slot15 = r4;
r1 = r2.Platform;
r11 = r1.OS;
r1 = 'ios';
if(!(r11 !== r1)) { ...jump 556 (ios)... }
case 539:                       // OS !== 'ios'  (Android/other)
    r11 = r2.PixelRatio;
    r1 = r11.get;
    r1 = r1.bind(r11)();        // PixelRatio.get()
    ...jump 568...
case 556:                       // OS === 'ios'
    r11 = r4.getNativeScale;
    r1 = r11.bind(r4)();        // NativeModules.GodotModule.getNativeScale()
case 568:
    var _closure1_slot16 = r1;
```
**Render scale =**
- **iOS: `NativeModules.GodotModule.getNativeScale()`** [iOS-verified]
- **Android: `PixelRatio.get()`** [Android-only]

Android parity confirmation: bundle.hasm:1385526 `getNativeScale`. This scale multiplies `top_margin/left_margin/width/height` in `UPDATE_MAIN_VIEW_FRAME`, so the frame is delivered in native/physical pixels. There is no separate SET_RESOLUTION / render_scale message; the surface resolution is the native view size and the frame is expressed in device pixels via this factor.

Aux: `useGetGodotViewSize` [iOS-verified main.decompiled.js:4590417 / Android #117656] returns
`useDeviceDimensions().width + Math.max(PixelRatio.getFontScale() - 1, 0) * 96`
— a **width** used by EnergyHomeScreen list sizing, NOT the vehicle main-view frame. Recorded to avoid confusion.

---

## 5. Safe-area insets feeding the container?

**No SafeAreaView / useSafeAreaInsets wraps the GodotView.** The container height uses `SCREEN_HEIGHT - Specifications.androidStatusBarHeight`; the native frame top margins use `Specifications.statusBarHeight` (Home) / `Specifications.statusBarOffset` (Climate). These `Specifications` values are notch-aware but are **not** React Native safe-area insets.

### Specifications values [iOS-verified] — main.decompiled.js:1338587-1338642 (fn #32533)
```
r1 = {'edgePadding': 20, 'pillContainerHeight': 24, 'iconButtonBusyOpacity': 0.5, 'statusBarHeight': null, 'headerHeight': 54};
r1['statusBarHeight']       = <statusBarHeight fn>();          // r4()
r1['statusBarOffset']       = (OS === 'android') ? 0 : <statusBarHeight fn>();   // r15
...
r1['androidStatusBarHeight'] = (OS === 'android') ? getTopInset() : 0;          // r18; = 0 on iOS
```
- `Specifications.androidStatusBarHeight` = **0 on iOS** ⇒ container height = full `SCREEN_HEIGHT`.
- `Specifications.statusBarOffset` on iOS = same as `statusBarHeight` (non-android branch).

### `statusBarHeight` fn (iOS device-model dependent) [iOS-verified] — main.decompiled.js:1338515-1338562 (fn #32534)
```
iPhone16 / iPhone17 / iPhone18 model  -> 59
(else notch model)                    -> 47
non-notch fallbacks                   -> 50, or getStatusBarHeight()
android                               -> getTopInset()
```
So on iOS `statusBarHeight` ∈ {47, 50, 59, ...} by device (Dynamic-Island phones = 59). Home top_margin = `statusBarHeight + 60` therefore ≈ 107 (notch) / 119 (Dynamic Island) pt before scale. Exact per-device px beyond these branch literals is **UNRESOLVED**.

---

## Claims to verify (most load-bearing)
1. `styles.godotView` on Home = `{position:'absolute', top:0, left:0, right:0, height: SCREEN_HEIGHT − Specifications.androidStatusBarHeight}`; androidStatusBarHeight=0 on iOS ⇒ full-screen. (main.decompiled.js:4560490, 4181771, 1338642)
2. GodotView is a single persistent full-screen host; Controls/Climate do NOT remount it — they only re-issue `updateMainViewFrame` / `MOVE_CAMERA`. (no godotView StyleSheet in #98623 / #120832) — INFERRED.
3. Native frame differs per screen: Home {statusBarHeight+60, 0, W, 355}; Controls {0/slot29, 0, W, H−sheet}; Climate {statusBarOffset, 0, W, H−statusBarOffset−240}. (4559040 / 4039518 / 5222013)
4. Render scale on the surface: iOS = `GodotModule.getNativeScale()`, Android = `PixelRatio.get()`; multiplies top/left/width/height in UPDATE_MAIN_VIEW_FRAME. (1169288)
5. GODOT_VIEW_SIZE = 355 both platforms. (4068110 / hasm 4490398)
