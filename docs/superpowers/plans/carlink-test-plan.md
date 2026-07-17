# CarLink test plan — READ-first, then WRITE

Written 2026-07-17 after a batch of command-mapping bugs surfaced on the real car.
The point of this doc: stop testing writes against a fantasy, and make every
control verifiable from the pulled log (`scripts/godot-ios/pull-logs.sh`).

## The core problem — CORRECTED (2026-07-17): the car reports almost everything; our PARSER is a stub

Earlier I called most climate fields "write-only / mock-only". **That was wrong,
and wrong in the usual way — I read our parser, not the car.** The car's
`ClimateState` message (vehicle.proto) reports ~40 fields, INCLUDING every one I'd
written off:

  driver_temp_setting · is_front/rear_defroster_on · defrost_mode ·
  seat_heater_left/right/rear_*/third_row_* · seat_fan_front_left/right (cooling) ·
  steering_wheel_heater + steering_wheel_heat_level · climate_keeper_mode ·
  auto_seat_climate_left/right (SEAT AUTO STATE) · cop_activation_temperature ·
  is_auto_conditioning_on · supports_fan_only_cabin_overheat_protection ·
  cop_not_running_reason

Our `infotainmentToPatch` parses **four** ClimateState fields
(insideTemp/outsideTemp/driverTemp/isOn) and APPLIES **three** — it doesn't even
push the `targetTempC` it already parses. So the mock isn't lying because the car
is silent; it's lying because we map ~6 fields out of ~40 across ChargeState +
ClimateState. **The whole "app is fiction" problem is one under-built parser.**

### Provenance, corrected

- **READ+WRITE (full loop possible)** — everything above, PLUS lock/charging/
  windows/sentry we already read. Once the parser is expanded, a user WRITE is
  confirmed (or reverted) by the next poll reading the car's real value. This is
  the vast majority of controls.
- **READ-ONLY** — battery, range, temps, driving, cop_not_running_reason.
- **WRITE-ONLY (genuinely no readback)** — only the momentary actions that have no
  state at all: honk, flash, remote-start, boombox, and open-only frunk. These are
  the ONLY fields that can't be reconciled, so they're the ones that structurally
  need the "waiting" UX (§ below).

## THE DECISION (answering the three options)

1. **Continue with the mock? NO.** It's the disease — a broken read is invisible
   because the field already looks right, and every write diffs against fiction.
2. **Erase defaults to prove READ? YES, FIRST — but the real work is PARSE, not
   erase.** Erasing without expanding `infotainmentToPatch` would blank fields
   because OUR parser is silent, not the car — conflating the two. So:
   **expand the parser to map the full ClimateState/ChargeState, THEN boot the
   readable fields to `unknown`, THEN confirm on the car that each loads.** A
   field still stuck on "—" after that is a real gap (car doesn't report it, or a
   parse bug) — now visible instead of hidden behind a mock.
3. **WRITE-test each control? SECOND — and it becomes SELF-VERIFYING once reads
   work.** Change a control → the log shows the command → the next poll reads the
   car's real state back → it either CONFIRMS the optimistic value or REVERTS it.
   No more eyeballing "did that work"; the read is the oracle.

**Your gut (2 then 3) is right.** The only refinement: 2 is really
"parse-then-erase-then-read", because the car was never the bottleneck.

## The insight that unifies this with the optimistic-vs-waiting report

The report you commissioned (which controls apply optimistically vs show a
spinner) maps ONTO readability:
- A **readable** field can safely be **optimistic** — if the command fails, the
  next poll reconciles it back. The read is the safety net.
- A field with **no readback** (the momentary actions) has no safety net, so it's
  the natural candidate for **waiting** (hold the spinner until the ack).

So the two workstreams converge on the same table. Where the app's actual
behaviour DISAGREES with readability (e.g. it treats something as "waiting" that
the car clearly reports) is itself a finding — usually that the app reads a field
we're not parsing. Reconcile the report against the corrected provenance above.

