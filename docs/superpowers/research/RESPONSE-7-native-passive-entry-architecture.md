# RE RESPONSE #7 — native passive-entry architecture for M2

**Answers:** `REQUEST-7-native-passive-entry-architecture.md` (Q0–Q5). 4 finders (disassembly-level) + 2
adversarial verifiers over the iOS Mach-O, RN bundles, Android jadx, car firmware, and airgapp's own
`src/ble`. Confidence per claim; **⚠ MEASURE** = runtime fact not in any binary (you have the log
pipeline + can wedge/walk-up).

## TL;DR — your conclusion is right, refined, and it has a second half you'll hit next

- **Q0 confirmed, restated precisely.** The official app holds **exactly one** connection to your car,
  and multiplexes **both** commands and passive-entry challenges over it. But the rule isn't "never two
  `CBCentralManager`s" — the app runs **2–3** concurrently. The invariant is **"never two centrals
  *connected to the same peripheral*."** Your dedicated JS link violated exactly that; your inline-responder
  fallback *is* Tesla's design.
- **A chunk of your thrash was self-inflicted and is fixable in JS today:** `directBleTransport.ts:320-346`
  `connectClearingStale` calls `cancelConnection` when it sees the car "already connected" — so each manager
  cancels the other's link. That's literally your "each calls cancelConnection on the other," and it's why
  you saw `Operation was cancelled`×16 + wedged timeouts + **0 real `iosErrorCode 14`** yet *false* bond-wedge
  verdicts. **Delete that cancel path** once there's a single owner.
- **Passive entry is 100% native** (one AES-GCM seal per challenge, Secure-Enclave ECDH) — reconfirmed by
  disassembly. M1 foreground can stay JS; **M2 background needs a native module.**
- **The second half you haven't hit yet (the highest-value finding):** your Pi command path and a
  phone-native passive-entry central use the **same enrolled key**, and the car keeps a **per-key monotonic
  counter shared across a client's sessions**. Two concurrent VCSEC sessions under that one keyId (Pi +
  phone-native) will **race the counter** → intermittent `FAULT_AES_DECRYPT_AUTH`/`TIME_EXPIRED`. The
  single-central rule (L1) does **not** fix this; you need a car-side rule (L2) too. See the invariant.

---

## THE INVARIANT (this is the deliverable — two levels)

```
L1 — PHONE PROCESS (fixes phone-side BLE-vs-BLE contention; = the official app's topology):
  At most ONE CBCentralManager / BluetoothGatt in the airgapp process may ever be
  connecting-or-connected to the user's car peripheral at a time. That one held link
  carries BOTH signed commands AND passive-entry challenges, multiplexed over one VCSEC
  session (service 00000211-…; write 0212, notify 0213; one RX decoder handling both
  RoutableMessage and FromVCSECMessage).
    • Multiple centrals are fine IF they target different peripherals (Tesla runs a
      scan-only shared-fleet central + a per-VIN connector + an energy connector).
    • JS/Hermes NEVER instantiates a ble-plx BleManager / CBCentralManager to the car.
      Any phone-side BLE command is submitted to the ONE native central via a bridge
      (exactly Tesla's `sendCommandTo:` handing an UnsignedMessage down) — never a 2nd manager.
    • Passive entry gets NO dedicated link; it rides the command connection inline.
    • DELETE directBleTransport.ts connectClearingStale's cancelConnection (320-346):
      with one owner there is no peer to cancel; it only manufactures self-knockdown.

L2 — CAR-SIDE, CROSS-DEVICE (fixes Pi-vs-BLE contention the single-central rule can't):
  The Pi's BLE link and the phone-native central are TWO distinct VCSEC peers at the car
  but sign with the SAME enrolled key (phone does the crypto; Pi relays bytes) → SAME
  keyId=SHA1(pub)[:4] → ONE shared per-epoch monotonic counter on the car
  (your session.ts:505-516 already does Math.max(counter,newCounter) "because another
  client may have sent commands"). Two concurrent authenticated VCSEC sessions under that
  keyId race the counter → rejected frames.
    • FIX = PRESENCE MUTUAL-EXCLUSION: when the phone-native BLE link is UP (walk-up range),
      it owns BOTH passive entry AND VCSEC commands inline (Tesla's exact model), and the Pi
      holds NO VCSEC session. When the phone is out of BLE range, the Pi owns commands and
      passive entry is inert. Passive entry only matters at walk-up range, so the window is
      naturally exclusive and the same-keyId race never opens.
    • ALTERNATIVE (only if true simultaneity is required): enroll the Pi and the phone as
      SEPARATE keys → distinct keyIds → independent car-side counters, at the cost of a 2nd
      whitelist slot.
```

---

## Q0/Q1 — central/connection topology *(high)*

