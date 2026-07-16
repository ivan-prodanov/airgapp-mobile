# RESEARCH BRIEF #3 — Status area: real ASSETS, resolved COLOURS, header layout, cold-start state

**You are the research agent.** Rounds 1 and 2 were good work and are the base — **read them first, do not re-derive**:
- `docs/superpowers/research/tesla-app-status-ux-FINDINGS.md` (state machine + copy)
- `docs/superpowers/research/tesla-status-visual-FINDINGS.md` (component tree, typography, spinner)

Round 3 exists because we shipped an implementation from Round 2 and **the user compared it against the real app on his phone and found us wrong in ways the findings didn't cover — and in one case, contradicted**. This round is about **ending the guessing**: extract the actual asset files, resolve the actual colour hexes, and pin down the header layout + cold-start behaviour. Where you cannot recover something, say so — but this round should minimise "INFERRED".

**Deliverable:** `docs/superpowers/research/tesla-status-assets-FINDINGS.md`, plus **real extracted files** in `docs/superpowers/research/tesla-status-assets/` (see §D — we want the bytes, not just names).

**Same rules:** citations for every fact; **INFERRED** / **UNRESOLVED** marked; a documented gap beats a plausible guess.

---

## Ground truth from the user's device (treat as authoritative; explain the mechanism)

Observed on the real app, and each one contradicts or exceeds our findings:

1. **On app open (cold start), the status reads "Last seen {x} ago" — NOT "Connecting".** Round 2 documented "Connecting" as the null/undetermined fallback, so we made cold start render it. Wrong in practice.
2. **The battery indicator sits on its OWN row ABOVE the status text**, not inline beside it. **Tapping the battery toggles % ↔ distance (km/range).**
3. **On pull-to-refresh, or on tapping, a spinner appears** — evidently *alongside the existing status text*, not only with "Connecting".

---

## A. Resolve a direct contradiction inside Round 2's own findings (highest priority)

`tesla-status-visual-FINDINGS.md` says two incompatible things about the spinner:
- **§1 component tree:** the spinner is a **sibling** of the status `Text` inside `statusTextContainer`, gated by `showLoadingSpinner` (`JmpFalse off 0xb63`) — i.e. independent of *which* status string renders.
- **§3 prose:** *"the spinner is emitted **only** in the 'Connecting'/undetermined status branch… In every concrete state (Parked/Charging/Asleep/…) the flag is `false` → no spinner."*

The user's observation (3) says the spinner appears **with** a concrete status. Settle it from the bytecode, with opcode evidence:
- Is the `showLoadingSpinner` gate **structurally independent** of the status-string selection (sibling), or nested inside the Connecting branch?
- Give the **exact control flow** of `VehicleStatusText` #117231's render: where `showLoadingSpinner` (Reg14) is computed, where the status string is chosen, and whether one dominates the other.
- **Which status strings can co-render with the spinner?** Specifically: can "Last seen {{age}} ago" or "Asleep {{age}}" render **with** the spinner? Show the branch proof.
- Resolve `canWake` (`getSelectedVehicleCanWake`) and `fetchedDataRecently` (`getSelectedVehicleDataFetchedRecently`): what makes each true/false, and **the exact "recent" threshold in ms** (Round 2 §8.4 left this open — find the `TimeInMs` constant). This determines whether an asleep/offline car spins permanently or only briefly.

## B. Cold start: why "Last seen {x} ago" and not "Connecting"

