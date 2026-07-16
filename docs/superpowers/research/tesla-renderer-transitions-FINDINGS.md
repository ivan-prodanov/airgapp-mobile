# Tesla renderer transitions — per-screen frame constants (Controls + Climate), all renderer screens, and R5 corrections (Round 7)

**Source of truth:** iOS `main.decompiled.js` (Tesla iOS **v4.56**, readable decompiled JS) — the app we ship. Android `bundle.hasm` (v4.58 Hermes) used for cross-checks. Godot scene/handlers from R6 (`tesla-renderer-frame-appendix/`). All line numbers below are **iOS bundle lines** unless tagged.

**Method:** literals dumped verbatim, register-decoded, constants resolved. Every load-bearing number was **independently re-derived by a second agent** (adversarial verify pass). Tags: `[iOS-verified]`, `[both-match]` (iOS≈Android), `[differ]` (platform branch), `[Android-only]`.

**Bottom line for the two blockers:**
- **Controls is NOT full-screen.** Normal iOS car: `top_margin = 0`, `height = SCREEN_HEIGHT − 20`. You shipped full-screen (scale 1.0); the real scale is **0.977**, so your car is ~2.4% too big. Pose is **TOP_DOWN** (corrects R5 §3b's PARKED).
- **Climate:** `top = statusBarOffset(=59)`, `height = SCREEN_HEIGHT − statusBarOffset − 240 = 553`. All three inputs confirmed. The one you likely have wrong is **`SCREEN_HEIGHT`**, which is `Dimensions.get('window').height` = **852 (full window)**, not a safe-area height.

---

## ⚠️ Corrections to earlier rounds (fix these so nobody trusts them again)

1. **R5 §3b "Controls → PARKED" is WRONG.** The Controls *screen* (a distinct route, module fn #98623/#98626) unconditionally sends **`CameraPosition.TOP_DOWN`**. There is no per-vehicle-state camera machine on Controls (unlike Home). `[iOS-verified]` — fn #98626 case 112, iOS 4039675.
2. **R5 "VEHICLE_TO_HOME → Summon-active" is WRONG.** The `VEHICLE_TO_HOME` pose is triggered by **`isVehiclePowersharingToHome || isVehiclePowersharingToGrid`** — i.e. **Powershare (V2H/V2G power export)**, not Summon or active-drive. Summon/driving is covered by the **DRIVE / DRIVE_REVERSE** poses via the Home state machine. `[iOS-verified]` — Home state machine #110988.
3. **R6/R7 note:** the base-table pose offsets (`TOP_DOWN [0,10,0]`, `CLIMATE [0,6,0.6]`) are the **Model 3/Y (default)** values and are correct for the car you ship. Do **not** adopt `[0,11,0.3]`/`[0,7,-0.5]` — those are the **Semi** map; Cybertruck is `[0,12,0.22]`/`[0,5.5,-0.2]` (§3).

---

## §1. Controls — the exact frame `[RESOLVED]`

**Module:** fn #98593 (init) → two useEffects: **fn #98623** (frame) and **fn #98626** (camera + product). `[iOS-verified]`

### 1a. Frame (`UPDATE_MAIN_VIEW_FRAME`)

`updateMainViewFrame(top_margin, left, width, height, config)` — signature confirmed from both Controls (iOS 4039596) and Climate (iOS 5222051) call sites.

Frame math (fn #98623, iOS 4039534-4039561), where `slot7 = getSelectedVehicleIsCybertruck`, `slot8 = (Platform.OS === 'android')`:

```
top_margin = (slot7 && slot8) ? slot29(-60) : 0
subtrahend = slot7 ? (slot8 ? slot27(20) : slot28(45)) : slot26(20)
height     = SCREEN_HEIGHT - subtrahend
left = 0 ;  width = SCREEN_WIDTH
```

**Constants** (fn #98593 case 707, iOS 4040975-4040991, verbatim):

| name | value | how resolved |
|---|---|---|
| `slot24` | 55 | literal |
| `slot25` | 30 | literal |
| **`slot26`** | **20** | `r4 · Gutter`; **`r4 = 2`** (top-level register, iOS 4037169, no rewrite before case 707) × **`Gutter = 10`** (iOS 1338474) |
| `slot27` | 20 | literal |
| `slot28` | 45 | literal |
| `slot29` | −60 | literal |
| `slot30` | 55 | literal (`0.4·SCREEN_HEIGHT` companion const, unused by frame) |

So the `sheetHeight` R5 §5 left UNRESOLVED **= `slot26 = 20`** (a static literal, NOT a draggable sheet). And the `top_margin` R5 called "0 (or a state const)" **= 0** for every case except Cybertruck-on-Android (−60).

**Resulting frame per vehicle/platform** `[differ]`:

| vehicle / platform | slot7 | slot8 | top_margin | height |
|---|---|---|---|---|
| **Normal, iOS (WE SHIP)** | false | false | **0** | **SCREEN_HEIGHT − 20** |
| Cybertruck, iOS | true | false | 0 | SCREEN_HEIGHT − 45 |
| Cybertruck, Android | true | true | −60 | SCREEN_HEIGHT − 20 |
| Normal, Android | false | true | 0 | SCREEN_HEIGHT − 20 |

**⇒ The frame you must ship (normal iOS): `{ top_margin: 0, left: 0, width: SCREEN_WIDTH, height: SCREEN_HEIGHT − 20 }`.**
On a 393×852 phone: `height = 832`, `root_node.scale = 832/852 = 0.9765`. **This is why your full-screen (scale 1.0) car is ~2.4% too big.**

### 1b. Camera (`MOVE_CAMERA`)

fn #98626 (iOS 4039640): `moveCameraWithCompletion({ position: CameraPosition.TOP_DOWN, carType: <selected>, completion: <marker loop> })` — **unconditional** (case 112 always runs). Preceded (only when product id ≠ null, case 26) by `updateProduct({ id, type: ProductType.VEHICLE, mobile_app_state: { is_loading: false, show_terrain: false } })`.

**No state override.** grep of the whole Controls module (4037008–4041000) for `moveCameraWithCompletion`/`CameraPosition` returns exactly one move, always TOP_DOWN. The tonneau/tent/charging buttons on Controls move vehicle-marker overlays, **not** the camera. `[iOS-verified]`

Resolved **TOP_DOWN** pose for a Model 3/Y (see §3 pose table): `rotation [0,0,0]`, `offset [0,10,0]`, `cam_fov 40`, `envRotation [0,-3,87]`, `envEnergy 4.5`, `ambEnergy 4`, `rotateSkyBox false`.

---

## §2. Climate — which of the three inputs is wrong `[RESOLVED]`

**Module:** fn #120832 (frame), fn #120884 (camera). `[iOS-verified]`

### 2a. Frame (`UPDATE_MAIN_VIEW_FRAME`)

Frame math (fn #120832, iOS 5222006-5222048, verbatim):
```
top_margin = Specifications.statusBarOffset
height     = SCREEN_HEIGHT − statusBarOffset − 320 + 80     // literals 320 (iOS 5222040), 80 (iOS 5222043)
left = 0 ;  width = SCREEN_WIDTH
```
**⇒ `{ top_margin: statusBarOffset, left: 0, width: SCREEN_WIDTH, height: SCREEN_HEIGHT − statusBarOffset − 240 }`.**

### 2b. The three inputs, defined and resolved

1. **`statusBarOffset`** `[differ]` — fn #32533, iOS 1338583. On iOS it **is** `statusBarHeight()` (Android = 0). `statusBarHeight` (iOS ~1338500, verbatim device branches): identifiers `iPhone13,1 / iPhone13 / iPhone14,4 / iPhone14,6 / iPhone14 / iPhone15 / iPhone16 / iPhone17 / iPhone18 → 59`; other notch → 47; non-notch → 50. **A 393×852 Dynamic-Island phone carries an `iPhone15,x`/`iPhone16,x`/`iPhone17,x` identifier → `statusBarOffset = 59`.** So it is the **same** value as `statusBarHeight`, and equal to the `insets.top` (59) you already pass. **This is not your error.**

2. **`240`** — **not a named constant, and not a sheet height.** It is two inline literals `− 320 + 80` (a fixed net inset). Copy the literal `240`; there is no "their sheet height vs ours" nuance to worry about. `[iOS-verified]`

3. **`SCREEN_HEIGHT`** `[differ]` — fn #32420, iOS 1333955. iOS branch: **`SCREEN_HEIGHT = Dimensions.get('window').height`** — the **full window height (852** on a 393×852 phone**), NOT** the safe-area height, NOT `Dimensions.get('screen')`, NOT window-minus-home-indicator. (Android branch = `getScreenHeight() − getBottomInset()`.) **This is the prime suspect for your bug.**

### 2c. Full Climate rect + camera on a 393×852/59 phone
```
top_margin = 59
left = 0 , width = 393
height = 852 − 59 − 240 = 553
root_node.scale = 553 / 852 = 0.6491
```
Camera (fn #120884, iOS 5226343): `moveCameraWithCompletion({ position: CameraPosition.CLIMATE, carType, completion })`, same `updateProduct` pre-step as Controls. Resolved **CLIMATE** pose (Model 3/Y): `rotation [0,0,0]`, `offset [0,6,0.6]`, `cam_fov 40`, `envRotation [0,40,0]`, `envEnergy 4`, `ambEnergy 4`, `rotateSkyBox false`. **Note `envRotation [0,40,0]`** — the skybox/environment is yawed 40° (via `SET_ENV_PARAMS`), which the camera pose alone doesn't capture; match it if your reflections look off.

### 2d. Reconciling "we see MORE HOOD — car too high & too small"

With the R6 handler, `scale = height/SCREEN_HEIGHT` and `center_y = top_margin + SCREEN_HEIGHT/2·scale` (which reduces to `top_margin + height/2`). All three symptoms — smaller, higher, more hood — share **one** root cause: **your Climate frame `height` is smaller than 553.** Smaller height → smaller scale (car shrinks) → smaller `center_y` (car rises) → with the CLIMATE camera's `KEEP_HEIGHT` vertical FOV, a higher/smaller car reveals more of the hood.

Ranked causes (statusBarOffset is ruled out — 47/50 instead of 59 gives a *larger* height, the opposite direction):
1. **`SCREEN_HEIGHT` fed as safe-area / `Dimensions.get('screen')` minus insets instead of `Dimensions.get('window').height` (852).** E.g. a ~759 safe-area height → `759 − 59 − 240 = 460` → scale 0.54, center 289 → visibly smaller/higher/more-hood. **Prime suspect.**
2. Double-subtracting a bottom home-indicator inset (~34pt) somewhere in the height chain → height ≈ 519, same direction.

**Fix:** compute Climate height as `Dimensions.get('window').height (852) − statusBarOffset (59) − 240 = 553`, with `SCREEN_HEIGHT` = the **raw full window height**. Do not subtract any safe-area / bottom inset.

---

## §3. Every renderer-hosting screen `[RESOLVED]`

grep of all `moveCamera` / `moveCameraWithCompletion` / `setCamera` / `updateMainViewFrame` consumers → **exactly 5 screens host the Godot vehicle renderer.** The GodotView is a single persistent full-screen host; screens don't remount it — they re-issue `MOVE_CAMERA` (+ paired `SET_ENV_PARAMS`) and `UPDATE_MAIN_VIEW_FRAME`. `CameraPosition` enum (iOS 1169364): `{PARKED, TOP_DOWN, CLIMATE, CHARGING, DRIVE, DRIVE_REVERSE, TENT_MODE, CLOSURE_OPEN, VEHICLE_TO_HOME, ENERGY}`.

### 3a. Per-screen frame + pose

| # | Screen (fn) | CameraPosition | top_margin | width | height | cite |
|---|---|---|---|---|---|---|
| 1 | **Home / product view** (#110988, #111050) | **state machine** (default PARKED) | `statusBarHeight + 60` (`+ LOOTBOX_TOP_BANNER_HEIGHT` if lootbox) | SCREEN_WIDTH | `GODOT_VIEW_SIZE = 355` | 4562236, 4559031 |
| 2 | **Controls** (#98623/#98626) | **TOP_DOWN** (fixed) | `(isCT&&android) ? −60 : 0` | SCREEN_WIDTH | `SCREEN_HEIGHT − (isCT ? (android?20:45) : 20)` | 4039677, 4039534 |
| 3 | **Climate** (#120832/#120884) | **CLIMATE** (fixed) | `statusBarOffset` | SCREEN_WIDTH | `SCREEN_HEIGHT − statusBarOffset − 240` | 5226346, 5222006 |
| 4 | **Energy / Powershare** (#111594) | **ENERGY** (fixed) | `statusBarOffset + 80` (`NATURAL_ENERGY_LIST_HEADER_HEIGHT`) | SCREEN_WIDTH | `useDeviceDimensions().width + 96·max(fontScale−1,0)` (= device **WIDTH** at default font) | 4591443, 4591393 |
| 5 | **Service carousel** (#169280 `useGodot`) | **custom** (`getServiceCarouselCameraPosition`, not an enum preset) | `statusBarOffset + <slot0>` | SCREEN_WIDTH | `SCREEN_HEIGHT × 0.25` (normal) / `× 0.3` (short screen) | 7713496, 7713471 |

Frame notes:
- **Energy** (#111594): `moveCamera({position:ENERGY, animated:false})` + `setScreenOverlayColor(...)`. Frame applied immediately (`showingVehicleProduct` false) or deferred (`pendingEnergySetup`) — **same frame values, only timing differs**. At default font scale the height = device **width** (≈393 on the ref phone), so the Energy render region is ~square.
  - **Energy LLM-status bottom sheet** (#114027/#114028): raw `sendMessage(MOVE_CAMERA, {cam_fov: 8|10, animated:true, duration:2})` — a **partial FOV-only dolly** (no rotation/offset), sheet-open → `cam_fov 8`, sheet-close → `cam_fov 10`. Same ENERGY view, longer 2s tween.
- **Service carousel**: height selector is `useWindowDimensions().height < SmallScreenHeight → ×0.3 (short)`, else **`×0.25`** (normal — the target 852-pt phone gets ×0.25 → 213pt). Uses `getServiceCarouselCameraPosition` (rotation `[82.5, interp(idx), 0]`, envRotation `[0,-40|-100,83]`) + `getServiceCameraSettingsByCarType`. **Service is the only screen with a viewport-dependent FOV** (R5 §3c: `ScaledSmallVehicleCamFov = interpolate(SCREEN_HEIGHT,[568,926],[80,70],CLAMP)`).

### 3b. Home state machine → CameraPosition (#110988, iOS 4562105-4562203)

Default **PARKED**; overrides evaluated in order (last match wins):
1. tonneau/closures `!== STATIONARY` → **CLOSURE_OPEN**
2. charging → **CHARGING**
3. tent flag → **TENT_MODE**
4. `ShiftState.R` → **DRIVE_REVERSE**
5. `ShiftState.D` → **DRIVE**
6. charging (secondary) → **CHARGING**
7. `isVehiclePowersharingToHome || isVehiclePowersharingToGrid` → **VEHICLE_TO_HOME** *(Powershare V2H/V2G — corrects R5's "Summon" mapping)*
8. else → **PARKED**

The resulting position is what Home's `moveCamera` calls (iOS 4562326/4562393/4562423, and #111050 at 4559148) send. **Summon / active drive is rendered here inside Home** via DRIVE/DRIVE_REVERSE — there is no separate Summon renderer route.

### 3c. Full pose table (Model 3/Y base; iOS 1169441; verbatim, cross-checked vs R5 §3b — MATCHES) `[both-match]`

`SET_ENV_PARAMS` maps `envRotation→rotation`, `envEnergy→env_energy`, `ambEnergy→amb_energy`, `rotateSkyBox→rotate_sky_box`.

| Pose | rotation° [x,y,z] | offset [x,y,z] | cam_fov | envRotation | envEnergy | ambEnergy | sky |
|---|---|---|---|---|---|---|---|
| **PARKED** | [68.6, −138, 0] | [−0.06, 6.7, 0] | 40 | [0, −11, 83] | 6 | 2.6 | false |
| **TOP_DOWN** | [0, 0, 0] | **[0, 10, 0]** | 40 | [0, −3, 87] | 4.5 | 4 | false |
| **CLIMATE** | [0, 0, 0] | **[0, 6, 0.6]** | 40 | [0, 40, 0] | 4 | 4 | false |
| **CHARGING** | [74, −38, 0] | [0, 6.55, 0] | 40 | [−20, 53, 30] | 5 | 4 | false |
| **DRIVE** | [68.6, −138, 0] | [−0.06, 8, 0] | 40 | [0, −11, 83] | 6 | 2.6 | false |
| **DRIVE_REVERSE** | [74, −38, 0] | [0, 8, 0] | 40 | [−9, −7, 75] | 5 | 3 | false |
| **ENERGY** | [69, 0, 0] | [0, 12, −0.5] | 10 | [0, −45, 0] | 8 | 4 | false |
| **CLOSURE_OPEN** | [62.654, −139.64, 0] | [−0.086, 4.7, 0] | 58 | [0, 45, 0] | 14 | 2 | **true** |
| **TENT_MODE** | [80, −17, 0] | [0.2, 4.5, −0.2] | 56 | [0, 45, 0] | 14 | 2 | **true** |
| **VEHICLE_TO_HOME** | [74, 38.5, 0] | [−0.4, 15.5, 0] | 20 | [−40, 80, −20] | 14 | 2 | false |

**Per-carType offset overrides** (`Object.assign` onto base, keyed by `CarType`; iOS 1169595-1169740) `[iOS-verified]`:
- **Model 3/Y (default, WE SHIP):** uses the base table above — `TOP_DOWN offset [0,10,0]`, `CLIMATE offset [0,6,0.6]`. No override. *(Confirmed by the explicit `CARTYPESEMITRUCK`/`CARTYPECYBERTRUCK` keying — a normal car takes no offset override — and by the brief's own on-device observation that `[0,6,0.6]` is byte-identical to the official app.)*
- **CARTYPESEMITRUCK** (iOS 1169598+): `TOP_DOWN [0,11,0.3]`, `CLIMATE [0,7,−0.5]`, `PARKED/DRIVE [−0.06,7.5,−0.1]`, `CHARGING rot[78,−55,0] off[0,7,−0.1]`; env `[0,90,70]`, envEnergy 6, ambEnergy 3.7.
- **CARTYPECYBERTRUCK** (iOS 1169666+): `PARKED {rot[80,−138,−0.15], off[−0.14,3,0], env[0,45,0], envEnergy 14, ambEnergy 2, cam_fov 80, sky true}`, `TOP_DOWN [0,12,0.22]` (env[−67,67,−67], envEnergy 16), `CLIMATE [0,5.5,−0.2]` (env[−40,0,0], envEnergy 14), `CHARGING/DRIVE_REVERSE off[0.1,6.55,−0.05]`. `CYBERTRUCK_PARKED_WHEEL_TURN_DEG = −22`.

### 3d. Screens that do NOT host the vehicle renderer
- **Location / Map** — `react-native-maps` `setCamera`/`animateCamera` (iOS 1805130/1806361), a real tile map, not the Godot vehicle view.
- **Summon** — no dedicated route; rendered inside Home (DRIVE/DRIVE_REVERSE/VEHICLE_TO_HOME).
- **Security & Drivers, Set Schedules, Service detail (non-carousel), Charging session detail** — no `moveCamera`/`updateMainViewFrame`; the persistent GodotView is simply covered. (The CHARGING pose is reached only via the Home state machine, not a Charging route.)

---

## §4. Calibration — scale + on-screen centre (393×852-pt, statusBarHeight = 59)

R6 handler (exact): `root_node.scale = height/SCREEN_HEIGHT`; `center_y = top_margin + SCREEN_HEIGHT/2·scale = top_margin + height/2`; `center_x = left + width/2`. Car net world scale = `root_node.scale × vehicle_scale` (default **1.1**).

| Screen | top_margin | height | `root_node.scale` | center_y (pt) | center_x (pt) | car net (×1.1) |
|---|---|---|---|---|---|---|
| **Home** (PARKED) | 119 | 355 | **0.4167** | 296.5 | 196.5 | 0.458 |
| **Controls** (TOP_DOWN) | 0 | 832 | **0.9765** | 416.0 | 196.5 | 1.074 |
| **Climate** (CLIMATE) | 59 | 553 | **0.6491** | 335.5 | 196.5 | 0.714 |
| **Energy** (ENERGY) | 139 | 393* | **0.4613** | 335.5 | 196.5 | 0.507 |
| **Service** (custom) | 59 + slot0† | 213 | **0.2500** | 106.5 + (59+slot0) | 196.5 | 0.275 |

\* Energy height = device **width** at default font scale (393 on the ref phone). † Service `slot0` top offset unresolved (see Gaps); everything else exact.

**These are exact targets.** If a screen's car still mismatches after matching `scale` + `center_y` + the pose, the residual is the `height/screen_height` **units** (R6 §2): ensure your Godot `get_viewport().size.y` and the RN-sent `height` are in the **same** units (both device pixels), and the ratio is dimensionless.

---

## §5. Sanity checks (all three CONFIRMED by adversarial re-derivation)

**1. Viewport / 3D-camera aspect = SCREEN aspect, not 790×875.** `[both-match]`
`MainViewContainer` (ViewportContainer, `stretch = true`) forces the child `Viewport.size` to equal its on-screen rect = full device screen. The `size = Vector2(790,875)` + `size_override_stretch = true` is a **2D-canvas coordinate override only** (`set_size_override`); a 3D `Camera` computes aspect from the viewport's real pixel size → **screen aspect (~0.461 w/h)**. `keep_aspect` unset → Godot-3 default **`KEEP_HEIGHT`** → `cam_fov 40` is the **vertical** FOV. **Do not feed 790/875 as aspect and do not set `KEEP_WIDTH`** (that reinterprets fov 40 as horizontal → the ~45% shrink bug from R5).

**2. `animation_id` — keep a fresh `uuid.v4()` per `MOVE_CAMERA`; do NOT use a stable per-preset id.** `[iOS-verified]`
`moveCamera` mints `animation_id = uuid.v4()` per call and returns it. `moveCameraWithCompletion` registers a `MOVE_CAMERA_RESPONSE` listener that fires its completion only when `resp.animation_id === storedId`. Godot (`CameraManager`) emits `MOVE_CAMERA_RESPONSE {animation_id}` on `tween_all_completed`. The RN dispatcher invokes **all** registered listeners for the type, each self-filtering by id, then clears the whole listener array.
- Godot keeps a **single** shared tween + single `current_animation_id`; on rapid navigation the in-flight tween is replaced and only the **last** id's completion is emitted — this is inherent to the single-tween design and **independent of whether ids are stable or fresh**. The id never gates `tween.start()`; it's purely a completion-correlation token — so a **stable id does not merge or suppress tweens**.
- The real hazard of a stable id is **RN-side**: if the same preset is requested twice before a response (double-effect / A→A / remount), two listeners share the id and the single response matches **both** → the completion callback **double-fires**. A fresh uuid makes each response match exactly one listener (exactly-once). **Recommendation: fresh `uuid.v4()` per call (matches Tesla).**

**3. Camera + env + frame animate SIMULTANEOUSLY, same tick, identical timing = 0.5s / TRANS_QUART / EASE_OUT / animated.** `[iOS-verified]`
On navigate, the RN effect calls `moveCamera(...)` then `updateMainViewFrame(...)` back-to-back synchronously; inside `moveCamera` (when `updateEnvironment` default-true) it emits **MOVE_CAMERA then SET_ENV_PARAMS** in the same body with the **same** timing. All three GodotMsgs go out in one JS tick.
- Module defaults (iOS 1174108): `defaultCameraAnimationDuration = 0.5`, `…Transition = QUART`, `…Ease = OUT`. Home/Controls/Climate pass only geometry/pose → these defaults apply to all three messages (`animated: true`).
- **Godot's own defaults are dead on these paths:** RN always injects explicit `duration 0.5` (so Godot's `data.get('duration', 0.75)` never fires) and explicit `EASE_OUT` (overrides Godot's `EASE_IN_OUT`); `TRANS_QUART` already matches. **Net: every standard transition runs 0.5s / QUART / OUT.** No per-transition overrides for Home/Controls/Climate. (`setScreenOverlayColor` is a separate message — duration 0.5, **LINEAR**, OUT — unrelated to the camera/env/frame trio. The Energy LLM sheet is the one exception: FOV-only, `duration 2`.)

---

## §6. Gaps (stated plainly)

- **Service carousel `slot0`** (the extra top offset added to `statusBarOffset`) not resolved to a literal — needs the `useGodot` closure trace. Everything else on Service (height `SCREEN_HEIGHT×0.25` normal, the custom rotation formula) is resolved.
- **Energy frame is device/font-dependent** (`top = statusBarOffset + 80`; `height = deviceWidth + 96·max(fontScale−1,0)`), so there is no single integer literal — but the formula is exact. At default font on the ref phone: top 139, height 393.
- **Semi CLIMATE/TOP_DOWN `envEnergy`/`ambEnergy`** (≈6 / 3.7) read from reused registers — PLAUSIBLE, not byte-literal. Irrelevant to Model 3/Y.
- All Model 3/Y values you actually ship (Controls, Climate, Home, the pose table) are **literal-confirmed and independently verified** — no calibration fallback needed for those.

---

## §7. Citations (iOS bundle lines, v4.56)

- Controls: fn #98593 init 4037008; `r4=2` 4037169; `Gutter=10` 1338474; slot26/27/28/29 4040975-4040991; frame fn #98623 4039534; camera fn #98626 4039675.
- Climate: frame fn #120832 5222006 (literals 320@5222040, 80@5222043); camera fn #120884 5226343.
- `SCREEN_HEIGHT` fn #32420 1333955; `statusBarOffset` fn #32533 1338583; `statusBarHeight` ~1338500.
- Pose table 1169364 (enum) / 1169441 (base) / 1169595-1169740 (carType overrides).
- Screens: Home #110988 4562105; Energy #111594 4591393; Service #169280 7713471; maps 1805130.
- Godot handler/scene: R6 `tesla-renderer-frame-appendix/` (`MainViewContainer.on_update_main_view_frame`, `mobile.tscn`, `CameraManager.decompiled.gd`).
