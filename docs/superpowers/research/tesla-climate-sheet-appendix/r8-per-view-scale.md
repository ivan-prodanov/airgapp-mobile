# R8 §2 — Does ANYTHING scale the car on the CLIMATE path specifically?

**Answer: NO. Nothing.** Verified exhaustively on both the Godot side (all 67 `.gdc` decompiled from
`split_assets_pack.apk` v4.58) and the JS side (iOS v4.56 `main.decompiled.js`).

Details, then the two real corrections this round produced, then the optical hypothesis.

---

## Method / provenance

- Extracted **every** `.gdc` under `assets/godot/` from
  `/Users/ivan/Downloads/com.teslamotors.tesla_4.58.0-.../split_assets_pack.apk` (67 files) and
  decompiled all of them with the R6 appendix decompiler
  (`.../tesla-renderer-frame-appendix/gdc_decomp.py`). Output kept in
  `<scratchpad>/gd/`, raw extraction in `<scratchpad>/gdc/`.
  This is a **superset** of the R6 appendix, which only had 5 hand-picked `.gd` files — R6 never
  saw `ProductSwitcher.gd` or `data/ProductManager.gd`, which is why it got the scale chain wrong
  (see §"Corrections" below).
- Scene graph read from `.../tesla-renderer-frame-appendix/mobile.tscn`.
- JS read with `grep -n` + `sed -n` on `/Users/ivan/Downloads/tesla-haptics-work/main.decompiled.js`.
- Android cross-check on `/Users/ivan/Work/tesla-summon/work/bundle.hasm`.

---

## Q1 — Per-view vehicle_scale / Slot / ProductSwitcher / root transform?

### **NO.** There is no per-view, per-camera-position, or per-screen scale anywhere.

**`on_move_camera` does not touch scale.** [Android-only source, ships to iOS identically — same .pck]
Verbatim, `<scratchpad>/gd/mobile_scripts_CameraManager.gd:44-69` — the *entire* body:

```gdscript
func on_move_camera(data: Dictionary):
	var rotation = Utils.vec3_from_data(data.get('rotation',[0, 0, 0]), Vector3.ZERO)
	var offset = Utils.vec3_from_data(data.get('offset',[0, 0, 0]), Vector3.ZERO)
	var cam_fov = data.get('cam_fov')
	var animated = data.get('animated', True)
	var duration = data.get('duration', DEFAULT_ANIMATION_DURATION)
	var transition_type = data.get('transition_type', DEFAULT_ANIMATION_TRANSITION)
	var ease_type = data.get('ease_type', DEFAULT_ANIMATION_EASE)
	var animation_id = data.get('animation_id')

	camera.rotation_degrees = Vector3(- 90, 0, 0)

	if animated:
		tween.interpolate_property(pivot, 'rotation_degrees', None, rotation, duration, transition_type, ease_type)
		tween.interpolate_property(camera, 'translation', None, offset, duration, transition_type, ease_type)
		if cam_fov != None: tween.interpolate_property(camera, 'fov', None, cam_fov, duration, transition_type, ease_type)
		current_animation_id = animation_id
		tween.start()
	else:
		current_animation_id = None
		tween.remove_all()
		pivot.rotation_degrees = rotation
		camera.translation = offset
		if cam_fov != None: camera.fov = cam_fov
```

It touches **only** `pivot.rotation_degrees`, `camera.translation`, `camera.fov`. Not `root`, not
`Slot`, not `ProductSwitcher`, not the vehicle node. The `MOVE_CAMERA` message has **no scale
field at all** (see the sender in Q3).

`CameraManager` does have a per-product hook, but it only tunes **parallax**, not scale
(`CameraManager.gd:34-42`): `update_parallax_for_product` sets `parallax_reduction` /
`parallax_angular_limit` / `parallax_return_speed`. Vehicle → `1000 / 4 / 100`. No scale.

### Exhaustive enumeration of every `scale` **write** in the whole Godot project

`grep -rn "scale" <scratchpad>/gd/` over all 67 decompiled scripts. Complete list of writes
(excluding `font_scale`/`pixel_ratio`/`scale_framebuffer_on_background`, which are unrelated):

