# R5 §3 — Godot SHADOWS + LIGHTING + ENVIRONMENT

Tags: `[iOS-verified]` = from `main.decompiled.js` v4.56; `[Android-only]` = from `bundle.hasm` v4.58;
`[both-match]` = confirmed on both; `[differ]` = platforms differ; INFERRED / UNRESOLVED called out inline.

Sources
- iOS JS: `/Users/ivan/Downloads/tesla-haptics-work/main.decompiled.js`
- Android hasm: `/Users/ivan/Work/tesla-summon/work/bundle.hasm`
- Godot: `split_assets_pack.apk` in the APK dir.

---

## TL;DR (answers the user's report)

The under-car shadow is **NOT a real-time shadow-map**. There is **no DirectionalLight / OmniLight / shadow-caster** in the
mobile scene (`shadow_enabled` / `shadow_color` appear in **0** files). The vehicle's under-car shadow is a **baked
ambient-occlusion texture** (`Ground_AO[_mobile].png`, a soft grey blob, one per car model) painted on a flat
**`Ground_Plane` MeshInstance** via a `SpatialMaterial`. Its apparent darkness is therefore governed by the **scene
environment lighting**, and **that lighting is RN-driven PER VIEW** through the `SET_ENV_PARAMS` renderer message.

Root cause of "shadow differs Controls vs Climate":
1. The **mobile** ground material `Ground_Plane_mobile.material` is **shaded** (it has NO `flags_unshaded`), unlike the
   desktop `Ground_Plane.material` which IS `flags_unshaded=true`. So on mobile the shadow tone reacts to environment energy.
