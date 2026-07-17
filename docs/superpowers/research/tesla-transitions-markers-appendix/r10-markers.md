# R10 — Controls markers + car-colour logic

Source: `/Users/ivan/Downloads/tesla-haptics-work/main.decompiled.js` (iOS v4.56). All line numbers iOS unless stated.
Method: every region below read with `sed -n 'A,Bp'` unfiltered; every branch target followed.

---

## §0. HEADLINE ANSWER (§3 deliverable)

**Only ONE element on Controls is car-colour-adaptive: the frunk button's label text.**

| car | `isLight` | frunk label style | resolved colour |
|---|---|---|---|
| **White / Pearl White** (`WHITE`, `PEARLWHITE`, `PEARL`, `SILKROADSILVER`) | `true` | `styles.textColorDark` | **`rgba(0,0,0,0.7)`**, `fontSize: 18` |
| **Red Model Y** (`REDMULTICOAT`, `ULTRARED`) | `false` | `styles.textColorGray` | **`rgba(255,255,255,0.7)`**, `fontSize: 18` |

Our hardcoded `{fontSize:19, fontWeight:'600', color:'rgba(255,255,255,0.92)'}` is wrong on all three axes.
Tesla's literal is **exactly** `{color: <Colors.transparentBlack70|transparentWhite70>, fontSize: 18}` — **no** `fontWeight`, **no** `fontFamily`, **no** `letterSpacing`, **no** `lineHeight`, **no** backdrop/shadow. Weight/family come from the shared `Button` component's `textStyle` merge, not from here.

The **trunk** label and the **lock** glyph are **NOT** adaptive — both hardcode `textColorGray` (`rgba(255,255,255,0.7)`). See §5.

---

## §1. `isLightColorFor` — fn #12652, iOS 500287–500440 (VERIFIED + COMPLETED)

Export: `r2['isLightColorFor'] = r3` @ **500442**.

Your decode was **correct**, and I found **4 members you'd elided behind the `…`**:
`TITANIUMCOPPER`, `SIGNATUREBLUE`, `MIDNIGHTCHERRYRED`, `QUICKSILVER` (all → `577` / `false`).

Full ordered dump, VERBATIM, every branch target followed:

| ip | test | target |
|---|---|---|
| 0 | `null` | 581 |
| 12 | `undefined` | 581 |
| 21 | `TYPE_NOT_SET` | 581 |
| 41 | `UNKNOWN` | 581 |
| 58 | `PEARLWHITE` | 581 |
| 75 | `WHITE` | 581 |
| 92 | `PEARL` | 581 |
| 109 | `SILKROADSILVER` | 581 |
| 126 | `REDMULTICOAT` | 577 |
| 143 | `SOLIDBLACK` | 577 |
| 160 | `SILVERMETALLIC` | 577 |
| 177 | `MIDNIGHTSILVER` | 577 |
| 194 | `DEEPBLUE` | 577 |
| 211 | `DEFAULTCOLOR` | 577 |
| 228 | `BLACK` | 577 |
| 245 | `SILVER` | 577 |
| 262 | `GREY` | 577 |
| 279 | `BLUE` | 577 |
| 296 | `GREEN` | 577 |
| 313 | `BROWN` | 577 |
| 330 | `SIGRED` | 577 |
| 347 | `RED` | 577 |
| 364 | `STEELGREY` | 577 |
| 381 | `METALLICBLACK` | 577 |
| 398 | **`TITANIUMCOPPER`** | 577 |
| 415 | **`SIGNATUREBLUE`** | 577 |
| 432 | **`MIDNIGHTCHERRYRED`** | 577 |
| 449 | **`QUICKSILVER`** | 577 |
| 463 | `ULTRARED` | 577 |
| 477 | `STEALTHGREY` | 577 |
| 491 | `LUNARSILVER` | 577 |
| 505 | `GLACIERBLUE` | 577 |
| 519 | `DIAMONDBLACK` | 577 |
| 533 | `FROSTBLUE` | 577 |
| 547 | `MARINEBLUE` | 577 |
| 561 | `GARNETRED` | 577 |

`case 575: return r0` — `r0` holds `undefined` (set at ip 12). **`575` is DEAD CODE for valid enum members**: 8 (`581`) + 26 (`577`) = **34 = every member of the enum**. `undefined` can only be returned if given a value outside the enum.

