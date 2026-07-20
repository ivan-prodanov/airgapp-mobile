# RE RESPONSE — passive-entry challenge protocol (car→phone)

**Answers:** `REQUEST-passive-entry-challenge-protocol.md` (Q1–Q4).
**Method:** static RE of Tesla 4.58.0 iOS (`TeslaV4` Mach-O + embedded FileDescriptorProto) + Android
(jadx Wire adapters) + MCU2 firmware `authd` (carved descriptors). 6 finders + 3 adversarial verifiers.
Verifier verdicts: **Q1 schema SUPPORTED (high)**, **Q2 native-vs-JS SUPPORTED (high)**.
**Confidence** is flagged per claim; **"⚠ TEST ON-CAR"** marks everything a static image cannot settle
(your M0 capture wins there — this gives you the field meanings so you know what to look at).

## TL;DR (the two decisions you asked for)

1. **Q2 is decisive: go NATIVE.** Both official apps answer the challenge **100% in native code**
   (iOS `BLEVehicleLogic.mm`+`TMCrypto.m`+`AuthEngineHolder.swift`; Android `q1.java`+phone-key auth
   engine+`rb0/a.java`), **zero JS/Hermes in the loop** — *specifically because passive entry must
   answer a car BLE challenge while the app is backgrounded/suspended, when the Hermes runtime isn't
   guaranteed alive.* Your pure-JS `@noble` + "wake Hermes and sign" **will not** hit the car's response
   window from a CoreBluetooth background wake. The signer must be native (with a pre-cached session).
2. **Q1 schema is fully recovered** (below) and cross-confirmed on 3 sources. The challenge carries a
   **20-byte token**; the response binds it **cryptographically as AES-GCM AAD** (not echoed as a
   field), signed `SIGNATURE_TYPE_AES_GCM_TOKEN` on the existing ECDH session.

## Corrections to your REQUEST's anchors (verified from bytes — use these)

- `AuthenticationRequest` **has no field 1**; wire fields are **2,3,4**. Do not scan for field 1.
- The challenge token is one level deeper than you assumed: `AuthenticationRequest.sessionInfo(2)` is a
  **nested `AuthenticationRequestToken` message**, and the token is its field 1. (authd's Go tag calls
  field 2 "bytes" only because a nested message is length-delimited — same wire shape.)
- **`AuthenticationRejection_E` numbering differs from your guess:** `NONE=0, DEVICE_STATIONARY=1,
  PASSIVE_DISABLED=2, NO_TOKEN=3, PASSIVE_DISABLED_AUTOMATION=4, DEVICE_NOT_UNLOCKED_ON_WRIST=5`
  (you had `NO_TOKEN=1`). Verified independently in `vc0/o.java:65-71` and the iOS descriptor.
- `AuthenticationReason_E` fills in: `IDENTIFICATION=1, POWER_ON_VEHICLE_REQUEST=2, GTW_REQUEST=3`
  (then your known 4–9), `IMMOBILIZER=10`.

---

## Q1 — the wire schema (`.proto` fragment; field numbers HIGH confidence, all 3 sources agree)

