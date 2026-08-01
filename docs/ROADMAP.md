# Roadmap

Living doc. Newest state at the top of each section. Anything claimed "done" here should name the
measurement that proved it — this project has been burned repeatedly by conclusions that were
reasoned rather than measured.

---

## P0 — next

### Optimism is destructive, not layered
**Identified 2026-07-28 while fixing the trunk double-tap.** Our optimistic value is written straight
into the view state, overwriting the last known real value. The official app instead keeps a
per-vehicle LIST of pending optimistic commands and renders `real + pending overlay`, dropping an
entry by `commandId` on `VEHICLE_COMMAND_SUCCESS`. Removing the overlay instantly reveals a real
value that was never touched — which is why their trunk snaps back in ~1s with no read at all.

We now paper over this with a verify-read after every command settles (~600ms total). That matches
the timing but not the model, and it costs a BLE round-trip per command. Layering the optimism —
keeping `state` real and resolving `state + inFlightCommands` at render — would remove the extra
read, make rollback trivial (drop the entry), and delete the intent-grace machinery entirely.

Not urgent now that the timing is close, but it is the honest end state, and every remaining
grace/rollback subtlety is a symptom of not having it.


### ~~Optimistic updates outlive reality (the frunk double-tap)~~ — FIXED 2026-07-28

Fixed by making the frunk's optimism ASYMMETRIC, recovered from the official app after Ivan pointed
out its behaviour (tap → opens instantly; tap again → stays open until the car says otherwise):

```
sendFrunkCommand @3986012
  hasPoweredFrunk ? send(Front, !isOpen)   // a real directional close
                  : send(Front, true)      // ALWAYS open. No close command exists.
```

A standard Model Y has no powered frunk, so their app cannot express "close" and never guesses one.
`checkFrunkTrunkCommand` @1186905 matches on the resolution side: an optimistic OPEN clears once the
closure reports not-closed, a CLOSE once it reports closed, correlated by `commandId`.

So ours now: the command fires on EVERY tap (dispatched explicitly — `reconcile.ts` deliberately has
no frunk diff rule, which would send nothing on the second tap, the exact tap an aftermarket
auto-close rides), while `actuateFrunkState` only ever moves the value to OPEN. Closed comes from the
stream or the poll.

**A FIRST ATTEMPT WAS WRONG AND SHIPPED BRIEFLY.** It dropped any toggle whose command was in flight.
That covered only the ~1-2s the command takes, while the lid takes ~5s — a tap at t=3s still produced
an optimistic CLOSED for the grace to defend. It also suppressed the re-actuate an auto-close needs.
The test passed because it encoded my model of the repro rather than the physical timing.

**A SECOND ERROR WAS CAUGHT BEFORE SHIPPING**, and is the more interesting one: `dispatch`'s
`affectedKeys` both marks the control busy AND stamps the intent-grace window. Claiming `frunkOpen`
on the re-actuate would have suppressed exactly the "closed" read we wait for — the original defect
with the directions reversed. `frunkActuateClaimedKeys` claims only what we actually assert. The cost
is no busy affordance on the re-actuate tap, since one parameter does both jobs; worth separating.

**Two things this write-up had wrong, worth keeping:**

1. It proposed "end the grace on CONFIRMATION, not on a timer" as the fix. **That already shipped on
   2026-07-18** — nine days BEFORE the report — and cannot help here by construction:
   confirm-and-release releases when a read AGREES, and the whole defect is that our optimistic value
   is one the car never agreed to, so the correcting read is a CONTRADICTION and gets stripped.
2. It suggested `coalesce.ts` might be a config gap. It is not — the coalescer coalesces COMMANDS,
   and the optimistic UI flip happens outside it entirely.

The actual root cause, read rather than reasoned: `toggleState` derives from `state[key]`, which
after an unlanded tap is a guess. Frunk actuate is a TOGGLE (both taps send the same `openFrunk`), so
the car may ignore the second while the lid is mid-travel — and then the grace defends our wrong
value. Lock is immune because lock/unlock are ABSOLUTE: two taps ask for two different states and the
car honours both.

Only `toggle` is guarded. `patch`/setpoints carry an absolute value the user picked, so a second one
is a legitimate new intent, and `coalesce.ts` already collapses those bursts.

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

## Open bugs — found 2026-07-31

Surfaced by Ivan across the Tesla-icon pass, the Schedules screen, charging, and Security & Drivers.
Not yet root-caused unless noted; the file named is where the work starts, not a diagnosis.

1. **FIXED 2026-07-31 — Home header faded too late on scroll.** The hypothesis held: the fade was
   anchored to `maxScroll` (which grows with the menu below, so it hid the header far too late).
   Re-anchored to where the favorites bar meets the header — `carBand − (insets.top + headerH)`, a
   fixed distance independent of menu length — with a `FADE_LATER` knob (`EXPAND * 0.3`) for exactly
   how late it finishes. `HomeScreen.tsx`. On-device confirmed by Ivan.

