# Section C — Vehicle Connection / Liveness Status Model & UI

**Corpus:** Tesla Android app `com.teslamotors.tesla` v4.58.0-4392 (React-Native / Hermes bytecode).
**Sources cited:**
- `HASM` = `/Users/ivan/Work/tesla-summon/work/bundle.hasm` (Hermes disassembly)
- `XML` = `.../scratchpad/base_apktool/res/values/strings.xml` (Android native resources)
- `STR` = `.../scratchpad/all_strings.txt` (de-duplicated string index)

**Convention:** Every fact below cites `HASM:<line>` (bytecode line) or `XML:<line>`. Text taken from a translation **key** (not literal English) is flagged **[i18n KEY — English NOT in bundle]**. Anything not read directly from code is flagged **INFERRED**.

> ⚠️ Important structural finding: the app has **several parallel state vocabularies**, not one. There is (a) a low-level per-VIN *liveness* enum `ConnectionState`, (b) a higher-level UI *reachability* enum `ConnectivityStatus`, (c) the VCSEC/BLE proto `VehicleSleepStatus_E`, (d) BLE phone-key connection enums, and (e) a data-freshness enum `VehicleDataQuality`. They are defined in two big "constants" modules and consumed by the `VehicleStatusText` header component.

---

## C0. Where the enums are defined (the two constants modules)

**Module A** — constants object built in one function, `HASM:1474391`–`1474720`. Contains `TimeInMs`, `ConnectionState`, `ConnectivityStatus`, `ConnectivityType`, `PhoneKeyState`, `VehiclePollingType`, `VEHICLE_DATA_POLLING_INTERVAL_*`, etc.

**Module B** — constants object built in function `#32099` @ `HASM:1525303`+. Contains `PhoneKeyConnectionState`, `PhoneKeyBondingState`, `PhoneKeyAndroidUWBState`, `VehicleDataQuality`, `VehicleWakeReason`, `PredeliveryAuthState`.

**Module C** — VCSEC protobuf enums, `HASM:904700`+ (`VehicleSleepStatus_E`, `BLEPresence`, `KeyLocationStatus_E`, etc.).

---

## C1. Complete state set

### C1a. `ConnectionState` — low-level per-VIN liveness (string-valued enum)
Definition: `HASM:1474666`–`1474686` (`PutById … 'ConnectionState'` at `HASM:1474686`). Values are the raw API/telemetry strings:

| Enum member | Raw value | Source |
|---|---|---|
| `UNKNOWN` | `'unknown'` | HASM:1474666 |
| `UNDETERMINED` | `'undetermined'` | HASM:1474668 |
| `ONLINE` | `'online'` | HASM:1474670 |
| `WAKING` | `'waking'` | HASM:1474672 |
| `LOW_POWER` | `'low_power'` | HASM:1474674 |
| `ASLEEP` | `'asleep'` | HASM:1474676 |
| `HIBERNATING` | `'hibernating'` | HASM:1474678 |
| `DEEP_SLEEP` | `'deep_sleep'` | HASM:1474680 |
| `SHUTDOWN` | `'shutdown'` | HASM:1474682 |
| `OFFLINE` | `'offline'` | HASM:1474684 |

### C1b. `ConnectivityStatus` — UI-level reachability (drives header text)
Definition ends `HASM:1474656` (`PutById … 'ConnectivityStatus'`). Members (value string in quotes):

| Enum member | Value string | Source |
|---|---|---|
| `ONLINE` | `'Online'` | HASM:1474646 |
| `OFFLINE` | `'Offline'` | HASM:1474648 |
| `MOBILE_ACCESS_DISABLED` | `'Mobile Access Disabled'` | HASM:1474650 |
| `IN_SERVICE_MODE` | `'In Service Mode'` | HASM:1474652 |
| `SIGNED_COMMANDS_REQUIRED` | `'Signed Commands Required'` | HASM:1474654 |

