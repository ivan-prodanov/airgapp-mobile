# RESEARCH BRIEF #11 — The Climate sheet DOES slide up. Find the mechanism. Plus a dark line at the top of Climate.

**You are the research agent.** Rounds 1–10 are the base. **Round 10 was excellent** — the two-clock fade model, the four-tier `frunk_color` sampling, and the marker colour set all shipped, and you corrected both R8's phantom 118px parallax and your own recon. That standard is what this round needs, because it has to overturn one of your own conclusions.

**Rules:** VERBATIM, unfiltered reads. Tag `[iOS-verified]` / `[both-match]` / `[differ]`. Gaps stated plainly.

**Deliverable:** `docs/superpowers/research/tesla-climate-sheet-slide-FINDINGS.md`

---

## §1. The sheet slides. This is not in question — find HOW. `[whole round]`

R10 §3a concluded:

> *"`animateOnMount: false` is real and is honoured… Climate takes the **else** branch: a bare shared-value write, **instantaneous**… **the observed slide-up is not in the bundle**… what reads as a 'slide-up' is most likely the card's `forFade`."*

**The user has re-checked on the device and is certain: the sheet SLIDES UP from below.** Not a fade — a translation. Treat this as **ground truth and non-negotiable**; his device reports have overturned the findings four times now (the Controls-is-PARKED claim, the spinner-gate operator, R7's flattened status-bar table, R8's parallax). **A `forFade` opacity ramp cannot look like a slide, so §3a's hypothesis is wrong.** The mechanism exists — find it.

**Do not re-litigate `animateOnMount`.** Accept it is `false`, accept the mount write is instantaneous, and ask the next question: **what moves the sheet AFTER that?**

### The lead R10 missed (test this first)

`animateOnMount: false` only suppresses the **MOUNT** animation. But R10 §1a also recorded **`enableDynamicSizing: true`**, and R8 §1b established the second detent is `contentHeight + handleHeight`, **measured at runtime by `BottomSheetView.onLayout`**. So the sequence is:

1. mount → `animatedPosition` written **instantly** to the pre-layout position (`INITIAL_POSITION = SCREEN_HEIGHT = 852`, i.e. off-screen bottom);
2. content lays out → `enableDynamicSizing` **recomputes the snap points** → the resolved detent 0 becomes **582**;
3. that is a **snap-point CHANGE, not a mount** → does gorhom call `animateToPosition(..., ANIMATION_SOURCE.SNAP_POINT_CHANGE)` here — which **would** animate, 852 → 582, i.e. **a slide up from below**?

**Answer this precisely, from the live module** (R10 flagged the live copy for Climate as module **4120**, not the 4054 copy R8 cited):
1. What runs on the `isLayoutCalculated` false→true transition, and on a snap-point recompute? Dump those handlers **verbatim** (`useAnimatedReaction`, `useEffect`, `animateToPosition` call sites, and every `ANIMATION_SOURCE`).
2. Is `animateOnMount` consulted **only** on the mount path, or does it gate later animations too?
3. If `animateToPosition` does run: give its **full config** — spring or timing? the exact `stiffness`/`damping`/`mass`/`duration`/`easing`, and where those defaults come from (`animationConfigs` prop? gorhom's default? Reanimated's `withSpring` defaults?). Climate passes no `animationConfigs` as far as we know — **confirm** and give what it therefore falls back to.
4. From what Y to what Y, in points, on a **420×912 / statusBarOffset 59** phone (our target). Our sheet's collapsed detent is their 270 → top **582**.

### If that lead is wrong, keep going — it slides, so something moves it
5. Any `withTiming`/`withSpring`/`withDecay` on the sheet container, its parent, or `animatedPosition`/`animatedIndex`.
6. Any `LayoutAnimation`, `Layout`/`entering` (Reanimated layout animations), `FadeInDown`/`SlideInDown`, or `configureNext`.
7. Anything **outside** gorhom translating the sheet — a wrapping `Animated.View`, a keyboard handler, the screen's own transform.
8. Does the **card** transition contribute a translate after all? R10 says the Climate route uses `forFade` (opacity only) — **re-verify from the route's options object**, since R8 got the neighbouring merge wrong.

## §2. A dark shadow/tint line across the TOP of the Climate view

The user: *"There's a dark shadow/tint line at the very top of the screen on climate view (at the end of the frunk where the windscreen starts — but could be unrelated to the car at all, very likely). Find out how!"*

It sits near the **top edge of the screen**, roughly where the car's windscreen meets the frunk. It may be UI, not car.

1. Is there a **gradient / scrim / overlay / shadow** at the top of the Climate screen? Look for `LinearGradient`, a `shadowStyle`/`overlayStyle` from the card, a status-bar scrim, a header backdrop, or an absolutely-positioned dark View. Dump the component + its **verbatim** style (colours, stops, height, opacity, blend).
2. If nothing in RN: is it **renderer-side**? Candidates: the `Background` MeshInstance under the Camera (R6 `mobile.tscn` shows one at `transform=(75,0,0, 0,-1.22e-05,-75, 0,75,-1.22e-05, 0,0,-149)`, `visible = false` — does Climate turn it **on**?); the `SET_SCREEN_OVERLAY_COLOR` quad; the environment's `fog_depth_begin/end` (R5 §3d recorded `fog_depth_end = 35.5` on `ap_scene_env.tres`); or a vignette.
3. Is it **paint/car dependent**, or fixed chrome? Does it appear on Controls/Home too, or Climate only?
4. Give its exact geometry (height/position in points) and colour(s) so we can reproduce or rule it out.

---

## Output format
1. **The slide** — the exact mechanism, verbatim, with the animation config and the from→to in points. If `animateOnMount:false` coexists with a real slide, explain how (that's the interesting part).
2. **The top line** — what it is, RN or renderer, verbatim style/geometry, and whether it's Climate-only.
3. **Citations**; iOS-verified vs Android-only. **Gaps**, plainly.

**Note on §1:** "not in the bundle" is not an available answer this round — the user watched it happen. If you genuinely cannot find it, say exactly where you looked and what you ruled out, so we can capture it in slow motion and work backwards.
