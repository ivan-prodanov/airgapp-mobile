# RESEARCH BRIEF #2 — Official Tesla app: EXACT look & feel of the vehicle status area

**You are the research agent.** This is a **follow-up** to a previous, successful pass. Round 1 recovered the *state machine and the copy*; it explicitly left the **visual layer** as gaps. Round 2 (this one) is about **pixels and structure**: we want to reproduce the status area so it looks and behaves like the real app.

**Read first (do NOT re-derive):** `/Users/ivan/Work/airgapp/mobile/docs/superpowers/research/tesla-app-status-ux-FINDINGS.md` — especially §1.2 (the `VehicleStatusText` component), §1.3 (state→text table), §1.5 (freshness format), and §8 (the gaps this brief targets). Its citation shorthand and tooling notes apply here too (`hasm:N` → `/Users/ivan/Work/tesla-summon/work/bundle.hasm`; `catalog` → the inline English i18n object at hasm:1140421; apktool-decoded `res/` for native resources). Reuse the existing extraction/work products rather than starting over.

**Deliverable:** `/Users/ivan/Work/airgapp/mobile/docs/superpowers/research/tesla-status-visual-FINDINGS.md`

**Same rules as round 1, which you followed well:** exact values with citations; mark anything not directly read from code as **INFERRED**; state gaps plainly rather than guessing. A wrong pixel value is worse than a documented gap.

---

## Context: what we're reproducing and why

Our app shows a vehicle status line that is **too verbose** and visually unlike Tesla's. Two specific field observations from the user (verify or correct them — they may be imprecise):
1. **"There's a loading bar next to the text when the user refreshes."** Round 1 only confirmed a `BusyIcon` **spinner** (hasm:5219500) in the *Connecting* state. A **refresh-time indicator next to the status text** was NOT documented. Determine what this actually is: an indeterminate **progress bar**? a spinner? a shimmer/skeleton? Where exactly, what shape/size, and **what triggers it** (pull-to-refresh? a manual refresh? any data fetch?).
2. **"They show much less text than our app."** We want the precise **display rules**: in each state, which line(s) render at all, and when a line is omitted entirely.

---

## What we need

### A. Exact component tree & layout of the status area
- Full render structure of **`VehicleStatusText`** (fn #117231, hasm:5218968) and the **status row** variant (hasm:8759817): every child, in order, with conditional-render predicates (what makes each child appear/disappear).
- How it sits relative to the **car name / header**: parent container, ordering, alignment (row/column, alignItems/justifyContent), and the flex/spacing between the name, the status line, and the freshness caption.
- Are the status line and the freshness caption **two separate Text nodes**, one concatenated string, or a Text with children? Round 1 says "two lines" — confirm the actual node structure.

### B. Typography & colour — the actual StyleSheet values
This is an RN app, so `StyleSheet.create` objects are compiled into the bundle as literal objects — recover the **real numbers**, don't estimate.
- For the status line and the freshness caption: `fontSize`, `fontWeight`/`fontFamily`, `lineHeight`, `letterSpacing`, `opacity`, `color` (and the **name of the theme token** if it resolves through one, e.g. a `colors.textSecondary`-style lookup — give both the token name and its resolved light/dark hex if recoverable).
- **Per-state colour differences** (round-1 gap §8.4): does *Offline* / *Asleep* / *Charging* render in a different colour (e.g. green while charging, muted while asleep, red for an error)? If they're all the same token, say so — that's a valuable finding too.
- Margins/paddings around the block.

### C. The refresh indicator (the user's "loading bar") — highest value
- Identify the component and **exactly** what it is (progress bar vs spinner vs shimmer). Recover its **size, colour, position relative to the status text, and animation** (duration, easing, indeterminate loop?).
- **Trigger conditions**: which action(s) show it — pull-to-refresh (`VehicleWakeReason.PULL_DOWN_REFRESH` exists per round 1 §5.2), tapping the status text (`TAP_STATUS_TEXT`), a background poll, or a command? Does it show on *every* fetch or only user-initiated ones?
- Its **lifecycle**: when does it appear and when does it stop (on response? on a min-duration? does it have a minimum visible time to avoid flicker)?
- Distinguish it from the `BusyIcon` used in the *Connecting* state — are they the same component or two different ones? Where is each used?
- Is there also a **pull-to-refresh control** (RN `RefreshControl`) on the home scroll view, with its own spinner? Give its props (tintColor, etc.) if present.

### D. Display rules — "much less text"
Produce a definitive table: **for each state (Connecting / Parked / Charging / Low Power / Asleep / Offline-last-seen / Mobile Access Disabled / In Service / Upgrade), exactly which elements render** — status line? caption? icon? spinner? — and the exact string each shows.
- Critically: **when is the freshness caption shown vs omitted?** (e.g. is "Last seen 2 hours ago" the *status line itself* rather than a caption? Round 1 §1.3 suggests the freshness IS the offline/asleep status text — confirm whether there are ever genuinely two lines, and in which states.)
- Is any state's text **empty** (nothing rendered)?
- Truncation: `numberOfLines`, ellipsizeMode?

### E. Per-state icons (round-1 gap §8.3)
- The `statusIcon` used by the status-row variant: asset/glyph names per state, size, colour/tint. If the icons are vector/font glyphs, name them; if drawables, give the resource names (search apktool `res/drawable*` for status-ish names).
- Confirm whether the **home header** status line shows any icon at all besides the `BusyIcon` spinner (round 1 implies it may not).

### F. Interaction
- Tap targets: round 1 says the status row is tappable (`onStatusPress` fn #117253 → wake, `TAP_STATUS_TEXT`). Confirm whether the **home-header** status text is tappable too, its hit area, and any pressed/opacity state.
- Any animation on state transitions (fade/crossfade between states)? Give durations if present.

---

## Output format

1. **Component tree** — an annotated structure diagram of the status area (nodes + conditional predicates).
2. **Style table** — element → exact fontSize/weight/color-token/lineHeight/spacing values.
3. **Refresh indicator** — what it is, where, size/colour/animation, triggers, lifecycle. (Answer the user's "loading bar" observation directly: confirm or correct it.)
4. **Display-rules table** — state → which elements render → exact strings.
5. **Icons** — per-state asset/glyph names + tint/size.
6. **Interaction** — tap targets, transitions.
7. **Citations** — file/line/fn for every fact.
8. **Gaps** — anything unrecovered, stated plainly.

Where a value resolves through a design-token/theme lookup, give **both** the token name and the resolved value if you can follow it; if you can't resolve it, give the token name and mark the value **INFERRED/UNRESOLVED** — the token name alone is still useful to us.
