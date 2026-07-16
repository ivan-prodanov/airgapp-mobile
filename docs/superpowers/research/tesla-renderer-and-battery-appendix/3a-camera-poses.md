# R5 §3 — Godot camera poses (MOVE_CAMERA) — VERBATIM

Sources: iOS `main.decompiled.js` (v4.56); Android `bundle.hasm` (v4.58). Every scalar object
literal (`envEnergy/ambEnergy/cam_fov/rotateSkyBox`) matches BYTE-FOR-BYTE across both platforms
(iOS JS literal == Android `# Object:` comment). Array components (`rotation/offset/envRotation`)
were traced register-by-register on BOTH platforms and agree. Tags below reflect that.

================================================================================
## 1. MOVE_CAMERA payload shape (VERBATIM)  [both-match]
================================================================================

### Bridge input — `moveCamera(a0)` (iOS fn #28708 @ main.decompiled.js:1172931-1173160;
Android Function #29155 "moveCamera" @ bundle.hasm:1390003)

Input object `a0` keys and defaults:
```
{
  position:         <CameraPosition enum value>   // required; table key
  updateEnvironment: <bool>   default true
  animated:          <bool>   default true
  duration:          <num>    default = _closure2_slot0.defaultCameraAnimationDuration (0.5)
  transitionType:    <enum>   default = _closure2_slot0.defaultCameraAnimationTransition (QUART)
  easeType:          <enum>   default = _closure2_slot0.defaultCameraAnimationEase (OUT)
  carType:           <enum>   default = CarType.CARTYPEMODEL3
}
```

### Message #1 — `MOVE_CAMERA` object actually sent to Godot (iOS :1173015-1173038):
VERBATIM keys, in order:
```
{
  'rotation':        pose.rotation,       // [x,y,z] degrees
  'offset':          pose.offset,         // [x,y,z]
  'cam_fov':         pose.cam_fov,        // number
  'animated':        r7,                  // = a0.animated (default true)
  'duration':        r6,                  // = a0.duration (default 0.5)
  'transition_type': r5,                  // = a0.transitionType (default QUART)
  'ease_type':       r4,                  // = a0.easeType (default OUT)
  'animation_id':    r10                  // = uuid.v4()  (fresh UUID per call)
}
```
NOTE: there is NO target / near / far / orbit / distance key. cam_fov + rotation + offset are the
only geometric fields. Android identical (bundle.hasm:1390083 GetById MOVE_CAMERA, same 8 keys).

### Message #2 — `SET_ENV_PARAMS` sent immediately after, IFF a0.updateEnvironment===true
(iOS :1173044-1173063). This is where the env/lighting half of each pose object goes:
```
{
  'rotation':        pose.envRotation,    // [x,y,z] degrees  (NOTE: key is 'rotation', value is envRotation)
  'env_energy':      pose.envEnergy,
  'amb_energy':      pose.ambEnergy,
  'animated':        r7,
  'duration':        r6,
  'transition_type': r5,
  'ease_type':       r4,
  'rotate_sky_box':  pose.rotateSkyBox
}
```

### Default animation constants (GodotModule state init, iOS :1174108-1174113)  [iOS-verified; Android has same QUART/OUT enums]
```
defaultCameraAnimationDuration   = 0.5
defaultCameraAnimationTransition = TweenTransitionType.QUART
defaultCameraAnimationEase       = TweenEaseType.OUT
```
Enum numeric values (TweenTransitionType, both platforms): LINEAR=0, SINE=1, QUINT=2, QUART=3,
QUAD=4, EXPO=5, ELASTIC=6, CUBIC=7, CIRC=8, BOUNCE=9, BACK=10.  TweenEaseType: IN=0, OUT=1,
IN_OUT=2, OUT_IN=3. (Derived from the enum-build blocks; LINEAR=0 confirmed since it is reused as
the `[2]=0` filler throughout the pose arrays.)

================================================================================
## 2. CameraPosition enum + the master pose table (VERBATIM, fully resolved)
================================================================================

CameraPosition enum values (iOS :1169360-1169390; Android string ids):
`PARKED, TOP_DOWN, CLIMATE, CHARGING, DRIVE, DRIVE_REVERSE, TENT_MODE, CLOSURE_OPEN,
VEHICLE_TO_HOME, ENERGY`.

