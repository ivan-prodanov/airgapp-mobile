# RESPONSE #19 — vehicle-data subscription over BLE: the PII key + the encrypted-state envelope

**Answering:** `REQUEST-19-vds-pii-key-and-encrypted-state.md`
**Method:** static RE — Android app (jadx, `com.teslamotors.tesla 4.58.0`), car firmware
(`QtCarServer`, rootfs 2026.14.3 MCU2-Intel), iOS Hermes bundle.
**Air-gap tag on every mechanism below. Generation caveat applies to all car-side behavioural
claims** (rootfs is MCU2-Intel 2026.14.3; your car is HW4-Ryzen 2026.20.6.6 — proto/crypto structure
is generation-stable, timing/lifecycle is indicative).

---

## TL;DR — the one answer that decides everything

**Q1c is YES. This is fully air-gappable. There is no Tesla-held key anywhere in the path.**

I found the app's own decryptor (`ke0/e.java`, module `vehicledata_globalPlayRelease`). The entire
scheme is local crypto the phone does end-to-end, precisely because the point of a "PII key" is to
hide location *from Tesla's own relay*:

1. Phone generates an **RSA-2048** keypair locally (react-native-rsa-native, default 2048).
2. Phone sends its **RSA public key (PKCS#1 PEM, as a protobuf `string`)** inside the subscribe
   request.
3. Car generates/rotates a **symmetric AES "PII key" K**, wraps it to your public key with
   **`RSA/ECB/OAEPWithSHA-1AndMGF1Padding`**, and returns the wrapped blob **in-band, over the same
   transport**, inside the very `VehicleData` push you already receive.
4. Phone **unwraps K locally** with its RSA private key. No network.
5. Each PII state field arrives as **AES-256-GCM** ciphertext in a repeated envelope; phone decrypts
   with K. No network.

You already receive step 3's carrier frame over BLE (that's your undecryptable field-11 envelope).
The only thing missing is that **you never sent your subscriber public key**, so the car is wrapping
K to *someone else's* key (a stale registration — almost certainly the official app's, from when this
car was paired to your account). Send `pii_key_request` with **your own** RSA key **inside the
subscription**, over BLE, and the whole thing closes. **[BLE-LOCAL — no cloud required.]**

The **only** cloud-pinned variant is a *different* message (the standalone top-level PII request),
which you must NOT use. Details in Q1c.

---

## Q1a — `PiiKeyRequest` structure (`fc0/z2` → `CarServer.PiiKeyRequest`)

`z2.java`, adapter `type.googleapis.com/CarServer.PiiKeyRequest`, PROTO_3:

| tag | field | wire type | notes |
|----|-------|-----------|-------|
| **2** | `subscriber_public_key` | **STRING** (`ProtoAdapter#STRING`), jsonName `subscriberPublicKey`, OMIT_IDENTITY | **PEM text, not raw key bytes** |
| **4** | `pii_key_expiration` | **INSTANT** (google.protobuf.Timestamp: seconds+nanos), jsonName `piiKeyExpiration`, OMIT_IDENTITY | optional; see below |

**PROVEN.** Note the tags are **2 and 4**, not 1/2/3 — do not guess sequential.