Note: the value strings above are internal identifiers/log strings; the **user-facing** text is looked up separately by i18n key (see C2).

### C1c. `VehicleSleepStatus_E` — VCSEC/BLE proto enum (over Bluetooth)
Definition: `NewObjectWithBufferLong` at `HASM:904733`, registered `PutByIdLong … 'VehicleSleepStatus_E'` at `HASM:904734`. The buffer object literal (`HASM:904733`) is `{'VEHICLE_SLEEP_STATUS_UNKNOWN':0, 'VEHICLE_SLEEP_STATUS_AWAKE':1, 'VEHICLE_SLEEP_STATUS_ASLEEP':2}`:

| Enum member | Numeric | Source |
|---|---|---|
| `VEHICLE_SLEEP_STATUS_UNKNOWN` | 0 | HASM:904733 |
| `VEHICLE_SLEEP_STATUS_AWAKE` | 1 | HASM:904733 |
| `VEHICLE_SLEEP_STATUS_ASLEEP` | 2 | HASM:904733 |

This is the sleep status the car reports over the VCSEC BLE channel (only 3 states — no "waking"/"offline"; those are cloud-transport concepts).

### C1d. `ConnectivityType` — transport tag (BLE vs cloud)
Definition ends `HASM:1474664` (`PutById … 'ConnectivityType'`).

| Member | Value | Source |
|---|---|---|
| `OWNER_API` | `'oapi'` | HASM:1474658 |
| `BLE` | `'ble'` | HASM:1474660 |
| `HERMES` | `'hermes'` | HASM:1474662 |

`oapi` = Owner REST API (cloud), `hermes` = Tesla's persistent cloud streaming channel, `ble` = local Bluetooth. This tag is how the app records **which transport** delivered data. (See C3.)

### C1e. BLE phone-key state enums (proximity / local key)
- **`PhoneKeyState`** (Module A, members built `HASM:1474596`–`1474605`, registered `HASM:1474606`): `CONNECTED=0`, `UNCONNECTED=1`, `UNPAIRED=2` (bidirectional numeric↔string map).
- **`PhoneKeyConnectionState`** (Module B, `PutById` registering the enum at `HASM:1525401`): richer UI enum —
  | Member | Numeric | Source |
  |---|---|---|
  | `UNKNOWN` | 0 | HASM:1525380 |
  | `CONNECTED` | 1 | HASM:1525383 |
  | `DISCONNECTED` | 2 | HASM:1525386 |
  | `CONNECTING` | 3 | HASM:1525390 |
  | `BLUETOOTH_DISABLED` | 4 | HASM:1525394 |
  | `QR_AUTHORIZED` | 5 | HASM:1525398 |
- **`PhoneKeyBondingState`** (registered `HASM:1525378`): `UNSUPPORTED=0`, `BONDING_CAPABLE=1`, `BONDED=2`.
- **VCSEC `BLEPresence`** (registered `HASM:904755`): `BLE_PRESENCE_NOT_PRESENT=0`, `BLE_PRESENCE_PRESENT=1`, `BLE_PRESENCE_CONNECTED_NOT_PRESENT=2`.
- **VCSEC `KeyLocationStatus_E`** (registered `HASM:904746`): `KEY_LOCATION_UNKNOWN=0`, `KEY_LOCATION_NOT_PRESENT=1`, `KEY_LOCATION_PRESENT=2`.

### C1f. `VehicleDataQuality` — data freshness classification
Registered at `HASM:1525346` (`PutById … 'VehicleDataQuality'`).

| Member | Value | Source |
|---|---|---|
| `LIVE` | `'LIVE'` | HASM:1525337 |
| `CACHED_RELIABLE` | `'CACHED_RELIABLE'` | HASM:1525339 |
| `CACHED_UNRELIABLE` | `'CACHED_UNRELIABLE'` | HASM:1525341 |
| `UNABLE_TO_FETCH` | `'UNABLE_TO_FETCH'` | HASM:1525343 |
| `NO_DATA` | `'NO_DATA'` | HASM:1525345 |

