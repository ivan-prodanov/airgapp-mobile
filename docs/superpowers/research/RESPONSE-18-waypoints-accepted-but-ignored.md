# RE RESPONSE #18 — multi-stop waypoints: why the car ACKs and ignores it

**Answers:** `REQUEST-18-waypoints-accepted-but-ignored.md` (Q1–Q4).
**Method:** direct Hermes bytecode analysis of the official iOS bundle (4.58.0) + Android jadx + **QtCarServer on the car image**. Done by me (subagent workflows were still failing on `529 Overloaded`). Every claim cites a function index + bytecode offset you can re-check.

---

## ⚠ UPDATE 2026-07-26 — Q4 TESTED AND FAILED (APPEND behaves like REPLACE). Here's why, and what's left.

Ivan chained `NavigationGpsRequest` with `order=APPEND` at 600 ms spacing: the car just showed each destination in turn — every send **replaced**. The enum is not the problem (app `fc0/f3`: `RemoteNavTripOrderReplace/Prepend/Append` = 0/1/2; car has `RemoteNavTripOrderNameMap` with `Replace`/`Prepend`/`Append`). **The reason is structural:**

**`RemoteNavTripOrder` never reaches the trip planner.** Every symbol in QtCarServer that mentions it is in the **CarAPI transport layer** — `CarAPI{,Impl,HandlerImpl}::navigation_{gps,gps_destination,sc,}_request(...)`, their `async*` twins, and a `RemoteNavTripOrderDataValue` (a published state variable). **No `TMServer` (trip-manager) function takes a `RemoteNavTripOrder` at all.** The trip planner's actual multi-stop entry points are:

```
TMServer::routeToWaypoints(TMWaypointRouteRequest, QMap<QString,QVariant>, int, …)
TMWaypointRouteRequest  ← built from a QVariant containing recalc.currentStops (a STRUCTURED stop list)
TMServer::getMultiPointRoute(TMMultiPointRouteRequestList, …)
TMMultiPointRouteRequest::addDestinationLocation(int, const LocationCoordinate&)   ← coordinates!
TMMultiPointRouteRequest::addOriginLocation(int, const LocationCoordinate&)
```

So the car **does** have a coordinate-based multi-point API (`LocationCoordinate`, indexed) — but it lives on **TMServer's internal IPC**, not on the phone-facing CarAPI. From the phone there is exactly **one door into multi-stop**: `navigation_waypoints_request(QString waypoints, QMap options)`. The GPS request is a *single-destination* API whose order flag is interpreted (or ignored) by the CID nav app downstream — and empirically, for a plain GPS destination, it is ignored.

**Consequence: APPEND-chaining is dead. Don't spend more on it.** Q4's recommendation is withdrawn — that's what testing is for.

### What's actually left, cheapest first

1. **Re-test the waypoints string with a COMMA separator and flat coordinates** *(cheapest, and it directly targets your original failure)*. You tested `lat,lon;lat,lon` — semicolons. The app's own join is **`,`** (`#114892 @0545/054a`), and a feature bit literally named `MOBILE_APP_FEATURE_WAYPOINTS_REQUEST_ACCEPTS_COORDINATES` exists, so *some* firmware parses coordinates out of this field. Try:
   - `42.697700,23.321900,42.700000,23.330000` (flat, comma-joined alternating lat/lon)
   - and, as a second shot, `42.697700 23.321900,42.700000 23.330000` (space inside a pair, comma between pairs)
   
   **Unproven** — the token parser is downstream of QtCarServer's proxy and not in any image we hold. But it is two one-line experiments against the exact field that already ACKs, and it's the only way coordinates could ever enter this path.
2. **`superchargerId:` tokens** — proven format, comma-joined, and **offline-constructible** if you hold site ids. Also note the car has `navigation_sc_request(const int& siteId, const RemoteNavTripOrder&, …)` — a supercharger-by-id call that *also* carries the order flag, so it's worth one APPEND test there even though GPS-APPEND failed (different downstream handler).
3. **The `options` map** — `navigation_waypoints_request`'s second D-Bus arg is `a{sv}` (`<arg direction="in" type="a{sv}" name="options"/>`), which you currently send as `TripPlanOptions{startSoe,endSoe}`. Worth dumping what keys the car accepts there; it is the only structured channel on the multi-stop door.
4. **Unexplored entry points** — `navigation_dropped_pin_request` and `navigation_fixed_route_request(s fixed_route_name)`.

