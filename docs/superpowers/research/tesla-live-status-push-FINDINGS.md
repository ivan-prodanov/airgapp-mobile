# FINDINGS — How the official Tesla app updates closures/lock INSTANTLY over BLE

**Source of truth:** decompiled iOS Tesla app `main.decompiled.js` (Hermes-decompiled, v4.56 —
same bundle used by the optimistic-buttons / status-ux rounds). All `@N` are line numbers in
that file. Claims read directly off an opcode/literal are `[iOS-verified]`; interpretation across
the native boundary (Swift CoreBluetooth, not in this JS) is `[INFERRED]`.

Cross-checked against our own `docs/superpowers/plans/tesla-ble-transport-spec.md` and
`src/ble/*`.

---

## TL;DR — the verdict

**It is a PUSH, and the push is AUTOMATIC.** `[iOS-verified]`

The instant closure/lock/presence update is **not** a JS fast-poll. On iOS the native BLE module
(`NativeModules.TMClient`) holds ONE long-lived GATT connection, subscribes to the car's notify
characteristic, decodes the VCSEC `FromVCSECMessage` / `VehicleStatus`, and **emits an unsolicited
`"ble:vehicle_status"` event to JS every time the car reports a state change.** The React-Native
layer subscribes to that event exactly once at app startup and applies each push straight into
redux — no request precedes it. There is **no "start status stream" command, no subscribe opcode,
and no keep-alive** sent from JS to turn the stream on. Subscribing to the GATT notify
characteristic (which our transport already does) *is* the enable step; the car pushes on change.

There **is** a second, separate mechanism — a screen-dependent JS poll of the *infotainment*
`GetVehicleData` (`proto_vehicle_data`) at **1250–5000 ms** — but that is the richer charge/climate
data, **not** what drives the instant closure UI. Closures/lock/presence ride the push.

This exactly matches the brief's hypothesis and our spec's own note about "unsolicited VCSEC
broadcast" frames — the frames we currently receive and **throw away** in `exchange()`.

---

## Q1 — Push vs fast-poll: which drives instant closures? `[iOS-verified]`

**Two independent data paths feed the same redux state, and they are NOT the same mechanism:**

| Path | Domain | Mechanism | Cadence | Drives instant closures? |
|---|---|---|---|---|
| `ble:vehicle_status` push | **VCSEC** (closures, lock, presence, sleep, whitelist) | **Unsolicited native event** | on-change (car-driven) | **YES** |
| `startBleVehicleUpdates` poll | **Infotainment** (`proto_vehicle_data`: charge/climate/drive/tpms/media) | JS `GetVehicleData` poll over BLE | 1250–5000 ms, screen-dependent | No (slow, richer data) |

**The push path** `[iOS-verified]`:
- Native event name literal: `r9['VEHICLE_STATUS'] = 'ble:vehicle_status'` **@3960284** (event-name
  table also defines `SYSTEM_STATUS='ble:status'`, `VEHICLE_EVENT='ble:vehicle_event'`,
  `VEHICLE_ENCRYPTED_MESSAGE='ble:vehicle_encrypted_message'`, etc. @3960281–3960294).
