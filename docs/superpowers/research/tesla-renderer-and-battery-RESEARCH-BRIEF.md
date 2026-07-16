# RESEARCH BRIEF #5 — The 3D renderer (camera, size, shadows) + battery % text/units

**You are the research agent.** Rounds 1–4 are the base — **read them first, do not re-derive**:
- `tesla-app-status-ux-FINDINGS.md` (R1: state machine + copy)
- `tesla-status-visual-FINDINGS.md` (R2 — **contains known errors**, superseded by R3/R4)
- `tesla-status-assets-FINDINGS.md` (R3: assets, colours, header, cold start)
- `tesla-status-polish-FINDINGS.md` (**R4: current source of truth** — dual-platform, verbatim)

Round 4 was the best yet: going to the **iOS bundle** settled the font question, the verbatim style dumps fixed the battery, and you correctly overturned R3's spinner-gate operator (the device agreed with you). Both method rules stay in force for this round:

- **VERBATIM dumps, not summaries.** Complete literals, every key, computations shown *and* resolved.
- **Tag every fact `[iOS-verified]` / `[Android-only]` / `[both-match]` / `[differ]`.** We ship iOS.

**Deliverable:** `docs/superpowers/research/tesla-renderer-and-battery-FINDINGS.md` (+ extracted files in `tesla-status-assets/`).

---

## Context: what we shipped from R4, and the two things still wrong

We implemented R4 in full. The user compares against the real iOS app on his phone. Two of your R4 answers now look suspect on-device, and one whole area (the renderer) has never been mined.

---

## §1. Battery % text — two on-device contradictions with R4 `[settle from opcodes]`

We now render the % label as R4 §1a specified: `fontFamily:'UniversalSansText-Bold'`, `fontSize:16`, `marginHorizontal:10`, colour `#8A8B8B` (`textColorLight`), green `#00E286` while charging.

**Contradiction A — spacing.** R4 §1a gave `marginHorizontal: Specifications.iconMargin /*=10*/`, and R3 §C4 had given **5** for the same property. We shipped 10, and the user reports the % now sits **too far right — it should be closer to the glyph**. So 10 looks wrong on-device and R3's 5 may have been right.
1. Dump `Specifications` **verbatim** (both platforms) and give `iconMargin`'s literal value. Is it 10, or something else?
2. Dump the `batteryText` entry **verbatim** again and confirm the property is `marginHorizontal` (both sides) and not `marginLeft`/`marginRight`/a gap on the container.
3. Is there any **negative margin, padding, or `gap`** on `batteryContainer`/`batteryViewContainer` that offsets it back toward the glyph? R4 §1a lists `batteryContainer` as only `{alignItems:'center', flexDirection:'row'}` — confirm nothing else contributes.
4. **How much horizontal space is there between the nub's right edge and the "7" of "75%" in the real app?** If you can measure it from the layout maths, give the number in points — that's the value we actually need.

**Contradiction B — the typeface.** The user says the % text "**should have been changed**" — i.e. it still doesn't look like the official app's, even though we now use the bundled Universal Sans Bold cut.
5. **What EXACT face does the battery % render in on iOS?** Trace the real resolution: the `<Text>` inherits the TDS category (per R4 §2a, `bodyLabel` ⇒ `fontFamily:'UniversalSansText-Medium'`, no `fontWeight`) and `batteryText` then overrides with `fontWeight:'bold'`. On iOS, `fontFamily:'UniversalSansText-Medium'` + `fontWeight:'bold'` does **not** obviously resolve to the Bold cut — R4 §2b itself warns Medium has its **own family** with subfamily Regular, so there may be no bold face in that family to find. So which is it:
   - the **Bold** cut (`UniversalSansText-Bold`, what we shipped),
   - the **Medium** cut with the `fontWeight` ignored,
   - or a **synthesized/faux bold** of Medium?
   Answer from the actual resolved style at the render site, and say what `fontFamily` string is ultimately passed to the native text node.