- **Key encoding — PKCS#1 "RSA PUBLIC KEY" PEM.** The keypair is built by `zc/c.java`:
  `o()` → `a("RSA PUBLIC KEY", u(pub))` emits a PKCS#1 `RSAPublicKey` PEM; the matching private side
  `n()` → `"RSA PRIVATE KEY"` (PKCS#1). The unwrap in `ke0/e.f()` strips exactly
  `-----BEGIN/END RSA PRIVATE KEY-----` and rebuilds PKCS#8, confirming the stored key is PKCS#1.
  The field is a protobuf `string`, and the car's D-Bus API takes it as
  `<arg direction="in" type="s" name="subscriber_public_key"/>` (a string). So: **send the full
  PKCS#1 PEM including the `-----BEGIN RSA PUBLIC KEY-----` header lines and newlines, as the UTF-8
  string value of field 2.** (Strong inference — the exact wire bytes for the header/newline handling
  are the one thing worth confirming against a captured official send; everything points to
  "verbatim PEM string".) **[BLE-LOCAL]**

- **Is expiration required? No — omit it on the first request.** `z2`'s encoder writes field 4 only
  when non-null. Its role is the phone telling the car *"the PII key I already hold expires at T"* so
  the car can decide "still valid, don't re-wrap" vs "rotate". On a cold request (you hold no key
  yet) omit it → the car mints and wraps a fresh key. Confirmed by the car-side strings
  `PII key still valid` / `Subscriber's PII key still valid` / `PII key expirations don't match.
  mPiiKeyData->mPiiKeyExpiration` — the car is *comparing an expiration you echo back*, not requiring
  one to mint. **Unit/epoch:** `INSTANT` = protobuf Timestamp (seconds since Unix epoch + nanos).
  **[car-side, indicative]**

- **RSA key size = 2048** (react-native-rsa-native `generate()` → `generateKeys(2048)`), so
  `encrypted_pii_key` on the wire will be **256 bytes**. If you ever see a different length, read it
  off the wire — that's the definitive size. **[on-device measurement to confirm]**

## Q1b — `VehicleData` field 11 and the whole container (`fc0/u5` → `CarServer.VehicleData`)

Your "field 11" is `encryptedData`, **`repeated CarServer.EncryptedData`**, tag 11. The push can
carry several encrypted states at once (one envelope each). Relevant tags of `VehicleData`:

| tag | field | type | in the clear? |
|----|-------|------|---------------|
| 2 | gui_settings | GuiSettings | cleartext |
| 3 | charge_state | ChargeState | cleartext |
| 4 | climate_state | ClimateState | cleartext |
| **5** | **drive_state** | **DriveState** | **cleartext** (speed/gear) — see Q1d |
| 7 | vehicle_config | VehicleConfig | cleartext |
| **8** | **location_state** | **LocationState** | **PII — emptied, moved into field 11** |
| 9 | closures_state | ClosuresState | cleartext |
| 10 | proto_json_version | int32 | |
| **11** | **encrypted_data** | **repeated EncryptedData** | the PII envelopes |
| 12 | upload_reason | string | |
| 14–30 | parked_accessory / charge_schedule / alert / suspension / child_presence / … | | |
| **900** | **pii_key_response** | **repeated PiiKeyResponse** | **the wrapped key comes back HERE** |
| 901 | wrapped_key | authd.EncryptedMessage | |
| 999 | supports_optional_fields | bool | |

**The `EncryptedData` envelope** (`fc0/a0` → `CarServer.EncryptedData`):

| tag | field | type |
|----|-------|------|
| **1** | `field_number` | `CarServer.VehicleDataFields` enum (`w5`) — **the state selector** |
| **2** | `ciphertext` | bytes |
| **3** | `tag` | bytes — **28 B = nonce(12) ‖ gcmTag(16)**, despite the name |

Your read of "field 1 = 8, is it a state selector?" — **yes.** `field_number` is a
`VehicleDataFields` enum whose values **reuse the VehicleData tag numbers**: `drive_state=5`,
`location_state=8`, `charge_state=3`, `climate_state=4`, `closures_state=9`, etc. (one oddball:
`legacy_vehicle_state_media_info=6072`). So value `8` = the ciphertext decrypts into
`LocationState`, i.e. the cleartext content that *would* have been in `VehicleData` field 8. One
envelope carries exactly one state; a push with N PII states repeats field 11 N times. **PROVEN.**

## Q1c — how field 2 is encrypted, and the full recipe to decrypt it

All from `ke0/e.java`. **Every step is local. Air-gappable. [BLE-LOCAL]**

**Unwrap the PII key** (`f()`, once per key rotation):
```
K = RSA_OAEP_decrypt(
      privateKey = your RSA-2048 private key (PKCS#1→PKCS#8),
      transform  = "RSA/ECB/OAEPWithSHA-1AndMGF1Padding",
      params     = OAEPParameterSpec("SHA-1","MGF1",MGF1ParameterSpec.SHA1,PSpecified.DEFAULT),
      input      = PiiKeyResponse.encrypted_pii_key )      // 256 bytes for RSA-2048
// K is raw AES key bytes → SecretKeySpec(K,"AES")
```

**Decrypt each state envelope** (`d()`, per `EncryptedData`):
```
nonce      = tag[0:12]                    // first 12 bytes of field 3
gcmTag     = tag[12:28]                   // next 16 bytes
AAD        = be32(field_number)           // the selector as 4-byte big-endian int
                                          //   e.g. location=8 → 00 00 00 08 ; drive=5 → 00 00 00 05
plaintext  = AES_GCM_decrypt(
               key   = SecretKeySpec(K,"AES"),
               iv    = GCMParameterSpec(128, nonce),   // 128-bit tag length
               aad   = AAD,
               input = ciphertext ‖ gcmTag )           // JCE wants ct+tag concatenated
// plaintext is the protobuf bytes of the state (e.g. a LocationState message)
```

Answering your three sub-questions exactly:
- **Content key:** the symmetric **AES** key `K`, unwrapped by **RSA-OAEP against the
  `subscriber_public_key` you supply**. Your own keypair is sufficient. **Not** ECDH, **not** a
  Tesla/cloud key. → **fully solvable, stop worrying.**
- **Field 3's 28 bytes:** `nonce(12) ‖ gcmTag(16)`, **nonce first**. (Confirms your 12+16 guess and
  fixes the order.)
