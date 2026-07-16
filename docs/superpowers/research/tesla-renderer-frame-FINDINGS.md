# Tesla Godot renderer: the `UPDATE_MAIN_VIEW_FRAME` handler + why the car size differs (Round 6)

**Deliverable for Round 6** — narrow & deep: the **Godot scene side** of the frame, recovered by **decompiling their compiled `.gdc` GDScript**.

**Method / tooling:** I wrote a Godot-3.2 `.gdc` (bytecode version 13) decompiler (`tesla-renderer-frame-appendix/gdc_decomp.py`) and **validated it** by decompiling `ScreenOverlay.gdc` / `EnvironmentManager.gdc` and confirming they match what R4/R5 independently established (the `SET_SCREEN_OVERLAY_COLOR` / `SET_ENV_PARAMS` handlers). It reconstructs source-faithful GDScript. The main scene `mobile.tscn` shipped as **readable text** (not binary), so node config is verbatim.

**Platform tag:** the Godot project is extracted from the **Android** `split_assets_pack.apk`, but **iOS ships the same Godot project** (same `res://` paths, same `.gdc`), so these facts are `[both-match]` for the renderer scene. The RN-side frame values (355, top margins, `× getNativeScale()`) were `[iOS-verified]` in R5.

**Full verbatim in `tesla-renderer-frame-appendix/`:** `MainViewContainer.decompiled.gd`, `CameraManager.decompiled.gd`, `AppConfigManager.decompiled.gd`, `mobile.tscn`, plus the decompiler.

---

## ⚠️ HEADLINE — the brief's premise was wrong, and the real cause is the CAMERA, not the frame handler

The brief inferred *"their handler cannot be scaling the scene by `height/screen_height` — it must crop/letterbox instead."* **It does scale by `height/screen_height`, exactly like your port.** Their `on_update_main_view_frame` sets `root_node.scale = Vector3.ONE * (height / screen_height)` and moves `rect_position` — byte-for-byte the same maths you already ship. **So the frame handler is NOT the reason their car is bigger.**

The real lever is the **Camera's `keep_aspect`**. Tesla's `CameraManager` **never sets `keep_aspect`**, so the Camera keeps its Godot-3 default **`KEEP_HEIGHT` → `fov: 40` is a VERTICAL FOV**. If your `MOVE_CAMERA` port applies your invented `keep_aspect: 'WIDTH'` (or otherwise sets `KEEP_WIDTH`), the same `fov 40` becomes a *horizontal* FOV, and on a portrait phone that shrinks the car by the aspect ratio — **on a 393×852 pt phone that is ×0.461 ≈ "45% smaller," matching your report exactly.** Set the camera to **`KEEP_HEIGHT`** and treat `cam_fov` as vertical.

---

## §1. Their frame handler — `MainViewContainer.gd`, VERBATIM `[both-match]`

**Script:** `res://mobile/scripts/MainViewContainer.gd`. **Scene node:** `/root/Mobile/MainViewContainer` (a `ViewportContainer`, `anchor_right=1.0 anchor_bottom=1.0 stretch=true` → fills the screen). Registered via `mobile_comm.register_listener(ReactMsg.UPDATE_MAIN_VIEW_FRAME, funcref(self, 'on_update_main_view_frame'))`.

```gdscript
extends ViewportContainer
class_name MainViewContainer

onready var viewport: Viewport = get_node('Viewport')
onready var root_node: Spatial = get_node('Viewport/root')     # the 3D scene root (car lives under here)
onready var tween: Tween = get_node('Tween')

var container_offset = Vector2(0, 0)
var container_size   = Vector2(1, 1)
var current_scroll_fraction: float = 1
signal scroll_fraction_change(fraction)

func on_update_main_view_frame(data: Dictionary):
    var screen_width:  float = get_viewport().size.x          # ROOT (window) viewport, in DEVICE PIXELS
    var screen_height: float = get_viewport().size.y
    print('[MainViewController] screen_width: %f screen_height: %f' % [screen_width, screen_height])

    var top_margin  = data.get('top_margin', 0)               # NO pixel_ratio multiply anywhere
    var left_margin = data.get('left_margin', 0)
    var width       = data.get('width',  screen_width)
    var height      = data.get('height', screen_height)

    var animated        = data.get('animated', true)
    var duration        = data.get('duration', 0.75)
    var transition_type = data.get('transition_type', Tween.TRANS_QUART)
    var ease_type       = data.get('ease_type', Tween.EASE_IN_OUT)

    var scale: Vector3 = Vector3.ONE * (height / screen_height)                 # <-- SCENE ZOOM = height / screen_height
    var center_x  = left_margin + (screen_width  / 2 * width  / screen_width)   #  = left_margin + width/2
    var center_y  = top_margin  + (screen_height / 2 * scale.y)                 #  = top_margin  + screen_height/2 * scale
    var position_x = center_x - (screen_width  / 2)
    var position_y = center_y - (screen_height / 2)

    var scroll_fraction = data.get('scroll_fraction', clamp(inverse_lerp(0.4, 0.8, scale.x), 0, 1))

    container_offset = Vector2(screen_width/2 - width/2, screen_height/2 - height/2)
    container_size   = Vector2(width, height)

    if current_scroll_fraction != scroll_fraction:
        current_scroll_fraction = scroll_fraction
        emit_signal('scroll_fraction_change', scroll_fraction)

    if animated:
        tween.interpolate_property(self,      'rect_position', null, Vector2(position_x, position_y), duration, transition_type, ease_type)
        tween.interpolate_property(root_node, 'scale',         null, scale,                           duration, transition_type, ease_type)
        tween.start()
    else:
        if tween.is_active(): tween.stop_all()
        rect_position   = Vector2(position_x, position_y)
        root_node.scale = scale
```
*(There is also a `_process` editor-only debug path that calls the same handler with an `Inspector` width — irrelevant on device.)*

