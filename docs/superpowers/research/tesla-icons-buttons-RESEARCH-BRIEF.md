# RESEARCH BRIEF #12 — The seat/wheel climate icons, the Button's default textStyle, and the fade's retrigger rule

**You are the research agent.** Rounds 1–11 are the base.

**Round 11 was the best round of the effort.** You overturned your own R10 §3a conclusion, found that **`animateOnMount: false` is what *causes* the slide** (`isAnimatedOnMount = !animateOnMount` ⇒ the mount branch is dead code ⇒ it always animates), and located the translate in **`BottomSheetBody` module 4126** — a module nobody had opened, which is exactly why every prior round concluded "not in the bundle". The user was right and the docs were wrong, again. The method note about Reanimated worklets retaining readable JS source is gold; keep using it.

**Rules:** VERBATIM, unfiltered. Tag `[iOS-verified]` / `[both-match]` / `[differ]`. Gaps stated plainly — **"not recoverable" is a fine answer; a plausible guess is not.**

**Deliverable:** `docs/superpowers/research/tesla-icons-buttons-FINDINGS.md` (+ extracted files in `docs/superpowers/research/tesla-status-assets/`).

> **Note:** §1 and §2 were appended to brief #11 after it had already been handed to you, so you never saw them. They are the two highest-value open items.

---

## §1. EXTRACT the seat/wheel climate icons — the user has decided to adopt their design `[highest value]`

R10 §3b's headline: **"the level is carried entirely by the icon asset"** — seats are `buttonHeaterOn` **#FF3A3A at every level including OFF**; they never grey out, only the steering wheel does; there is no `buttonCoolerOff` token.

We shipped that rule and the user rejected it on sight — for a reason §3b implies but doesn't spell out. **Our marker is a wave FILL with no seat body**, so "red at level 0" renders as red waves and reads as **ON**. Theirs is `seat_climate_0` — a red seat glyph **with no waves in the artwork** — which reads as **OFF while still being red**. Their tint token is correct and simply has **no valid value for our design**, so we have been hand-tuning a grey their palette doesn't contain (currently `rgba(235,235,235,0.92)`, device-tuned, ours).

**The user's call: do it their way.** That needs their artwork.

1. **Extract `seat_climate_0` / `_1` / `_2` / `_3`** — the four assets `seatHeatingIcon` (#97708, iOS 3987896-3987975) and `seatCoolingIcon` (iOS 3987814-3987893) return. Real files into `tesla-status-assets/`, every density/variant, with APK/IPA source path, intrinsic size and format.
2. **Are they PNGs, or `react-native-svg` `<Path>` components?** Precedent that makes this a real question: `battery_nipple` (R4 §1d) *looked* like an icon-font glyph and turned out to be an **SVG `<Path>` in a lazy component registry**. If vector, the **verbatim `d=` + viewBox** is directly usable and we need no image at all.
3. Confirm heating and cooling really return the **same four assets** (R10 §3c says "structurally identical") — i.e. cooling reuses the heating artwork and only the tint differs. If the cooling artwork is separate, extract it too.
4. **The steering-wheel icons**: the equivalent per-level assets, plus the **yoke** variant if one exists (we render both — `steeringWheelType: 'round' | 'yoke'`).
5. **How does the artwork take the tint?** A single-colour mask consuming `iconStyle.color` (like `mini_spinner.png`'s white alpha ramp), or multi-colour art? Is the seat body one asset with the waves baked in, or are body and waves separate layers?
6. **Render box**: R10 §3c gives `SEAT_HEATER_BUTTON_SIZE = 55` — confirm that's the icon's box, and give the icon's own size/padding within it so the artwork lands at their scale.
7. Anything **paint-dependent** here (as the frunk label is, R10 §2c), or is the seat tint purely heat/cool?

## §2. The shared `Button`'s default textStyle — R10 §2b left this open and it shipped a bug

R10 §2b dumped the Controls marker label style verbatim and correctly noted it carries **no `fontWeight` and no `fontFamily`**, adding: *"Weight/family come from the shared `Button` component's defaults."* **But it never recovered those defaults.**

We took the literal at face value, dropped our `fontWeight: '600'`, and shipped — which did **not** inherit Tesla's default; it fell back to **RN's regular 400**. The user immediately reported the label was no longer bold enough and that our previous 600 had matched. **We've restored 600 on his word alone** — it is currently marked in our code as device-verified, not recovered.

1. **The shared `Button`'s default `textStyle`**, verbatim — `fontFamily`, `fontWeight`, `fontSize`, `letterSpacing`, `lineHeight` — as resolved for `appearance={ButtonAppearance.GHOST}` (what the frunk/trunk labels use).
2. Does it route through the TDS `<Text category=…>` path (a `Typography` entry → `getFontStyle` → a `UniversalSansText-*` PostScript name, as R5 §2a established for the status line)? If so, **which category** ⇒ **which cut**?
3. If it resolves to a Universal Sans cut, name it — **we already ship `UniversalSans-Text-Medium-540.ttf`** and can add a face. Remember R5 §1b's trap: their name table gives Medium its **own single-face family**, so `fontFamily` + `fontWeight` cannot reach a different cut — only the PostScript name selects weight.
4. Does `ButtonAppearance.GHOST` alter the text style (weight/opacity) vs the default appearance?
5. Same for the bottom row's `ControlButton` (`ControlButtonAppearance.STATELESS_GHOST`) — its label's resolved family/weight/size.

## §3. The content fade — what RE-triggers it? `[blocks our implementation]`

R10 §1c gave us the fade precisely: one shared `Animated.Value(0)` per screen, **300 ms `Easing.cubic`, `useNativeDriver: true`**, started **inside the vehicle-markers callback** (`getVehicleMarkers → setMarkers → .start()`), driving 10 opacity sites on Controls (5 markers + 5 buttons) and its own value on Climate's overlay. We're implementing it now, and two things decide whether it flickers:

1. **Does the fade restart on EVERY markers response, or only the first?** Markers are re-requested when the camera settles; if a later `VEHICLE_MARKERS_RESPONSE` re-runs `.start()` from the current value it's harmless, but if anything resets the value to 0 first, the markers would blink mid-session. Give the exact code path: is `.start()` guarded (a ref/flag/`useEffect` dep), or does it fire on every response?
2. **What resets the value to 0** — unmount only, or a blur/focus effect? R10 §1c notes Android calls `fade.stopAnimation()` at the head of the focus branch and iOS does not `[differ]` — what is iOS's reset path, if any?
3. Home's content fade is `duration = isFocused ? 300 : 0` (R10 §1c) — confirm the **leave** case really is `0` (instant blank) and that it is not also gated on markers.
4. Our Controls/Climate are **in-page panels, not routes**, so we have no card fade — only the content clock. Is there anything else in their content fade that assumes a card is fading underneath it (e.g. a starting opacity ≠ 0)?

---

## Output format
1. **The icons** — extracted files or verbatim vector paths; composition, tint mechanism, render box.
2. **Button textStyle** — resolved family/weight, the cut to ship.
3. **The fade's retrigger/reset rule.**
4. **Citations**; iOS-verified vs Android-only. **Gaps**, plainly.
