# Roadmap

Living doc. Newest state at the top of each section. Anything claimed "done" here should name the
measurement that proved it — this project has been burned repeatedly by conclusions that were
reasoned rather than measured.

---

## P0 — next

### Optimistic updates outlive reality (the frunk double-tap)
**Reported on-car 2026-07-27.** On Controls: tap frunk, tap frunk again while the car is still
physically opening. The car ends up OPEN. The app shows CLOSED — and stays closed for **30 seconds**.

The mechanism is not mysterious, which is why this is a design fix rather than an investigation:

1. Tap 1 → optimistic `frunkOpen = true`, and `frunkOpen` is stamped with a grace expiry of
   `now + GRACE_MS` (`intentGrace.ts:23`, **30_000**).
2. Tap 2 → optimistic `frunkOpen = false`, grace **re-stamped** for a fresh 30s. Note the second
   optimistic value is derived from the FIRST OPTIMISTIC VALUE, not from anything the car said.
3. The car finishes opening and reports frunk OPEN.
4. `filterPatchUnderIntent` strips it, because `frunkOpen` is still inside its grace window.
5. So the truth is suppressed for the full 30s while the screen shows the opposite.

The grace window's premise — *"the user's intent is right and the car's sensor lags"* — is sound for
one tap and false for a second tap issued while the first is still in flight. Frunk makes it worse
because actuate is a TOGGLE: both taps send the same `openFrunk`, so the app's model and the car's
can diverge by a whole state.

Directions, none of them settled:
- **End the grace on CONFIRMATION, not on a timer.** Once a read agrees with the optimistic value,
  drop the stamp; a later disagreement is then real news, not lag.
- **Reject or coalesce a second tap while the first command is in flight** rather than optimistically
  toggling again. `coalesce.ts` already has per-field lanes — check whether this is a config gap
  rather than new machinery.
- **30s is very long** for a closure that actuates in ~5s. It was chosen for lock, whose sensor
  genuinely lags. A per-field grace is probably right.

Do NOT just shorten GRACE_MS and call it fixed — that trades a 30s wrong state for a shorter wrong
state and leaves the double-tap divergence intact.

### Media: decide where cover art comes from
The card, the transport controls, the recovered layout and Tesla's own source icons all shipped
2026-07-27. The artwork SLOT is built (`MediaCard.artworkUri`) and nothing fills it, because **the
car cannot supply it** — neither `MediaState` nor `MediaDetailState` carries an image field, URL or
blob (whole proto checked), which is exactly why the official app renders a per-source glyph there.

Two options, both needing a decision rather than more research:
- **iTunes Search API** — free, no key, works for any source, cacheable by album. But it is an
  outbound request describing what the user is listening to, and it needs signal the car often
  won't have.
- **The phone's own now-playing** — zero network, exact art, better metadata than the car gives.
  Only when the phone IS the source, and reading another app's now-playing needs either the
  Music-app-only public API or a private framework.

Leaving it as the source icon is also a valid answer — it is what Tesla ships.

---

## Done 2026-07-28

### Share extension sends natively — DONE, confirmed 10/10
Sharing reaches the car with the app closed, across Google Maps, Apple Maps and Waze. The extension
runs the app's own TypeScript protocol in JavaScriptCore rather than a second Swift implementation.
Four things bit, all of which presented as something else — see the
`share-extension-sends-natively` memory. The two worth repeating here:

**JavaScriptCore has no `setTimeout`.** No clock, no run loop. The engine arms one around every
exchange, so every send died instantly. Swift installs it, on the engine's own serial queue.

**Absence of a log line is not evidence.** `logFileSink` had an allow-list that silently dropped
every `outbox` line — seven call sites that could never reach the file — and that silence was read
as proof the code never ran. Twice tonight a check passed for a reason unrelated to what it claimed:
the log filter, and a build check whose stub transport failed so fast the timer path never ran. Make
the check fail for the right reason first.

**Still open here:** the BLE arm does not exist, so `arms = [pi]`. That is the ONLY reason the outbox
survives — Ivan wants it gone ("if it didn't work, I'd retry, not open the app"), and it goes when
the BLE arm lands. `unverified` still queues, so a send that landed without a readable verdict can
arrive twice.

---

## Done 2026-07-27 (was P0)

- **The BLE wedge** — fixed and measured. Correlator now decides on `request_uuid`, not the
  once-per-session routing address. PE-1 0 lost challenges (was 15/15), PE-4 4171ms → ~419ms worst
  under load, PE-5 lock session survives a domain-3 eviction. The location-send hang has stopped
  reproducing; Ivan confirmed.
- **Push the branch** — stale entry. The branch is on `origin/feat/ble-carlink` and pushed
  regularly; only the working day's commits are ever ahead.
- **Vehicle-data subscription + PII** — DELETED (`332e727`), not deferred. RESPONSE-20 closed it by
  construction: `CarDataEncryptionManager::encryptPiiKey` requires exactly RSA-4096
  (`cmp ebp, 0x200`), whose SPKI PEM is ~900B on the wire against the car's own ~452B cap. The two
  constraints are mutually exclusive over BLE. Live location was never lost — it is a cleartext
  `getVehicleData` READ (VDS-M9, run twice) — and live speed likewise. Only the SUBSCRIPTION is gone.
- **TPMS** — pressures at the wheels, placard in the header, Tesla's own `tirepressure_bar` glyph,
  all constants recovered rather than eyeballed. See `tesla-tpms-markers-FINDINGS.md`.
- **Media** — read path, card, transport, source icons, and the BLE refresh cadence.

---