| # | Site | What | Keyed on |
|---|---|---|---|
| 1 | `MainViewContainer.gd:44,62,68` | `root_node.scale = Vector3.ONE * (height / screen_height)` | the **frame** (`UPDATE_MAIN_VIEW_FRAME`) — the known lever |
| 2 | `ProductSwitcher.gd:39` | `slot.scale = product_manager.get_product_scale(product_data)` | **`product_data.vehicle_config.car_type`** — NOT the view |
| 3 | `Snapshots.gd:237` | `vehicle.scale = product_manager.get_product_scale(vehicle_data)` | snapshot-only offscreen path (`TAKE_SNAPSHOTS`), unreachable from Climate |
| 4 | `Snapshots.gd:284` | `vehicle.scale = Vector3.ONE` | snapshot-only teardown |
| 5 | `VehicleManager.gd:223` | `terrain.scale.y = 1.5` | the Terrain child node, only when `show_terrain` — **Climate sends `show_terrain: false`** |
| 6 | `Ego/Cybertruck/script/Marker.gd:20,25-26,34-35` | `marker_sprite.scale.y` | Cybertruck marker sprite (a UI billboard), not the car body |

That is the complete set. **None of #1–#6 is per-camera-position or per-screen.** #2 is the only
per-product one and it is set exactly once, inside `show_product()`, at product-swap time — it is
identical on Home, Controls and Climate.

### Scene graph — the full scale chain

`mobile.tscn`:
```
MainViewContainer (ViewportContainer, anchor_right=1.0, anchor_bottom=1.0, stretch = true)
└─ Viewport (size_override_stretch = true, own_world = true, transparent_bg = true, msaa = 2)
   ├─ WorldEnvironment
   ├─ root                              (Spatial — NO transform line ⇒ identity)
   │  └─ ProductSwitcher                (Spatial — NO transform line ⇒ identity)
   │     └─ Slot                        (Spatial — NO transform line ⇒ identity at load)
   │        └─ <vehicle instance>       (added by ProductSwitcher.show_product)
   └─ CameraManager                     (SIBLING of root — confirms R7)
      └─ CameraPivot
         └─ Camera  transform = Transform( 1,0,0, 0,1,0, 0,0,1, 0, 13, 0 )   # translation (0,13,0)
            fov = 40.0
```
`root`, `ProductSwitcher` and `Slot` carry **no `transform =` line** ⇒ identity (scale 1,1,1) at
scene load. So the **complete** chain is:

> **car net scale = `root.scale` (frame) × 1 (ProductSwitcher) × `Slot.scale` (per car_type) × 1 (vehicle instance)**

`root.scale` is **uniform** — `Vector3.ONE * (height/screen_height)` — X, Y and Z scale together.
There is **no axis-independent (horizontal-only) scale lever anywhere in the project.** This alone
rules out any code-side explanation for a purely-horizontal "mirrors inward" symptom.

### Dead ends closed (write-only / unconnected — do NOT chase these)

- `MainViewContainer.container_offset` and `container_size` (lines 22-23, 52-53): **written, never
  read.** No other script references them. Dead.
- `MainViewContainer.scroll_fraction_change` signal (line 15, emitted line 58): **no `connect()`
  anywhere in any of the 67 scripts, and no `[connection signal="scroll_fraction_change" ...]` in
  `mobile.tscn`.** Dead signal.
- `MainViewContainer._process` (lines 70-86): guarded by `if not OS.has_feature('editor') or
  Engine.editor_hint: return` — **editor-only**, never runs on device.
- `MainViewContainer.rect_size` is **never assigned** — the node keeps `anchor_right/bottom = 1.0`
  ⇒ always full-screen. Only `rect_position` moves. With `stretch = true`, the Viewport size
  therefore stays the **full screen** on every screen. ⇒ **camera aspect = screen aspect,
  invariant across Home/Controls/Climate.** (Confirms R7's `keep_aspect` reasoning; nothing
  screen-specific here.)

---

## Q2 — Extra renderer messages on Climate? (incl. `fadeRoof`)