**What each field does (plain English):**
- `height` → **the only zoom lever**: `root_node.scale = ONE * (height / screen_height)`. It uniformly scales the 3D scene **root** (which holds the car; the **camera is NOT under root** — §3, so scaling root **shrinks the car**). At Home `height=355` on an 852-pt (×scale px) screen → `scale ≈ 0.417`.
- `top_margin` → vertical position: the full-screen `ViewportContainer` is moved so the scaled scene's centre lands at `center_y = top_margin + screen_height/2 * scale`. `rect_position.y = center_y - screen_height/2`.
- `left_margin` / `width` → horizontal centre `center_x = left_margin + width/2`; `rect_position.x = center_x - screen_width/2`. (`width` does **not** affect the zoom — only `height` does.)
- `scroll_fraction` → emitted to listeners (parallax); defaults to `clamp(inverse_lerp(0.4, 0.8, scale.x), 0, 1)`.
- **No `pixel_ratio` / `getNativeScale()` conversion inside their scene.** They rely on RN having already sent the frame in **device pixels** (`× getNativeScale()`, R5) and on `get_viewport().size` being **device pixels**, so `height / screen_height` is **dimensionless** — the scale factor is unit-free regardless of DPR.

## §2. The mapping — what transform their scene ends up applying

Given RN's Home frame `{top_margin: (statusBarHeight+60), left_margin: 0, width: SCREEN_WIDTH, height: 355}` **× `getNativeScale()`** (R5), i.e. in device pixels:
- `scale = (355·s) / (SCREEN_HEIGHT_pt·s) = 355 / SCREEN_HEIGHT_pt` — the DPR `s` cancels. On a 393×852-pt phone → **`scale ≈ 0.4167`**, applied as `root_node.scale`.
- `rect_position = ( 0 , (top_margin + screen_height/2·scale) − screen_height/2 )` — moves the full-screen ViewportContainer up so the shrunk scene sits in the 355-pt band under the status bar.

**This is identical to your port's formula.** So reproducing it faithfully means: (a) do **not** add a `× pixel_ratio` that isn't cancelled — Tesla does the ratio **unit-free** (both `height` and `screen_height` in the same device-pixel units); (b) `get_viewport().size` in your scene must be the **same units** as the (RN-scaled) `height` — if your `get_viewport().size` returns points while `height` is pixels (or vice-versa), the ratio is wrong. (c) The car's apparent size after this scale is then set by the **camera** (§3), which is where your discrepancy lives.

## §3. Camera + scene graph — the actual size mechanism `[both-match]`

**Scene tree (verbatim from `mobile.tscn`):**
```
Mobile (Spatial)
└─ MainViewContainer (ViewportContainer; anchors 0..1 full-screen; stretch=true)
   └─ Viewport (size=Vector2(790,875); size_override_stretch=true; own_world=true; transparent_bg=true; msaa=2; render_target_update_mode=3)
      ├─ WorldEnvironment (env = mobile.tres)      # EnvironmentManager
      ├─ root (Spatial)                            # <-- root_node, scaled by the frame handler
      │   └─ ProductSwitcher (Spatial)
      │       └─ Slot (Spatial)                    # <-- the VEHICLE is instanced here
      └─ CameraManager (Spatial)                   # <-- SIBLING of root (NOT under it)
         └─ CameraPivot (Spatial)
            └─ Camera (Camera)  transform=(…,0,13,0)  current=true  fov=40.0  far=150.0   # NO keep_aspect, NO projection
               └─ Background (MeshInstance, visible=false)
```

