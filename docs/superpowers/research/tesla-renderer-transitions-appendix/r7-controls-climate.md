# R7 — Controls + Climate screens (frame + camera), iOS v4.56 verbatim

Source: `/Users/ivan/Downloads/tesla-haptics-work/main.decompiled.js` (Tesla iOS v4.56).
All line numbers are iOS bundle lines. Platform tag: [iOS-verified] unless noted.

updateMainViewFrame signature (BOTH screens, confirmed from both call sites):
`updateMainViewFrame(top_margin, left, width, height, config)`
- Controls call (iOS 4039596): `r15[r5](r14=r3=top_margin, r13=0=left, r12=r2=SCREEN_WIDTH, r11=height, r10=config)`
- Climate call (iOS 5222051): `r15[r7](r14=r6=statusBarOffset, r13=0=left, r12=SCREEN_WIDTH, r11=height, r10=config)`

---

## §1 — Resolve r4 → slot26, and the resting Controls frame

**fn #98593** (Controls MODULE init) starts at iOS **4037008**. slot26 assembled at **4040986**.

### r4 resolution
- Only THREE top-level (12-space indent) writes to register `r4` exist in the entire fn #98593 body:
  - 4037156 `r4 = {};`
  - 4037158 `r4['value'] = r1;`
  - 4037169 **`r4 = 2;`**  (context: `r5=_closure1_slot33; r4=2; r1=r9[r4]; ... var _closure1_slot3=r1` — used as a require-index)
- Between 4037170 and 4040986 there is **NO** top-level `r4` write of any form (verified `grep -nE "^            r4" range 4037170–4040986` → empty). The array-building `r4 = new Array(18)` / `r4[17]=...` seen nearby are inside a NESTED function (deeper indent), a separate register scope.
- Therefore at case 707 (line 4040986), top-level **r4 = 2**.

### Gutter resolution
- iOS 1338473-1338474: `r8 = 10; r2['Gutter'] = r8;` → **Gutter = 10** [iOS-verified].

### slot26
`case 707` block (iOS 4040975-4040991), verbatim:
```
r13 = 55;   var _closure1_slot24 = r13;   // slot24 = 55
r3  = 30;   var _closure1_slot25 = r3;    // slot25 = 30
r7  = 20;   r3 = r9[20]; r3 = ...Gutter;  // Gutter = 10
r17 = r4 * r3;   var _closure1_slot26 = r17;   // slot26 = r4(2) * Gutter(10)
var _closure1_slot27 = r7;                 // slot27 = 20
r3 = 45;    var _closure1_slot28 = r3;     // slot28 = 45
r3 = -60;   var _closure1_slot29 = r3;     // slot29 = -60
r3 = r9[..].SCREEN_HEIGHT; r14 = 0.4; r12 = 0.4 * SCREEN_HEIGHT;  var _closure1_slot30 = 55
```
**slot26 = 2 × 10 = 20.**   (slot27=20, slot28=45, slot29=-60, slot24=55, slot25=30, slot30=55 all confirmed.)

### Resting-state Controls frame (updateMainViewFrame, top-level, from useEffect fn #98623 case 130)
Frame math (iOS 4039534-4039561), slot7 = getSelectedVehicleIsCybertruck, slot8 = (Platform.OS==='android'):
```
top_margin = (slot7 && slot8) ? slot29(-60) : 0
r1         = slot7 ? (slot8 ? slot27(20) : slot28(45)) : slot26(20)
height     = SCREEN_HEIGHT - r1
width      = SCREEN_WIDTH ;  left = 0
```
| vehicle / platform            | slot7 | slot8 | top_margin | height              |
|-------------------------------|-------|-------|-----------|----------------------|
| **NORMAL iOS (we ship)**      | false | false | **0**     | **SCREEN_HEIGHT − 20** (slot26) |
| Cybertruck iOS                | true  | false | 0         | SCREEN_HEIGHT − 45 (slot28) |
| Cybertruck Android            | true  | true  | −60       | SCREEN_HEIGHT − 20 (slot27) |
| Normal Android                | false | true  | 0         | SCREEN_HEIGHT − 20 (slot26) |

So the NORMAL-iOS resting Controls frame = **{ top:0, left:0, width:SCREEN_WIDTH, height:SCREEN_HEIGHT − 20 }**.

---

## §2 — Complete Controls camera behavior + any per-state override

There are exactly **TWO** useEffects in the Controls module:
- **fn #98623** (iOS 4039511): does ONLY updateMainViewFrame (above) + a 150ms `showFXAbove`. No camera move.
- **fn #98626** (iOS 4039640): the camera + product effect. Body verbatim:
  - case 26 (only if `_closure2_slot1` (product id) != null): `updateProduct({ id:<slot1>, type:ProductType.VEHICLE, mobile_app_state:{is_loading:false, show_terrain:false} })` (iOS 4039646-4039674).
  - case 112 (ALWAYS): `moveCameraWithCompletion({ position: CameraPosition.TOP_DOWN, carType:<slot5>, completion:<fn98627> })` (iOS 4039675-4039683).

