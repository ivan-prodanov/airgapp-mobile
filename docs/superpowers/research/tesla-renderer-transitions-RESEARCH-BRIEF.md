# RESEARCH BRIEF #7 — Per-screen frame constants (Controls + Climate), and a Round-5 correction

**You are the research agent.** Rounds 1–6 are the base. **Round 6 (`tesla-renderer-frame-FINDINGS.md`) was outstanding** — you wrote a `.gdc` decompiler, validated it against handlers R4/R5 had independently derived, and corrected my premise (their frame handler is byte-for-byte ours; the lever was `keep_aspect`). That shipped and **Home now matches the real app exactly.** Method rules stay in force:

- **VERBATIM dumps, not summaries.**
- **Tag every fact `[iOS-verified]` / `[Android-only]` / `[both-match]` / `[differ]`.** We ship iOS.

**Deliverable:** `docs/superpowers/research/tesla-renderer-transitions-FINDINGS.md`.

---

## ⚠️ Round 5 §3b is WRONG about Controls — device-proven

R5 §3b states:

> *"Screen → pose (by vehicle STATE, not route): `VehicleControlsScreen → PARKED` (there is **no separate "Controls" camera** — Controls IS the Home product view at PARKED)"*

**The user's side-by-side screenshots of the official app disprove this.** The official Controls screen renders a **TOP-DOWN view** of the car (roof/glass filling the screen, "Open" labels on frunk and trunk, Flash/Honk/Start/Vent along the bottom). It is emphatically not the PARKED 3/4 hero shot.

So: **their Controls screen has its own camera pose** — almost certainly the `TOP_DOWN` entry from your own R5 §3b table (`rotation [0,0,0]`, `offset [0,10,0]`, `cam_fov 40`). Please **re-derive the screen→pose mapping** rather than trusting §3b, and say what actually selects TOP_DOWN.

---

## Why this round exists: I have been GUESSING, and the user called it

State honestly what we shipped and why it's not good enough:

- We adopted your recovered `TOP_DOWN` pose (`offset [0,10,0]`, `cam_fov 40`) for Controls, then **guessed** its frame as *full-screen height* (→ `root_node.scale = 1.0`, `top_margin = 0`) by working the projection backwards from screenshot pixels. **Result: our car is now slightly BIGGER than the official app's.** The pose is right; the frame scalar is wrong, and I have no literal to anchor it to.
- For Climate we shipped your recovered rect (`top = statusBarOffset`, `height = SCREEN_HEIGHT − statusBarOffset − 240`). **Result: the car sits wrong — noticeably more of the hood/frunk is visible than in the official app** — even though the pose (`rotation [0,0,0]`, `offset [0,6,0.6]`, `cam_fov 40`) is byte-identical to theirs. So one of the three inputs (`statusBarOffset`, `240`, or what `SCREEN_HEIGHT` means) is not what we assume.

**We need literals, not derivations.** R5 §5 explicitly left the Controls constants UNRESOLVED; that gap is now the blocker.

---

## §1. Controls — the exact frame `[blocker]`

1. **Resolve `sheetHeight`** (R5 §3c gave `height = SCREEN_HEIGHT − sheetHeight`, R5 §5 marked it UNRESOLVED). Give the literal, its constant name, and where it's defined. Is it static, or does it track a draggable sheet? If dynamic, give the function + inputs + its value at rest.
2. **Resolve the `top_margin`** (R5 §3c said "0 (or a state const)"). Which is it? If a const, its name + value.
3. Dump the **complete `UPDATE_MAIN_VIEW_FRAME` payload** the Controls screen sends, verbatim, constants resolved.
4. **Confirm the pose** it sends (`MOVE_CAMERA`) — is it the `TOP_DOWN` preset (`offset [0,10,0]`, `cam_fov 40`)? Does anything override it per vehicle state (closures open, charging…)?

## §2. Climate — which of our three assumptions is wrong `[blocker]`

Their rect per R5 §3c: `top_margin = statusBarOffset`, `height = SCREEN_HEIGHT − statusBarOffset − 240`.