Hermes note: every guard is `if(!(r3 !== r2)) goto X` ≡ **`if (paint === MEMBER) goto X`**. Inversion checked.

### The enum (`_closure1_slot9`) — RESOLVED

It is the **protobuf oneof case**, not a plain colour enum:
`CarServer.ExteriorColor.TypeCase`, defined VERBATIM at **iOS 676566**:

```js
{'TYPE_NOT_SET': 0, 'UNKNOWN': 3, 'REDMULTICOAT': 4, 'SOLIDBLACK': 5, 'SILVERMETALLIC': 6,
 'MIDNIGHTSILVER': 7, 'DEEPBLUE': 8, 'PEARLWHITE': 9, 'DEFAULTCOLOR': 10, 'BLACK': 11,
 'WHITE': 12, 'SILVER': 13, 'GREY': 14, 'BLUE': 15, 'GREEN': 16, 'BROWN': 17, 'PEARL': 18,
 'SIGRED': 19, 'RED': 20, 'STEELGREY': 21, 'METALLICBLACK': 22, 'TITANIUMCOPPER': 23,
 'SIGNATUREBLUE': 24, 'MIDNIGHTCHERRYRED': 25, 'QUICKSILVER': 26, 'ULTRARED': 27,
 'STEALTHGREY': 28, 'LUNARSILVER': 29, 'GLACIERBLUE': 30, 'DIAMONDBLACK': 31,
 'FROSTBLUE': 32, 'SILKROADSILVER': 33, 'MARINEBLUE': 34, 'GARNETRED': 35}
```
`oneofGroups_ = [[3..35]]` @ **676561**. So the wire value is *which field of the `exterior_color` oneof is set*, obtained via `.getTypeCase()`.

**Light set (numeric):** `{0, 3, 9, 12, 18, 33}` → `TYPE_NOT_SET, UNKNOWN, PEARLWHITE, WHITE, PEARL, SILKROADSILVER`.
**Everything else in 4..35 → false.** Red Model Y = `REDMULTICOAT(4)` or `ULTRARED(27)` → **false**.

---

## §2. `hasLightExteriorColor` — fn #30232, iOS 1240055–1240113 (name RESOLVED)

Export: `r2['hasLightExteriorColor'] = r9` @ **1240114**. Also re-exported @ **1220299**.
Signature: `hasLightExteriorColor(vehicleConfig)`.

Your decode was **incomplete** — there is a **blend-colour override path that runs FIRST and can bypass the enum entirely**:

```
case 0:   r5 = getBlendColor(config)                       // _closure1_slot42 module → fn62901
          if(!isSomething(r5)) goto 76
case 64:  if(r5.length === 3) goto 169
case 76:  r2 = getCarTypeFromConfigOrVin(config, null)     // _closure1_slot215 = fn29827, iOS 1212558
          if(r2 === CarType.CARTYPECYBERTRUCK) goto 165
case 124: return isLightColorFor(getExteriorColor(config)) // _closure1_slot149
case 165: return false
case 169: return isLightHSB(r5[0], r5[1], r5[2])           // _closure1_slot150
```

Equivalent JS:
```js
const blend = getBlendColor(config);
if (isSomething(blend) && blend.length === 3) return isLightHSB(blend[0], blend[1], blend[2]);
if (getCarTypeFromConfigOrVin(config, null) === CarType.CARTYPECYBERTRUCK) return false;
return isLightColorFor(getExteriorColor(config));
```

### `_closure1_slot149` — RESOLVED: `getExteriorColor` (fn #30229, iOS 1239995–1240013)
```js
getExteriorColor(config) {
  if (config == null) return undefined;
  const ec = config.getExteriorColor();
  if (ec == null) return undefined;
  return ec.getTypeCase();      // ← the oneof case, per §1
}
```
**It is the protobuf `exterior_color` oneof case off `VehicleConfig`**, NOT `getPaintColorOverride`.

### `_closure1_slot215` — RESOLVED: `getCarTypeFromConfigOrVin` (fn #29827, iOS 1212558, `var _closure1_slot215 = r20` @ 1212883)

