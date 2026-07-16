# R7 blockers — resolved by me (iOS main.decompiled.js v4.56), before workflow

## Controls screen (fn #98623 useEffect; module init fn #98593)
- Pose: **CameraPosition.TOP_DOWN** via `moveCameraWithCompletion({position:TOP_DOWN, carType})` (iOS ~4039690). CORRECTS R5 §3b (which said PARKED). `mobile_app_state={is_loading:false, show_terrain:false}`.
- Frame (updateMainViewFrame(top, 0, SCREEN_WIDTH, height, animated)):
  - `top_margin = (slot7 && slot8) ? slot29(-60) : 0`
  - `height = SCREEN_HEIGHT − ( slot7 ? (slot8 ? slot27(20) : slot28(45)) : slot26 )`
  - **slot7 = getSelectedVehicleIsCybertruck** (iOS 4039464); **slot8 = (Platform.OS==='android')** (iOS 4039477)
  - Constants (iOS case 707, ~4040976-4040991): slot24=55, slot25=30, **slot26 = r4·Gutter**, slot27=20, slot28=45, slot29=-60
  - **r4 = 2** (fn #98593 main-body, iOS 4037169; last 12-space r4= before case 707; nested closures have separate frames) → **slot26 = 2·10 = 20**
- ⇒ **Normal iOS (non-CT): top_margin=0, height=SCREEN_HEIGHT−20**. On 852 phone: height=832, scale=832/852=**0.9765**.
  - Cybertruck iOS: top=0, height=SCREEN_HEIGHT−45. CT android: top=−60, height=SCREEN_HEIGHT−20.
- SYMPTOM MATCH: team shipped full-screen (height 852, scale 1.0) → their car ~2.4% BIGGER than official (832/852). ✔

## Climate screen (fn #120832; iOS ~5222013)
- Frame: `updateMainViewFrame(top=statusBarOffset, left=0, width=SCREEN_WIDTH, height, animated)`
  - height = SCREEN_HEIGHT − statusBarOffset − **320** + **80** (320 & 80 are inline literals, NOT a named sheet const) = SCREEN_HEIGHT − statusBarOffset − 240
- **SCREEN_HEIGHT (iOS) = `Dimensions.get('window').height`** (fn #32420, iOS ~1333928; non-android branch). = full window (852 on 393×852), NOT safe-area/818.
- **statusBarOffset = Specifications.statusBarOffset**; iOS = statusBarHeight() (android=0). statusBarHeight fn (iOS ~1338500): iPhone14/15/16/17/18 → **59**; other notch → 47; non-notch → 50. 393×852 Dynamic-Island ⇒ **59**.
- ⇒ On 852/59 phone: top=59, height=852−59−240=**553**, scale=553/852=**0.649**.
- SYMPTOM ("more hood"): top/height/statusBarOffset all match team's; PRIME SUSPECT = team's SCREEN_HEIGHT source (if they used safe-area ~818 or window-minus-home-indicator instead of Dimensions.get('window').height=852). Reconcile with R6 center_y in synthesis.

## Pose table refs
- TOP_DOWN = {rotation[0,0,0], offset[0,10,0], cam_fov 40} (straight down)
- CLIMATE = {rotation[0,0,0], offset[0,6,0.6], cam_fov 40}
- Home/PARKED = 3/4 hero; frame top=statusBarHeight+60, height=GODOT_VIEW_SIZE=355
- Pose table at iOS 1169441+ ; CameraPosition→screen map ~1169820+

## FULL POSE TABLE (verbatim, iOS 1169440-1169600) — CameraPosition presets
Each: {rotation, offset, envRotation, envEnergy, ambEnergy, cam_fov, rotateSkyBox}. Dynamic X-rotation (r39/r18/r15/r17/r21) = per-carType.
- PARKED:        rotation[~68.6(carType)], offset[carType], envRot[0], envEnergy 6,   ambEnergy 2.6, fov 40, sky false
- CHARGING:      rotation[~74(carType)],   offset[0,6.55,0],              envEnergy 5,   ambEnergy 4,   fov 40, sky false
- DRIVE:         rotation[~68.6(carType)], offset[carType],               envEnergy 6,   ambEnergy 2.6, fov 40, sky false
- DRIVE_REVERSE: rotation[~74(carType)],   offset[0,8,0],                 envEnergy 5,   ambEnergy 3,   fov 40, sky false
- TOP_DOWN:      rotation[0,0,0],          offset[0,10,0],   envRot[0,0,0],envEnergy 4.5, ambEnergy 4,   fov 40, sky false
- CLIMATE:       rotation[0,0,0],          offset[0,6,0.6],  envRot[0,40,0],envEnergy 4,  ambEnergy 4,   fov 40, sky false
- ENERGY:        rotation[69,0,0],         offset[0,12],                  envEnergy 8,   ambEnergy 4,   fov 10, sky false
- CLOSURE_OPEN:  rotation[~62.654(carType)],offset[0,45,0],               envEnergy 14,  ambEnergy 2,   fov 58, sky TRUE
- TENT_MODE:     rotation[~80(carType)],   offset[0.2,4.5],  envRot[0,45,0],envEnergy 14, ambEnergy 2,   fov 56, sky TRUE
- VEHICLE_TO_HOME:rotation[~74,38.5,0(carType)],                          envEnergy 14,  ambEnergy 2,   fov 20, sky false
Table is keyed by carType→position (per-carType offset/rotation overrides via r25[0]=r39 etc. at ~1169600+).

## §4 CALIBRATION (393×852-pt, statusBarHeight=59). Handler (R6): scale=height/screen_height; center_y=top_margin+screen_height/2·scale=top_margin+height/2; center_x=left_margin+width/2. Car net = root_node.scale × vehicle_scale(1.1).
| Screen  | top_margin | height          | scale=h/852 | center_y (pt) | center_x (pt) |
|---------|-----------|-----------------|-------------|---------------|---------------|
| Home    | 119 (=59+60) | 355          | 0.4167      | 296.5         | 196.5         |
| Controls| 0         | 832 (=852−20)   | 0.9765      | 416.0         | 196.5         |
| Climate | 59        | 553 (=852−59−240)| 0.6491     | 335.5         | 196.5         |

## §2.5 "MORE HOOD" RECONCILED (geometry)
Official Climate: scale 0.649, center_y 335.5. If team used SCREEN_HEIGHT=safe-area(~818) not window(852):
  height=818−59−240=519; Godot screen_height still 852 (full window; proven by Home matching on-device) ⇒ scale=519/852=0.609 (SMALLER car), center_y=59+852/2·0.609=318.5 (HIGHER). Smaller+higher ⇒ more foreground/hood. ✔ matches symptom.
FIX: SCREEN_HEIGHT = Dimensions.get('window').height = 852 (full window incl. home-indicator area), NOT safe-area/818.