**No state machine.** grep across the whole Controls module (4037008–4041000) for `moveCameraWithCompletion` / `CameraPosition` returns exactly ONE camera move, and it is **TOP_DOWN**, unconditional. Unlike Home's #110988, Controls has NO per-vehicle-state (charging/tent/tonneau) camera override — the tonneau/tent buttons affect vehicle-marker overlays, not the camera pose. Camera is always TOP_DOWN while on Controls.

MOVE_CAMERA call-site payload (verbatim, the object literal built at the JS layer before moveCameraWithCompletion resolves the renderer message):
```
{ 'position': CameraPosition.TOP_DOWN, 'carType': <selected vehicle carType>, completion: <fn98627 getVehicleMarkers loop> }
```
The rotation/offset/cam_fov of the actual MOVE_CAMERA renderer message are resolved INSIDE moveCameraWithCompletion from the pose tables (see §3).

---

## §3 — CameraPosition.TOP_DOWN pose (pose tables at iOS 1169441+)

The pose is assembled from TWO closures merged inside moveCameraWithCompletion:
- **slot22** = position → lighting/fov base (rotation/offset = null here). TOP_DOWN base (iOS 1169510→1169521): `{rotation:null, offset:null, envRotation:null, envEnergy:4.5, ambEnergy:4, cam_fov:40, rotateSkyBox:false}`. CLIMATE base (1169522→1169529): `{...envEnergy:4, ambEnergy:4, cam_fov:40, rotateSkyBox:false}`. → **cam_fov = 40 for both TOP_DOWN and CLIMATE** [iOS-verified].
- **slot23** = carType → position → {rotation, offset, envRotation}. Built via `r9.default(defaultMap, cartypeKey, overrideMap)` merges (iOS 1169595-1169740).

### DEFAULT-car map (r5, iOS 1169598-1169660) — offsets are LITERAL, resolved:
- **TOP_DOWN** (1169655-1169658): `offset:[0, 11, 0.3]`, envRotation:[0,90,70], envEnergy:r27, ambEnergy:3.7. rotation NOT set → null → [0,0,0].
- **CLIMATE**  (1169619-1169633): `offset:[0, 7, r32]` with r32=-0.5 → `offset:[0, 7, -0.5]`, envRotation:[0,90,70], ambEnergy:3.7. rotation null → [0,0,0].
- (PARKED offset:[-0.06,7.5,-0.1]; DRIVE offset:[-0.06,7.5,-0.1]; CHARGING rotation:[78,-55,r30], offset:[0,7,-0.1].)

### CYBERTRUCK map (r1, iOS 1169666-1169733):
- TOP_DOWN (1169719): `offset:[0, 12, 0.22]`, envRotation:[-67,67,-67], envEnergy:16.
- CLIMATE  (1169730): `offset:[0, 5.5, -0.2]`, envEnergy:r10.
- PARKED rotation:[80,r26,-0.15], offset:[-0.14,r22,r30]; CHARGING/DRIVE_REVERSE offset:[0.1,6.55,-0.15].

**DISCREPANCY vs the R7 task expectation** (`TOP_DOWN = {rotation:[0,0,0], offset:[0,10,0], cam_fov:40}`):
- cam_fov:40 ✓ and rotation:[0,0,0] ✓ CONFIRMED.
- **offset is NOT [0,10,0]** in v4.56. Actual default-car TOP_DOWN offset = **[0, 11, 0.3]** (cybertruck [0,12,0.22]). The [0,10,0] value appears to be an older-bundle/R5 approximation. Straight-down orientation (rotation [0,0,0], large +Y offset) is confirmed, but the exact literal is [0,11,0.3].
- Which of {default-map, semitruck, cybertruck} a NORMAL car falls back to depends on the `r9.default(base, key, override)` merge semantics, which I did not fully disassemble (r9 = module bound at 1169245). PLAUSIBLE, not fully CONFIRMED, that a normal car → the r5 "default" map (offset [0,11,0.3]). Flagging for R5 cross-check.

---

## §4 — Climate screen frame + reconcile "MORE HOOD / too high & small"

**fn #120832** (Climate updateMainViewFrame useEffect), iOS 5222006-5222048. Verbatim math:
```
r6  = Specifications.statusBarOffset         // top_margin
r12 = SCREEN_WIDTH                            // width
r4  = SCREEN_HEIGHT
r2  = Specifications.statusBarOffset
r4  = r4 - r2                                 // SCREEN_HEIGHT - statusBarOffset
r2  = 320 ;  r9 = r4 - r2                     // - 320   (literal 320, iOS 5222040)
r13 = 0                                       // left
r2  = 80  ;  r11 = r9 + r2                    // + 80    (literal 80,  iOS 5222043)
call updateMainViewFrame(top=r6, left=0, width=r12, height=r11, config=r10)
```
→ **top_margin = statusBarOffset ; height = SCREEN_HEIGHT − statusBarOffset − 320 + 80 = SCREEN_HEIGHT − statusBarOffset − 240** ; width=SCREEN_WIDTH ; left=0.
Literals **320 and 80 are inline** (NOT named constants) — CONFIRMED.