2. **FIXED 2026-07-31 — Favorites bar not persisted.** Two faults: it used an in-memory `Map` (lost
   on cold start) AND was global. Confirmed from the decompiled bundle that Tesla stores it
   PER-VEHICLE — `quickControlsLayout`, a VIN-keyed map in `vehiclePresentationState` (reducer writes
   `[vin] = layout`, selector `getSelectedQuickControlsLayout`, default `{}`). Reimplemented favorites
   as a per-vehicle map keyed by the active vehicle id, persisted via AsyncStorage (`prefs.v2`); the
   `usePreferences()` API is unchanged so consumers didn't move. `preferences.ts` + `VehicleProvider.tsx`.
   881/881 tests (incl. a per-vehicle-isolation test); on-device confirmed by Ivan.

3. **FIXED 2026-07-31 — Controls charge-port used the old icon.** It was the charge-port MARKER in
   `MarkerOverlay` (not `ControlsScreen`), rendering SF Symbol `bolt.fill`. `IconButton` gained an
   optional Tesla-`glyph` path (AppIcon); the charge port now uses `bolt-filled`. Lock marker left on
   its SF symbol (not reported). On-device confirmed by Ivan.

4. **REQUIRES TESTING (implemented 2026-08-01) — Low Power Mode was inert.** Wired to a real command:
   `SetLowPowerModeAction` (VehicleAction 130) exists, so added the builder + `lowPowerMode` command +
   optimistic `lowPowerMode` state; the control now toggles on/off and shows `LOW_POWER.{on,off}`.
   ⚠️ Only TWO of the three states: the car reports NO low-power readback in our poll, and the 3rd icon
   (on_disabled = Tesla's `vehicle_low_power_mode_disable_forced_on`, a car-reported "forced on") can't
   be detected without that read. On/off is optimistic-only (like the security PINs). `builders.ts` +
   `commands.ts` + `controlActions.ts` + `reconcile.ts`. **On-device verification pending.**

5. **FIXED 2026-07-31 — Climate fan static on the Home menu.** The Home menu's "Climate" `NavRow`
   drew a static `fan-filled` (the favourites bar already spun via `SpinningSymbol`). Added a `spin`
   prop to `NavRow` (renders through `SpinningSymbol`) and passed `spin={state.climateOn}`.
   `HomeScreen.tsx`. On-device confirmed by Ivan.

6. **FIXED 2026-08-01 (another agent) — Parental Control & Speed Limit Mode icons were wrong.** Both
   rendered the wrong glyph on the Security screen. `security.tsx`. Confirmed by Ivan.

7. **REQUIRES TESTING (implemented 2026-08-01) — Schedules weren't scoped to the selected location.**
   The car keys schedules by location and returns per-schedule coords (`RawSchedule.lat/lon`), which we
   were dropping. Now captured onto the local model (`carTo*`), and the list is filtered to the selected
   location (`schedulesAt`). New schedules are tagged with the selected location's coords; edit/toggle
   keep their own. Coordless legacy/demo schedules ride with Current so nothing vanishes.
   `schedules.ts` + `schedules.tsx`. New unit tests (`locationKey`/`scheduleLocations`/`schedulesAt`).
   **On-device verification pending.**

8. **REQUIRES TESTING (implemented 2026-08-01) — location picker is now data-driven.** Done with 7:
   replaced the fixed `ScheduleLocationKey` picker with dynamic `{key,label}` options. The dropdown now
   lists **Current Location + Home + Work + each OTHER place that has schedules**. Home/Work are sourced
   from the CAR's saved locations (`ChargeState.home_location`/`work_location`, fields 176/177 — now read
   in telemetry into `homeCoord`/`workCoord`); other places are reverse-geocoded to a street name.
   Selecting one scopes the list to it. `LocationPickerSheet.tsx` + telemetry + `vehicleTypes.ts`.
   **On-device pending — and Home/Work only appear IF the car actually reports those coords over BLE
   (the field exists in the ChargeState we read; the car may still omit it).**

9. **REQUIRES TESTING (implemented 2026-08-01) — 3rd-party charger, session not started.**
   - (a) RESOLVED, EXPECTED: "Charging Error - No Power" is Tesla's literal string
     (`vehicle_status_screen_charging_no_power`, verified in the translation table @926615). The car
     reports `chargingState=NoPower` when a cable is seated but no current flows (unpaid 3rd-party
     charger). No change beyond a comment marking the string verified.
   - (b) FIXED: the Start button was driven by a sticky optimistic `charging` flag. A definitive
     NoPower read now overrides it (`showStop = charging && !noPower`), so it no longer sticks on
     "Stop" on a dead charger — the narrow, no-refactor version of Tesla's live-state + ongoing-command
     selector (`getDisplayStartButtonSelector`). `ChargeCard.tsx`. **On-device verification pending.**