1. **`statusBarOffset`** — is it the same value as `statusBarHeight` (which R5 gave as 59 on Dynamic-Island phones), or a DIFFERENT variable? Give its definition and its value on a 393×852 Dynamic-Island iPhone. We currently pass `insets.top` (= 59); if `statusBarOffset` is something else, that alone explains our error.
2. **`240`** — is it a named constant? What does it correspond to (their climate sheet's height? a fixed inset?). Give the name and where it's defined. **If it's their sheet height, say so** — ours may be a different height, which changes whether we should copy their literal or use our own sheet's height to get the same *look*.
3. **`SCREEN_HEIGHT`** — exactly which value is this? The full window height (852), the safe-area height, the height excluding the home indicator (~818), or something else? Name the source (`Dimensions.get('window')`? `useWindowDimensions`? a native constant?). This is a prime suspect: a ~34pt difference here shifts the car noticeably.
4. Dump the **complete Climate `UPDATE_MAIN_VIEW_FRAME` payload**, verbatim, constants resolved, and its `MOVE_CAMERA`.
5. Our specific symptom, for you to reconcile: **with their exact pose and (what we believe is) their exact rect, we see MORE HOOD than they do** — i.e. our car sits too high / too small in frame. Given `center_y = top_margin + screen_height/2 · scale` (R6), what `top_margin`/`height` do they actually end up with on a 393×852/59 phone?

## §3. Every OTHER renderer-hosting screen

The user: *"any other camera rotation I assume if exists, important to include!"* Enumerate **all** screens that host the renderer → their `CameraPosition` + their frame payload (constants resolved): Charging, Location, Summon, Security & Drivers, Set Schedules, Service, Energy/Powershare, plus the state-driven poses (CLOSURE_OPEN, TENT_MODE, DRIVE, DRIVE_REVERSE, VEHICLE_TO_HOME). If a screen doesn't host the renderer, say so — equally useful.

## §4. Calibration — the fallback that actually unblocks us

If a constant genuinely won't resolve, give **derived geometry** instead, for a **393×852-pt phone with `statusBarHeight = 59`**, per screen (Controls, Climate, Home as a control):
- the resulting **`root_node.scale`**, and
- the car's **on-screen centre in points** (R6 §4 showed `center_y = top_margin + screen_height/2 · scale` is exact).

With a target scale + centre per screen we solve our frames directly and stop guessing. **A documented "not statically recoverable" plus a calibration target is a good outcome. A guessed constant is not** — we've now shipped two bad guesses off screenshot estimates and the user has called it both times.

## §5. Sanity checks on what we shipped

1. R6 §6 flagged: their `Viewport` has `size = Vector2(790, 875)` + `size_override_stretch = true`. Does the 3D camera's aspect come from the **screen** (via `ViewportContainer.stretch`) or from that **790×875** override? R6 assumed screen aspect and Home now matches on-device, which supports it — **confirm**, because it changes the KEEP_HEIGHT maths on every other screen.
2. `MOVE_CAMERA` carries a fresh `animation_id = uuid.v4()` per call (R5 §3a). What **consumes** it? We send a STABLE per-preset id — could that merge/suppress tweens on rapid navigation?
3. Do camera, frame and env animate **simultaneously** with identical params (we fire all three at 0.5s/QUART/OUT), or are they staggered? Any per-transition overrides of `duration`/`transition_type`/`ease_type`?

---

## Output format

1. **Controls** — resolved `sheetHeight` + `top_margin` + full payload + pose.
2. **Climate** — `statusBarOffset` / `240` / `SCREEN_HEIGHT` defined and resolved + full payload; reconcile the "more hood" symptom.
3. **All other screens** — pose + frame table.
4. **Calibration** — per-screen `scale` + centre in points on a 393×852/59 phone.
5. **Sanity checks** (§5).
6. **Citations**; **Android-only vs iOS-verified** per fact.
7. **Gaps**, plainly. And correct R5 §3b's Controls claim in your findings so nobody trusts it again.
