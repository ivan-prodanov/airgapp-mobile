# RESEARCH BRIEF #4 — Battery glyph verbatim, the font, resume behaviour, asleep presentation

**You are the research agent.** Rounds 1–3 are the base — **read them first, do not re-derive**:
- `tesla-app-status-ux-FINDINGS.md` (state machine + copy)
- `tesla-status-visual-FINDINGS.md` (component tree, typography, spinner) — **contains known errors, corrected by Round 3**
- `tesla-status-assets-FINDINGS.md` (Round 3: assets, colours, header, cold start) — **the current source of truth**

Round 3 was excellent: the extracted `mini_spinner.png`, the resolved `#8A8B8B`, the header tree and the cold-start mechanism all shipped and the user confirms the app now looks close. Round 4 is the last mile — the user is now comparing **pixel by pixel against the real app on his phone** and finding small, specific deltas.

**Deliverable:** `docs/superpowers/research/tesla-status-polish-FINDINGS.md` (+ any extracted files in `docs/superpowers/research/tesla-status-assets/`).

**Same rules:** citations for every fact; **INFERRED**/**UNRESOLVED** marked; gaps stated plainly.

---

## ⚠️ Method note that matters this round: prefer VERBATIM dumps over summaries

Twice now a summarised finding has cost us a shipped bug (Round 2's §3 prose contradicted its own §1 tree; Round 2's `marginTop:10` missed a `Mul` by 0.5). For every style object requested below, **dump the COMPLETE literal, every key, exactly as it appears** — do not paraphrase, do not omit keys that look irrelevant, do not round. If a value is computed (`Gutter * 0.5`), show the computation AND the result.

## ⚠️ Platform note that may matter a lot: we are on iOS, you have been mining the ANDROID APK

The user compares our iOS app against the **official iOS app**. Rounds 1–3 mined `com.teslamotors.tesla` (Android). Most RN code is shared, but **fonts, spinners and native layout can differ per platform**. Per our notes the iOS app's Hermes bundle also decompiles (`~/.local/bin/hbc-decompiler`, Hermes v96).

**For every answer below, say whether you verified it on Android only, or on iOS too.** Where the two differ, give BOTH and mark which is which. If checking the iOS bundle is impractical, say so explicitly rather than presenting Android values as universal — we ship iOS, so an Android-only value is a guess for us.

---

## §1. The battery glyph — verbatim (highest priority)

The user's side-by-side (official vs ours) shows we're close but off. Ours renders from Round 3 §C3: a 35×16 `View` with `borderWidth:1, borderRadius:3, borderColor:#2D2F34`, an absolutely positioned fill of height `16-2` at `left:1`, and an approximated nub.

Two visible deltas in his screenshots:
- **The official fill appears INSET** — a clear margin between the fill and the body on the top, bottom and left. Ours runs flush to the inner edge (height 14 = 16 − 2×border).
- **The official body's interior looks FILLED** (slightly lighter than the page background), not a stroke around a transparent interior.
- **The nub** differs in shape/size/placement (ours is a detached bar; theirs reads as a small rounded tab close to the body).

Give us, verbatim:
1. **The COMPLETE StyleSheet literal** for `MiniBatteryView`'s styles (#117264) and `ChargeStatus` (#117220) — every key of every entry, including any `backgroundColor`, `padding`, `margin`, `overflow`, `opacity` we haven't been told about.
2. **Does the battery body have a `backgroundColor`** (not just `borderColor`)? If yes, the token + resolved hex.
3. **The fill's exact box**: its `top`/`left`/`height`/`width` computation verbatim, and whether any padding/inset separates it from the border. Reconcile with the screenshot showing a visible margin — if the fill really is `height: 16-2` at `left: 1`, say so and note the screenshot disagrees.
4. **`battery_nipple`** — the nub. We need the **actual glyph**: the icon-font file + codepoint, or the vector `d=` path. Round 3 §H.5 left the path unrecovered and our approximation is visibly wrong. Also: its **exact box** (4×16?), its **margin/gap from the body**, its **colour**, and how it's composed (is it inside the body's row? absolutely positioned? overlapping the border?).
5. **The icon-font itself**: name the font file in the APK and give us the file, so we can render `battery_nipple` (and later `charging_bolt` etc.) exactly instead of approximating.
6. Confirm **borderRadius 3 / borderWidth 1 / 35×16** are the values on the code path the standard (non-Cybertruck) dark theme actually takes — the user's official screenshot looks more rounded than our radius-3 render.

## §2. Typography — the 1px width delta

The user measured our status text against theirs: **identical pixel height, but the official is ~1px wider** for the same string. He guesses "slightly bolder? seems same font". We render 14 / lineHeight 20 / weight '500' / letterSpacing 0.1 in the **iOS system font (SF)**, because Round 3 named the family as `UniversalSansText` but we have no such font.

1. **Extract the font file(s)** — `UniversalSansText` (and `UniversalSansDisplay`) — from the APK and hand them over, with the exact PostScript/family name and the weight→file mapping. If they're only in the Android package, say whether the iOS app ships the same faces.
2. **On iOS, what font does the status text actually render in?** The system font, or a bundled Universal Sans? This is the likeliest cause of a sub-pixel width delta and we need it settled, not assumed.
3. Confirm **verbatim** the resolved text style at the status line's render site on iOS: `fontSize`, `fontWeight`, `fontFamily`, `letterSpacing`, `lineHeight` — including any platform `select`/override that changes them from the Android values.
4. Is any **`allowFontScaling` / `maxFontSizeMultiplier` / transform** applied that would alter advance widths?

## §3. Resume behaviour — "it refreshes every time I open the app"

The user reports our app visibly refreshes on every open, and the official app does not. We need their resume contract:

1. **On foreground/resume, what does the official app actually do?** Does it re-fetch `vehicle_data` immediately, wait for the next poll tick, or rely on a push? Cite the AppState/lifecycle handler.
2. **What does the user SEE on resume** — does the spinner appear? does the status text change? is any part of the UI re-mounted or re-loaded? Specifically: does the 3D/Godot renderer reload or re-animate on resume, or is it kept alive in the background?
3. **Poll cadence**: Round 1 §1.6 recorded 5000 ms online / 1200 ms offline. Confirm those, say what they are on resume specifically, and whether polling is suspended while backgrounded.
4. **Is there a "don't refetch if data is fresh" guard on resume** (e.g. reusing the 2-minute `fetchedDataRecently` window), so a quick app-switch shows cached data with no visible work? That's our leading hypothesis for why theirs feels static and ours feels like a reload.
5. Does the app keep its **BLE/session** alive across backgrounding, or tear down and re-establish (we tear down on background and rebuild on foreground — that may be what he's seeing)?

## §4. Asleep presentation — "they just dim the Godot animation"

The user says our asleep state "looks way different" and that the official app **just dims the Godot animation**. Ours overlays `rgba(0,0,0,0.6)` — a 60% blackout — across the renderer.

1. **Exactly how does the official app present an asleep vehicle?** Is it an RN overlay over the renderer, an `opacity` on the renderer view, or a **renderer-side/Godot state flag** (we know their renderer IS Godot 3.2 and that they drive it via `mobile_app_state`, e.g. `is_loading`)? Name the mechanism.
2. If it's an overlay/opacity: the **exact colour + alpha, or opacity value**, and which view it covers (the renderer only, or the whole screen?).
3. If it's renderer-side: **which `mobile_app_state` field** (or equivalent) carries asleep, what values it takes, and what the Godot scene does with it (dim lights? darken material? stop an animation?). If the scene's handling is visible in `assets/godot/` in `split_assets_pack.apk`, quote it.
4. **Is there any transition** (fade in/out, duration/easing) between awake and asleep?
5. **What ELSE changes when asleep** — are the favourite/control buttons disabled or dimmed? does the car name/battery change appearance? Round 3 §C3 tells us the battery row dims to 0.5 on *stale data*; is asleep a separate treatment or the same one?
6. Is the asleep dim tied to **`awake`/sleep state** or to **data staleness**? (These are different conditions and we may have conflated them.)

## §5. Where the spinner is used app-wide

The user wants the real `mini_spinner.png` on **every** in-flight affordance, not just the header. We've now put `BusyIcon` on the control buttons at its default size 20.

1. **Enumerate where the official app renders `BusyIcon`** (or any spinner) — header status, control/action buttons, sheets, etc. — and the **size passed at each site** (we know the header overrides to 18 and the component defaults to 20).
2. **When a control button has a command in flight, what does the official app show?** Round 1 §2.x drove our "replace the icon with a spinner" behaviour — confirm it's the same `BusyIcon` asset, at what size, in what colour, and whether the icon is replaced or the spinner is placed alongside.
3. Is the spinner ever **tinted** at any site (Round 3 says the header passes no tint → renders white)?
4. `iconButtonBusyOpacity: 0.5` appears in their design-system `Specifications` (Round 2 §2) — **where is that applied**? Is a busy button's whole content dimmed to 0.5 while a command is in flight? That would be a behaviour we're missing.

---

## Output format

1. **Battery glyph** — verbatim style literals, the nub glyph (file/path), the font file, reconciliation with the screenshot.
2. **Typography** — font files + the resolved iOS text style; the likely source of the 1px delta.
3. **Resume** — the lifecycle contract and what's visible.
4. **Asleep** — the exact mechanism + values, and what else changes.
5. **Spinner usage** — site → size → tint; the busy-opacity rule.
6. **Citations** for every fact, and **Android-only vs iOS-verified** marked per answer.
7. **Gaps**, stated plainly.
8. **Traps** — anything else where our current implementation (described above) would diverge visibly.
