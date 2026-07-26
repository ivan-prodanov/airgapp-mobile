# RE REQUEST #18 — multi-stop waypoints: the car ACCEPTS the command and ignores it

**Requested:** 2026-07-26
**Standing constraint:** airgapp is air-gapped — never Tesla's servers. If the answer requires the
backend, say so and we drop multi-stop entirely.

## The failure, precisely

Single-destination navigation **works**: `NavigationGpsRequest{lat, lon, destination, order}` →
the car routes, on-car verified, repeatedly.

Multi-stop **does not** — but not in the way we expected. The car **accepts and acknowledges** it:

```
cmd: dispatch {"type":"navigateWaypoints","keys":[],"inFlight":0}
cmd: settle   {"type":"navigateWaypoints","ms":581,"outcome":"ok"}      ← ×5, always ok
```

`outcome:"ok"` means we got a real success reply back through the same sealed CarServer path our
working commands use. **No route ever appears on the car.** So the seal, domain, framing and
routing are all provably fine — the `waypoints` STRING is parsed and discarded.

## What we send

`Action.vehicleAction.navigationWaypointsRequest.waypoints`, on `DOMAIN_INFOTAINMENT(3)`, sealed
exactly like every working command. String content:

```
42.697700,23.321900;42.700000,23.330000
```

i.e. the format from Teslemetry's own `NavigationWaypointsRequest` test vector
(`"37.3230,-122.0322;37.4419,-122.1430"`) — comma between lat and lon, semicolon between waypoints
— rendered at 6 decimal places. We exclude the car's own position (`stops[0]`) on the assumption
that waypoints are destinations and the car is the origin.

## What we've already ruled out

- **`TripPlanOptions` is not a missing requirement** — the message has only `waypoints` +
  `tripPlanOptions`, and `TripPlanOptions` carries only `destinationStartSoe` /
  `destinationArrivalSoe` (battery targets).
- **No trip-order field exists** on this message (unlike `NavigationGpsRequest`), so `order`
  cannot be the problem.
- **Not a transport/auth problem** — same session, same seal, same domain as the working
  `navigateTo`; the car replies OK.
- **Not the `NAV_ORDER` off-by-one** — that's fixed (REPLACE=0, verified in `fc0/f3.java`), and it
  only applies to the GPS request anyway.

## Questions

### Q1 — what does the official app actually put in that string? (the load-bearing one)
Byte-exact, from a real send: the full `waypoints` value for a 2-stop and a 3-stop route.
Specifically:
1. **Coordinates or Place IDs?** If the app *only* ever sends `refId:`-prefixed Google Place IDs
   in production, say so plainly — then coordinates are a Teslemetry/API-only path and an
   air-gapped client cannot do multi-stop at all, which is the answer we need to hear.
2. **Does it include the ORIGIN** (the car's current position) as the first element?
3. **Decimal precision**, and any leading/trailing delimiter.
4. Is there a **count limit**, or a max string length?

### Q2 — what gates coordinate acceptance?
`MOBILE_APP_FEATURE_WAYPOINTS_REQUEST_ACCEPTS_COORDINATES` exists in `gc0/v.java`. How does the
app learn whether a given car has it, and **is that list readable over BLE**? Our vendored proto
models no feature list at all, so we currently cannot check the capability — if it's readable
locally we'd gate the UI on it instead of sending something the car will silently drop.
If it's cloud-supplied, say so and we treat multi-stop as unavailable offline.

### Q3 — does the car ACK an unparseable waypoints string?
We assume yes (that's what we observe), but confirm: does CarServer return
`result:true` for a `NavigationWaypointsRequest` it cannot parse or does not support? If it does,
then **`outcome:"ok"` is worthless as a signal here** and we need a different way to detect
success — is there one (a state field, an `active_route_*` change, an error surface we're not
reading)?

### Q4 — is there a different message for multi-stop?
`navigationWaypointsRequest` is what we found. Is there another CarServer action the app uses for
multi-stop routing (a repeated-destination message, or several sequential
`NavigationGpsRequest`s with `order=APPEND`)? **If APPEND-chaining is how it's really done, that
alone solves our problem** — we already have that path working and just need the ordering
semantics confirmed (send destination 1 with REPLACE, then 2..n with APPEND?).

## Why it matters
"Send to Car" is wired and working for a single destination. Multi-stop is the last gap, and we've
deliberately fallen back to sending only the final destination (with the UI saying so) rather than
letting a silently-discarded itinerary look like success. Q4 in particular could make this trivial.