- **AAD:** the **4-byte big-endian `field_number`** — this is exactly your observed field-11 inner
  "field 1 = 8". It binds each ciphertext to its state slot, so you cannot replay a location blob as,
  say, a charge blob. Matches your independent finding that pushes are AAD-bound.

Car-side corroboration (`QtCarServer` symbols/strings, generation-indicative): `handlePiiKeyRequest(
int, const QString&, const CarServer::PiiKeyRequest&)`, `CarServer::PiiKeyResponse`, `Rotate PII
key`, `VehicleDataPiiKeyRotationPeriod`, `PII key still valid`, `now_ms >=
mPiiKeyData->mPiiKeyExpiration`, D-Bus `check_pii_key` / `get_pii_keys(subscriber_public_key:s)`.
The car mints, rotates, and expires the key; it wraps to whatever public key it currently has on
file — which is why your "no request" pushes are undecryptable (wrapped to a stale key, not yours).

## Q1d — is there a non-PII path to live data?

- **The car's own live GPS position is ONLY in `LocationState` (field 8), which is PII-gated.**
  `LocationState` (`gc0/e0`) holds `nativeLatitudeD/nativeLongitudeD` (122/123),
  `geoLatitudeD/geoLongitudeD` (124/125), `nativeLatitude/Longitude` (106/107), etc. **There is no
  cleartext path to the car's current coordinates.** Live position ⇒ you must run the PII key.
  (Good news: per Q1c, you can.)
- **`DriveState` (field 5) contains NO live position.** `DriveState` (`gc0/u`) has `shiftState` (1,
  gear), `speedFloat` (106, current speed), odometer, and the active-route fields — its *only*
  coordinates are `activeRouteCoordinates` (12) = the **route destination**, not where the car is.
  So **speed + gear + your active-route destination do not require the PII key.**
- **Whether DriveState ships cleartext or is itself encrypted is a car-side choice you must measure.**
  The gate is per-`field_number`. Your probe already showed `location_state` (8) gets emptied and
  moved to a field-11 envelope. To learn DriveState's treatment, run **the exact probe:** subscribe
  with `DriveState_max_update_rate_ms` set (tag 7, below) **and no `pii_key_request`**; then:
  - if `VehicleData` **field 5 arrives populated** → DriveState is cleartext ⇒ **speed/gear for
    free, no PII key**;
  - if instead a **field-11 envelope with `field_number = 5`** appears (and field 5 is empty) →
    DriveState is also gated ⇒ needs the key.
  Given DriveState carries no live lat/lon, cleartext is the likely outcome, but this is exactly the
  kind of thing that diverges MCU2↔HW4, so measure it. **[on-device measurement]**

---

## Q2 — per-state rate tags (complete `VehicleDataSubscription` = `fc0/x5`)

`type.googleapis.com/CarServer.VehicleDataSubscription`. **All tags, PROVEN:**

