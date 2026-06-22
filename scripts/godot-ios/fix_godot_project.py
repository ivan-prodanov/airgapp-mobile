#!/usr/bin/env python3
"""
Patch a fresh (gdre-recovered) Tesla Godot project so it runs on iOS.

Run this on every new export from Windows/Codex before exporting the .pck. It is IDEMPOTENT — safe
to re-run on an already-patched project (each step skips itself if already applied).

Why each fix exists:
  1. Textures — gdre's compiled-texture cache (.import/*.stex) is corrupt AND incomplete (identical
     174796-byte placeholders / missing files), and Godot's importer SEGFAULTS on this project on
     macOS, so it can never regenerate them. We hand-write LOSSLESS StreamTextures directly from the
     (valid) source PNGs. Handles both VRAM-mode imports (converts them) and lossless imports whose
     .stex is missing. NOTE: lossless = large .pck; the real size fix is PVRTC (needs PVRTexToolCLI
     in the Godot toolchain) — deferred.
  2. MobileComm.gd — bind the native IOSGodotInterface singleton on iOS so the RN app drives the
     car, instead of defaulting to the on-device LocalDevMessageInjector harness.
  3. CameraManager.gd — keep horizontal FOV on a tall (portrait) viewport so the wide car fits the
     screen width (Godot's default vertical FOV over-zooms on tall aspects).
  4. LocalDevMessageInjector.gd — drop the undeclared `web_export_dynamic_scenes` reference that
     parse-errors the whole script (only matters if the harness ever loads, but keep it clean).

Usage:  fix_godot_project.py <godot-project-dir>
"""
import glob
import os
import re
import struct
import sys


# ── 1. textures ───────────────────────────────────────────────────────────────────────────────
def _png_dims(data: bytes):
    if data[:8] != b"\x89PNG\r\n\x1a\n":
        raise ValueError("not a PNG")
    return struct.unpack(">I", data[16:20])[0], struct.unpack(">I", data[20:24])[0]


def _write_lossless_stex(path: str, w: int, h: int, png: bytes):
    # Godot 3.2 StreamTexture, COMPRESS_LOSSLESS, single mip. Format from
    # editor/import/resource_importer_texture.cpp::_save_stex + scene/resources/texture.cpp::_load_data.
    payload = b"PNG " + png
    with open(path, "wb") as f:
        f.write(b"GDST")
        f.write(struct.pack("<HHHH", w & 0xFFFF, 0, h & 0xFFFF, 0))
        f.write(struct.pack("<I", 2 | 4))      # texture flags: REPEAT | FILTER
        f.write(struct.pack("<I", 1 << 20))    # data format: FORMAT_BIT_LOSSLESS
        f.write(struct.pack("<I", 1))          # mipmap count
        f.write(struct.pack("<I", len(payload)))
        f.write(payload)


_LOSSLESS_IMPORT = """[remap]

importer="texture"
type="StreamTexture"
path="res://.import/{base}.stex"

[deps]

source_file="{src}"
dest_files=[ "res://.import/{base}.stex" ]

[params]

compress/mode=0
compress/lossy_quality=0.7
compress/hdr_mode=0
compress/bptc_ldr=0
compress/normal_map=0
flags/repeat=true
flags/filter=true
flags/mipmaps=false
flags/anisotropic=false
flags/srgb=2
process/fix_alpha_border=true
process/premult_alpha=false
process/HDR_as_SRGB=false
process/invert_color=false
stream=false
size_limit=0
detect_3d=false
svg/scale=1.0
"""


# gdre left many compiled textures as identical 174796-byte placeholders (corrupt/empty). Treat a
# .stex of exactly this size as missing so it gets regenerated from source.
_PLACEHOLDER_STEX_SIZE = 174796