## In flight

### Vehicle-data subscription + PII — DELETED, do not reopen
Moved to Done above. The full evidence trail (VDS-M1 through M9, the size ladder, RESPONSE-20's
`cmp ebp, 0x200`) is in git history at `332e727` and in RESPONSE-19/20. Summarised there so this
section stops being the longest thing in the file.

### Screen-keyed focused read (live speed via polling)
Enabled. Gated on three measured fixes: deaf window (PE-1, 15 lost → 0, answered at 2ms),
eviction scope (PE-5, lock session survives), command latency (PE-4, 4171ms → 387ms worst).

**Re-verified 2026-07-26 18:24-18:25 with the focused read LIVE — the cleanest set of the day:**

```
PE-1  phase A  1 challenge  1 answered  2ms          PASS
      phase B  1 challenge  1 answered  2ms          PASS   104 reads issued, 0 failed
PE-4  quiet    median  93ms  worst 122ms
      loaded   median 300ms  worst 302ms             SAFE   (worst == median: no outlier at all)
PE-5  88ms → 118ms across a forced domain-3 eviction PASS
```

Earlier runs had a first-command outlier of 510/597/387ms; with domain 3 warmed and the priority
carried correctly there is none. Note PE-1 phase B ran 104 background reads with ZERO failures,
against 5-with-4-failing in the run before — the link was healthy throughout, so this is a pass on
a good link rather than a pass that got lucky.

- Cadences, updated 2026-07-27 by reading `startBleVehicleUpdates`' DISPATCH SITES (not its
  constant pool): security 1250 / scheduling 2500 / location 5000 PROVEN, **controls 1650 upgraded
  INFERRED → PROVEN**, climate 5000 still inferred, and **media 1250 PROVEN** — media is fetched
  over BLE, grouped with closures/charge/climate. Home→drive remains OUR choice.
- **Still untested: the actual outcome.** Nobody has driven the car and watched the speed line
  update on its own. Everything so far is link-level measurement.

---

## Known hazards, not yet fixed

### Two gateways over one session counter
`carlink.tsx`'s `makeGateway()` builds its own `SessionQueue`; `useCarLink` has another. Two
writers on one monotonic counter — the exact race `SessionQueue` exists to prevent, one level up.

Mitigated for the eight **probes** (they hold the app's polling while they run). **Still live for
the debug screen's Lock / Unlock / Wake buttons.** Proper fix is one shared gateway — a real
refactor of `carlink.tsx`, deliberately not started at the end of a long day.

### The outbox outlives its purpose, and `unverified` can duplicate
The share extension sends for itself now, so the outbox is no longer the delivery path — but it
cannot be deleted yet: `arms = [pi]` because the BLE arm does not exist, so an out-of-range share
with no reachable Pi has nowhere else to fall. Ivan wants it gone ("if it didn't work, I'd retry,
not open the app"), and it goes when the BLE arm lands.

Separately, an `unverified` verdict still queues, so a send that DID land without a readable verdict
can arrive twice. Chosen over reporting success for something that may never have arrived — but it
is the same behaviour that read as "I shared A and B showed up" on 2026-07-27.

### The Share Extension's Swift is not under version control
`/ios` is gitignored wholesale (it holds the hand-built Godot project that `expo prebuild` must
never clobber), so `ios/ShareExtension/*.swift` — real, hand-written logic including the resolver
and the outbox write — exists on disk only. A clean checkout does not build a working share.
Pre-existing, and left alone deliberately: un-ignoring part of `/ios` is a call for Ivan, not a
side effect of a bug fix.

### The `writePending` deferral is freshest-first
If several challenges pile up inside the seal→write hazard, only the newest is answered. Correct
in principle — the car re-challenges with a new nonce and older ones are dead — but unverified
against a real burst.

---

## Backlog

- `getGuiSettings` (Tier 2, request number 1) — the last place the app GUESSES a unit, and it now
  unblocks three shipped-but-hardcoded things, not one:
    * km/h vs mph on the status line (currently inferred);
    * `gui_tirepressure_units` → the bar/psi tyre-label formatting AND the second tyre icon
      (`tirepressure_psi`, module 3467) which is deliberately not shipped because we render bar
      unconditionally;
    * the media card's own unit-free formatting stays honest.
  Self-contained: one state read, one existing request number.
- ~30 BLE-buildable commands and 19 unread state submessages (RESPONSE-15 P2).
- Multi-stop nav: dropped. f21 is the only message honouring PREPEND/APPEND and cannot be trusted
  with coordinates; route state is unreadable while locked.

---

## Method notes worth keeping

Six times on 2026-07-26 a probe hid the evidence it was built to collect: hex printed only for
frames passing the predicate under test; a reply logged as ASCII so the distinguishing bytes were
lost; pings rendered as "no recognised state slices"; swallowed ack errors; a verdict on the
median that buried a 4171ms outlier; a load that omitted the priority it was meant to model.

The rule that came out of it: **never gate the evidence dump on the classification being tested,
and never verdict on a statistic that can average away the failure case.** A probe that cannot
show it did the thing it was testing must report VOID, not a result.

**2026-07-27 adds a second rule, earned three times in one day: read the USE, not the DECLARATION.**
- The tyre label's font size was borrowed from a call site that resolved differently (18 vs 14).
- The media cadence sits next to 1650 in the constant pool and is 1250 at its dispatch site.
- The media refresh mechanism was first taken from the CLOUD poll because that constant was found
  first; the BLE task is a different generator entirely.
In all three the adjacent, easy-to-find value was wrong and the one at the point of use was right.
