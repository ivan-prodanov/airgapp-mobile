# RE RESPONSE #19 — active-route visibility + RemoteNavTripOrder semantics

**Answers:** `REQUEST-19-active-route-visibility-and-trip-order.md` (Q1–Q5).
**Method:** 4 traces → 2 adversarial verifiers → critic. Instruction-level disassembly of **`libQtCarGUI.so.1.0.0`** (the layer that actually owns nav semantics — new to this round), `QtCarServer`, `QtCarTMServer`, `authd`'s carved VCSEC descriptors, both Hermes bundles, and jadx.
**The verify pass earned its keep twice:** V1 **refuted T1's headline recommendation** (f21 does not auto-navigate), and the critic **inverted the button design** for a reason the brief didn't anticipate.

> ⚠ **GENERATION CAVEAT, load-bearing:** this rootfs is **Intel MCU2 2026.14.3**; your car is **HW4 Ryzen 2026.20.6.6**. Nearly all order/nav semantics live in `libQtCarGUI` — precisely the layer most likely to have changed. Behavioural claims are **indicative, not guaranteed**. The one exception is Q2.5 (below), which is unusually transferable.

---

## The headline: your kill-condition did NOT fire — but ship two buttons anyway

**Q3.2 — PREPEND genuinely inserts and preserves the rest of the route. "Next stop" is not a lie.** PROVEN at instruction level: in `NavRouteManager::navigateToHistoryItem`@`0x2ed8880`, the `jg 0x2ed8e1f` at `0x2ed8cc2` is the **only** control edge that skips the `updateFinalDestination` prelude@`0x2ed8cd0`, and it's taken exactly when `index>=0 && plan non-empty && segCount>index` — i.e. exactly the prepend case. Append correctly falls *through* the prelude, because on append the new place *does* become final. Prepend routes to `NavTripPlanModel::insertUserDestinationAt(0, place)`@`0x2ed7c59` — a genuine **list insert**. Index enum recovered from `Q_ASSERT` text: `BeforeFirst=-2, ReplaceAll=-1, Append=INT_MAX`.

Corroboration: the on-screen **"Add Stop"** button (`NavigationWindow::addStop()`@`0x306f60d`) sets the *identical* flag pair — a remote add-stop drives the same state as a human pressing Add Stop.

**But three things you didn't ask about change the design more than that answer does.**

---

## ⛔ Blocker 1 — f53 and f106 SILENTLY DISCARD the order field

Your preferred **f106 cannot carry the order at all.** In `RemoteNavManager::requestNavigation(double,double,QString const&,int const& order)`@`0x2f42e00`, the SysV arg registers are spilled — `rdi→rbp`, `rsi→r12`, `xmm0→r13`, `xmm1→(%rsp)` — but **`rdx` (`&order`) is never spilled and never dereferenced**; the call at `0x2f42e60` clobbers it. **f53**@`0x2f434d0` is a shim that tail-calls the same function with an empty string.

The sole order decoder is `RemoteNavManager::prepRemoteNavCommand(int const&)`@`0x2f3f380`:
```
order==0 → NAVGUI_addingWaypoint = false
order!=0 → NAVGUI_addingWaypoint = true ; NAVGUI_appendWaypoint = (order==2)   [cmpl $0x2/sete @0x2f3f433]
```
An **exhaustive caller census** (full-binary scan) finds exactly **two** callers: **f21** `NavigationRequest`@`0x2f4d181` and **f22** `NavigationSuperchargerRequest`@`0x2f43611`. f53 and f106 never call it. (Also note: it tests `!=0`, so any non-zero non-2 value behaves as **Prepend** — no validation, no fault.)

⇒ **Only f21 and f22 can express PREPEND/APPEND.**

## ⛔ Blocker 2 — f21 sets the flags but does NOT navigate (V1's correction)