### 2a. BASE table (default = Model 3 / Y / S / X)
iOS: main.decompiled.js:1169441-1169607 (closure slot `_closure1_slot22`).
Android: bundle.hasm:1385666-1385914 (offsets 0x550-0x914).
Each row VERBATIM (arrays fully resolved, cross-checked both platforms):

```
PARKED:          { rotation:[68.6, -138, 0],      offset:[-0.06, 6.7, 0],   envRotation:[0, -11, 83],  envEnergy:6,   ambEnergy:2.6, cam_fov:40, rotateSkyBox:false }
CHARGING:        { rotation:[74, -38, 0],         offset:[0, 6.55, 0],      envRotation:[-20, 53, 30], envEnergy:5,   ambEnergy:4,   cam_fov:40, rotateSkyBox:false }
DRIVE:           { rotation:[68.6, -138, 0],      offset:[-0.06, 8, 0],     envRotation:[0, -11, 83],  envEnergy:6,   ambEnergy:2.6, cam_fov:40, rotateSkyBox:false }
DRIVE_REVERSE:   { rotation:[74, -38, 0],         offset:[0, 8, 0],         envRotation:[-9, -7, 75],  envEnergy:5,   ambEnergy:3,   cam_fov:40, rotateSkyBox:false }
TOP_DOWN:        { rotation:[0, 0, 0],            offset:[0, 10, 0],        envRotation:[0, -3, 87],   envEnergy:4.5, ambEnergy:4,   cam_fov:40, rotateSkyBox:false }
CLIMATE:         { rotation:[0, 0, 0],            offset:[0, 6, 0.6],       envRotation:[0, 40, 0],    envEnergy:4,   ambEnergy:4,   cam_fov:40, rotateSkyBox:false }
ENERGY:          { rotation:[69, 0, 0],           offset:[0, 12, -0.5],     envRotation:[0, -45, 0],   envEnergy:8,   ambEnergy:4,   cam_fov:10, rotateSkyBox:false }
CLOSURE_OPEN:    { rotation:[62.654, -139.64, 0], offset:[-0.086, 4.7, 0],  envRotation:[0, 45, 0],    envEnergy:14,  ambEnergy:2,   cam_fov:58, rotateSkyBox:true }
TENT_MODE:       { rotation:[80, -17, 0],         offset:[0.2, 4.5, -0.2],  envRotation:[0, 45, 0],    envEnergy:14,  ambEnergy:2,   cam_fov:56, rotateSkyBox:true }
VEHICLE_TO_HOME: { rotation:[74, 38.5, 0],        offset:[-0.4, 15.5, 0],   envRotation:[-40, 80, -20],cam_fov:20,    envEnergy:14,  ambEnergy:2,   rotateSkyBox:false }
```
Resolution note that was the classic trap: DRIVE.offset[1] = 8 (NOT 6.7). iOS `r21 = 8`
(main.decompiled.js:1169256) reused at :1169472; Android Reg20 = LoadConstUInt8 8 (bundle.hasm
0x177) reused at 0x65f, no intervening write. Confirmed on BOTH.

### 2b. Semi (CarType.CARTYPESEMITRUCK) overrides — merged via Object.assign onto base
iOS :1169611-1169655; Android 0x91d-0xa84 (0x944-0xa7f). Only listed views override; others fall
through to base. `envEnergy`/`ambEnergy` values below are literal light energies (some come from a
register that happens to alias a tween-enum slot; resolved to their numeric value):
```
PARKED: { offset:[-0.06, 7.5, -0.1], envRotation:[0, -7, 83] }
DRIVE:  { offset:[-0.06, 7.5, -0.1], envRotation:[0, -7, 83] }
CLIMATE:{ offset:[0, 7, -0.5],       envRotation:[0, 90, 70], envEnergy:6, ambEnergy:3.7 }
CHARGING:{ rotation:[78, -55, 0],    offset:[0, 7, -0.1],     envRotation:[-20, 53, 30], envEnergy:5, ambEnergy:3.4 }
TOP_DOWN:{ offset:[0, 11, 0.3],      envRotation:[0, 90, 70], envEnergy:6, ambEnergy:3.7 }
```
[Semi envEnergy/ambEnergy: PLAUSIBLE — geometry (rotation/offset/envRotation) is CONFIRMED both
platforms; the two energy scalars derive from reused enum registers, resolved to 5/6 & 3.4/3.7.]