10. **REQUIRES TESTING (implemented 2026-08-01) — Parental Controls sub-toggles were off by one.**
    Confirmed the cause: the on-car repro (our SPEED_LIMIT set the car's ACCELERATION, CURFEW set
    nothing — every setting one ahead) proves the FIRMWARE enum is 0-based, while the vendored proto
    (and our `PARENTAL_SETTING_ENUM`) is 1-based (UNKNOWN=0, SPEED_LIMIT=1 … CURFEW=4). Decremented to
    match the car (acceleration→1, safetyFeatures→2, curfew→3). `builders.ts`. accel/safety/curfew are
    unambiguous; **speedLimit→0 is omitted on the wire (encoder guards `setting !== 0`) so the car
    reads a missing setting as its default (0 = speed limit) — the one part to confirm on-car.**

11. **FIXED 2026-08-01 — Speed-Limit value was two fields, one on the car.**
    Root cause was two independent LOCAL fields (`speedLimitMph`, `parentalLimitSpeedMph`) — and
    telemetry reads back NEITHER (only the on/off `speedLimitMode`), so the drift was purely local.
    Removed `parentalLimitSpeedMph`; both sheets now read/write the single `speedLimitMph`. Reconcile
    emits the Speed-Limit-Mode setter, and when Parental Controls is active also mirrors through the
    parental setter (owns no keys → uncoalesced) so the car's parental cap can't drift.
    `vehicleTypes.ts` + `ParentalControlsSheet.tsx` + `reconcile.ts` + `vehicleVisualState.ts`.
    881/881 tests (incl. a new reconcile case). Confirmed by Ivan.

12. **REQUIRES TESTING (implemented 2026-08-01) — Charging-finished "Unlock Port" was a no-op.**
    Root cause: the button did `patch({ chargePortOpen: true })`, but with a cable in the port is
    already open, so it diffed to NOTHING and no command reached the car (the frunk lesson, which the
    button's own comment named but never applied). Now dispatches `openChargePort` (unlatch,
    `closureMoveRequest chargePort=OPEN`) EXPLICITLY via a new `unlockChargePort` action, claiming no
    keys. `ChargeCard.tsx` + `useFleetState.ts` + `useVehicleState.ts`. **On-device verification
    pending** — was "seen once", so if it still fails after this it's a transport hiccup, not a
    missing command.

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

### Generate the Xcode project from a committed spec (XcodeGen or Tuist)
`/ios` is now tracked (`d1efc08`) — the pragmatic fix for a folder that was ignored as "generated"
while being hand-maintained and un-regenerable. That closes the data-loss hole. It does not close
the reason the folder was ignorable-looking in the first place.

**Why this is the real answer, not just tidiness.**

`project.pbxproj` is a single machine-written file listing every source, build phase, target
membership and setting. It merges terribly — two people adding a file touch the same lines with
opaque 24-hex identifiers, and a botched resolution produces a project that opens fine and links the
wrong thing. That is the one genuine argument for ignoring the tree, and committing it accepts the
risk rather than removing it.

Generating it removes the risk instead: the source of truth becomes a readable YAML/Swift spec
listing targets, sources, entitlements and settings. That file merges like code. The `.xcodeproj`
becomes a build artifact and goes back in `.gitignore` — legitimately this time, because it really
would be generated.

**We are already halfway there and did not notice.** `ios/scripts/add_engine_files.rb` and
`add_share_resolver_files.rb` are declarative, idempotent registration of sources, resources and
frameworks into a target — a hand-rolled project generator with one backend. Every new file this
session (`CarPresence`, `TransportArbiter`, `BleBytePipe`) had to be added to a list there AND
survive a `pod install`, and twice the build broke because it was in one list but not the other
(`cannot find 'CarPresence' in scope`, then the same for `BleBytePipe`). A spec makes that one list.

**What it has to reproduce** — this is why it is a project and not an afternoon:
- the embedded Godot engine linkage and its static-framework build settings,
- the ShareExtension target: entitlements, App Group, keychain access group, `AirgappEngine.js` as a
  bundle resource, JavaScriptCore, and sources compiled by reference from `modules/`,
- CocoaPods integration (`use_frameworks!` disabled for 79 pods by the Expo script),
- the Release configuration that a device build actually uses.

**Do not start this without a working-build checkpoint to return to.** The failure mode is a
generated project that compiles and subtly differs — a missing entitlement, a dropped build setting —
and those surface on device, not at build time. The check that it worked is a byte-comparable `.app`
and a share that still reaches the car, not "it builds".

Alternative worth considering first: Expo CNG with config plugins. Rejected for now — expressing the
Godot engine and a Swift share extension as plugins is more work than XcodeGen for the same benefit,
and `expo prebuild` remains the command that must never run here.

### The outbox outlives its purpose, and `unverified` can duplicate
The share extension sends for itself now, so the outbox is no longer the delivery path — but it
cannot be deleted yet: `arms = [pi]` because the BLE arm does not exist, so an out-of-range share
with no reachable Pi has nowhere else to fall. Ivan wants it gone ("if it didn't work, I'd retry,
not open the app"), and it goes when the BLE arm lands.

Separately, an `unverified` verdict still queues, so a send that DID land without a readable verdict
can arrive twice. Chosen over reporting success for something that may never have arrived — but it
is the same behaviour that read as "I shared A and B showed up" on 2026-07-27.

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