## The optimistic-vs-waiting report — digested (2026-07-17)

The report (`tesla-optimistic-buttons-FINDINGS.md`) landed a bigger finding than
"which buttons spin": **our optimistic ARCHITECTURE is the inverse of Tesla's.**

- **Us:** patch the vehicle state optimistically, dispatch with a rollback
  closure, and a 30s intent-grace stops the poll reverting it.
- **Them:** never patch state. Store the whole command in a pending list and
  DERIVE the effective state by folding pending commands onto polled data.
  Revert is free — drop the command. Two orthogonal hooks: `useEffectiveState`
  (flip) and `useBusy(type)` (spinner).

**We are visibly BACKWARDS on the two controls that matter most.** Our Home bar
spins a control iff its `CONTROL_AFFECTED_KEYS` are pending, so:
- `lock` (keys `['locked']`) **spins** — the report says lock FLIPS, no spinner.
- `frunk`/`trunk` (keys `[]`) **never spin** — they are the ONE pair the report
  says SHOULD spin.

### Decision: keep patch+rollback, layer the report's per-button CLASSES on top

The full pending-list-derive rewrite is a large, risky change and the flip case
is behaviourally equivalent to what we already do. So: **do NOT rewrite the
engine now.** Instead drive feedback off the command TYPE via
`src/ble/commandFeedback.ts` (the report's §3 verdict as pure, tested data):
`optimistic` (flip, no spinner) / `spinner` (frunk/trunk, climate-keeper) /
`fire-and-forget` (honk/flash/homelink/boombox) / `release` (sliders/steppers).
The pending-list-derive model stays documented as the eventual cleanup if
patch+rollback ever bites — it composes especially well with the READ-first
parser work (fold pending onto real polled state).

### Feedback class per control (from the report §3)

| Control | Class | In-flight look |
|---|---|---|
| Lock / Unlock, Sentry, Charge-port, Windows, Charge start/stop, Climate on/off | **optimistic** | flip instantly, NO spinner |
| Seat heat/cool, Steering-wheel heat, Defrost, COP | **optimistic** | flip (seat heaters explicitly never spin) |
| **Frunk / Trunk** | **spinner** | BusyIcon replaces icon, state does NOT flip |
| **Keep / Dog / Camp** (climate keeper) | **spinner** | the one climate control that spins |
| Remote start | **spinner** then active + countdown | brief spinner |
| Honk, Flash, HomeLink, Boombox | **fire-and-forget** | no feedback |
| Charge-limit / amps / temp | **release** | local value during drag; command on release |

### Reconcile details worth copying (report §1e/§1g)
- Poll cadence **5000 ms online / 1200 ms waking** (ours is 20s — a candidate to
  match for a live feel).
- **`COMMAND_FAILED` reverts immediately**; a no-ack command auto-clears at **30s**
  (evaluated per poll tick, not a setTimeout — we already do this).
- **Error card is a separate 7s layer**, independent of the 30s revert (we match).

---

## Methodology — two independent passes

### PASS 1 — READ (does the car's real state load?)
Goal: prove what telemetry can actually populate, and expose exactly which fields
are fiction.

1. **Boot with UNKNOWN, not mock, for readable fields.** For each field in the
   READ list, the initial value should be a distinct "unknown" sentinel (or the
   UI should render "—") until the first telemetry read fills it. Fields in the
   WRITE-ONLY list keep a default (there is no truth source for them — document
   that in the UI as "not reported by the car").
2. Wake the car, pull the log, and confirm each READ field transitions
   unknown → real. A field that never transitions is a telemetry gap (either the
   proto isn't parsed, or the car doesn't report it over BLE).
3. Record the result in the provenance table above — promote/demote fields as the
   car proves them.

**Why this matters for debugging:** with mock defaults, a broken read is
invisible (the field already "looks right"). With unknown-until-read, a broken
read is a field stuck on "—".

### PASS 2 — WRITE (does each control send the right command, and obey?)
For each control: change it, pull the log, and check three things in order:
1. **`cmd dispatch {type}`** — did we emit the RIGHT command type? (reconciler)
2. **`cmd settle {ms, outcome}`** — did the car accept it (`ok`) or fault?
3. **On the car** — did the physical thing happen?

A control fails PASS 2 at whichever step first goes wrong: wrong `type` = a
reconciler bug (fix in `reconcile.ts`, unit-testable); `ok` but no physical
effect = a builder/proto bug (wrong action bytes); a fault = the car rejected it.

## Per-control checklist

| Control | Expected `cmd.type` | Log signature | Status (2026-07-17) |
|---|---|---|---|
| Lock / Unlock | `lock` / `unlock` | dispatch→settle ok | ✅ proven (M1) |
| Frunk | `openFrunk` | | untested |
| Trunk | `openTrunk`/`closeTrunk` | | untested |
| Charge port | `openChargePort`/`closeChargePort` | | untested |
| Sentry | `sentry {on}` | | untested (readable — good PASS-1 candidate) |
| Windows vent/close | `ventWindows`/`closeWindows` | | untested (readable) |
| Charge start/stop | `chargeStart`/`chargeStop` | | untested |
| Charge limit slider | `setChargeLimit {percent}` | one cmd per drag (C2) | untested |
| Charging amps | `setChargingAmps {amps}` | | untested |
| Climate on/off | `climateOn`/`climateOff` | | readable |
| Target temp | `setClimateTemp {celsius}` | | untested |
| **Defrost** | `defrostOn`/`defrostOff` | | 🔴 was UNMAPPED — fixed 2026-07-17 |
| **Cabin overheat temp** | `setCopTemp {low/med/high}` | | 🔴 was UNMAPPED — fixed 2026-07-17 |
| Cabin overheat on/off | `cabinOverheat {on}` | | ⚠️ `noac` variant not modelled |
| Bioweapon | `bioweaponMode {on}` | | untested |
| **Camp / Pet** | `climateKeeper {camp/dog/off}` | | 🔴 two toggles, one setting — see below |
| Seat heat 3→0 | `seatHeater {seat, level}` | | ✅ works (user) |
| **Seat cool 1→0** | `seatCooler {seat, 0}` | | 🔴 sent heater-0 — fixed 2026-07-17 |
| **Seat auto** | (no command exists) | | 🔴 unsupported over BLE — see below |
| Steering wheel heat | `steeringWheelHeat {on}` | | untested (level not settable over BLE) |
| **Send to Car** | `navigateTo {lat,lon}` | | 🔴 local mock, P4.T2 not built |

## The three static fixes shipped 2026-07-17 (pure reconciler, unit-tested)
- **Defrost**: `frontDefrostOn`/`rearDefrostOn` now emit `defrostOn`/`defrostOff`.
- **Cabin overheat temp**: `cabinOverheatTemp` 30/35/40 → `setCopTemp` low/med/high.
- **Seat cool→off**: going to `off` from a `cool` seat emits `seatCooler 0`, not
  `seatHeater 0`.

## Open items that need a decision or the car (NOT fixed blind)
- **Seat Auto**: no `seatAuto` command exists in the union and no BLE proto is
  known. Either recover the action (RE) or hide "Auto" for live cars (plan P4.T5).
- **Camp vs Pet**: modelled as two independent booleans (`campModeOn`,
  `petModeOn`) but the car has ONE `climateKeeper` state (`off|on|dog|camp`).
  They are mutually exclusive on the car, so the two toggles fight. Fix = collapse
  them into one selector in state+UI (the plan's original `climateKeeper` enum),
  or make the reconciler emit the combined keeper value. Decision needed.
- **Send to Car (P4.T2)**: wire single-stop → `navigateTo`; multi-stop has no BLE
  proto (`navigateWaypoints` throws "unsupported over BLE"), so multi-stop is
  Pi-only or deferred.
- **`cabinOverheatMode: 'noac'`**: no COP-no-A/C command in the union; the current
  mapping treats noac and on identically. Needs the proto or demotion.
