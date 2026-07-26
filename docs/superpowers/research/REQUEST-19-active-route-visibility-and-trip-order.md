# RE REQUEST #19 — active-route visibility + RemoteNavTripOrder semantics

**Requested:** 2026-07-26
**Answer into:** `docs/superpowers/research/RESPONSE-19-active-route-visibility-and-trip-order.md`
**Standing constraint:** airgapp is air-gapped — never Tesla's servers. If an answer requires the
backend, say so plainly and we drop that capability rather than route through Tesla.

## What we're building

We are scrapping our client-side trip planner (it was built on
`NavigationWaypointsRequest`, which REQUEST-18 established the car parses and discards). The
replacement is deliberately minimal: you open a place — a dropped pin, a POI, a search result, a
charger — and get **one** of two action bars.

- Car has **no active route** → a single `Navigate` button → `order = REPLACE`.
- Car **has an active route** → `Next stop` (`PREPEND`) / `Last stop` (`APPEND`) / `New trip`
  (`REPLACE`).

Everything below exists to answer one of two questions: **how do we know which bar to show**, and
**does the order field actually do what its name says**.

## What we already know (don't re-derive)

- `NavigationGpsRequest` (field 53) and `NavigationGpsDestinationRequest` (field 106) both carry a
  `RemoteNavTripOrder`. Single-destination `REPLACE` is **on-car verified**, used daily.
- Wire values, from the decompiled app's `fc0/f3.java`: `REPLACE=0`, `PREPEND=1`, `APPEND=2` — no
  `UNKNOWN` member. Our vendored `.proto` had these off by one; that is fixed
  (`src/ble/builders.ts` → `NAV_ORDER`).
- `APPEND` has been exercised on-car via APPEND-chaining (commit `62ba042`). `PREPEND` has **never
  been sent to a real car by us**. It is inferred from the enum and nothing else.
- We read `DriveState` over BLE on `DOMAIN_INFOTAINMENT(3)` and already parse
  `active_route_destination`, `active_route_minutes_to_arrival`, `active_route_miles_to_arrival`
  (`src/ble/telemetry.ts`). `active_route_coordinates` (LatLong) exists in our generated types but
  we do not read it yet.
- Our poll reads `DriveState` **only while the car reports awake** — `awakeSync()` does not wake the
  car and its reads fault on a sleeping one.

---

## Q1 — what does `active_route_destination` name on a MULTI-STOP route? (load-bearing)

If the car is routing Car → A → B:

1. Does `active_route_destination` hold **A** (the next stop) or **B** (the final destination)?
2. Do `active_route_minutes_to_arrival` / `active_route_miles_to_arrival` refer to the same stop as
   the destination string, or to the end of the whole route?
3. Same question for `active_route_coordinates` — next stop or final?

This decides what our route line can honestly say, and whether the labels "Next stop" / "Last stop"
describe the result the user will actually get.

## Q2 — route lifecycle across park and sleep

This is the case that drives the whole design: **you park mid-route at a supermarket, walk in, and
open the app.** The car will be asleep by the time you're at the checkout.

1. Does an active route survive **shifting to P**? (We assume yes — the centre screen resumes it —
   but confirm.)
2. Does it survive the car entering **sleep**?
3. If it survives sleep: on wake, are `active_route_*` repopulated **immediately**, or only once the
   car is shifted out of P / the drive resumes? If there's a window where the car is awake but the
   fields read empty despite a live route, we need to know its length — we'd otherwise render "no
   route" and offer the user only a destructive REPLACE.
4. Is the route cleared by anything else we should expect — arriving at the final stop, a long park,
   a door-open-and-walk-away, an OTA?
5. **Is there any route-active signal readable over BLE while the car is ASLEEP** — anything in
   VCSEC (`FromVCSECMessage` / `VehicleStatus`), or any field outside `DriveState` on a domain that
   answers without waking? If such a flag exists it solves this problem outright. If not, say so and
   we accept that detecting a route requires waking the car.

## Q3 — `RemoteNavTripOrder` semantics, car-side

From QtCarServer's own handling (`CarAPI::navigation_gps_request(..., const
CarAPI::RemoteNavTripOrder&, ...)`), not from the app's intent:

1. Confirm `REPLACE=0`, `PREPEND=1`, `APPEND=2` are the values the **car** switches on, for both
   field 53 and field 106.
2. With an **active route** Car → B, what does `PREPEND` with destination A actually produce?
   - Car → A → B (A inserted as an intermediate stop, B still the final destination), **or**
   - Car → A (B discarded)?
   The whole feature rests on this being the first one.
3. With an **active route** Car → B, does `APPEND` with A produce Car → B → A?
4. With **no active route**, what do `PREPEND` and `APPEND` do — silently behave as `REPLACE`,
   no-op, or fault? We may end up showing all three buttons when the car's state is unknown, and we
   need to know what the wrong guess costs the user.
5. Is `order` honoured identically on `NavigationGpsDestinationRequest` (106, which also carries a
   label) as on `NavigationGpsRequest` (53)? We prefer 106 so the stop shows a name rather than a
   coordinate.
6. Is there a **maximum stop count**, and what happens on overflow — oldest dropped, request
   rejected, or silently ignored?
7. Does `PREPEND`/`APPEND` behave the same when the command itself is what **wakes** the car, versus
   being sent to an already-awake car?

## Q4 — does the official app ever send PREPEND or APPEND?

From the decompiled app: is `RemoteNavTripOrder` ever set to anything other than `REPLACE` on a
phone-originated send, and from which UI affordance? If the app only ever sends `REPLACE` and
`PREPEND`/`APPEND` exist solely for an in-car or backend-originated path, that is a strong signal
the BLE path is untested by Tesla and we should expect it to be flaky — worth knowing before we
build a UI on it.

## Q5 — can the multi-stop list be READ over BLE?

`NAV_multistopRouteId` appears car-side. Is there any readable message that returns the **ordered
list of stops** for the active route (not just the single `active_route_destination`)? If there is,
our action bar could show the user where their new stop will land instead of asking them to trust a
label. If it's cloud-only, say so and we stop looking.

---

## What a good answer looks like

Q2.5 and Q3.2 are the two that change the design. Q3.2 especially: if `PREPEND` discards the rest
of the route, "Next stop" is a lie and we ship two buttons instead of three. A clear "no" is as
useful to us as a yes — we'd rather cut the feature than ship a button that silently destroys the
user's route to Home.
