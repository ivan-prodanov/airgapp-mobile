# Tesla Phone Key & Passive Entry ("unlock on approach") — how it works, what's required, and can airgapp do it

**Date:** 2026-07-19
**Scope:** Static RE of Tesla Android `4.58.0-4392` (APK) + Tesla iOS `4.58.0-4392` (`TeslaV4.app`, IPA `4.57.5`), plus public-protocol research and a gap analysis of `airgapp/mobile`. Static analysis only, on the user's own vehicle/apps. No secrets extracted.
**Question:** Today airgapp enrolls its own virtual key (NFC-card-authorized) and sends commands, but relies on the *official* Tesla app to unlock the car on approach. Can airgapp create a **true mobile key** that unlocks the Tesla on approach by itself?

---

## TL;DR

- **Yes, it is possible in principle — and you already own ~80% of the hard part.** The car authenticates the *key*, not the app. Tesla's phone key is **Tesla's own BLE/UWB credential, NOT Apple's or Google's Digital Car Key**, so it needs **no automaker-only entitlement**. airgapp already holds a whitelisted phone key and does the full crypto/session/command stack. Nothing about "unlock on approach" is cryptographically new.
- **What's missing is not crypto — it's a persistent, background, proximity-maintaining BLE *presence*.** The official app keeps an authenticated BLE connection alive in the background and lets the **car's VCSEC decide** to unlock (walk-up / handle-pull), optionally sharpened by UWB ranging. airgapp today does the exact opposite: it scans one-shot in the foreground and **tears the session down when backgrounded**.
- **The single real risk is iOS background reliability.** Even Tesla's own app is only "mostly" reliable at background passive entry, and it uses a **native CoreBluetooth stack + State Restoration + iBeacon region-wake + Secure-Enclave key**. A React-Native/`ble-plx` JS approach cannot sustain this; you will need a **native Swift CoreBluetooth module**. No known third-party project has ever shipped true Tesla passive entry — this is greenfield.
- **Recommended:** iOS-first, native CoreBluetooth presence service, **BLE-RSSI only to start** (works on every car), add UWB later. Effort is concentrated in one native module + a lifecycle inversion, not in the protocol.

---

## PART 1 — The model: how a Tesla "phone key" actually works

A Tesla phone key is two capabilities riding on one enrolled credential:

1. **Command channel** (lock/unlock/climate/charge/etc.) — *airgapp already does this.*
2. **Passive entry** (walk-up unlock, exterior-handle-pull auto-present, walk-away lock) — *the missing piece.*

Both use the same credential and the same BLE protocol (Tesla calls it **VCSEC**). The parts:

### 1.1 The credential
- A **NIST P-256 (prime256v1) ECDH keypair** on the phone. The **public** key (its `SHA1[0:4]` is the "key id") is enrolled into the car's **whitelist** inside the VCSEC controller.
- Enrollment of a *new* key must be **authorized by an already-trusted key**. The bootstrap trusted key is the **physical NFC key card** tapped on the console. Wire form: a `VCSEC.WhitelistOperation.addKeyToWhitelistAndAddPermissions` (public key + role + `KeyFormFactor`) wrapped in a `ToVCSECMessage` with `signatureType = SIGNATURE_TYPE_PRESENT_KEY`; the *car* enforces the "present a trusted key now" rule (the tap). **This is exactly what airgapp does today.**
- Key roles/permissions matter for passive entry: the key must be a **local** form factor (`KEY_FORM_FACTOR_IOS_DEVICE` / `_ANDROID_DEVICE`) with local-unlock/local-drive permission (`ROLE_DRIVER` grants these), **not** a remote `CLOUD_KEY`. (airgapp already enrolls as `KEY_FORM_FACTOR_IOS_DEVICE` + `ROLE_DRIVER` — the correct shape; see Part 4.)

### 1.2 Discovery + link (phone is the BLE **central**)
- The **car advertises**; the **phone scans and connects** (the phone is central, the car is peripheral — confirmed on both platforms: no GATT-server/`startAdvertising` on the phone side).
- Service `00000211-b2d1-43f0-9b88-960cebf8b91e`, write char `…0212` (to-vehicle), notify char `…0213` (from-vehicle), bonding/version char `…0214`.
- **Vehicle match by VIN:** scan-filter service UUID is derived per-VIN, and the advertised **Local Name = `"S" + SHA1(VIN)_hex[0:16] + "C"`** (18 chars). (Directly evidenced in Android `BLEService.b0()`; on iOS the entry points `advertisedServiceIDForVIN:` / `advertisedNameBelongsToVehicle:` + SHA1 primitives are evidenced, the exact `S…C` literal is inferred. Newer platforms also advertise a 16-bit `0x1122` service and a second `00000301/302` service.)
- Framing: 2-byte big-endian length prefix + chunk to MTU (requests 515). **airgapp already implements all of this** (`directBleTransport.ts`).