| tag | field | | tag | field |
|----|-------|--|----|-------|
| 3 | `subscription_duration_s` (int32) | | 12 | `subscription_ping_s` (int32) |
| 4 | `GuiSettings_max_update_rate_ms` | | **13** | **`pii_key_request`** (`PiiKeyRequest`) |
| 5 | `ChargeState_max_update_rate_ms` | | 14 | `ParkedAccessoryState_max_update_rate_ms` |
| 6 | `ClimateState_max_update_rate_ms` | | 15 | `ChargeScheduleState_max_update_rate_ms` |
| **7** | **`DriveState_max_update_rate_ms`** | | 16 | `PreconditioningScheduleState_max_update_rate_ms` |
| 8 | `VehicleState_max_update_rate_ms` | | 17 | `AlertState_max_update_rate_ms` |
| 9 | `VehicleConfig_max_update_rate_ms` | | 18 | `SuspensionState_max_update_rate_ms` |
| 10 | `LocationState_max_update_rate_ms` | | 19 | `ChildPresenceDetectionState_max_update_rate_ms` |
| 11 | `ClosuresState_max_update_rate_ms` | | | |

Your priority states: **DriveState = 7**, ChargeState = 5, ClimateState = 6, ClosuresState = 11.
(All rate fields are int32 milliseconds; a state is included in the push iff its rate is set > 0.)

Sanity-check against your own armed frame `12 0A AA 02 07 18 3C 50 88 27 60 0A`: `AA 02`=tag 37,
`18 3C`=field 3=60 (duration s), `50 88 27`=field 10=5000 (LocationState ms), `60 0A`=field 12=10
(ping s). Decodes clean — confirms the table and that tag 37 = this message. **PROVEN.**

---

## The actionable wire recipe (what to add to your working subscribe)

Inside the `VehicleDataSubscription` (VehicleAction tag 37), add **field 13** = `PiiKeyRequest`:

```
6A <len>                      # x5 field 13 (pii_key_request), wire type 2
   12 <len> <PEM bytes…>      # z2 field 2 (subscriber_public_key) = your PKCS#1 RSA-2048 PUBLIC KEY PEM string
   # (omit z2 field 4 on the cold request)
```
…and set whichever state rates you want, e.g. add `DriveState` at 2 s: `38 D0 0F` (tag 7 = `0x38`,
varint 2000). Everything else stays exactly as your working `navigateTo`-style seal/domain/session.

**Read the response** — it comes back as `Response.vehicleData` (`u5`) over the same BLE link:
- `A2 38 <len> …` = **field 900** (`pii_key_response`, repeated) → inside, `12 <256 B>` =
  `encrypted_pii_key`. RSA-OAEP-unwrap it (Q1c) → K.
- `5A <len> …` = **field 11** (`encrypted_data`, repeated) → `{field_number, ciphertext, tag}`.
  AES-GCM-decrypt with K (Q1c).
- The state's own cleartext field (e.g. `42 00` = field 8 present-and-empty) stays empty for gated
  states.

**Your on-car sweep oracle holds:** the winning candidate is the one that flips `No PII request` →
a populated `pii_key_response` (field 900) whose `encrypted_pii_key` you can OAEP-unwrap and then use
to open the field-11 envelope. If a candidate parses but the unwrap fails, the key field 2 encoding
is off (that's the one place to iterate — PEM header/whitespace).

---

## The routing trap — do NOT use the standalone PII request

There are **two** places a `PiiKeyRequest` can live, and only one is BLE-safe:

- **Embedded: `VehicleDataSubscription.pii_key_request` (x5 field 13).** Rides the subscription's
  transport, which includes `TRANSPORT_BLUETOOTH`. **← use this. [BLE-LOCAL]**
- **Standalone: top-level `carServerAction.pii_key_request` (the `g5` Action, its own field).**
  The app's transport selector `pb0/b.b()` hard-pins any action whose top-level
  `getPiiKeyRequest() != null` to **`TRANSPORT_HERMES` (cloud)** — same branch as `createStreamSession`
  / `streamMessage` / `webrtcRequest`. **← never send this; it is cloud-only by construction.**
  **[CLOUD-ONLY — avoid]**

This is the resolution of RESPONSE-15's "cloud-pinned PII request" worry: that pin is real, but it
only applies to the *standalone* form. The subscription-embedded form is not pinned and is exactly
what you want. **PROVEN** (`pb0/b.java:79-89`).

One consequence worth stating: the official app on iOS/Android registers its subscriber key via the
**standalone (cloud) path**, then subscribes. You will do it in one shot over BLE via the embedded
field. That's a path Tesla's own app doesn't exercise over BLE — so treat the *first* end-to-end
success as the real proof, and expect the usual MCU2↔HW4 caveat.

---

## Q3 — subscription lifecycle over BLE  [car-side; structure PROVEN, timing indicative]

What the firmware shows (`QtCarServer`), and what you must measure:

1. **Ack.** There **is** an ack path: `handleAck(const CarServer::VehicleDataAck&, const QString&)`.
   So the car models phone→car acknowledgement of pushes. Whether it *requires* acks over BLE (vs
   free-running) isn't decidable from symbols — **measure:** subscribe, never ack, watch for
   back-off or drop. Static guess: acks gate flow-control/retransmit, not liveness. There is a
   `CarServer::VehicleData` `request_uuid`/`REQUEST_HASH` correlation (your RESPONSE-15 finding) — the
   ack almost certainly echoes that.
2. **Ping.** `subscription_ping_s` (x5 field 12) is a keep-alive interval, and there is a distinct
   `CarServer::VehicleAction::kPing` case plus `DefaultMaxHeartbeatPingPongMs` / `First ping at`.
   So a ping is its own small `VehicleAction`, **not** a state frame — which is why you "didn't
   obviously receive distinct ping frames" (every *state* push was a state push; the ping is a
   separate, tiny message on the heartbeat interval). Expect a `kPing`-shaped frame at your
   `subscription_ping_s`. **Measure** to capture its exact bytes.