2. RN sends **different** `env_energy` / `amb_energy` for each camera view:
   - **Controls** view = `PARKED` preset → **env_energy 6, amb_energy 2.6** (stronger key, less ambient ⇒ **darker/higher-contrast** shadow).
   - **Climate** view = `CLIMATE` preset → **env_energy 4, amb_energy 4** (weaker key, more ambient fill ⇒ **lighter/flatter** shadow).
   Same AO plane, different lighting ⇒ visibly different shadow. If your app uses a constant environment (or the unshaded
   desktop material, or doesn't replay `SET_ENV_PARAMS` per view), the shadow will not match.

---

## DELIVERABLE 1 — Is shadow/light RN-driven PER VIEW or scene-side?

**Answer: environment LIGHTING is RN-driven per view (`SET_ENV_PARAMS`); the SHADOW itself is scene-side (a baked AO plane)
whose look is modulated by that per-view lighting. No message carries a `shadow`/`intensity`/`directional`/`tonemap`/`exposure`
field.** `[both-match]`

### Renderer message enum (`ReactMsgType`) `[iOS-verified` :1169326-1169362; `both-match]`
Verbatim members (order as emitted):
```
APP_CONFIG, SET_APP_THEME, SET_SCREEN_OVERLAY_COLOR, SHOW_PRODUCT, UPDATE_PRODUCT,
UPDATE_MAIN_VIEW_FRAME, SET_ENV_PARAMS, SHOW_FPS, MOVE_CAMERA, INPUT_EVENT, QUIT_ENGINE,
TAKE_SNAPSHOTS, FLASH_HEADLIGHTS, FORCE_CLOSE_ALL_CLOSURES, FADE_ROOF, SHOW_FX_ABOVE,
GET_VEHICLE_MARKERS, ENTER_TESLA_WRAPPED, EXIT_TESLA_WRAPPED
```
Only lighting-relevant messages: **`SET_ENV_PARAMS`** (environment/IBL) and `SET_APP_THEME`. No `SET_LIGHT`, no
`SET_ENVIRONMENT`, no `skybox` message, no per-object shadow message.

### `MOVE_CAMERA` payload — NO lighting fields `[iOS-verified` :1173022; `both-match]`
```
{ rotation, offset, cam_fov, animated, duration, transition_type, ease_type, animation_id }
```

### `SET_ENV_PARAMS` payload — the lighting message `[iOS-verified` :1173041; `both-match` (Android hasm has the same keys)]
Built right after MOVE_CAMERA in the same camera-move function; sourced from the per-view preset object `r15`:
```
key in message      <- source field
'rotation'          <- envRotation
'env_energy'        <- envEnergy
'amb_energy'        <- ambEnergy
'animated'          <- (same tween as camera)
'duration'          <- (same)
'transition_type'   <- (same)
'ease_type'         <- (same)
'rotate_sky_box'    <- rotateSkyBox
```

### `mobile_app_state` frame (via `UPDATE_PRODUCT`) — NO lighting/shadow fields `[iOS-verified` :4559117; `both-match]`
```
mobile_app_state = { 'is_loading': false, 'show_terrain': false }
```
(The big `updateProduct` frame — iOS `_fun68310` — carries `charge_state`, `climate_state`, `drive_state`,
`is_climate_on`, etc. NONE of them lighting/shadow.)

### PER-VIEW preset table (the values RN sends) `[iOS-verified` :1169438-1169590; `both-match]`
Object keyed by `CameraPosition` name. Each preset = `{rotation, offset, envRotation, envEnergy, ambEnergy, cam_fov, rotateSkyBox}`.
Verbatim lighting/fov values (rotation/offset given where load-bearing):

| View (CameraPosition) | envEnergy | ambEnergy | cam_fov | rotateSkyBox | envRotation |
|---|---|---|---|---|---|
| **PARKED** (= Controls default) | **6** | **2.6** | 40 | false | [0, -11, 83] |
| **CLIMATE** | **4** | **4** | 40 | false | [0, 40, 0] |
| CHARGING | 5 | 4 | 40 | false | [-20, 53, 30] |
| DRIVE | 6 | 2.6 | 40 | false | [0, -11, 83] |
| DRIVE_REVERSE | 5 | 3 | 40 | false | [-9, -7, 75] |
| TOP_DOWN | 4.5 | 4 | 40 | false | [0, -3, 87] |
| ENERGY | 8 | 4 | 10 | false | [0, -45, 0] |
| CLOSURE_OPEN | 14 | 2 | 58 | true | [0, 45, 0] |
| TENT_MODE | 14 | 2 | 56 | true | [0, 45, 0] |
| VEHICLE_TO_HOME | 14 | 2 | 20 | false | [-40, 80, -20] |

Extra literals: `CYBERTRUCK_PARKED_WHEEL_TURN_DEG = -22`. `CameraPosition` enum members (iOS :1169365):
`PARKED, TOP_DOWN, CLIMATE, CHARGING, DRIVE, DRIVE_REVERSE, TENT_MODE, CLOSURE_OPEN, VEHICLE_TO_HOME, ENERGY`
(there is **no "CONTROLS"** camera — Controls maps to PARKED, see below).

Camera preset full transforms for the two views the user cares about (verbatim):
- **PARKED**: rotation `[68.6, -138, 0]`, offset `[-0.06, 6.7, 0]`, envRotation `[0, -11, 83]`.
- **CLIMATE**: rotation `[0, 0, 0]`, offset `[0, 6, 0.6]`, envRotation `[0, 40, 0]`.

### Per-carType overrides that merge on top of the base preset `[iOS-verified` :1169600-1169735]
`_closure1_slot23`, merged by `Object.assign(base, carTypeTable[view])`.
- **SEMITRUCK** (`CARTYPESEMITRUCK`): `CLIMATE {envRotation [0,90,70], envEnergy=<reg r27>, ambEnergy 3.7}`;
  `CHARGING {envRotation [-20,53,30], envEnergy=<reg r29>, ambEnergy 3.4}`; PARKED/DRIVE/TOP_DOWN mostly offset-only.
  (r27/r29 are register values not resolvable to literals from this window — INFERRED they are the base 6/5.)
- **CYBERTRUCK** (`CARTYPECYBERTRUCK`): `PARKED {envEnergy 14, ambEnergy 2, cam_fov 80, rotateSkyBox true}`;
  `TOP_DOWN {envEnergy 16, ambEnergy=<r22>}`; `CHARGING / DRIVE / DRIVE_REVERSE / CLIMATE {envEnergy 14, ambEnergy=<r28>}`.
  So Cybertruck uses a much brighter environment (14–16) and rotates the skybox. `[differ` per car]