- The car connection is held by a **per-VIN `BLEVehicle`** object that owns its own `CBCentralManager` +
  a single `CBPeripheral` ivar **`commandPeripheral`** (`get/set/reset/connect/has/…CommandPeripheral`,
  `connectionLost:wasCommandPeripheral:` — a *scalar*, not a pool). `BLEVehicle` implements the whole
  connect + GATT lifecycle incl. the **`0213`-notify handler** `peripheral:didUpdateValueForCharacteristic:`
  = challenge delivery. Commands (`RoutableMessage`) and challenges (`FromVCSECMessage.authenticationRequest`)
  share **one VCSEC session, one connection**, decoded by a single RX path
  (*"received complete (RoutableMessage or FromVCSECMessage) message"*).
- **`BLEHelper`'s central is scan-only** (shared-fleet RSSI discovery + iBeacon region monitoring; only
  `willRestoreState`/`didUpdateState`/`didDiscoverPeripheral` — **no** `didConnect`/GATT callbacks). It never
  connects your car.
- **Android mirrors this:** one `BluetoothGatt` per car in `Peripheral.java` (challenge via
  `onCharacteristicChanged`), scanner only scans + RSSI-gates reconnect. One central per car.
- **Connect-and-hold:** the car always advertises (service `1122`/per-VIN UUID); the phone scans and connects
  on identity match, keeps the link up, and the challenge arrives instantly over the held `0213` notify.

> Verifier note (correctness): "any other central only scans" is app-globally too strong — Tesla also has an
> **energy** connector (Powerwall) and, for multi-car users, additional per-VIN connectors. The exact rule is
> **peripheral-scoped**: no second central ever connects to the *same* car.

---

## Q2 — background execution (the crux of M2)

### iOS
- **Challenge-delivery wake = a `0213` characteristic notification delivered via CB State Restoration** on
  the *restored connection*. Car writes `AuthenticationRequest` to `0213` → CoreBluetooth relaunches the app
  into the background (`IOS_LAUNCHREASON_BLUETOOTH`) → `centralManager:willRestoreState:` →
  `restorePeripherals:` reads **`CBCentralManagerRestoredStatePeripheralsKey`** and re-adopts the
  `CBPeripheral` → the queued `didUpdateValueForCharacteristic:` (`0213`) fires → answered natively. *(high)*
- **NOT a connection event** (`registerForConnectionEvents`/`CBConnectionEvent` are unused).
- **iBeacon region entry (`IOS_LAUNCHREASON_BEACON`) is the *re-presence / reconnect* wake, not challenge
  delivery** — when you'd walked away and the link dropped, region-entry wakes the app to reconnect; the car
  then challenges over the reconnected link via the `0213` path above.
- **UIBackgroundModes:** `bluetooth-central` (load-bearing), `location` (iBeacon + significant-location
  re-presence), `nearby-interaction` (UWB, post-connection, not a wake), `fetch`/`remote-notification` (off
  the hot path). No `bluetooth-peripheral` — central-only.
- **State Restoration is on the connection-holding central**, with a restore identifier that must be stable
  across launches. *(Finder conflict, flagged: the disassembly-mapped finder says the holder uses a per-VIN
  formatted `"%@-%@"` id and the scanner uses `"centralManagerID"`; other finders say the reverse. It doesn't
  change your design — you need **one** restorable connection-holding central with a **stable** restore id
  (per-VIN if you ever support multi-car, else a constant is fine). Confirm the exact Tesla mapping on-device
  by logging the restore id at init.)*
- **Force-quit: ⚠ MEASURE (OS policy, not in the binary).** iOS relaunches a `bluetooth-central` app on BLE
  events only if the OS killed it — **not** after a user force-quit (swipe from App Switcher). The app's
  telemetry assumes it isn't force-quit. **Test:** suspend → walk up → unlocks; force-quit → walk up → expect
  no unlock (no `LAUNCHREASON_*` event) until you reopen. This is the single most important M2 assumption to verify.