### 2c. Cybertruck (CarType.CARTYPECYBERTRUCK) overrides — Object.assign onto base
iOS :1169658+; Android 0xa96-0xc15. Geometry CONFIRMED both platforms:
```
PARKED:        { rotation:[80, -138, -0.15], offset:[-0.14, 3, 0],     envRotation:[0, 45, 0],    envEnergy:14, ambEnergy:2, cam_fov:80, rotateSkyBox:true }
CHARGING:      { offset:[0.1, 6.55, -0.15],  envRotation:[8, 60, 0],   envEnergy:14, ambEnergy:2 }
DRIVE:         { envRotation:[0, 45, -0.05], envEnergy:14, ambEnergy:2 }
DRIVE_REVERSE: { offset:[0.1, 6.55, -0.15],  envRotation:[8, 60, 0],   envEnergy:14, ambEnergy:2 }
TOP_DOWN:      { offset:[0, 12, 0.22],       envRotation:[-67, 67, -67], envEnergy:16, ambEnergy:3 }
CLIMATE:       { offset:[0, 5.5, -0.2],      envRotation:[-40, 0, 0],  envEnergy:14, ambEnergy:2 }
```
Cybertruck PARKED.offset[1]=3: iOS `r22 = 3` (:1169232, only assignment) reused; Android Reg22
(=QUART slot, numeric 3) reused, no intervening write. Confirmed both.
Also: constant `CYBERTRUCK_PARKED_WHEEL_TURN_DEG = -22` (iOS :1169419; Android 0x540).