**Key facts:**
1. **The Camera is a sibling of `root`** (both under `Viewport`). So `root_node.scale` (frame handler) scales the **car** but **not the camera** → the frame's `height` fraction really does shrink the car. (If your port put the camera under `root`, the scale would be invariant and the car wouldn't shrink at all — a different bug.)
2. **`keep_aspect` is NOT set on the Camera** → Godot-3 default **`KEEP_HEIGHT`** → **`fov: 40` is the VERTICAL FOV.** `CameraManager.on_move_camera` (verbatim below) sets only `pivot.rotation_degrees`, `camera.translation`, `camera.rotation_degrees=(-90,0,0)`, and `camera.fov` — it **never** touches `keep_aspect`, `size`, or `projection`. So the camera stays KEEP_HEIGHT / PERSPECTIVE for every view.
   ```gdscript
   func on_move_camera(data):
       var rotation = Utils.vec3_from_data(data.get('rotation', [0,0,0]), Vector3.ZERO)
       var offset   = Utils.vec3_from_data(data.get('offset',   [0,0,0]), Vector3.ZERO)
       var cam_fov  = data.get('cam_fov')
       camera.rotation_degrees = Vector3(-90, 0, 0)
       if animated:
           tween.interpolate_property(pivot,  'rotation_degrees', null, rotation, ...)
           tween.interpolate_property(camera, 'translation',      null, offset,   ...)
           if cam_fov != null: tween.interpolate_property(camera, 'fov', null, cam_fov, ...)
       else:
           pivot.rotation_degrees = rotation
           camera.translation     = offset
           if cam_fov != null: camera.fov = cam_fov
   ```
   Rig: **`CameraPivot`** (rotated by `MOVE_CAMERA.rotation`, e.g. PARKED `[68.6,-138,0]`) → **`Camera`** at local `translation = offset` (e.g. PARKED `[-0.06,6.7,0]`), fixed local `rotation=(-90°,0,0)`, `fov = cam_fov`. So the camera orbits a pivot at the car; `offset.y` (≈6.7) is essentially the **camera distance**. `far=150`.
3. **`get_viewport()` in `MainViewContainer`** is the **ROOT window viewport** (full device, device pixels — project has **no `display/window/stretch/mode`**, so stretch is *disabled* and the root viewport is device-pixel-sized). The 3D camera renders into the **child `Viewport`**, whose size = the ViewportContainer's `rect_size` (because `stretch=true`) = full screen → **camera aspect = screen aspect** (~0.461 w/h on a 393×852 phone). The `size=Vector2(790,875)` + `size_override_stretch=true` are the design-time size / 2D-canvas override; the 3D camera uses the actual (screen-aspect) viewport size.

**Car scale (`Vehicle.gd`):** each vehicle has `export var vehicle_scale`; `get_vehicle_scale()` returns `vehicle_scale if > 0 else **1.1**`. So the car model sits at Slot with a per-model scale (default **1.1**), and `root_node.scale` (≈0.417 at Home) multiplies on top → net car world scale ≈ **0.417 × 1.1 ≈ 0.46** at Home.

**Ground/shadow plane (`Vehicle.gd`):** the under-car shadow is a `MeshInstance` at an exported `ground_shadow_path`, whose surface-0 material is swapped `Ground_Plane_mobile` (mobile) / `Ground_Plane` (desktop) at runtime (R5). Its **transform (metres) lives in each per-model vehicle `.tscn`** (`ground_shadow` node), which I did not fully parse this round → **UNRESOLVED exact metres** (see Gaps). It is a child of the vehicle, so it inherits `vehicle_scale × root_node.scale`.

## §4. Calibration — the size ratio that explains "45% smaller"

**The definitive relation:** with a **fixed** camera pose (`fov 40`, `offset.y ≈ 6.7`, pivot rotation) and a **fixed** `root_node.scale`, the car's on-screen size is governed by `keep_aspect`:
- **`KEEP_HEIGHT` (Tesla):** the **vertical** world extent captured at the car's distance `d` is `Vₕ = 2·d·tan(fov/2) = 2·d·tan(20°)`. The car's on-screen height fraction = `car_height / Vₕ`.
- **`KEEP_WIDTH`:** `fov` becomes horizontal; the **vertical** extent captured becomes `V_w = Vₕ / aspect` where `aspect = width/height`. On portrait `aspect ≈ 0.461` (393/852) → `V_w = Vₕ / 0.461 = 2.17·Vₕ`. The car (same height) now fills **`0.461×`** as much of the frame.