### Complete, ordered enumeration of EVERY renderer message the Climate screen sends

Exhaustive `awk` over iOS lines 5218000–5232000 for every GodotModule method name. Complete hit
list — there are no others:

```
5222016    r7 = r8.updateMainViewFrame;
5222046    r2 = r4.forceCloseAllClosures;
5222050    r1 = r2.fadeRoof;
5222057    r1 = r2.showFXAbove;          (inside a setTimeout callback)
5222082    r2 = r3.setScreenOverlayColor;
5226327    r3 = r4.updateProduct;
5226340    r5 = {'is_loading': false, 'show_terrain': false};
5226341    r2['mobile_app_state'] = r5;
5226346    r3 = r4.moveCameraWithCompletion;
5226362    r2 = r3.getVehicleMarkers;
5226410    r3 = r3.getVehicleMarkersFallback;
```

**Ordered by effect:**

**A. `useEffect` fn #120832 (iOS 5222005-5222067)** — guarded by `if (!_closure2_slot29) return;`
   `_closure2_slot2` = the vehicle id. Verbatim tail (iOS 5222044-5222064):
```
5222044    r2 = r15[r7](r14, r13, r12, r11, r10);   // updateMainViewFrame(top, left, width, height, ...)
5222045    r4 = r1.default;
5222046    r2 = r4.forceCloseAllClosures;
5222047    r3 = _closure2_slot2;
5222048    r2 = r2.bind(r4)(r3);                    // forceCloseAllClosures(vehicleId)
5222049    r2 = r1.default;
5222050    r1 = r2.fadeRoof;
5222051    r1 = r1.bind(r2)(r3);                    // fadeRoof(vehicleId)
5222052    r1 = global;
5222053    r3 = r1.setTimeout;
5222054    r2 = function() { ... r1 = r2.showFXAbove; r0 = _closure2_slot2; r0 = r1.bind(r2)(r0); ... };
5222063    r1 = 150;
5222064    r1 = r3.bind(r0)(r2, r1);                // setTimeout(() => showFXAbove(vehicleId), 150)
```
   1. `updateMainViewFrame(...)` — the R7 frame formula (`320` inline at 5222037, `80` at 5222043).
   2. **`forceCloseAllClosures(vehicleId)`** — 1 arg.
   3. **`fadeRoof(vehicleId)`** — 1 arg.
   4. `setTimeout(150ms)` → **`showFXAbove(vehicleId)`** — 1 arg.

**B. `useFocusEffect` fn #120834 (iOS 5222077-5222094)**
   `setScreenOverlayColor(_closure2_slot30, _closure2_slot13 ? 0.5 : 0)`.

**C. fn #120893 (iOS ~5226320-5226346), on product-id change** — guarded `if (_closure2_slot0 == null) skip`:
   5. `updateProduct({id, type: ProductType.VEHICLE, mobile_app_state: {is_loading: false, show_terrain: false}})`
      — literal at 5226340 verbatim: `{'is_loading': false, 'show_terrain': false}`.
   6. `moveCameraWithCompletion({position: CameraPosition.CLIMATE, carType: _closure2_slot1, completion})`
      — completion → `getVehicleMarkers(vehicleId, …)`, falling back to `getVehicleMarkersFallback`.

**No seat/interior mode. No cutaway. No `showProduct`. No `setEnvParams` beyond what `moveCamera`
itself emits. No `setAppTheme`. No `takeSnapshots`. Nothing else.**

### `fadeRoof` — YES, there is an official equivalent, and the team is right to send it

**The team sending `fadeRoof: true` on Climate matches Tesla exactly.** This also corrects R7's
implication that `forceCloseAllClosures`/`fadeRoof`/`showFXAbove` were Service-carousel-only —
**Climate calls all three.**

**Exact message.** JS sender, `// Original name: fadeRoof` at iOS **1173550**, signature
`fadeRoof(vehicleId, fade = true, animated = true, duration = defaultCameraAnimationDuration * 0.5)`.
Verbatim payload construction (iOS 1173605-1173614):
```
r2 = r1.FADE_ROOF;
r1 = {};
r1['vehicle_id'] = r8;
r1['fade']       = r7;
r1['animated']   = r6;
r1['duration']   = r5;
```
`defaultCameraAnimationDuration = 0.5` (verbatim literal, iOS 1174108-1174109:
`r16 = 0.5; r1['defaultCameraAnimationDuration'] = r16;`). Climate passes **only** `vehicleId`, so
all three defaults apply.