**Verification for all of the above: stop trusting the ACK.** Read back `DriveState.active_route_*` (already on your wire) and assert the stop list actually changed; the car-side failure only ever appears in its own log as `TMWaypointRouteRequest: Invalid waypoint in recalc.currentStops`.

---

## ⚠ FIRST: "but single-destination `lat,lon` works!" — no contradiction. Different API, different wire type.

Coordinates absolutely work for navigation. They just don't work **inside the `waypoints` string**, because that field is not a coordinate field — it's an opaque token list. The car exposes **four separate nav entry points with different C++ signatures** (from QtCarServer's dynsym; `RKd` = `const double&`, `RK7QString` = `const QString&`):

| car entry point | signature | takes |
|---|---|---|
| `CarAPIImpl::navigation_gps_request` @`0x839d10` | `(RKd, RKd, RK RemoteNavTripOrder, …)` | **two real doubles** + order |
| `CarAPIImpl::navigation_gps_destination_request` @`0x83aae0` | `(RKd, RKd, RK7QString, RK RemoteNavTripOrder, …)` | **two doubles** + a name string + order |
| `CarAPIImpl::navigation_request` @`0x83a560` | `(RK7QString, RK RemoteNavTripOrder, …)` | a **share-text** string (address/URL) |
| `CarAPIHandlerImpl::navigation_waypoints_request` @`0xa08e70` | `(RK7QString, RK QMap<QString,QVariant>, …)` | **one opaque string** + options — **no doubles anywhere** |

**Your working path is #1.** You send `NavigationGpsRequest{lat, lon, destination, order}` — the lat/lon arrive as **numeric protobuf fields** and reach the car as **actual C++ doubles**. Nothing is ever parsed out of text, so there is no format to get wrong. That is why it works, every time.

**The waypoints path is #4.** There is exactly one string, and the car must *tokenise* it. The app's tokens are `refId:<id>` / `superchargerId:<id>` (proven below). When you hand it `42.6977,23.3219;42.7,23.33`, the car splits on `,` and gets tokens like `42.6977`, `23.3219;42.7`, `23.33` — none of which carry a recognised prefix, so each is discarded. The message is well-formed, the seal is valid, the handler ACKs — and zero stops survive parsing. Exactly your symptom.

So the two observations are consistent: **coordinates are first-class as *doubles* in the GPS request, and simply have no representation in the *waypoints string*.**

> This also reinforces Q4: `navigation_gps_request` — your already-working, double-based call — is the one that carries `RemoteNavTripOrder`. That is why APPEND-chaining it is the natural coordinate-based route to multi-stop.
>
> (Two further entry points exist that I did not previously mention and that no one has explored: **`navigation_dropped_pin_request`** and **`navigation_fixed_route_request(s fixed_route_name)`**.)

---

## TL;DR — your string is wrong in two independent ways

The official app **never sends coordinates** in `waypoints`. It sends **prefixed reference tokens joined by commas**:

```
refId:<placeId>,superchargerId:<siteId>,refId:<placeId>
```

You are sending:
```
42.697700,23.321900;42.700000,23.330000
```

So both the **token format** (bare coords vs `refId:`/`superchargerId:` prefixes) and the **separator** (`;` vs `,`) differ. The car parses tokens it doesn't recognise and drops them — which is exactly your "ACK + no route".

**And the load-bearing consequence:** `refId` is a **Google Place ID** and `superchargerId` is a **Tesla site ID**. Neither is derivable offline for an arbitrary lat/lon. **So multi-stop by coordinate is not available to an air-gapped client** — with one genuine exception (superchargers, §Q1c) and one workaround worth testing (§Q4).

---

## Q1 — what the app actually puts in that string (byte-exact mechanism)

The builder chain, all proven:

1. **`#114892`** (the Send-to-Vehicle flow) picks the path — `vehicleSupportsSendWaypointsToVehicle` @`009e`, else `vehicleSupportsSendGPSToVehicle` @`0131` / `vehicleSupportsSendGPSDestinationToVehicle` @`014e`. Analytics literals confirm the four branches: `SEND_TO_VEHICLE`, `SEND_GPS_DEST_TO_VEHICLE`, `SEND_GPS_TO_VEHICLE`, `SEND_SC_TO_VEHICLE`, **`SEND_WAYPOINTS_TO_VEHICLE`** @`055c`.
2. **The waypoints string is built at `#114892` @`04b2`–`054a`:**
   ```js
   stops.filter(…)        // 04b2
        .map(…)           // 04c3  → one token per stop
        .filter(…)        // 04d4  → drop stops that produced nothing
        .join(',')        // 0545 'join', 054a ','      ← COMMA, not semicolon
   ```
3. **Each token** (nested closure, @`00be`–`013e`) is exactly one of:
   - `"superchargerId:" + stop.id` @`0118`
   - `"refId:" + stop.refId` @`0138`
   
   and if the stop has **neither**, it is **silently skipped** with the log:
   > `Skipping waypoint without refId or valid supercharger id (type: …, id: …, refId: …)` @`00e1`
   
   Selection is by `TripPlannerPlanResultStopType` ∈ {`SUPERCHARGER`, `WAYPOINT_SUPERCHARGER`, `WAYPOINT`, `ORIGIN_SUPERCHARGER`}.
4. **`#31892 navigationWaypointsRequest`** is a pure pass-through: `new NavigationWaypointsRequest().setWaypoints(param1)` @`0058`, optional `.setTripPlanOptions()` @`007f`, wrapped into `VehicleAction.setNavigationwaypointsrequest()` @`008a`. It does **no** formatting — the caller owns the string.

**Answers to your sub-questions:**

| # | question | answer |
|---|---|---|
| 1 | coordinates or Place IDs? | **Place IDs / site IDs only.** `refId:` (Google Place ID) and `superchargerId:` (Tesla site ID). There is **no** code path in 4.58.0 that emits a bare coordinate into `waypoints`. Your Teslemetry test vector is an API-side convention, not what the app sends. |
| 2 | does it include the origin? | **No origin coordinate is emitted.** Only stops that carry a `refId`/`superchargerId` survive the map+filter — and `ORIGIN_SUPERCHARGER` is a *supercharger* origin (a charging stop), not the car's raw position. Your exclusion of `stops[0]` was right. |
| 3 | decimal precision / delimiters | **N/A — no numbers are emitted.** Separator is a plain `,` with **no** leading/trailing delimiter (`Array.join`). |
| 4 | count limit / max length | **No client-side cap found** — no slice/truncate on the array, no length check on the joined string. Any limit is car-side. |

### Q1c — the one thing you *can* build: superchargers
`superchargerId:<id>` is a **Tesla Supercharger site id**, not a Google artefact. If airgapp already knows site ids (you route to Superchargers today — RESPONSE-17's screenshot shows "Supercharger Kraków – Opolska"), then **a supercharger-only multi-stop itinerary is constructible offline**:
```
superchargerId:12345,superchargerId:67890
```
That is a real, air-gap-compatible subset. It will not work for arbitrary addresses.

---

## Q2 — what gates coordinate acceptance

Two **different** feature bits exist, and you were looking at the second:

- **`MOBILE_APP_FEATURE_WAYPOINTS_SUPPORTED`** — the gate the app actually uses. `#29943 vehicleSupportsSendWaypointsToVehicle` @`0023` reads it from **`FeatureBitmask`** @`001d`.
- **`MOBILE_APP_FEATURE_WAYPOINTS_REQUEST_ACCEPTS_COORDINATES`** — present in the **Android** bundle (6 references) but **absent from the iOS 4.58.0 string table entirely**. So even where the bit exists, **this build has no code that emits coordinates** — the bit gates a path the shipped app doesn't take.

**Is it readable over BLE?** The value comes from a **`FeatureBitmask`** on the cached cloud `vehicle_data` record — the same cloud-fed capability family as the UWB gate in RESPONSE-15 (`car_type` + `api_version` + feature bits). **Not BLE-readable** ⇒ **cloud-only** ⇒ per your standing constraint, you cannot check the capability offline and should not gate UI on it. Car-side there is a `FEATURE_navigationWaypoints` flag in QtCarServer, but that is the car's own internal flag, not something the phone reads over BLE.

---

## Q3 — does the car ACK an unparseable string? **Yes — your `outcome:"ok"` is worthless here**

Confirmed structurally on the car side. `CarAPIHandlerImpl::navigation_waypoints_request(const QString&, …)` @`0xa08e70` in QtCarServer is a **thin proxy**: it constructs a `ServiceCallContext`, logs via `QTextStream`/`Logger::log`, and forwards through `CarAPIHandlerImpl::cidProxy()` @`0x9ba710` to a **vtable call** `callq *0x140(%rax)` — i.e. it hands the string to the Center-Display/nav service and returns. The D-Bus interface confirms the shape: `<method name="navigation_waypoints_request"><arg direction="in" type="s" name="waypoints"/>`.

**The ACK is generated by the transport/handler layer, before and independently of any waypoint parsing.** The parse happens downstream (`TMWaypointRouteRequest` → `TMServer::routeToWaypoints`), and its failures surface only as car-side log lines:
> `TMWaypointRouteRequest: Invalid waypoint in recalc.currentStops`
> `TMWaypointRouteRequest: Badly formed recalc.currentStops variant`

**So: `result:true` means "the string was delivered", not "a route was created."** That fully explains your five `outcome:"ok"` with no route.

**A better success signal:** don't trust the ACK — **read back the route state.** The car exposes `active_route_*` on `DriveState` (RESPONSE-15 Tier 1 flagged `active_route_*` as already arriving on your wire, unparsed), plus `NAV_multistopRouteId` and `GUI_navTripPlanId` car-side. Poll `DriveState` after sending and assert the destination/route actually changed; treat "ACK but no route change within N seconds" as failure.

---

## Q4 — is there another message? **The APPEND path is real car-side and is your best shot**

`NavigationGpsRequest` carries a trip-order enum all the way into the car: the QtCarServer symbol is

```
CarAPI::navigation_gps_request(const double&, const double&,
                               const CarAPI::RemoteNavTripOrder&,   ← the order enum
                               bool&, QString&, ServiceCallContext*)
```

plus `CarAPI::navigation_gps_destination_request(...RemoteNavTripOrder...)` and an async variant. So **the car accepts an ordered GPS destination and understands REPLACE / PREPEND / APPEND** — and multi-stop state exists car-side (`NAV_multistopRouteId`, `TMMultiStopStateGroupDataValue`, `FEATURE_enableCombineWaypoints`).

**Recommended (and cheap, because you already have this path working on-car):**
```
stop 1 → NavigationGpsRequest{lat, lon, order = REPLACE}
stop 2 → NavigationGpsRequest{lat, lon, order = APPEND}
stop n → NavigationGpsRequest{lat, lon, order = APPEND}
```
with a short gap between sends and a `DriveState` read-back after each.

**Honest status:** I proved the car-side API takes the order enum on every GPS-request variant; I did **not** prove the official app chains APPEND for multi-stop (its own multi-stop path is the refId waypoints string). So treat APPEND-chaining as **strongly plausible and cheap to test**, not as proven. It is the one option that is entirely within your existing, working, air-gapped capability — test it before writing off multi-stop.

---

## What to change in airgapp

1. **Stop sending coordinate waypoints.** They are silently discarded; the ACK is meaningless. (Your current fallback — send only the final destination and say so in the UI — is the right behaviour until something is proven.)
2. **If you keep the waypoints message at all**, the separator is **`,`** and tokens must be `refId:<id>` / `superchargerId:<id>`.
3. **Supercharger-only multi-stop is buildable offline** via `superchargerId:` — worth it if you have site ids.
4. **Try APPEND-chaining `NavigationGpsRequest`** (§Q4). This is the highest-value experiment and uses a path you've already verified.
5. **Replace `outcome:"ok"` with a state read-back** (`DriveState.active_route_*`) as your success signal for anything nav-related.
6. **Do not gate on the coordinates feature bit** — it's cloud-only and unreadable offline.

## Residual unknowns
- Whether the car's downstream parser would accept a bare `lat,lon` token from a client if the `ACCEPTS_COORDINATES` feature bit were set (the bit exists on Android; the iOS build never emits coordinates, and the parser lives downstream of QtCarServer's proxy — not in this image).
- Whether APPEND-chaining actually produces a multi-stop route on your firmware (the on-car test above).
- Any car-side cap on waypoint count / string length.
- Whether `superchargerId:` ids match the site ids you already hold.

## Provenance
iOS `main.jsbundle` Hermes v96: `#114892` (send flow; token map/filter/join @`04b2`–`054a`, token literals @`0118`/`0138`, skip-log @`00e1`), `#31892 navigationWaypointsRequest`, `#29943 vehicleSupportsSendWaypointsToVehicle`, `#30228 generateNavigationRequestPayload` (single-destination `lat + ',' + long`). Android jadx: both `MOBILE_APP_FEATURE_WAYPOINTS_*` constants. QtCarServer (`…/rootfs/usr/tesla/UI/bin/QtCarServer`): `CarAPIHandlerImpl::navigation_waypoints_request` @`0xa08e70` (proxy + `cidProxy` vtable dispatch), the `navigation_waypoints_request(s waypoints)` D-Bus method, `CarAPI::navigation_gps_request(...RemoteNavTripOrder...)`, `TMServer::routeToWaypoints`, `TMWaypointRouteRequest::setFromVariant`, and the two parser error strings.