### SCREEN_HEIGHT (fn #32420, iOS 1333955-1333965)
iOS branch (Platform.OS !== 'android'): `SCREEN_HEIGHT = Dimensions.get('window').height`. **Full window height (852 on a 393×852 phone), NOT safe-area.** Android branch = getScreenHeight() − getBottomInset(). CONFIRMED.

### statusBarOffset (fn #32533, iOS 1338583-1338592) + statusBarHeight (iOS ~1338500)
- statusBarOffset: iOS → statusBarHeight(); android → 0.
- statusBarHeight literals (verbatim, iOS 1338500-1338560): iPhone13,1 / iPhone13 / iPhone14,4 / iPhone14,6 / iPhone14 / iPhone15 / iPhone16 / iPhone17 / iPhone18 → **59**; other notch → 47; non-notch → 50.
- 393×852 Dynamic-Island phone → **statusBarOffset = 59**. CONFIRMED.

### Climate rect @ 393×852 / statusBarOffset 59
- top = 59, left = 0, width = 393
- height = 852 − 59 − 320 + 80 = 852 − 59 − 240 = **553**
- scale (R6: root_node.scale = height/SCREEN_HEIGHT) = 553/852 = **0.6491**
- center_y (R6: top_margin + SCREEN_HEIGHT/2 · scale) = 59 + 426·0.6491 = **335.5**
  Note: SCREEN_HEIGHT cancels → **center_y ≡ top_margin + height/2 = 59 + 276.5 = 335.5**.

### RECONCILE "car too high & small, MORE HOOD"
Because center_y = top_margin + height/2 and on-screen car size ∝ scale = height/SCREEN_HEIGHT, **both symptoms are driven by the frame HEIGHT being too small**:
- height too small → scale too small → car rendered SMALLER;
- height too small → center_y = top+height/2 moves UP → car HIGHER → with the CLIMATE camera's KEEP_HEIGHT vertical fov this reveals MORE HOOD.
- All three symptoms co-occur ⇒ single root cause = **airgapp's Climate frame height < 553**.

Most likely source of the too-small height (ranked):
1. **SCREEN_HEIGHT fed as safe-area/`screen` instead of `Dimensions.get('window').height`.** If airgapp used a safe-area height (e.g. 852−59−34≈759) or `Dimensions.get('screen')` minus insets, then height = 759 − 59 − 240 = **460** → scale 0.54, center 289 → distinctly smaller & higher w/ more hood. The Tesla app uses the RAW window height (852). This is the prime suspect.
2. Subtracting an extra bottom home-indicator inset (~34px) somewhere in the height chain → height≈519, same direction.
3. statusBarOffset mismatch is the WRONG direction and can be ruled out as the primary cause: using 47/50 instead of 59 gives a LARGER height (565/562) → car bigger & lower, opposite of the symptom.

**Recommendation:** ensure airgapp Climate height = `Dimensions.get('window').height(=852) − statusBarOffset(=59) − 240 = 553` exactly, with SCREEN_HEIGHT = full window height (no safe-area, no bottom-inset subtraction). Do NOT double-count status bar or safe-area insets.

---

## §5 — Climate MOVE_CAMERA payload (fn #120884 useEffect, iOS 5226343-5226354)

Call-site object literal, verbatim:
```
{ 'position': CameraPosition.CLIMATE, 'carType': <_closure2_slot1 selected carType>, completion: <fn120894 getVehicleMarkers loop> }
```
Preceded (case 26, when product id present) by `updateProduct({id, type:ProductType.VEHICLE, mobile_app_state:{is_loading:false, show_terrain:false}})` — same pattern as Controls.

Resolved CLIMATE renderer pose (default-car map, §3): **cam_fov 40, rotation [0,0,0], offset [0, 7, −0.5]**, envRotation [0,90,70], ambEnergy 3.7.
Cybertruck CLIMATE: offset [0, 5.5, −0.2].

**DISCREPANCY vs task expectation** (`CLIMATE = {rotation:[0,0,0], offset:[0,6,0.6], cam_fov:40}`): cam_fov:40 ✓, rotation:[0,0,0] ✓, but **offset is [0, 7, −0.5]** in v4.56 (default map), not [0,6,0.6]. [0,6,0.6] appears to be an older/R5 value. Same merge-semantics caveat as §3 (PLAUSIBLE the default map applies to normal cars).