6. Same question for `fontSize`: confirm **16** is what the status battery renders (R4 §1e says the status battery passes no custom props — confirm `batteryText` isn't overridden at that call site).

## §2. The % ↔ distance conversion and the switch `[new]`

We toggle locally between `"75%"` and `"312 km"`, and R4 §1e/R3 §C4 left the range string's construction as a gap (`getRemainingBatteryRangeDistanceWithUnit` was never opened).

1. **Open `getRemainingBatteryRangeDistanceWithUnit`** and give the **verbatim** construction of the distance string: which proto field(s) it reads, the km/mi conversion factor, the **rounding** (floor/round/ceil? decimals?), the **separator** (space? non-breaking space? none?), and the unit token ("km"/"mi" — localised?).
2. **Which field is the source** — `battery_range`, `est_battery_range`, `ideal_battery_range`, or a computed value? (Tesla's API exposes several and they differ materially; we currently derive from `chargeState.batteryRange` × 1.60934.)
3. **What picks km vs mi** — a vehicle setting (`gui_distance_units`), a phone locale, or an app preference? Give the exact source and its values.
4. **Is there a transition/animation when the label switches** (crossfade, width animation, layout shift)? The user calls it "the switching effect on the text" — if there's an animation, give its type/duration/easing; if the swap is instant, say so.
5. **Does the label width change cause a layout shift**, or is the text box fixed-width/right-aligned to prevent it?
6. **What happens when there is no range data** — does it fall back to %, render an em-dash, hide? (We currently fall back to %.)
7. Confirm the **default mode** on a fresh install (percent, per R3 §C4's `showEnergy`?) and whether the choice persists locally as well as vehicle-side.

## §3. THE RENDERER — camera, size, position, shadows `[new, and the biggest visual gap]`

**This is the highest-value section.** The user: *"The Tesla godot seems positioned a lil bit differently on the tesla app vs ours. Is it the same size? Same angle? I think it looks bigger on the Tesla app but it could be positioned a bit above or below or maybe positioned above/below and bigger, who knows."* And: *"on controls/climate the shadow is definitely different on our app vs Tesla's."*

Both apps render the car in **Godot 3.2**, and we already know their Godot project and camera poses are recoverable — we previously corrected our Climate camera to their exact `offset [0,6,0.6] fov 40` this way. So please recover the whole set, not one view.

1. **Every camera pose, verbatim, per view/screen** (Home, Controls, Climate, Charging, Location, and any others): the complete frame/state message they send the renderer — camera `offset`/position, `fov`, target/look-at, rotation/angle, orbit params, near/far, and anything else in that payload. Give the exact JS object per view.
2. **How is the pose parameterised by viewport size?** Does `fov`/distance/offset depend on the view's width/height, aspect ratio, safe-area insets, or device class? We build ours with `buildFrame(width, height, cameraMode, …)`, so if their pose is a pure function of the viewport we need that function verbatim — this is the likeliest cause of "looks bigger".
3. **The renderer view's own frame:** how large is the native Godot view and where does it sit? Does it fill the screen, or occupy a band? Is the car vertically centred in it, or offset? Give the layout/style of the container holding `TMGodotView` (or equivalent) on each screen, **verbatim**. "Bigger" could be pose OR viewport OR both — please distinguish.
4. **Is there a device-pixel-ratio / render-scale setting** applied to the Godot surface?
5. **SHADOWS (explicitly reported as different on Controls/Climate):** what lighting/shadow setup does their scene use, and — critically — **is any of it driven from RN per view** (a shadow flag/intensity/light position in the frame message), or is it entirely inside the Godot scene? If RN drives it, dump those values per view. If it's scene-side, tell us which nodes/resources in `assets/godot/` define the light + shadow (name the scene/node paths) so we can compare against ours.
6. **Ground/shadow plane:** is the shadow a real shadow-map, a baked blob/decal texture under the car, or both? If there's a blob/decal asset, **extract it**. Give its size/opacity/blend.
7. **Environment:** background colour/gradient, ambient light, tonemap/exposure settings on their scene — anything that would make the same GLB read differently from ours.
8. **Does the pose animate between screens** (a camera tween on navigation)? Duration/easing if so.

Useful context: our renderer is the same stock Godot 3.2.2 engine and (for Model Y) byte-identical seat/body assets, so any difference is almost certainly **camera pose, viewport, or lighting** rather than the model.

---

## Output format

1. **Battery % text** — `Specifications` verbatim + `iconMargin`; the resolved face at the render site; the real gap in points.
2. **% ↔ distance** — the verbatim range-string construction, unit source, switch animation.
3. **Renderer** — per-view camera poses verbatim; the viewport/pose relationship; the renderer view's layout; shadow/light setup + any extracted assets.
4. **Citations** for every fact; **Android-only vs iOS-verified** tagged per answer.
5. **Gaps**, stated plainly.
6. **Traps** — anything else in these areas where our implementation (as described above) would diverge visibly.