**So switching Tesla's `KEEP_HEIGHT` to `KEEP_WIDTH` on a 393×852-pt phone makes the car ≈ 46% of its correct on-screen size — i.e. "≈45% smaller," matching the reported bug exactly.** That is the single most-likely cause and the first thing to fix.

**Absolute car width/centre on Home/PARKED (derivation + caveat):** the on-screen **centre** is directly given by the handler: `center_y = top_margin + screen_height/2·scale`, `center_x = left_margin + width/2`. At Home on a 393×852-pt / `statusBarHeight=59` phone: `center_x = 393/2 = 196.5 pt`; with `scale = 355/852 = 0.4167`, `center_y = (59+60) + 852/2·0.4167 = 119 + 177.5 = 296.5 pt`. The **absolute car width in points** requires projecting the Model Y's 3D bounds (≈ 4.75 m L × 1.92 m W × 1.62 m H) through the 3/4-view pose (`pivot=[68.6,-138,0]`, `d≈6.7`, KEEP_HEIGHT vfov 40) and multiplying by `root_node.scale·vehicle_scale ≈ 0.46` — this is **not reliably derivable statically** (it needs the actual 3D projection of the angled body). **Recommended calibration:** fix `keep_aspect=KEEP_HEIGHT` and render at the byte-identical PARKED pose + Home frame; if the car still mismatches, the residual is the `height/screen_height` **units** (§2) — measure one screenshot and solve `heightFrac` empirically. The centre coordinates above are exact.

## §5. Citations
- Frame handler: `res://mobile/scripts/MainViewContainer.gd` (decompiled → `appendix/MainViewContainer.decompiled.gd`); scene node `mobile.tscn` `MainViewContainer` (ViewportContainer, stretch, anchors).
- Camera: `res://mobile/scripts/CameraManager.gd` (`appendix/CameraManager.decompiled.gd`); `mobile.tscn` Camera node (`fov=40.0, far=150.0, current=true`, no `keep_aspect`).
- Scene graph / viewport: `mobile.tscn` (verbatim in appendix) — Viewport `own_world`, `size_override_stretch`, `size=790×875`; `root`/`CameraManager` sibling layout.
- Car scale: `Vehicle.gd` `get_vehicle_scale()` (default 1.1); ground shadow `ground_shadow` MeshInstance + `Ground_Plane[_mobile]` swap.
- Units: `project.binary` — no `display/window/stretch/mode` (stretch disabled → root viewport = device pixels); `AppConfigManager.gd` `pixel_ratio` comes from `APP_CONFIG.pixelRatio` and is **not** used by the frame handler.
- Decompiler validation: `ScreenOverlay.gd` / `EnvironmentManager.gd` decompiled outputs match R4/R5's independently-derived behaviour.

## §6. Gaps
- **Exact ground-shadow plane metres** per model (inside each vehicle `.tscn`, e.g. `Model_Y.tscn`'s `ground_shadow` transform) — not parsed this round. Needed only to match the shadow footprint, not the car size.
- **Absolute car width in points** — not statically derivable (requires 3D projection of the angled car); the centre is exact, the size lever (keep_aspect) is identified.
- `size_override_stretch=true` + `size=790×875` interaction with the 3D camera aspect: I treat the 3D aspect as the screen aspect (from `ViewportContainer.stretch`); the 790×875 override governs the 2D canvas. If Tesla's camera aspect were instead locked to 790/875 ≈ 0.903, the KEEP_WIDTH math would differ — **verify on-device** which aspect the camera uses. (Either way, matching Tesla means `keep_aspect=KEEP_HEIGHT` + the same viewport config.)
- The `.gdc` decompiler reconstructs faithful GDScript but is token-level (booleans print `True/None`, floats as Python reprs); the control flow/maths are exact.

## §7. Fix checklist (so your car matches)
1. **Camera `keep_aspect = KEEP_HEIGHT`** (drop your `keep_aspect:'WIDTH'` key); apply `cam_fov` as `Camera.fov` (vertical). This alone should undo the ≈45% shrink on portrait.
2. **Camera is a sibling of `root_node`**, not a child; rig = `CameraPivot`(rotation) → `Camera`(translation=offset, local rot `(-90,0,0)`, fov=cam_fov), `far=150`.
3. **Frame handler:** keep `root_node.scale = ONE*(height/screen_height)` + the `rect_position` centring — **do the ratio unit-free** (no stray `× pixel_ratio` unless it also multiplies `screen_height`); ensure `get_viewport().size` and the incoming `height` are in the **same units** (device pixels).
4. **Viewport:** `own_world`, full-screen via `ViewportContainer.stretch=true`; camera aspect = screen aspect.
5. **Car:** `vehicle_scale` (default 1.1) at Slot; `root_node.scale` multiplies on top.