- Is vehicle data (and its `lastUpdated` timestamp) **persisted across app launches** (redux-persist / MMKV / AsyncStorage / SQLite)? Name the store, the persisted slice/keys, and whether the timestamp survives a cold start.
- At cold start with cached data present, **what exactly renders** — status string, spinner or not — before the first successful network/BLE read? Trace it.
- Is the "Connecting" null-fallback then only reachable for a car that has **never** been fetched (fresh install / newly added vehicle)? Confirm or correct.
- What is the timestamp measured from — last successful `vehicle_data` fetch, last push, or a server-supplied field? Which field feeds `vehicleDataLastUpdatedString` (#30315)?
- Does the app also persist and **immediately render the cached battery %** at cold start (relevant: our battery would otherwise pop in late)?

## C. Header layout + the battery indicator

- The **exact render tree of the home header** (`HomeHeader` #117234 / `VehicleHomeHeader` #117239): what is on the top row (car name? battery? %? icons?) and what is below it, with the **container styles** (flexDirection, alignItems, gaps, margins/paddings) that produce that stacking. We need to know precisely what sits above the status line and what's beside it.
- The **battery indicator component**: its full structure — the battery glyph/outline, the fill, the % text. Recover **fill geometry** (width mapping, corner radii, border width/colour), **sizes**, and **spacing**.
- **The % ↔ distance tap toggle** (user observation 2): which component owns it, what the tap dispatches, what the two display modes are, the exact formatting of each (`"75%"` vs `"312 km"` — units, rounding, i18n keys), whether it persists, and whether it also affects anything else.
- **Battery colours per state**: normal / charging / low. Round 2 found the native widget's `battery_charging_color #00e185` and `battery_level_warning_color #ffc106` — confirm whether the **RN home header** uses those same values or different tokens, and **at what percentage the low/warning threshold trips**.

## D. THE ASSETS — extract the actual files (do not just name them)

Copy real files into `docs/superpowers/research/tesla-status-assets/` and list each with its source path inside the APK:
- **`mini_spinner.png`** — every density variant present (@1x/@2x/@3x or `drawable-*dpi`). This is the exact spinner we want to render instead of RN's `ActivityIndicator`. Note its **intrinsic pixel size**, whether it has built-in transparency/alpha ramp, and whether it is tinted at runtime or used as-is (Round 2 says "no tint" — confirm).
- **The battery glyph/icon** used by the RN home header — as an actual file. If it is **vector data compiled into the JS bundle** (Round 2 says RN glyphs are icon-font/vector in-bundle, not native drawables), then **extract the vector path data / the icon-font glyph** and give it to us in a usable form (SVG path string is ideal). Same for any bolt/charging glyph in that row.
- Any **status-area icons** that actually render in the home header (Round 2 says there are none besides the spinner — confirm now that we know the findings had errors).
- If an asset only exists inside a font or a sprite, say so explicitly and give us the glyph codepoint + the font file.

**Bundle asset note:** RN `asset:/img/mini_spinner.png` typically lands in the APK under `assets/` or as `res/drawable-*/img_mini_spinner.png` after RN asset packaging — check both, and check `res/raw/` for Lottie JSON.

## E. Colours — resolve the hexes (Round 2's #1 gap)

Round 2 left the single most important colour **UNRESOLVED**: `theme.textColorLight`, the status-text colour. Chase the theme accessor to its literal:
- **`theme.textColorLight`** — resolved hex in **both dark and light** themes. Round 2 points at the palettes: `obj:6184` (static `Colors`), `obj:35310`/`obj:35311` (light/dark theme `colors`), and `generateTextThemedStyles` #33010 (hasm:1567403) / `getFontStyle` #33009 (hasm:1567349) for how `appearance:Light` maps to a colour. Follow that chain to a hex.
- The **battery % text** colour and the **status text** colour — are they the same token or different? (Ours currently uses different opacities for each; we need the truth.)
- Any **opacity** applied on top of the colour (e.g. a container `opacity` or an `rgba` token).
- The home header's **background** treatment behind this area, if it isn't plain black.

## F. Anything we'd get wrong next

You have now seen us implement from your findings and get three things wrong. Call out **anything else in the status/header area where a naive reading of Rounds 1–2 would produce a visibly non-Tesla result** — especially places where our two documented deviations bite: we render RN's `ActivityIndicator` instead of their spinner asset, and we guessed the text colour.

---

## Output format

1. **Spinner gate — resolved** (§A): the definitive control flow, which strings co-render with the spinner, and the `fetchedDataRecently` threshold in ms. Explicitly state which half of Round 2 was wrong.
2. **Cold start** (§B): persistence mechanism + exactly what renders at launch.
3. **Header layout + battery** (§C): tree, styles, the %↔distance toggle, colours/thresholds.
4. **Assets** (§D): a table of extracted file → APK source path → intrinsic size/format, with the files committed alongside.
5. **Colours** (§E): token → resolved hex (dark + light).
6. **Traps** (§F).
7. **Citations** for every fact.
8. **Gaps**, stated plainly.

Correct Rounds 1–2 where this round contradicts them, and say so loudly — we implement directly from these documents, so a stale claim becomes a shipped bug.