### 2d. Which SCREEN / STATE selects which CameraPosition  [iOS-verified]
The Home/product screen picks the position from VEHICLE STATE, not route name (iOS state machine
fn #110988 @ main.decompiled.js:4562100-4562300):
- default -> `PARKED`
- closures/tonneau open (not STATIONARY) -> `CLOSURE_OPEN`
- charging -> `CHARGING`
- tent mode -> `TENT_MODE`
- ShiftState.D -> `DRIVE`;  ShiftState.R -> `DRIVE_REVERSE`
- (charge flow) -> `CHARGING`;  summon/"vehicle to home" -> `VEHICLE_TO_HOME`
Climate screen -> `CLIMATE`; a top-down affordance -> `TOP_DOWN`; energy product -> `ENERGY`.
(There is no separate "Controls" pose — Controls IS the Home product view = `PARKED` at rest.)

================================================================================
## 3. VIEWPORT DEPENDENCE  — the "looks bigger" question   [KEY FINDING]
================================================================================

### 3a. The MAIN per-view poses are NOT viewport-dependent.  [both-match]
Every row in §2 has a HARD-CODED numeric `cam_fov`, `offset`, `rotation`. None reads width /
height / aspect ratio / safe-area insets / device class. `moveCamera` is a pure lookup keyed by
`position` (+ carType). No width/height feeds cam_fov or offset for the main product view.

### 3b. Viewport size is delivered on a SEPARATE channel: UPDATE_MAIN_VIEW_FRAME  [both-match]
`updateMainViewFrame(...)` (iOS fn #28712 @ main.decompiled.js:1173192-1173316) sends the render
RECT to Godot — this is what actually changes as panels/sheets resize the 3D area. VERBATIM sent
object (iOS :1173293-1173312):
```
{
  'top_margin':      arg0 * nativeScale,   // nativeScale = _closure1_slot16 = getNativeScale()
  'left_margin':     arg1 * nativeScale,
  'width':           arg2 * nativeScale,
  'height':          arg3 * nativeScale,
  'animated':        arg4,   // default true
  'duration':        arg5,   // default defaultCameraAnimationDuration (0.5)
  'transition_type': arg6,   // default QUART
  'ease_type':       arg7,   // default OUT
  'scroll_fraction': arg8    // default 1
}
```
INFERRED cause of "looks bigger": FOV is constant while the main-view frame (width/height) changes
between screens; the same constant-FOV projection rendered into a differently-sized/positioned rect
changes the car's apparent on-screen size. The lever is UPDATE_MAIN_VIEW_FRAME width/height (+
scroll_fraction/top_margin), not cam_fov.

### 3c. The ONLY viewport(SCREEN_HEIGHT)-dependent FOV is the SERVICE / small-vehicle carousel.
[iOS-verified; Android has same DeviceSizeClass table]
`ScaledSmallVehicleCamFov` and `ScaledTopPadding` are `interpolate()` outputs keyed on SCREEN_HEIGHT
(iOS main.decompiled.js:7712797-7712858):
```
ScaledSmallVehicleCamFov = interpolate( SCREEN_HEIGHT,
                                        [DeviceSizeClass.IPHONE_4_INCH_LIKE.height,      // 568
                                         DeviceSizeClass.IPHONE_12_INCH_LIKE.height],    // 926
                                        [80, 70],                                        // FOV out-range
                                        Extrapolation.CLAMP )
ScaledTopPadding         = interpolate( SCREEN_HEIGHT, [568, 926], [50, 40], Extrapolation.CLAMP )
```
DeviceSizeClass heights (iOS :1341896-1341912): IPHONE_4_INCH_LIKE {h:568,w:320},
IPHONE_4_SEVEN_INCH_LIKE {667,375}, IPHONE_5_HALF_INCH_LIKE {736,414},
IPHONE_5_EIGHT_INCH_LIKE {812,375}, IPHONE_12_INCH_LIKE {926,428}.
=> Small phones (height<=568) get cam_fov 80; large phones (height>=926) get 70; linear between.
Used by `getServiceHomeCamera` (iOS :7708927-7708960): `{ rotation:[82.5,-138,0],
cam_fov: ScaledSmallVehicleCamFov, offset:[-0.7, <base.offset[1]>, 0.4] }` and
`getServiceCarouselCameraPosition`/`getServiceCameraSettingsByCarType`. This is SERVICE-mode only —
it does NOT affect the normal Home/Controls/Climate/Charging product camera.

================================================================================
## 4. Camera tween on navigation between screens   [both-match]
================================================================================
YES — MOVE_CAMERA animates. Fields on every MOVE_CAMERA (and the paired SET_ENV_PARAMS and
UPDATE_MAIN_VIEW_FRAME): `animated` (default true), `duration` (default 0.5 s), `transition_type`
(default QUART), `ease_type` (default OUT), plus `animation_id` (fresh uuid.v4 per MOVE_CAMERA).
Any caller may override duration/transitionType/easeType per call.

### Partial-MOVE_CAMERA overrides seen (cam_fov-only tweens, no position lookup):
- Energy LLM-status bottom sheet CLOSE: `MOVE_CAMERA {'cam_fov':10, 'animated':true, 'duration':2}`
  (iOS main.decompiled.js:4796071)
- Energy LLM-status bottom sheet OPEN:  `MOVE_CAMERA {'cam_fov':8,  'animated':true, 'duration':2}`
  (iOS main.decompiled.js:4796179)
- Energy map (Android bundle.hasm:7430860/7430885):
  `{'cam_fov':8,  'fade_labels':true}` and `{'cam_fov':10, 'fade_labels':false}`
  (=> `fade_labels` is an additional optional MOVE_CAMERA key used by the energy map view.)

================================================================================
## Full MOVE_CAMERA / SET_ENV_PARAMS / UPDATE_MAIN_VIEW_FRAME key inventory (union of all sites)
================================================================================
MOVE_CAMERA keys observed: rotation, offset, cam_fov, animated, duration, transition_type,
ease_type, animation_id, fade_labels. (No target/near/far/orbit/distance anywhere.)
SET_ENV_PARAMS keys: rotation(=envRotation), env_energy, amb_energy, animated, duration,
transition_type, ease_type, rotate_sky_box.
UPDATE_MAIN_VIEW_FRAME keys: top_margin, left_margin, width, height, animated, duration,
transition_type, ease_type, scroll_fraction.