### Screen → CameraPosition mapping `[iOS-verified]`
- **VehicleControlsScreen → `CameraPosition.PARKED`** (:4558833; `r3['position']=CameraPosition.PARKED`, `r1.VehicleControlsScreen`).
- Controls dynamic override state machine (:4562128-4562205): `CLOSURE_OPEN` (a closure open) → `CHARGING` (charging) →
  `TENT_MODE` → `DRIVE` (ShiftState.D) / `DRIVE_REVERSE` (ShiftState.R) → `VEHICLE_TO_HOME` → else **`PARKED`** (default).
- **Climate** panel active → `CameraPosition.CLIMATE`.
- Secondary/default preset copy at iOS :7713722 (near `getVehicleMarkersFallback`): `{envEnergy 4, ambEnergy 4, cam_fov 40,
  rotateSkyBox false}` with PARKED rotation/offset — a fallback default. INFERRED role: initial/marker fallback camera.

### Godot receiver `[both-match; Android .gdc]`
`assets/godot/mobile/scripts/EnvironmentManager.gdc` — handler **`on_set_env_params`** reads
`rotation, env_energy, amb_energy, animated, duration, transition_type, ease_type, rotate_sky_box` and Tweens these onto the
scene Environment node:
```
background_sky_rotation_degrees   <- rotation
background_energy                 <- env_energy
ambient_light_energy              <- amb_energy
rotate_sky_box                    <- rotate_sky_box
```
Environment node path: `/root/Mobile/MainViewContainer/Viewport/CameraManager/CameraPivot/Camera/Background`.
Also holds theme colors: `light_theme_color = #F7F7F7`, `dark_theme_color = #161718`, plus `333333` (grey), keyed `modely`/`cybertruck`.
Android hasm verify (counts): `SET_ENV_PARAMS`×4, `envEnergy`×23, `ambEnergy`×23, `cam_fov`×25, `rotateSkyBox`×13,
`env_energy`×10, `amb_energy`×2, `CameraPosition`×30 — all present ⇒ `[both-match]`.

---

## DELIVERABLE 2 — Scene-side light + shadow (verbatim material contents)

All `.material` are Godot 3.2 binary `SpatialMaterial`. Most are **RSCC (Zstd-compressed)**; `Light_Global.material` is
plain **RSRC**. (The task note "readable TEXT" holds only for `.tres`; `.material` are binary — decoded here with a custom
Godot-binary parser, values are exact.)

### Ground materials (the under-car shadow plane) — THE key ones
```
Ground_Plane.material          (res://Ego/3_High/Ground_Plane.material)   [DESKTOP/high]
  resource_name        = "Ground_Plane"
  flags_transparent    = true
  flags_unshaded       = true            <-- UNSHADED (constant, ignores env light)
  albedo_color         = Color(0.10588, 0.10588, 0.10588, 1.0)   (grey ~#1B1B1B, opaque)
  albedo_texture       = res://Ego/3_High/Textures/Ground_AO.png

Ground_Plane_mobile.material   (res://Ego/3_High/Ground_Plane_mobile.material)   [MOBILE — what the phone app uses]
  resource_name        = "Ground_Plane"
  flags_transparent    = true
  (NO flags_unshaded)                    <-- SHADED: darkness reacts to env_energy/amb_energy
  albedo_color         = Color(0.0, 0.0, 0.0, 0.35294)          (BLACK @ alpha 0.353)
  albedo_texture       = res://Ego/3_High/Textures/Ground_AO_mobile.png
```