> **Climate's exact FADE_ROOF message:**
> ```json
> { "type": "FADE_ROOF",
>   "data": { "vehicle_id": <id>, "fade": true, "animated": true, "duration": 0.25 } }
> ```
> `duration = 0.5 * 0.5 = 0.25` — **resolved to a number.**

**Does it affect SCALE? No — roof opacity ONLY.** Godot receiver, verbatim
`<scratchpad>/gd/mobile_scripts_VehicleManager.gd:45-51`:
```gdscript
func on_fade_roof(data: Dictionary):
	var vehicle: Vehicle = vehicle_for_data(data)
	if vehicle == None: return
	var fade: bool = data.get('fade', True)
	var animated: bool = data.get('animated', True)
	var duration: float = data.get('duration', 0.75)
	vehicle.set_fade_roof(fade, animated, duration)
```
and `<scratchpad>/gd/mobile_scripts_Vehicles_Vehicle.gd:769-789`:
```gdscript
func set_fade_roof(fade: bool = True, animated: bool = True, duration: float = 0.75):
	fade_roof = fade
	for mat in roof_fade_materials:
		var alpha = 0 if fade else original_material_alpha[mat]
		if mat is SpatialMaterial:
			if animated:
				tween.interpolate_property(mat, 'albedo_color:a', None, alpha, duration, Tween.TRANS_QUART, Tween.EASE_IN_OUT)
			else:
				tween.stop(mat, 'albedo_color:a'); mat.albedo_color.a = alpha
		elif mat is ShaderMaterial:
			if animated:
				tween.interpolate_property(mat, 'shader_param/color:a', None, alpha, duration, Tween.TRANS_QUART, Tween.EASE_IN_OUT)
			else:
				tween.stop(mat, 'shader_param/color:a')
				var color = mat.get_shader_param('color'); color.a = alpha
				mat.set_shader_param('color', color)
		on_roof_fade_applied(mat, fade, animated, duration)
	if tween != None: tween.start()
```
Purely `albedo_color:a` / `shader_param/color:a` on the materials in `roof_fade_materials`. **No
geometry, no transform, no scale, no mesh visibility.** `on_roof_fade_applied` is `pass` on the
base `Vehicle` (line 766-767; per-model subclasses may override for extras — none touch scale).

### The other two Climate messages, fully resolved

**`forceCloseAllClosures`** — JS `// Original name: forceCloseAllClosures` at iOS **1173484**,
signature `(vehicleId, force_close = true, animated = true, speed = 4)`. Payload verbatim
(iOS 1173538-1173542): `r1['vehicle_id']=r8; r1['force_close']=r7; r1['animated']=r6; r1['speed']=r5;`
Climate passes only `vehicleId`:
> `{ "type": "FORCE_CLOSE_ALL_CLOSURES", "data": { "vehicle_id": <id>, "force_close": true, "animated": true, "speed": 4 } }`

Receiver `VehicleManager.gd:53-59` → `vehicle.set_force_doors_closed(force_close, animated, speed)`.
Closure animation only. No scale.

**`showFXAbove`** — JS `// Original name: showFXAbove` at iOS **1173618**, signature
`(vehicleId, show = true)`. Payload verbatim (iOS 1173657-1173659):
`r1['vehicle_id']=r6; r1['show']=r5;` Climate passes only `vehicleId` ⇒ **`show: true`**.
> `{ "type": "SHOW_FX_ABOVE", "data": { "vehicle_id": <id>, "show": true } }`, sent **150 ms after mount**.

⚠️ Note vs R7: the Service carousel sends `showFXAbove(id, **false**)`; **Climate sends `true`**
(by omission). Opposite values. Worth checking the team's build sends `true`.

---

## Q3 — Is `cam_fov 40` on CLIMATE ever overridden at runtime for a Model 3/Y?

