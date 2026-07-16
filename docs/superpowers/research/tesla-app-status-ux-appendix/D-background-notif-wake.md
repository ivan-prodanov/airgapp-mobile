# Section D — Backgrounding, Command Notifications, Asleep/Wake, Polling Cadence

Tesla Android app `com.teslamotors.tesla` v4.58.0 (build 4392). React-Native / Hermes bytecode + native Android (Kotlin/WorkManager).

**Source legend**
- `strings.xml` = `base_apktool/res/values/strings.xml` (line numbers)
- `manifest` = `base_apktool/AndroidManifest.xml` (line numbers)
- `hasm:N` = `~/Work/tesla-summon/work/bundle.hasm` (line number in disassembly)
- `dexN` = `base_apktool/classesN.dex` (class / string token, referenced by name)
- **INFERRED** marks any interpretation not directly stated by a literal/opcode. Facts are exact from the cited source.

---

## D0. TL;DR

| Question | Answer | Primary evidence |
|---|---|---|
| Does an in-flight command survive backgrounding? | **Yes** — commands run in a native WorkManager worker (`ExecuteCommandWorker` / `CommandCenterBackgroundTasker$OnGoingCommandWorker`) that is independent of the RN foreground, shows an ongoing "Vehicle Service" notification, and posts a failure notification if it can't finish. | dex7, manifest:565 |
| Command failure notification | title **"Unable to Complete Command"**, body **"Open the Tesla App to complete your request."** | strings.xml:198,197 |
| Success notifications? | No generic push success. Widget command path shows a **"Sent"** terminal state; general command flow only surfaces **failure** notifications. | strings.xml:2769 |
| Asleep detection | `ConnectionState` enum field; `isVehicleOffline()` true for `OFFLINE / ASLEEP / DEEP_SLEEP / HIBERNATING / SHUTDOWN`. | hasm:1509034 (fn `isVehicleOffline` #30689) |
| Auto-wake? | **Automatic**, no user prompt. App dispatches `Actions.vehicleWakeUp(vin, reason)` for reasons incl. sending a command, app foreground, polling, and offline-no-data. | hasm:1496007, 1525324 |
| Vehicle-data poll cadence | **online = 5000 ms**, **offline/waking = 1200 ms** | hasm:1474573-1474580 + 1474391 |

---

## D1. Backgrounding behaviour (command in flight → app backgrounded)

### D1.1 Mechanism: native WorkManager command workers (commands DO continue)

Vehicle commands are dispatched to a **native Android module** (`CommandCenterNativeModule.sendCommand`, dex7) that schedules a **WorkManager** job. This runs in the app process independently of whether the RN UI is foregrounded, which is what lets a command complete after the app is backgrounded.

Native classes (dex7 / dex8):

| Class | Role | Evidence |
|---|---|---|
| `com.tesla.command.CommandCenterBackgroundTasker` (`.kt`) | Orchestrates background command execution; starts/kills the on-going command worker; updates the ongoing notification | dex7 `CommandCenterBackgroundTasker.kt`, `"Starting on-going command worker... "`, `"Killing on-going command worker..."`, `"Updating on-going commands notification..."` |
| `com.tesla.command.CommandCenterBackgroundTasker$OnGoingCommandWorker` | `androidx.work.CoroutineWorker` executing the command | dex7 `...$OnGoingCommandWorker`, `Landroidx/work/CoroutineWorker;` |
| `com.tesla.command.ExecuteCommandWorker` (`.kt`) | WorkManager worker that executes a queued command; `doWork$request$1` builds the request | dex7 `Lcom/tesla/command/ExecuteCommandWorker;`, `"Failed to schedule execute command worker"` |
| `com.tesla.command.CommandRequestBroadcastReceiver` | Receives command-request broadcasts (e.g. from notification action buttons) | manifest:336, dex7 |
| `com.tesla.command.CommandNotificationActionIntentFactory` | Builds the PendingIntents for notification action buttons | dex7 |
| `com.tesla.widget.worker.WidgetCommandExecutionWorker` | WorkManager worker for **home-screen-widget** commands | dex8 |
| `com.tesla.widget.WidgetCommandReceiver` | Receives widget command taps | manifest:363, dex8 |

Supporting manifest declarations:
- `androidx.work.impl.background.systemjob.SystemJobService` (JobScheduler backing for WorkManager) — manifest:565
- `androidx.work.multiprocess.RemoteWorkManagerService` — manifest:564
- Permissions: `FOREGROUND_SERVICE` (manifest:23), `FOREGROUND_SERVICE_CONNECTED_DEVICE` (manifest:24), `WAKE_LOCK` (manifest:7), `POST_NOTIFICATIONS` (manifest:26), `RECEIVE_BOOT_COMPLETED` (manifest:25), `REQUEST_IGNORE_BATTERY_OPTIMIZATIONS` (manifest:194).

### D1.2 Expedited job + ongoing notification

The widget command worker requests an **expedited** WorkManager job and falls back if out of quota:
- dex8 token `RUN_AS_NON_EXPEDITED_WORK_REQUEST` (expedited→non-expedited fallback)
- Ongoing notification is posted on the **`VEHICLE_SERVICE`** channel = user-visible name **"Vehicle Service"** (dex8 `VEHICLE_SERVICE`, `channelId`, `createNotificationChannel`; strings.xml:1261 `notification_channel_vehicle_service_name = "Vehicle Service"`). **INFERRED:** the on-going *command* notification (title "Connecting", §D2) is posted on this same "Vehicle Service" channel; the channel token `VEHICLE_SERVICE` and the command-worker code co-locate in dex8, but a direct opcode tying the exact channel-id constant to the command notification was not isolated.

The BLE (Phone Key) command transport separately runs as a **foreground service**:
- `com.teslamotors.plugins.ble.BLEService` — `foregroundServiceType="connectedDevice"`, `process=":svc"` (manifest:279). BLE commands (`error: Command can only be sent over BLE.`, dex8) execute in this always-alive service.

### D1.3 Command timeouts (background task ends / fails)

| Constant | Value | Context | Evidence |
|---|---|---|---|
| `CommandTimeoutThresholdMs` | **10000 ms (10 s)** | Summon control utilities module (sits with `SUMMON_MIN_LOCATION_ACCURACY`, "Summon Control" logger) — a **Summon** command timeout, not necessarily the generic OAPI command timeout | hasm:5800056 `LoadConstInt Imm32: 10000` → PutById `CommandTimeoutThresholdMs` |
| `signedCommandTimeout` | value taken from an env var (not an inline literal) — races `checkSignedCommands` validation against a `delay(timeout)` | RN signed-command flow | hasm:10236951-10236958 |
| `HERMES_COMMAND_TIMEOUT` | **Not a number** — an error-reason label `"Hermes - Command Timeout"` (member of `SummonUnableToConnectReason`) | hasm:3093695 |
| native tasker config fields | logged fields `timeoutMins=`, `maxTimeout=`, `connection_timeout=`, `TRIGGER_NETWORK_EVALUATION_TIMEOUT_MS`, `READ_TIMEOUT` | numeric values are in bytecode, not in the dex string table, so not recovered | dex7 |

Native tasker also logs: `"canceling request as result timeout."`, `"Timeout expiry reached for the transaction"`, `"Showing failure notification for "`, `"notifying listener command result: "`, `"command result was null, doing nothing more"` (dex7) — i.e. on timeout it cancels, then shows the failure notification (§D2).

### D1.4 RN app-state handling & pending/spinner state across background→foreground

- Redux slices exist for lifecycle: `backgroundService` reducer slice (hasm:1516531) and `vehicleDataLoop` slice (hasm:1516... same reducer map).
- **On inactive (backgrounded / user idle):** `userBecameInactiveListener` (fn #98639, hasm:4386152) logs `"[UserActivity] User inactive, cancelling vehicle data polling"` and dispatches **`Actions.cancelAllDataRequests()`** → all in-flight *data* (status) requests are cancelled. Event types `USER_BECAME_ACTIVE='userBecameActive'` / `USER_BECAME_INACTIVE='userBecameInactive'` (hasm:4385352-4385360).
- **On foreground/active:** the app re-wakes and re-queries — `VehicleWakeReason.APP_FOREGROUND='app_foreground'` triggers a wake (hasm:1525355; §D3), and polling restarts. `lastAppStateActive` tracks the transition (hasm:3641421). `summonAnalyticsOnAppStateChange` (hasm:379022) handles Summon-specific app-state transitions.
- **INFERRED:** the command *spinner*/pending UI is Redux-`CommandStatus`-driven (`CommandStatus` enum, hasm:895189; `clearCommandstatus`/`setCommandstatus`); because the native worker owns command execution and the RN status requests are cancelled on background then re-queried on foreground, the UI spinner is re-derived from freshly polled `CommandStatus` on resume rather than persisted across the background gap.
- Note: the RN symbols `activateBackgroundTask` / `deactivateBackgroundTask` / `backgroundTaskExpired` (hasm:2800522) belong to the **`Compressor`** (react-native media-compression) module, **not** to vehicle commands — do not attribute command backgrounding to these.

---

## D2. Command-related local-notification catalogue

### D2.1 Command execution / failure notifications

| Key | Exact title | Exact body | When posted | Channel (INFERRED unless noted) |
|---|---|---|---|---|
| `background_task_failed_default_*` | **Unable to Complete Command** (strings.xml:198) | **Open the Tesla App to complete your request.** (strings.xml:197) | Native background command worker fails / times out and cannot finish the request | Vehicle Service |
| `push_notif_command_failed_*` | **Failed** (strings.xml:1474) | **Something went wrong. Tap to open the app to retry** (strings.xml:1473) | Push/command failure, tap re-opens app to retry | Vehicle |
| `vehicle_widget_command_notification_title` | **Connecting** (strings.xml:2770) | (title only) | Home-screen widget command in progress (ongoing worker notification) | Vehicle Service (`VEHICLE_SERVICE`, dex8) |
| `vehicle_widget_command_execution_executing` | **Connecting...** (strings.xml:2767) | — | Widget command in-progress state text | (widget UI/notif) |
| `vehicle_widget_command_execution_success` | **Sent** (strings.xml:2769) | — | Widget command succeeded (terminal success state) | (widget UI/notif) |
| `vehicle_widget_command_execution_failed` | **Failed** (strings.xml:2768) | — | Widget command failed | (widget UI/notif) |
| `command_error_command_failed` | **%command% failed** (strings.xml:417) | — | In-app command error banner (`%command%` = localized command name, strings.xml:418-448) | in-app (not a system notification) |

**Success vs failure:** There is **no generic command "success" push notification**. The only affirmative success surface is the widget's terminal **"Sent"** state. All other command outcomes surface as **failure** notifications (the two failure variants above).

### D2.2 Command action buttons (interactive notification actions)

Buttons rendered on vehicle/command notifications (dispatched via `CommandRequestBroadcastReceiver`, dex7 `NOTIFICATION_ACTION_*`):

| Key | Label | | Key | Label |
|---|---|---|---|---|
| `push_notif_action_lock` (1463) | Lock | | `push_notif_action_stop_charging` (1466) | Stop Charging |
| `notification_unlock_button` (1268) | Unlock | | `push_notif_action_turn_climate_on/off` (1468/1467) | Turn Climate On / Off |
| `notification_front_trunk_button` (1264) | Front Trunk | | `push_notif_action_turn_sentry_off` (1470) | Turn Sentry Off |
| `notification_rear_trunk_button` (1266) | Rear Trunk | | `push_notif_action_close_windows` (1460) | Close Windows |
| `notification_rear_tailgate_button` (1266) | Tailgate | | `push_notif_action_close_front/rear_trunk` (1456/1457) | Close Front/Rear Trunk |
| `push_notif_action_close_sunroof` (1458) | Close Sunroof | | `push_notif_action_close_tonneau` (1459) | Close Tonneau |
| `push_notif_action_camp_mode_on` (1453) | Turn Camp Mode On | | `push_notif_action_pet_mode_on` (1464) | Turn Pet Mode On |
| `push_notif_action_update` (1471) | Update | | `push_notif_action_cancel_update` (1455) | Cancel Update |

Native action IDs (dex7): `NOTIFICATION_ACTION_STOP_CHARGING / START_CHARGING / ENABLE_SENTRY / DISABLE_SENTRY / CLOSE_ALL_DOORS / CLOSE_ALL_WINDOWS / CLOSE_FRONT_TRUNK / CLOSE_REAR_TRUNK / CLOSE_SUNROOF / CLOSE_TONNEAU / CLIMATE_ON_OVERRIDE / CLIMATE_KEEPER_DOG_MODE / CLIMATE_KEEPER_CAMP_MODE / CANCEL_SOFTWARE / UPDATE_SOFTWARE / CLOSE_{FRONT,REAR}_{DRIVER,…}_DOOR / …`.

### D2.3 Notification channels (all vehicle-relevant)

| Channel key | User-visible name | strings.xml |
|---|---|---|
| `notification_channel_vehicle_service_name` | **Vehicle Service** (command worker / ongoing) | 1261 |
| `notification_channel_vehicle_name` | Vehicle | 1260 |
| `notification_channel_phone_service_name` | Phone Key Status | 1258 |
| `charging_notif_channel_name` | Charging Status | 267 |
| `closure_notif_channel_name` | Closure Suggestions | 399 |
| `notification_channel_account_information_name` | Account | 1253 |
| `notification_channel_default_name` | Notifications | 1255 |
| `notification_channel_inbox_name` | Inbox | 1256 |
| `notification_channel_subscription_name` | Subscription | 1259 |

### D2.4 Adjacent vehicle notifications (not command-triggered, for completeness)

- **Charging live-activity** (`charging_notif_*`, strings.xml:266-299): titles "Charging" / "Charging Complete" / "Charging Stopped" / "Charging Error"; bodies for charge %, rate, ETA, idle-fee warnings, stale-data. Channel "Charging Status".
- **Closure suggestions** (`closure_notif_*`, 398-403): frunk/trunk "Tap to open" / "Tap to close". Channel "Closure Suggestions".
- **Child-presence detection** (`phone_key_notification_cpd_*`, 1302-1303): title "Child detected in car", body "Return to your vehicle immediately." (dex7 `CPD_NOTIFICATION_INITIAL_WARNING`).
- **Phone Key** (`phone_key_notification_*`, 1297-1304): "Phone Key", "Bluetooth Disabled", "Phone Key Disabled".
- **Supercharger queue** (`supercharger_queue_join_notification_*`, 2736-2737): "Join Waitlist to Charge".

---

## D3. Asleep detection + auto-wake

### D3.1 How "asleep" is detected

Detection is via the vehicle's **`ConnectionState`** enum (RN `getVehicleConnectionState`, hasm:7595 region). Two helpers classify it:

- **`isVehicleOffline()`** (fn #30689, hasm:1509034) returns `true` when `ConnectionState ∈ { OFFLINE, ASLEEP, DEEP_SLEEP, HIBERNATING, SHUTDOWN }`.
- **`isVehicleOnline()`** (fn #30688, hasm:1508984) returns `true` when `ConnectionState ∈ { ONLINE, WAKING, LOW_POWER }`; `false` for `{ UNKNOWN, UNDETERMINED, ASLEEP, HIBERNATING, DEEP_SLEEP, SHUTDOWN, OFFLINE }`.

So the "asleep" states are **`ASLEEP`, `DEEP_SLEEP`, `HIBERNATING`** (full `ConnectionState`: `ONLINE, WAKING, LOW_POWER, ASLEEP, DEEP_SLEEP, HIBERNATING, SHUTDOWN, OFFLINE, UNKNOWN, UNDETERMINED`). `WAKING` is the in-transition "waking up" state and is treated as online-ish.

Related: `VehicleSleepStatus_E` = `proto.VCSEC.VehicleSleepStatus_E` (hasm:904734) — the VCSEC/BLE-side sleep status. `isVehicleDataUploadedOnSleep()` (fn #30690, hasm:1509…) keys off upload reasons `['going_to_sleep','sleep_ice','sleep']`. Data-quality on wake: `VehicleDataQuality` = `{ LIVE, CACHED_RELIABLE, CACHED_UNRELIABLE, UNABLE_TO_FETCH, NO_DATA }` (hasm:1525…).

### D3.2 Auto-wake (no user prompt) — `VEHICLE_WAKE_UP`

The app **auto-wakes**; it dispatches the wake action itself rather than asking the user. Concrete trigger found: in the vehicle-data fetch handler, when `VEHICLE_DATA` returns null/offline it runs
`store.dispatch(Actions.vehicleWakeUp(vin, VehicleWakeReason.VEHICLE_OFFLINE_NO_DATA))` (hasm:1496007-1496011, `vehicleWakeUp` id 14039 + `VehicleWakeReason.VEHICLE_OFFLINE_NO_DATA` id 11747).

**Redux actions / endpoint:**
- `VEHICLE_WAKE_UP` / `VEHICLE/VEHICLE_WAKE_UP` (hasm:51393, 51781)
- Wake tracker: `VEHICLE/UPDATE_VEHICLE_WAKE_TRACKER`, `VEHICLE/RESET_VEHICLE_WAKE_TRACKER` (hasm:51289, 51324); reducer state slice `wakeUpWindow` → `wakeTrackingMap` (fn `getWakeTrackerMap`, hasm:1508984; `getVehicleWakeTracker` → `DefaultWakeTracking`, hasm:1509009). **`wakeUpWindow` is a Redux state slice, NOT a numeric timeout.**
- OAPI endpoint: `api/1/vehicles/{vehicle_id}/wake_up` (hasm:65335).

**`VehicleWakeReason` enum** (full, hasm:1525324-1525364) — every reason the app initiates a wake:

| Member | String value | Trigger |
|---|---|---|
| `PULL_DOWN_REFRESH` | `pull_down_refresh` | user pull-to-refresh |
| `TAP_STATUS_TEXT` | `tap_status_text` | user taps status text |
| `TAP_VEHICLE` | `tap_vehicle` | user taps vehicle |
| `APP_FOREGROUND` | `app_foreground` | **app returns to foreground** |
| `SCREEN_REQUIRES_WAKE` | `screen_requires_wake` | opening a screen that needs live data |
| `USER_SENT_COMMAND` | `user_initiated_command` | **user sends a command** |
| `VEHICLE_DATA_POLLING` | `vehicle_data_polling` | data-polling loop |
| `VEHICLE_OFFLINE_NO_DATA` | `vehicle_offline_no_data` | fetch returned offline/no data |

Interpretation: reasons `TAP_*` / `PULL_DOWN_REFRESH` are user-gesture-initiated but still auto-fire the wake without a confirmation dialog; `APP_FOREGROUND`, `SCREEN_REQUIRES_WAKE`, `USER_SENT_COMMAND`, `VEHICLE_DATA_POLLING`, `VEHICLE_OFFLINE_NO_DATA` are fully automatic. **No "Do you want to wake the car?" prompt was found for the command/read path.**

### D3.3 "Waking up…" state text & wake timeout

- Internal state: **`ConnectionState.WAKING`** (id 29907) is the "waking up" state; while `WAKING`, `isVehicleOnline()` is `true` so the UI/polling proceed.
- User-facing English text for a "Waking up…" status label was **not present** in the bytecode string table (app ships 24 languages; localized values are loaded outside the Hermes string table — only i18n **keys** are embedded). Relevant i18n **keys** (cite these):
  - `vehicle_status_screen_asleep_age` (hasm:1440296) — "asleep for {age}" status label
  - `vehicle_status_screen_last_seen_age`
  - `vehicle_soh_warning_for_waking_up_vehicle` / `..._title` (hasm:169460-169461) — warning shown before waking the car for a State-of-Health read
  - `vehicle_soh_cannot_estimate_time_remaining_asleep`
- The nearest concrete English "in-progress" strings are the widget/command ones: **"Connecting"** / **"Connecting..."** (strings.xml:2770/2767).
- **Wake timeout:** `WAKE_UP_TIMEOUT` and `WAKING_UP_BUSES` are **Summon** state/error **reason strings** (`'wake_up_timeout'`, `'waking_up_buses'`) inside `SummonErrorType` / `SummonAutoParkStateReason` (hasm:3093638, 3093651) — **not numeric timeout constants**. No standalone numeric "wake timeout ms" constant was recovered; wake completion is instead governed by the polling loop switching the car to an online `ConnectionState` (§D4). `autopark_summon_error_wake_up_timeout` (hasm:69142) is the Summon-specific timeout error key.

---

## D4. Polling cadence (status / telemetry intervals)

### D4.1 Vehicle-data polling (primary status poll) — exact values

`TimeInMs` constant table (hasm:1474391): `HALF_SECOND=500, ONE_SECOND=1000, TWO_SECONDS=2000, THREE_SECONDS=3000, FIVE_SECONDS=5000, TEN_SECONDS=10000, THIRTY_SECONDS=30000, ONE_MINUTE=60000, …`.

| Constant | Formula | **Value** | Evidence |
|---|---|---|---|
| `VEHICLE_DATA_POLLING_INTERVAL_ONLINE` | `TimeInMs.FIVE_SECONDS` | **5000 ms (5 s)** | hasm:1474571-1474573 |
| `VEHICLE_DATA_POLLING_INTERVAL_OFFLINE` | `TimeInMs.ONE_SECOND * 1.2` | **1200 ms (1.2 s)** | hasm:1474578-1474580 (`LoadConstDouble 1.2`, `Mul`) |
| `ENERGY_PAIRED_VEHICLE_POLLING_INTERVAL` | `TimeInMs.ONE_SECOND * 4` | **4000 ms (4 s)** | hasm:1474583-1474590 |

**Selector** `getPollingInterval(type, isOffline)` (fn #59429, hasm:2745780): for `VehiclePollingType.VEHICLE_DATA` returns `OFFLINE` (1200 ms) when the 2nd arg is truthy, else `ONLINE` (5000 ms); for `VehiclePollingType.ENERGY_PAIRED_VEHICLE` returns the 4 s interval.

**Poll loop semantics** (hasm:4608160-4608 region): the data loop reads the current connection ref and picks `VEHICLE_DATA_POLLING_INTERVAL_ONLINE` (5 s) when the car is online, otherwise `VEHICLE_DATA_POLLING_INTERVAL_OFFLINE` (1.2 s), then `sleep`/`delay`s that long before the next poll. **Net behaviour: poll every 1.2 s while the car is offline/waking (to catch the wake fast), and every 5 s once online.** (Values = FACT; the online/offline branch mapping = FACT from opcodes.) If a fetch finds the car just `came online`, it **skips the delay** and polls immediately (`"[VDU] Fetched vehicle_summary when … came online, skip polling delay"`, hasm:7595019). Background/failed polls are tagged source `"Background polling"` and dispatch `Actions.vehicleDataRequestFailure` (hasm:7590942-7590948).

`VehiclePollingType` = `{ VEHICLE_DATA='VEHICLE_DATA', ENERGY_PAIRED_VEHICLE='ENERGY_PAIRED_VEHICLE' }` (hasm:1474583-1474590). There is **no separate "active/standby" variant for vehicle-data polling** — only ONLINE vs OFFLINE. Lifecycle gating: polling is **cancelled** when the user goes inactive/backgrounds (`cancelAllDataRequests`, §D1.4) and restarts on foreground.

### D4.2 Energy-site polling (Powerwall/Solar) — separate subsystem, for completeness

`VehiclePollingType`-adjacent `RefreshDataType` objects (hasm:4551939-4551992) — **cloud `refreshIntervalS` / local `localRefreshIntervalS` (seconds)**:

| Type | refreshIntervalS | localRefreshIntervalS | maxBackoffExponent |
|---|---|---|---|
| `SITE_STATE` (live data) | 4 | 2 | 6 |
| `SITE_CHARGER_STATE` | 30 | 6 | 6 |
| `SITE_SUBLOAD_STATE` | 20 | 20 | 6 |
| `SITE_SYSTEM_STATUS` | 30 | 10 | 3 |
| `SITE_BACKUP_TIME_REMAINING` | 30 | 10 | 3 |

Other energy refresh constants (hasm:4551900 region, seconds): `REFRESH_ENERGY_LIVE_DATA_SECONDS=4`, `REFRESH_ENERGY_SITE_INTERVAL_S=2`, `REFRESH_ENERGY_SITE_SYSTEM_STATUS_SECONDS=20`, `REFRESH_ENERGY_BACKUP_TIME_REMAINING_DATA_SECONDS=30`, `REFRESH_ENERGY_CHARGER_LIVE_STATUS_SECONDS=8`, `REFRESH_ENERGY_LOCAL_SUBLOAD_LIVE_STATUS_SECONDS=6`, `REFRESH_ENERGY_LOCAL_BACKUP_TIME_REMAINING_DATA_SECONDS=10`, `REFRESH_ENERGY_TELEMETRY_DATA_SECONDS=900`, `REFRESH_ENERGY_SITE_WEATHER_DATA_SECONDS=900`, `REFRESH_ENERGY_SITE_WEATHER_DATA_ERROR_SECONDS=15`. (These are **energy product** intervals, distinct from vehicle status polling.)

### D4.3 Summon location update configs (NOT status polling)

For completeness, the Summon module defines GPS `LocationUpdateConfig` "Active"/"Standby" objects with `interval / fastestInterval / maxWaitTime = 1000 ms` (hasm:5800473-5800…). These are **device GPS update rates during Summon**, unrelated to vehicle status polling — do not conflate the "active/standby" naming here with a status-poll cadence.

---

## D5. Documented gaps / non-recovered items

- Exact numeric values of native tasker fields `timeoutMins`, `maxTimeout`, `connection_timeout`, `TRIGGER_NETWORK_EVALUATION_TIMEOUT_MS` (dex7): stored as compiled ints, not in the dex string table — not recovered.
- Exact numeric value bound to `signedCommandTimeout` (hasm:10236951): supplied via an environment/config variable, not an inline literal — not recovered.
- English display text for the "asleep"/"waking up" **status labels**: not in the Hermes string table (localized externally, 24 languages); only i18n keys cited (§D3.3).
- Direct opcode proof that the *command* ongoing/failure notifications use the `VEHICLE_SERVICE` channel: strongly implied by co-location in dex8 and the `notification_channel_vehicle_service_name` resource, but the exact channel-id→notification binding was not isolated (marked INFERRED in §D1.2/D2.1).