```proto
syntax = "proto3";
package VCSEC;

// ================= CAR -> PHONE (the challenge) =================
// FromVCSECMessage.authenticationRequest = field 3   (vc0/w0.java:29 ; iOS descriptor ; authd)
message AuthenticationRequest {
  // NO field 1 in this firmware. Decoder skips any tag not in {2,3,4}.
  AuthenticationRequestToken      sessionInfo    = 2;  // nested message (LEN), carries the token
  AuthenticationLevel_E           requestedLevel = 3;  // varint enum — the level the car wants
  repeated AuthenticationReason_E reasonsForAuth = 4;  // packed varint enum (accept packed AND unpacked)
}
message AuthenticationRequestToken {
  bytes token = 1;   // THE CHALLENGE NONCE. Exactly 20 bytes on this firmware (q1.java:643 getToken().D()==20)
}

// ================= PHONE -> CAR (the answer) =================
// UnsignedMessage.authenticationResponse = field 3   (vc0/e3.java:31 ; iOS descriptor)
message AuthenticationResponse {
  AuthenticationLevel_E     authenticationLevel     = 1;  // ECHO requestedLevel on a grant
  uint32                    estimatedDistance       = 2;  // uint32; the official app ALWAYS sends 0
  AuthenticationRejection_E authenticationRejection = 3;  // NONE on a grant
  // No token field. The token is bound in the signature, not the body.
}

// ================= the signing envelope =================
message ToVCSECMessage { oneof sub_message { SignedMessage signedMessage = 1; UnsignedMessage unsignedMessage = 2; } }
message UnsignedMessage {                        // only the relevant arm shown
  oneof sub_message { AuthenticationResponse authenticationResponse = 3; /* InformationRequest=1, RKEAction=2, ... */ }
}
message SignedMessage {                          // vc0/w2.java ; iOS @0x31c346a ; authd @9377268
  bytes           token                  = 1;    // LEFT EMPTY on the auth-response path (Android z.java:24)
  bytes           protobufMessageAsBytes = 2;    // AES-GCM CIPHERTEXT of the serialized UnsignedMessage
  SignatureType   signatureType          = 3;    // = SIGNATURE_TYPE_AES_GCM_TOKEN (3) when a token is present
  bytes           signature              = 4;    // 16-byte AES-GCM auth tag
  bytes           keyId                  = 5;    // SHA1(pubkey)[:4]  (4 bytes)
  uint32          counter                = 6;    // monotonic anti-replay
}

// ================= session freshness (VCSEC path — NO epoch) =================
// FromVCSECMessage.sessionInfo = field 2
message SessionInfo { bytes token = 1; uint32 counter = 2; bytes publicKey = 3; }  // car ephemeral pub for ECDH

// ================= enums (numeric values verified) =================
enum AuthenticationLevel_E { AUTHENTICATION_LEVEL_NONE=0; AUTHENTICATION_LEVEL_UNLOCK=1; AUTHENTICATION_LEVEL_DRIVE=2; }
enum AuthenticationReason_E {
  NOT_DOCUMENTED=0; IDENTIFICATION=1; POWER_ON_VEHICLE_REQUEST=2; GTW_REQUEST=3;
  UI_UNLOCK_PASSIVE_AUTH=4; PASSIVE_UNLOCK_EXTERIOR_HANDLE_PULL=5; PASSIVE_UNLOCK_INTERIOR_HANDLE_PULL=6;
  PASSIVE_UNLOCK_AUTOPRESENT_DOOR=7; ENTERED_HIGHER_AUTH_ZONE=8; WALK_UP_UNLOCK=9; IMMOBILIZER=10;
}  // prefix AUTHENTICATIONREASON_ elided
enum AuthenticationRejection_E { NONE=0; DEVICE_STATIONARY=1; PASSIVE_DISABLED=2; NO_TOKEN=3;
  PASSIVE_DISABLED_AUTOMATION=4; DEVICE_NOT_UNLOCKED_ON_WRIST=5; }  // prefix AUTHENTICATIONREJECTION_ elided
enum SignatureType {  // VCSEC.SignatureType (Android vc0/v2.java shows a trimmed set; firmware superset)
  SIGNATURE_TYPE_AES_GCM=0; SIGNATURE_TYPE_ECDSA=1; SIGNATURE_TYPE_PRESENT_KEY=2;
  SIGNATURE_TYPE_AES_GCM_TOKEN=3;   // <-- the passive-auth response type
  SIGNATURE_TYPE_UNSIGNED=4; /* firmware also: ECDSA_PERSONALIZED=4? AES_GCM_PERSONALIZED=5, AES_GCM_RESPONSE=9, ... */
}
```
> ⚠ `SignatureType` numeric wire values: Android `vc0/v2.java` enumerates a *trimmed* set (…_TOKEN=3,
> _UNSIGNED=4); the firmware `authd` descriptor has a *superset* where _UNSIGNED sits elsewhere and
> AES_GCM_PERSONALIZED=5 / AES_GCM_RESPONSE=9 exist. **For the passive-auth path you only need
> `AES_GCM_TOKEN=3`** (agreed by both app platforms). If you ever hand-emit other sig types, confirm the
> integer on-car.

### The signing recipe (Android decompile — the concrete, authoritative one)

The response body does **not** echo the token. Binding is cryptographic
(`gf0/b.java:923-940`, `rb0/a.java:178-190`, `z.java:20-25`; HIGH confidence):