def ensure_lossless_textures(project: str):
    import_dir = os.path.join(project, ".import")
    gen = converted = ok = bad = 0
    # Scan every dir the mobile app actually uses — not just Ego/. The car lives under Ego/, but the
    # charging hardware (mobile/geometry/{Charging_Cable,Supercharger,Home_Charger}) and the skybox
    # cubemaps live elsewhere and were left as corrupt gdre VRAM placeholders (s3tc/etc/pvrtc .stex).
    # On macOS Godot falls back to the source PNG so they render; on iOS only the corrupt .stex ships,
    # so they break (the brakes-style cascade). Energy/ is the solar app (unused here) → skipped to
    # keep the .pck from bloating with lossless copies of textures the car never shows.
    imports = []
    for root in ("Ego", "mobile", "skybox"):
        imports += glob.glob(os.path.join(project, root, "**", "*.png.import"), recursive=True)
    for imp in imports:
        txt = open(imp).read()
        loss = re.search(r'path="res://\.import/([^"]+)\.stex"', txt)
        vram = re.search(r'path\.s3tc="res://\.import/([^"]+)\.s3tc\.stex"', txt)
        if loss:
            base = loss.group(1)
        elif vram:
            base = vram.group(1)
        else:
            continue
        sm = re.search(r'source_file="(res://[^"]+)"', txt)
        if not sm:
            continue
        src_res = sm.group(1)
        src = os.path.join(project, src_res[len("res://"):])

        if vram:  # rewrite VRAM import → clean lossless import and drop the VRAM .stex triplet
            open(imp, "w").write(_LOSSLESS_IMPORT.format(base=base, src=src_res))
            for fmt in ("s3tc", "etc", "etc2", "pvrtc", "bptc"):
                old = os.path.join(import_dir, f"{base}.{fmt}.stex")
                if os.path.exists(old):
                    os.remove(old)
            converted += 1

        stex = os.path.join(import_dir, base + ".stex")
        if os.path.exists(stex) and os.path.getsize(stex) != _PLACEHOLDER_STEX_SIZE:
            ok += 1
            continue
        if os.path.exists(stex):  # corrupt placeholder — drop it and regenerate from source
            os.remove(stex)
        if not os.path.exists(src):
            bad += 1  # missing source PNG (skins/wraps/other models) — not needed for the base car
            continue
        try:
            png = open(src, "rb").read()
            w, h = _png_dims(png)
        except Exception:
            bad += 1
            continue
        _write_lossless_stex(stex, w, h, png)
        gen += 1
    print(f"  [textures] generated={gen} converted_from_vram={converted} already_ok={ok} missing_source={bad}")


# ── GDScript patch helpers ──────────────────────────────────────────────────────────────────────
def _replace_function(text: str, name: str, replacement: str):
    start = re.search(r"^func " + re.escape(name) + r"\(", text, re.M)
    if not start:
        return None
    s = start.start()
    nxt = re.search(r"^func ", text[s + 1:], re.M)
    e = (s + 1 + nxt.start()) if nxt else len(text)
    return text[:s] + replacement.rstrip("\n") + "\n\n" + text[e:]


_MOBILECOMM_READY = (
    'func _ready():\n'
    '\tprint("[MobileComm] OS=%s local_dev_harness=%s" % [OS.get_name(), str(local_dev_harness)])\n'
    '\tmatch OS.get_name():\n'
    '\t\t"iOS":\n'
    '\t\t\tif Engine.has_singleton("IOSGodotInterface"):\n'
    '\t\t\t\tcomm_interface = Engine.get_singleton("IOSGodotInterface")\n'
    '\t\t"Android":\n'
    '\t\t\tif Engine.has_singleton("AndroidGodotInterface"):\n'
    '\t\t\t\tcomm_interface = Engine.get_singleton("AndroidGodotInterface")\n'
    '\t\t"OpenHarmony":\n'
    '\t\t\tif Engine.has_singleton("OpenHarmonyGodotInterface"):\n'
    '\t\t\t\tcomm_interface = Engine.get_singleton("OpenHarmonyGodotInterface")\n'
    '\t\t"HTML5":\n'
    '\t\t\tif local_dev_harness:\n'
    '\t\t\t\t_setup_local_interface()\n'
    '\t\t\telse:\n'
    '\t\t\t\tcomm_interface = Node.new()\n'
    '\t\t\t\tcomm_interface.set_script(load("res://Energy/Powerhub/comm.gd"))\n'
    '\t\t\t\tadd_child(comm_interface)\n'
    '\t\t"X11", "Windows", "OSX", "Server":\n'
    '\t\t\t_setup_local_interface()\n'
    '\n'
    '\tif comm_interface == null and OS.has_feature("editor"):\n'
    '\t\t_setup_local_interface()\n'
)


