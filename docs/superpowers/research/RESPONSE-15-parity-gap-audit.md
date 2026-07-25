# RE RESPONSE #15 — the parity-gap audit

**Answers:** `REQUEST-15-parity-gap-audit.md` (P0 → P1 → P2).
**Method:** 8 trace finders (P0 first) → 2 adversarial-refutation verifiers on the decision-critical P0 claims → synthesizing critic. Sources: Android jadx, the **Hermes JS bundle bytecode** (both platforms), the iOS `TeslaV4` 4.57.5 Mach-O, **QtCarServer on the car image**, and airgapp's own source. 11 agents, ~780 tool calls.
**Headline:** **both P0 headlines deflate under scrutiny — and that is the most valuable result in here.** The genuinely actionable gaps turned out smaller, cheaper and more concrete than the P0 framing implied: a nav off-by-one bug, an odometer already arriving on the wire unparsed, unit settings, an unanswered device-info request, and cold sessions on reconnect.

---

## 0. CLOUD-ONLY — do not build (flagged first, as asked)

**A. Hard-pinned to Hermes by the app's own transport chooser (`pb0/b.java:78-89`):**

| Item | Wire | Note |
|---|---|---|
| Top-level `piiKeyRequest` | `g5` field **51** | **Not** the subscription's optional `x5` field 13 — do not conflate. This is the thing that "smells like Fleet-Telemetry"; the subscription sub-field is not it. |
| `createStreamSession` / `streamMessage` | `g5` 3 / 4 | |
| `webrtcRequest` **data-plane** | `wc0/a` | Signaling is BLE-legal; the DataChannel that actually drives Summon/ASS and live camera is IP/WebRTC. |
| `VideoRequest` (dashcam **viewing**) | `g5` **57** | Field 1 is a URL. Clip **save (47)** and **delete (144)** are BLE-local — only *viewing* is cloud. |

**B. Cloud-account features with no car-local equivalent:** managed-charging sites (67/68/73), charge-on-solar (74/75), rate tariff (55/56), cloud driver profiles (139/140), fleet-telemetry upload, all per-event telemetry (`remoteLog:forceSend:`, `sendEvent:`, `requestSysdiagnose…`, TimelineTracker), shared-fleet scan RSSI thresholds (remote-config).

**C. Cloud-fed *gates* you must NOT try to satisfy — all bypassable or default-off, so ignoring them is faithful:**
- `jf0/d.java:80-104` UWB capability gate (cloud `car_type` + `api_version≥77` + feature flag) — **runtime-irrelevant**: `q1.java:912` calls `jf0.d.j(vin, forceEnable=true)` the moment a real `FiraRequest` arrives.
- `AuthConfig.auth_rejection{enabled,min_version}` (default **enabled=false**) + `MOBILE_APP_FEATURE_IMU_ALERT_IS_VISIBLE` — the two arming flags for `DEVICE_STATIONARY` self-rejection. Air-gapped ⇒ permanently disarmed ⇒ **not implementing it is faithful, not a gap.**
- iOS bonding preconditions — only gate the `0301/0302` LE bond, which only buys *background* NI.

**D. Cloud-only by absence of any wire field — stop looking:** **key RENAME** (`VCSEC.KeyMetadata` has exactly one field, `keyFormFactor`; names live only in the owner API — airgapp already documents this) and **key permission bits over BLE** (`WhitelistEntryInfo.permissions` comes back empty for every key on this car; UDS `0x705` remains the only positive read).

---

## P0-1 — Vehicle-data subscription: **BLE-legal, car-side complete, but NOT the app's BLE strategy. Demote to a 12-byte experiment.**

My own pre-dispatch anchor (`RoutableMessageDecoder` decodes the subscription response) turned out **true but not load-bearing** — the verifier refuted the "the app sends this over BLE" reading, and the honest verdict splits:

| Sub-claim | Verdict |
|---|---|
| Protocol-legal over BLE (domain, seal, flags, decoder) | **CONFIRMED / HIGH.** `carServerAction → DOMAIN_INFOTAINMENT(3)`; `SIGNATURE_TYPE_AES_GCM`; `FLAG_ENCRYPT_RESPONSE` set for this action on any transport (`fd0/f.java:279-283` + `TeslaCommandRequest.java:750-757`). |
| **The app sends it over BLE** | **REFUTED / HIGH.** `eb0/f.java:402-419` consults the BLE-first chooser *only* when JS leaves the transport list empty — the VDS sagas never do. All three call sites pass `buildCommandRequest(…, useBluetooth=false, …)` → `[TRANSPORT_HERMES]` unconditionally. The sibling saga `startBleVehicleUpdates` (#159624) passes `useBluetooth=**TRUE**` — same module, opposite flag. **Deliberate.** |
| The car *can* push over the same BLE link | **SUPPORTED / MED-HIGH — on new car-side evidence.** QtCarServer: `SignedCarAPIServiceImpl::Process(…, int handle, …)` → `sendSubscription` → `CarDataHandler::handleSubscription(handle, phoneKey, …)` → `SubscriptionInfo(Subscription, int handle)` → `transmitCarData` → `handleSendToInfotainmentDispatcher(handle, Response)` → `InfotainmentDispatcherProxy::Reply`. **Handle-keyed, zero transport selection.** |
| The app's parameters are replayable on BLE | **REFUTED / HIGH.** `Peripheral.java:46,646-651`: `MAX_RX_BUFFER_SIZE = 452` — any inbound routable longer is **discarded**. The app's 8-state map is several KB. |
| It replaces airgapp's 20 s poll | **REFUTED.** `useCarLink.ts:114` is the **VCSEC domain-2** read (different ECU, awake while the MCU sleeps). A domain-3 subscription can only replace `useCarLink.ts:119` (the 60 s infotainment read). |

**Four previously-inferred items are now closed statically by QtCarServer strings:** `subscription_duration_s:`, `subscription_ping_s:`, `SubscriptionExpiration`, `First ping at`, `Sent ping.`, `subscription expired:`, `max_update_rate_ms:` / `. ms to wait:`, `Equal to mInFlightCarData.… / Not equal…, sending.`, `handleAck:`, `No PII request`. ⇒ `duration_s` **is** a car-enforced absolute TTL; the **car** generates pings; per-state `max_update_rate_ms` **is** a car-side rate limiter **with change-detection** (unchanged state isn't resent); the car **does** handle acks; **`piiKeyRequest` is optional** (`No PII request` proceeds).

**The exact probe frame — one state, not eight.** Envelope identical to your existing `getChargeStateAction` path (`builders.ts:407-413`): domain 3, `flags=0x02`, keep the 16-byte `request_uuid` (**it is the correlation tag**). Sealed body is **12 bytes**:

```
12 0A AA 02 07 18 3C 50 88 27 60 0A
12 0A        Action field 2 (vehicleAction), len 10
  AA 02 07   VehicleAction field 37 (vehicleDataSubscription), len 7
    18 3C    f3  subscription_duration_s          = 60
    50 88 27 f10 LocationState_max_update_rate_ms = 5000
    60 0A    f12 subscription_ping_s              = 10
  (f13 piiKeyRequest deliberately OMITTED)
```
Cancel = `12 02 AA 02 00` (duration 0). **App's real parameters, reference only — do NOT replay on BLE:** duration 600 s, ping 10 s, re-armed every 60 s, per-state 1000 ms (250 ms for LocationState), ping watchdog 40 s, response wait 10 s.
**Client-side requirement if it works:** keep the request context alive past the first response (mirroring `ce0/l.java:197-204`, where `isDataSubscription` no-ops the eviction paths).

> **Recommendation: rank this ~17th (Tier 6).** Your per-state `getVehicleData` reads (`builders.ts:407-447`) **already are** the official app's real BLE state strategy. VDS is a one-frame experiment, not a build item, until the car answers. Also: it is **kill-switched in 4.58.0 on both platforms** (`vehicleSupportsVehicleDataSubscription` = unconditional `return false`).

---

## P0-2 — UWB on HW4: **do NOT pursue ranging. Do spend ~1 day on the protocol hygiene around it.**

**Accelerator, not a gate — five independent structural proofs, none refuted:**
1. `AuthenticationLevel` has exactly three values {NONE, UNLOCK, DRIVE} — **no "ranged" tier**.
2. The sole auth-decision function `rd0/t.java:628-685` contains **zero** references to the UWB packages (`jf0`/`mf0`/`if0`/`nf0`), and neither do its two call sites (the standing DRIVE assert and the reactive echo).
3. The car's **own failure diagnostic** (`vc0/c1.java`, `alertHandlePulledWithoutAuth`) has 25 fields — 9× RSSI, 9× highThresh, 4× Bayes — and **no ranging term**. The car explains a failed handle-pull entirely in BLE RSSI + Bayes.
4. Neither phone-telemetry message (`vc0/h2` iOS, `vc0/g2` Android) has a UWB field.
5. Phones on Tesla's **background-ranging blacklist** (Pixel 6/7, SM-N986…) never build the stack yet **get DRIVE on the same HW4 cars**.

**Third-party NI is FEASIBLE — that premise was wrong.** `codesign -d --entitlements` on `TeslaV4.app` returns 15 entitlements, **none** matching nearby/accessory/MFi; the NI surface used is public API; the car hands over a **standard opaque Apple accessory-config blob** in `NISessionRequest` field 2; `nearby-interaction` is a public background mode.

**So what do you actually lose?** Only **background NI ranging** — and that is gated by the **LE bond**, not by UWB (Android runs full FiRa UWB with **zero `createBond`**). **Keep the never-bond policy.** The cost of ignoring the car's UWB probes today is genuinely **unmeasured** (LOW-MED) — bound it by logging before acting.

**Cheap wins instead (Tier 3):** answer the car's probes so it stops asking — `47 → NISessionResponse{errorCode=ERROR_UNSUPPORTED_PLATFORM}` (ToVCSEC **42**), `48 → NISessionStopped` (**43**), `53 → NIBatchResponse` (**56**), `19 → all-zero FiraCapabilities` (**58**) — **all on domain 2**. ⚠ **Trap:** `NISessionResponse(42)`/`NIBatchResponse(56)` are missing from Android's `getDomain()` and would fall through to domain 3 — that is **dead code** (Android is FiRa-only). The iOS union order is byte-identical to Android's, so both belong on **DOMAIN_VEHICLE_SECURITY(2)**. Copying Android's mapper verbatim would send them on the wrong domain.

---

## P1 verdicts

### P1-1 — Link/reconnect: **you MATCH on everything controllable. One real gap: cold sessions.**
- **Standing pending connect, never scan to re-acquire — MATCHES.** iOS official: `recoverPeripheralIfNeeded` → `retrievePeripheralsWithIdentifiers:` → `connectPeripheral`, **no scan**; `didDisconnectPeripheral` reconnects immediately with zero delay. Your switch away from background scanning (the 72 % downtime) was **the correct fix**. Android's extra layers (500/2000 ms status-keyed reconnect, a 3500 ms one-shot GATT rebuild, a 2000 ms hardware-offloaded BG-scan watchdog running *alongside* the pending connect) are Android-specific.
- **Connect options `nil` — MATCHES** (the official app imports **no** `_CBConnectPeripheralOption*` symbols; all three sites pass 0).
- **Connection interval / PHY / priority — MATCHES, and not tunable by anyone.** Zero `requestConnectionPriority`/`setPreferredPhy` anywhere; they pin `PHY_LE_1M` and deliberately don't take Coded PHY; iOS exposes no API. Your −90 dBm drops are **car-proposed parameters** — only obtainable with a sniffer.
- **MTU — you are BETTER.** Android requests 250 per connect; **iOS never queries MTU at all**. You read `maximumWriteValueLength` per connect. Don't chase an iOS `requestMtu` — there isn't one.
- **RSSI gating — MATCHES (don't add one).** The −95 dBm figure is Android-only and scoped solely to "does a scan sighting justify a GATT rebuild"; it never gates the pending connect.
- **⭐ Session warmth — the one actionable gap.** Tesla **persists** `VehicleSessionInfo{epoch, counter, clockTime}` per (vin, key, domain) to disk, surviving disconnect *and* process death; on connect it only marks it *unconfirmed*. You throw it away (`PassiveEntryCentral.swift:538-543`), costing a full ECDH + SessionInfo round-trip (~300-600 ms) on the critical path of every post-reconnect walk-up. **Recipe:** persist {epoch, counter, clockBase, vehiclePubRaw} in Keychain (`AfterFirstUnlockThisDeviceOnly`, re-derive the key — store no key material); merge `counter = max(stored, fresh)` **only when the epoch is byte-identical**, else **adopt fresh wholesale**; re-anchor `clockBase` on the **first frame of each connection** (never trust a stored offset); persist the bumped counter **before** the write goes out.

### P1-2 — Phone's contribution to localization: **essentially nil. MATCHES everywhere except one gap.**
No TX power, no phone RSSI, no distance estimate, no motion state (Android) ever goes up. Everything the phone sends is a verdict the car asked for or a static capability self-report. `estimatedDistance` has **no non-zero writer anywhere in the APK** — the official DRIVE grant is literally `08 02`, exactly what you send. `DEVICE_STATIONARY` self-rejection ships in **shadow mode** (both arming flags cloud-only, default off) and grants anyway.

> **⚠ Your brief's premise is wrong:** airgapp does **not** answer the car's `AppDeviceInfo` request — `proto/vcsec.proto:224-232` declares `UnsignedMessage` with only tags 1/2/4/16 (no 39, no 40), and `PassiveEntryCentral.swift:422-441` never inspects FromVCSEC field **44**. That's the one cheap gap here.

### P1-3 — Session/counter/epoch: **all four residuals close; no DRIVE keepalive needed (MATCHES).**
All five sub-items are BLE-local. The `Math.max` merge applies **only on identical epoch** (on epoch change: **adopt wholesale / reset counter to received** — a naive `max()` here is the one thing that would break signing across a rotation). **DRIVE grant: MATCHES — the official app has no keepalive and no expiry timer either; adding one would be a divergence.** Car-side epoch-rotation triggers and the max-central/eviction policy remain VCSEC-ECU-internal (measurements listed below).

---

## P2 — compact verdicts

**P2-1 state submessages: all 24 are BLE-LOCAL — zero cloud-only.** QtCarServer has a per-submessage handler for 22/24 (only `suspensionState` and `childPresenceDetectionState` lack one — and you already get CPD over VCSEC field 55, **MATCHES**). The binding constraint is the **452-byte** inbound cap ⇒ **one submessage per request**, which `gateway.ts:590-628` already does. **Two of your four "priority" items need NO new request:** odometer lives in `DriveState.odometer_in_hundredths_of_a_mile` (**field 105**, already in your generated types) and locks/doors in `ClosuresState` — both already arriving, just unparsed. Request numbers: guiSettings **1**, chargeState 2, climateState 3, driveState 4, legacyVehicleState 5, vehicleConfig **6**, locationState 7, closuresState 8, parkedAccessory 9, chargeSchedule 10, preconditioningSchedule 11, sohState **12**, vehicleDetailState **13**, tirePressure **14**, media 15, mediaDetail 16, softwareUpdate **17**, vehicleState **18**, parentalControls 19, alertState **20**, lightShow 21, vehicleImage 22. Drop `vehicleImageState` (bulk texture, not a 3D model) and avoid `legacyVehicleState` (111-field superset — will blow the 452 B ceiling).

**P2-2 commands: ~30 BLE-buildable commands you're missing.** BLE-LOCAL: lightShow (117/116), suspension level (118), SW-update schedule (29)/cancel (25), dashcam save (47)/delete (144), media favorites (17/18) + absolute volume (16 f3), **coordinate waypoints (90)** — your Place-ID-only premise is outdated when the car advertises `WAYPOINTS_REQUEST_ACCEPTS_COORDINATES` — scheduled charge/precondition writes (41/42 legacy; 97/99 + removes), sunroof 32, guestMode 65, recirc 45, auto-seat/steering-wheel 48/70/71, tentMode 94, lowPower 76, setVehicleName 54, units 132-136, calendar 24, Cybertruck outlets/powershare/lightbar. **Summon/Autopark/ASS: signaling is BLE-legal but the drive-control DataChannel is WebRTC/IP — treat as CLOUD-ONLY** (do not read "signaling is BLE-local" as "Summon is buildable offline").

**P2-3 keys:** LIST **works** over BLE (roles yes, permissions/name no); REMOVE is **buildable** via the same card-tap arm (`presentKeyWhitelistOperation` carrying `removePublicKeyFromWhitelist`) — **but probe on a spare key first: constructible ≠ accepted**; RENAME **cloud-only** (no field exists); an **account-signed add grants nothing extra for DRIVE** — only key-management authority a card tap already covers. The "Upgrade your phone key performance" prompt reads `0301` to force an iOS LE bond whose sole purpose is **background UWB** — i.e. the P0-2 path you're right to skip.

**P2-4 walk-away auto-lock: 100 % car-side (VCSEC ECU). The phone plays no part. Works already — just document it.**

---

## MATCHES — no change (as valuable as the gaps; don't churn these)
Routable-seal-only; `FLAG_ENCRYPT_RESPONSE`; `AES_GCM_Response` round-trip; fault-6 → swap epoch/counter in place with no teardown; bump-counter-before-seal; **standing DRIVE assert once per connect**; reactive echo at the car's own `requestedLevel`; **no DRIVE keepalive**; `estimatedDistance = 0`; no phone RSSI/TX/motion uplink; `DEVICE_STATIONARY` omitted; standing pending connect with no re-acquire scan; `options: nil`; no PHY/priority tuning; no RSSI gate on connect; per-connect MTU query (better than iOS); **never bond**; one always-on frame consumer + one deferring write lock; one submessage per request; per-state `getVehicleData` over BLE (**this is the app's real BLE strategy — you're already at parity on what ships**); keep the 20 s VCSEC poll.

---

## RANKED BUILD LIST (value ÷ effort)

**Tier 0 — bug, minutes**
1. **Fix `NAV_ORDER`** → `{REPLACE:0, PREPEND:1, APPEND:2}` (`builders.ts:340`). Today **every nav send prepends instead of replacing**, and APPEND emits 3, which the car maps to null. Active user-visible defect, zero risk.

**Tier 1 — free data already on the wire, hours**
2. Parse `DriveState.odometer` (**field 105**) + `power` (103) + `active_route_*` — no new request, no new bytes.
3. Parse the rest of `ClosuresState` already received: `is_user_present`, `valet_mode`, `door_open_*`, `center_display_state`, `speed_limit_mode`.
4. Make the decoder **preserve unknown proto fields** rather than reject (a firmware bump must not break the parse).

**Tier 2 — one small new request each, half a day**
5. **`getGuiSettings` (req 1)**, cached per VIN — kills your mph/°C guesses. Read tags **104/106/108** (not the obsolete 4/6/8).
6. **`getVehicleDetailState` (req 13)** — software version, vehicle name, FSD version. Best value per byte in the set.

**Tier 3 — protocol hygiene the car is actively asking for, ~1 day**
7. **Send `AppDeviceInfo`** (ToVCSEC **40**, domain 2, existing seal) ~1 s after connect and on FromVCSEC **44**, with `UWBAvailable = UNAVAILABLE_UNSUPPORTED_DEVICE(2)`, `batchedNISessionsSupported=false`, real OS/app versions.
8. **Answer the UWB probes** (47/48/53/19 → 42/43/56/58, **domain 2**).
9. **Consume FromVCSEC 45 `alertHandlePulledWithoutAuth`** and log it — free car-side ground truth (per-antenna RSSI, thresholds, Bayes, `connectionCount`, `unknownDevicePresent`). **This is the only instrument that can measure passive-entry latency — land it before any latency work.**

**Tier 4 — the real latency win, 1-2 days**
10. **Warm/persist the session** per the recipe in P1-1 (removes ~300-600 ms from every post-reconnect walk-up). Verify the epoch-change branch does reset-to-received, not `max()`.

**Tier 5 — breadth, days**
11. `getVehicleConfig` (6) once, cached forever (model picker + capability gates). Send alone; measure size first (near 452 B).
12. Commands, cheapest first: media favorites/volume; dashcam save/delete; lightshow; SW-update schedule/cancel; sunroof; tent mode; guest mode; setVehicleName; suspension (gated on `vehicleConfig` 110/179).
13. `getSohState` (12), `getTirePressureState` (14), `getSoftwareUpdateState` (17), `getVehicleState` (18).
14. Key **REMOVE** via the card-tap arm — probe on a spare key first.
15. Scheduled charge/precondition writes.
16. Coordinate waypoints (90) — after confirming the feature bit and recovering the delimiter.

**Tier 6 — experiment, not a feature**
17. **VDS one-frame probe (M1)** — the 12-byte subscribe above.

---

## Residual unknowns (each with its measurement)
**VDS-M1** (send the 12-byte frame; log every inbound domain-3 routable's `request_uuid`/flags/`AES_GCM_Response_data` — settles whether the dispatcher's BLE arm delivers *unsolicited* pushes at all, since that binary is not in this rootfs); **M2/M3'** (flags=0 → are pushes plaintext? then add ONE state at a time — is the 452 B cap bilateral or phone-side only?); the **VDS role gate** (does a `ROLE_DRIVER` key satisfy `checkAllowRequired`?); VDS lifecycle on BLE (TTL expiry, resume-after-reconnect, ack requirement); **UWB back-off** after declaring `UNAVAILABLE`; the **accelerator-vs-gate** A/B (time-to-drive-enable + field-45 counts, airgapp vs official app, same handset/car, ≥10 approaches — needs #9 first); **Apple NI bonding requirement** (probe unbonded on a spare device); `hardware_model_sha256` semantics (per-model RSSI calibration?); car-side **epoch-rotation triggers**; **max centrals + eviction order**; the car's **connection parameters** (sniffer/HCI — the real determinant of your −90 dBm drops); warm-session **clock drift** across a long disconnect; per-submessage **serialized sizes** on this HW4 car; whether HW4 firmware adds suspension/CPD CarServer handlers; **tire-pressure wire unit** (bar vs psi — check against the door-jamb placard before rendering); PRESENT_KEY authority limits (non-self remove? ROLE_OWNER via card tap?); coordinate-waypoints delimiter; the car's **iBeacon UUID** (the iOS-correct replacement for Android's BG-scan watchdog — but needs Location-Always).

## Honesty notes
- **Method warning that invalidates some earlier negatives:** a blanket recursive `grep` over the 3.7 GB rootfs is unreliable at that scale — it returned nothing for `VehicleDataSubscription` *and missed QtCarServer itself*, which a targeted `strings` search then found. **Treat every prior "not present in firmware" claim derived from a recursive grep as unproven** and re-run with targeted binary searches. (It weakens but does not overturn "the zone→auth-level policy is in no image we hold" — that is independently supported by VCSEC being a separate ECU.)
- **Confidence ceiling:** every claim about what the car *does* with what it receives (UWB back-off, zone→level policy, DRIVE re-challenge cadence, max centrals, epoch rotation, whether BLE pushes are unsolicited) is inference from the phone's model of the car. VCSEC firmware is in no image we hold, and the InfotainmentDispatcher binary is not in this rootfs either.
- **P2-1 sizes are arithmetic estimates, not measurements** — don't gate a design on them.
- **P2-3 "REMOVE is buildable"** proves the message is *constructible*, not that VCSEC *accepts* a PRESENT_KEY-signed non-self removal.

## Provenance
Traces `P0-1-data-subscription`, `P0-2-uwb-hw4`, `P1-1-link-stability`, `P1-2-phone-localization-contribution`, `P1-3-session-lifecycle`, `P2-1-state-submessages`, `P2-2-commands-parity`, `P2-3-keys-and-walkaway`; verifiers `V1-subscription-ble` (**PARTIALLY_SUPPORTED** — refuted the app-sends-over-BLE reading, rescued the conclusion with new QtCarServer evidence), `V2-uwb-gate` (**PARTIALLY_SUPPORTED** — confirmed accelerator-not-gate, corrected "third-party can't do NI"); synthesizing critic. Full findings: `~/Work/tesla-firmware/out/req15-findings/*.md`.