### `_closure1_slot150` — RESOLVED: `isLightHSB` (fn #30231, iOS 1240024–1240053)
VERBATIM decode (`isLightHSB(h, s, b)`):
```
case 0:  if (b > 0.55)  return true;
case 17: if (b < 0.38)  return false;
case 31: if (s < 0.3)   return true;
case 48: return h < 180;
```
(`case 0: r1=a2; r0=0.55; if(!(!(r1 > r0))) goto 68` ≡ `if (b > 0.55) goto 68 → return true`. Double negation checked.)

### `getBlendColor` — fn #62901, iOS 2604912; export `r2['getBlendColor']` @ 2604840
```js
getBlendColor(config) {
  let s = config == null ? undefined : config.getPaintColorOverride();
  const parts = (s != null ? s : '').split(',').map(parseFloat);
  if (!isNotNil(parts) || parts.length !== 5) return [];   // ← note: FIVE floats required
  ...
  return rgb2hsb(parts[0], parts[1], parts[2]) → [h, s, b]  // + blend of parts[3], parts[4]
}
```
So **`getPaintColorOverride` IS wired in** — it's a 5-float CSV `"r,g,b,x,y"`; parsed → HSB. Returns `[]` (length 0) when absent, so the `length === 3` guard falls through to the enum path. This is why the enum path is the normal case.

---

## §3. The Godot marker chain (§2.1 of the brief)

### Verdict: **RN views, absolutely positioned over the Godot surface.** Not drawn in the scene.

`moveCameraWithCompletion` completion `_fun98627` (iOS **4039688**):
```
if (!mounted) return;
GodotBridge.getVehicleMarkers(_closure2_slot1 /* productId */, _fun98628)
```

`_fun98628` (iOS 4039697):
```
if (!_closure2_slot13 /* isVisible useState(true) */) return;
if (!isEmpty(markers))  setVehicleMarkers(markers);            // _closure2_slot15 = setState
else {
  const carType = _closure2_slot5 ?? CarType.CARTYPEMODELY;    // ← Model Y is the hard default
  setVehicleMarkers(getVehicleMarkersFallback(carType, RouteName.VehicleControlsScreen));
}
Animated.timing(_closure2_slot12 /* opacity */, {
  easing: Easing.cubic, toValue: 1, duration: 300, useNativeDriver: true
}).start();
```
**So the fallback fires whenever the Godot response is empty** — not on error, not on timeout. Just `isEmpty()`.

### `getVehicleMarkers` — fn #28720, iOS **1173701**
```js
getVehicleMarkers(vehicle_id, cb) {
  if (vehicle_id == null) return undefined;            // case 94
  godot.registerRequestListener(GodotMsgType.VEHICLE_MARKERS_RESPONSE, (resp) => {
    const out = resp ?? {};
    for (const [k, v] of Object.entries(out)) {
      if (k === 'frunk_color') continue;               // ← PASSED THROUGH RAW
      out[k] = (v ?? []).map(n => Math.round(n / _closure1_slot16));
    }
    cb(out);
  });
  godot.sendMessage(ReactMsgType.GET_VEHICLE_MARKERS, { vehicle_id });
}
```
Hermes check: `r2='frunk_color'; ... if(!(r14 !== r2)) goto 155` ≡ **`if (key === 'frunk_color') goto 155`**, and `155` is a bare `continue` — i.e. **skip the transform**. Every other key is divided and rounded.

`_closure1_slot16` (iOS **1169303–1169305**) = `PixelRatio.get()` (or `getNativeScale()` on the other branch).
⇒ **Godot returns marker coords in DEVICE PIXELS; JS converts to DP and rounds.** This is the proof they're RN views: a Godot-drawn marker would never need a DP conversion.

### Payload shape — `VEHICLE_MARKERS_RESPONSE`
A **flat dict**, not an array:
```
{
  lock:          [x_px, y_px],
  frunk:         [x_px, y_px],
  trunk:         [x_px, y_px],
  chargePort:    [x_px, y_px],
  wheel_1_1:     [x_px, y_px],   // + wheel_1_2, wheel_2_1, wheel_2_2 (TPMS)
  seatRow1L/1R, seatRow2L/2M/2R, steeringWheel, dashboard,   // Climate screen
  frunk_color:   [h, s, b, …]    // ≥3 floats, NOT scaled — the odd one out
}
```
Keys read by the Controls screen (`_fun98619`, iOS 4039785–4039824): **`lock`, `frunk`, `trunk`, `chargePort`, `wheel_1_1`, `frunk_color`**.