- **Response window: ⚠ MEASURE.** App self-timeout: `AuthEngine "taking too long, cancelling and returning
  drive auth"` (fails to DRIVE — doesn't unlock), configurable via remote-config **`CP_a132_contractAuthTimeout`**
  (runtime value). Car window = VCSEC constant (returns `SIGNEDMESSAGE_INFORMATION_FAULT_TIME_EXPIRED`).
  **Test:** log `0213`-RX → `0212`-TX delta (foreground / suspended-connected / post-iBeacon); inject delay
  until the car returns `TIME_EXPIRED` to bound the window.

### Android
- **Foreground service** `BLEService` (`android:foregroundServiceType="connectedDevice"`, process `:svc`,
  `startForeground(333)`) holds a single `BluetoothGatt` (`Peripheral.java`), challenge via
  `onCharacteristicChanged`. Response native.
- **`connectGatt(..., autoConnect=true, ...)` on SDK ≥ 34** — the BT *controller* re-establishes the link in
  Doze/background when the car reappears (the analogue of iOS state restoration). Below 14: direct connect +
  bounded retry.
- **Timed partial wakelocks** for Doze survival: `tesla:ble-peripheral-reconnect`, `tesla:ble-service-discovery`
  (11 s), `tesla:ble-mtu` — short, scoped to the critical section.
- **No `CompanionDeviceManager`** (hypothesis refuted — zero references). Re-presence = the FGS's always-on
  `SCAN_MODE_LOW_LATENCY` scan + OEM-assisted wakes (MiBeacon/HonorWallet/SamsungWallet) + `BLEBootReceiver`
  (boot/package-replaced). `onTaskRemoved` stops the service if not in phone-key foreground mode.
- **⚠ MEASURE:** swipe-away/force-stop survival is OEM-dependent (Samsung/Xiaomi/Pixel battery policy); Doze
  reconnect latency. Test with `dumpsys deviceidle force-idle` + walk-up + logcat.

---

## Q3 — the signer + keys in the background *(high; disassembled this pass)*

- **Native, one AES-GCM seal per challenge**, driven from the CB delegate in `BLEVehicleLogic.mm`
  (`+[TMCrypto encryptAESGCMPersonalized:…]`; log *"Signed Protobuf. IV %u"* → IV counter-derived). Zero Hermes.
- **ECDH runs through the Secure Enclave:** `doECDHKeyExchange` → **`SecKeyCopyKeyExchangeResult(privateKey,
  algo, carPubKey, params)`** — private key is a `SecKey`, never raw bytes; when SE-backed the ECDH happens
  *inside* the enclave. `sessionKey = SHA1(ECDH)[:16]` (native).
- **iOS private key = Secure Enclave P-256, non-extractable, provisioned background-usable with NO biometric
  gate:** `kSecAttrTokenIDSecureEnclave` + `SecKeyCreateRandomKey`; access control =
  **`kSecAccessControlPrivateKeyUsage` only** (no `UserPresence`/`Biometry`/`DevicePasscode`); protection =
  **`kSecAttrAccessibleAlwaysThisDeviceOnly`**. → usable while locked, no prompt. *(MEDIUM caveat: the key-gen
  fn is a generic RSA/EC helper; the exact class for the specific VCSEC key is on-device confirmable via a
  keychain attribute dump — but the direction, background-usable/no-prompt, is settled.)*
- **The crucial nuance for you:** the SecKey (and its accessibility class) is touched **only during ECDH at
  session (re)establishment**. The **per-challenge seal reads the cached RAM `sharedSecret` and never touches
  the SecKey.** So a **warm** session answers in *any* lock state; a **cold** session (CB-relaunched) needs the
  SE key usable in background, which the provisioning guarantees.
- **Session cache:** `sharedSecret[16]`, `counter`, `keyId[4]` in a native struct. **Live token/counter are NOT
  persisted** — on a cold wake the native `SessionInfoRequest` state machine re-handshakes
  (`GET_TOKEN → GET_COUNTER → GET_EPHEMERAL_PUBLIC_KEY → GET_SESSION_DATA → GET_EPOCH_SESSION_INFO`). Only the
  SE key + the car's static pubkey (per-VIN file) persist. **⚠ MEASURE:** whether a cold re-handshake fits the
  car's response window, or you must keep the session warm.
- **Android:** software `prime256v1` in a BKS file (extractable) — readable whenever `:svc` runs; the
  constraint is service lifecycle, not a keychain class.

**Smallest native surface (the answer):** because the wake can be **cold** and Hermes may be dead, the native
module must be the **whole VCSEC session responder**, not just the seal:
- MUST be native: the restorable `CBCentralManager` + `willRestoreState`; the SE key + ECDH
  (`SecKeyCopyKeyExchangeResult`) + SHA1-KDF; the session cache; the `SessionInfoRequest` handshake; the
  AES-GCM seal + counter + `0212` write — all on the **one held connection**.
- Can stay JS: enrollment / key management / QR, the "passive-entry enabled" **policy toggle** (native reads a
  cached boolean + level), telemetry, UI, and command-proto building for the Pi path.
- Per-challenge cost is one symmetric seal; the only asymmetric work is one ECDH per session — so this is far
  smaller than porting the command/OwnerAPI stack, but strictly larger than "just the seal."

---

## Q5 — range, holding the link, reconnect *(high)*

- **"In range" for your OWN car is advertisement/identity-gated, NOT RSSI-thresholded.** The car always
  advertises; the app connects on discovery when the advertised name/service matches (`1122`/per-VIN UUID) —
  no RSSI gate on the own-car connect. iBeacon region + `CLBeacon` proximity is the coarse presence/**wake**
  signal. **So the official app doesn't thrash at edge-of-range the way your two managers did** — (1) no
  RSSI gate on the own-car link, (2) never two centrals fighting it.
- The `sharedFleetBLEScanRSSIThreshold`/`…Diff` values (the `…Diff` *is* the hysteresis band) gate
  **SharedFleet discovery of *other* Teslas**, not your car — and the numbers are **remote-config keys**, not
  in the binary. Own-car RSSI is read only for telemetry / the auth `estimatedDistance`.
- **Reconnect is fixed-cadence, bounded-count — NOT exponential.** iOS: `peripheralReconnectRemainingAttempts`
  (a fixed remaining count; terminal *"ran out of peripheral reconnection retries"*), failure-class-gated
  (`CBErrorPeerRemovedPairingInformation`/`CBErrorUnknownDevice` are terminal, no reconnect), plus the
  standing `willRestoreState`/`retrievePeripheralsWithIdentifiers` re-adopt path and iOS-17
  `didDisconnect…isReconnecting:`. Android: `RECONNECTION_TIMEOUT_MS = 5000` fixed + `autoConnect=true` +
  per-op retry cap 5. *(The `ExponentialBackoffTimer` from the firmware RE is authd/network-side — not the
  app BLE reconnect.)*

---

## Target architecture for airgapp

**Native module ("VCSEC background responder"), one per platform:**
- **iOS:** one `CBCentralManager` created with `CBCentralManagerOptionRestoreIdentifierKey` (stable, per-VIN);
  `Info.plist` `UIBackgroundModes` = `bluetooth-central` + `location`; State Restoration ON (`willRestoreState`
  → `retrievePeripheralsWithIdentifiers` → re-adopt `CBPeripheral`). It owns `commandPeripheral`, the connect
  lifecycle, and the `0213` handler; holds the SE keypair + native session struct + `SessionInfoRequest`
  handshake + the AES-GCM seal. A **separate scan-only** central may do iBeacon/region re-presence but must
  never `connect` the car.
- **Android:** one `BluetoothGatt` in a `connectedDevice` foreground service (`:svc`), `connectGatt(…,
  autoConnect=true on SDK≥34, …)`, timed wakelocks around reconnect/discovery; software EC key in Keystore/BKS.
- **JS keeps:** enrollment, the enabled/level policy (cached), telemetry, UI, and the **Pi** command path
  (network, zero phone-side central).

**Ownership:** enforce **L1 + L2** (above). Concretely for airgapp: commands ride the Pi while the phone is out
of BLE range; when the phone-native link is UP at walk-up range, it owns passive entry **and** any VCSEC
command inline, and the Pi stands down (no concurrent same-keyId session). Delete `connectClearingStale`'s
`cancelConnection`.

**Range/reconnect policy:** connect-on-advertisement-match (no own-car RSSI gate); iBeacon region monitoring
for background re-presence/wake; fixed-cadence bounded reconnect (mirror iOS remaining-attempts / Android 5 s +
`autoConnect`); rely on CB State Restoration (iOS) / `autoConnect` (Android) for the standing "walk back in
range" reconnect rather than a hot scan loop.

---

## ⚠ On-device measurements that decide the remaining unknowns
1. **The L2 decisive test (do this first):** bring the phone-native direct-BLE VCSEC session UP and send a
   command over the Pi under the **same keyId/epoch** — does the car reject a frame with
   `FAULT_AES_DECRYPT_AUTH`/`TIME_EXPIRED` (counter race)? Repeat with refetch-before-send on/off. Confirms
   whether presence-exclusion (L2) is mandatory or separate-key enrollment is needed.
2. **Force-quit vs suspend** walk-up (watch for `IOS_LAUNCHREASON_BLUETOOTH`/`BEACON` presence/absence).
3. **Cold background-wake → first sealed-`0213`-write latency**, and whether a cold re-handshake fits the car
   window (vs. keeping the session warm).
4. **Car concurrent-session / connection-slot cap** (Pi + phone-native + official app): how many authenticated
   BLE sessions/centrals the car tolerates.
5. **Exact 12-byte IV assembly** from the counter (your standing RE-2 unknown; `IV %u` confirms counter-derived).
6. **The SE key's precise accessibility class** for the VCSEC key (keychain attribute dump) — direction is settled.

## Provenance
Finders `central-topology`, `background-mechanism`, `signer-keys-native`, `coexistence-airgapp` + verifiers
`V-topology` (**SUPPORTED, high**) and `V-airgapp-rule` (**PARTIALLY_SUPPORTED, high** — L1 confirmed, L2
counter-race added). New disassembly: `BLEVehicle`/`BLEHelper` central ownership & restore-id call sites;
`doECDHKeyExchange`→`SecKeyCopyKeyExchangeResult`; SE key-gen access-control flags. Builds on RESPONSE #1–#6.
Reports: `scratchpad/findings10/*.md`.
