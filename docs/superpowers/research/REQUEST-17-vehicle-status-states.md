# RE REQUEST #17 — the COMPLETE vehicle-status state machine (the line under the car name)

**Requested:** 2026-07-26
**Standing constraint:** airgapp is air-gapped — it must never reach Tesla's servers. So tag every state
**BLE/local-derivable** vs **cloud-only**, as in RESPONSE-13/15. A state we can't compute offline is one we
need to know to *suppress*, not to build.

## The concrete bug that prompted this

**The car is DRIVING — our Godot model is animating, the gear is in a driving gear — and our status line
still says "Parked".** We render only four states and have no driving branch at all.

## What we render today (so you don't re-derive it)

`src/ble/vehicleStatusText.ts` (pure, node-tested) emits exactly four strings, first-match-wins:

| Our state | Condition we use |
|---|---|
| `Connecting` | never fetched (no `lastVehicleDataAt`) |
| `Parked` | data fetched within 2 min (`fetchedRecently`) |
| `Last seen {age} ago` | stale + car was AWAKE at last contact |
| `Asleep {age}` | stale + car was ASLEEP at last contact |

Plus a spinner gated on `wakeInFlight && isDataStale` (Round 4 settled this from the opcodes).

**We already have, but do not use:** `patch.driving` (computed in `telemetry.ts:440` as
`DRIVING_GEARS.has(snap.drive.gear)` from `DriveState`), plus `chargingState`, `sentryOn`, closures, and
`locationState`. So several states may be buildable purely from data already on the wire.

Our own earlier findings doc (`tesla-status-assets-FINDINGS.md` §A) says the dispatch is *"live states
(Parked / Mobile Access Disabled / In Service / Charging / …) take priority; the LAST branch is
`isDataStale`"* — the `…` is the hole. We need the full list.

## What we need

### Q1 — the COMPLETE enumeration
Every string `VehicleStatusText` (#117231) can render, with **verbatim copy** including any interpolation
placeholders and pluralisation. Please don't summarise — we want to match byte-for-byte, as with the
notification copy in RESPONSE-13. Candidates we suspect exist but can't confirm: Driving, Charging (with or
without rate/time), Preconditioning/Climate on, Sentry, Summon in progress, Parked (+ subtitle?), Updating /
Software update, In Service, Mobile Access Disabled, Offline/No signal, Asleep, Last seen, Connecting,
Waiting for car, Dog/Camp mode, Valet, Speed-limited, Locked/Unlocked.

### Q2 — the exact DISPATCH ORDER
The precedence chain, first-match-wins, top to bottom, with the **exact predicate** for each branch (field +
comparison, not prose). This is the part we'd otherwise get wrong: e.g. does Charging beat Driving? Does
Sentry beat Parked? Where does Driving sit relative to the stale/freshness branch?

### Q3 — DRIVING specifically (our live bug)
1. Which state field(s) decide it — `DriveState.shift_state` ∈ {D, R, N}? speed > 0? `vehicle_state`?
2. What is the **exact string** — literally "Driving", or something with speed/gear, or a subtitle?
3. Does the car's *own* `shift_state` come over BLE in `DriveState` (we already read `driveState`), or is it
   cloud-only? We think we have it — confirm.
4. Is there a separate state for **N/neutral**, **R/reverse**, or **rolling but not in gear**?

### Q4 — CHARGING
Exact string(s), whether the line carries rate/kW/time-to-full/percentage, and which `ChargeState` fields
drive it. Also: does "Charging" replace "Parked" or co-render as a subtitle?

### Q5 — the FRESHNESS branch
- The exact threshold(s) — we use `TWO_MINUTES` for both `isVehicleDataStale` (#30694) and
  `fetchedDataRecently` (#30697). Confirm those are the same constant and that there isn't a second,
  longer threshold for the Asleep-vs-Last-seen split.
- Our age formatter is a port of moment's `fromNow` (thresholds s:45, m:45, h:22, d:26, M:11). Confirm, and
  confirm which variant takes the "ago" suffix (we pass `fromNow(true)` for Asleep = no suffix, and the
  suffixed form for Last seen).
- Does anything **reset** the age other than a successful data fetch?

### Q6 — the SUBTITLE / second line
Several rows in our UI have a secondary line (our Home shows "Nearby" under Location, the driver name under
Security & Drivers, "—" under Climate). Is the status area itself ever two lines — e.g. a state plus a
qualifier — and if so what drives the second line?

### Q7 — LOCAL vs CLOUD per state
For each state in Q1: can it be computed from VCSEC/CarServer data over BLE, or does it need the backend
(e.g. In Service, Mobile Access Disabled, software-update status)? We will hard-suppress the cloud-only
ones rather than show a wrong value.

### Q8 — what the official app shows for a car it can NEVER reach
Ours is that car for the official app (air-gapped). Knowing the app's terminal/never-fetched presentation
helps us distinguish "correct offline behaviour" from "our bug" when comparing screenshots side by side.

## Deliverable
A single **precedence-ordered table**: `order | state name | exact string(s) | predicate (fields + comparison)
| BLE-local or cloud-only | notes`. Plus the anchors (file/offset/selector) as usual, and a HIGH/MED/LOW per
row. If a row is only reachable with cloud data, say so on that row so we can drop it immediately.