def patch_mobilecomm(project: str):
    f = os.path.join(project, "mobile", "scripts", "MobileComm.gd")
    if not os.path.exists(f):
        print("  [MobileComm] not found — skipped")
        return
    txt = open(f).read()
    if 'Engine.has_singleton("IOSGodotInterface")' in txt:
        print("  [MobileComm] already iOS-bound — skipped")
        return
    new = _replace_function(txt, "_ready", _MOBILECOMM_READY)
    if new is None:
        print("  [MobileComm] _ready() not found — SKIPPED (check manually)")
        return
    open(f, "w").write(new)
    print("  [MobileComm] patched — iOS binds IOSGodotInterface")


_CAM_READY_FIT = (
    "\t# iOS portrait fit default: keep horizontal FOV so the wide car fills the screen width\n"
    "\t# (Godot's vertical FOV over-zooms on tall aspects). on_move_camera overrides per view.\n"
    "\tif camera and get_viewport().size.x < get_viewport().size.y:\n"
    "\t\tcamera.keep_aspect = Camera.KEEP_WIDTH\n"
)
_CAM_KEEPASPECT_ANCHOR = '\tvar animation_id = data.get("animation_id")\n'
_CAM_KEEPASPECT = (
    '\t# Per-view aspect (sent by RN per cameraPreset): straight-down views (top/climate) keep the\n'
    '\t# vertical FOV so the car length fills the tall screen and the hood is cropped; angled views\n'
    '\t# (parked/charge) keep width so the wide car fits. Default (no field) leaves the _ready fit.\n'
    '\tvar _keep_aspect = data.get("keep_aspect", null)\n'
    '\tif _keep_aspect == "WIDTH":\n'
    '\t\tcamera.keep_aspect = Camera.KEEP_WIDTH\n'
    '\telif _keep_aspect == "HEIGHT":\n'
    '\t\tcamera.keep_aspect = Camera.KEEP_HEIGHT\n'
)


def patch_cameramanager(project: str):
    f = os.path.join(project, "mobile", "scripts", "CameraManager.gd")
    if not os.path.exists(f):
        print("  [CameraManager] not found — skipped")
        return
    original = open(f).read()
    txt = original
    did = []
    # Part A: _ready portrait-fit default (skip if already present).
    if "Camera.KEEP_WIDTH" not in txt:
        start = re.search(r"^func _ready\(\):", txt, re.M)
        if start:
            s = start.start()
            nxt = re.search(r"^func ", txt[s + 1:], re.M)
            e = (s + 1 + nxt.start()) if nxt else len(txt)
            body = txt[s:e].rstrip("\n")
            txt = txt[:s] + body + "\n" + _CAM_READY_FIT + "\n" + txt[e:]
            did.append("portrait-fit")
        else:
            print("  [CameraManager] _ready() not found — portrait-fit SKIPPED")
    # Part B: on_move_camera per-view keep_aspect override.
    if 'data.get("keep_aspect"' not in txt:
        if _CAM_KEEPASPECT_ANCHOR in txt:
            txt = txt.replace(_CAM_KEEPASPECT_ANCHOR, _CAM_KEEPASPECT_ANCHOR + _CAM_KEEPASPECT, 1)
            did.append("per-view-aspect")
        else:
            print("  [CameraManager] keep_aspect anchor not found — per-view SKIPPED (check manually)")
    if txt != original:
        open(f, "w").write(txt)
        print("  [CameraManager] patched — " + " + ".join(did))
    else:
        print("  [CameraManager] already has portrait-fit + per-view aspect — skipped")


