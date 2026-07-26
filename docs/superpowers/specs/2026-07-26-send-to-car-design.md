# Send to Car — replacing the trip planner

**Date:** 2026-07-26
**Status:** design agreed, ready to plan
**Supersedes:** the client-side trip planner (shipped 2026-07-10, commit `dec18f6`)

## Why this exists

The Location screen and the Share Extension were built around a client-side trip
planner: a multi-stop itinerary you assembled on the phone and sent to the car.
That premise is dead. `NavigationWaypointsRequest` is parsed and discarded by the
car (REQUEST-18), and the fallback — APPEND-chaining single destinations — depends
on the `order` field surviving, which it does not on the messages that can carry a
coordinate.

Everything below follows from what we measured on the car this session, not from
the firmware report. RESPONSE-19 was disassembled from an Intel MCU2 rootfs while
the car is HW4 Ryzen, and it was wrong about the claim that mattered most.

## What we established on-car

| Finding | How |
|---|---|
| f53 / f106 discard `order` entirely | on-car; confirms RESPONSE-19 Blocker 1 |
| f53 / f106 with an ACTIVE route → drop a pin, do not reroute | on-car |
| f53 / f106 with NO route → navigate normally | ships today, verified repeatedly |
| f21 is the only message that honours PREPEND/APPEND | on-car; **contradicts** RESPONSE-19 Blocker 2, which said f21 only drops pins |
| f21 handles coordinates unreliably | points C and D rejected, E accepted — same format, same message |
| Sends work while the car is ASLEEP | on-car; no wake needed |
| Route state is unreadable while the car is LOCKED | on-car; confirms RESPONSE-19 Blocker 3's direction |
| `Response.actionStatus` carries the car's real verdict, and nothing in this codebase reads it | grep + proto |

Two of those decide the design.

**f21 is dropped.** It is the only route to prepend/append, and it could not be
trusted with a coordinate: three points in the same area, same format, and one of
them worked. We are not shipping a button whose success depends on which side of
an invisible line the destination falls.

**Route state is undetectable when locked** — i.e. in every situation where you
would use this. So no route-aware UI is possible: no conditional buttons, no
"currently driving to X" line, no freshness gating. The interface must be the same
whatever the car is doing.

Together those collapse the feature to a single action.

## What we are building

One button, `Send to Car`, wherever a place is shown: the dropped-pin card, a
tapped Apple POI, a search result, and the charger detail. It sends
`NavigationGpsDestinationRequest` (f106) with the place's coordinate, its title as
the label, and `order = REPLACE`.

`fleet.sendNavigation(lat, lon, label)` already builds exactly this. There is no
new BLE work — this feature is overwhelmingly deletion.

### Why "Send to Car" and not "Navigate"

With a route already running, f106 REPLACE drops a tappable pin on the centre
screen instead of rerouting. So the same button produces different outcomes
depending on the car's state, and we cannot detect which state that is.

`Send to Car` is true in both cases; `Navigate` would be a lie in one of them. The
pin is visible on the car's screen, so the degraded case is not silent — but it
does mean sharing a place mid-drive will not reroute you. Accepted, eyes open.

### Share → Airgapp

No card, no map, no trip sheet, no action choice. The extension shows a spinner
with "Sharing to car" — Google URL resolution takes seconds and the wait needs to
be visible — resolves the location, writes `{lat, lon, title}` to the App Group,
opens the app, and dismisses. The app sends on intake, silently: a haptic and
nothing else. As built, success is not toasted anywhere: the send is
fire-and-forget, so a toast at intake would be asserting an outcome we do not have
yet. Only failure speaks — through the shared failure toast, carrying the car's
own rejection reason.

## Where the title comes from

The label we send is what shows on the car's screen, so it is worth more care than
"whatever the object already has". Every source needs an audited path, and two of
them are currently broken for this purpose.

| Source | Today | Work needed |
|---|---|---|
| Apple Maps share | `MKMapItem.name` | none — good |
| Google / Waze share, coords in the URL | `RawExtract.name`, often nil | fall back to the reverse-geocoded address |
| Google share, coords found in the page BODY | **hardcoded `name: nil`** (`SharedLocationResolver.swift:37`) | reverse-geocode for a name; today this path has no title at all |
| Address-only share | `ex?.name ?? item.name` | none — good |
| Tapped Apple POI | `pin.name` from the map feature | none — good |
| Search result | `place.title` | none — good |
| Charger detail | `c.name` | none — good |
| **Long-pressed map pin** | literal `'Dropped Pin'`, improved to `addr.name ?? addr.street` only if reverse-geocoding succeeds (`location.tsx:347`) | must never reach the car — see below |

**One shared fallback chain**, applied at the send boundary rather than at each
call site, so there is a single place this can go wrong:

1. a real name from the source (POI, place, charger, share)
2. else the reverse-geocoded street address
3. else the formatted coordinate

Placeholders — `'Dropped Pin'` and anything else we synthesised for display — are
explicitly **not** titles and must be filtered before the send. A destination
called "Dropped Pin" in the car's route list is worse than one called
"42.6977, 23.3219", which at least says where it is.

