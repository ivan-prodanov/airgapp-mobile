# Tesla Android app — command lifecycle & live-status UX (behavioural-parity findings)

**Target app:** official Tesla Android app `com.teslamotors.tesla` **v4.58.0 (build 4392)**, `1arch_7dpi_24lang`, from APKMirror.
**Goal:** reimplement the official app's command-feedback and car-status UX faithfully in our airgapped BLE/Pi controller.
**Method:** static RE of (a) the React-Native **Hermes bytecode** bundle (`assets/index.android.bundle`, Hermes v96) via the `hbc-decompiler` disassembly `bundle.hasm`, (b) the **native Android** resources (`res/values/strings.xml`) and `AndroidManifest.xml` via apktool, and (c) the **inline English i18n dictionary** compiled into the Hermes bundle. No network, no dynamic analysis.

**Confidence convention:** plain statements are **directly read** from code/resources with a citation. **INFERRED** marks interpretation not directly proven by an opcode/literal. Where English copy could not be recovered it is stated explicitly rather than guessed.

> ### ⚠️ Rendering-structure claims here are superseded by Round 3 (`tesla-status-assets-FINDINGS.md`)
> The **copy** in this doc is correct. But two UI-rendering notes were later corrected: (1) §1.2 line "Two lines are shown: a status line and a freshness caption" — actually there is **ONE line**; the freshness ("Last seen/Asleep {{age}}") IS the status line, rendered by `VehicleStatusText` #117231 itself (not a separate caption). (2) §1.2's "status *row* variant (hasm:8759817)" is `RoadsideCoverageBanner`, unrelated to vehicle liveness; the real home-header status tap handler is `onStatusPress` #117253 → `TAP_STATUS_TEXT`. See Round-3 §A/§C.

**Citation shorthand** (all paths are how facts are auditable):
- `hasm:N` → line N of `/Users/ivan/Work/tesla-summon/work/bundle.hasm` (the disassembly).
- `xml:N` → line N of `res/values/strings.xml` (decoded from `base.apk` with apktool).
- `catalog` → the inline English i18n object embedded in the bundle at **hasm:1140421** (a `NewObjectWithBufferLong`, ~8,525 key→English pairs; 1 of 31 locale modules compiled into the bundle). This is the source of truth for RN in-app copy. Extracted to `en_locale_pairs.txt` during this work.
- `manifest:N` → `AndroidManifest.xml` line.

---

## 0. Architecture in one paragraph (read this first)