T1's headline said "build on f21." **V1 refuted it.** `requestNavigation(QString const&, int const&)`@`0x2f4cfd0` does call `prepRemoteNavCommand` first, then splits `"lat,lon"` locally@`0x2f4d2a7` (`split(',')` + `toDouble` — **no geocoding, genuinely air-gap-safe**) and calls the f53 shim@`0x2f4d39f`. But that shim's only semantic terminal is `NavigationWindow::displayRemoteNavRequest`@`0x307fd30`, whose entire call set is `{getSuperchargerFromId, displayPlace, createCustomPin}`. **It draws a pin. It does not route.** f21 + PREPEND sets the ambient flags and then waits for a human to tap Navigate on the centre screen.

**Only f22 (supercharger, by site id) both honours the order and routes directly** (`NavigationWindow::navigateToPlace`@`0x2f43655`).

## ⛔ Blocker 3 — the route fields are gated on someone being in the car

This is the one that hits your exact use case. In `CarAPIHandlerImpl::drive_state`@`0x9f10c0`, the block at `0x9f1413-0x9f1546` — containing **precisely the eight route DataValues** (`NAV_minutesToArrival`, `NAV_milesToArrival`, `NAV_trafficMinutesDelay`, `GUI_expectedTripEnergyPercent`, `NAV_activeRouteLastUpdated`, `NAV_routeTrafficLastUpdated`, `GUI_navDestinationLocationName`, `NAV_destinationGeoLocation`) — is guarded by `VAPI_driverPresent` (read @`0x9f11d8`/`0x9f13f0`) **else** `VehicleUtils::inDrivingGear(true)`@`0x9f1204`.

**Parked, nobody in the seat ⇒ no route info, ever.** And because the `clear_optional_active_route_*` calls live *inside* the guarded block, **"absent because gated" is byte-identical on the wire to "absent because no route."**

**The workaround, and it's the actionable find:** `DriveState.shift_state` is populated **outside** the gate (`VehicleInfoCommon::shiftStateToProto`@`0x9f1383`, reached from `0x9f1104`, long before `0x9f1413`). So the *same* response tells you whether the gate could have passed. With `ShiftStateNameMap`@`0x1727780` = `{0 Invalid, 1 P, 2 R, 3 N, 4 D, 5 SNA}`: if shift_state is P/Invalid/SNA and nobody is present, absent route fields are **uninformative** — do not render "no route."

---

## ⭐ The design verdict: TWO buttons — and the no-route button should send PREPEND, not REPLACE

The critic's core move, and I think it's right:

**`New trip` (REPLACE) must not be a peer button.** It is the only action that can destroy the route home; the app **can never see what it's destroying** (Q5: no stop-list message exists, proven); and it's unnecessary — the user can cancel nav in the car. Demote it to a secondary/overflow item, enabled only on a confirmed-fresh route read, behind a dialog naming the current destination.

**The no-route button should send PREPEND (order=1), not REPLACE.** PREPEND is a safe **superset** of replace-when-empty: with no active route it degrades to a plain navigation — PROVEN by two independent guards (`addPlaceToTripPlan`@`0x2edb751` logs *"!hasActiveRouteStatus in addPlaceToTripPlan, calling navigateToPlace"*; `navigateToHistoryItem`@`0x2ed8ca8`/`0x2ed8e8c` `isEmpty → ReplaceAll`). **One wire action is correct in both worlds**, so a wrong belief about route state costs nothing.

The asymmetry is the whole argument:
- Prepending when you meant replace → a stale stop 2. Annoying, fixable in-car.
- Replacing when you meant prepend → **the route home is gone.** Unrecoverable, and air-gapped you may not be able to rebuild it.

**So the bar is:** `Navigate` (order=1) alone when route state is unknown/absent — which, given Blocker 3, is most of the time; `Next stop` (order=1) + `Last stop` (order=2) when a route is confirmed fresh. **Same bytes for Navigate and Next stop — only the label changes.**

---

## Per-question answers

**Q1 — `active_route_destination` names the NEXT stop, not the final destination. PROVEN.** `GUI_navDestinationLocationName` ← `NavigationWindow::updateDestinationName`@`0x306fe00`, priority `activeOrPendingDestination` → `currentSegment` → `finalDestination` **only as last resort**. Minutes/miles are current-segment addends (`totalTimeToDestination`@`0xeee010`, `totalMilesToDestination`@`0xeedca0`); `NAV_destinationGeoLocation` is written from `currentSegment()`'s Place (`TMNavState::UpdateActiveDestination`@`0xcf77c0`). The car *computes* `GUI_activeDestinationIsFinalDest`@`0x3098130` and **never exports it**.
→ **Copy implication:** "Currently heading to X" is honest. **"Final destination: X" is not.**

