# R7 §5 — Three sanity checks (renderer transitions)

Sources: iOS bundle `/Users/ivan/Downloads/tesla-haptics-work/main.decompiled.js` (v4.56, GodotModule fns);
Godot `.../tesla-renderer-frame-appendix/mobile.tscn` and `CameraManager.decompiled.gd`;
R5 `tesla-renderer-and-battery-FINDINGS.md`, R6 `tesla-renderer-frame-FINDINGS.md`.

---

## Check 1 — Viewport / 3D camera aspect: SCREEN, not 790×875. [both-match]

VERDICT: The 3D camera aspect = **SCREEN aspect**, NOT the Viewport `size = Vector2(790,875)` override.

Scene graph (mobile.tscn):
- `MainViewContainer` (ViewportContainer, anchors full, **`stretch = true`**) — L66-69.
- child `Viewport` (**`size = Vector2(790,875)`**, **`size_override_stretch = true`**, `own_world = true`) — L75-78.
- `Camera` (`current = true`, **`fov = 40.0`**, `far = 150`, transform y=13) — L109-112. **No `keep_aspect`, no `projection`** set.

Godot-3 semantics:
- `ViewportContainer.stretch = true` forces the child `Viewport.size` to equal the container's `rect_size` (= the on-screen rectangle = full device screen). So the Viewport's *actual pixel size* is the screen, not 790×875.
- `size = Vector2(790,875)` + `size_override_stretch = true` is a **2D-canvas coordinate override only** (`Viewport.set_size_override`). It rescales the 2D drawing space; it does **not** change the pixel dimensions a 3D `Camera` uses to compute aspect.
- A 3D `Camera`'s aspect is derived from the viewport's real pixel size → **screen aspect** (~393/852 ≈ 0.461 w/h on the reference phone).
- `keep_aspect` is unset → Godot-3 default **`KEEP_HEIGHT`** → `fov 40` is the **VERTICAL** FOV (R5 line 17/113, R6). Per-view poses (`cam_fov`, `offset`, `rotation`) are hard-coded literals, not viewport-derived (R5 line 95).

Consequence for the port: render into a screen-aspect viewport and keep `KEEP_HEIGHT`. Do NOT feed 790/875 as the aspect and do NOT set `KEEP_WIDTH` (that reinterprets fov 40 as horizontal → ~×0.461 shrink, the "45% smaller" bug in R5).

---

## Check 2 — animation_id consumer + stable-id risk.

MOVE_CAMERA carries `animation_id = uuid.v4()` — **fresh per call**. In `moveCamera` (iOS fn28708, ~1172931):
`... .v4()()` → `r10`; `payload['animation_id'] = r10`; and `moveCamera` **returns r10** (the fresh id).

RN consumer — `moveCameraWithCompletion(pose, completionCb)` (iOS fn ~1173806):
```
id = moveCamera(pose)                       // fresh uuid, stored in closure
registerRequestListener(MOVE_CAMERA_RESPONSE, resp => {
    if (resp.animation_id === id) completionCb()   // else no-op
})
```

Godot side — `CameraManager.on_move_camera` / `on_tween_completed`:
- `current_animation_id = animation_id`; `tween.start()`.
- On `tween_all_completed`: `if current_animation_id != null: send(MOVE_CAMERA_RESPONSE, {animation_id: current_animation_id}); current_animation_id = null`.

Dispatch side (iOS response router, fn28726 ~1174000): for a response type it **forEach-calls EVERY registered listener** for that type, then **clears the whole listener array** (`requestListeners[type] = new Array(0)`). So MOVE_CAMERA_RESPONSE listeners are one-shot *as a batch* — every pending listener is invoked once (each self-filters by id) and then all are dropped.

`registerRequestListener` (fn28719 ~1173671) merely **pushes** onto the array (no de-dup, no per-listener removal). Only MOVE_CAMERA carries `animation_id`; SET_ENV_PARAMS and UPDATE_MAIN_VIEW_FRAME have **no** id / no completion channel.

