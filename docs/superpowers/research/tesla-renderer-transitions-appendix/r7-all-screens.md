# R7 §3 — Every renderer-hosting screen: CameraPosition + UPDATE_MAIN_VIEW_FRAME

Source: iOS `/Users/ivan/Downloads/tesla-haptics-work/main.decompiled.js` (Tesla iOS v4.56). All line numbers are iOS. Cross-checked vs R5 §3b (`tesla-renderer-and-battery-FINDINGS.md`). Tag: [iOS-verified]; pose table [both-match] per R5.

## Method / completeness
`grep` for `moveCameraWithCompletion`, `moveCamera`, `setCamera`, `CameraPosition.`, `MOVE_CAMERA`, `updateMainViewFrame` returns EVERY consumer. There are exactly **5 renderer-hosting screens**. The only other `setCamera` (iOS :1805130, :1806361) is **react-native-maps** (the real map), NOT the Godot vehicle renderer.

The GodotView is a **single persistent full-screen host**; screens do not remount it — they only re-issue `MOVE_CAMERA` (+ paired `SET_ENV_PARAMS`) and `UPDATE_MAIN_VIEW_FRAME`. `moveCamera` payload = `{position, carType, animated}`; it looks up the pose table by `position`(+carType) and emits `MOVE_CAMERA {rotation,offset,cam_fov,animated,duration,transition_type,ease_type,animation_id}` + `SET_ENV_PARAMS`. Frame values are ×renderScale (iOS `GodotModule.getNativeScale()`).

## CameraPosition enum (iOS :1169364)
`{PARKED, TOP_DOWN, CLIMATE, CHARGING, DRIVE, DRIVE_REVERSE, TENT_MODE, CLOSURE_OPEN, VEHICLE_TO_HOME, ENERGY}`

---

## Per-screen table (frame = {top_margin, left_margin, width, height})

