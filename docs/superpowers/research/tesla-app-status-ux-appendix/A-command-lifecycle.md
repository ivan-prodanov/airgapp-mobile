# Section A — Command lifecycle (tap → pending → terminal)

## Architecture
Vehicle commands (lock/unlock/climate/etc.) are driven by a **redux + redux-saga** pipeline in the Hermes bundle. The reducer that owns command state is Function #29496 (bundle.hasm line 1404897), which handles the action types `SEND_VEHICLE_OPTIMISTIC_COMMAND`, `SEND_VEHICLE_COMMAND`, `VEHICLE_COMMAND_SUCCESS`, `VEHICLE_COMMAND_FAILED` (seen at hasm 1404920/1404941 etc.). The send effect is Function #98728 `?anon_0_sendVehicleCommandEffect` (15,687 bytes, hasm 4392227).

Action-type vocabulary (bundle strings):
- `VEHICLE/SEND_VEHICLE_COMMAND`, `VEHICLE/SEND_VEHICLE_OPTIMISTIC_COMMAND`, `VEHICLE/SEND_VEHICLE_HEATER_COMMAND`, `VEHICLE/SEND_WIDGET_COMMAND`
- `VEHICLE_COMMAND_SUCCESS`, `VEHICLE_COMMAND_FAILED`