### Light materials (these are car body/emissive materials, NOT scene lights)
```
Light.material
  resource_name = "Light";  albedo_color = Color(0.4, 0.4, 0.4, 1.0)

Light_Global.material                    (plain RSRC)
  resource_name = "Light_Global"; params_cull_mode = 2 (cull disabled/back?); albedo_color = Color(0.4,0.4,0.4,1.0)

Lights.material
  albedo_color=Color(0.10196,0.10196,0.10196,1.0); metallic=0.7; roughness=0.0(tex); ao_enabled=true; ao_light_affect=0.5
  textures: Lights_BC.png (albedo), Lights_MRA.png (metallic/rough/ao)
Lights_Global.material
  albedo_color=Color(0.19608,0.19608,0.19608,1.0); metallic=1.0; ao_enabled=true; ao_light_affect=1.0
  textures: Lights_Global_BC.png, Lights_Global_MRA.png

Illumination.material
  render_priority=2; params_blend_mode=1 (ADD); albedo_color=Color(0,0,0,1);
  emission_enabled=true; emission=Color(0,0,0,1); emission_energy=0.75; emission_texture=Lights_E.png
Illumination_Global.material
  same but emission_energy=1.0; emission_texture=Lights_Global_E.png

Glass_Lights.material
  flags_transparent=true; albedo_color=Color(0.01176,0.01176,0.01176,0.50980); roughness=0.05

Headlights_Projection.material
  render_priority=-100; flags_transparent=true; flags_unshaded=true; flags_albedo_tex_force_srgb=true;
  params_blend_mode=1 (ADD); albedo_color=Color(0.8,0.8,0.8,1.0); albedo_texture=headlight_projection.png
```
None of these are Light nodes — they are surface `SpatialMaterial`s named "Light/Illumination" (car lamp lenses + emissive).

### Actual scene light + shadow nodes — NONE (this is the mechanism finding)
Filename/string scan across all godot assets:
`DirectionalLight`=**0**, `OmniLight`=**0**, `SpotLight`=1 (headlight beam geometry, not a shadow-caster),
`shadow_enabled`=**0**, `shadow_color`=**0**. ⇒ **No real-time light and no shadow-map exist.** Lighting is 100%
image-based (the PanoramaSky in the Environment) and the "shadow" is the baked AO plane. `[both-match]`

---

## DELIVERABLE 3 — Ground / under-car shadow mechanism

**It is a BAKED AO/DECAL texture on a flat ground plane — not a shadow-map, not a light.** `[both-match]`

- Vehicle ground node names (from `assets/godot/mobile/scripts/Vehicles/Vehicle.gdc`): **`Ground_Plane_mobile`** and
  **`Ground_Plane`** (mobile picks `_mobile`). Materials as dumped above. Also `set_plate_background_color_override`,
  `color_background`.
- The AO texture is **per car model**: `Ego/3_High/Textures/Ground_AO[_mobile].png` (Model 3 / generic), plus
  `Ego/S`, `Ego/S_Palladium`, `Ego/X`, `Ego/X_Palladium`, `Ego/Y_High` (`Ground_AO_Y_High` / `_mobile_Y_High`),
  `Ego/Cybertruck`, `Ego/Semi` variants.
- **Decoded shadow texture** `Ground_AO_mobile.png` = **512×512 RGBA PNG** (StreamTexture GDST, lossless compress/mode=0,
  srgb, mipmaps, repeat+filter). Visual: a soft grey oval/pill blob with 4 darker wheel-contact spots and feathered edges
  (a classic baked drop-shadow). On mobile it is tinted BLACK and drawn at **alpha 0.353**, then lit by the environment.
- Plane opacity/blend/color (mobile): `flags_transparent=true`, default blend (MIX/alpha), color black, alpha 0.353.
- Plane size: driven by the per-vehicle scene's MeshInstance transform (not in the material). UNRESOLVED exact metres for
  the vehicle ground quad (it is inside the per-model vehicle `.scn`, not separately dumped here).