```
sessionKey = SHA1( ECDH_P256(phonePriv, carPub) )[:16]         // AES-128 key, derived ONCE per session
ct, tag    = AES_128_GCM_encrypt(
                key   = sessionKey,
                iv    = <derived from the 4-byte big-endian counter>,   // ⚠ exact 12-byte IV assembly: TEST ON-CAR
                aad   = token,                                          // the 20-byte challenge token
                pt    = serialize( UnsignedMessage{ authenticationResponse = <resp> } ) )
SignedMessage{ token=<empty>, protobufMessageAsBytes=ct, signatureType=AES_GCM_TOKEN(3),
               signature=tag(16B), keyId=SHA1(pubkey)[:4], counter=<counter> }
send ToVCSECMessage{ signedMessage }  →  GATT write char (…0212 on service 00000211-…-960cebf8b91e)
counter++   // monotonic
```
The grant response itself is trivial and **reason-independent** (see Q4):
`AuthenticationResponse{ authenticationLevel = <echo requestedLevel>, estimatedDistance = 0, authenticationRejection = NONE }`.

- **Envelope:** its OWN `VCSEC.SignedMessage` inside `ToVCSECMessage` — **not** a
  `UniversalMessage.RoutableMessage`, and **not** `AES_GCM_RESPONSE` (that's the *car's* reply type).
  A modern firmware *may* also accept the universal `RoutableMessage` path (AES_GCM_Personalized,
  challenge in `TAG_CHALLENGE`) — ⚠ your M0 capture tells you which your car uses; it's one wire byte
  (`SignedMessage.signatureType` vs a RoutableMessage `signature_data` arm).
- **Anti-replay = token + counter, NO epoch** (VCSEC legacy path; `VCSEC.SessionInfo{token,counter,pubkey}`
  has no epoch). Seed via `InformationRequest` types `GET_TOKEN=1` / `GET_COUNTER=2`, or read the
  pushed `FromVCSECMessage.sessionInfo(2)`. Replay/rollback → `MESSAGEFAULT_ERROR_REPEATED_COUNTER(26)`.
- **NO_TOKEN handling:** if `requestedLevel != NONE` but the request has no valid 20-byte token, reply
  `AuthenticationResponse{ NONE, 0, NO_TOKEN }` and do **not** sign a grant (`q1.java:643-652,676`).
- ⚠ **iOS wrinkle:** the iOS finder read `SignedMessage.token` as *echoed* (couldn't prove the exact
  bytes — compiled Swift) while Android definitively leaves it empty + puts the token in the AAD. The
  Android recipe is the better-evidenced one; treat "token in AAD, SignedMessage.token empty" as
  primary and **confirm the exact AAD/IV/token-binding on-car** — it's the one crypto detail static RE
  can't fully pin (VCSEC verifies it internally, off-image).

---

## Q2 — native or JS? **NATIVE on both platforms. This is the architecture driver.** (HIGH)

| | iOS | Android |
|---|---|---|
| Receive + dispatch `authenticationRequest` | `BLEVehicleLogic.mm` (`kAuthenticationRequest` case) | `q1.java:734 B0()` → `:775 getAuthenticationRequest()` → `:631 z0()` |
| Decide level/rejection | `AuthEngineHolder.swift` (CoreMotion, TimerManager) | `rd0/t.java` + `com.tesla.phonekeyauthengine.AuthorizationResult` |
| Build + AES-GCM sign | `TMCrypto.m` (`encryptAESGCMPersonalized`), Secure-Enclave key | `rb0/a.java:178-190` (SpongyCastle GCM), `gf0/b.java` |
| Send over BLE | `-[… sendAuthenticationResponse:…withPeripheral:]` (CBPeripheral) | `ye0/n.java`→`ob0/e.java:1132`→`fd0/f.java:156` |
| JS/Hermes role | **descriptors only** (`proto.VCSEC.*` reflection); 0 crypto, 0 builder, 0 key material | same — a few analytics enum strings; `"ble_authentication_response"` has 0 JS hits |

**Why native (the reason that decides it for you):** the challenge is auto-triggered and must be
answered in real time while the app is **backgrounded/suspended**, via a CoreBluetooth
state-restoration wake — Hermes is not guaranteed alive. Tesla pre-establishes the session and, on
challenge, does **one AES-GCM seal** with the cached session key + counter++ (no asymmetric crypto,
no bridge hop, no cloud). iOS caches `sharedSecret[16]`, `keyID[4]`, `counter` in a native session
struct; the private key is a Secure-Enclave `SecKey`.

