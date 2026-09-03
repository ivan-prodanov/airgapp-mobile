# Android native parity — assessment + design

Status: **APPROVED 2026-09-03** (Ivan: "go" on the recommendations in §5).

Date: 2026-09-03. Branch: `feat/ble-carlink`. Device: Galaxy S22 (`SM-S901B`, Android 16 / SDK 36).

## 0. The one-paragraph verdict

The Android ports of the four native modules were written as *transliterations of the Swift*
without re-deriving what each iOS mechanism is **for** and what Android offers instead. Three of
the four are fine (`expo-godot-view` is careful and verified; `shared-intake` is a sound analog of
the Share Extension; `expo-bg-task` is harmless). The fourth — `expo-passive-entry`, the phone
key — is not usable: it has no way to exist in the background, subscribes to the car with the
wrong CCCD value, identifies the car by connecting to strangers, and has never connected to the
car once (0 `CONNECTED` lines in 5,922 log rows). This spec rewrites that module the way the
official Tesla Android app (v4.58.0, decompiled at `~/Work/tesla-firmware/work/app-re/jadx`) and the
Android platform actually work, behind the **unchanged** TS contract.

## 1. iOS vs Android — what each iOS mechanism is for, and the Android equivalent

| iOS mechanism (PassiveEntryCentral.swift & co.) | What it is for | Android equivalent (what the official Tesla app does) |
|---|---|---|
| App is **suspended** in background; native self-signs because Hermes is dead | Keep answering the car with no JS | Process is **not** suspended, but a plain background process is Doze-throttled, cached-frozen (12+) and killed. Only a **foreground service** (`foregroundServiceType="connectedDevice"`) keeps GATT callbacks flowing indefinitely. Tesla: `BLEService`, notification id 333, channel `phone_key_service_channel`. Keep the same fg/bg single-writer rule (JS stops listening on background anyway). |
| CoreBluetooth **State Restoration** (restore id, `willRestoreState`) relaunches a killed app on a BLE event | Survive the OS killing us | No equivalent. The FGS makes "killed" the exception; `BOOT_COMPLETED`/`MY_PACKAGE_REPLACED` receiver restarts it after reboot/update (Tesla: `BLEBootReceiver`). A `PendingIntent` BLE scan is the only OS facility that wakes a dead process on a car sighting. |
| `retrievePeripherals` + standing `connect()` (no timeout, not scan-throttled) | Reconnect the instant the car is in range without scanning | `connectGatt(ctx, autoConnect=true, cb, TRANSPORT_LE, PHY_LE_1M_MASK, handler)` to the remembered MAC. Tesla enables `autoConnect` on API ≥ 34 (S22 is 36). The car's VCSEC address is static (Tesla persists it per VIN, no bonding). |
| Scan on service `1122`, match by name `S<sha1(vin)[:8]>C` | First-ever discovery | Same filters plus the iBeacon (mfg 0x004C, Tesla UUID, VIN-derived minor) — the only identifier the previous session proved Android receives at -90 dBm. Tesla filters on `1122` OR a per-VIN 128-bit UUID (VIN bytes 1..16) and matches name. Bounded windows (Android silently stops long scans ~30 min; Tesla restarts its bg scan every 20 min by alarm). |
| `CLBeaconRegion` (Tesla UUID) + `CLCircularRegion` 150 m | Relaunch after **reboot**, when nothing else can | No OS beacon monitoring. Analog = `PendingIntent` scan with the beacon filter (survives process death, no location permission). Geofence via Play Services `GeofencingClient` is the circular-region analog (needs "Allow all the time"). Tesla uses neither for phone key — the FGS + boot receiver carry it. |
| `centralManagerDidUpdateState` `.poweredOff` → "Bluetooth Disabled" now + repeating every 4h | Nag like the official app | `BluetoothAdapter.ACTION_STATE_CHANGED` (dynamic receiver in the service; not manifest-registrable on 8+). Repeat via inexact `AlarmManager` window. Tesla posts id 444 five seconds after OFF. |
| `applicationWillTerminate` → "Keep the app running" | Force-quit kills passive entry | Not needed: swiping the task away does **not** stop a foreground service (`onTaskRemoved` keeps running, Tesla returns early there when bg is allowed). Force-stop from Settings is the Android ceiling (= iOS force-quit). |
| `peerRemovedPairingInformation` → bond-removed | iOS LE bond gone | N/A — nobody bonds with the car on Android (no `createBond` in Tesla's app, none in `vehicle-command`). `bondRemoved` never fires; documented. |
| `setNotifyValue(true)` | Subscribe to 0213 | Android must choose the CCCD value. **Tesla writes `ENABLE_INDICATION_VALUE`; `vehicle-command` subscribes with `ind=true`.** The current Kotlin writes `ENABLE_NOTIFICATION_VALUE` — on an indicate-only characteristic that is silence forever. Choose by the characteristic's properties (INDICATE preferred, NOTIFY fallback). |
| `maximumWriteValueLength` | Chunk size | Explicit `requestMtu` (Tesla: 250, we ask 517, car caps) with a timeout, then `discoverServices` with a timeout, wake locks around both (Tesla: `tesla:ble-mtu`, `tesla:ble-service-discovery` 11 s, `tesla:ble-peripheral-reconnect`). |
| `writeValue(.withResponse)` in a loop | Send chunks | One GATT op in flight; queue; `WRITE_TYPE_DEFAULT` (Tesla `setWriteType(2)`). |
| Keychain item `AfterFirstUnlockThisDeviceOnly` | Background-readable key copy | Keystore **AES-GCM wrapping key** (no user auth, usable after first unlock) + wrapped blob in prefs. `androidx.security:security-crypto` is deprecated by Google (2025) — drop it. |
| `UIApplication.applicationState` is the authority for the fg/bg gate | Refuse a false "foreground" claim from RN | `Application.registerActivityLifecycleCallbacks` started-activity count (our own; no lifecycle-process dependency). Refuse `setForegroundResponderActive(true)` when no activity is started; flip to autonomous natively when the last activity stops. |
| `ExpoAppDelegateSubscriber` builds the central at launch | Exist before/without JS | Expo `Package.createApplicationLifecycleListeners` → `Application.onCreate` hook (autolinking picks up any `*Package.kt` importing `expo.modules.core.interfaces.Package`). Runs in every process, including one started by the service or a receiver with no React context. |
| `airgapp-native.log` file | Events while JS is dead | logcat is a volatile ring lost on reboot; write `files/airgapp-native.log` too. |
| Share Extension = separate process with its own `CBCentralManager` (`BleBytePipe.swift`) | Send without the app | `:share` process gets an **ephemeral** central: no service, no persistence, no responder, direct connect to the remembered MAC + 3 s discovery scan, closed when the sheet's activity is destroyed. Two GATT clients from two processes share one ACL on Android (the Bluetooth process owns the link), same as iOS. |

Android-only facts that shape the design (all from the decompile unless noted):
- Tesla's `Peripheral` reconnect delays: GATT status 0/8/34 → 500 ms; 19/22/62/133/256 → 2 s; retry ladders 1/2/5/10/15 s for service discovery, indication enable, and GATT statuses 132/10 (max 5); status 133 → "Bluetooth should cycle" warning.
- Tesla's per-VIN scan uses `CALLBACK_TYPE_ALL_MATCHES` + `reportDelay 100 ms` + `SCAN_MODE_LOW_LATENCY` via a `PendingIntent` (`a0` receiver, `LIST_SCAN_RESULT`) for the "scan forever" enrolment path, callback scans with a 10 s timeout otherwise, and `SCAN_MODE_LOW_POWER` for background reconnect scans gated on RSSI > -95 dBm and ≥10 s since the last background connect.
- Tesla's watchdogs: `REINITIALIZE_CONNECTION` every 4 h (inexact window), `RESTART_BG_SCAN` 20 min after a background scan starts (window 10 min).
- Tesla declares `REQUEST_IGNORE_BATTERY_OPTIMIZATIONS`, `RECEIVE_BOOT_COMPLETED`, `WAKE_LOCK`, `FOREGROUND_SERVICE_CONNECTED_DEVICE`, `POST_NOTIFICATIONS`; the boot receiver is `enabled=false` in the manifest and toggled on via `PackageManager.setComponentEnabledSetting` once a MAC is stored and background is allowed.
- Android GATT client slots are finite (~32 per device). Every `connectGatt` must be paired with `close()`, including failed direct connects (status 133). The current Kotlin leaks them.
- Starting a foreground service from the background is only allowed from exempt triggers: `BOOT_COMPLETED`/`MY_PACKAGE_REPLACED`, a geofence transition, a Bluetooth broadcast needing `BLUETOOTH_SCAN/CONNECT`, an exact alarm, a notification tap, or the battery-optimization exemption. The design only starts the FGS from the app UI, the boot receiver, and (best effort, caught) the scan/geofence receivers.

## 2. Assessment of the current Android implementations

### 2.1 `expo-passive-entry/android` — rewrite

1. **No background existence.** No foreground service, no boot receiver, no BT-state receiver, no notifications, no geofence, no beacon wake. Every "Phase 4" contract function is a silent no-op and the goldens return "not implemented". On Home/screen-off the process is an ordinary background app and the link dies with it.
2. **Wrong CCCD value.** Writes `ENABLE_NOTIFICATION_VALUE`; the reference implementations use indications. Never verified because the code never reached a connected car.
3. **The probe hack.** After a failed window it *connects to up to 12 unidentified nearby devices* and runs service discovery on each to see if any expose VCSEC (`startProbePass`). Radio-hostile, privacy-hostile, can trigger pairing prompts on strangers' hardware, leaks GATT clients, and only exists because identification was broken. Delete.
4. **Diagnostic census.** Every third window is unfiltered and logs every advertiser in range (139 per window today) into the app's SQLite log; JS's `start()` polling logs `foregroundActive=true` every 6 s. Signal drowned.
5. **Threading.** GATT callbacks (binder thread), scan callbacks (main) and JS calls (JS thread) mutate `gatt`, `txChar`, `writeInFlight`, `scanning`, `standingConnect`, `probing`… with no synchronization. The write pump races. Proper: one `Handler`, passed to `connectGatt(..., handler)`, everything posted onto it (Tesla posts every callback to `mHandler`).
6. **GATT hygiene.** No `close()` on failed direct connects, no MTU/discovery timeouts, no status-based backoff, `start()` treats a *pending* autoConnect as "link already up", `onScanFailed` leaves the window timer armed.
7. **Three overlapping reconnect mechanisms** (standing autoConnect + 20 s fallback scan + direct connect) juggled by a `standingConnect` flag, with a documented failure mode ("two BluetoothGatt clients to the same car") that the design itself creates.
8. **Persistence.** VIN never persisted → nothing can resume without JS. No warm session (iOS answers a challenge before the handshake completes from persisted epoch/counter).
9. **fg/bg gate** is a bare boolean defaulting to `true`, set blindly from RN. iOS defaults to autonomous and refuses a claim the OS disproves. On Android JS is alive-but-detached in the background (`foregroundBleLink.stop()` removed the listener), so a stale `true` forwards challenges to nobody.
10. **Permissions.** `ActivityCompat.requestPermissions` fired inside `start()` with no callback; JS retries every ~6 s until the grant lands. `POST_NOTIFICATIONS` is never requested, so no reminder could ever show on Android 13+.
11. **KeystoreKey** uses the deprecated `androidx.security` library.
12. **Module wiring.** Central built lazily from `reactContext`; in a process started by a service/receiver there is no React context. The central must be an application-scoped singleton created at `Application.onCreate`.
13. **Share process.** The `:share` process instantiates a second "persistent" central with the same MAC-writing, reconnect-looping semantics; with a service it would try to start the FGS from a transient sheet.
14. **No native log file.**
15. **Missing outright:** VcsecSigner (background self-signing, the actual phone key), device fingerprint, three goldens, CPD notification, BT-off reminder, warm session, `HandlePulledWithoutAuth` diagnostics.

### 2.2 `expo-bg-task/android` — keep
iOS's assertion buys ~30 s before suspension. Android never suspends a process that holds a foreground service, so once the FGS exists this is redundant; a 30 s `PARTIAL_WAKE_LOCK` with a timeout is a harmless, proportionate stand-in and the map is synchronized. Leave it; note the semantics in a comment.

### 2.3 `shared-intake/android` — keep
`ShareActivity` in `:share` + `ShareIntentBus` is a sound analog of the extension (verified on device except the send leg, which needs the car). Its BLE arm depends on the ephemeral central mode above. One touch: stop the ephemeral central when the sheet's activity is destroyed (module `OnActivityDestroys`).

### 2.4 `expo-godot-view/android` — keep
Fragment-hosted engine, EGL-context retention, documented dead-ends, verified across navigation/background. Nothing to redo.

### 2.5 `expo-apple-search` — iOS-only by design (Photon on Android). Nothing to do.

## 3. Design — `expo-passive-entry/android` rewrite

### 3.1 Non-negotiables carried over from the iOS plan ("Confirmed decisions")
One shared key; routable seal only; commands untouched (TS owns all command crypto through the byte pipe); single-writer by lifecycle (foreground → TS signs, background → native signs); scan filter includes `1122`; TS contract frozen (`modules/expo-passive-entry/index.ts`, `src/PassiveEntryModule.ts`).

### 3.2 Components (all under `modules/expo-passive-entry/android/src/main/java/expo/modules/passiveentry/`)

| File | Responsibility | iOS analog |
|---|---|---|
| `PassiveEntryPackage.kt` | Expo `Package`; `createApplicationLifecycleListeners` → `PassiveEntryApp` | `expo-module.config.json` `appDelegateSubscribers` |
| `PassiveEntryApp.kt` | `Application.onCreate` hook: builds `PassiveEntryRuntime`, registers activity-lifecycle callbacks (foreground truth), calls `startIfConfigured()` in the main process | `PassiveEntryAppDelegate.swift` |
| `PassiveEntryRuntime.kt` | Process singleton: `mode` (PERSISTENT / EPHEMERAL by process name), owns the central, the store, foreground truth, service start/stop, event sinks | `PassiveEntryCentral.shared` |
| `PassiveEntryStore.kt` | SharedPreferences: armed VIN, MAC per VIN, warm session, BT-off repeat flag, car lat/lon | `UserDefaults` keys |
| `PassiveEntryCentral.kt` | Single-`Handler` state machine: scan, standing connect, GATT bring-up, write queue, frame path | `PassiveEntryCentral.swift` (BLE half) |
| `VcsecResponder.kt` | Autonomous background responder: reassembly, SessionInfo/HMAC + resync-in-place, warm-session merge, challenge answer (cap 20), standing DRIVE, AppDeviceInfo, CPD, HandlePulledWithoutAuth log | `PassiveEntryCentral.swift` (protocol half) |
| `VcsecSigner.kt` | Pure JCA crypto + protobuf primitives + the three goldens | `VcsecSigner.swift` |
| `KeystoreKey.kt` | Keystore AES-GCM wrapping key + wrapped scalar in prefs | `KeychainKey.swift` |
| `PassiveEntryService.kt` | Foreground service (`connectedDevice`), `START_STICKY`, survives task removal, dynamic BT-state receiver, wake locks around bring-up, 4 h reinit watchdog | (no analog — replaces State Restoration) |
| `PassiveEntryReceiver.kt` | Manifest receiver: `BOOT_COMPLETED`, `MY_PACKAGE_REPLACED`, PendingIntent scan results, alarms (BT-off repeat, scan restart), geofence transition | `CarRegionMonitor` wake paths |
| `Notifier.kt` | Channels `phone_key_service` (LOW) and `phone_key_alerts` (HIGH); BT-off (+ repeat), CPD; small vector icon in module `res/` | `Notifier.swift` |
| `CarRegionMonitor.kt` | Optional geofence leg (see §5 Q2) | `CarRegionMonitor.swift` |
| `BleGuards.kt` | keep; add `POST_NOTIFICATIONS` (33+) to the *ask* list | — |
| `PassiveEntryModule.kt` | Thin bridge over the runtime; async permission request via `appContext.permissions.askForPermissions` then arm; `OnActivityDestroys` stops an ephemeral central | `PassiveEntryModule.swift` |

Also: module `AndroidManifest.xml` (service, receiver, `RECEIVE_BOOT_COMPLETED`, `WAKE_LOCK`, `POST_NOTIFICATIONS`, `FOREGROUND_SERVICE`, `FOREGROUND_SERVICE_CONNECTED_DEVICE`), `build.gradle` (drop `security-crypto`; add `play-services-location` only if the geofence leg is in), `res/drawable/ic_stat_phone_key.xml`, `scripts/android/pull-logs.sh`.

### 3.3 The central's state machine (PERSISTENT mode)

```
Idle ──arm(vin)──▶ (MAC known?) ──yes──▶ Standing(autoConnect=true)  ◀─┐
                        └──no──▶ Discovering(scan, bounded)            │
Standing/Discovering ──CONNECTED──▶ Negotiating: requestMtu(517, 5 s) → discoverServices(10 s)
        → find 0212/0213 → CCCD (INDICATE if PROPERTY_INDICATE else NOTIFY, then setCharacteristicNotification)
        → Ready ──▶ report connectionState(connected, mtu); autonomous: restore warm session + SessionInfoRequest
Ready ──DISCONNECTED(status)──▶ close(); delay(status: 0/8/34 → 0.5 s, else 2 s) ──▶ Standing ─┘
any ──stop()──▶ Idle (close, cancel scans/alarms, stop service, clear VIN)
```

- **One thread.** A dedicated `HandlerThread("PassiveEntry")`; `connectGatt(..., handler)` and `scanner` callbacks are posted onto it; JS calls post onto it; the store is read/written there.
- **Match rule** (any of): iBeacon with Tesla UUID **and** VIN-derived minor; local name == `S<sha1(vin)[:8]>C`; service `1122` **and** the name is not a *different* `S…C` token; remembered MAC. Nothing else is ever connected to.
- **Scan policy.** Filters = [beacon mfg-data, `1122`, name, MAC-if-known]. Visible app: `LOW_LATENCY`, 20 s windows, restarted on demand (rate-limited to Android's 5-per-30 s). Background with no MAC: no callback scanning; a `PendingIntent` scan (`FIRST_MATCH`, `LOW_POWER`, hardware filters) that survives the process and is re-issued every 25 min by an inexact alarm. Background sighting connects only at RSSI > -95 dBm.
- **Standing connect.** `autoConnect=true` to the remembered MAC; no scan. Watchdog: if still not connected after 4 h → close and re-create (Tesla's REINITIALIZE). If a beacon match arrives at a *different* address → replace the MAC and connect directly.
- **GATT hygiene.** Every `connectGatt` is paired with `close()`; failed direct connects (133) back off 2 s and count; five 133s in a row → log "Bluetooth may need a toggle", pause 15 s.
- **Writes.** `writeRaw(bytes)` splits at `mtu-3`, queues, one `WRITE_TYPE_DEFAULT` in flight, pumped from `onCharacteristicWrite`; failures drop the queue and log.
- **Frame path.** Pipe mode → `onFrame(bytes)` (base64 event). Autonomous → `VcsecResponder`.
- **fg/bg gate.** `setForegroundResponderActive(true)` accepted only while an activity is started (else "REFUSED … staying autonomous"); `false` always accepted; when the last activity stops the runtime flips to autonomous itself and re-handshakes if Ready (mirrors the Swift flip).
- **Persistence.** VIN (armed), MAC per VIN (written on CONNECTED), warm session (epoch/counter/clock/wall/carPub) written before each seal goes out, BT-off repeat flag, car position.
- **Logging.** `onLog` event + `Log.i("PassiveEntry")` + `files/airgapp-native.log` (append, rotate at 1 MB). Window summaries are one line: counts + matched candidates, never a census.

### 3.4 EPHEMERAL mode (`:share` process)
No service, no receivers, no responder, no persistence writes. `start(vin)`: if a MAC is remembered → `connectGatt(autoConnect=false)` immediately **and** a 3 s discovery scan (first wins); else a 10 s scan. `stop()` or the sheet's activity being destroyed closes everything. Pipe mode is forced.

### 3.5 Foreground service
Started by `arm(vin)` once `BLUETOOTH_SCAN`/`CONNECT` are granted (and by the boot receiver / scan receiver / geofence receiver via `startIfConfigured`, each wrapped so `ForegroundServiceStartNotAllowedException` is logged, never thrown). Notification: title "Phone Key", text "Active for <car name>" (name from the JS store is not reachable natively → VIN suffix until the contract grows; see §5 Q5), channel LOW importance, ongoing, tap opens the app. `stop()` → `stopForeground(REMOVE)` + `stopSelf()`. Wake locks: `airgapp:ble-bringup` (≤ 15 s across MTU+discovery+CCCD) and `airgapp:ble-reconnect` (delay + 1 s).

### 3.6 VcsecSigner.kt / VcsecResponder.kt
Byte-for-byte port of the Swift: protobuf varint/len/fixed32 writers and readers, AAD TLV → SHA-256, `AES/GCM/NoPadding` with 12-byte nonce + AAD (16-byte tag split from the ciphertext), routable frame layout (fields 6/7/10/13/51), `SessionInfoRequest` frame, `SessionInfo` parser (counter/publicKey/epoch/clockTime LE fixed32), HMAC-SHA256 subkey "session info" verification, ECDH on secp256r1 (raw scalar → `ECPrivateKeySpec`; 65-byte X9.63 point → `ECPublicKeySpec`; shared X → SHA-1[:16]), public key from scalar (EC point multiplication via `KeyFactory` is not available for scalar→point in JCA; use the 65-byte point returned by `KeyPairGenerator`? No — derive with a small pure-Kotlin secp256r1 scalar multiplication, 60 lines, verified by the ECDH golden and the fingerprint check), fingerprint SHA-256(pub)[:8] colon-hex. Goldens return exactly the Swift strings (`GOLDEN: ✅ MATCH (frame 169B)`, `ECDH: ✅ MATCH`, `HANDSHAKE: ✅ MATCH`). `AppDeviceInfo.os` = `ANDROID` (value read from the decompile `vc0/k.java`, not guessed).

### 3.7 Tests
- `src/ble/nativeGoldens.test.ts` (node): reads `ios/routableSeal.golden.json` + `ios/ecdh.golden.json` and asserts every hex constant in **both** `VcsecSigner.swift` and `VcsecSigner.kt` equals the fixture — the two native signers cannot drift from the TS oracle.
- `src/ble/bleBeacon.test.ts` already pins the minor derivation; the Kotlin mirrors it.
- On device (harness `carlink`): three goldens MATCH, key fingerprint MATCH; `dumpsys activity services local.airgapp.mobile` shows `isForeground=true`; `am broadcast -a android.intent.action.BOOT_COMPLETED -p local.airgapp.mobile` restarts the service; BT toggle posts and clears the reminder.
- At the car: `CONNECTED → MTU → services → indications enabled → link up`, a foreground command round-trips through the pipe, then background walk-up: `HANDSHAKE ✓`, `standing DRIVE asserted`, unlock.

## 4. Approaches considered

**A. FGS-centric, Tesla-shaped (recommended).** Always-on foreground service while armed; boot receiver; standing autoConnect; PendingIntent beacon scan as the reboot/kill backstop. Superset of the others; matches the official app; visible persistent notification is the cost.

**B. No service — PendingIntent scan + receivers only.** Wake on sighting, connect, answer. Cannot *hold* a link without an FGS, and starting one from a scan-result broadcast is not a documented exemption on 14+. Fragile; rejected.

**C. Service only while the car is near.** A on top, plus stop the FGS after N minutes disconnected and rely on the PendingIntent scan to bring it back. Better UX (no notification when away), but the same exemption doubt as B on the re-start path. Possible v2 once A is measured in the field.

## 5. Decisions (taken 2026-09-03)

1. **Persistent notification** while armed: accepted. Title "Phone Key", text "Active for …<VIN last 6>", LOW-importance channel, ongoing, tap opens the app.
2. **Geofence leg: later.** `CarRegionMonitor.kt` is NOT built now; `setCarLocation` stores the position (so a later leg has data) and `requestAlwaysLocation` is a no-op that logs. Boot receiver + the `PendingIntent` beacon scan carry reboot/process-death.
3. **Share sheet BLE arm: ephemeral in-process central** (= iOS `BleBytePipe.swift`). No IPC.
4. **Probe + census diagnostics deleted.** One-line window summaries only.
5. **Car name in the notification: VIN suffix.** The TS contract stays frozen; passing a display name is a one-line follow-up if wanted.
