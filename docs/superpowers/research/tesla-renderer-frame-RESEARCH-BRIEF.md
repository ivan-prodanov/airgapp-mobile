# RESEARCH BRIEF #6 — The Godot SCENE side of the frame: how `UPDATE_MAIN_VIEW_FRAME` becomes a car size

**You are the research agent.** Rounds 1–5 are the base. **Round 5 (`tesla-renderer-and-battery-FINDINGS.md`) is the current source of truth** and was excellent — the camera-pose table, the env presets and the shadow mechanism were all correct and shipped. Both method rules stay in force:

- **VERBATIM dumps, not summaries.**
- **Tag every fact `[iOS-verified]` / `[Android-only]` / `[both-match]` / `[differ]`.** We ship iOS.

**Deliverable:** `docs/superpowers/research/tesla-renderer-frame-FINDINGS.md`.

This round is **narrow and deep**: one question, in the one place nobody has looked yet — **inside their compiled Godot project**.

---

## What happened (so you know exactly what's missing)

Round 5 §3c recovered the RN side of the frame perfectly:

> Home = `{top_margin: statusBarHeight + 60, left_margin: 0, width: SCREEN_WIDTH, height: GODOT_VIEW_SIZE = 355}`, all × `getNativeScale()`; the camera pose is a hard-coded literal and is NOT viewport-dependent.

We shipped exactly that. **The car got ~45% SMALLER** and is now far smaller than the official app's. Reverted.

The cause is that **their numbers are not portable to our engine**, because the two scenes' frame handlers do different things — and we only know ours. Ours (`godot/mobile/scripts/MainViewContainer.gd`, our own port, VERBATIM):

```gdscript
func on_update_main_view_frame(data: Dictionary):
    var screen_width: float = get_viewport().size.x
    var screen_height: float = get_viewport().size.y
    var top_margin = data.get("top_margin", 0)
    var width  = data.get("width", screen_width)
    var height = data.get("height", screen_height)
    if OS.get_name() == "iOS":                       # points -> device pixels
        var _acm = get_node_or_null("/root/Mobile/AppConfigManager")
        if _acm != null and _acm.pixel_ratio > 0:
            top_margin *= _acm.pixel_ratio ; left_margin *= _acm.pixel_ratio
            width *= _acm.pixel_ratio      ; height *= _acm.pixel_ratio
    var scale: Vector3 = Vector3.ONE * (height / screen_height)    # <-- !!
    var center_y = top_margin + (screen_height / 2 * scale.y)
    ...
    root_node.scale = scale                          # SCALES THE WHOLE 3D SCENE
```

So **for us `height` is a ZOOM FACTOR** (`height/screen_height` scales the entire scene root). Their `height:355` on an 852pt screen ⇒ scale `0.417`, hence the shrink. Note we already do the points→pixels conversion **inside** the scene, so their `× getNativeScale()` is accounted for.

**But at the byte-identical PARKED pose their car renders MUCH LARGER than 355/852 would ever give.** So their handler cannot be scaling the scene by `height/screen_height` — it must crop/letterbox/position instead, or scale by something else entirely. **We need their handler's actual maths.**

---

## §1. THE question — their `UPDATE_MAIN_VIEW_FRAME` receiver `[the whole point of this round]`

In `split_assets_pack.apk!assets/godot/` (compiled `.gdc`, same as the `ScreenOverlay.gdc` / `EnvironmentManager.gdc` you already read successfully in Round 4/5):

1. **Find the node/script that registers a listener for `UPDATE_MAIN_VIEW_FRAME`** (in ours it's `MainViewContainer.gd` via `mobile_comm.register_listener(ReactMsg.UPDATE_MAIN_VIEW_FRAME, ...)`). Name the script + scene path.
2. **Dump its handler VERBATIM** — every line, decompiled as far as the `.gdc` allows. If full decompilation isn't possible, give the opcode/constant-level reading and say so.
3. Answer precisely: **what do `top_margin` / `left_margin` / `width` / `height` actually DO in their scene?**
   - Do they scale a node (`root.scale = f(height)`)? If so, **what is `f` exactly?**
   - Do they set a **Viewport size / `Camera.set_viewport()` / a `Camera.frustum` offset / `keep_aspect`**?
   - Do they position/crop a container (`rect_position`/`rect_size`/`rect_clip_content`) without scaling?
   - Something else?
4. **Is there a points→pixels conversion on their scene side too**, or does RN's `× getNativeScale()` mean the scene receives pixels and uses them raw? (This decides whether their 355 arrives as 355 or 1065.)
5. **What is `screen_height`/the viewport size in their scene** — the full device height, or something else? Ours reads `get_viewport().size`.
6. **What node is scaled/moved** (their equivalent of our `root_node`) and where does it sit in the scene tree?

## §2. `Camera.keep_aspect` — ours is an invention, what's theirs?

Our `MOVE_CAMERA` payload carries a `keep_aspect: 'WIDTH' | 'HEIGHT'` key; Round 5 §3a shows **their** `MOVE_CAMERA` has no such key (`rotation, offset, cam_fov, animated, duration, transition_type, ease_type, animation_id` only).

1. **What `keep_aspect` does their Camera node use** (Godot 3 default is `KEEP_HEIGHT`)? Read it from the `.scn`/`.tscn` or from whatever code sets it.
2. Is `cam_fov` applied as `Camera.fov` directly, and is it therefore **vertical** FOV under `KEEP_HEIGHT`? This matters enormously: with the same `fov:40` and the same `offset.y:6.7`, a vertical-vs-horizontal FOV interpretation changes the car's on-screen size by the aspect ratio.
3. Does anything in their scene change `fov`/`size`/`keep_aspect` per view beyond `MOVE_CAMERA`?

## §3. The scene-graph context we need to map their numbers onto ours

1. **The camera rig:** is the camera a child of a pivot that `MOVE_CAMERA`'s `rotation` drives, with `offset` as a local translation (that's our reading)? Give the node hierarchy + the transform each field writes.
2. **Is the car model itself ever scaled** (per-view or per-model), or is it always unit scale with only the camera moving?
3. **The ground/AO plane's transform** (Round 5 §5 left "the vehicle ground-quad's exact metres" UNRESOLVED) — its size in metres and its position, per model if it varies. Needed to match the shadow's footprint, not just its tone.

## §4. Ground truth we can calibrate against

Even with the handler recovered, one measured reference would let us verify instantly:
1. For **Home/PARKED on a Dynamic-Island iPhone** (`statusBarHeight = 59`, screen 393×852 pt): **how many POINTS wide is the car** on screen in the official app, and where is its centre (x, y in points)? Derive it from the maths if you can; otherwise say it's not derivable statically.
2. Same for **Climate**, if cheap.

---

## Output format

1. **Their frame handler** — script/scene path + VERBATIM body + a plain-English statement of what each field does.
2. **The mapping** — given their `{top:59+60, width:393, height:355}` (× scale?), what transform does their scene end up applying, expressed so we can reproduce it in ours?
3. **Camera** — `keep_aspect`, FOV axis, rig hierarchy.
4. **Scene context** — car scale, ground-plane transform.
5. **Calibration** — car width/centre in points on Home, if derivable.
6. **Citations**; **Android-only vs iOS-verified** per fact.
7. **Gaps**, plainly.

**Note on scope:** if their `.gdc` truly won't yield the handler, say so plainly and instead give us §4's measured/derived geometry — with a target car width and centre we can solve our own `heightFrac`/`topMargin` empirically. A documented "not recoverable" plus a calibration target is a perfectly good outcome; a guessed formula is not.