**Q2.1 — Route survives Park. PROVEN.** `TMNavState::gearShifted()`@`0xd0bac0` makes no clear/cancel call; it refreshes the street address and calls `rerouteTriggeredNoLock()`.

**Q2.2 — Designed to survive sleep/reboot. INFERRED.** The plan is continuously serialised (`toVariantMapTripPlanV4`@`0xeeb720`) into persisted `GUI_navDestinationSavedTripPlanJson` (+`GUI_navTripPlanId`, `NAV_multistopRouteId`) written to `/home/tesla/.Tesla/data`; restore exists via `TMWaypointRouteRequest::setValue` `recalc.currentStops`. Machinery proven present; the auto-restore **trigger** was not traced (name-registry access, no direct xref). Non-volatility across a 12 V cut is unverifiable.

**Q2.3 — Cold-wake empty window exists. INFERRED, duration unmeasurable statically.** Order is boot → Valhalla map reload → saved-plan restore → recalc → `NAV_*` republish; QtCarServer answers `drive_state` **before** that completes, and the destination name may populate before ETA/miles.

**Q2.4 — Nothing clears the route on park or sleep. PROVEN, exhaustive over teardown sites.** Clears come from `onRouteComplete`/`onRouteCancelled`/`onInitialRouteFailed` → `cleanupNoLock`; arrival → `clearNoLock`; explicit `cancelRoute`. `TMNavState` has **no** onSleep/onWake slot. Any long-park/OTA clear policy would be backend-driven ⇒ **cloud-only ⇒ dropped**.

**Q2.5 — NO route signal is readable while asleep. PROVEN exhaustively, and this is the most transferable finding here.** The complete VCSEC asleep-readable set, carved from the car's own `FileDescriptorProto` in `authd`@`0x8f07c0` and cross-checked against `vc0/i3.java`:
```
VehicleStatus{ 1 closureStatuses, 2 vehicleLockState, 3 vehicleSleepStatus,
               4 userPresence, 5 detailedClosureStatus, 6 UIDesire, 7 gear, 8 keyLocationStatus }
```
Doors, lock, sleep, occupancy, gear, key location, tonneau %. **Nothing nav-related exists.** `car_server.proto` isn't even in `authd` — it lives only in `libSharedProto.so` on the infotainment side, consistent with `DriveState` being DOMAIN_INFOTAINMENT-only. **Detecting a route requires waking the car.** *(Why this one transfers: it rests on `shared-protocol`, a cross-ECU wire contract constrained by every deployed phone, on a slowly-evolving ECU — very likely bit-identical on your HW4 car.)*

**Q3.1 — 0/1/2 confirmed**, independently re-derived from `RemoteNavTripOrderNameMap`@`0x1722d40` → `{0 "Replace", 1 "Prepend", 2 "Append"}`. But the switch only happens for **f21/f22**.

**Q3.3 — APPEND → Car→B→A. PROVEN.** `index==INT_MAX`@`0x2ed8e92` → `appendToTripPlan` → `appendUserDestination`.

**Q3.4 — No active route ⇒ graceful REPLACE, cost of a wrong guess is NONE.** (This is what makes the two-button design safe.)

**Q3.5 — f106 does NOT honour order** (Blocker 1). Your preference for 106-for-the-label is unfortunately unavailable.

**Q3.6 — Stop limit: UNVERIFIABLE.** `underWaypointLimit`@`0x2ebb690` compares against a runtime `ConfigValue`, not a constant — and its only callers are **UI button-enable logic**, none in the remote chain, so **a remote add-stop appears to bypass the limit check entirely**. Overflow behaviour unknown.