### **NO. Never. `cam_fov` on CLIMATE is a hard 40 for Model 3 and Model Y, on every device.**

This is now **proven by construction**, not by absence-of-evidence. `moveCamera`
(`// Original name: moveCamera`, iOS **1172931**) resolves the pose as exactly this and nothing else
(iOS 1169166-1169291, transcribed from the verbatim register ops at 1169227-1169254 + 1173015-1173033):

```js
// r9 = position, r3 = carType (defaults to CarType.CARTYPEMODEL3 when undefined, iOS 5222126-5222133)
r16 = BASE_POSES[position];                       // _closure1_slot22
if (r16 == null) { log('[GODOT MODULE]: Invalid camera position: ', position); return; }
r13 = PER_CARTYPE_OVERRIDES[carType];             // _closure1_slot23
r15 = (r13 == null) ? undefined : r13[position];
if (r15 == null) r15 = {};
r15 = Object.assign({}, r16, r15);                // merged pose
sendMessage(MOVE_CAMERA, {
    rotation:      r15.rotation,
    offset:        r15.offset,
    cam_fov:       r15.cam_fov,
    animated: r7, duration: r6, transition_type: r5, ease_type: r4, animation_id: uuid.v4()
});
```

**Note there is no `scale` key in `MOVE_CAMERA` — the message cannot carry one.** Matches
`CameraManager.on_move_camera`, which reads only `rotation` / `offset` / `cam_fov`.

**The base CLIMATE pose** — verbatim, iOS 1169522-1169529 (a real JS object literal):
```js
r5 = {'rotation': null, 'offset': null, 'envRotation': null, 'envEnergy': 4, 'ambEnergy': 4, 'cam_fov': 40, 'rotateSkyBox': false};
r10 = [0, 0, 0];      r5['rotation'] = r10;
r10 = [0, 6, 0.6];    r5['offset'] = r10;
r10 = [0, 40, 0];     r5['envRotation'] = r10;
r1['CLIMATE'] = r5;
```
⇒ **Exactly R7's pose. Re-verified independently. R7 is correct.**

### **The per-carType override table has exactly TWO keys — and neither is Model 3 or Model Y.**

`_closure1_slot23` is built from precisely two `_defineProperty` calls:
- iOS **1169597**: `r17 = r1.CARTYPESEMITRUCK;` … iOS **1169660**: `r17 = r23.bind(r0)(r1, r17, r5);`
- iOS **1169664**: `r5 = r1.CARTYPECYBERTRUCK;` … iOS **1169731**: `r1 = r24.bind(r0)(r17, r5, r1);`
- iOS **1169732**: `var _closure1_slot23 = r1;`

`grep` for `CARTYPE` across the whole builder range 1169560-1169735 returns **only those two lines
(1169597, 1169664)**. There are no other keys.

> ⇒ For `carType ∈ {CARTYPEMODEL3, CARTYPEMODELY, CARTYPEMODELS, CARTYPEMODELX, …}`,
> `PER_CARTYPE_OVERRIDES[carType]` is **`undefined`** ⇒ `r15 = {}` ⇒
> **`pose = Object.assign({}, BASE_POSES.CLIMATE, {})` = the base pose, byte-for-byte.**

And for completeness, even the two overrides that *do* exist **do not contain `cam_fov`**:
- Semitruck CLIMATE (iOS 1169623-1169632): `{offset: [0,7,-0.5], envRotation: [0,90,70], envEnergy: <r27>, ambEnergy: 3.7}` — no `cam_fov`.
- Cybertruck CLIMATE (iOS 1169719-1169730): `{offset: [0,5.5,<r31>], envRotation: [<r21>,<r30>,<r30>], envEnergy: <r10>, ambEnergy: <r28>}` — no `cam_fov`.

**No seat-count branch. No interior variant. No Climate sub-view.** The Climate screen calls
`moveCameraWithCompletion` exactly **once** (iOS 5226346) and never with an fov argument —
`moveCamera`'s options object has no `cam_fov` parameter to begin with.

### The viewport-scaled fov is Service-only — re-verified, R7 was right