**Implication for airgapp:** a JS-`@noble` signer that must wake Hermes after suspension is **not
viable** for background walk-up — you will miss the car's response window (Q1: there's an enforced
deadline; `AuthEngineHolder` even self-times-out and defaults to DRIVE to avoid missing it). **Plan a
native signer** (iOS: Swift + Secure Enclave or a persisted P-256 key; the AES-GCM seal + counter in
native code triggered from the CoreBluetooth delegate). Foreground-only M1 can be JS to prove
`LOCAL_UNLOCK`, but M2 background presence needs the native path.

---

## Q3 — iOS background lifecycle (HIGH unless noted)

- **UIBackgroundModes** (`Info.plist`): `location, bluetooth-central, fetch, remote-notification, nearby-interaction`. (No `bluetooth-peripheral` — central-only in background.)
- **CB State Restoration: YES.** Two centrals:
  - primary phone-key central, restore id **`centralManagerID`** (CFString decoded, HIGH), delegate on serial queue `ble_cbcentral_queue`.
  - a secondary central (shared-fleet/RT scanner) with a *formatted* restore id `%@-%@` (MEDIUM on role).
  - `-[BLEHelper centralManager:willRestoreState:]` implemented; on relaunch it re-acquires peripherals via `retrievePeripheralsWithIdentifiers:` from UUIDs persisted in `NSUserDefaults` (`BLE_PERIPHERAL_LAST_SUCCESSFUL_RETRIEVAL…`), with a `willRestoreState` watchdog.
  - Wake cause is reported to the car via `PhoneKeyTelemetry_iOS.launchReason` = `iOS_LaunchReason{ SNA, FOREGROUND, BLUETOOTH, BEACON, NOTIFICATION, URL, SHORTCUT }` (`BLUETOOTH`=CB restoration, `BEACON`=iBeacon wake).
- **Scan:** service-scoped `scanForPeripheralsWithServices:` filtered to `{ 0x1122 (short advert UUID), per-VIN service UUID }`; connect-on-advert after `belongsToVehicle:` checks. GATT service **`00000211-b2d1-43f0-9b88-960cebf8b91e` CONFIRMED present** + chars `…0212/0213/0214` and `…0301/0302` (bonding/UWB). ⚠ meaning of `1122` vs the 128-bit service: confirm on-car. Backoff = failure counters + scan-timeout re-scan on `poweredOn`; exact intervals are runtime constants (⚠ not in image).
- **iBeacon region monitoring = background wake:** `-[LocationServicesHelper locationManager:didEnterRegion:]` → `-[BLEHelper handleDidEnterBeaconRegionForVIN:]` recovers/reconnects the peripheral; beacon state reported as `iBeaconState{SNA,INSIDE,OUTSIDE}`; `startMonitoringSignificantLocationChanges` as a coarse wake. **This is your reliable background re-presence trigger** — pair it with CB state restoration.
- **Session across suspension = RE-HANDSHAKE on wake (session state NOT persisted).** Three tiers:
  1. long-term identity P-256 key — **persisted** (Secure Enclave / shared keychain group).
  2. car's static/domain pubkey — **persisted to a per-VIN file** (so ECDH is re-derivable without re-fetching it).
  3. live **token/counter/epoch — NOT persisted**; the signer, when it has no live session, emits a fresh **`sessionInfoRequest`** and re-derives the in-memory `sharedSecretCache`. So after a long suspension you must **re-fetch SessionInfo (GET_TOKEN/GET_COUNTER) before you can answer** — budget for that in the response-deadline math, or keep the session warm.

---

## Q4 — ranging & policy (HIGH)

- **Reason does NOT change the response.** `reasonsForAuth` (walk-up=9 / ext-pull=5 / int-pull=6 /
  autopresent=7 / …) is **telemetry only** — it's turned into analytics strings and never reaches the
  grant/reject logic (`rd0/t.java:529` switches only on the IMU/eligibility result). Every gesture gets
  a byte-identical `AuthenticationResponse`; only `requestedLevel` (echoed) varies. **You can answer all
  reasons with one code path.**
- **The phone contributes no ranging.** `estimatedDistance` is hard-coded to **0** by the official app
  on every path; the car does 100% of RSSI/UWB ranging. RSSI thresholds / zone geometry /
  multi-key arbitration are **VCSEC-ECU-internal — not in any image** (⚠ test on-car if you need them).
- **No client-side passive-entry toggle exists in the official app** — it answers unconditionally when
  it's a connected key. **Good news for you:** your "disableable, off-by-default" requirement is a clean,
  purely client-side choice you own — **when disabled, simply don't answer `AuthenticationRequest`** (or
  don't keep the authenticated session/presence alive). Nothing car-side changes.