### C1g. `VehicleWakeReason` — why the app pokes the car (incl. tap-to-wake)
Registered at `HASM:1525364`. Members → raw value:
`PULL_DOWN_REFRESH`='pull_down_refresh', `TAP_STATUS_TEXT`='tap_status_text', `TAP_VEHICLE`='tap_vehicle', `APP_FOREGROUND`='app_foreground', `SCREEN_REQUIRES_WAKE`='screen_requires_wake', `USER_SENT_COMMAND`='user_initiated_command', `VEHICLE_DATA_POLLING`='vehicle_data_polling', `VEHICLE_OFFLINE_NO_DATA`='vehicle_offline_no_data' (`HASM:1525349`–`1525363`, e.g. `tap_status_text` at HASM:1525351, `vehicle_offline_no_data` at HASM:1525362). **`TAP_STATUS_TEXT` confirms that tapping the status line wakes the car.**

---

## C2. UI: how state → on-screen text (the `VehicleStatusText` header)

**Component:** `VehicleStatusText` — Hermes function **#117231**, header `HASM:5218968` (4179 bytes). This renders the status line under/near the car name on the vehicle home screen.

**Rendering shape** (`HASM:5219590`–`5219700`): a `View` containing an optional **`BusyIcon`** (spinner, `string_id 8529` at `HASM:5219661`) followed by a `Text` element whose `automationID` = `'vehicle_home_header_status_text'` (`HASM:5219688`) and style `headerStatusText` (`HASM:5219692`). So the header is **[spinner?] + status text**.

**State → i18n key mapping inside `VehicleStatusText`** (each `tr('<key>')` call):

| Condition (state) | i18n key rendered | HASM line | English in bundle? |
|---|---|---|---|
| Vehicle parked / default | `vehicle_home_parked_state` | 5219308, 5219569 | **[i18n KEY — not in bundle]** |
| `ConnectionState.LOW_POWER` | `vehicle_home_low_power_mode` | 5219319 | **[i18n KEY — not in bundle]** |
| COS / comms error | `cos_error_status` | 5219307 (id 42203) | **[i18n KEY — not in bundle]** |
| Service mode | `vehicle_home_service_mode` | 5219531 | **XML:2765 = "Service Mode"** |
| `IN_SERVICE_MODE` (in service) | `vehicle_home_in_service_status` | 5219543 | **[i18n KEY — not in bundle]** |
| `IN_SERVICE_MODE` (out of service) | `vehicle_home_out_of_service_status` | 5219546 | **[i18n KEY — not in bundle]** |
| `MOBILE_ACCESS_DISABLED` | `vehicle_home_mobile_access_status` | 5219558 | **[i18n KEY — not in bundle]** |
| App upgrade required | `vehicle_home_upgrade_app_warning` | 5219516 | **[i18n KEY — not in bundle]** |
| Powershare active | `powershare_state_initializing` / `powershare_state_handshaking` | 5219474 / 5219486 | **[i18n KEY — not in bundle]** |
| **Fallback: status text is null → connecting** | **`connecting_label`** | **5219499 (`JNotEqual` null-guard just before)** | **[i18n KEY — not in bundle]** |

**Key point on "Connecting…":** the app does **not** have a dedicated `ConnectivityStatus.CONNECTING` branch. Instead, `connecting_label` is the **null-fallback** — when no other status text resolved (i.e. reachability not yet determined), it shows `tr('connecting_label')` (`HASM:5219499`) together with the `BusyIcon` spinner (`HASM:5219661`). So "connecting" is a UI-derived state, not a stored enum value.