`ScaledSmallVehicleCamFov` lives in a **different module** whose export list is entirely
Service-scoped (verbatim, iOS 7712792-7712796):
```js
r2['ScaledSmallVehicleCamFov'] = r0;
r2['ScaledTopPadding'] = r0;
r2['ServiceDefaultCamera'] = r0;
r2['getServiceCameraSettingsByCarType'] = r0;
r2['getServiceCarouselCameraPosition'] = r0;
```
Its value (iOS 7712800-7712828): `interpolate(SCREEN_HEIGHT, [DeviceSizeClass.IPHONE_4_INCH_LIKE.height,
DeviceSizeClass.IPHONE_12_INCH_LIKE.height], [80, 70], Extrapolation.CLAMP)` — confirming R7's
`[568, 926] → [80, 70]` CLAMP.

Its only consumer is `getServiceCarouselCameraPosition` (iOS 7708931-7708959), which builds
`{rotation: [82.5, -138, 0], cam_fov: ScaledSmallVehicleCamFov, offset: [-0.7, <serviceSettings.offset[1]>, 0.4]}`
on top of `getServiceCameraSettingsByCarType(carType)`, and pushes it through a **separate**
`moveCamera` wrapper at iOS **7713742** (distinct from the Climate/global one at 1172931).

**Climate never touches this module.** Climate goes through the global GodotModule
(`_closure1_slot6` → `moveCameraWithCompletion` at iOS 1173810 → `moveCamera` at 1172931), whose
`cam_fov` can only ever come from `_closure1_slot22`/`_closure1_slot23`.

> **Service remains the ONLY viewport-dependent fov in the app. Confirmed.**

---

## Q4 — Plain answer

> **Nothing scales the car on the Climate path.**
>
> There is **no per-view, per-camera-position, per-screen, or per-Climate scale** anywhere — not in
> GDScript (all 67 scripts decompiled and grepped), not in the scene graph (`root`, `ProductSwitcher`
> and `Slot` are all identity at load), not in any renderer message (`MOVE_CAMERA` has no scale
> field; `FADE_ROOF` is material alpha only; `FORCE_CLOSE_ALL_CLOSURES` is closure animation only;
> `SHOW_FX_ABOVE` is an FX toggle only), and not in the JS (Climate's `cam_fov` is a hard 40 that no
> code path can override for a Model 3/Y).
>
> **`root_node.scale = Vector3.ONE * (height / screen_height)` from `UPDATE_MAIN_VIEW_FRAME` is the
> only zoom lever that runs on the Climate path, and it is uniform** (X = Y = Z). Since the team's
> frame, pose, `keep_aspect` and env are byte-identical to Tesla's, **the rendered car is
> pixel-identical. Stop hunting a scale bug. Fix the sheet.**
>
> Corollary worth stating outright: **there is no axis-independent scale anywhere in the renderer.**
> A *purely horizontal* symptom ("mirrors inward") **cannot be produced by any code in this app.**
> That symptom is either an optical artifact (see below) or a measurement artifact.

---

## ⚠️ Two corrections to R6 that fell out of this round (per-PRODUCT, not per-view — read anyway)

These do **not** explain a Climate-only difference (they apply equally to Home/Controls, which the
team confirmed pixel-exact). But R6 stated the scale chain wrongly and the team may have hardcoded
from it.

### 1. `Vehicle.get_vehicle_scale()` is DEAD CODE. R6's "× vehicle_scale (default 1.1)" is WRONG.

`<scratchpad>/gd/mobile_scripts_Vehicles_Vehicle.gd:66` and `:336-337`, verbatim:
```gdscript
export(float, 0, 2) var vehicle_scale = 0
...
func get_vehicle_scale():
	return(vehicle_scale if vehicle_scale > 0.0 else 1.1) ;
```
`grep -rn "get_vehicle_scale" <scratchpad>/gd/` over **all 67 decompiled scripts** returns **only
those two lines — the definition. There are zero call sites.** React cannot call it either (the JS
bridge can only send the 20 `ReactMsg` enum types; there is no eval/RPC path).

