# RESEARCH BRIEF #7 — Per-screen frames + the transition, for EVERY screen

**You are the research agent.** Rounds 1–6 are the base. **Round 6 (`tesla-renderer-frame-FINDINGS.md`) was outstanding** — writing a `.gdc` decompiler, validating it against the handlers R4/R5 had independently derived, and correcting my brief's premise (their frame handler is byte-for-byte ours; the lever was `keep_aspect`). That fix shipped and **Home now matches**. Method rules stay in force:

- **VERBATIM dumps, not summaries.**
- **Tag every fact `[iOS-verified]` / `[Android-only]` / `[both-match]` / `[differ]`.** We ship iOS.

**Deliverable:** `docs/superpowers/research/tesla-renderer-transitions-FINDINGS.md`.

---

## Where we are

Shipped from R6: `keep_aspect = KEEP_HEIGHT` on every view (their Camera never sets it, so Godot's default applies and `cam_fov` is a **vertical** fov), Home on their absolute rect `{top: statusBarHeight+60, height: 355}`, and their `defaultCameraAnimation*` = **0.5s / TRANS_QUART(3) / EASE_OUT(1)** on `MOVE_CAMERA` + `SET_ENV_PARAMS` + `UPDATE_MAIN_VIEW_FRAME`. **Home is confirmed correct on-device.**

User's remaining report, after that fix: navigating to **Controls / Climate** still looks *"very off"* — position and size are *"nearly"* right but not right, and the movement doesn't match. Lighting/shadow now matches.

The gap is that **we only have recovered frame rects for Home and Climate**. R5 §3c gave:

| Screen | top_margin | height |
|---|---|---|
| Home | `statusBarHeight + 60` | `355` |
| Home + lootbox | `+ LOOTBOX_TOP_BANNER_HEIGHT` | 355 |
| **Controls** | **0 (or "a state const")** | **`SCREEN_HEIGHT − sheetHeight`** ← both unresolved |
| Climate | `statusBarOffset` | `SCREEN_HEIGHT − statusBarOffset − 240` |

R5 §5 listed the Controls constants as UNRESOLVED. Everything else is guesswork on our side.

---

## §1. The per-screen frame table — COMPLETE and verbatim `[the main ask]`

For **every screen that hosts the renderer**, give the exact `UPDATE_MAIN_VIEW_FRAME` payload, verbatim, with all constants resolved to numbers (and their names):

1. **Controls** — resolve `sheetHeight` (and the `top_margin` "state const"). Is the height static, or does it track a drawer/sheet position as the user drags? If it's dynamic, give the function and its inputs.
2. **Climate** — confirm `240` and `statusBarOffset`; is `240` a named constant?
3. **Home** — confirm `355` + `statusBarHeight + 60`, and what `LOOTBOX_TOP_BANNER_HEIGHT` is.
4. **Every other renderer-hosting screen** the user might reach — the user's words: *"any other camera rotation I assume if exists, important to include!"* So enumerate **all** of them: Charging, Location, Summon, Security & Drivers, Set Schedules, Service, Energy/Powershare, Closure-open, Tent mode, Drive/Reverse — whatever exists. For each: **which `CameraPosition` it selects** AND **its frame rect**. If a screen doesn't host the renderer (pure RN page), say so — that's equally useful.
5. Does any screen send a frame **without** a `MOVE_CAMERA`, or vice versa? What's the **ordering** of the two (and `SET_ENV_PARAMS`) on a navigation — same tick, sequenced, awaited?

## §2. The transition itself

The user says our movement between screens still doesn't match theirs.

1. **Is the 0.5s / QUART / OUT default actually used on navigation**, or do specific transitions override `duration` / `transition_type` / `ease_type`? Give any per-transition overrides verbatim.
2. **Do camera, frame and env animate simultaneously** with identical params, or are they staggered/sequenced? (We currently fire all three together with identical params.)
3. `MOVE_CAMERA` carries a fresh `animation_id = uuid.v4()` per call (R5 §3a). **What consumes `animation_id`** — does their scene use it to cancel/replace an in-flight tween? We send a STABLE per-preset id (e.g. `'shell-camera-parked'`) — could that be suppressing or merging tweens on rapid navigation?
4. Is there any **`tween.stop_all()` / reset** between transitions, or do overlapping navigations blend?
5. Does the **product/vehicle get re-shown** (`SHOW_PRODUCT`/`UPDATE_PRODUCT`) on a screen change, and could that reset the pose mid-transition?

## §3. Our specific divergences — please confirm or correct

State plainly whether each is right, from their code:

1. **Our Controls uses a TOP_DOWN pose** (`rotation [0,0,0]`, `offset [0,10,0]`, our `cam_fov 20`). R5 §3b says **their Controls has no separate camera — it IS the PARKED pose**. Confirm. If true, our Controls camera is our own invention and the "off" look may be structural, not a tuning error. **What does their Controls screen actually show — the same 3/4 hero view as Home, just framed differently?**
2. Their `TOP_DOWN` pose exists in the table (`offset [0,10,0]`, `cam_fov 40`) — **which screen, if any, actually uses it?**
3. We render the car via a `ViewportContainer`→`Viewport`→`root` tree, camera a sibling of `root` (matching R6 §3). Confirm nothing else per-screen scales/moves `root` besides the frame handler.
4. R6 §6 flagged one thing to verify: their `Viewport` has `size = Vector2(790, 875)` + `size_override_stretch = true`. **Does the 3D camera's aspect come from the screen (via `ViewportContainer.stretch`) or from that 790×875 override?** R6 assumed screen aspect. Home matching on-device suggests screen aspect is right — **confirm**, since it changes the KEEP_HEIGHT maths everywhere else.

## §4. Calibration targets (fallback)

If any frame constant can't be resolved statically, give us **derived geometry** instead, for a 393×852-pt / `statusBarHeight = 59` phone: for **Controls** and **Climate**, the resulting `root_node.scale` and the car's on-screen **centre** in points (R6 §4 showed the centre is exactly derivable: `center_y = top_margin + screen_height/2 · scale`). With a target scale + centre per screen we can solve our frames directly. A documented "not recoverable" + a calibration target is a fine outcome; a guessed constant is not.

---

## Output format

1. **Frame table** — every renderer-hosting screen → `CameraPosition` + verbatim frame payload + resolved constants.
2. **Transition** — params, overrides, ordering, `animation_id` semantics, cancellation.
3. **Our divergences** (§3) — confirmed/corrected, with the Controls-camera question answered explicitly.
4. **Calibration** — per-screen `scale` + centre in points on a 393×852/59 phone.
5. **Citations**; **Android-only vs iOS-verified** per fact.
6. **Gaps**, plainly.