Command execution and its notifications are **native (Kotlin + Android WorkManager)**; the in-app control tiles, status header, and failure card are **React-Native**, driven by **redux + redux-saga**. User-facing copy is **not server-fetched** — the base bundle carries a full inline English i18n dictionary (`catalog`), and a small subset is duplicated in native `strings.xml` for notifications/widgets. There are **two transports** the app is explicitly aware of — `oapi` (owner REST/cloud), `hermes` (Tesla's persistent cloud stream), and `ble` (local Bluetooth) — tracked by a `ConnectivityType` tag (hasm:1474658–1474662). Liveness is modelled by a low-level `ConnectionState` enum and surfaced through a higher-level `ConnectivityStatus`; the phone-key/BLE link has its **own separate** indicator (`PhoneKeyConnectionState`). This maps cleanly onto our BLE+Pi design.

---

## 1. Status / connection state machine

### 1.1 The enums (internal state vocabulary)

**`ConnectionState`** — low-level per-VIN liveness, string-valued (def hasm:1474666–1474686). Verified by reading `isVehicleOnline`/`isVehicleOffline` (hasm:1461506 / 1461603):

| Member | Raw value | Classified as |
|---|---|---|
| `ONLINE` | `online` | online |
| `WAKING` | `waking` | **online-ish** (`isVehicleOnline` true) |
| `LOW_POWER` | `low_power` | online-ish |
| `ASLEEP` | `asleep` | **offline** (`isVehicleOffline` true) |
| `HIBERNATING` | `hibernating` | offline |
| `DEEP_SLEEP` | `deep_sleep` | offline |
| `SHUTDOWN` | `shutdown` | offline |
| `OFFLINE` | `offline` | offline |
| `UNKNOWN` | `unknown` | neither |
| `UNDETERMINED` | `undetermined` | neither |

`isVehicleOffline()` (fn #30689) ⇒ true for `{OFFLINE, ASLEEP, DEEP_SLEEP, HIBERNATING, SHUTDOWN}`. `isVehicleOnline()` (fn #30688) ⇒ true for `{ONLINE, WAKING, LOW_POWER}`. So **`WAKING` is treated as online** (controls/polling proceed during wake).

**`ConnectivityStatus`** — UI-level reachability (def ends hasm:1474656). Members (internal value string): `ONLINE`=`Online`, `OFFLINE`=`Offline`, `MOBILE_ACCESS_DISABLED`=`Mobile Access Disabled`, `IN_SERVICE_MODE`=`In Service Mode`, `SIGNED_COMMANDS_REQUIRED`=`Signed Commands Required`. (These value strings are internal identifiers; the user sees i18n text — §1.3.)

**`ConnectivityType`** — transport tag (def ends hasm:1474664): `OWNER_API`=`oapi`, `BLE`=`ble`, `HERMES`=`hermes`. This records *which transport* delivered the current data. **INFERRED: this tag is internal — it is not rendered as its own UI label.**

**`VehicleSleepStatus_E`** — the VCSEC/BLE proto enum the car reports over Bluetooth (def hasm:904713): `VEHICLE_SLEEP_STATUS_UNKNOWN=0`, `VEHICLE_SLEEP_STATUS_AWAKE=1`, `VEHICLE_SLEEP_STATUS_ASLEEP=2`. **Only 3 states over BLE — no "waking"/"offline"; those are cloud-transport concepts.** Relevant to us: over BLE you only get awake/asleep.

**`VehicleDataQuality`** — freshness classification (def ends hasm:1525342): `LIVE`, `CACHED_RELIABLE`, `CACHED_UNRELIABLE`, `UNABLE_TO_FETCH`, `NO_DATA`.

### 1.2 The header component & how it renders

The status line under the car name is React component **`VehicleStatusText`** (fn #117231, hasm:5218968). Shape (hasm:5219535–5219700): a `View` with an optional **`BusyIcon`** (animated spinner, hasm:5219500) followed by a `Text` (`automationID='vehicle_home_header_status_text'`, hasm:5219688). A second **status *row*** variant (hasm:8759817) renders `statusIcon` + `statusMessage` + `statusCaption` and is **tappable** (`onStatusPress`, fn #117253, hasm:5220768) — tapping issues a wake (`VehicleWakeReason.TAP_STATUS_TEXT`).

Two lines are shown: a **status line** (state label) and a **freshness caption** (`vehicleDataLastUpdatedString`, fn #30315, hasm:1440253 — see §1.5).

### 1.3 State → exact on-screen text, indicator, trigger

English resolved from `catalog` (authoritative). "Connecting" is **not** a stored enum value — it is the **null/undetermined fallback** in `VehicleStatusText` (hasm:5219494–5219501), shown together with the spinner.

| UI state | Exact text (English) | i18n key / source | Indicator | Trigger |
|---|---|---|---|---|
| Connecting / not-yet-determined | **Connecting** | `connecting_label` (catalog) — confirmed = "Connecting" | **`BusyIcon` spinner** + text | Reachability null before first poll/socket result (fallback branch) |
| Online — parked | **Parked** | `vehicle_home_parked_state`="Parked" | none | `ConnectionState.ONLINE`, gear P |
| Online — charging | **Charging** (and `Charging Complete`, `Charging Stopped`, `Charging Error - No Power`) | `vehicle_status_screen_charging*` (catalog) | none | online + charging |
| Low power | **Low Power Mode** | `vehicle_home_low_power_mode`="Low Power Mode" | none | `ConnectionState.LOW_POWER`; tap → low-power info sheet (hasm:5220790) |
| **Asleep** | **Asleep {{age}}** (e.g. "Asleep 5 minutes") | `vehicle_status_screen_asleep_age`="Asleep {{age}}" (catalog, hasm:1440296) | none | `ConnectionState.ASLEEP` / VCSEC `..._ASLEEP` |
| **Offline / unreachable** | **Last seen {{age}}** (e.g. "Last seen 2 hours ago") | `vehicle_status_screen_last_seen_age`="Last seen {{age}}" (catalog, hasm:1440330) | none | `isVehicleOffline` true / socket goodbye `vehicle_offline` |
| Mobile access disabled | **Mobile Access Disabled** | `vehicle_home_mobile_access_status`="Mobile Access Disabled" | none | owner disabled mobile access in car |
| In service | **In Service** / **Out of Service** / **Service Mode** | `vehicle_home_in_service_status`="In Service", `..._out_of_service_status`="Out of Service", `vehicle_home_service_mode`="Service Mode" (xml:2765 also) | none | car in service mode |
| App upgrade required | **Please upgrade the app** | `vehicle_home_upgrade_app_warning` | none | app too old for car |

> **Important correction to the brief's assumed labels.** The literals **"Waiting for car"** and **"Vehicle unavailable"** are **NOT** the app's real copy. There is no explicit "Offline" word either. Reality:
> - "Connecting" (+spinner) is the pre-resolution state.
> - Offline is shown as **"Last seen {{age}}"**, asleep as **"Asleep {{age}}"** — the *freshness caption is the offline/asleep indicator*.
> - `vehicle_offline` / `vehicle_unavailable` exist only as **internal socket-goodbye reason strings** (`socketGoodbyeReason`, fn #99991, hasm:4476215), not as display text.

### 1.4 BLE / phone-key indicator — SEPARATE from cloud reachability (matters to us)

Phone-key (BLE proximity) status is a **distinct indicator** with its own enum `PhoneKeyConnectionState` (def ends hasm:1525401): `UNKNOWN=0, CONNECTED=1, DISCONNECTED=2, CONNECTING=3, BLUETOOTH_DISABLED=4, QR_AUTHORIZED=5`. It surfaces in the Phone-Key card/settings and the widget — **not fused** into the main `ConnectivityStatus` line. English is present in **native** `strings.xml` (and catalog):

| Key | Exact English | Source |
|---|---|---|
| `phone_key_status_connected` | **Connected** | xml:1306 / catalog |
| `phone_key_status_connecting` | **Connecting** | xml:1307 / catalog |
| `phone_key_status_disconnected` | **Disconnected** | xml:1308 / catalog |
| `phone_key_status_not_paired` | **Set up your phone as a key** | catalog |
| `phone_key_status_needs_permissions` | **Phone key not recognized. Tap to set up.** | catalog |
| `phone_key_status_bluetooth_disabled` | **Enable Bluetooth to use your phone as a key** | xml:1305 / catalog |
| `phone_key_status_bluetooth_denied` | **Bluetooth access appears to be disabled for this app** | catalog |
| `phone_key_status_nearby_devices_denied` | **Enable Nearby devices permission to set up Phone Key** | catalog |
| `phone_key_status_device_connection_permission_denied` | **Enable Device connection permission to set up Phone Key** | catalog |

Internal BLE connect lifecycle (log strings, from the FindVehicle/connect saga — useful as a state map, not UI): `found vehicle, waiting for connecting` (hasm:10237109) → `Actions.waitForConnecting()` → `connectionState changed to connecting on the connection with …` → connected, or `connection timeout, connecting == false` (hasm:4378106). So BLE progression is **scan → found → waiting-for-connecting → connected / timeout**.

**Takeaway for us:** the official app models BLE-link state and cloud-reachability state independently and shows them in different places. Our UI should do the same: a phone-key/BLE chip ("Connected"/"Connecting"/"Disconnected") separate from the car-liveness line.

### 1.5 Freshness / "last updated" display — exact format

`vehicleDataLastUpdatedString` (fn #30315, hasm:1440253) computes the caption using **moment.js relative time** (`.fromNow()`), with `Math.min(timestamp, Date.now())` clamping:

| Freshness state | Template (English) | age format | Example |
|---|---|---|---|
| Asleep | `vehicle_status_screen_asleep_age` = "Asleep {{age}}" | `moment.fromNow(true)` — **no "ago" suffix** | "Asleep 5 minutes" |
| Offline / last seen | `vehicle_status_screen_last_seen_age` = "Last seen {{age}}" | `moment.fromNow()` — **includes "ago"** | "Last seen 2 hours ago" |
| Online/connecting | `connecting_label` = "Connecting" | (spinner) | — |

Format is **relative**, not absolute. The widget confirms the style: `vehicle_widget_updated_time` = **"%s ago"** (native, xml:2782) / **"{{time}} ago"** (RN catalog). The energy "Home Status" feature uses the same relative style (`Just now`, `~30s ago`, `{{count}}m ago`) but is a separate subsystem. Refresh cadence of the caption = the poll cadence in §1.6.

### 1.6 Transitions & timers

- **Poll cadence** (verified against the `TimeInMs` table at hasm:1474391): `VEHICLE_DATA_POLLING_INTERVAL_ONLINE` = **5000 ms** (`FIVE_SECONDS`), `VEHICLE_DATA_POLLING_INTERVAL_OFFLINE` = **1200 ms** (`ONE_SECOND × 1.2`). The data loop polls **every 1.2 s while offline/waking** (to catch the wake fast) and **every 5 s once online**; if a fetch finds the car just "came online" it **skips the delay and polls immediately** (hasm:7595019). No separate active/standby vehicle variant. Polling is **cancelled when the app backgrounds / user goes idle** (`cancelAllDataRequests`, fn #98639) and restarts on foreground.
- **Connecting → Offline flip:** there is **no single fixed "N seconds then Offline" constant**. The header shows Connecting+spinner while reachability is null; it flips when a poll/socket resolves the VIN to offline (or a socket goodbye `vehicle_offline`/`vehicle_unavailable`). The bounding timers are the 1.2 s/5 s poll cadence and the streaming `CONNECTION_TIMEOUT` (dynamic — the reconnect delay is passed as an argument, not an inline literal; `scheduleReconnectTimer`, fn #98461, hasm:4378055). **INFERRED: the flip is response-driven, not timer-driven.**
- **Retry/backoff on streaming:** `scheduleDelayedReconnect` ticks on a fixed `setTimeout(cb, 1000)` = **1 s** cadence, decrementing a countdown (hasm ~0362c18b). Energy-site polling has explicit `maxBackoffExponent` values; the vehicle-data loop does not expose a backoff constant.

---

## 2. Command lifecycle (tap → pending → terminal)

### 2.1 Pipeline

RN redux + redux-saga. Reducer #29496 (hasm:1404897) owns command state; the send effect is `?anon_0_sendVehicleCommandEffect` (fn #98728, 15.7 KB, hasm:4392227). Action types: `VEHICLE/SEND_VEHICLE_COMMAND`, `VEHICLE/SEND_VEHICLE_OPTIMISTIC_COMMAND`, `VEHICLE/SEND_VEHICLE_HEATER_COMMAND`, `VEHICLE/SEND_WIDGET_COMMAND`, and the terminal `VEHICLE_COMMAND_SUCCESS` / `VEHICLE_COMMAND_FAILED`. Command execution itself is handed to a **native WorkManager worker** (§4), so it survives backgrounding.

### 2.2 On tap — optimistic UI (CONFIRMED)

On tap the app dispatches `SEND_VEHICLE_OPTIMISTIC_COMMAND`, creating an in-flight record `{ commandId, startTime }` in a `vehicleCommands` collection (reducer #29496; selector reads `commandId`/`startTime` at hasm:1412360). The control **optimistically shows the target state immediately** (there is a `getOptimisticResult` / `useOptimisticState`, fns #61439/#61506/#157031). So it is not merely "spinner then wait" — it reflects the requested state, backed by a pending record. A `CommandStatus` enum + `setCommandstatus`/`clearCommandstatus` (hasm:895189) drives the per-control pending indicator.

### 2.3 Timeline & the terminal-state guarantee

```
t=0  tap → SEND_VEHICLE_OPTIMISTIC_COMMAND
          → optimistic record {commandId, startTime}; control shows target state (pending)
in-flight → native worker sends over Hermes/cloud or BLE, with internal retries (telemetry span
            'mobile-app-vehicle-command-attempt'; attrs retry_attempt / retry_delay_ms / retry_result)
terminal (any one of):
   • VEHICLE_COMMAND_SUCCESS  → optimistic record resolved; confirmed state persists
   • VEHICLE_COMMAND_FAILED   → failure card (title+body, §3); auto-dismiss after 7 s
   • HARD CAP (no response)   → optimistic record force-expired after 30 s → pending clears
```

**The hard wall-clock cap (this is the anti-hang guarantee we want):**
`OPTIMISTIC_TIMEOUT_MS` = `TimeInMs.THIRTY_SECONDS` = **30000 ms** (assignment hasm:1435013–1435014; `TimeInMs` table hasm:1474391 lists `THIRTY_SECONDS:30000`). The expiry selector (fn #29656, hasm:1412374) computes:
```
isExpired(cmd) = (cmd.startTime + OPTIMISTIC_TIMEOUT_MS) < now
```
This is a **pure time comparison re-evaluated on every render/selector run** — not a `setTimeout` that can be dropped. Once elapsed > 30 s, the pending record is discarded and the spinner clears **regardless of whether any response ever arrives**. **That deadline-from-startTime pattern is the fix for our hang bug** — compute the deadline once and check it on every render, don't rely on a callback firing.

**Failure card display duration:** `ERROR_CARD_TIMEOUT` = **7000 ms** (`LoadConstInt 7000` → `PutById ERROR_CARD_TIMEOUT`, hasm:1516214–1516228; consumed at hasm:4326493). The card auto-dismisses after 7 s.

### 2.4 Retry loop

An **internal automatic retry loop** runs inside the send effect *before* a failure is surfaced (telemetry attributes `retry_attempt`, `retry_delay_ms`, `retry_result`, `retry_success`, `retry_response_string` at hasm:4395166+; top-level `VEHICLE_COMMAND_RETRY`/`vehicle_command_retry` is a telemetry/enum event, not a UI button). **The exact max-attempt count and backoff values are computed from variables/remote config and are NOT readable as inline constants — INFERRED to exist; values not recovered.**

### 2.5 On the ~25 s field observation

The only client-side wall-clock cap directly readable is **`OPTIMISTIC_TIMEOUT_MS` = 30 s** (pending clears). A distinct **command-request timeout** — the deadline that produces the "timeout" *failure reason* the field team saw at ~25 s — is governed by the HTTP/Hermes transport and/or remote config and was **NOT recoverable as an inline constant.** A Summon-specific `CommandTimeoutThresholdMs` = **10000 ms** exists (hasm:5800056) but is Summon-only. **Treat 25 s as a field measurement, not a confirmed constant; 30 s is the confirmed code cap.** (A request timeout slightly under the 30 s cap is consistent with the observation.)

---

## 3. Failure copy catalogue (highest-value section)

### 3.1 Title — `<Command name> failed`

Two parallel renderings of the same key `command_error_command_failed`:
- **RN in-app card:** `{{command}} failed` (catalog; i18next placeholder).
- **Native (push/background):** `%command% failed` (xml:417, `formatted="false"`).

`{{command}}` is filled by `tr('command_name_<TYPE>')`. Fallback when a command has no name: `command_name_GENERIC_` = **"Command"**. So `command_name_LOCK`="Lock" ⇒ **"Lock failed"**. The full 107-key `command_name_*` → English table is in the appendix section-B file; the 31 native duplicates are xml:418–448. Key examples: LOCK→Lock, UNLOCK→Unlock, CLIMATE_ON→Climate On, START_CHARGE→Start Charging, TRIGGER_HOMELINK→HomeLink, HONK_HORN→Honk Horn, FLASH_LIGHTS→Flash Lights, CHARGE_PORT_DOOR_OPEN→Charge Port Open, WINDOW_CONTROL→Window Control, BOOMBOXACTION→Remote Fart.

### 3.2 Body — transport/generic error → exact copy (map our error kinds onto these)

All English from `catalog` (hasm:1140421), verified independently against the extracted dictionary. The failure-card **builder** (hasm:4393900–4395450) inspects the command result's status/failure-type and selects the key; the `Timeout` branch → `command_error_timeout` is directly confirmed.

| Our internal error kind | Tesla key | **Exact English body** |
|---|---|---|
| **Timeout / deadline exceeded** (the field case) | `command_error_timeout` | **Command timeout, please try again.** |
| Generic / unmapped failure (fallback) | `command_error_GENERIC_` | **Command failed** |
| Unexpected / internal error | `command_error_unexpected` | **An unexpected error occurred, please try again.** |
| Vehicle connection lost | `vehicle_error_connection_error` | **Vehicle Connection Error** |
| Network request failed | `vehicle_error_network_request_error` | **Check internet connection** |
| Timeout (network layer) | `vehicle_error_timeout_error` | **Check Internet Connection** *(note the different casing from the row above — verbatim)* |
| Not authorised / session expired | `vehicle_error_unauthorized` | **Session Expired** |
| Insufficient privileges (key perms) | `vehicle_error_insufficient_privileges` | **Unpair your phone key and pair it again to retry.** |
| Mobile access disabled on car | `vehicle_error_mobile_access_disabled` | **Mobile Access Disabled** |
| App not in vehicle whitelist (phone key not enrolled) | `vehicle_error_not_in_whitelist` | **Set up Phone Key and try again.** |
| Not in whitelist (QR/device path) | `vehicle_error_not_in_whitelist_qr` | **Authorize mobile device and try again.** |
| Car-server error | `vehicle_error_car_server_error` | **Vehicle Server Error** |
| Server error (generic) | `vehicle_error_server_error` | **Server Error** |
| Server maintenance | `vehicle_error_server_maintenance` | **Server Maintenance** |
| App too old for command | `vehicle_error_update_and_try_again` | **Please update app and try again** |
| Unknown | `vehicle_error_unknown_error` | **Unknown Error** |

**Status-code strings the builder branches on** (hasm:4393900–4395450): `deadline_exceeded`, `failed_precondition`, `permission_denied`, `unauthenticated`, `not_supported`, `internal_error`, `initializing`, `could_not_wake_buses`, `pre_delivery`, and dash-forms `no-network`, `mobile-access-disabled`, `insufficient-privileges`, `not-in-whitelist`, `signed-commands-required`, `pre-condition`. **INFERRED (partial):** only the `Timeout`→`command_error_timeout` and the generic fallbacks are opcode-confirmed; the auth/network/whitelist/mobile-access branches load the `vehicle_error_*` family in the same builder.

**Two gaps in the failure path (by design):**
- **No "vehicle asleep" body** — the command-failure path has no `asleep`/`offline` key. Sleep is handled *upstream* by an auto-wake step (§5), not by the failure card.
- **No "rate limited" body** — rate-limit strings in the bundle are HTTP/Sentry headers, not command UI.

### 3.3 Command-specific precondition bodies (~195 keys)

For `failed_precondition`-class results the failing command's specific condition selects a `command_error_<CMD>_<reason>` key. These are the "why the car refused" bodies. Full verbatim table (all from catalog) is in the appendix (`section-B-failure-copy.md`). Representative rows:

| Key | Exact English body |
|---|---|
| `command_error_LOCK_doors_open` | Failed to lock vehicle. One or more doors are open. |
| `command_error_CLIMATE_ON_door_open` | Climate failed to start.\nOne or more doors are open. |
| `command_error_CLIMATE_ON_low_soc` | Your vehicle has insufficient charge.\nClimate control has been disabled to conserve energy. |
| `command_error_HONK_HORN_ingear` | Failed to honk horn. Vehicle is not in Park (P). |
| `command_error_START_CHARGE_disconnected` | Failed to start charging.\nCharger disconnected. |
| `command_error_TRIGGER_HOMELINK_too_far_from_vehicle` | Please move closer to your vehicle |
| `command_error_WINDOW_CONTROL_not_in_park` | Vehicle must be in Park (P) to use window commands |
| `command_error_REMOTE_START_unauthorized` | Failed to enable Keyless Driving.\nPlease sign out of the app, sign back in and try again. |

(`\n` = literal newline in the source string — bodies use a summary line + reason line pattern.)

### 3.4 Card behaviour

| Property | Finding | Evidence |
|---|---|---|
| Surface | Error card pushed via `Actions.put(setErrorData(...))` (bottom card, bold title + body) | builder hasm:4393900–4395450 |
| Auto-dismiss | **7000 ms** (`ERROR_CARD_TIMEOUT`) | hasm:1516214–1516228 |
| Manual retry button | **None wired to the card** — retry is automatic (§2.4). Generic `button_retry`="Retry" exists but is used by other flows. **INFERRED (absence in builder).** | builder region |
| Tappable / dismissable | Not conclusively read from disassembly. **INFERRED.** | — |

### 3.5 Tone & structure (for copy parity)

- **Title:** `<Command name> failed` — cap on command name only, lowercase `failed`, **no trailing period**.
- **Case:** sentence case; feature/mode proper nouns Title-Cased ("Climate Keeper", "Sentry Mode", "Park (P)", "Low Power Mode").
- **Trailing period:** inconsistent — full sentences end with `.` ("Command timeout, please try again."); short labels omit it ("Command failed", "Session Expired", "Check internet connection").
- **Two-line bodies** use literal `\n` (summary line + reason line).
- **Length:** short. Generic bodies 3–7 words; precondition bodies one sentence; only "override/continue" confirmation prompts run longer.
- **Voice:** direct, imperative remediation ("Set up Phone Key and try again.", "Please move closer to your vehicle").

---

## 4. Backgrounding + notifications

### 4.1 Backgrounding — commands DO continue

Vehicle commands are dispatched to a **native Android WorkManager** job, independent of the RN foreground:

| Class | Role |
|---|---|
| `com.tesla.command.CommandCenterBackgroundTasker` | orchestrates background command exec; logs "Starting/Killing on-going command worker…", "Updating on-going commands notification…" |
| `com.tesla.command.CommandCenterBackgroundTasker$OnGoingCommandWorker` | `androidx.work.CoroutineWorker` that runs the command |
| `com.tesla.command.ExecuteCommandWorker` | WorkManager worker executing a queued command |
| `com.tesla.widget.worker.WidgetCommandExecutionWorker` | worker for home-screen-widget commands |
| `com.teslamotors.plugins.ble.BLEService` | **foreground service** (`foregroundServiceType="connectedDevice"`, `process=":svc"`, manifest:279) — BLE commands run here (always-alive) |

The worker requests an **expedited** WorkManager job (fallback token `RUN_AS_NON_EXPEDITED_WORK_REQUEST`) and shows an **ongoing notification** on the **"Vehicle Service"** channel (`VEHICLE_SERVICE`; `notification_channel_vehicle_service_name`="Vehicle Service", xml:1261). On timeout it cancels and posts the failure notification (logs "canceling request as result timeout.", "Timeout expiry reached for the transaction", "Showing failure notification for …"). Relevant permissions: `FOREGROUND_SERVICE`, `FOREGROUND_SERVICE_CONNECTED_DEVICE`, `WAKE_LOCK`, `POST_NOTIFICATIONS`, `REQUEST_IGNORE_BATTERY_OPTIMIZATIONS`. **INFERRED:** the exact channel-id→command-notification binding wasn't isolated (strongly implied by dex8 co-location).

**Pending state across background→foreground:** on background/idle the RN side **cancels all data requests** (`cancelAllDataRequests`, fn #98639; "User inactive, cancelling vehicle data polling"); on foreground it re-wakes (`VehicleWakeReason.APP_FOREGROUND`) and re-polls. **INFERRED:** the command spinner is re-derived from freshly polled `CommandStatus` on resume (the native worker owns actual execution), not persisted across the gap.

### 4.2 Notification catalogue

| Key | Exact title | Exact body | When | Channel |
|---|---|---|---|---|
| `background_task_failed_default_*` | **Unable to Complete Command** (xml:198) | **Open the Tesla App to complete your request.** (xml:197) | native background worker fails/times out | Vehicle Service |
| `push_notif_command_failed_*` | **Failed** (xml:1474) | **Something went wrong. Tap to open the app to retry** (xml:1473) | push/command failure; tap re-opens to retry | Vehicle |
| `vehicle_widget_command_notification_title` | **Connecting** (xml:2770) | — (title only) | widget command in progress (ongoing worker) | Vehicle Service |
| `vehicle_widget_command_execution_executing` | **Connecting...** (xml:2767) | — | widget command in-progress text | widget |
| `vehicle_widget_command_execution_success` | **Sent** (xml:2769) | — | widget command succeeded | widget |
| `vehicle_widget_command_execution_failed` | **Failed** (xml:2768) | — | widget command failed | widget |

**Success vs failure:** **no generic command "success" push.** The only affirmative success surface is the widget's terminal **"Sent"** state. All other command outcomes surface only on **failure**.

Interactive **notification action buttons** (via `CommandRequestBroadcastReceiver`): Lock (xml:1463), Unlock (1268), Front Trunk (1264), Rear Trunk (1266), Stop Charging (1466), Turn Climate On/Off (1468/1467), Turn Sentry Off (1470), Close Windows (1460), Close Front/Rear Trunk (1456/1457), Close Sunroof (1458), Turn Camp/Pet Mode On (1453/1464), Update / Cancel Update (1471/1455).

Vehicle-relevant **channels**: Vehicle Service (xml:1261), Vehicle (1260), Phone Key Status (1258), Charging Status (267), Closure Suggestions (399), Account (1253), Notifications (1255), Inbox (1256), Subscription (1259).

---

## 5. Asleep / wake

### 5.1 Detection

Asleep is detected via `ConnectionState` (§1.1): `isVehicleOffline()` ⇒ true for `{OFFLINE, ASLEEP, DEEP_SLEEP, HIBERNATING, SHUTDOWN}`; `WAKING` is the in-transition state (treated as online). Over BLE the car reports `VehicleSleepStatus_E` (awake/asleep only). Header shows **"Asleep {{age}}"**.

### 5.2 Auto-wake — automatic, no prompt

The app **auto-wakes**; it dispatches the wake itself rather than asking. Concrete trigger: when a vehicle-data fetch returns offline/null it runs `store.dispatch(Actions.vehicleWakeUp(vin, VehicleWakeReason.VEHICLE_OFFLINE_NO_DATA))` (hasm:1496007). OAPI endpoint `api/1/vehicles/{vehicle_id}/wake_up` (hasm:65335); wake progress tracked by the `wakeUpWindow` Redux slice (a state slice, **not** a numeric timeout).

`VehicleWakeReason` enum (hasm:1525344–1525355) — every reason a wake fires:

| Member | Value | Trigger |
|---|---|---|
| `USER_SENT_COMMAND` | `user_initiated_command` | **user sends a command** (car woken first) |
| `APP_FOREGROUND` | `app_foreground` | app returns to foreground |
| `SCREEN_REQUIRES_WAKE` | `screen_requires_wake` | opening a screen needing live data |
| `VEHICLE_DATA_POLLING` | `vehicle_data_polling` | data-poll loop |
| `VEHICLE_OFFLINE_NO_DATA` | `vehicle_offline_no_data` | fetch returned offline/no data |
| `TAP_STATUS_TEXT` | `tap_status_text` | user taps the status line |
| `TAP_VEHICLE` | `tap_vehicle` | user taps the vehicle |
| `PULL_DOWN_REFRESH` | `pull_down_refresh` | pull-to-refresh |

**No "Do you want to wake the car?" prompt exists** for the command/read path.

### 5.3 "Waking up…" state text — DOES NOT EXIST for normal commands

There is **no generic user-facing "Waking up…" label**. Confirmed by searching the full inline English dictionary: the only wake copy is Summon/battery-test-specific:
- `vehicle_ops_enable_summon_wake_failed` = **"Unable to wake up vehicle"**
- `vehicle_ops_enable_summon_time_out_failure` = **"Vehicle may still be waking up"**
- `autopark_summon_error_wake_up_timeout` = **"System wake timed out"**
- `vehicle_soh_warning_for_waking_up_vehicle` = **"Proceeding will wake up your vehicle and may disrupt the battery test.\nDo you still want to proceed?"**

For a normal command/read on an asleep car, the app wakes silently and shows the generic **"Connecting"** (+spinner) pending state, then the result. `WAKE_UP_TIMEOUT` is a Summon reason string, not a numeric constant — **no numeric wake timeout was recovered**; wake completion is governed by the 1.2 s poll loop flipping the car to an online `ConnectionState`.

---

## 6. What this means for our implementation (behavioural parity checklist)

1. **Two indicators, not one:** a BLE/phone-key chip ("Connected" / "Connecting" / "Disconnected") separate from the car-liveness line. We have both transports — mirror this split (`ConnectivityType` = ble/hermes/oapi internally).
2. **Liveness line = freshness, not a word:** show "Asleep {{age}}" and "Last seen {{age} ago}"; show "Connecting" + spinner only while undetermined. Don't invent an "Offline"/"Vehicle unavailable" label.
3. **Optimistic control tiles:** on tap, show the target state immediately, backed by a `{commandId, startTime}` record.
4. **Guarantee termination with a computed deadline:** `now > startTime + 30 000 ms` checked every render (not a `setTimeout`). This is their anti-hang mechanism — adopt it verbatim to fix ours.
5. **Failure card:** bold `<Command> failed` title + one of the §3.2 bodies; auto-dismiss ~7 s; automatic retry, no retry button.
6. **Map our error kinds** onto the §3.2 table (timeout → "Command timeout, please try again.", unreachable → "Vehicle Connection Error", not-authorised → "Session Expired", key-not-enrolled → "Set up Phone Key and try again.", etc.).
7. **Background:** run command execution in a service that survives backgrounding; on failure post the local notification **"Unable to Complete Command" / "Open the Tesla App to complete your request."**; no success notification (except a widget "Sent").
8. **Asleep:** auto-wake silently (no prompt); poll at ~1.2 s while waking, 5 s once online.

---

## 7. Citations (auditable index)

- **ConnectionState / ConnectivityStatus / ConnectivityType / TimeInMs / polling** — constants module hasm:1474391–1474720; `isVehicleOnline`#30688 hasm:1461506; `isVehicleOffline`#30689 hasm:1461603.
- **VehicleSleepStatus_E / BLE proto enums** — hasm:904713–904730.
- **PhoneKeyConnectionState / VehicleDataQuality / VehicleWakeReason** — module #32099, hasm:1525303–1525401.
- **VehicleStatusText header** — fn #117231 hasm:5218968; connecting fallback + BusyIcon hasm:5219494–5219501; status row hasm:8759817.
- **Freshness** — `vehicleDataLastUpdatedString` fn #30315 hasm:1440253; keys hasm:1440296/1440330.
- **Command reducer / send effect** — reducer #29496 hasm:1404897; `sendVehicleCommandEffect` #98728 hasm:4392227.
- **OPTIMISTIC_TIMEOUT_MS=30000** — assign hasm:1435013; TimeInMs table hasm:1474391; expiry selector #29656 hasm:1412374.
- **ERROR_CARD_TIMEOUT=7000** — hasm:1516214–1516228; consumed hasm:4326493.
- **Failure title / bodies** — native title xml:417; command_name xml:418–448; inline English catalog hasm:1140421; failure-card builder hasm:4393900–4395450.
- **Notifications (native)** — xml:197/198 (background failure), xml:1473/1474 (push failure), xml:2767–2770 (widget); channels xml:1253–1261.
- **Background workers** — `com.tesla.command.*` / `com.tesla.widget.worker.*` (dex7/dex8); manifest:279 (BLEService), 336, 363, 564–565.
- **Wake** — `Actions.vehicleWakeUp` hasm:1496007; VehicleWakeReason hasm:1525344–1525355; endpoint hasm:65335.
- **Polling values** — hasm:1474573 (ONLINE=5000), 1474580 (OFFLINE=1200 via ×1.2), 1474587 (ENERGY=4000).
- **Full appendix tables** — `.../scratchpad/section-B-failure-copy.md` (107 command_name + ~195 precondition bodies), `section-C-connection-states.md`, `section-D-background-notif-wake.md`, `section-A-command-lifecycle.md`.

---

## 8. Gaps (not recovered — stated plainly, not guessed)

1. **Exact command-request timeout (~25 s):** not an inline constant; transport/remote-config driven. Confirmed cap is the 30 s optimistic timeout; the 25 s is a field measurement.
2. **Retry max-attempt count and backoff:** confirmed to exist (telemetry `retry_attempt`/`retry_delay_ms`) but values are variable/remote-config — not readable.
3. **Per-state header icon asset names** (offline/asleep/online glyphs): only `BusyIcon` (spinner) confirmed; other `statusIcon` assets not resolved.
4. **Per-state text colours** (e.g. a red "Offline"): not confirmed by name — INFERRED muted/secondary style.
5. **Native tasker numeric fields** (`timeoutMins`, `maxTimeout`, `connection_timeout`, `TRIGGER_NETWORK_EVALUATION_TIMEOUT_MS`): compiled ints not in the dex string table — not recovered.
6. **`signedCommandTimeout`** (phone-key pairing validation race): value from env/config var, not inline — not recovered.
7. **Failure-card tappable/dismissable + exact channel-id binding for command notifications:** INFERRED, not opcode-proven.
8. **Exact "Connecting→Offline" wall-clock:** response-driven (socket goodbye / poll), no single literal.