Likewise `vehicle_scale` (the export) is read only by `get_vehicle_scale()` itself, and is set in
exactly one scene in the entire project — `Ego/Cybertruck/Cybertruck.tscn:507: vehicle_scale = 1.0`
— which is never read. **The `1.1` default never multiplies anything on any screen.**

> **If the team is applying × 1.1 anywhere, delete it.**

### 2. The real per-product scale is `Slot.scale`, from a table R6 never saw — and it is per-`car_type`

`<scratchpad>/gd/mobile_scripts_ProductSwitcher.gd:39` (inside `show_product`, at product-swap time):
```gdscript
slot.scale = product_manager.get_product_scale(product_data)
```
`<scratchpad>/gd/mobile_scripts_data_ProductManager.gd:111-113`:
```gdscript
func get_product_scale(product_data: ProductData):
	if product_data is VehicleData == False: return Vector3.ONE
	return vehicle_scale.get(product_data.vehicle_config.car_type, Vector3.ONE)
```
and the table itself — **verbatim**, `mobile_scripts_data_ProductManager.gd:16-28`:
```gdscript
const vehicle_scale = {
	'model3': Vector3.ONE,
	'models': Vector3.ONE * 0.945,
	'models2': Vector3.ONE * 0.945,
	'lychee': Vector3.ONE * 0.945,
	'modelx': Vector3.ONE * 0.93,
	'tamarind': Vector3.ONE * 0.93,
	'modely': Vector3.ONE * 0.987,
	'semitruck': Vector3.ONE * 0.627,
	'cybertruck': Vector3.ONE * 0.875,
	'cybercab': Vector3.ONE,
	'unknown': Vector3.ONE * 0.987,
}
```
Resolved to numbers: **model3 = 1.000 · models/models2/lychee = 0.945 · modelx/tamarind = 0.930 ·
modely = 0.987 · semitruck = 0.627 · cybertruck = 0.875 · cybercab = 1.000 · unknown = 0.987 ·
default (unlisted car_type) = 1.000.**

Keyed on `product_data.vehicle_config.car_type` — the **same GetVehicleConfig `car_type` field**
already noted in memory as the pack-kWh key. Note `Vector3.ONE` for an unlisted `car_type`, but
`0.987` for the literal string `'unknown'`.

> **Corrected scale chain (the whole truth):**
> **`car net scale = (height / screen_height) × vehicle_scale[car_type]`**
> **Climate on 393×852/59: `(553 / 852) × vehicle_scale[car_type]` = `0.64906 × vehicle_scale[car_type]`.**
> ⇒ **Model 3: 0.64906 · Model Y: 0.64062.**

**Relevance to the symptom — a real candidate the team should rule out in 5 minutes.** Model 3 vs
Model Y differ by **1.3 %** (1.000 vs 0.987) — squarely inside the user's reported "~2-3 % smaller,
uniformly". If the team hardcoded `1.0` while their test car is a `modely`, their car is **1.3 %
larger** than Tesla's; the reverse if they hardcoded `0.987` on a `model3`. **But this is
per-product, so it would shift Home and Controls by the identical 1.3 % too** — and the team says
those are pixel-exact. So it is *probably* already right. **Verify it anyway** (it is cheap, and it
is the only remaining number in the chain that R6 got wrong).

---

## BONUS — the most likely OPTICAL explanation (HYPOTHESIS, not established)

**Flagging clearly: this is a hypothesis. It is not statically provable from the bundle, because the
bundle contains no evidence about what the two builds look like side by side. Everything below is
reasoning from the confirmed geometry.**

### The confirmed geometry

On 393×852, statusBarHeight 59, with R7's frame (`height = 852 − 59 − 320 + 80 = 553`):

| | Tesla | Team |
|---|---|---|
| Godot band (`rect_position` + `root.scale`) | top **59**, height **553** ⇒ spans y **59 … 612** | identical (same formula) |
| `root.scale` | 553/852 = **0.6491** | identical |
| Car center_y | 59 + 553/2 = **335.5** | identical |
| Sheet height | **320** | **213** |
| Sheet top = 852 − sheetHeight | **532** | **639** |
| Band pixels hidden behind the sheet | 612 − 532 = **80 px** (14.5 % of the band) | **0 px** — and a **27 px gap** of bare band below the car band's bottom edge |