**Status row variant** (a second component, `HASM:8759817`+): renders `statusIcon` (id 61792), `statusMessage` (id 58030), `statusCaption` (id 45801), and `onStatusPress` (id 10417). This confirms the status line is a tappable row with an **icon + message + caption**. `onStatusPress` is Hermes function **#117253** (created at `HASM:5220768`), wired as the press handler; tapping issues a wake (`VehicleWakeReason.TAP_STATUS_TEXT`).

### Expected-label reconciliation (requested)
| Assumed label | Reality found in bundle |
|---|---|
| "Waiting for car" | **Not found** as literal. Closest: `connecting_label` (i18n key, English not in bundle) shown with spinner as the connect/undetermined fallback. Also BLE log-only string `'found vehicle, waiting for connecting'` (HASM:10237109) — internal log, not UI. |
| "Connecting…" | i18n key `connecting_label` (HASM:5219499). Native equivalents WITH English: `phone_key_status_connecting` = **"Connecting"** (XML:1307); widget `vehicle_widget_command_execution_executing` = **"Connecting..."** (XML:2767). |
| "Offline" | Reachability handled via `ConnectivityStatus.OFFLINE` + i18n keys `vehicle_offline` / `vehicle_offline_no_data` (HASM:4476261, 1525362). English NOT in bundle. Native network string: `shared.error.network_offline_title` = **"Network is offline"** (XML:1773). |
| "Asleep" | Freshness key `vehicle_status_screen_asleep_age` (HASM:1440296). English NOT in bundle. VCSEC proto member `VEHICLE_SLEEP_STATUS_ASLEEP`. |
| "Vehicle unavailable" | i18n key `vehicle_unavailable` (HASM:4476265). English NOT in bundle. |

**Icon/indicator:** the only status-adjacent icon confirmed is **`BusyIcon`** (an animated spinner) shown during the connecting/undetermined fallback (`HASM:5219661`). A generic `statusIcon` prop exists (`HASM:8759817`) but its per-state asset names were not resolved. Color usage in the component: `Colors.powerRed` (`HASM:5219478`) for powershare-stop, plus `warning`/`white`/`transparentWhite90` tokens — **no dedicated offline/asleep color name was directly readable** → INFERRED that offline/asleep reuse the muted/secondary text style; NOT confirmed.

---

## C3. BLE / phone-key vs network / cloud distinction in the UI

There **are two independent indicators**:

1. **Cloud/network reachability** → `ConnectivityStatus` (Online/Offline/Mobile-Access-Disabled/In-Service/Signed-Commands) rendered by `VehicleStatusText` (C2). The transport that produced the data is tagged by `ConnectivityType` = `oapi`/`hermes`/`ble` (`HASM:1474658`–`1474662`) but this tag is **not** surfaced as separate UI text (INFERRED: internal only).

2. **BLE phone-key connection** → `PhoneKeyConnectionState` (UNKNOWN/CONNECTED/DISCONNECTED/CONNECTING/BLUETOOTH_DISABLED/QR_AUTHORIZED, C1e), surfaced via `phone_key_status_*` labels. **These have real English text in the native resources:**

| Key | English (XML) | Line |
|---|---|---|
| `phone_key_status_connected` | "Connected" | XML:1306 |
| `phone_key_status_connecting` | "Connecting" | XML:1307 |
| `phone_key_status_disconnected` | "Disconnected" | XML:1308 |
| `phone_key_status_bluetooth_disabled` | "Enable Bluetooth to use your phone as a key" | XML:1305 |
| `phone_key_status_needs_permissions` | "Phone key not recognized. Tap to set up." | XML:1309 |
| `phone_key_status_not_paired` | "Set up your phone as a key" | XML:1310 |
| `phone_key_notification_bluetooth_disabled_title` | "Bluetooth Disabled" | XML:1301 |

