# CarLink test plan — READ-first, then WRITE

Written 2026-07-17 after a batch of command-mapping bugs surfaced on the real car.
The point of this doc: stop testing writes against a fantasy, and make every
control verifiable from the pulled log (`scripts/godot-ios/pull-logs.sh`).

## The core problem: the app boots from a MOCK, and most fields are never read back

`initialVehicleState` is a plausible mock (battery 48, seat modes off, temp 19.5,
camp/pet off…). Telemetry then patches SOME fields; the rest stay mock **forever**.
A user WRITE therefore diffs `next` against a `prev` that may never have matched
the car. That is the disease behind "Camp/Pet don't do what's intended",
"overheat temp does nothing that I can see", etc.

### State provenance (what is truth vs fiction)

**READ back from telemetry** (VCSEC works asleep; infotainment needs awake):
`locked, awake, driving, charging, batteryLevel, rangeMiles, interiorTempC,
exteriorTempC, climateOn, sentryEnabled, leftFront/rightFront/leftRear/rightRear
WindowOpen`.

**WRITE-ONLY / MOCK-ONLY — never read, so the app's value is always a guess:**
`frunkOpen, trunkOpen, chargePortOpen, chargeLimitPercent, chargingAmps,
targetTempC, frontDefrostOn, rearDefrostOn, cabinOverheatMode, cabinOverheatTemp,
bioweaponOn, campModeOn, petModeOn, steeringWheelClimate, seatClimateModes`.

⇒ **Every climate setpoint and comfort toggle is in the second list.** Fixing the
command mappings is necessary but not sufficient; until these are read back, the
UI and the car can silently diverge.

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