Message constants (iOS 1169307–1169365):
- `GodotMsgType` (`_closure1_slot17`): `GODOT_READY, GODOT_FOREGROUND, NEW_VEHICLE_SNAPSHOT, ENERGY_SITE_COMPONENT_SELECTED, VEHICLE_MARKERS_RESPONSE, MOVE_CAMERA_RESPONSE, FIRST_PRODUCT_LOADED, NEW_ENERGY_SNAPSHOT`
- `ReactMsgType` (`_closure1_slot18`): `APP_CONFIG, SET_APP_THEME, SET_SCREEN_OVERLAY_COLOR, SHOW_PRODUCT, UPDATE_PRODUCT, UPDATE_MAIN_VIEW_FRAME, SET_ENV_PARAMS, SHOW_FPS, MOVE_CAMERA, INPUT_EVENT, QUIT_ENGINE:'QUIT', TAKE_SNAPSHOTS, FLASH_HEADLIGHTS, FORCE_CLOSE_ALL_CLOSURES, FADE_ROOF, SHOW_FX_ABOVE, GET_VEHICLE_MARKERS, ENTER_TESLA_WRAPPED, EXIT_TESLA_WRAPPED`

### `getVehicleMarkersFallback` — fn #28700, iOS **1169733–1172698**
Signature `(carType, routeName)`. A ~13,000-ip flat `===` chain: **carType → routeName → hardcoded dict of `[frac_w * SCREEN_WIDTH, frac_h * SCREEN_HEIGHT]`**.

CarType dispatch (VERBATIM, unfiltered 1169746–1169818):
| ip | CarType | target |
|---|---|---|
| 0 | `CARTYPEMODEL3` | 379 |
| 50 | `CARTYPEMODELX` | 452 |
| 86 | `CARTYPETAMARIND` | 452 |
| 122 | `CARTYPEMODELS` | 525 |
| 158 | `CARTYPEMODELS2` | 525 |
| 194 | `CARTYPELYCHEE` | 525 |
| 230 | `CARTYPECYBERTRUCK` | 598 |
| 266 | `CARTYPESEMITRUCK` | 671 |
| 302 | `CARTYPEMODELY` | 744 |
| 338 | `TYPE_NOT_SET` | 744 |
| 374 | (default) | **814 → `return undefined`** |

Each group then splits `VehicleControlsScreen` vs `VehicleClimateScreen`; anything else → `814 → undefined`.
**Model Y + VehicleControlsScreen → ip 2221.** Example literal shape (from the S/Climate block @ ip 816, iOS 1169916+):
```js
{ seatRow2R: [0.631416*SCREEN_WIDTH, 0.361107*SCREEN_HEIGHT],
  seatRow1L: [0.376109*SCREEN_WIDTH, 0.228041*SCREEN_HEIGHT],
  chargePort:[0.223316*SCREEN_WIDTH, 0.569047*SCREEN_HEIGHT],
  wheel_1_1: [0.243877*SCREEN_WIDTH, 0.021041*SCREEN_HEIGHT], … }
```
**The fallback dicts contain NO `lock` key and NO `frunk_color` key** (grep over 1171200–1172700 returns only `wheel_*`, `seatRow*`, `chargePort`, `frunk`, `trunk`, `steeringWheel`, `dashboard`). Consequences:
- `lock` missing → `getButtonPosition(undefined) → null` → lock button renders with its static `styles.lockButton` only.
- `frunk_color` missing → the paint-enum path (`lightExteriorColor`) is what colours the frunk label.

Climate uses the identical chain at iOS **5226362 / 5226410**.

---

## §4. 🔑 How `isLight` is actually computed on Controls — `_fun98619` (`VehicleControlsScreen`)

Two independent sources, **Godot wins**:

**(a) Redux seed** — iOS **4039291–4039296**:
```js
const {lightExteriorColor, vehicleId} = useShallowEqualSelector(_closure1_slot12);
```
`_closure1_slot12` defined iOS **4037233–4037259** (VERBATIM):
```js
createSelector(
  [getSelectedVehicleConfig, getSelectedVehicleId],
  (config, id) => ({ lightExteriorColor: hasLightExteriorColor(config), vehicleId: id })
)
```
⇒ `r12 = lightExteriorColor`.