- The listener `vehicleStatusListener` (fn #97294) logs `'[TMBLE vehicle status]'` and dispatches
  `phoneKeyStatusUpdate(vin, …, statusObj)` **@3960382–3960414**.
- It is wired to the emitter as a persistent subscription (see Q2).

**The poll path** `[iOS-verified]`: the saga `startBleVehicleUpdates` — log literal
`'starting BLE vehicle data polling task'` **@6831927** — is a loop that builds `GetVehicleData`
requests **@6832031** and fetches **per active screen**: `'on security screen, fetching closures &
parental controls state'` **@6832008**, `'on controls screen, fetching drive state'` @6831997,
`'on climate screen, fetching climate only'` @6831987, etc. The screen-keyed delays are inline
constants in the same frame: **`1250`** @6832010 (security/closures), `1650` @6832014, `2500`
@6831991, **`5000`** @6831986. This is the R1 "5000 ms online / 1200 ms waking" figure the
optimistic-buttons round quoted — and, being ≥1.25 s and infotainment-only, it **cannot** be the
source of the *instant* closure snap. The gate `_startVehicleDataPollingOverBLE` only forks this
loop once `'is paired and connected!'` @6833581 (else `'not starting BLE vehicle data polling
because we're not paired and/or not connected.'` @6833577).

**Answer:** instant closures = the **VCSEC push** (`ble:vehicle_status`). The poll is a parallel,
slower infotainment refresh.

---

## Q2 — The subscribe / enable step (CRITICAL) `[iOS-verified]`

**The push is automatic once connected + subscribed to the GATT notify characteristic. JS sends NO
"start status stream" command and NO keep-alive.** The enable step, on the JS side, is a one-time
`NativeEventEmitter.addListener` at app startup — the JsBridge saga (`@3960271` builds a
`Logger('JsBridge')`).

Verbatim control-flow of the subscription block (register IR faithfully translated), **@3963104–3963151**:

```js
// r8 = new NativeEventEmitter(NativeModules.TMClient)          @3963104–3963111
const tmEmitter = new NativeEventEmitter(NativeModules.TMClient);

// SYSTEM_STATUS ('ble:status') -> systemStatusListener (slot15)   @3963134–3963139
subs.push(tmEmitter.addListener(EventNames.SYSTEM_STATUS,  systemStatusListener));
// SHOW_PERMISSION_PRELUDE_DIALOG -> slot17                        @3963141–3963145
subs.push(tmEmitter.addListener(EventNames.SHOW_PERMISSION_PRELUDE_DIALOG, ...));
// VEHICLE_STATUS ('ble:vehicle_status') -> vehicleStatusListener (slot16)  @3963147–3963151
subs.push(tmEmitter.addListener(EventNames.VEHICLE_STATUS, vehicleStatusListener));   // ← THE PUSH
// VEHICLE_EVENT, VEHICLE_CARD_READER_EVENT, VEHICLE_ENCRYPTED_MESSAGE, LOG, ...  @3963158–3963205
```

- The emitter is bound to **`NativeModules.TMClient`** @3963106. (A second emitter is bound to
  `NativeModules.HermesModule` @3963230 for the CLOUD path — see Q6.)
- On **iOS** the full `proto_vehicle_data` also arrives over **TMClient** (BLE): the platform
  branch @3963258 routes `PROTO_VEHICLE_DATA` (`_closure1_slot37`) to the **TMClient** emitter for
  iOS (@3963259–3963267, `r8`), and to the **HermesModule** emitter for non-iOS (@3963269–3963277,
  `r10`). So on iOS the phone gets infotainment over Bluetooth, not the cloud.

**What DOES turn the car's radio/stream on** is a native connection request, not a status-stream
command. The JS→native TMBLE surface (wrapper @1299561+) exposes, among ~41 methods:
`setSelectedVIN` @1299574, `scanForPeripherals` @1299639, `requestMTU` @1299707,
**`startMonitoringForVehicle`** (iOS-only) @1299740, `setStayConnectedWhenUnauthorized` @1299718,
`getStatus` @1299848, `startService`/`restartService` (Android) @1299952/@1299979. The connect flow
calls `setSelectedVIN(vin)` @9534059 then `setStayConnectedWhenUnauthorized(vin, true, 'start phone
key pairing')` @9534079. **None of these is a "subscribe to VehicleStatus" call** — there is no such
opcode. `getStatus` returns the *phone's* BLE stack status (`{bluetooth_enabled,
bluetooth_authorization, public_key, …}` @1298681), not a car poll.

**At the VCSEC protocol level `[INFERRED]`** (native Swift, not in this JS): the car (VCSEC
controller) autonomously emits a `FromVCSECMessage{ vehicleStatus }` on the notify characteristic
when a closure/lock/presence changes; the native layer forwards it as `ble:vehicle_status`. This is
the standard VCSEC behavior our own spec already anticipates — `tesla-ble-transport-spec.md §6.d`
tells the reader to skip "unsolicited VCSEC broadcast" frames — and is consistent with there being
**no** `INFORMATION_REQUEST_TYPE_*` value for "subscribe" (the enum @766557 has only
`GET_STATUS=0, GET_TOKEN=1, … GET_CAPABILITIES=16` — all one-shot reads). The enable is therefore
"connect + GATT-subscribe," which we already do.

**No keep-alive/heartbeat for the push** was found in the JS. (The infotainment poll's timer is its
own loop; it is not required to keep the VCSEC push flowing.)

---

## Q3 — What exactly is pushed `[iOS-verified]`

The pushed object is the decoded VCSEC status, delivered to `phoneKeyStatusUpdate(vehicleId, hermesTs, bleVehicleStatus)`
(action creator @1195731, stores `payload.bleVehicleStatus` @1195747). The proto is
`proto.VCSEC.VehicleStatus`, a oneof member of `FromVCSECMessage`.

**`FromVCSECMessage` oneof members** (serializer `toObject` @763197–763300+): `vehiclestatus`,
`sessioninfo`, `authenticationrequest`, `commandstatus`, `personalizationinformation`,
`whitelistinfo`, `whitelistentryinfo`, `capabilities`, `keystatusinfo`. A push carrying only
`vehiclestatus` is therefore structurally an unsolicited status frame.

**`bleVehicleStatus` fields consumed by the app** (reducer @1295280–1295450, saga @9536926+):
- `vin` @1295376 / @9536978
- **`closure_state`** — the closures/lock the instant UI reads. The type guard
  `isBLEVehicleClosureState` @1298701 requires a **`locked: boolean`** @1298716. Per-closure states
  use `PhoneKeyClosureState_E` @1298684–1298699: `CLOSED(0)`, `OPEN_AJAR(1)`, `UNLATCHED(2)`,
  `OPENING(3)`, `CLOSING(4)`. The reconcile (optimistic-buttons §1e, @1194034) reads
  `closure_state.{locked, cp, ft, rt}` — lock, charge-port, front-trunk (frunk), rear-trunk.
- `proto_vehicle_data` @1295379 (present when the infotainment poll has run; carries
  `getVehicleConfig`/`getKeyVersion` @1295386–1295393) — merged on the SAME action.
- `whitelist_keys` / `whitelist_has_key` / `whitelist_timestamp` @9536947–9536962 (phone-key
  membership → OEM-wallet-card upkeep).
- `oemWalletState`/`oem_wallet_state` @1295351.

**Domain coverage:** the push is **VCSEC-only** (closures, lock, `userPresence`, sleep status,
whitelist). The proto enums confirm the VCSEC vocabulary: `VehicleLockState_E` @717862,
`VehicleSleepStatus_E` @717867, `UserPresence_E` @717852, `ClosureStatuses` @717964,
`DetailedClosureStatus` @718006. **Charge/climate are NOT in the push** — they arrive via the
separate `proto_vehicle_data` infotainment poll (Q1).

---

## Q4 — How the app processes a push (the handler, contrasted with request/reply) `[iOS-verified]`

**Push path (no matching outbound request):**

1. Native `TMClient` emits `"ble:vehicle_status"` with the decoded status object.
2. **`vehicleStatusListener`** (fn #97294, @3960382) fires:
   ```js
   function vehicleStatusListener(status) {          // @3960382
     Logger.i('[TMBLE vehicle status]', status);     // @3960388
     const vin = status.vin;                          // @3960390
     store.dispatch(                                  // @3960392
       Actions.phoneKeyStatusUpdate(vin, hermesTs(status.vin) ?? '', status)  // @3960401–3960412
     );
   }
   ```
3. `phoneKeyStatusUpdate` @1195731 → dispatches **`VEHICLE_PHONE_KEY_STATUS`** @1195740 with
   `{ vehicleId, …, bleVehicleStatus }`.
4. The vehicle reducer (@1295280+) merges `bleVehicleStatus` into the per-VIN state: for the entry
   whose `vin === payload.bleVehicleStatus.vin` (@1295375) it folds in `closure_state`,
   `proto_vehicle_data`, `oem_wallet_state`, key-version, etc.
5. `onGoingCommandReducer` also reacts to `VEHICLE_PHONE_KEY_STATUS` (whitelist @1184657, branch
   @1194034): when `bleVehicleStatus.is_connected` and `closure_state != null`, it **reconciles
   pending commands** against `closure_state.{locked, cp, ft, rt}` (optimistic-buttons §1e). This is
   the offline/local reconcile that clears the lock optimistic overlay from real BLE data.
6. Display selectors (`isVehicleLocked`, `isChargePortDoorOpen`, closure resolvers) now return the
   new state → the icon flips. **This is the whole instant path — driven entirely by an inbound
   event with no outbound request.**

Two sibling sagas also key off `VEHICLE_PHONE_KEY_STATUS`: `interceptPhoneKeyStatus` (fn #202460,
`takeLatest`, @9536871 — iOS-guarded @9536899) does OEM-wallet-card cleanup when the phone key was
removed; a security-screen saga @6833613 gates the infotainment poll on it.

**Request/reply path (contrast):** a *command* (e.g. lock) goes JS →
`sendNativeCommandRequest`/`buildCommandRequest` @6833746 → native → the car replies with a
`CommandStatus` (proto @717257; `FromVCSECMessage.commandstatus` @763239) correlated to that
request, surfaced as `VEHICLE_COMMAND_SUCCESS`/`_FAILED`. That is a solicited, correlated reply —
the opposite of the unsolicited `ble:vehicle_status` push.

---

## Q5 — Connection lifetime `[iOS-verified]` / `[INFERRED]`

- **ONE long-lived connection.** `[iOS-verified]` The native `TMClient` owns a persistent GATT link,
  kept alive across commands — the whole point of `setStayConnectedWhenUnauthorized(vin, true, …)`
  @9534079 is to hold the link open even before/without an authorized session. This is the opposite
  of our per-poll `openSession → exchange → closeSession`.
- **The JS event subscription is process-lifetime**, established once at startup (Q2) and never torn
  down per command. So as long as the native link is up, pushes flow into the running JS.
- **iOS foreground/background** `[INFERRED, native]`: CoreBluetooth central lifetime and background
  BLE modes live in native Swift (not this bundle). The presence of iOS beacon monitoring
  (`startMonitoringForVehicle` @1299740, `stopMonitoringForAllRegions` @1299825) indicates the app
  uses region monitoring to re-establish the link on approach — i.e. reconnect is native and
  automatic; JS does not re-subscribe on reconnect (its `addListener` persists).
- **Re-subscribe on reconnect** `[INFERRED]`: not needed on the JS side (the emitter listener
  outlives connection churn). At the GATT level the native central re-enables the notify
  characteristic on each reconnect — same as our transport does in `openSession`.

---

## Q6 — Over the network path (their analogue of our Pi) `[iOS-verified]`

The cloud path is a **separate emitter**, `NativeModules.HermesModule` @3963230 (Tesla's persistent
cloud stream). Its events @3963236–3963318 include `CARAPI_STREAM_MESSAGE` @3963240,
**`VEHICLE_ONLINE_STATE`** @3963252, `PROTO_VEHICLE_DATA` (non-iOS) @3963274, `HERMES_STATUS`
@3963283, `CARAPI_VEHICLE_DATA_SUBSCRIPTION_RESPONSE` @3963295, `CARAPI_VEHICLE_PING` @3963307.

So over the network the app **also streams** (Hermes is a push stream, not REST polling), and there
is an explicit **`…VEHICLE_DATA_SUBSCRIPTION…`** exchange @3963295 — meaning on the cloud path the
app *does* send a subscribe request to start the stream (unlike BLE, where the subscription is the
GATT notify). Key asymmetry for us:

- **iOS gets closures instant over BLE** via `ble:vehicle_status` (TMClient), and even
  `proto_vehicle_data` over BLE (TMClient, iOS branch @3963259).
- **The cloud equivalent is a streamed subscription** (Hermes), not a poll. "Instant" is achieved by
  *streaming on both transports* — never by rapid REST polling.

**Implication:** to get instant-over-Pi, the Pi forwarder must **stream** the car's unsolicited
notify frames to the phone (a push channel), not answer discrete poll requests.

---

## What this means for our stack

Our `directBleTransport.ts` already does the hard part the native TMClient does — it holds the GATT
link and **subscribes to the RX notify characteristic** (`monitorCharacteristicForService(SERVICE_UUID,
RX_UUID, …)` @195). The car is *already pushing* `VehicleStatus` frames to us on closure/lock change;
we currently **discard them**. `exchange()` drains the inbox before writing (@225) and
`drainInbox`/`awaitMatchingFrame` keep only the frame whose correlators answer the request just sent,
throwing away everything else as "stale broadcasts" (@325–331, @213). Those thrown-away frames are
the push.

**Concrete changes:**

1. **`directBleTransport.ts` — stop discarding unsolicited VCSEC frames; route them to a listener.**
   - Add an optional `onUnsolicited(frame: Uint8Array)` (or an `EventEmitter`) to the transport.
   - In the RX monitor callback (@195–203), for each reassembled frame, additionally test whether it
     is an **unsolicited** frame: decode as `RoutableMessage`; it's a push if it carries a VCSEC
     `fromDestination` **and** does not answer any in-flight `exchange()` (no in-flight request, or
     `frameAnswersRequest` is false against the current `want`). Our `bleCorrelation.ts` already
     gives us the primitives — a push has `fromDestination.domain = VCSEC` and an **empty
     `request_uuid`** and no `to_destination.routing_address` matching our outgoing
     `from_destination.routing_address`.
   - When idle (no pending `exchange`), forward such frames to `onUnsolicited`. Keep the existing
     drain semantics for the in-flight case so a real reply is never mis-routed. (Concurrency note in
     the file still holds: one exchange at a time — the only ambiguity is "is this the reply or a
     push," resolved by correlators, which we already compute.)
   - Do **not** send any "subscribe" command — there is none. Subscribing to RX_UUID (done) is the
     enable step.

2. **`session.ts`/`gateway.ts` — decrypt/parse the pushed frame like a GET_STATUS reply.** A VCSEC
   push is the same `VehicleStatus` payload our poll already handles; feed it through the existing
   VCSEC decode so it yields the same shape `vcsecStatusToPatch` consumes.

3. **`useCarLink.ts` — add an event-driven apply path alongside the 20 s poll.** We already have the
   two ingredients:
   - `vcsecStatusToPatch` (telemetry.ts @323) — the exact parser the poll uses.
   - `applyTelemetry` (the PLAIN, non-reconciling apply @155/@309/@724) with the `intentGrace`
     filter (`filterPatchUnderIntent`) so a push can't stomp a field the user just changed.
   Wire the transport's `onUnsolicited` → decode → `vcsecStatusToPatch` → `filterPatchUnderIntent`
   → `applyTelemetryRef.current(patch)`. The existing 20 s `POLL_MS` VCSEC read becomes a **backstop**
   (covers "we missed a push" / cold reconnect); the push makes closures/lock/presence **instant**,
   matching the official app. Charge/range stays on the `INFOTAINMENT_MS` poll (Tesla polls it too).
   This only works while a BLE link is actually held open — today we open→exchange→close per poll;
   to receive pushes we must **keep the session open** between polls when BLE is the chosen transport
   (mirror TMClient's stay-connected). That is the one structural change: a persistent BLE session
   for the push to arrive on.

4. **Pi forwarder (for instant-over-Pi).** The Pi currently is a request/reply opaque-byte forwarder
   (one BLE session per Pi, 5-min reaper — see the BLE-backend-integration memo). To get
   instant-over-Pi it must **stream** the car's unsolicited notify frames to the phone (SSE /
   WebSocket / long-poll on `/exchange`), i.e. become a push channel — exactly how Tesla's own cloud
   path uses the **Hermes streamed subscription** rather than REST polling (Q6). Until then, instant
   closures are **BLE-direct only** in our app, which is *also true of the official app* (its
   instant-closure path is BLE; the cloud path is a different, streamed subscription).

---

## Evidence index (iOS `main.decompiled.js`)

- Event-name table: `VEHICLE_STATUS='ble:vehicle_status'` @3960284; `SYSTEM_STATUS='ble:status'`
  @3960282; siblings @3960285–3960294.
- Listeners: `systemStatusListener` @3960360; **`vehicleStatusListener` fn #97294** @3960382 (dispatch
  @3960401); `showBlePermissionPreludeEventListener` @3960418.
- **Subscription setup:** `new NativeEventEmitter(NativeModules.TMClient)` @3963104–3963111;
  `addListener(VEHICLE_STATUS, vehicleStatusListener)` @3963147–3963151; `SYSTEM_STATUS` @3963134;
  iOS `PROTO_VEHICLE_DATA` over TMClient @3963259–3963267; `HermesModule` emitter @3963230; cloud
  events incl. `VEHICLE_ONLINE_STATE` @3963252 and `CARAPI_VEHICLE_DATA_SUBSCRIPTION_RESPONSE`
  @3963295.
- Action/reducer: `phoneKeyStatusUpdate` @1195731 (dispatch `VEHICLE_PHONE_KEY_STATUS` @1195740,
  stores `bleVehicleStatus` @1195747); reducer merge @1295280–1295450 (`bleVehicleStatus` @1295372,
  vin match @1295375, `proto_vehicle_data` @1295379); command-reducer BLE reconcile branch @1194034
  (`bleVehicleStatus` @1194036, `closure_state` @1194038).
- TMBLE native module + surface: `NativeModules.TMBLE` @1298679; `PhoneKeyClosureState_E`
  @1298684–1298699; `isBLEVehicleClosureState` requires `locked:boolean` @1298716; wrapper methods
  `setSelectedVIN` @1299574, `scanForPeripherals` @1299639, `requestMTU` @1299707,
  `startMonitoringForVehicle` @1299740, `setStayConnectedWhenUnauthorized` @1299718, `getStatus`
  @1299848 (returns phone BLE status `IntialBLEStatus` @1298681).
- Infotainment poll: `startBleVehicleUpdates` @6831914 (`'starting BLE vehicle data polling task'`
  @6831927; `GetVehicleData` @6832031; per-screen literals @6831984–6832008; delays `1250` @6832010,
  `1650` @6832014, `2500` @6831991, `5000` @6831986); `_startVehicleDataPollingOverBLE` gate
  @6833308 (`'is paired and connected!'` @6833581).
- Command reply (contrast): `sendNativeCommandRequest`/`buildCommandRequest` @6833746; `CommandStatus`
  proto @717257; `FromVCSECMessage.commandstatus` @763239.
- VCSEC proto registry: `FromVCSECMessage` @763182; `VehicleStatus` @717872/@718090;
  `ClosureStatuses` @717964; `DetailedClosureStatus` @718006; `VehicleLockState_E` @717862;
  `VehicleSleepStatus_E` @717867; `UserPresence_E` @717852; `InformationRequestType` enum
  @766557 (`GET_STATUS=0 … GET_CAPABILITIES=16`; **no "subscribe" member**).
- Connection lifetime: `setSelectedVIN` @9534059, `setStayConnectedWhenUnauthorized(…true…'start
  phone key pairing')` @9534079; `interceptPhoneKeyStatus` fn #202460 @9536871.

## Our code touchpoints
- `src/ble/directBleTransport.ts` — RX subscribe @195; drain-before-write @225; discard logic
  @213/@325–331.
- `src/ble/bleCorrelation.ts` — `frameAnswersRequest` / `outgoingCorrelators` (routing_address
  primary, request_uuid fallback).
- `src/ble/telemetry.ts` — `vcsecStatusToPatch` @323 (reuse for the push).
- `src/state/useCarLink.ts` — `applyTelemetry` @155/@309/@724; `POLL_MS=20_000` @75;
  `INFOTAINMENT_MS=60_000` @80; `filterPatchUnderIntent`/`GRACE_MS` import @51.
- `docs/superpowers/plans/tesla-ble-transport-spec.md` — §6.d already names "unsolicited VCSEC
  broadcast" frames (the push we discard).