3. **Multiple subscriptions / cap.** Symbols confirm per-subscriber PII-key state
   (`mPiiKeyData`) and rotation but no readable "max subscriptions" constant. Your empirical
   "they accumulate if not cancelled" is the ground truth. **Measure** whether a second subscribe
   from the same key replaces or adds (static hint: keyed by handle+subscriber, so likely *adds*
   another stream unless the duration/handle matches). Always cancel with your corrected
   `12 03 AA 02 00`.
4. **Sleep / keep-awake.** This is the battery question and it is **not** statically answerable from
   the MCU2 image with confidence — and it is exactly where MCU2↔HW4 diverges. The firmware has a
   rich keep-awake framework (`KeepAwakeReason`, `do_not_sleep`, `GUI_phoneLeftBehindKeepAwake`) but
   nothing ties "an active VDS subscription" to a wake-lock in these symbols. **Measure:** arm a
   long-duration subscription, leave the car parked/locked, and watch whether pushes stop at the
   normal sleep transition (subscription silently dropped on sleep — the safe, expected behaviour) or
   whether the car stays awake. **Do not ship a standing subscription until you've confirmed it does
   not hold the car awake.** Recommend bounding `subscription_duration_s` short and re-arming on
   demand rather than a long TTL.
5. **Reconnect.** Not decidable statically; the subscription is server-side state keyed to the
   session/handle, so a BLE drop most likely requires re-arming. **Measure** by dropping the link
   mid-subscription.

## Q4 — is the 1024 B inbound cap a real constraint?  [partly car-side]

- **Your side:** your one-state pushes are 242–243 B, far under both Android's 452 and your 1024.
  A multi-state push (say Drive + Charge + Climate together) will exceed 452 and could approach
  1024. So the cap becomes real only if you subscribe to several states in one subscription **and**
  the car packs them into one `VehicleData` frame.
- **Car side:** there *are* outbound size limits in `QtCarServer` (`Dropping payload of size`,
  `exceeds maximumSize=`, `string length exceeds max size`, `carapi/max_config_size`,
  `max_tesla_electric_payload_size`) — the car will drop, not fragment, an over-cap payload at the
  application layer. But the BLE routable transport itself **fragments** below that (your pushes
  already arrive reassembled), so the practical ceiling is the routable reassembly buffer, not the
  BLE MTU. I could not extract a single authoritative "max VehicleData over BLE" constant from the
  MCU2 image, and it is generation-sensitive.
- **Recommendation (low-risk):** **subscribe to states one or two at a time**, not the full set, and
  keep each push comfortably under 452 B so you stay inside *both* caps and never depend on the car's
  packing behaviour. If you want the combined-push path, **measure** the largest frame the car will
  emit before it starts dropping states. Encrypted states are larger than cleartext (nonce+tag+OAEP
  overhead), so budget ~+45 B per PII envelope.

---

## Q5 — `startBleVehicleUpdates` screen→cadence map  [PROVEN from Hermes; now moot as a fallback]