# MainViewContainer hosts both the frame-fit fix and free orbit, because (per mobile.tscn) it is the
# only node in the *root* viewport that sits on the car: CameraManager lives inside a sub-Viewport, so
# its _input never sees events injected via Input::parse_input_event. MainViewContainer's _input does.
_MVC_FRAME_ANCHOR = '\tvar height = data.get("height", screen_height)\n'
_MVC_FRAME_PATCH = (
    '\t# iOS fit: RN reports the main-view frame in points; the Godot viewport is in device pixels,\n'
    '\t# so scale by pixel_ratio or the car renders tiny in the corner. No-op when pixel_ratio==1\n'
    '\t# (the local dev harness) or off-iOS.\n'
    '\tif OS.get_name() == "iOS":\n'
    '\t\tvar _acm = get_node_or_null("/root/Mobile/AppConfigManager")\n'
    '\t\tif _acm != null and _acm.pixel_ratio > 0:\n'
    '\t\t\ttop_margin *= _acm.pixel_ratio\n'
    '\t\t\tleft_margin *= _acm.pixel_ratio\n'
    '\t\t\twidth *= _acm.pixel_ratio\n'
    '\t\t\theight *= _acm.pixel_ratio\n'
)
_MVC_ORBIT_MARKER = "# === iOS free orbit"
_MVC_ORBIT = (
    '\n'
    '# === iOS free orbit: drag to rotate + release inertia (injected by fix_godot_project.py) ===\n'
    '# Ports LocalDevMessageInjector free-orbit (drag spin + inertial coast). GodotHost.mm\'s\n'
    '# UIPanGestureRecognizer feeds InputEventScreenTouch/Drag into Input; this root-viewport node\n'
    '# consumes them and spins the CameraPivot, which lives in the sub-Viewport (out of input\'s reach).\n'
    '# DISABLED (2026-06-21, after exhaustive testing). Even with the recognizer gated to Controls\n'
    '# only, even with edge-touch rejection, even with inertia killed — orbit still crashed within\n'
    '# seconds of any drag because the rapid camera mutation feeds the same GLES2 driver corruption\n'
    '# that gl_view.mm touchesBegan triggers on iOS 26 / A19 Pro. Belt-and-suspenders: gate here\n'
    '# in GDScript too, so even if the native recognizer is mistakenly re-enabled the orbit script\n'
    '# returns early. Re-enable both this const AND the VehicleCanvas prop only after Phase 8.\n'
    'const _ORBIT_ENABLED = false\n'
    'const _ORBIT_YAW_SENS = 0.16\n'
    'const _ORBIT_PITCH_SENS = 0.06\n'
    'const _ORBIT_MIN_PITCH = 1.0\n'
    'const _ORBIT_MAX_PITCH = 79.0\n'
    # Inertia killed (2026-06-21). The coast after release was racing the next MOVE_CAMERA tween\n'
    '# whenever the user navigated away mid-coast (or even a fraction of a second after release):\n'
    '# both _physics_process and Tween mutated pivot.rotation_degrees in the same frame, crashing\n'
    '# Godot. Effective inertia = 0 by making min-threshold larger than any realistic velocity.\n'
    'const _ORBIT_INERTIA_DAMPING = 99.0\n'
    'const _ORBIT_MIN_INERTIA = 1.0e9\n'
    'var _orbit_dragging = false\n'
    'var _orbit_velocity = Vector2.ZERO\n'
    '\n'
    'func _orbit_pivot():\n'
    '\treturn get_node_or_null("Viewport/CameraManager/CameraPivot")\n'
    '\n'
    'func _orbit_apply(pivot, rotation_delta):\n'
    '\tvar r = pivot.rotation_degrees\n'
    '\tr.y += rotation_delta.x\n'
    '\tr.x = clamp(r.x + rotation_delta.y, _ORBIT_MIN_PITCH, _ORBIT_MAX_PITCH)\n'
    '\tr.z = 0\n'
    '\tpivot.rotation_degrees = r\n'
    '\n'
    'func _input(event):\n'
    '\tif Engine.editor_hint or not _ORBIT_ENABLED:\n'
    '\t\treturn\n'
    '\tvar pivot = _orbit_pivot()\n'
    '\tif pivot == null:\n'
    '\t\treturn\n'
    '\tif event is InputEventScreenTouch:\n'
    '\t\t_orbit_dragging = event.pressed\n'
    '\t\t_orbit_velocity = Vector2.ZERO  # belt-and-suspenders: kill velocity on both press AND release\n'
    '\t\tif event.pressed:\n'
    '\t\t\tvar ct = get_node_or_null("Viewport/CameraManager/Tween")\n'
    '\t\t\tif ct != null and ct.is_active():\n'
    '\t\t\t\tct.remove_all()\n'
    '\telif event is InputEventScreenDrag and _orbit_dragging:\n'
    '\t\tvar rotation_delta = Vector2(-event.relative.x * _ORBIT_YAW_SENS, -event.relative.y * _ORBIT_PITCH_SENS)\n'
    '\t\t_orbit_apply(pivot, rotation_delta)\n'
    '\t\t_orbit_velocity = rotation_delta / max(get_physics_process_delta_time(), 0.008)\n'
    '\n'
    'func _physics_process(delta):\n'
    '\tif Engine.editor_hint or not _ORBIT_ENABLED or _orbit_dragging:\n'
    '\t\treturn\n'
    '\tif _orbit_velocity.length() < _ORBIT_MIN_INERTIA:\n'
    '\t\t_orbit_velocity = Vector2.ZERO\n'
    '\t\treturn\n'
    '\tvar pivot = _orbit_pivot()\n'
    '\tif pivot == null:\n'
    '\t\treturn\n'
    '\t_orbit_apply(pivot, _orbit_velocity * delta)\n'
    '\t_orbit_velocity = _orbit_velocity.linear_interpolate(Vector2.ZERO, min(1.0, _ORBIT_INERTIA_DAMPING * delta))\n'
)