### The "+80" is the smoking gun for sheet = 320

The frame formula subtracts the sheet height (320) and then **adds 80 back**. That +80 is *exactly*
the band/sheet overlap: **band bottom (612) = sheet top (532) + 80**. Tesla deliberately renders the
car band **80 px behind the opaque sheet**, so the car's bottom edge is tucked under the sheet with
no seam. That is a coherent, deliberate design — and it only works if the sheet really is 320. It
strongly corroborates §1's snapPoint conclusion, from a completely independent direction.

**On the team's build the +80 is meaningless**: with the sheet at 639, the band bottom (612) never
reaches it. The 80 px that Tesla hides is fully visible, *plus* a 27 px gap.

### Why "smaller" and "more hood" follow

The car pixels are **identical** — same scale, same center_y (335.5), same fov, same everything.
What differs is **107 px of occlusion** (532 vs 639).

1. **"ours shows more hood" — this one is literal and expected.** The camera looks straight down
   (pivot rot [0,0,0], camera local rot (−90,0,0)). The car's long axis maps to screen-Y. Tesla hides
   the bottom 80 px of it under the sheet; the team hides none. **The team genuinely shows ~80 px
   more car at the bottom.** No hypothesis needed — that's arithmetic. It is exactly what a
   107-px-shorter sheet produces, and it is the single most direct confirmation that the sheet is
   the whole bug.

2. **"~2-3 % smaller / mirrors inward" — most likely a framing illusion.** Two mechanisms, both
   well-documented perceptual effects, and both predicted by the numbers above:
   - **Fraction-of-visible-area.** Tesla's visible car band is y 59…532 = **473 px**; the team's is
     y 59…639 = **580 px** (including the gap). The *same* car occupies **473/580 = 81.6 %** as much
     of the visible region in the team's build. Against a taller frame with 107 px more empty space
     below it, the car reads as **smaller and more inset** — even though it is pixel-identical.
     Ebbinghaus/frame-of-reference: apparent size is judged relative to the enclosing frame, not in
     absolute pixels.
   - **Broken bottom anchor.** Tesla's car **bleeds into the sheet** — its bottom edge is cropped, so
     the eye reads it as extending past the frame and extrapolates it *larger*. The team's car
     terminates in mid-air with a visible margin all round, so it reads as a **complete, contained
     object** — which reads *smaller*. Cropping an object at a frame edge is a standard way to make
     it read as bigger; removing the crop reverses it.

   The **"mirrors inward, horizontally"** phrasing is the part that is hard to reconcile — and it is
   the reason to be explicit that this is a hypothesis. But note: **no code can move the mirrors
   horizontally without moving everything horizontally by the same uniform factor** (`root.scale` is
   `Vector3.ONE * k`; `Slot.scale` is `Vector3.ONE * k`; `MOVE_CAMERA` has no scale field; there is no
   anisotropic scale anywhere in the project). And `position_x` is provably **0** on all three
   screens: `center_x = left_margin + (screen_width/2 · width/screen_width) = 0 + 393/2 = 196.5`;
   `position_x = 196.5 − 393/2 = 0`. **So a horizontal-only discrepancy is not producible by this
   renderer.** Given a uniform-scale illusion of ~2-3 %, the mirrors (the widest points of the car,
   sitting near the front on a top-down view) are precisely where a small uniform size difference is
   *most legible* to the eye — they are the silhouette's extrema. **"Mirrors inward" is the expected
   verbal description of a uniform ~2 % apparent-size illusion, reported at the landmark where it is
   easiest to see.**

### The falsifiable prediction

**If the team changes their sheet from 213 → 320 and changes nothing else, the Climate car will
match Tesla exactly.** If it still doesn't, the illusion hypothesis is wrong and the difference is
real — in which case measure the car's **rendered width in px at the mirrors** in both builds. The
prediction is that it is **already identical to the pixel today**, before any change, and that only
the *visible fraction* differs. That measurement decides it in one screenshot and costs nothing.