### 1.3 Session crypto
- ECDH(phone_priv, car_ephemeral_pub) → **SHA-1 of the shared X, first 16 bytes = AES-128-GCM key**, per domain (VCSEC vs Infotainment). Anti-replay via counter + epoch + clock; SessionInfo HMAC proves the car is the real peer and the key is whitelisted. **airgapp already implements all of this** (`crypto.ts`, `session.ts`).

### 1.4 Passive entry — **the car decides, the phone just stays present**
This is the crux and the most misunderstood part:

- The phone does **not** measure distance and send an "unlock" command. On Android, `readRemoteRssi` is called **zero times**; there is no phone-side unlock logic on either platform.
- Instead, the phone **maintains a live, authenticated BLE session in the background** and answers challenges. The **car's VCSEC** computes proximity/zones from **its own BLE-RSSI antenna array** (and UWB ranging, if available) and initiates the unlock, then challenges the phone to sign an `AuthenticationRequest`. Evidence: VCSEC `AuthenticationReason` enums — `WALK_UP_UNLOCK`, `PASSIVE_UNLOCK_EXTERIOR_HANDLE_PULL`, `PASSIVE_UNLOCK_AUTOPRESENT_DOOR`, `ENTERED_HIGHER_AUTH_ZONE`, and the fault `MESSAGEFAULT_ERROR_COMMAND_REQUIRES_PHYSICAL_PROXIMITY`.
- Phone-side RSSI is used **only to pick which peripheral to connect to** ("Shared Fleet" scanning), never as the security gate.
- **Implication for airgapp:** to get walk-up unlock you do **not** build a distance-estimator or send unlock commands. You build a service that **keeps an authenticated presence alive and responds to the car's challenges**. The car does the rest. (A cruder MVP — "background-scan, then *send* an RKE unlock when RSSI is strong" — is possible with today's command path, but it is not true passive entry: no handle-pull trigger, no auto-present, and it fires even when you're just walking past. See Part 6.)

### 1.5 UWB (optional, anti-relay)
- Plain BLE-RSSI proximity is **relay-attackable** (~8 ms added latency defeats it). Tesla added **UWB secure ranging** (time-of-flight distance bounding, CCC Digital Key / FiRa / IEEE 802.15.4z) in app 2024.2.x.
- UWB is negotiated **over the authenticated BLE link** (`VCSEC.NISessionRequest`/`NISessionResponse`, `FiraResponse`/`FiraCapabilities`), then the OS UWB stack does the ranging: iOS **NearbyInteraction** (`NISession` + `NINearbyAccessoryConfiguration`), Android **GMS Nearby UWB** (`UwbClient` + `androidx.core.uwb`, phone acts as ranging *controlee*).
- **UWB only engages when car + phone + feature-flag all support it; BLE-RSSI is always the baseline and fallback.** Cars: Model 3 Highland, refreshed/2023+ Model X (+ others rolling out). Phones: iPhone 11+ (U1/U2), recent Pixel/Galaxy. **You can ship passive entry with BLE-only and add UWB later.**

---

## PART 2 — How each app achieves *background* passive entry

### 2.1 iOS (`TeslaV4.app`)
- **Background modes** (`UIBackgroundModes`): `location`, `bluetooth-central`, `nearby-interaction`, `fetch`, `remote-notification`.
- **Native CoreBluetooth**, not a JS library: ObjC++ `BLEHelper.mm` (`<RCTBridgeModule>`) with `CBCentralManager`/`CBPeripheral`. RN calls into it (`scanForPeripherals(vin, …, scanForever:)`, `sendCommandTo:withMessage:…`).
- **CoreBluetooth State Restoration** = how iOS relaunches the app into the background on BLE events: `CBCentralManagerOptionRestoreIdentifierKey` + implemented `centralManager:willRestoreState:` (+ a restore watchdog).
- **CoreLocation iBeacon region monitoring** = the reliable background *wake* source: `handleDidEnterBeaconRegionForVIN:` / `…ExitBeaconRegionForVIN:` / `handleDidRangeBeaconForVIN:withProximity:`, `BLEBeaconRegion`, `NSLocationAlwaysAndWhenInUse`. Entering the car's region wakes the app and (re)starts the BLE connection.
- **UWB:** NearbyInteraction, accessory config exchanged over BLE, batched multi-anchor ranging.
- **Key storage:** **Secure Enclave** P-256 (`LocalKeyPairEnclave.swift`, `kSecAttrTokenIDSecureEnclave`, CryptoKit `P256.KeyAgreement`), in a shared Keychain access group. Non-extractable.
- Passive entry runs entirely in the **main app process** (the appex extensions declare no background modes).