def patch_mainviewcontainer(project: str):
    f = os.path.join(project, "mobile", "scripts", "MainViewContainer.gd")
    if not os.path.exists(f):
        print("  [MainViewContainer] not found — skipped")
        return
    original = open(f).read()
    txt = original
    did = []
    if "_acm.pixel_ratio" not in txt:
        if _MVC_FRAME_ANCHOR in txt:
            txt = txt.replace(_MVC_FRAME_ANCHOR, _MVC_FRAME_ANCHOR + _MVC_FRAME_PATCH, 1)
            did.append("frame-fit")
        else:
            print("  [MainViewContainer] frame anchor not found — frame-fit SKIPPED (check manually)")
    # Orbit injection — RE-ENABLED with _ORBIT_ENABLED=true (2026-06-21).
    # The 2026-06-21 root-cause work proved that defining _input alone doesn't cause the GL crash
    # (we stripped it and the crash still happened). The C++ touch path in gl_view.mm's
    # touchesBegan IS what trips iOS 26 / A19 Pro's GLES2 driver. Native side now blocks that
    # via glView.userInteractionEnabled=NO and feeds touches manually via a UIPanGestureRecognizer
    # on the parent view (gated per-screen by the orbitEnabled prop). When the recognizer fires
    # it calls Input::parse_input_event directly — a different path than touchesBegan, and one
    # this GDScript handler consumes.
    for marker in ("# --- iOS free orbit", _MVC_ORBIT_MARKER):
        if marker in txt:
            txt = txt[: txt.index(marker)].rstrip("\n") + "\n"
    desired = txt.rstrip("\n") + "\n" + _MVC_ORBIT
    if desired != txt:
        txt = desired
        if "free-orbit" not in did:
            did.append("free-orbit")
    if txt != original:
        open(f, "w").write(txt)
        print("  [MainViewContainer] patched — " + " + ".join(did))
    else:
        print("  [MainViewContainer] already has frame-fit + free-orbit (per-screen) — skipped")


def patch_injector(project: str):
    f = os.path.join(project, "mobile", "scripts", "LocalDevMessageInjector.gd")
    if not os.path.exists(f):
        print("  [LocalDevMessageInjector] not found — skipped")
        return
    txt = open(f).read()
    if "web_export_dynamic_scenes.size()" not in txt:
        print("  [LocalDevMessageInjector] clean — skipped")
        return
    new = re.sub(r': %d scenes" % web_export_dynamic_scenes\.size\(\)', '"', txt)
    new = new.replace("web_export_dynamic_scenes.size()", "0")
    open(f, "w").write(new)
    print("  [LocalDevMessageInjector] patched — removed undeclared web_export_dynamic_scenes ref")


