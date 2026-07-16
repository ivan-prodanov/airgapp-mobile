# RESEARCH BRIEF — Official Tesla app: command lifecycle + live car status UX

**You are the research agent.** Mine the **official Tesla Android app** and produce a findings MD that lets another engineer reimplement its *command-feedback and car-status UX* faithfully. We are building an airgapped Tesla controller (phone ↔ car over BLE, optional Raspberry-Pi forwarder for remote) and want **behavioural parity** with the official app.

**Deliverable:** write your findings to
`/Users/ivan/Work/airgapp/mobile/docs/superpowers/research/tesla-app-status-ux-FINDINGS.md`

Report **exact strings, exact timings, exact state names, and the conditions that trigger each**. Cite where you found each (file + line/offset, or the decompiled function name). If something is genuinely not recoverable, say so explicitly — **do not guess or invent plausible-sounding values.** A wrong string/timing is worse than a documented gap.

---

## Where to look / tooling

- The Tesla Android app is a React-Native app: its logic is a **Hermes bytecode bundle** inside the APK, which **decompiles**. A decompiler is already installed at `~/.local/bin/hbc-decompiler` (it has been used successfully on this app before to recover exact camera poses and haptic vocabulary — the bundle is Hermes v96).
- **Locate the APK first.** It may be under `/Users/ivan/Work/`, `~/Downloads`, or similar; the app ships split APKs (e.g. `split_assets_pack.apk` holds assets; the base/`split_config`/`base.apk` holds the Hermes bundle `index.android.bundle` under `assets/`). Search broadly (`find / -iname "*tesla*apk*"`, `find / -iname "index.android.bundle"`), and check for an already-extracted/decompiled copy before re-doing work.
- If the APK is NOT on this machine, **stop and report that** in the findings file with what you searched — do not download anything from the internet.
- Also useful: `strings` over the bundle/APK for user-facing copy, and the app's string resources (`res/values/strings.xml` in the APK) — many status/error strings live there.
- Cross-check: any localisation files (`strings.xml`, i18n JSON in the bundle) give you exact copy + the string KEY names, which often reveal the state machine's vocabulary.

---

## What we need (be exhaustive; this is the whole point)

### 1. Car connection / liveness status model
- The **complete set of states** the app shows for the vehicle's reachability, with the **exact user-facing text** for each. We've observed/expect things like *"Waiting for car"*, *"Connecting…"*, *"Offline"*, *"Asleep"*, *"Vehicle unavailable"* — confirm the real list and exact casing/punctuation.
- **For each state:** what triggers it (what condition/transition), what **icon/indicator** is shown (name/shape/colour/animation — e.g. spinner, dot, slash, cloud), where it appears in the UI (header? under the car name? on the control?), and what the user can/can't do in that state.
- The **state machine**: what transitions between them, and on what timers. E.g. how long does "Connecting…" show before becoming "Offline"? Is there a retry cadence? Does it back off?
- Does the app distinguish **BLE/proximity vs network/cloud** connectivity in the UI (e.g. a phone-key/BLE indicator vs a cloud indicator)? If so: exact text/icons and when each shows. **This matters a lot to us — we have both transports.**
- Is there a **"last updated / as of"** freshness display? Exact format (relative like "Updated 2 min ago"? absolute?), where shown, and how often it refreshes.

### 2. Command lifecycle (tap → pending → success/failure)
- What happens **visually the instant a control is tapped**: does the control switch to a **spinner replacing the icon** (we believe yes), dim, disable, or optimistically show the target state? Describe precisely, per control type if they differ.
- **How long** does the pending/spinner state persist before the app gives up? We measured **~25 s** for a failed command in the field — confirm the exact constant and where it's defined. Is it one global timeout or per-command-type? Is there an internal retry loop inside that window (how many attempts, what backoff)?
- **On success:** what changes (spinner → confirmed icon? a haptic? a sound? a transient confirmation?). Exact behaviour + any timing.
- **On failure:** the exact **failure surface** — we've observed a bottom card with a **bold title + secondary body**, e.g. title `"Lock failed"`, body `"Command timeout, please try again."`. Confirm:
  - The exact **title format** (is it `"<Action> failed"`? what's the action vocabulary — "Lock", "Unlock", "Climate", …?).
  - The **full catalogue of body strings** and which error condition maps to each (timeout vs unreachable vs asleep vs not-authorised vs car-declined vs network). This is the highest-value item — we want to map our internal error kinds onto Tesla's user-facing copy.
  - How long the card stays, whether it's tappable/dismissable, whether it retries.
- **Does the spinner ever hang indefinitely?** i.e. is there a guaranteed terminal state / hard wall-clock cap? How do they guarantee it (a race/deadline)? *(We have a bug where ours can hang — we want to know their guarantee.)*

### 3. Backgrounding + notifications
- If a command is issued and the app is **backgrounded**, does the command continue? Does the app request a **background task assertion** / use a background mode to finish it?
- On failure while backgrounded, it posts a **local notification** — we observed title `"Unable to Complete Command"`, body `"Open the Tesla App to complete your request."`. Confirm exact strings, and **the full set** of command-related notifications (are there success ones? other failure variants?).
- What happens to the **pending state** across background→foreground (does the spinner resume, clear, or re-query)?

### 4. Asleep-car handling
- How does the app detect the car is **asleep**, and what does it show?
- Does it **auto-wake** before a command/read, or ask the user? Any "Waking up…" state + exact text + timeout?

### 5. Anything adjacent worth stealing
- Error/status copy tone and structure generally (sentence case? trailing period? length).
- Any **rate-limiting / debounce** on rapid control taps.
- Any status/telemetry **polling cadence** visible in the bundle.

---

## Output format (the findings MD)

Structure it so an implementer can act directly:
1. **Status/connection state machine** — a table: state → exact text → icon/indicator → trigger condition → transitions/timers. Plus a short prose description of the machine.
2. **Command lifecycle** — a timeline (tap → pending → terminal), with the exact timeout constant(s) and retry behaviour, and the guarantee that it always terminates.
3. **Failure copy catalogue** — a table: error condition → exact title → exact body. (Highest value.)
4. **Notifications** — exact titles/bodies + when posted.
5. **Asleep/wake** — states + copy.
6. **Citations** — where each fact came from (function/file/offset), so it's auditable.
7. **Gaps** — anything you could NOT recover, stated plainly.

**Precision over completeness.** Mark anything inferred (vs. directly read from code/strings) as **INFERRED** so we don't treat a guess as gospel.