### 2.2 Android (`com.teslamotors.tesla`)
- **Foreground service** `com.teslamotors.plugins.ble.BLEService` (`foregroundServiceType="connectedDevice"`, separate `:svc` process, `startForeground(333, …)`), kept alive by a **wakelock-backed `reconnect()`** loop + 5-retry GATT policy + continuous re-scan. (`BLEBootReceiver` exists but ships **disabled** — no boot autostart by default; the service's lifetime is tied to being logged in with a VIN.)
- Permissions: `BLUETOOTH_SCAN`, `BLUETOOTH_CONNECT`, `ACCESS_FINE/COARSE/BACKGROUND_LOCATION`, `UWB_RANGING`, `FOREGROUND_SERVICE_CONNECTED_DEVICE`.
- **UWB:** module `tesla-uwb` over **GMS Nearby `UwbClient`** + `androidx.core.uwb`, gated by `hasSystemFeature("android.hardware.uwb")` + a feature flag + per-VIN support map; FiRa params negotiated over BLE, then AOSP/GMS does the ranging.
- **Key storage:** **software** P-256 (`prime256v1` via the default `KeyPairGenerator`, stored in an app BKS file `keys.store`; AndroidKeyStore only holds an RSA key that wraps the BKS password). So the EC private key is **app-extractable** — notably *weaker* than the iOS Secure-Enclave key, and comparable to airgapp's current approach.
- **Bonus:** `TeslaCardEmulationService` (NFC **HCE** `HostApduService`) lets the phone emulate the key *card* over NFC, proxying APDUs to `BLEService`.

### 2.3 Why this matters: **it is not Apple/Google Digital Car Key**
- The iOS app has **no `com.apple.developer.carkey` entitlement, no `com.apple.developer.matter`, no `carkey` associated domain, no `PKAddCarKey`/ISO-18013 symbols.** Its "car key" is 100% Tesla's own VCSEC protocol over ordinary CoreBluetooth + NearbyInteraction.
- Apple CarKey / Google Digital Car Key are **available to automakers only** (MFi onboarding, special entitlements). **Tesla deliberately does not use them** — which is precisely why community tools and, potentially, airgapp can interoperate: **you only need ordinary Bluetooth + (optionally) NearbyInteraction/UWB permissions, no privileged entitlement.**

---

## PART 3 — What airgapp already has (all reusable)

Source: `airgapp/mobile`, RN 0.85 / Expo 56, BLE via **react-native-ble-plx 3.5.1**, crypto via `@noble/*`.

| Capability | Status | Where |
|---|---|---|
| On-device P-256 keypair | ✅ (extractable JS, Keychain-at-rest) | `src/ble/keystore.ts:55-82` |
| **Enroll own key to car whitelist, NFC-card-authorized** | ✅ (official app NOT in the path) | `src/ble/bleEnroll.ts:51-84`, `directBleTransport.ts:286-306` |
| Correct key shape for passive entry (`KEY_FORM_FACTOR_IOS_DEVICE` + `ROLE_DRIVER`) | ✅ | `bleEnroll.ts:51-84` |
| ECDH → SHA1 → AES-128-GCM session, per-domain | ✅ | `crypto.ts:63-87` |
| SessionInfo exchange + **HMAC anti-MITM** + counter/epoch/clock anti-replay | ✅ | `session.ts:225-303, 534-543` |
| Direct phone→car BLE (scan-by-VIN-name, connect, MTU, chunk, reassemble, demux) | ✅ | `directBleTransport.ts` |
| VIN→scan-name `"S"+SHA1(VIN)[0:16]+"C"` | ✅ | transport spec §2; `bleScanName.ts` |
| Command send + fault recovery; Pi HTTP fallback (BLE-first selector) | ✅ | `gateway.ts`, `transportSelector.ts:57-126` |
| VCSEC unsolicited status decode | ✅ | `vcsecPush.ts:25-60` |

**In short: the entire cryptographic + protocol + enrollment core already exists and already talks directly to the car.** airgapp is a first-class phone key today — for *commands*.

---

## PART 4 — The gap: what's required for self-hosted passive entry

airgapp has **no** proximity/presence/background code — grep for `background scan / proximity / passive / rssi / geofence / nearbyinteraction / restoreIdentifier / CBCentralManager / scanForPeripherals / BGTaskScheduler` across `src/`, `modules/`, `ios/` returns **zero matches**. Worse for this goal, the current lifecycle is the *opposite* of what's needed: one-shot 20 s foreground scan (`directBleTransport.ts:424-485`), and **teardown on background** (`useCarLink.ts:753-762`). iOS `Info.plist` declares **no `UIBackgroundModes`**, no state restoration (`new BleManager()` with no `restoreStateIdentifier`), location is when-in-use only, deploy target iOS 12.0.

**Required work** (`[REUSE]` = existing code carries over · `[NET-NEW]` = must build):

**(a) A persistent background BLE "presence" service** — `[NET-NEW]` control loop that scans for the car, keeps an authenticated session warm, and *responds to the car's proximity challenges* (it does **not** decide unlock itself). `[REUSE]` all crypto/session/enrollment/framing/command builders feed straight into it.

**(b) iOS: background modes + State Restoration + a native CoreBluetooth module** — `[NET-NEW]`
- Add `UIBackgroundModes: bluetooth-central` (+ `nearby-interaction` if UWB) to `Info.plist`.
- Construct the central with `CBCentralManagerOptionRestoreIdentifierKey`, implement `willRestoreState`, and use a **service-UUID-filtered** `scanForPeripherals` so iOS relaunches the app on car proximity.
- Add **iBeacon region monitoring** + **`NSLocationAlwaysAndWhenInUse`** as the reliable background wake source (this is the trick Tesla's app leans on).
- **Realistically this must be a native Swift/ObjC CoreBluetooth module.** `ble-plx` is JS-thread-driven and iOS suspends the JS runtime shortly after backgrounding — it cannot sustain reliable background passive entry. The repo already has the Expo-native-module pattern (`modules/expo-bg-task`, `modules/expo-godot-view`) to copy. `[PARTIAL REUSE]` the UUIDs/MTU/framing logic ports conceptually but is re-implemented in Swift.

**(c) Harden the key to the Secure Enclave** — `[NET-NEW]` recommended: move from extractable JS scalar to a Secure-Enclave P-256 key (as Tesla iOS does). A native BLE module makes this natural, and it materially improves the security story of an always-present key.

**(d) UWB / NearbyInteraction** — `[NET-NEW]`, **optional/deferrable.** Native NI module, discovery-token exchange over the existing BLE session, `NSNearbyInteractionUsageDescription`, iOS 14/15+. Skip for v1 (BLE-RSSI works on every car).

**(e) Android side** — `[NET-NEW]` entirely (foreground `connectedDevice` service + wakelock + permissions, optional UWB via GMS Nearby). `[REUSE]` the whole TS engine via the same `CarTransport` seam. Defer until iOS proves out.

**(f) Proximity/keep-alive policy** — `[NET-NEW]` keep-warm heartbeat, re-handshake-on-wake, approach/depart hysteresis, debounce. Can build on `refetchSessionInfo`/`withCachedSession`.

---

## PART 5 — Feasibility verdict & recommended approach

**Can airgapp do it? Yes — with realistic caveats.** The car authenticates the key, not the app (Android whitelist membership is a bare key-id equality check; **no package-name / app-signature / attestation binding**). Any software holding a whitelisted private key and speaking VCSEC correctly is indistinguishable from the official app to the car. airgapp already *is* that software for commands. Passive entry adds a background presence layer, not new cryptography, and needs **no Apple/Google car-key entitlement**.

**The honest risks:**
1. **iOS background reliability is the whole ballgame.** iOS aggressively suspends/kills apps; background BLE central + State Restoration + iBeacon-wake is exactly how Tesla copes, and even *they* are imperfect. Expect "good, not flawless," and budget for a native module — a JS/`ble-plx` attempt will disappoint.
2. **Greenfield.** Every known third-party Tesla BLE project (`vehicle-command`, esphome-tesla-ble, TeslaBleHttpProxy) does **commands only**. Nobody has publicly shipped true passive entry. You'd be first — the protocol is understood; the background-presence engineering is the unknown.
3. **Relay-attack surface** if BLE-only (mitigated by adding UWB later, on capable cars/phones).
4. **Robustness vs the official app coexisting** — two keys both maintaining presence is fine (the car supports many keys), but test walk-away-lock and max-BLE-client limits.

**Recommended path (iOS-first, matching your build):**
1. **Native Swift CoreBluetooth "PhoneKeyPresence" Expo module** — background central, State Restoration, iBeacon region-wake, keep the authenticated session warm, answer VCSEC `AuthenticationRequest` challenges. Reuse the existing TS crypto/session by either (a) bridging the byte-pipe to JS, or (b) porting the seal/open into the module for background autonomy (b is more robust).
2. **BLE-RSSI only, no UWB** for v1 — works on every Tesla; ship walk-up unlock + walk-away lock.
3. **Move the key into the Secure Enclave** as part of the native module.
4. **Then** add UWB (NearbyInteraction) for supported cars/phones, and **then** the Android foreground-service port.
5. Interim **MVP option** if you want something this week: a foreground/short-background "scan → auto-send RKE unlock when the car's advert is strong" behavior using the *existing* command path. It's not true passive entry (no handle-pull/auto-present, fires on pass-by, no walk-away lock), but it validates background scanning and the wake path before you invest in the native presence service.

---

## Appendix — evidence pointers

**iOS** (`TeslaV4.app`): `UIBackgroundModes` = location/bluetooth-central/nearby-interaction/fetch/remote-notification; entitlements have **no** carkey/matter; `BLEHelper.mm` (`<RCTBridgeModule>`, CBCentralManager); `CBCentralManagerOptionRestoreIdentifierKey` + `centralManager:willRestoreState:`; `handleDidEnter/ExitBeaconRegionForVIN:`, `BLEBeaconRegion`; `NISession`/`NINearbyAccessoryConfiguration`, `VCSEC.NISessionRequest/Response`, `FiraResponse`; `LocalKeyPairEnclave.swift` (`kSecAttrTokenIDSecureEnclave`); UUIDs `00000211/212/213/214-b2d1-43f0-9b88-960cebf8b91e`; `AUTHENTICATIONREASON_WALK_UP_UNLOCK`, `…PASSIVE_UNLOCK_EXTERIOR_HANDLE_PULL`, `…ENTERED_HIGHER_AUTH_ZONE`, `MESSAGEFAULT_ERROR_COMMAND_REQUIRES_PHYSICAL_PROXIMITY`; `KEY_FORM_FACTOR_IOS_DEVICE`, `WHITELISTKEYPERMISSION_{LOCAL_UNLOCK,LOCAL_DRIVE,…}`. Full: `scratchpad/findings/ios-findings.md`.

**Android** (`com.teslamotors.tesla`): `com/teslamotors/plugins/ble/{BLEService,Peripheral,TeslaCardEmulationService,BLEBootReceiver,z0}.java`; software P-256 in `rb0/a.java:234` (BKS `keys.store`, alias `phone_auth_<email>_key_pair`); `WhitelistOperation` `vc0/n3.java`, `SIGNATURE_TYPE_PRESENT_KEY` `rc0/n.java:30`, `KEY_FORM_FACTOR_ANDROID_DEVICE` `ob0/e.java:906`; local name `"S"+SHA1(VIN)[0:16]+"C"` `BLEService.b0()`; UWB `jf0/{d,f}.java`, `mf0/d.java` (GMS `com.google.android.gms.nearby.uwb.UwbClient` + `androidx.core.uwb`); no `readRemoteRssi`; foreground `connectedDevice` service; manifest perms incl. `UWB_RANGING`. Full: `scratchpad/findings/android-findings.md`.

**Public protocol:** `github.com/teslamotors/vehicle-command` (commands + enrollment only, **no passive entry**); CCC Digital Key / FiRa / IEEE 802.15.4z for UWB; Project TEMPA (trifinite) + NCC Group confirm **the vehicle decides unlock** from RSSI + challenge-response latency. Full: `scratchpad/findings/web-research.md`.

**airgapp current state + itemized gap:** `scratchpad/findings/airgapp-gap.md`.