def patch_viewport_msaa(project: str):
    # mobile.tscn (the iOS scene) hardcodes `msaa = 2` on the car's render Viewport. On iOS GLES2 the
    # multisample framebuffer can't allocate ("Cannot allocate back framebuffer for MSAA"), so the
    # render target falls over and the GL view logs GL_INVALID_ENUM (0x500 = "DrawView: 500 error")
    # every frame — degrading the on-device render (macOS desktop GL allocates MSAA fine, hence the
    # platform split). project.godot already intends `quality/filters/msaa.mobile=0`, so drop the
    # scene-level override to match. (Snapshot.tscn carries the same override.)
    patched = []
    for rel in ("mobile.tscn", os.path.join("mobile", "scenes", "Snapshot.tscn")):
        f = os.path.join(project, rel)
        if not os.path.exists(f):
            continue
        txt = open(f).read()
        if re.search(r'^msaa = 2\s*$', txt, re.M):
            open(f, "w").write(re.sub(r'^msaa = 2\s*$', "msaa = 0", txt, flags=re.M))
            patched.append(rel)
    if patched:
        print("  [viewport msaa] disabled MSAA (was 2) in " + ", ".join(patched))
    else:
        print("  [viewport msaa] already 0 / no override — skipped")


def patch_airflow_csg(project: str):
    # The AC airflow quads (Airflow_left/right, shown when climate is ON) are `CSGMesh` nodes. CSG
    # builds its geometry by reading the source mesh's arrays at runtime — which iOS GLES2 forbids
    # ("OpenGL ES 2.0 does not allow retrieving mesh array data"), so on device the airflow renders
    # broken/flashing while macOS desktop GL is fine. The sibling Defrost_* nodes are plain
    # MeshInstance and render correctly, so convert the airflow to MeshInstance too (CSGMesh's
    # `material` becomes MeshInstance's `material_override`). No CSG boolean is involved — they're
    # standalone quads — so the visual is identical.
    changed = []
    gd = os.path.join(project, "mobile", "scripts", "Airflow.gd")
    if os.path.exists(gd):
        t = open(gd).read()
        if "extends CSGMesh" in t:
            t = t.replace("extends CSGMesh", "extends MeshInstance")
            t = t.replace("shader_mat = material\n", "shader_mat = material_override\n")
            open(gd, "w").write(t)
            changed.append("Airflow.gd")

    for tscn in glob.glob(os.path.join(project, "Ego", "**", "*.tscn"), recursive=True):
        t = open(tscn).read()
        if 'name="Airflow_' not in t or 'type="CSGMesh"' not in t:
            continue
        out = []
        in_airflow = False
        for ln in t.split("\n"):
            if ln.startswith("["):
                in_airflow = ln.startswith("[node ") and (
                    'name="Airflow_left"' in ln or 'name="Airflow_right"' in ln
                )
                if in_airflow:
                    ln = ln.replace('type="CSGMesh"', 'type="MeshInstance"')
            elif in_airflow and re.match(r"\s*material = ", ln):
                ln = ln.replace("material = ", "material_override = ", 1)
            out.append(ln)
        new = "\n".join(out)
        if new != t:
            open(tscn, "w").write(new)
            changed.append(os.path.relpath(tscn, project))

    if changed:
        print("  [airflow csg] CSGMesh→MeshInstance in " + ", ".join(changed))
    else:
        print("  [airflow csg] already MeshInstance — skipped")


# ── lights message (headlights / brake lights) ───────────────────────────────────────────────────
# The dev harness drove headlights/brake-lights by calling vehicle.set_headlights_on/_brake_lights_on
# directly (no product-state path). To drive them from RN we add a dedicated SET_VEHICLE_LIGHTS message
# type + a VehicleManager listener. Done here (not edited into the project) so it survives a fresh gdre
# extract. Requires a .pck re-export (recompiles the .gd) to take effect.
_REACTMSG_ENUM_ANCHOR = "enum {\n"
_REACTMSG_DICT_ANCHOR = "const Type = {\n"