This lives in one pure function so it can be tested without a car.

## What gets deleted

| | |
|---|---|
| Whole files | `src/state/trip.ts` + test, `useTrip.ts`, `useTripRoute.ts`, `tripSnapshot.ts` + test, `src/components/TripSheet.tsx`, `TripRowMenu.tsx` |
| `src/app/location.tsx` | the `screen: 'search' \| 'trip'` mode, `pendingInsert`, `tripEditing`, `rowMenu`, `onSendTripToCar`, `onTripRowAction`, `onAddChargerToTrip`, `startNewTrip`, the snapshot-restore effect, the App-Group mirror effect, the trip polyline and its `fitToCoordinates`, both "Add to Trip" bars. ~1257 lines → ~750 |
| `src/state/useFleetState.ts` | `sendWaypoints` and `NAV_CHAIN_GAP_MS` |
| Swift | all of `SharePreviewView.swift` (599 lines — card mode and trip mode both); `setSavedTrip` / `setSavedCar` in `SharedIntakeModule.swift` and its TS shim |
| Contract | `SharedAction`, `ReorderedStop` in `src/state/sharedLocationStore.ts`; the `action` field in the intent |

Kept: the map, the charger DB and Charging tab, `useNavigateSearch` and its
recents, `LocationSheet`, `PlacePreviewSheet`, and the nav bench in `carlink.tsx`
(isolated debug tooling, useful for the next RE round).

### Dependencies

Audited by grepping every consumer, not assumed:

- **`react-native-reorderable-list` — remove from `package.json`.** Its only
  consumer is `TripSheet` (drag-to-reorder stops). It ships native code, so
  removing it needs `pod install` + a full rebuild — which this change already
  requires for the share extension, so it costs nothing extra.
- **`src/services/appleDirections.ts` — delete.** `appleRoute` has exactly one
  caller, `useTripRoute`, which is going. The `expo-apple-search` native module
  stays (search and completion are still used by the Navigate tab); only its
  MKDirections method becomes dead. Stripping that from Swift is optional and can
  wait — it is inert, not harmful.
- **`react-native-gesture-handler` and `react-native-reanimated` stay.** Both look
  trip-only from `TripSheet` but have other consumers: `_layout.tsx` for the
  former, `animated-icon` and `collapsible` for the latter.

Nothing on the Apple mapping side is removable, and one of them is a trap:

- **`react-native-maps` stays**, with its pnpm patch (tappable POIs). It is
  imported in exactly ONE file — `location.tsx` — which is also where all the trip
  code lived, so a consumer grep makes it look trip-only. It is not: the map, the
  car pin, the charger pins and the POI tap all depend on it.
- **`modules/expo-apple-search` stays.** Search and completion still power the
  Navigate tab; only its MKDirections method dies with `appleDirections.ts`.
- **`expo-location` stays** and becomes MORE load-bearing — it is the
  reverse-geocoder behind step 2 of the title fallback.
- **MapKit** is a system framework; nothing to remove. Gutting the share popup
  drops the extension's `MKMapView`, but MapKit stays linked for `MKMapItem` and
  `CLGeocoder` in `SharedLocationResolver`.

## Also in scope

**Read `actionStatus`.** `Response.actionStatus` carries
`{result: OK|ERROR, result_reason.plain_text}` and nothing in the codebase has
ever read it — which is why point D failing and point E succeeding both logged
"ACK ok". The bench now decodes it; the shipping command path should too, so a
rejected send surfaces the car's own reason instead of a generic failure. Without
this, `Send to Car` is fire-and-forget and a silent drop is indistinguishable from
success.

**Clear `activeRoute`.** `telemetry.ts` sets `patch.activeRoute` only when a route
is present, so a route that ended stays in memory for the rest of the session. No
UI reads it today and none will after this change, but the bug is real and the fix
is three lines: emit `null` when a DriveState read reports no route.

## Explicitly not doing

- **Prepend / append.** No message we can trust carries the order field with a
  coordinate. If a future firmware or a further RE round changes that, the button
  can grow — the design deliberately leaves room for a second action.
- **Waking before sending.** Verified on-car: sends land on a sleeping car. No
  wake, no pre-flight check.
- **Route detection.** Impossible while locked, and nothing in the UI needs it.
- **Multi-stop.** Dead at the protocol level. Closed.

## Testing

Node tests for the intake reducer (intent → send), the title fallback chain
(name → address → coordinate, including the placeholder filter that stops
"Dropped Pin" reaching the car), and the `activeRoute: null` clearing. The f106
encoding is already covered by `commands.test.ts`.

On-car: share from Apple Maps, Google Maps and Waze; confirm the car receives the
place with its name attached. Repeat once with a route already running to confirm
the pin behaviour is what we documented rather than a silent failure.

## Deploy cost

The RN work is `deploy-js.sh` (~30s). The Swift changes — gutting the share
extension and removing two native module methods — need a full Release
`xcodebuild` (~25 min).