**Q3.7 — Wake is a real hazard. PROVEN.** `requestNavigation`@`0x2f42e1d-38` requires `theCenterDisplay && theNavigationWindow` non-null, else `logAssert(…, "RemoteNavManager.cpp", 616)` *"Can't requestNavigation because theNavigationWindow is not initialized"* and **returns — no queue, no retry, silently dropped.** Also rejects on `GUI_valetMode`, `GUI_trackMode`, invalid coordinates. **Wake → wait for infotainment up → send → verify.**

**Q4 — The official app NEVER sends PREPEND or APPEND. PROVEN by exhaustive census.** All five phone-originated nav sends on both platforms are REPLACE (3 of 5 don't write the field at all). Zero bytecode readers of the Prepend/Append enum keys; `Proto2OAPI.java:484-535` drops order in all six conversions; `ob0/e.java` passes null for every nav slot (55 sites). **The BLE prepend/append path is untested by Tesla's own client** — expect flakiness and treat HW4 divergence as likely.

**Q5 — The stop list is NOT readable. PROVEN.** Full `FileDescriptorProto` decode of `car_server.proto` contains **no stop-list message anywhere**, and none of the multi-stop DataValues (`NAV_multistopRouteId`, `TMMultiStopStateGroupDataValue`) is read by any CarAPI handler (full-binary xref). You cannot show the user where their stop will land, and you can't even tell whether the destination you *can* read is the final one.

---

## Non-destructive on-car probes (never risk a real route)

1. **P1 — order plumbing.** Set a throwaway route to a nearby point. Send **f22** (supercharger, order=2) or **f21**; read back `active_route_destination`. Confirms order reaches the car at all on HW4.
2. **P2 — PREPEND preserves.** Throwaway route to B. Send PREPEND A. Read `active_route_destination`: if it becomes **A** *and* the centre screen still lists B, prepend inserts. **This is the HW4 confirmation of the whole design.**
3. **P3 — f21 auto-navigate?** Send f21 with order=1 and watch the centre screen: does it route, or only drop a pin awaiting a tap? (V1 says pin-only on MCU2.)
4. **P4 — the gate.** Park, exit, close doors, wait for `userPresence=NOT_PRESENT`, then wake and read `DriveState` **with a known-live route**: confirm the route fields are absent while `shift_state=P`. This validates the shift_state-as-gate-proxy rule.
5. **P5 — cold-wake window.** Wake from sleep with a live route; poll `DriveState` and time until `active_route_destination` populates.
6. **P6 — sleep survival.** Route active → full sleep → wake → is the route still there?

---

## What to change in airgapp

1. **Drop f106/f53 for anything order-bearing** — they discard the field. Use **f21** (coordinates as `"lat,lon"`, parsed locally, no geocoding) or **f22** for superchargers.
2. **Send order=1 (PREPEND) as your single `Navigate` action** when route state is unknown — safe in both worlds.
3. **Demote `New trip`/REPLACE** to a confirm-dialog secondary action, enabled only on a fresh route read.
4. **Gate on `shift_state`, not on route-field absence** — absent fields while parked/unoccupied mean *unknown*, not *no route*.
5. **Fix the route line copy** — "Currently heading to X", never "Final destination".
6. **Wake, wait for infotainment, then send** — an early send is silently dropped with no retry.
7. Parse `activeRouteCoordinates` (you have it, unused) — it gives the next stop's lat/lon for verification.

## Provenance
Traces `T1-order-semantics-carside` (HIGH), `T2-active-route-semantics-and-stoplist` (HIGH), `T3-route-lifecycle-sleep` (MED), `T4-app-order-usage` (HIGH); verifiers `V1-prepend-semantics` (**SUPPORTED/HIGH** — and **refuted T1's "build on f21" headline**), `V2-asleep-signal` (**SUPPORTED/HIGH**); critic (inverted the button design; independently re-derived the `drive_state` gate). Findings in `~/Work/tesla-firmware/out/req19-findings/`. Also closed: `NavServer::RouteReason` does **not** encode order (`RouteReasonNameMap`@`0x197a3e0` = `{0 Invalid, 1 User, 2 SmartSummon, 3 AutoNav, 4 FSDAutoNav, 5 RemoteRequest}`) — that line of enquiry is dead.