Additional RN i18n phone-key keys exist WITHOUT English in the bundle: `phone_key_status_bluetooth_denied`, `phone_key_status_camera_access_disabled`, `phone_key_status_device_connection_permission_denied`, `phone_key_status_nearby_devices_denied`, `phone_key_connected`, `phone_key_connecting`, `phone_key_disconnected` (STR:132416–132524). **[i18n KEY — English not in bundle]**

**BLE connection sub-states (log-level, from the FindVehicle/connect saga):** `'found vehicle, waiting for connecting'` (HASM:10237109), then `Actions.waitForConnecting()` (HASM:10237... `waitForConnecting` id 511484), `'connectionState changed to connecting on the connection with '`, `'connection timeout, connecting == false'` (HASM:4378106 region), `'peripheral already connected!'` (HASM:10237). Failure reasons include `authorized_not_paired` → `phoneKeyPairingFailure` (HASM:10237... ). These are internal logs, not UI text, but map the BLE connect lifecycle: *scan → found → waiting-for-connecting → connected / timeout*.

**Conclusion:** Yes — phone-key/BLE status is a **separate** indicator from cloud reachability, has its own enum (`PhoneKeyConnectionState`) and its own labels (mostly native, English present). It appears in phone-key settings and the home-screen widget (`vehicle_widget_*`, XML:2766–2782), not fused into the main `ConnectivityStatus` line.

---

## C4. State machine — transitions & timers

### C4a. Polling cadence (data-refresh timers) — **exact numeric constants**
`TimeInMs` table: `ONE_SECOND=1000`, `FIVE_SECONDS=5000` (`HASM:1474391`, full table there).

| Constant | Value | Derivation | Source |
|---|---|---|---|
| `VEHICLE_DATA_POLLING_INTERVAL_ONLINE` | **5000 ms (5 s)** | `TimeInMs.FIVE_SECONDS` | HASM:1474572 (`FIVE_SECONDS`) → PutById HASM:1474573 |
| `VEHICLE_DATA_POLLING_INTERVAL_OFFLINE` | **1200 ms (1.2 s)** | `TimeInMs.ONE_SECOND × 1.2` | HASM:1474578 (`LoadConstDouble 1.2`) → PutById HASM:1474580 |
| `ENERGY_PAIRED_VEHICLE_POLLING_INTERVAL` | **4000 ms (4 s)** | `TimeInMs.ONE_SECOND × 4` | HASM:1474585 (`×4`) → PutById HASM:1474587 |

Interpretation: when the car is **online**, the app re-fetches vehicle_data every **5 s**; when it believes the car is **offline/asleep it polls FASTER, every 1.2 s** (aggressively probing for wake / reconnection).

