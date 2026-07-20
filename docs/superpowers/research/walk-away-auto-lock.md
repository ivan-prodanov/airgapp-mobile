# Walk-away auto door-lock — how it works (iOS + Android app + MCU2 firmware)

**Question:** when the owner walks away and the car auto-locks, what does the *phone* do vs the *car*?

**Method:** static RE of Tesla 4.58.0 (iOS `TeslaV4.app`, Android `base.apk` jadx + Hermes bundle) and
the MCU2 Intel firmware `rootfs` (`authd`/`command-router` Go, `libQtCar*` decomp, Odin diagnostics).
3 independent platform diggers → 4 adversarial verifiers. User's own car/apps.

## Verdict (verified, high confidence)

**Walk-away auto-lock is a car decision. The phone is passive on departure — it never initiates a lock.**
When you walk away, your phone key's **BLE presence leaves the car's range**; the car's **VCSEC ECU**
(a separate security microcontroller) measures that (the phone never measures link RSSI — `readRemoteRssi`
= 0 occurrences Android-wide) and, if its conditions hold, **self-issues the auto-secure lock**. This is
the exact mirror of walk-up unlock: same VCSEC proximity engine, "car decides" model.

## What the phone does — and does not — do

- **Detects departure, but only to manage BLE + log telemetry.** iOS has full region-exit handling
  (`handleDidExitBeaconRegionForVIN:` @0x1012ad0e0, `locationManager:didExitRegion:`, CB disconnect
  `clearPeripheralForVIN:withReason:`) — the exit path resolves to a `BLEPhoneLogDelegate` logging callback
  + `[controller didExitBeaconRegion]`, **no lock cfstring**. Android disconnect (`Peripheral.java:219/229`)
  → `onConnectionLost` + wakelock-backed `reconnect()` + `sendDisconnectedTelemetry`, **no lock**. The
  beacon region is a connection/bonding presence gate, not a lock trigger.
- **Never sends a lock on departure.** Lock builders exist (`RKE_ACTION_LOCK` = manual remote lock,
  `ob0/e.java:472`; `RKE_ACTION_AUTO_SECURE_VEHICLE` = the manual **"Close Doors & Lock"** button,
  `ob0/e.java:2301`, command name `CLOSE_DOORS_AND_LOCK`, `getUserInitiated==true`) — both are
  user-initiated and appear in only 4 files tree-wide, **none on a disconnect/geofence/background path**.
  No JobScheduler/WorkManager/BGTask auto-lock; no "you left your car unlocked" prompt wired to a lock.
- **Streams telemetry the car *may* use.** The phone→car VCSEC `UnsignedMessage` carries `DeviceMotion`
  (WALKING/STATIONARY/AUTOMOTIVE, via `CMMotionActivityManager`/`rd0`), `AppDeviceInfo`,
  `PhoneKeyTelemetry`. **Caveat (verifier C4):** the only *confirmed* car consumption of motion is
  `AUTHENTICATIONREJECTION_DEVICE_STATIONARY`, which is passive-**entry** (unlock) anti-relay — **not**
  proven to feed the walk-away *lock*. Treat "telemetry feeds the lock decision" as plausible, not fact.
- **The IMU-stationary anti-relay gate is UNLOCK-side, not lock-side.** The phone can *withhold* passive
  unlock when it detects it's sitting still (`IS_STATIONARY_IMU`/`STALE_MOTION_DATA`, `rd0/m.java:113-193`).
  That's the approach side; there is no departure-side equivalent.

## What the car does (firmware-confirmed vs owner's-manual level)

**Firmware-confirmed (in this MCU image):**
- VCSEC owns and enforces the decision: `VCSEC_walkAwayLockState` / `VCSEC_walkAwayLockKeyState` are
  VCSEC-reported bus signals (decoded MCU-side via `Diag_walkAwayLockStates_map`, in
  `libQtCarCANData.so`); `VehicleLinkUtils::enableWalkAwayLocks()` only *configures* the feature into VCSEC.
- The presence/closure **inputs** exist and are VCSEC-reported: `ETH_VCSEC_vehicleLockStatus`,
  `ETH_VCSEC_operationMode`, `ETH_VCSEC_keyWithinSummonRange0..2`, `ETH_VCSEC_algoUWBInteriorPresence`,
  `ClosureLockStateDataValue`.
