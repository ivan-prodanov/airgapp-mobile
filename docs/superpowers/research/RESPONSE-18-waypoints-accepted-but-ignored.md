# RE RESPONSE #18 — multi-stop waypoints: why the car ACKs and ignores it

**Answers:** `REQUEST-18-waypoints-accepted-but-ignored.md` (Q1–Q4).
**Method:** direct Hermes bytecode analysis of the official iOS bundle (4.58.0) + Android jadx + **QtCarServer on the car image**. Done by me (subagent workflows were still failing on `529 Overloaded`). Every claim cites a function index + bytecode offset you can re-check.

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