### C4b. Streaming (WebRTC/live) reconnect timers
Live-streaming connection is managed by **`WebRtcProvider`** (fn #98456, `HASM:4377418`). Relevant timers:
- **`scheduleReconnectTimer`** (fn #98461, `HASM:4378055`): `setTimeout(cb, delay)` where `delay` is **passed in as an argument** (`HASM:4378101`–`4378110`) — value is dynamic, not a literal here. On fire, the callback (fn #98462) logs `'connection timeout, connecting == false'`, sets `SummonUnableToConnectReason.CONNECTION_TIMEOUT`, and logs `'reconnectWebrtc timeout'` / `'reconnect timer elapsed'` (`HASM:4378106`–`4378130`).
- **`scheduleDelayedReconnect`** (fn #98482, `HASM:1525…` / body `HASM:` around `scheduleDelayedReconnect`): uses a fixed **`setTimeout(cb, 1000)` = 1000 ms tick** (`LoadConstInt Imm32:1000`, HASM near `0362c18b`), decrementing a countdown (`current -= elapsed`) each tick. INFERRED: this is a 1-second retry cadence for the streaming peer.
- `reconnectWebRtc` (fn #98464), `scheduleReconnectTimer`, `scheduleDelayedReconnect`, `stopLocationPollingTimer`, `startLocationPollingTimer` all created together in `WebRtcProvider` (`HASM:4377789`–`4377808`).

### C4c. "Connecting…" → "Offline" transition
No single literal timeout constant governs the header flip. Mechanically: `VehicleStatusText` shows `connecting_label`+spinner while reachability is **null/undetermined**; once the poll/socket resolves the VIN to `ConnectivityStatus.OFFLINE` (or a `socketGoodbyeReason` of `vehicle_offline`/`vehicle_unavailable`, see C4d) the header switches to the offline text. The bounding timer is therefore the streaming `CONNECTION_TIMEOUT` (dynamic, C4b) and/or the 5 s/1.2 s poll cadence (C4a). **Exact "N seconds of Connecting before Offline" is NOT a single readable constant → INFERRED it is data-driven by socket/poll response, not a fixed timer.**

### C4d. Socket "goodbye" reason mapping (streaming disconnect)
`socketGoodbyeReason` (fn #99991, header `HASM:4476256`): maps incoming streaming close reason strings →
- `'vehicle_offline'` (input, HASM:4476261) → `SummonUnableToConnectReason.SOCKET_VEHICLE_OFFLINE` (HASM:4476305)
- `'vehicle_unavailable'` (input, HASM:4476265) → `SummonUnableToConnectReason.SOCKET_VEHICLE_UNAVAILABLE` (HASM:4476285)
- `'vehicle_already_connected'` → `VEHICLE_ALREADY_CONNECTED` (HASM:4476295)
- default → `UNKNOWN`

Note `SOCKET_VEHICLE_OFFLINE` / `SOCKET_VEHICLE_UNAVAILABLE` also enumerated at STR:43178–43179; error mapping also in `SummonErrorTypeForErrorString` (fn #125276, HASM:5803762) which additionally recognizes `wake_up_timeout`, `not_started_timeout`, `vehicle_disconnected`, etc.

---

## C5. Freshness / "last updated / as of" display — **exact format**

**Component:** `vehicleDataLastUpdatedString` — Hermes function **#30315**, header `HASM:1440253` (349 bytes). It computes the sub-caption shown under the status. Body spans `HASM:1440256`–`1440345`. Logic:

1. Computes `age` from a timestamp using **`Math.min(timestamp, Date.now())`** (`Math.min` at `HASM:1440273`, `Date.now` at `HASM:1440275`) then **moment `.fromNow()`** (relative time — `'fromNow'` calls at `HASM:1440292` and `HASM:1440327`). → format is **relative**, e.g. "2 minutes ago" style, NOT absolute.
2. **Asleep branch:** `age = ts.fromNow(true)` (the `true` = *suffixless* relative, e.g. "2 minutes"), then `tr('vehicle_status_screen_asleep_age', {age})` (`HASM:1440296`). Optionally appends `' • ' + tr('sentry_mode_enabled_low_power')` when sentry/low-power (`' • '` literal at `HASM:1440316`).
3. **Offline / last-seen branch:** `age = ts.fromNow()` (*with* "ago" suffix), then `tr('vehicle_status_screen_last_seen_age', {age})` (`HASM:1440330`).
4. **Online / no-age branch:** returns `tr('connecting_label')` (`HASM:1440339`).

| Freshness state | i18n key (takes `{age}`) | age format | HASM |
|---|---|---|---|
| Asleep | `vehicle_status_screen_asleep_age` | `moment.fromNow(true)` — no "ago" suffix | 1440296 |
| Offline / last seen | `vehicle_status_screen_last_seen_age` | `moment.fromNow()` — includes "ago" | 1440330 |
| Online/connecting | `connecting_label` | (spinner) | 1440339 |

All three are **[i18n KEY — English NOT in bundle]** (the `{age}` value itself is a localized relative-time string from moment.js). The template English (e.g. "Last seen {age}") is not in the bundle.

**Underlying quality signal:** `VehicleDataQuality` (C1f) classifies the cached vs live state (`LIVE`, `CACHED_RELIABLE`, `CACHED_UNRELIABLE`, `UNABLE_TO_FETCH`, `NO_DATA`). Related selectors: `getIsUsingStaticVehicleData` (STR:101480), `isUsingStaticVehicleData` (STR:117584), `isStale` (STR:117283). So the app distinguishes *live* from *stale/cached* data and drives the "last seen" caption accordingly.

**Refresh cadence for the freshness caption:** governed by the poll intervals in C4a (5 s online / 1.2 s offline). Widget-side equivalent: `vehicle_widget_updated_time` = **"%s ago"** (XML:2782) — the only literal freshness format string with English present, confirming the **relative "<age> ago"** format.

---

## C6. Trigger / capability summary per state (best-effort)

| State (source enum) | Header text key | Spinner? | User can do | Trigger |
|---|---|---|---|---|
| Online (`ConnectivityStatus.ONLINE` / `ConnectionState.ONLINE`) | parked/charging status keys | No | Full controls | Poll/socket reports online |
| Connecting / undetermined | `connecting_label` | **Yes (`BusyIcon`)** | Tap status text to force wake (`TAP_STATUS_TEXT`) | Reachability null before resolve |
| Waking (`ConnectionState.WAKING`) | (no dedicated header branch found) | INFERRED spinner | Wait | Wake in progress |
| Low power (`ConnectionState.LOW_POWER`) | `vehicle_home_low_power_mode` | No | Tap → `setIsShowingLowPowerMode` info (HASM:5220790) | Car in low-power |
| Asleep (`ConnectionState.ASLEEP` / VCSEC `..._ASLEEP`) | caption `vehicle_status_screen_asleep_age` | No | Tap to wake; controls wake car first | Car asleep; last data timestamped |
| Offline (`ConnectivityStatus.OFFLINE` / `ConnectionState.OFFLINE`) | `vehicle_offline` / caption `vehicle_status_screen_last_seen_age` | No | Retry / tap to wake; controls unavailable | Poll/socket offline or `socketGoodbyeReason='vehicle_offline'` |
| Vehicle unavailable | `vehicle_unavailable` | No | Retry | `socketGoodbyeReason='vehicle_unavailable'` |
| Mobile access disabled (`ConnectivityStatus.MOBILE_ACCESS_DISABLED`) | `vehicle_home_mobile_access_status` | No | Enable in car settings | Owner disabled mobile access |
| In service (`ConnectivityStatus.IN_SERVICE_MODE`) | `vehicle_home_in_service_status` / `..._out_of_service_status` / `vehicle_home_service_mode`="Service Mode" | No | Limited | Car in service mode |
| BLE key connecting/connected/disconnected (`PhoneKeyConnectionState`) | `phone_key_status_*` (native English present) | No | Set up / troubleshoot key | BLE proximity/pairing |

---

## C7. Open gaps / not-directly-readable (flagged honestly)
- **Per-state icon asset names** for the generic `statusIcon` (offline/asleep/online glyphs) were not resolved — only `BusyIcon` (spinner) is confirmed. → gap.
- **Per-state text colors** (e.g. a red "Offline") not confirmed by name. → INFERRED only.
- **English text** for every RN i18n key (`vehicle_offline`, `vehicle_unavailable`, `connecting_label`, `vehicle_home_*`, `vehicle_status_screen_*_age`) is **absent from the APK** (translations are fetched/loaded at runtime, not bundled in `strings.xml`; only ~6 native phone-key/widget strings carry English). Reported as keys.
- **Exact "Connecting→Offline" wall-clock timeout** is not a single literal; it is response-driven (socket goodbye / poll). The nearest fixed numbers are the poll intervals (5000/1200 ms) and the dynamic streaming `CONNECTION_TIMEOUT`.
- `startLocationPollingTimer` (fn #98458) is a 4-byte stub in this build → no location-poll interval literal readable.