Since Q1c came back positive, this is no longer your fallback — but you asked, so: I disassembled
`startBleVehicleUpdates` (iOS #153174 → generator #153175). Findings:

- **The cadence is a pure function of the foregrounded screen. There is NO speed/driving modifier.**
  The loop dispatches on `RouteName` (`VehicleLocationScreen`, `VehicleClimateScreen`,
  `VehicleSchedulingScreenV3`, `VehicleControlsScreen`, `VehicleSecurityScreen`,
  `ChargingTSLASiteSelectionScreen`), fetches that screen's state set, then sleeps
  `delay = targetInterval − fetchElapsed` (via `performance.now()` + saga `delay`). Nothing reads
  shift/speed to change the rate. So: **"does it change cadence while driving?" → no, only by
  screen.**
- **Four cadence tiers: 5000 / 2500 / 1650 / 1250 ms.** Fastest (1250) is the security screen;
  slowest (5000) is location. Rigorously proven pairings:
  - **Location screen → 5000 ms** (clean triplet: `'on location screen, fetching location only...'` +
    `'location state'` + `5000`).
  - **Security screen → 1250 ms** (matches your prior unambiguous finding; `1250` sits with
    `'closures & parental controls'` + `'gui settings'`).
  - **Scheduling screen → 2500 ms** (`2500` amid preconditioning/charging-schedule fetch strings).
  - **Controls screen (drive state) → 1650 ms** and **Climate → 5000 ms** are by-elimination +
    cluster adjacency (**inferred**, not proven — the object-literal assembly interleaves registers;
    if you need these exact two nailed, it's a short CFG trace of the array build, or just read the
    inter-push gap on-device per screen).
- **Failure behaviour:** on `RESULT_UNSUPPORTED_COMMAND` / `RESULT_INVALID_COMMAND_REQUEST` the loop
  logs `'stopping BLE vehicle data polling due to unrecoverable command result'` and sleeps ~999999
  ms (effectively stops). Worth mirroring so you don't hammer a car that rejected the command.

Screen fetch verbs (for reference): `setGetdrivestate`/`GetDriveState`, `setGetchargestate`,
`setGetchargeschedulestate`, plus location/climate/closures/parental/gui/tire/parked fetchers.

Note this is the **poll** loop (`useBluetooth=TRUE`, one round-trip per interval) — a *different*
mechanism from the *subscription* push in Q1–Q4. The subscription is strictly better for live data
(car-driven cadence, no per-poll command cost); the poll loop is Tesla's screen-scoped fallback.

---

## Proven vs inferred — quick ledger

| Claim | Status |
|-------|--------|
| Full scheme is local RSA-OAEP unwrap + AES-GCM; no Tesla/cloud key | **PROVEN** (`ke0/e.java`) |
| `PiiKeyRequest` tags 2 (string PEM) / 4 (Instant, optional) | **PROVEN** (`z2`) |
| `PiiKeyResponse` tags 2 `encrypted_pii_key` / 3 / 4 | **PROVEN** (`a3`) |
| `EncryptedData` = {1 field_number, 2 ciphertext, 3 nonce‖tag}; AAD = be32(field_number) | **PROVEN** (`a0`, `ke0/e.d()`) |
| `VehicleData` field 8=location(PII), 5=drive(clear), 11=envelopes, 900=pii_key_response | **PROVEN** (`u5`) |
| Full `VehicleDataSubscription` rate-tag table (Drive=7 etc.) | **PROVEN** (`x5`) |
| Embedded (field 13) rides BLE; standalone top-level PII req is cloud-pinned | **PROVEN** (`pb0/b`) |
| RSA-2048 (→256 B wrapped key), PKCS#1 PEM string | **PROVEN keygen; wire-length: confirm on-device** |
| DriveState cleartext vs gated; sleep/keep-awake; ack/ping/multi-sub timing | **car-side — MEASURE** |
| Q5 controls→1650 / climate→5000 exact pairing | **INFERRED** |

The car-side items are flagged because the rootfs is MCU2-Intel 2026.14.3 and your car is HW4-Ryzen
2026.20.6.6 — the proto and crypto are generation-stable (same `CarServer.*` messages), but push
timing, keep-awake coupling, and size caps can differ. Your on-car sweep is the authority for those.