| # | Screen (fn) | CameraPosition | top_margin | left | width | height | cite |
|---|---|---|---|---|---|---|---|
| 1 | **Home / product view** (#110988 :4562236; #111050 :4559031) | **state machine** (default PARKED; overrides below) | `Specifications.statusBarHeight + 60` (`+ LOOTBOX_TOP_BANNER_HEIGHT` if lootbox) | 0 | `SCREEN_WIDTH` | `GODOT_VIEW_SIZE = 355` | :4562236, :4559031 |
| 2 | **Controls** (#98623 :4039518) | **TOP_DOWN** | `(isCT && isAndroid) ? -60 : 0` | 0 | `SCREEN_WIDTH` | `SCREEN_HEIGHT − (isCT ? (isAndroid?20:45) : (r4·Gutter=10·r4))` | :4039677 (moveCameraWithCompletion), :4039518 |
| 3 | **Climate** (#120832 :5222013) | **CLIMATE** | `Specifications.statusBarOffset` | 0 | `SCREEN_WIDTH` | `SCREEN_HEIGHT − statusBarOffset − 240` (= −320 +80 inline) | :5226346 (moveCameraWithCompletion), :5222016 |
| 4 | **Energy / Powershare** (#111594 :4591393) | **ENERGY** | `_closure2_slot26` (useState, seed `_closure1_slot20`) | 0 | `SCREEN_WIDTH` | `_closure2_slot9` (= `_closure1_slot23()`) | :4591443 (moveCamera), :4591393 |
| 5 | **Service carousel** (#169280 `useGodot` :7713471) | **custom computed** (`getServiceCarouselCameraPosition`, not an enum) | `Specifications.statusBarOffset + _closure2_slot0` | 0 | `SCREEN_WIDTH` | `SCREEN_HEIGHT × 0.25` **or** `× 0.3` (state-dependent) | :7713496 (moveCamera), :7713471 |

### Frame notes
- **Home**: `moveCamera {position:slot65, carType:slot13, animated:cameraInitialized}` + `mobile_app_state={is_loading:false, show_terrain:slot2}`. Frame `slot67`: `updateMainViewFrame(statusBarHeight+60 [+LOOTBOX], 0, SCREEN_WIDTH, 355)`. `GODOT_VIEW_SIZE=355` (iOS :4068110). This IS the Home AND "Controls-at-rest" band — **there is no separate Controls camera at the Home route**; the R5-noted correction: the *Controls screen* (#98623, a distinct route) DOES override to TOP_DOWN (row 2).
- **Controls** (row 2): `moveCameraWithCompletion({position:TOP_DOWN, carType})` + `mobile_app_state={is_loading:false, show_terrain:false}`. Height formula from R7 prior round: `slot7=getSelectedVehicleIsCybertruck`, `slot8=(Platform.OS==='android')`; `top_margin = (slot7&&slot8)? -60 : 0`; `height = SCREEN_HEIGHT − (slot7 ? (slot8?20:45) : slot26)`, `slot26 = r4·Gutter(10)`, **r4 UNRESOLVED** (module fn #98593). Constants slot27=20, slot28=45, slot29=−60 (iOS :4040986-91).
- **Climate**: `moveCameraWithCompletion({position:CLIMATE, carType})`. `top_margin=statusBarOffset`; `height = SCREEN_HEIGHT − statusBarOffset − 320 + 80` (240 net; 320/80 inline literals).
- **Energy**: `moveCamera {position:ENERGY, animated:false}` + `setScreenOverlayColor(slot18, opacity)`. Two frame branches (:4591393 immediate when `showingVehicleProduct` false; :4591417 deferred `pendingEnergySetup`), both `updateMainViewFrame(slot26, 0, SCREEN_WIDTH, slot9, false)`. slot26/slot9 are runtime state/module values — **exact literals UNRESOLVED**.
  - **Energy LLM-status bottom sheet** (#114027 :4796070 / #114028 :4796178): raw `sendMessage(ReactMsgType.MOVE_CAMERA, {cam_fov:8|10, animated:true, duration:2})` — a **partial FOV-only zoom** (no rotation/offset), NOT a pose swap. Sheet OPEN→`cam_fov:8`; sheet CLOSE→`cam_fov:10`. Same ENERGY view, just dollies FOV.
- **Service carousel**: `useGodot` hook. `moveCamera(slot1 /*custom settings*/, animated:true, cameraInitialized)`; camera from `getServiceCarouselCameraPosition` (rotation `[82.5, (−150/n·idx interp) −120, 0]`, envRotation `[0, −40|−100, 83]`, offset y×1.1) + `getServiceCameraSettingsByCarType`. Frame height `SCREEN_HEIGHT×0.25` (short) or `×0.3` (:7713439/:7713449). Also `forceCloseAllClosures/fadeRoof/showFXAbove(false)`. **Service is the only viewport-dependent FOV** (R5 §3c: `ScaledSmallVehicleCamFov = interpolate(SCREEN_HEIGHT,[568,926],[80,70],CLAMP)`).

---

## Home state machine → CameraPosition (#110988 :4562105-4562203)
Default **PARKED**; evaluated overrides (last-write wins in this order):
1. Tonneau/closures `!== STATIONARY` → **CLOSURE_OPEN** (:4562130)
2. charging flag `r72` → **CHARGING** (:4562137)
3. tent flag `r73` → **TENT_MODE** (:4562144)
4. `ShiftState.R` → **DRIVE_REVERSE** (:4562174)
5. `ShiftState.D` → **DRIVE** (:4562167)
6. charging flag `r28/r61` → **CHARGING** (:4562184)
7. summon/active flag `r19/r21` → **VEHICLE_TO_HOME** (:4562194) — *R5 maps this to Summon-active; enum NAME is VEHICLE_TO_HOME; trigger var identity INFERRED, not fully resolved*
8. else → **PARKED** (:4562201)

`if(r17)` shortcut at :4562107→:4562289 forces PARKED when a prior flag set. Resulting `slot65` is the `position` sent by all three moveCamera calls in this fn (:4562326, :4562393, :4562423) and by #111050 (:4559148 via slot6).

---

## Full pose table (base Model 3/Y; iOS :1169441; VERBATIM, cross-checked vs R5 §3b — MATCHES)
`SET_ENV_PARAMS` carries envRotation→rotation, envEnergy→env_energy, ambEnergy→amb_energy, rotateSkyBox→rotate_sky_box.

| Pose | rotation° [x,y,z] | offset [x,y,z] | cam_fov | envRotation | envEnergy | ambEnergy | rotateSkyBox |
|---|---|---|---|---|---|---|---|
| **PARKED** | [68.6, −138, 0] | [−0.06, 6.7, 0] | 40 | [0, −11, 83] | 6 | 2.6 | false |
| **TOP_DOWN** | [0, 0, 0] | [0, 10, 0] | 40 | [0, −3, 87] | 4.5 | 4 | false |
| **CLIMATE** | [0, 0, 0] | [0, 6, 0.6] | 40 | [0, 40, 0] | 4 | 4 | false |
| **CHARGING** | [74, −38, 0] | [0, 6.55, 0] | 40 | [−20, 53, 30] | 5 | 4 | false |
| **DRIVE** | [68.6, −138, 0] | [−0.06, 8, 0] | 40 | [0, −11, 83] | 6 | 2.6 | false |
| **DRIVE_REVERSE** | [74, −38, 0] | [0, 8, 0] | 40 | [−9, −7, 75] | 5 | 3 | false |
| **ENERGY** | [69, 0, 0] | [0, 12, −0.5] | 10 | [0, −45, 0] | 8 | 4 | false |
| **CLOSURE_OPEN** | [62.654, −139.64, 0] | [−0.086, 4.7, 0] | 58 | [0, 45, 0] | 14 | 2 | **true** |
| **TENT_MODE** | [80, −17, 0] | [0.2, 4.5, −0.2] | 56 | [0, 45, 0] | 14 | 2 | **true** |
| **VEHICLE_TO_HOME** | [74, 38.5, 0] | [−0.4, 15.5, 0] | 20 | [−40, 80, −20] | 14 | 2 | false |

- **Cybertruck** overrides (Object.assign onto base, iOS :1169665): PARKED `{rotation:[80,−138,−0.15], offset:[−0.14,3,0], envRotation:[0,45,0], envEnergy:14, ambEnergy:2, cam_fov:80, rotateSkyBox:true}`; CHARGING `{offset:[0.1,6.55,−0.05], envRotation:[8,60,0], envEnergy:14, ambEnergy:2}`; DRIVE `{envRotation:[0,45,−0.05], envEnergy:14, ambEnergy:2}`; DRIVE_REVERSE `{offset:[0.1,6.55,−0.05], envRotation:[8,60,0], envEnergy:14, ambEnergy:2}`; TOP_DOWN `{offset:[0,12,0.22], envRotation:[−67,67,−67], envEnergy:16, ambEnergy:3}`; CLIMATE `{offset:[0,5.5,−0.2], envRotation:[−40,0,0], envEnergy:14, ambEnergy:2}`. `CYBERTRUCK_PARKED_WHEEL_TURN_DEG=−22`.
- **Semi** (CARTYPESEMITRUCK, iOS :1169598): PARKED `{offset:[−0.06,7.5,−0.1], envRotation:[0,−7,83]}`; DRIVE `{offset:[−0.06,7.5,−0.1], envRotation:[0,−7,83]}`; CLIMATE `{offset:[0,7,−0.5], envRotation:[0,90,70], envEnergy:6, ambEnergy:3.7}`; CHARGING `{rotation:[78,−55,0], offset:[0,7,−0.1], envRotation:[−20,53,30], envEnergy:5, ambEnergy:3.4}`; TOP_DOWN `{offset:[0,11,0.3], envRotation:[0,90,70], envEnergy:6, ambEnergy:3.7}`. (Semi env/amb reuse module registers — a couple PLAUSIBLE not literal.)

---

## Screens that do NOT host the Godot renderer (no moveCamera/updateMainViewFrame consumer)
- **Location / Map** — uses **react-native-maps** `setCamera`/`animateCamera` (iOS :1805130, :1806361), a real map tile view. NOT the vehicle renderer.
- **Summon** — no dedicated renderer screen. Summon/active-drive is rendered **inside Home #110988** via the state machine (DRIVE / DRIVE_REVERSE / VEHICLE_TO_HOME poses), not a separate route.
- **Security & Drivers**, **Set Schedules (charge/climate schedules)**, **Service detail** (non-carousel), **Charging session detail** — no `moveCamera`/`updateMainViewFrame`; the persistent GodotView is simply covered/not re-framed. (Charging pose CHARGING is reached only via the Home state machine, not a Charging route.)

---

## UNRESOLVED / to verify
- Controls `height` divisor `r4` (`slot26 = r4·Gutter(10)`), module fn #98593 — carried from prior round.
- Energy frame `top_margin` (`slot26` useState seed `_closure1_slot20`) and `height` (`slot9 = _closure1_slot23()`) — exact literals not resolved (runtime state).
- Service carousel: which condition picks `×0.25` vs `×0.3` height, and `_closure2_slot0` top offset.
- VEHICLE_TO_HOME trigger var identity (Summon-active per R5, INFERRED).
- Semi CLIMATE/TOP_DOWN envEnergy/ambEnergy from reused registers (PLAUSIBLE 6/3.7).