def patch_reactmsg_lights(project: str):
    f = os.path.join(project, "mobile", "scripts", "ReactMsg.gd")
    if not os.path.exists(f):
        print("  [ReactMsg] not found — skipped")
        return
    txt = open(f).read()
    if "SET_VEHICLE_LIGHTS" in txt:
        print("  [ReactMsg] already has SET_VEHICLE_LIGHTS — skipped")
        return
    if _REACTMSG_ENUM_ANCHOR not in txt or _REACTMSG_DICT_ANCHOR not in txt:
        print("  [ReactMsg] enum/Type anchors not found — SKIPPED (check manually)")
        return
    txt = txt.replace(_REACTMSG_ENUM_ANCHOR, _REACTMSG_ENUM_ANCHOR + "\tSET_VEHICLE_LIGHTS, \n", 1)
    txt = txt.replace(_REACTMSG_DICT_ANCHOR, _REACTMSG_DICT_ANCHOR + '\t"SET_VEHICLE_LIGHTS": SET_VEHICLE_LIGHTS, \n', 1)
    open(f, "w").write(txt)
    print("  [ReactMsg] patched — added SET_VEHICLE_LIGHTS")


_VM_LISTENER_ANCHOR = '\tmobile_comm.register_listener(ReactMsg.GET_VEHICLE_MARKERS, funcref(self, "on_get_vehicle_markers"))\n'
_VM_LISTENER_ADD = '\tmobile_comm.register_listener(ReactMsg.SET_VEHICLE_LIGHTS, funcref(self, "on_set_vehicle_lights"))\n'
_VM_HANDLER = (
    'func on_set_vehicle_lights(data: Dictionary):\n'
    '\t# Persistent manual headlights / brake-lights toggle from RN (Explore demo panel). Mirrors the\n'
    '\t# dev harness manual override; there is no product-state path for these, hence a dedicated msg.\n'
    '\tvar vehicle: Vehicle = vehicle_for_data(data)\n'
    '\tif vehicle == null:\n'
    '\t\treturn\n'
    '\tif data.has("headlights") and vehicle.has_method("set_headlights_on"):\n'
    '\t\tvehicle.set_headlights_on(data.get("headlights"))\n'
    '\tif data.has("brake_lights") and vehicle.has_method("set_brake_lights_on"):\n'
    '\t\tvehicle.set_brake_lights_on(data.get("brake_lights"))\n'
)


def patch_vehiclemanager_lights(project: str):
    f = os.path.join(project, "mobile", "scripts", "VehicleManager.gd")
    if not os.path.exists(f):
        print("  [VehicleManager] not found — skipped")
        return
    txt = open(f).read()
    if "on_set_vehicle_lights" in txt:
        print("  [VehicleManager] already has lights handler — skipped")
        return
    if _VM_LISTENER_ANCHOR not in txt:
        print("  [VehicleManager] listener anchor not found — SKIPPED (check manually)")
        return
    txt = txt.replace(_VM_LISTENER_ANCHOR, _VM_LISTENER_ANCHOR + _VM_LISTENER_ADD, 1)
    txt = txt.rstrip("\n") + "\n\n\n" + _VM_HANDLER
    open(f, "w").write(txt)
    print("  [VehicleManager] patched — SET_VEHICLE_LIGHTS handler")


def main():
    if len(sys.argv) < 2:
        print("usage: fix_godot_project.py <godot-project-dir>")
        sys.exit(1)
    project = sys.argv[1]
    if not os.path.exists(os.path.join(project, "project.godot")):
        print("ERROR: not a Godot project (no project.godot):", project)
        sys.exit(1)
    print("Patching for iOS:", project)
    ensure_lossless_textures(project)
    patch_mobilecomm(project)
    patch_cameramanager(project)
    patch_mainviewcontainer(project)
    patch_injector(project)
    patch_viewport_msaa(project)
    patch_airflow_csg(project)
    patch_reactmsg_lights(project)
    patch_vehiclemanager_lights(project)
    print("Done — ready to export the iOS .pck.")


if __name__ == "__main__":
    main()