### `GroundShadow.glb` / `GroundReflection.glb` — these are ENERGY assets, not the vehicle
- Both live under `assets/godot/Energy/Load/Residential/Compound/` (`GroundShadow.tscn`, `GroundReflection` ext-material
  `res://Energy/Load/Residential/Compound/Reflection.material`) → they are the **house/compound** ground shadow+reflection
  in the Energy product, **not** the Controls/Climate vehicle shadow.
- `GroundShadow.glb-*.scn` decoded: root `Spatial "GroundShadow"` → child `MeshInstance`:
  - mesh = ArrayMesh "GroundShadow", **aabb pos (-1, 0, -1) size (2, 1e-5, 2)** → a flat 2×2 unit XZ plane, 30 verts / 78
    indices (soft-edged, not a plain quad).
  - transform = uniform **scale ~2.867** (with -Z flip), translation (0.8784, 0.0369, -0.2846) → real footprint ≈ 5.73×5.73 u.
  - **material/0 = null** (no baked material; assigned at runtime).
- `GroundReflection.glb-*.scn` decoded: root `Spatial "GroundReflection"` → `MeshInstance` mesh=ArrayMesh#1
  (surface material = ext `Reflection.material`), material/0 override = null.

---

## DELIVERABLE 4 — Environment (background / ambient / tonemap / exposure)

Scene Environment resource: **`assets/godot/env/ap_scene_env.tres`** (text) — verbatim:
```
[gd_resource type="Environment" load_steps=3 format=2]
[ext_resource path="res://shared_misc_textures/New_Studio.png" type="Texture" id=1]
[sub_resource type="PanoramaSky" id=1]
radiance_size = 4
panorama = ExtResource( 1 )
[resource]
background_mode = 3                         ; BG_SKY (image-based)
background_sky = SubResource( 1 )
background_sky_orientation = Basis( 0.11963, -0.97431, -0.190809, 0.992546, 0.121869, 0, 0.0232538, -0.189387, 0.981627 )
background_energy = 6.0                      ; == PARKED/Controls default env_energy
ambient_light_energy = 2.6                   ; == PARKED/Controls default amb_energy
fog_depth_begin = 0.0
fog_depth_end = 35.5
```
- **Background** = PanoramaSky using **`New_Studio.png`** — decoded to a **512×256 equirectangular** studio HDRI (bright white
  studio with dark softbox/backdrop/floor strip; provides key+fill via IBL and the reflections on paint/glass).
  Night variant exists: `New_Studio_Night.png` (also 512×256), and `New_Studio_Front.png`.
- **Background energy 6.0** and **ambient_light_energy 2.6** are the *baked defaults*, then **overridden per view** by
  `SET_ENV_PARAMS` (env_energy/amb_energy) as tabulated in Deliverable 1. That override IS the Controls-vs-Climate delta.
- **Tonemap / exposure / glow**: **NOT set** in `ap_scene_env.tres` ⇒ Godot 3 defaults apply: `tonemap_mode = LINEAR`,
  `tonemap_exposure = 1.0`, `glow_enabled = false`. UNRESOLVED whether the app patches these at runtime (no
  tonemap/exposure/glow key found in any renderer message — none is sent, so they stay at these defaults). `[both-match]`
- **Fog**: on, `fog_depth_begin 0.0 … fog_depth_end 35.5` (fades distant background; no per-view fog override sent).
- Related: `assets/godot/shaders/paint_skybox_overlay.tres` (ShaderMaterial for paint reflections):
  `skybox_rot=0.0, metallic=0.7, roughness=0.1, color=Color(0,0.0627451,0.14902,1) [dark teal], skybox_contrib=true,
  skybox_intensity=0, ao_intensity=1.0, transition_z_pos=100.0`. `assets/godot/skybox/clouds_cubemap.tres` /
  `stars_cubemap.tres` are Energy/other-product skyboxes.
- Energy product `is_night` / weather (cloud_factor, time_of_day, golden_hour, moon_phase) exist (iOS :4602116, :3916298)
  but belong to the **Energy demo** time-of-day, not the vehicle Controls/Climate view. Not relevant to the under-car shadow.

---

## DELIVERABLE 5 — Extracted files