**(b) Godot override** — iOS **4039819–4039848**, unfiltered:
```
case 1174: r2 = r17.frunk_color
case 1182: r31 = r12;                                  // default = lightExteriorColor
           if (r2 == undefined) goto 1249
case 1189: r31 = r12;
           if (!(r2.length >= 3)) goto 1249
case 1204: r31 = isLightHSB(r2[0], r2[1], r2[2])       // r29=0, r4=1, r30=2 (confirmed 4039613-4039630)
case 1249: …
```
Equivalent:
```js
let isLight = lightExteriorColor;
if (markers.frunk_color != null && markers.frunk_color.length >= 3)
  isLight = isLightHSB(frunk_color[0], frunk_color[1], frunk_color[2]);
```
**Godot samples the actual rendered frunk area and hands back HSB.** Note this path *bypasses the Cybertruck→false shortcut* in `hasLightExteriorColor` — a bare-stainless CT gets `isLight = true` from the scene.

`r12` is used for **nothing else** in `_fun98619` (verified: only refs at 4039294 and 4039826; 4039562/4039563 are a nested closure's own `r12`).

---

## §5. The consumers — what `isLight` actually paints

### (a) Frunk button — **THE ONLY ADAPTIVE ONE.** iOS 4040340–4040354, unfiltered:
```
case 3040: if (!r31) goto 3082                     // !isLight → GRAY
case 3069: if (!r7) goto 3094                      // r7 = isCybertruck → not CT → DARK
case 3072: r31 = r23.frunk_opened
           if (!(r31 === r41)) goto 3094           // r41 = true (set @4039622); frunk closed → DARK
case 3082: r31 = styles.textColorGray
case 3094: r31 = styles.textColorDark
case 3106: r36['textStyle'] = r31
```
`r7` = `useTypedSelector(getSelectedVehicleIsCybertruck)` (iOS **4039459–4039464**, also `_closure2_slot7`).

⇒ **`textStyle = (isLight && !(isCybertruck && frunk_opened === true)) ? textColorDark : textColorGray`**

(The CT carve-out: an open CT frunk exposes a dark cavity under the label, so revert to white text.)
For the user's **red Model Y**: `isLight = false` → **always `textColorGray` = `rgba(255,255,255,0.7)`**.
For a **white car**: `isLight = true`, `isCybertruck = false` → **`textColorDark` = `rgba(0,0,0,0.7)`**. ✅ matches the user's certainty.

### (b) Trunk button — **NOT adaptive.** `_fun98630`, iOS **4040646–4040649**:
```js
r5['textStyle'] = _closure1_slot32.textColorGray;   // unconditional
```
### (c) Lock glyph — **NOT adaptive.** iOS **4040476–4040479**:
```js
{ style: styles.controlButton, iconStyle: styles.textColorGray, text: '',
  type: VehicleControlButtonType.LOCK,
  appearance: ControlButtonAppearance.STATELESS_GHOST,
  size: ControlButtonSize.LARGE, hitSlop: 40 }
```
(Cybertruck swaps this slot for `VehicleControlButtonType.SUNROOF_CONTROL` — no `iconStyle` at all, iOS 4040509–4040537.)

`textColorGray`/`textColorDark` appear at **exactly 4 sites** in the module: 4040348, 4040352 (frunk, conditional), 4040478 (lock icon, fixed), 4040644 (trunk, fixed). **Nothing else** in the app consumes `hasLightExteriorColor` (grep: only 1220299, 1240055, 1240114, 4037242).

⇒ **Answer to "text only, or icons/backdrops too?": TEXT ONLY, and only the frunk label.** The lock icon uses the *same style object* but never switches. No backdrop, no shadow, no scrim is colour-driven.

---

## §6. Style literals — VERBATIM (`_closure1_slot32`, iOS 4041057–4041168)

`StyleSheet.create({ … })`. Colour tokens resolved against the palette at iOS **1338467**.

```js
textColorDark:  { color: Colors.transparentBlack70,  fontSize: 18 }   // 'rgba(0,0,0,0.7)'
textColorGray:  { color: Colors.transparentWhite70,  fontSize: 18 }   // 'rgba(255,255,255,0.7)'
textButton:     { height: 30, minHeight: 0, paddingVertical: 0 }
disabledStyle:  { opacity: 0.4 }
controlButton:  { width: 0.25 * SCREEN_WIDTH }
lockButton:     { alignSelf: 'center', bottom: 0.4 * SCREEN_HEIGHT, position: 'absolute' }
cybertruckButton:          { alignItems:'center', height:55, justifyContent:'center', width:55 }
cybertruckButtonContainer: { alignItems:'center', height:55, justifyContent:'center', position:'absolute', width:55 }
container:      { backgroundColor: Colors.transparent /* 'transparent' */, height:'100%', position:'absolute', width:'100%' }
bottomControlButtonsRow2: { bottom: 20 /* 2 * Gutter(10) */, flexDirection:'row',
                            height: <r16>, position:'absolute', width:'100%' }
outletsText:    { fontFamily: getBlenderTSLFontFamily('Medium'), fontSize: 12,
                  fontVariant: ['lining-nums','tabular-nums'] }
titleFontSize:  { fontSize: Typography.h3.fontSize }
tonneauText:    { position:'absolute', right: 25 }
tpms:           { alignContent:'center', alignItems:'center', position:'absolute' }
tpmsButton:     { marginRight: 10, marginTop: 10 }
tpmsRcpText:    { textAlign: 'center' }
tpmsRcpView:    { alignContent:'center', alignItems:'center', marginTop: -20 /* 4294967276 = int32 -20 */ }
snapshot:       { height:'100%', resizeMode:'cover', width:'100%' }
snapshotView:   { height: SCREEN_HEIGHT, left: 0, position:'absolute',
                  top: -70 /* -7 * Gutter(10) */, width: SCREEN_WIDTH, zIndex: 4294967295 /* -1 */ }
bottomBatteryTestWarningText: { color: Gray.light, marginTop: 10, textAlign: 'center' }
bottomBatteryTestWarningView: { bottom: 20, color: Gray.mildDark, flex: 1, height: <r16>,
                                justifyContent:'flex-start', position:'absolute', width:'100%' }
```
`<r16>` = `isOHOS() ? Math.min(0.25*SCREEN_WIDTH, 80) : 0.25*SCREEN_WIDTH` (iOS 4040940–4040977). On iOS (`isOHOS()` false, OpenHarmony) ⇒ **`0.25 * SCREEN_WIDTH` = 98.25 on a 393-wide screen.**

Module constants (iOS 4040977–4040998): `slot24 = 55`, `slot25 = 30`, `slot26 = 2*Gutter = 20`, `slot27 = 20`, `slot28 = 45`, `slot29 = -60`, `slot30 = 55`. `Gutter = 10` (iOS 1338474).

**Palette (iOS 1338467, VERBATIM):** `'transparentBlack70': 'rgba(0,0,0,0.7)'`, `'transparentWhite70': 'rgba(255,255,255,0.7)'`.
(The second palette at iOS 3349010 agrees on both tokens — no divergence.)

---

## §7. Marker positioning helpers

`getButtonPosition` — fn #98600, iOS **4037381–4037399**, `_closure1_slot15`:
```js
getButtonPosition(arr) {
  if (arr == null) return null;
  return { horizontal: arr[0], vertical: arr[1] };
}
```
`buttonPositionStyle` — fn #98635, iOS **4040998–4041053**, `_closure1_slot31`:
```js
buttonPositionStyle(pos, dx = 0, dy = 0, useHorizontal = false) {
  return { position: 'absolute', alignSelf: 'center',
           top: pos.vertical + dy,
           left: useHorizontal ? pos.horizontal + dx : undefined,
           bottom: undefined };
}
```
⚠️ **4th arg defaults to `false` → `left` is `undefined` → markers are horizontally CENTRED via `alignSelf:'center'`, not placed at the Godot x.** Only the `y` is honoured by default. (Verified unfiltered: `case 65: r5 = arguments.length; r0 = 3; r7 = r5 > r0; r5 = false; …` then `case 94: if(!r5) goto 137` → `r0['left'] = undefined`.)

### Frunk marker container — iOS 4040281–4040302:
```jsx
<Animated.View style={[ buttonPositionStyle(frunkPos, 0, -15 /* -slot25/2 = -30/2 */),
                        { opacity: <Animated.Value> } ]}>
  <Button appearance={ButtonAppearance.GHOST}
          style={[styles.textButton, disabled ? styles.disabledStyle : {}]}
          disabled={!enabled}
          textStyle={isLight ? styles.textColorDark : styles.textColorGray}
          status={busy ? ControlButtonStatus.BUSY : ControlButtonStatus.NONE}
          hitSlop={50}
          onPress={() => sendFrunkCommand(frunk_opened === true, phonekey_connected, hasPoweredFrunk, false, …)}
          {...automationID('open-frunk-button')}>
    {busy ? tr('action_busy')
          : frunk_opened === true ? (hasPoweredFrunk ? tr('vehicle_home_close_trunk_button_title')
                                                     : tr('vehicle_home_opened_trunk_button_title'))
                                  : tr('vehicle_home_trunk_alert_open')}
  </Button>
</Animated.View>
```
Lock marker container — iOS 4040446–4040462: `buttonPositionStyle(lockPos, 0, -55 /* -slot30 */)`, or `{}` when `lockPos == null`.

Other dy offsets in `_fun98619` (iOS 4039855–4039869): `r14 = -slot24/2 = -27.5`; `r21 = r14 - (isCybertruck ? 60 : 40)` = **-87.5 / -67.5**; `r32 = r14 + (isCybertruck ? 60 : 40)` = **32.5 / 12.5**.

---

## §8. §5 of the brief — the bottom button row

iOS **4040237–4040252**:
```jsx
{(!isCybertruck || !r6) &&
  <View style={styles.bottomControlButtonsRow2}>
    <VehicleControlsScreenButtons />
  </View>}
```
- It is a **plain `View`, not `Animated.View`** ⇒ **it does NOT take the markers' 300ms fade.** It has no opacity of its own at all. It appears/disappears with the card's `forFade` `cardStyleInterpolator` (R7-established) and nothing else.
- Contrast: every marker (frunk / trunk / lock / chargePort) is an `Animated.View` sharing the single `_closure2_slot12` `Animated.Value(0)` (`useRef`, iOS 4039608–4039620), driven to `1` over **300ms / `Easing.cubic` / `useNativeDriver: true`** the moment the markers resolve. **This is a second, later fade layered on top of the card transition** — the markers are invisible until `moveCameraWithCompletion` fires and Godot answers.

`VehicleControlsScreenButtons` — fn #98598, iOS **4037329–4037379**, exported `r6['VehicleControlsScreenButtons']` @ 4037380:
```jsx
function VehicleControlsScreenButtons() {
  const types = useShallowEqualSelector(_closure1_slot13);   // createSelector([getOptionalVehicleControlButtonsForSelectedVehicle], fn98597)
  return <>{types.map(t => t != null &&
    <ControlButton style={styles.controlButton} type={t}
                   appearance={ControlButtonAppearance.STATELESS_GHOST} />)}</>;
}
```
`fn98597` (iOS 4037262+) builds the list from `VehicleControlButtonType.{FLASH_LIGHTS, HONK_HORN, REMOTE_START}` and conditionally splices `HOME_LINK`.
**None of these take `isLight`** — they're `STATELESS_GHOST` with no `iconStyle`/`textStyle` override. Flash/Honk/Start/HomeLink are **not** colour-adaptive.

---

## §9. UNRESOLVED / not recoverable

- The exact Model Y + `VehicleControlsScreen` fallback dict (fn28700 ip **2221**, ≈ iOS 1170050–1170350). Structure and format confirmed (`{key: [frac*SCREEN_WIDTH, frac*SCREEN_HEIGHT]}`); the ~30 literal fractions not transcribed. Recoverable on request.
- `Gray.light` / `Gray.mildDark` (used only by the battery-test warning) not resolved to hex.
- The `Button` component's own default `textStyle` (fontFamily/fontWeight/lineHeight/letterSpacing under the `textColorDark|Gray` merge) is in a different module (`_closure1_slot1[21].Button`) — **not** read this round. Tesla's marker style contributes **only** `color` + `fontSize: 18`.
- `r6` in the bottom-row render guard (`!isCybertruck || !r6`) — not traced; likely `tentModeOn` (a `getSelectedVehicleTentModeOn` selector is read at iOS 4039470).