## Optimistic UI on tap — CONFIRMED
On tap the app dispatches `SEND_VEHICLE_OPTIMISTIC_COMMAND`, creating an in-flight/optimistic command record `{ commandId, startTime }` tracked in a `vehicleCommands` collection (reducer #29496; selector reads these fields at hasm 1412360-1412387). The control shows the **target/optimistic state immediately** (optimistic value) while the command is in flight. `getOptimisticResult`/`useOptimisticState` functions exist (#61439, #61506, #157039). So: the control does NOT merely spinner-and-wait; it optimistically reflects the requested state, backed by a pending record.

## The hard terminal-state guarantee — 30 s
`OPTIMISTIC_TIMEOUT_MS` is defined as `TimeInMs.THIRTY_SECONDS` = **30000 ms** (assignment at hasm 1435013-1435014; `TimeInMs` table object at hasm 1474391 explicitly lists `'THIRTY_SECONDS': 30000`).

The expiry selector Function #29656 (hasm 1412374, 57 bytes) computes:
```
isExpired(command) = (command.startTime + OPTIMISTIC_TIMEOUT_MS) < now
```
(bytecode: GetById 'startTime'; GetById 'OPTIMISTIC_TIMEOUT_MS'; Add; Less against a "now" timestamp; Ret). Once elapsed > 30 s, the optimistic/pending record is treated as expired and dropped, so **the pending/spinner state is guaranteed to clear within 30 s regardless of whether any response arrives.** This is a pure time-comparison in a selector (no reliance on a callback firing), which is the mechanism that prevents an indefinite hang.

> Implementation note for us: their guarantee is a **deadline computed from `startTime` and re-evaluated on every render/selector run**, not a `setTimeout` that could be lost. That is the pattern to copy to fix our hang bug.

## Failure error card duration — 7 s
`ERROR_CARD_TIMEOUT` = **7000 ms** (LoadConstInt Imm32:7000 at hasm 1516199 module, assignment at 1516228; consumed at hasm 4326493). The failure card is auto-dismissed after 7 s. (Whether it is also manually dismissable/tappable: not conclusively read from code — see Gaps; the saga references it as a display duration.)

## Internal retry loop — EXISTS
The send saga records retry telemetry attributes `retry_attempt` (hasm 4395166), `retry_delay_ms` (hasm 4395168), plus `retry_result`, `retry_success`, `retry_response_string` — confirming an **internal retry loop inside the send effect**. Also a top-level `VEHICLE_COMMAND_RETRY` / `vehicle_command_retry` action exists. The exact max-attempt count and backoff values are computed from variables/remote config, not inlined as readable constants in the saga (a `LoadConstInt 1000` nearby at hasm 4393339 is a status-code comparison, not a delay). **Retry count/backoff: NOT directly recovered (INFERRED to exist; values not readable).**

## Transport awareness
The saga is transport-aware: it reads `getVehicleConnectionState` / `ConnectionState`, `TRANSPORT_HERMES`, `hermes_connected`, `hermes_allowed`, `stringFromHermesState`, `getHermesState` (hasm 4392227-4405000). Telemetry span `mobile-app-vehicle-command-attempt` wraps each attempt (Splunk/Trace). So the same command path covers BLE/local (Hermes) and cloud, and the failure reason reflects which transport/why.

## Failure title (rendered by JS from the NATIVE string)
The saga references native Android string key `command_error_command_failed` (hasm, 12 refs in saga region). That resource is `"%command% failed"` (strings.xml:417, formatted="false"). `%command%` is substituted with the display name from `command_name_<ACTION>` (strings.xml:418-448), e.g. `command_name_LOCK`="Lock" ⇒ **"Lock failed"**. So the card TITLE is `<Command display name> failed`.

## Command timeout (the ~25 s field observation)
- `command_error_timeout` and `vehicle_error_timeout_error` are the timeout body keys (see Section B).
- Internal error-reason enum (Function #67643, hasm 3093134) includes `COMMAND_TIMED_OUT`, `HERMES_COMMAND_TIMEOUT` (human label `'Hermes - Command Timeout'`), `CONNECTION_TIMEOUT` (`'Connection Timeout'`), `REQUEST_TIMEOUT`.
- The single client-side wall-clock cap I could read is **OPTIMISTIC_TIMEOUT_MS = 30 s** (pending clears). A distinct **command-request timeout** (that would produce the "timeout" *reason* around the observed ~25 s) is governed by the HTTP/Hermes transport layer and/or remote config; **its exact numeric value was NOT directly recoverable** as an inline constant. The 25 s the field team measured is consistent with a request timeout slightly under the 30 s optimistic cap. **Do not treat 25 s as a confirmed constant — it is a field measurement; 30 s is the confirmed code constant.**

## Lifecycle timeline (summary)
1. **t=0 tap** → `SEND_VEHICLE_OPTIMISTIC_COMMAND`; optimistic record `{commandId, startTime}` added; control shows target state (optimistic).
2. **in flight** → `?anon_0_sendVehicleCommandEffect` sends over Hermes/cloud, with internal retries; telemetry span per attempt.
3. **terminal**:
   - `VEHICLE_COMMAND_SUCCESS` → optimistic record resolved; confirmed state persists.
   - `VEHICLE_COMMAND_FAILED` → failure card shown: title `<Command> failed` (native), body = localized error key (Section B); card auto-dismiss after `ERROR_CARD_TIMEOUT`=7 s.
   - **hard cap**: if no terminal action within `OPTIMISTIC_TIMEOUT_MS`=30 s, `isExpired` selector drops the optimistic record → pending state clears (guaranteed non-hang).

## Citations
- Reducer #29496 @ hasm 1404897; action types @ 1404920, 1404941.
- Optimistic selector #29656 @ hasm 1412374; reads startTime/OPTIMISTIC_TIMEOUT_MS.
- OPTIMISTIC_TIMEOUT_MS = TimeInMs.THIRTY_SECONDS @ hasm 1435013-1435014; TimeInMs table @ hasm 1474391 ('THIRTY_SECONDS':30000).
- ERROR_CARD_TIMEOUT = 7000 @ hasm 1516199 module (1516228); consumed @ 4326493.
- sendVehicleCommandEffect #98728 @ hasm 4392227; retry attrs @ 4395166/4395168.
- Title: strings.xml:417 command_error_command_failed; strings.xml:418-448 command_name_*.
- Error-reason enum #67643 @ hasm 3093134 (COMMAND_TIMED_OUT, HERMES_COMMAND_TIMEOUT, CONNECTION_TIMEOUT).

## Gaps
- Exact command-**request** timeout value (~25 s) and retry max-count/backoff: not readable as inline constants (transport/remote-config driven).
- Whether the failure card is user-dismissable/tappable and whether tapping retries: not conclusively read (ERROR_CARD_TIMEOUT auto-dismiss confirmed at 7 s).