- **IMU anti-relay gate = optional, OFF by default.** Gated on a server flag (`AuthConfig.auth_rejection`,
  default `enabled=false`). When armed AND the phone is provably stationary (fresh accel data, no
  movement in lookback 3600 s, IMU data <30 min old, no user-presence <180 s; movement = any axis
  `|accel|>0.2f`), the response becomes `rejection = DEVICE_STATIONARY` instead of a grant — it never
  stops the phone from *replying*. **Recommend: skip for v1, or implement optional/off.** Not required
  to answer a walk-up.

---

## ⚠ Must TEST ON-CAR (static RE cannot settle — your M0 capture decides)

1. **Exact AAD / IV / token-binding** of the AES_GCM_TOKEN seal (AAD=token confirmed on Android; the
   12-byte IV assembly from the 4-byte counter, and whether iOS also echoes `SignedMessage.token`).
   *This is the single most important thing to confirm before you can build a valid reply.*
2. Whether your firmware wants the **legacy `SignedMessage`/AES_GCM_TOKEN** path or the **universal
   `RoutableMessage`/AES_GCM_Personalized** path (one wire byte in the first captured challenge-answer).
3. **`AuthenticationRequest` field 1** — absent in the app schema; if your car emits a tag-1, capture it.
4. The car's **response deadline** (ms/clock-ticks) and whether a re-handshake fits inside it after a wake.
5. Whether `estimatedDistance=0` is accepted for BLE-only walk-up (the app always sends 0, so it should).
6. That a **ROLE_DRIVER** key's signed AuthenticationResponse is actually accepted for `AUTHENTICATION_LEVEL_UNLOCK` (your standing `LOCAL_UNLOCK` question — this exchange *is* the behavioral proof).

## Provenance
6 finders (iOS Mach-O descriptor parse, Android jadx Wire adapters, firmware `authd` carved descriptors,
signing rules, iOS background, ranging/policy) + 3 verifiers; schema & native/JS verdicts SUPPORTED high.
Full finder reports: `scratchpad/findings4/{android-schema,ios-native-vs-js,android-native-vs-js,signing-rules,ios-background,ranging-policy}.md`.
Related: `phone-key-authorization-and-passive-entry.md`, `../../../../tesla-firmware/out/vcsec-phonekey-authz-firmware.md`.

---

## ✅ VALIDATED AGAINST OUR M0 CAPTURE (airgapp, 2026-07-20)

The schema above was derived by static RE; our 2026-07-20 on-car capture was
taken independently, before this response existed. **They agree exactly.**
Decoding our captured `FromVCSECMessage.f3` frames with this schema:

| token len | requestedLevel | reasonsForAuth | frames |
|---|---|---|---|
| **20** | 2 (DRIVE) | 1 `IDENTIFICATION` | 23 |
| **20** | 2 (DRIVE) | 5 `PASSIVE_UNLOCK_EXTERIOR_HANDLE_PULL` | 9 |
| **20** | 2 (DRIVE) | 8 `ENTERED_HIGHER_AUTH_ZONE` | 5 |

Every field lands where predicted: `sessionInfo(2).token(1)` is exactly 20 bytes
in all 37 frames, `requestedLevel(3)` is a varint, `reasonsForAuth(4)` is a
packed repeated enum. Two independently-derived artifacts agreeing byte-for-byte
⇒ treat the schema as settled.

**Resolved by this:**
- Our unexplained `f4` bytes `0x08`/`0x01` were reasons **8** and **1** — values
  absent from our partial enum. No mystery remains.
- We had flagged that we could not correlate frames to handle-pull moments.
  Unnecessary: the frames self-identify. **We captured 9 real handle pulls**, and
  the car got no answer to any of them, so it did not unlock.
- Confirms `keyId = SHA1(pubkey)[:4]`, which we had derived independently on-car
  (a 20-byte keyId target faults `10/DECODING`).

**Corrections to our REQUEST that we accept:** `AuthenticationRequest` has no
field 1 (we never saw one — consistent); the token is one level deeper than we
assumed (`sessionInfo(2).token(1)`, which is exactly the `f2{f1=20B}` nesting we
observed); `AuthenticationRejection_E` numbering.

**Note for whoever implements:** every observed request asks for
`requestedLevel = 2 (DRIVE)`, not `UNLOCK(1)` — so a grant echoes DRIVE. Worth
knowing before assuming the walk-up path requests UNLOCK.
