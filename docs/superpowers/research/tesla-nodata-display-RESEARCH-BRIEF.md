# RESEARCH BRIEF #14 — How the official app displays a field BEFORE first telemetry (the no-data / loading state)

**You are the research agent.** Context: we're building a Tesla-app clone wired to a real car over BLE. We just shipped a diagnostic ("READ_PROBE") that boots our readable numeric fields to an *unknown* sentinel and renders `—` until real telemetry lands. That is a stand-in. Before we build the PROPER version — make every readable field genuinely nullable and render **exactly what Tesla renders** before first data — we need the ground truth: **what does the official app actually show for each field between "app opened / car not yet read" and "first vehicle_data arrived"?**

Method note that has paid off every round: **read the decompiled iOS app UNFILTERED, dump verbatim, tag `[iOS-verified]`.** Do NOT reason from screenshots or memory; find the code that decides the placeholder. iOS bundle: `/Users/ivan/Downloads/tesla-haptics-work/main.decompiled.js` (Hermes-decompiled; Reanimated/JS worklets retain readable source; ~400 MB — grep, don't open whole).

**Deliverable:** `docs/superpowers/research/tesla-nodata-display-FINDINGS.md`

---

## The precise question

When the app has a vehicle selected but **no `vehicle_data` yet** (cold launch, car asleep, or a failed read), each field is in a "no value" state. For every field below, answer: **what is rendered?** The candidates we need you to distinguish between:

- a literal **dash** (`—` / `-` / `--`) — and if so, which glyph exactly
- **blank / empty string** (nothing shown, or the row/label hidden entirely)
- a **skeleton / shimmer** placeholder (a gray pill/bar, an animated loading state)
- **last-known value** (cached from a prior session, possibly dimmed/stale) — this is the big one to confirm or refute; we suspect Tesla shows a cached value, not a dash
- a **spinner** in place of the value
- a **hardcoded default** (e.g. always shows a number)

Distinguish **first-ever launch** (no cache) from **subsequent launch** (has a cached last-known value) — they may differ, and that difference is exactly what we must copy.

## Fields to cover (map each to one of the above)

1. **Battery %** and the battery **glyph fill** (home header + charge card).
2. **Range** (km/mi) — note it already has a null path in our code; confirm theirs.
3. **Interior temp / Exterior temp** (home Climate row + Climate sheet header).
4. **Target temp** (Climate sheet big number).
5. **Vehicle status line** ("Asleep" / "Last seen …" / "Parked" / online) — what shows before any read?
6. **Lock state** (icon), **charge state**, **windows**, **sentry**, **climate on/off** — the toggles: default icon before read?
7. Any **odometer / tire pressure / software version** style rows if quickly found.

## Specific things to dig out (the "how", not just the "what")

1. **The cache.** Does the app persist last-known `vehicle_data` (AsyncStorage / MMKV / a store hydrate) and render it on next launch while a fresh read is in flight? Find the hydrate path and whether the rendered value is marked stale/dimmed. Quote the storage key and the selector that prefers cache-vs-live.
2. **The null/loading sentinel in code.** Grep for the placeholder itself — `'—'`, `'--'`, `'—'`, `Skeleton`, `Shimmer`, `Placeholder`, `isLoading`, `hasData`, `?? '—'`, `undefined`/`null` guards around the battery/temp formatters. Dump the exact ternary/formatter that produces the no-data output.
3. **Per-field vs global.** Is there ONE app-wide "no data yet" gate (e.g. the whole card is a skeleton until first read), or does each field independently fall back? This decides whether we build a global gate or per-field nullables.
4. **Dimming/stale styling.** When a value is stale (cache shown, or read failed), is there an opacity/color change? Give the exact style delta if any (we already dim the battery row on `stale` — confirm against theirs).
5. **The formatters.** Find the battery-%, temp, and range formatting functions and show how each handles `null`/`undefined`/`NaN` input — that is the exact contract our PROPER nullable version must match.

## Output format
For EACH field in the list: `field → no-data render (first launch) | no-data render (has cache) | code ref`. Then a short section on the cache mechanism, one on the styling of stale values, and a verbatim dump of the key formatter functions. Tag every claim `[iOS-verified]` with the grep hit / line context; mark anything you could only infer as `[INFERRED]` and say why.
