# RESEARCH BRIEF #10 — Screen-transition fades, and the Controls/Climate marker styling

**You are the research agent.** Rounds 1–9 are the base.

**Round 9 was the best round of the whole effort.** You dumped `getAdjustedStatusBarHeight` unfiltered, had it re-derived twice, and **loudly corrected your own R7 §2b** — which had flattened four return values into "→ 59" *and* fabricated a notch predicate that does not exist. That correction shipped; the app now mirrors your verbatim chain (including the SE-3-routes-to-the-library row and the mini carve-outs), and the 1.5% Climate error is gone. The method note that produced it — *read unfiltered, never infer a mapping from line adjacency* — is exactly right and should stay in force here.

**Rules:** **VERBATIM dumps, not summaries.** Tag every fact `[iOS-verified]` / `[both-match]` / `[differ]` / `[Android-only]` — we ship iOS. State gaps plainly; **"not recoverable" is a fine answer, a plausible-looking guess is not.**

**Deliverable:** `docs/superpowers/research/tesla-transitions-markers-FINDINGS.md`

---

## Context: what our app does today (so you can aim at the deltas)

- **Transitions:** expo-router `<Stack>` with `animation: 'slide_from_right'`. Nothing fades. Every element appears at full opacity the instant the screen mounts.
- **Controls markers** (`src/godot/MarkerOverlay.tsx`): RN views positioned over the Godot surface. Label style is hardcoded `{fontSize: 19, fontWeight: '600', color: 'rgba(255,255,255,0.92)'}`. **No car-colour logic at all.**
- **Climate markers** (`src/godot/ClimateMarkerOverlay.tsx`): seat/wheel heater glyphs. Our heat/cool/auto/off colours are **our own invention**, never recovered.
- Neither overlay has any opacity/fade animation.

The user's five reports, verbatim:
1. *"When transition to/from home screen, all elements are suddenly shown on our app, but on tesla's app they fade in."*
2. *"Same when transitioning to/from Controls — both the markers on the car AND the buttons on the bottom."*
3. *"I want the styling (size, color, text) of the markers on the Controls. I know for a fact the text is not white if the car is white — there is such logic somewhere."*
4. *"Same as 2 for the climate view. Not only are markers fading but the sheet on the bottom is sliding up on the Tesla app."*
5. *"Climate view: the markers have a different color when they aren't enabled (heat/cold)."*

---

## §1. The screen-transition contract — what fades, what slides, per route

R8 §3 already established (please re-confirm, then go deeper):
- `AppStack = createStackNavigator()`, `screenOptions = {headerShown:false, presentation:'card', ...TransitionPresets.SlideFromRightIOS}`.
- `TransitionIOSSpec` = spring `{stiffness:1000, damping:500, mass:3, overshootClamping:true, restDisplacementThreshold:10, restSpeedThreshold:10}` → card settles ~479 ms.
- The **Controls** route overrides only `cardStyleInterpolator` → Tesla's `forFade` (`opacity = current.progress`) + `detachPreviousScreen:false`; `transitionSpec` is inherited.
- Home's outgoing card uses `forHorizontalIOS` → `translateX → [0, −0.3 × layout.width]`.

Now settle the user's #1/#2/#4:
1. **Per-route options, VERBATIM**, for **every** renderer-hosting route (Home, Controls, Climate, Charging, Energy, Service): `cardStyleInterpolator`, `transitionSpec`, `detachPreviousScreen`, `gestureEnabled`, `presentation`, `animationEnabled`, `cardOverlayEnabled`, `cardStyle`. Dump each route's options object as written.
2. **Is the fade the CARD's, or per-element?** i.e. does everything inside the screen (markers, bottom buttons, sheet) fade simply because the card's `opacity` animates — or do individual components ALSO run their own entrance animations? This is the crux of #1/#2: if it's just the card, our fix is one `cardStyleInterpolator`; if elements animate independently, we need each one.
3. **Home specifically (#1):** the user says elements *fade in* on Home too. Home is the root/initial route. What animates on Home — on cold start, and on **pop back from Controls/Climate**? Is there an entrance animation on the header/favourites-row/menu rows themselves, separate from the card? Give the exact opacity/translate curves if so.
4. **`forFade` verbatim** (iOS 1979635) — the full interpolator, not just the opacity line. Does it touch transform/overlay too?
5. Does anything **stagger** (per-element delays), or is it one synchronised curve?

## §2. The Controls markers — styling + the car-colour logic `[user is certain this exists]`

The user: *"the text is not white if the car is white — there is such logic somewhere."* Find it.

1. **Are the Controls markers RN views over the Godot surface, or drawn in the Godot scene?** (Ours are RN.) If RN: which component, and how are they positioned against the renderer (a marker/anchor message from Godot?). If Godot: which node/script.
2. **Complete style literals, VERBATIM**, for the marker labels (the "Open" frunk/trunk labels, the centre lock glyph, and any others on that screen): `fontSize`, `fontWeight`, `fontFamily`, `letterSpacing`, `lineHeight`, `color`, plus any container/backdrop/shadow.
3. **THE CAR-COLOUR LOGIC — the main ask.** Find the code that changes the marker text/glyph colour based on the vehicle's paint. Give:
   - the **exact predicate** (which field — `exterior_color`? a paint id? a computed luminance?),
   - the **full mapping** (which paints → which colour), verbatim, resolved to hexes,
   - where it lives (a selector? a per-paint table? a shader?),
   - and whether it affects **text only** or icons/backdrops too.
   The user's car is **red (Model Y)**; a **white** car is the case he's sure about. If there's a threshold/luminance rule rather than a table, give the formula.
4. Which **other** elements on Controls take that treatment (the Flash/Honk/Start/Vent bottom row? the lock glyph?).
5. **The bottom button row (#2):** its component + verbatim styles, and whether it fades with the card or on its own.

## §3. Climate — the sheet's slide-up, and the marker colours

**⚠️ A contradiction to settle first.** R8 §1a dumped the Climate BottomSheet's props verbatim, including **`'animateOnMount': false`**. But the user observes the sheet **sliding up** on entry. Both can't be true as stated. Resolve it:
1. Re-read those props unfiltered. Is `animateOnMount` really `false`? If so, **what produces the observed slide-up** — the card transition moving the whole screen? a separate `Animated` on the sheet container? gorhom's own mount behaviour despite the flag?
2. Give the sheet's **entrance animation** exactly: what property, from what to what, duration/easing/spring config, and what triggers it.

**The marker colours (#5).** The user: *"the markers have a different color when they aren't enabled (heat/cold)."* Ours are invented — replace them with theirs:
3. **The seat/steering-wheel heater glyph**, VERBATIM: the full colour set for **every** state — off/disabled, on at each level (1/2/3), auto, cool if it exists — as tokens **and** resolved hexes. Distinguish *disabled* (unavailable) from *off* (available, not on) if they differ.
4. The glyph's **geometry**: size, the wave/level rendering (how levels fill), the wheel/yoke icon, and how it's tinted.
5. Do the Climate markers **fade with the card**, or run their own entrance (#4)?
6. Same car-colour question as §2.3: does paint affect the Climate markers too?

---

## Output format
1. **Transition table** — route → verbatim options; card-fade vs per-element, answered plainly.
2. **Controls markers** — verbatim styles + **the car-colour predicate and its full mapping**.
3. **Climate** — the sheet's real entrance animation (and the `animateOnMount:false` contradiction resolved); the marker colour set for every state.
4. **Citations**; **iOS-verified vs Android-only** per fact. **Gaps**, plainly.
