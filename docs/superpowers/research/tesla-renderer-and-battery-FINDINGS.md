# Tesla 3D renderer (camera / viewport / shadows) + battery % text/units (Round 5)

**Deliverable for Round 5.** Dual-platform, verbatim. **We ship iOS.** Every fact tagged `[iOS-verified]` / `[Android-only]` / `[both-match]` / `[differ]`.

**Sources:** iOS (PRIMARY, readable JS) `/Users/ivan/Downloads/tesla-haptics-work/main.decompiled.js` (Tesla iOS **v4.56**); Android `/Users/ivan/Work/tesla-summon/work/bundle.hasm` (**v4.58**); Godot project `split_assets_pack.apk!assets/godot/` (compiled `.gdc`/`.scn`/`.stex` + `.material` binaries + `.tres` text). Extracted assets in `tesla-status-assets/godot/` (materials, `ap_scene_env.tres`, and decoded PNGs: `Ground_AO_mobile.decoded.png` = the shadow blob, `New_Studio.decoded.png` = the environment HDRI).

**Method:** produced by a 5-section dual-platform workflow + adversarial verifiers; the battery-% and camera facts were additionally hand-verified by me. (Two readers hit a transient API disconnect and were re-run.)

---

## §1. Battery % text — both on-device contradictions settled