All written to `/Users/ivan/Work/airgapp/mobile/docs/superpowers/research/tesla-status-assets/godot/`.

| File written | APK source path |
|---|---|
| `GroundShadow.glb-f85e97f391d569c64e204532360c98b5.scn` | `assets/godot/.import/GroundShadow.glb-f85e97f391d569c64e204532360c98b5.scn` |
| `GroundReflection.glb-19f3200625aeb357860045a5c564e569.scn` | `assets/godot/.import/GroundReflection.glb-19f3200625aeb357860045a5c564e569.scn` |
| `Ground_Plane.material` | `assets/godot/Ego/3_High/Ground_Plane.material` |
| `Ground_Plane_mobile.material` | `assets/godot/Ego/3_High/Ground_Plane_mobile.material` |
| `Light.material` | `assets/godot/Ego/3_High/Light.material` |
| `Light_Global.material` | `assets/godot/Ego/3_High/Light_Global.material` |
| `Lights.material` | `assets/godot/Ego/3_High/Lights.material` |
| `Lights_Global.material` | `assets/godot/Ego/3_High/Lights_Global.material` |
| `Illumination.material` | `assets/godot/Ego/3_High/Illumination.material` |
| `Illumination_Global.material` | `assets/godot/Ego/3_High/Illumination_Global.material` |
| `Glass_Lights.material` | `assets/godot/Ego/3_High/Glass_Lights.material` |
| `Headlights_Projection.material` | `assets/godot/Ego/3_High/Headlights_Projection.material` |
| `ap_scene_env.tres` | `assets/godot/env/ap_scene_env.tres` |
| `Ground_AO_mobile.png.import` | `assets/godot/Ego/3_High/Textures/Ground_AO_mobile.png.import` |
| `Ground_AO.png.import` | `assets/godot/Ego/3_High/Textures/Ground_AO.png.import` |
| `New_Studio.png.import` | `assets/godot/shared_misc_textures/New_Studio.png.import` |
| `Ground_AO_mobile.png-8d214a49d2cc9fb6bc68d670d58ae5bc.stex` | `assets/godot/.import/Ground_AO_mobile.png-8d214a49d2cc9fb6bc68d670d58ae5bc.stex` |
| **`Ground_AO_mobile.decoded.png`** (512×512 RGBA — the under-car shadow blob) | decoded from the `.stex` above |
| **`New_Studio.decoded.png`** (512×256 studio HDRI — the environment) | decoded from `assets/godot/.import/New_Studio.png-b4cb190cf6f42b94dbc5a46aa6db95d0.stex` |
| **`New_Studio_Night.decoded.png`** (512×256 night HDRI) | decoded from `assets/godot/.import/New_Studio_Night.png-c8b8758356df4ff7158952c235536c25.stex` |

Helper scripts (scratchpad, not deliverables): `rscc_decomp.py` (Godot RSCC→RSRC Zstd block decompressor),
`godot_res.py` (Godot 3.x binary resource/PackedScene parser).

---

## Practical takeaways for matching Tesla's shadow

1. Use the **shaded** mobile ground material, not an unshaded one: black albedo, **alpha 0.353**, `flags_transparent`,
   albedo = the per-model **`Ground_AO_mobile.png`** (512² soft AO blob).
2. Drive the Environment per view via the equivalent of `SET_ENV_PARAMS`: set `background_energy`/`ambient_light_energy`
   from the preset table — **Controls (PARKED) = 6 / 2.6**, **Climate = 4 / 4** — plus `background_sky_rotation_degrees`
   from `envRotation` (PARKED [0,-11,83], CLIMATE [0,40,0]) and `rotate_sky_box` (both false for these two).
3. Environment = `PanoramaSky(New_Studio.png)` at radiance_size 4, orientation Basis above, fog 0..35.5, tonemap LINEAR,
   exposure 1.0, glow off. No directional light / shadow-map is needed or present.
4. Cybertruck (and Semi) use different env energies (Cybertruck 14–16, rotateSkyBox true) — key the values on car type.