- `WALK_AWAY_LOCK` is a `carserver.VehicleConfig` **setting key** (`cmdrouter.str:33754`, beside
  `PASSIVE_ENTRY_ENABLED`, `CHILD_LOCK`, `UNLOCK_ON_PARK`) — **not** a `VehicleAction` (no walk-away
  command exists in the ~100-member VehicleAction oneof).

**Owner's-manual / observed level (NOT firmware-provable here):** the exact rule combining the inputs —
all doors + trunk closed, gear in Park/off, no occupant, a departure debounce/grace timer, and RSSI
hysteresis — and every numeric threshold/timing. The firmware only proves the inputs exist; the
**rule + thresholds live inside the VCSEC microcontroller, which is not in this image.** Practical
user-visible confirmation on Model 3/Y is the mirrors folding (manual-level).

## The setting lives on the CAR, not the phone

**There is no Walk-Away Door Lock toggle or i18n label anywhere in the iOS or Android app** (0 hits across
all bundle/resource dumps, both platforms). It is a **car-touchscreen** setting (Controls > Locks >
Walk-Away Door Lock; corroborated by firmware UI names `WalkAwayDoorLock`/`WalkAwayLocksControl`/
`UI_walkAwayLock` in `libQtCarGUI`). Enabling it: UI → `GUI_autoDoorLockOnRequest` +
`GUI_walkAwayLocksExcludeHome` → `libQtCarVAPI` → `VCSECECUConfigMessage` (`ECU_CONFIG_PROTOBUF`, VCSEC
routine `0x1337`) over D-Bus `com.tesla.VCSECRemote`. The **"exclude at Home" geofence is computed
MCU-side** (QtCarServer `LocationManager` → `GUI_locatedAtHome`; VCSEC has no GPS; home origin =
`carserver.ChargeState.home_location` field 176, a LatLong) and fed to VCSEC as config.

## Don't conflate with (all distinct)

- **Manual "Close Doors & Lock" button** = `RKE_ACTION_AUTO_SECURE_VEHICLE` — a *user tap* (the "AUTO" is
  the car's secure behavior, not the phone auto-triggering). Not walk-away.
- **Remote lock** (app/cloud) = `RKE_ACTION_LOCK`, user-initiated.
- **Sentry Mode** = separate feature (`VehicleAction` field 30); shares the "Exclude Home" toggle pattern
  (`GUI_sentryModeExcludeHome`) — easy to confuse, not a lock.
- **"Left unlocked" notifications** = `GUI_vehicleUnsecureNotificationsExcludeHome` — an alert, not a lock.
- **Passive Entry** (`PASSIVE_ENTRY_ENABLED`) = walk-**up** unlock, the inverse. Walk-away lock doesn't
  depend on it, though both rely on the same authenticated-phone BLE presence.

## `localWalkAwayThreshold`

An **RN/JS-only** identifier present in *both* app bundles, **absent from native on both platforms**, with
**no native consumer and no proto channel to the car** (the phone→car `SetPhoneSettingPreferencesAction`
has a fixed 3-tag schema: font/language/units only). No verb/handler siblings. Most likely a device-local
JS config constant. It is **not** the phone's presence heuristic — the real presence RSSI knob is native
(`sharedFleetBLEScanRSSIThreshold` with getters/setters), and `localWalkAwayThreshold` is not in that
family. Hermes v96 prevents proving whether JS ever reads it, but no path exists by which a JS read could
reach a lock — **inert w.r.t. locking.**

## Implication for airgapp

Walk-away lock requires **nothing active from airgapp**. If the car's Walk-Away Door Lock setting is on and
airgapp maintains an *honest* authenticated BLE presence — present when the phone is near, genuinely gone
when the user leaves — VCSEC does the locking itself, exactly as with walk-up unlock. The phone's only real
responsibility across both directions is being a truthful background BLE presence; the car owns every
lock/unlock decision and threshold. See [`phone-key-authorization-and-passive-entry.md`](phone-key-authorization-and-passive-entry.md)
and [`../../../../tesla-firmware/out/vcsec-phonekey-authz-firmware.md`](../../../../tesla-firmware/out/vcsec-phonekey-authz-firmware.md).