### 1a. Spacing — the % `marginHorizontal` is **5**, not 10 `[both-match]` — CORRECTS R4
There are **two** `batteryText` StyleSheet entries in two module scopes:
- **Header module** (contains `ChargeStatus` #117220, which renders the % `<Text>`): `batteryText = {fontSize:16, fontWeight:'bold', marginHorizontal: 0.5 × Gutter = 0.5 × 10 = 5}` (iOS :4570724; Android fn #117212 off 0x437 `LoadConstDouble 0.5; Mul`; `Gutter=10` iOS :1338474).
- **MiniBattery module** (`MiniBatteryStatus`): `batteryText = {…, marginHorizontal: Specifications.iconMargin = 10}` (iOS :4571849). `Specifications.iconMargin` genuinely = 10, **but this style is used by `MiniBatteryStatus`, never by `ChargeStatus`.**

Proof of which one the % text uses: the % `<Text>` style is `[_closure1_slot21.batteryText, {color}]` (iOS :4567872), and `_closure1_slot21` = the **header** `StyleSheet.create` result (assigned iOS :4570816). **⇒ the % text margin is 5.** R4 §1a quoted the wrong module (10). `row`/`batteryViewContainer` carry no negative/horizontal margin → **the real horizontal gap from the nub's right edge to the "7" of "75%" = 5.0 points.** **Ship 5.**

`Specifications` (verbatim, iOS :1338587): `{'edgePadding':20, 'pillContainerHeight':24, 'iconButtonBusyOpacity':0.5, 'statusBarHeight':<fn>, 'headerHeight':54, …, 'iconMargin':10, 'smallIconSize':20, 'mediumSmallIconSize':25, 'mediumIconSize':30, 'iconSize':30, 'largeIconSize':36 …}`.

### 1b. The FACE — the % renders in **Medium (500)**, `fontWeight:'bold'` is a **no-op** on iOS `[iOS-verified]` — this is why yours still mismatched
The % `<Text>` = TDS `<Text category='BodyLabel' appearance='Light'>` (iOS :4567820) with user style `[batteryText, {color}]`. Resolution:
- Category `BodyLabel` → `Typography['BodyLabel']` = `getFontStyle({type:'Medium', fontFamilyPrefix:'UniversalSansText-', fontSize:14, lineHeight:20, letterSpacing:0.1})` → **`{fontFamily:'UniversalSansText-Medium', fontSize:14, lineHeight:20, letterSpacing:0.1}` (no fontWeight)** (iOS :1339801/:1339633/:1339578).
- TDS Text merges native style as `[themedStyle, {}, userStyle]` (later wins, iOS :1430573). So `batteryText` overrides: **fontSize 16** (beats category 14), adds **fontWeight:'bold'**, keeps **fontFamily `'UniversalSansText-Medium'`**.
- **Final native style = `{fontFamily:'UniversalSansText-Medium', fontSize:16, fontWeight:'bold', lineHeight:20, letterSpacing:0.1, color:<state>, marginHorizontal:5}`.**
- **What iOS does with it:** the font name-table split (read from the shipped TTFs): Medium sits in its **own single-face legacy family** `Universal Sans Text Medium`; the real Bold cut is in a **different** family `Universal Sans Text` (shared with Regular). RN's `RCTFont` resolves the PostScript name `'UniversalSansText-Medium'` → family `Universal Sans Text Medium` → only one face → **`fontWeight:'bold'` cannot reach the Bold cut and iOS does not synthesize faux-bold.** So the % renders in **Universal Sans Text Medium (usWeightClass 500)**.

**⇒ The official % is Medium at 16px — the SAME face as the 14px status line, differing only in size.** If your build shipped a real `UniversalSansText-Bold` (700) in response to `fontWeight:'bold'`, your % is genuinely heavier than official — the mismatch you see. **Fix:** render the % with `fontFamily:'UniversalSansText-Medium'` and **drop `fontWeight`** (or replicate the foundry family split so `bold` stays a no-op). `fontSize` = **16** confirmed. `[INFERRED-strong]` on the exact RCTFont "nearest real face in-family, no faux-bold" rule (the TTF family split + the JS style are byte-verified; the native pick wasn't measured on-device).

---

## §2. %↔distance conversion + the switch `[both-match on the math; iOS-verified on the UI]`

### 2a. The range string — VERBATIM (iOS :1229437 / :1229357; Android #30506/#30507)
`getRemainingBatteryRangeDistanceWithUnit(chargeState, guiSettings)` = `getRemainingBatteryRangeDistance(...) + ' ' + getGUIDistanceUnit(guiSettings)`, or **`undefined`** if the range value is null.
- **Source field:** `chargeState.getBatteryRange()` = proto **`battery_range`** (rated/EPA, in **MILES**) by default; `getIdealBatteryRange()` = `ideal_battery_range` **only** when `guiSettings.getGuiRangeDisplay().getTypeCase() === RangeDisplay.IDEAL`. **`est_battery_range` is never read.** *(You currently derive from `chargeState.batteryRange` — matches the default field.)*
- **km conversion:** `value_miles × KM_PER_MILES` where **`KM_PER_MILES = 1.609344`** (exact, iOS :1292079), applied **only** when display units are km; the miles path applies no factor.
- **Rounding:** **`Math.round`** on the final number (nearest integer, **0 decimals**). No floor/ceil.
- **Separator:** a single **ASCII space `' '` (U+0020)** — *not* a non-breaking space.
- **Unit token:** **localized via `.tr()`** — i18n keys **`distance_unit_km_short_string`** / **`distance_unit_miles_short_string`** (not hardcoded 'km'/'mi').
- **km vs mi source:** the **vehicle** setting **`gui_distance_units`** (a `SpeedUnit` enum: `MILESPERHOUR`→miles, `KILOMETERSPERHOUR`→km), from `getSelectedGuiSettings`. **Not phone locale, not an app preference.**

### 2b. The toggle / switch (iOS ChargeStatus `_fun111136`)
- **Switch animation = INSTANT swap.** No crossfade, no width animation, no `LayoutAnimation`/`configureNext` anywhere in ChargeStatus. The only `Animated` in the component is the **data-staleness opacity dimmer** on the whole battery row (`Easing.cubic`, `toValue = isVehicleDataStale ? 0.5 : 1`, `duration = isVehicleDataStale ? 0 : 500 ms`, `useNativeDriver:true`) — unrelated to the format toggle. `[iOS-verified]`
- **Layout shift = YES.** The label is content-sized and left-aligned (`batteryText` has no `width`/`minWidth`/`textAlign`; `row` is `flexDirection:'row'`, default `justifyContent:'flex-start'`). Switching "80%"↔"240 km" resizes the text box and reflows siblings. The charging bolt is `chargingIndicator {position:'absolute', right:-4, top:-4}` so it doesn't reflow. `[iOS-verified]`
- **No-data fallback = BLANK, not %.** In **distance mode** with no range data, `batteryLevelDistanceWithUnit` is `undefined` → the Text child is `undefined` → renders **nothing**. (Percent mode with null percent → `''`.) **`[differ]`: your build falls back to %; Tesla shows blank in distance mode.**
- **Default mode = DERIVED, not hardcoded.** Local `useState(!getShowEnergy(guiSettings))`, where `getShowEnergy = (guiChargeRateUnits === ChargeRateUnit.KW)`. So: car charge-rate units **kW → % shown**; **distance (mi/hr) → distance shown**. Re-derived on every mount. **Persistence is vehicle-side** (the toggle sends `VehicleCommand.energyDisplayFormat` = `{FORMAT_PERCENTAGE:0, FORMAT_DISTANCE:1}`, gated on phone-key-paired + `carApiVersion ≥ MIN_SET_UNITS_AND_FORMATS_CAR_API_VERSION`); the local `useState` is only an optimistic in-session flip — **no local persistence** of the format. `[iOS-verified; command layer both-match]`

---

## §3. THE RENDERER (camera / viewport / shadows) — the biggest visual gap

### 3a. The renderer message bus `[both-match]`
Native host: **`TMGodotView`** (iOS) / **`GodotView`** (Android) — `requireNativeComponent`, rendered as `<GodotView/>`. RN drives it via `ReactMsgType` messages (iOS :1169326): `APP_CONFIG, SET_APP_THEME, SET_SCREEN_OVERLAY_COLOR, SHOW_PRODUCT, UPDATE_PRODUCT, UPDATE_MAIN_VIEW_FRAME, SET_ENV_PARAMS, MOVE_CAMERA, INPUT_EVENT, …`. The three that matter here:

**`MOVE_CAMERA`** (iOS :1173015) — the camera pose:
```
{ rotation:[x,y,z]°, offset:[x,y,z], cam_fov:<num>, animated, duration, transition_type, ease_type, animation_id }
```
No target/near/far/orbit/distance keys. Optional `fade_labels` on the energy-map view.

**`SET_ENV_PARAMS`** (iOS :1173041) — the environment/lighting, sent right after MOVE_CAMERA when `updateEnvironment`:
```
{ 'rotation'←envRotation, 'env_energy'←envEnergy, 'amb_energy'←ambEnergy, animated, duration, transition_type, ease_type, 'rotate_sky_box'←rotateSkyBox }
```

**`UPDATE_MAIN_VIEW_FRAME`** (iOS :1173290) — the on-screen rectangle the car composites into (all × render scale):
```
{ top_margin, left_margin, width, height, animated, duration, transition_type, ease_type, scroll_fraction }
```
Default animation for all three: `animated:true, duration:0.5s, transition_type:QUART(3), ease_type:OUT(1)` (`defaultCameraAnimationDuration/Transition/Ease`, iOS :1174108). Every `MOVE_CAMERA` gets a fresh `animation_id = uuid.v4()`. **The camera tweens on navigation.**

### 3b. Per-view camera + environment presets — VERBATIM (base Model 3/Y; iOS :1169441; `[both-match]`)
Keyed by `CameraPosition` enum `{PARKED, TOP_DOWN, CLIMATE, CHARGING, DRIVE, DRIVE_REVERSE, TENT_MODE, CLOSURE_OPEN, VEHICLE_TO_HOME, ENERGY}`:

| Pose | rotation [x,y,z]° | offset [x,y,z] | cam_fov | envRotation | envEnergy | ambEnergy | rotateSkyBox |
|---|---|---|---|---|---|---|---|
| **PARKED** (= Home & Controls at rest) | [68.6, -138, 0] | [-0.06, 6.7, 0] | **40** | [0, -11, 83] | **6** | **2.6** | false |
| **CLIMATE** | [0, 0, 0] | [0, 6, 0.6] | **40** | [0, 40, 0] | **4** | **4** | false |
| CHARGING | [74, -38, 0] | [0, 6.55, 0] | 40 | [-20, 53, 30] | 5 | 4 | false |
| DRIVE | [68.6, -138, 0] | [-0.06, 8, 0] | 40 | [0, -11, 83] | 6 | 2.6 | false |
| DRIVE_REVERSE | [74, -38, 0] | [0, 8, 0] | 40 | [-9, -7, 75] | 5 | 3 | false |
| TOP_DOWN | [0, 0, 0] | [0, 10, 0] | 40 | [0, -3, 87] | 4.5 | 4 | false |
| ENERGY | [69, 0, 0] | [0, 12, -0.5] | 10 | [0, -45, 0] | 8 | 4 | false |
| CLOSURE_OPEN | [62.654, -139.64, 0] | [-0.086, 4.7, 0] | 58 | [0, 45, 0] | 14 | 2 | **true** |
| TENT_MODE | [80, -17, 0] | [0.2, 4.5, -0.2] | 56 | [0, 45, 0] | 14 | 2 | **true** |
| VEHICLE_TO_HOME | [74, 38.5, 0] | [-0.4, 15.5, 0] | 20 | [-40, 80, -20] | 14 | 2 | false |

**Cybertruck overrides** (`Object.assign` onto base): PARKED `{rotation:[80,-138,-0.15], offset:[-0.14,3,0], envRotation:[0,45,0], envEnergy:14, ambEnergy:2, cam_fov:80, rotateSkyBox:true}`; CLIMATE `{offset:[0,5.5,-0.2], envRotation:[-40,0,0], envEnergy:14, ambEnergy:2}`; TOP_DOWN `{offset:[0,12,0.22], envEnergy:16}`; etc. `CYBERTRUCK_PARKED_WHEEL_TURN_DEG = -22`. **Semi** overrides: CLIMATE `{envRotation:[0,90,70], ambEnergy:3.7}`, CHARGING `{rotation:[78,-55,0], envRotation:[-20,53,30], ambEnergy:3.4}`, etc. (car-type-keyed).

**Screen → pose (by vehicle STATE, not route):** `VehicleControlsScreen → PARKED` (there is **no separate "Controls" camera** — Controls IS the Home product view at PARKED); dynamic overrides: closures open→`CLOSURE_OPEN`, charging→`CHARGING`, tent→`TENT_MODE`, ShiftState.D→`DRIVE`, R→`DRIVE_REVERSE`, summon→`VEHICLE_TO_HOME`, else `PARKED`. Climate panel→`CLIMATE`.

### 3c. Viewport — the "looks bigger" answer `[both-match]`
- **The per-view poses are NOT viewport-dependent.** Every `cam_fov`/`offset`/`rotation` is a hard-coded literal; `moveCamera` is a pure lookup by `position` (+ carType). Nothing reads width/height/aspect/insets/device for the vehicle product camera. (The *only* viewport-dependent FOV is the **Service** carousel: `ScaledSmallVehicleCamFov = interpolate(SCREEN_HEIGHT, [568,926], [80,70], CLAMP)` — service-mode only, not Home/Controls/Climate.)
- **Viewport size arrives separately** via `UPDATE_MAIN_VIEW_FRAME`. So the car's apparent size = a **constant-FOV projection rendered into a per-screen rectangle**. The lever for "looks bigger/positioned differently" is the frame rect (and matching the pose), **not** cam_fov.
- **The GodotView host is a single persistent full-screen absolute view** on every screen: `styles.godotView = {position:'absolute', top:0, left:0, right:0, height: SCREEN_HEIGHT − Specifications.androidStatusBarHeight}` (androidStatusBarHeight = **0 on iOS** → full screen), rendered with `backgroundColor: v5BackgroundColor`, **no SafeAreaView**. Controls/Climate do **not** remount it — they only re-issue `MOVE_CAMERA` + `UPDATE_MAIN_VIEW_FRAME`.
- **Per-screen main-view frame** (× render scale):

| Screen | top_margin | left | width | height |
|---|---|---|---|---|
| **Home** | `statusBarHeight + 60` | 0 | `SCREEN_WIDTH` | **`GODOT_VIEW_SIZE = 355`** |
| Home + lootbox | `statusBarHeight + 60 + LOOTBOX_TOP_BANNER_HEIGHT` | 0 | `SCREEN_WIDTH` | 355 |
| **Controls** | 0 (or a state const) | 0 | `SCREEN_WIDTH` | `SCREEN_HEIGHT − sheetHeight` |
| **Climate** | `statusBarOffset` | 0 | `SCREEN_WIDTH` | `SCREEN_HEIGHT − statusBarOffset − 240` |

`GODOT_VIEW_SIZE = **355**` (iOS :4068110; Android hasm:4490398). `statusBarHeight` = device-dependent (iOS: Dynamic-Island phones **59**, notch **47/50**). So **Home is a 355-pt-tall band starting `statusBarHeight+60` (~107–119 pt) below the top**; Controls/Climate fill down to a sheet. **Render scale:** iOS `NativeModules.GodotModule.getNativeScale()`, Android `PixelRatio.get()` — multiplies top/left/width/height so the frame is delivered in physical pixels. There is no separate SET_RESOLUTION message.

> **So "looks bigger" is almost certainly one of:** (a) your Home main-view frame isn't the 355-pt band at `statusBarHeight+60`, and/or (b) your PARKED pose differs from `offset:[-0.06,6.7,0]` (the `6.7` is the camera distance — smaller = bigger car) `cam_fov:40` `rotation:[68.6,-138,0]`. Match both the frame AND the pose.

### 3d. Shadows / lighting / environment `[both-match on the RN contract; Godot assets Android-decoded]`
**The under-car shadow is NOT a real-time shadow-map.** There is **no DirectionalLight/OmniLight/shadow-caster** and **no `shadow_enabled`/`shadow_color`** anywhere in the Godot project (0 matches). The shadow is a **baked ambient-occlusion texture** — per car model — painted on a flat **`Ground_Plane` MeshInstance**. Lighting is 100% image-based (a PanoramaSky), and it is **RN-driven per view** via `SET_ENV_PARAMS`.

**Why Controls ≠ Climate (your exact report):**
1. The **mobile** ground material `Ground_Plane_mobile.material` is **SHADED** (no `flags_unshaded`; `albedo_color = Color(0,0,0, 0.35294)` i.e. black @ **alpha 0.353**, `flags_transparent`), whereas the desktop `Ground_Plane.material` is `flags_unshaded=true`. So on mobile the shadow tone **reacts to environment energy**.
2. RN sends **different env energies per view** (from the §3b table): **Controls (PARKED) = env_energy 6 / amb_energy 2.6** (darker, higher-contrast shadow); **Climate = 4 / 4** (lighter, flatter). Same AO plane, different lighting → visibly different shadow. `MOVE_CAMERA` and `mobile_app_state` (`{is_loading, show_terrain}`) carry **no** lighting fields.

**Ground/shadow asset:** `Ego/3_High/Textures/Ground_AO_mobile.png` — decoded to a **512×512 RGBA** soft grey oval blob with 4 darker wheel-contact spots and feathered edges (extracted: `godot/Ground_AO_mobile.decoded.png`). Drawn black @ alpha 0.353, `flags_transparent`, default (MIX) blend. There is one AO per model (`Ego/S`, `Ego/X`, `Ego/Y_High`, `Ego/Cybertruck`, `Ego/Semi`, …). *(Note: `GroundShadow.glb`/`GroundReflection.glb` are **Energy/house** assets under `Energy/Load/Residential/Compound/`, NOT the vehicle shadow — extracted for completeness.)*

**Godot receiver:** `mobile/scripts/EnvironmentManager.gdc :: on_set_env_params` tweens `background_energy ← env_energy`, `ambient_light_energy ← amb_energy`, `background_sky_rotation_degrees ← rotation`, `rotate_sky_box` onto the Environment at `/root/Mobile/…/Camera/Background`.

**Environment resource** `assets/godot/env/ap_scene_env.tres` (verbatim, extracted):
```
[Environment] background_mode = 3 (BG_SKY)
  background_sky = PanoramaSky(panorama = res://shared_misc_textures/New_Studio.png, radiance_size=4)
  background_sky_orientation = Basis(0.11963,-0.97431,-0.190809, 0.992546,0.121869,0, 0.0232538,-0.189387,0.981627)
  background_energy = 6.0                  ; baked default (= PARKED); overridden per view by SET_ENV_PARAMS
  ambient_light_energy = 2.6               ; baked default (= PARKED); overridden per view
  fog_depth_begin = 0.0 ; fog_depth_end = 35.5
```
`New_Studio.png` = a **512×256 equirectangular studio HDRI** (bright studio + dark softbox/floor) providing key+fill via IBL and paint/glass reflections (extracted: `godot/New_Studio.decoded.png`; night variant too). **Tonemap/exposure/glow are NOT set → Godot 3 defaults: `tonemap_mode=LINEAR`, `tonemap_exposure=1.0`, `glow_enabled=false`**; no message ever changes them.

**To match Tesla's shadow:** use the **shaded** mobile ground material (black albedo, alpha **0.353**, `flags_transparent`, albedo = per-model `Ground_AO_mobile.png`), and drive the Environment per view — Controls (PARKED) `background_energy 6 / ambient 2.6`, Climate `4 / 4`, sky rotation from `envRotation` (PARKED `[0,-11,83]`, CLIMATE `[0,40,0]`), `rotate_sky_box` false — over the `New_Studio` PanoramaSky, LINEAR tonemap / exposure 1.0 / glow off. No directional light or shadow-map is needed. Cybertruck/Semi key on higher energies (Cybertruck 14–16, rotateSkyBox true).

---

## §4. Citations (representative; full verbatim in `tesla-renderer-and-battery-appendix/`)
- Battery: header `batteryText`=5 iOS :4570724 / Android fn #117212 0x437; % Text style `[batteryText,{color}]` iOS :4567872; face resolution `getFontStyle` iOS :1339633 / TDS Text merge iOS :1430573; font name tables from `fonts/ios/UniversalSans-Text-*.ttf`.
- Range: `getRemainingBatteryRangeDistanceWithUnit` iOS :1229437; source `getBatteryRange`/`getIdealBatteryRange` iOS :1229357; `KM_PER_MILES=1.609344` iOS :1292079; unit keys iOS :1229607; toggle `_fun111136` iOS :4567349; default `getShowEnergy` iOS :1229587.
- Camera: `moveCamera` iOS :1172931 (`MOVE_CAMERA` :1173015, `SET_ENV_PARAMS` :1173041); pose table iOS :1169441; screen→pose iOS :4562100/:4558833.
- Viewport: `TMGodotView` iOS :2779995; `styles.godotView` iOS :4560490/:4181771; frames Home :4559040 / Controls :4039518 / Climate :5222013; `GODOT_VIEW_SIZE=355` iOS :4068110; render scale iOS :1169288.
- Shadows: `ReactMsgType` iOS :1169326; `EnvironmentManager.gdc::on_set_env_params`; `Ground_Plane_mobile.material`, `ap_scene_env.tres` (extracted).

## §5. Gaps
- Exact `SCREEN_HEIGHT − sheetHeight` constants for the **Controls** frame (state-dependent module-scope values) — UNRESOLVED.
- Semi `envEnergy/ambEnergy` for a couple of views come from reused registers — resolved as base 5/6 (PLAUSIBLE, not literal).
- The vehicle ground-quad's exact metres (inside each per-model `.scn`) — UNRESOLVED (the AO texture is 512²; the plane transform is per-model).
- The RCTFont "no faux-bold" native pick (§1b) is INFERRED-strong from the TTF family split + RN rule, not measured on device.
- Whether Android's native font resolver faux-bolds the single-face Medium family — not the target (we ship iOS); UNRESOLVED.

## §6. Traps — where our build would still diverge
1. **Battery %:** ship `marginHorizontal: 5` (not 10) and `fontFamily:'UniversalSansText-Medium'` **without** a real Bold cut (drop `fontWeight`). Shipping Bold-700 is heavier than official Medium-500 — both the status line (14px) and the % (16px) are the same Medium face.
2. **Range fallback:** in distance mode with no range data, render **blank**, not `%` (we fall back to %). Separator is a plain ASCII space; round with `Math.round`; localize the unit; drive km/mi from the vehicle's `gui_distance_units`.
3. **Range switch:** it is an **instant** text swap that **shifts layout** (content-sized, left-aligned) — no crossfade; don't add one.
4. **Renderer size/position:** match Home's `UPDATE_MAIN_VIEW_FRAME` = `{top: statusBarHeight+60, width: SCREEN_WIDTH, height: 355}` AND the PARKED pose `offset:[-0.06,6.7,0] cam_fov:40 rotation:[68.6,-138,0]`. "Bigger" is frame + pose, not FOV scaling. Keep the GodotView a single persistent full-screen host; only re-issue frame+camera per screen.
5. **Shadow:** it's a **baked AO blob** (`Ground_AO_mobile.png`, black @ alpha 0.353, **shaded** material), not a shadow-map. The Controls-vs-Climate difference is the **per-view env energy** (`SET_ENV_PARAMS`: PARKED 6/2.6 vs CLIMATE 4/4) — replay it per view over the `New_Studio` PanoramaSky. An unshaded material or a constant environment will not match.