RISK ASSESSMENT — does a STABLE per-preset id risk merging/suppressing tweens?
- **No effect on Godot tween behavior.** Godot keeps a *single shared tween* and a *single* `current_animation_id` that each `on_move_camera` overwrites. On rapid navigation the in-flight tween is replaced and only the **last** id's completion is ever emitted — this is inherent to the single-tween design and is **independent of whether ids are stable or fresh**. The id never gates `tween.start()`; it is purely a completion-correlation token.
- **The real risk of a stable id is RN-side, not tween merging:**
  1. **Fresh uuid = exactly-once.** On rapid A→B, both register listeners (idA, idB). Godot emits only idB's response. Dispatch calls both: listenerA (idB≠idA → no-op, dropped), listenerB (match → fires once). Clean.
  2. **Stable id = double/stale firing.** If the same preset is requested twice before a response (double effect / A→A / remount), two listeners share the same id. The single response matches **both** → the completion callback **fires multiple times** for one navigation. Any side-effectful completion (state set, follow-up command) double-runs. Fresh uuids make each response match exactly one listener, so stale/duplicate completions can't fire.
- Because the array is cleared on every dispatch, a stable id does **not** cause an unbounded listener leak — the hazard is duplicate/stale completion invocation within a dispatch, and loss of exactly-once correlation.

RECOMMENDATION for the port: keep a **fresh uuid.v4() per MOVE_CAMERA call** (matches Tesla). Do not use a stable per-preset id.

---

## Check 3 — Are camera / env / frame animated simultaneously, with what duration?

FIRED TOGETHER, SAME TICK. On a screen navigate the RN effect calls `moveCamera(...)` then `updateMainViewFrame(...)` back-to-back synchronously (verified in Home fn111055 ~4558829/4558838; Controls fn98623 ~4039521/4039690). Inside `moveCamera`, when `updateEnvironment` (default true) is set, it sends **MOVE_CAMERA** then **SET_ENV_PARAMS** in the *same synchronous body* (fn28708 case 403), with the **same** duration/transition/ease. So all three GodotMsgs — MOVE_CAMERA, SET_ENV_PARAMS, UPDATE_MAIN_VIEW_FRAME — are emitted in one JS tick.

ACTUAL PARAMS each message gets (callers pass NO override → RN module defaults apply):
- Module defaults (iOS ~1174108): `defaultCameraAnimationDuration = 0.5`, `defaultCameraAnimationTransition = QUART`, `defaultCameraAnimationEase = OUT`.
- `moveCamera` (fn28708): `duration = payload.duration ?? 0.5`; `transition_type = ?? QUART`; `ease_type = ?? OUT`; `animated = ?? true`. Home/Controls pass only `{position, carType}` → **0.5 / QUART / OUT / animated:true**.
- `SET_ENV_PARAMS`: reuses the *same* r6/r5/r4 → **0.5 / QUART / OUT / animated:true** (+ `rotate_sky_box`).
- `updateMainViewFrame` (fn28712): args 5/6/7 default to the same **0.5 / QUART / OUT**; `animated` (arg4) default true. Home/Controls pass geometry only → defaults apply.

Godot DEFAULT_ANIMATION_DURATION = 0.75 is DEAD for these paths: RN **always injects an explicit `duration` (0.5)** into every payload, so Godot's `data.get('duration', 0.75)` fallback never triggers. Likewise Godot's DEFAULT_ANIMATION_EASE = EASE_IN_OUT is overridden by RN's explicit **EASE_OUT**. Godot's DEFAULT_ANIMATION_TRANSITION = TRANS_QUART already matches. Net: every transition runs at **0.5s, TRANS_QUART, EASE_OUT**.

Per-transition overrides: none observed for Home/Controls/Climate navigations — they rely on the RN 0.5 default. (Callers *can* pass duration/transition/ease positionally; these standard screen effects do not.) `setScreenOverlayColor` is a separate message with its own defaults (duration 0.5, transition **LINEAR**, ease OUT) — unrelated to the camera/env/frame trio.

SUMMARY: camera + env + frame animate **simultaneously, same tick, identical timing (0.5s / QUART / OUT / animated)**. Port: fire all three in one batch with duration 0.5, TRANS_QUART, EASE_OUT — do not rely on Godot's 0.75 default.
