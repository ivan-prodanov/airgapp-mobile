# RE REQUEST #15 — the parity gap audit: what airgapp still does worse than the official app

**Requested:** 2026-07-25
**Standing constraint (applies to every answer):** airgapp is **air-gapped — it must NEVER reach Tesla's
servers.** So for every mechanism below, the load-bearing classification is **BLE/local-capable** vs
**cloud-only**. If something needs the backend, say so up front and we drop it; don't design us a path we
can't walk. (RESPONSE-13's LOCAL-vs-PUSH tagging was exactly the right shape — please reuse it.)

**Where we are now (so you don't re-derive it):** native `CBCentralManager` owns the one BLE link full-time
(model (b), RESPONSE-12); routable seal only (legacy AES_GCM_TOKEN deleted); passive entry works foreground,
backgrounded and after cold-boot restoration; **BLE-only DRIVE works** (standing assert per connect + reactive
echo, RESPONSE-11/14); CPD wired (field 55); one always-on foreground frame consumer + one deferring write
lock (RESPONSE-14). Reconnect is now a **standing pending connect** (`retrievePeripherals` + `connect`) after
we measured background `scanForPeripherals` leaving the link down **72%** of the time.
**Car: HW4 Ryzen** (this invalidates RESPONSE-11's pre-Ryzen premise — see P1 below).

Priorities are ours: **P0 = biggest quality win, P1 = known-broken/unknown, P2 = coverage.** Work top-down;
partial answers to P0/P1 beat a complete sweep of P2.

---

## P0-1 — Vehicle-data SUBSCRIPTION (streaming state) instead of our 20 s poll ⭐ biggest UX win

**What we found ourselves (please confirm + complete):** `fc0/g5.java:1388` encodes
`getVehicleDataSubscription()` at **tag 37**, whose message (`fc0/x5.java`) carries
`subscription_duration_s`, `subscription_ping_s`, and **per-state `*_max_update_rate_ms`** fields
(ChargeState, ClimateState, ClosuresState, DriveState, GuiSettings, LocationState, VehicleConfig,
VehicleState, ParkedAccessoryState, ChargeScheduleState, PreconditioningScheduleState, AlertState,
SuspensionState, ChildPresenceDetectionState) plus a `piiKeyRequest` (`fc0/z2` `subscriberPublicKey`,
`fc0/a3` `subscriberPublicKeyExpiration`).

**Why it matters:** airgapp polls VCSEC/infotainment every ~20 s, so our battery %, climate, charge state
and range are up to 20 s stale and each poll costs a round trip. If the car will *stream* state to a
subscribed phone, our whole UI becomes live and cheaper. This is the single biggest quality delta we've found.

**Ask:**
1. What is `g5` (the enclosing message — an `Action`/request union?) and what is the **full wire path** to
   send a subscription: message type, field numbers, domain (INFOTAINMENT 3?), and any required flags.
2. **Is it BLE-capable, or cloud/streaming-endpoint only?** (Decisive. `subscriberPublicKey` smells like a
   cloud/telemetry-fleet mechanism — if it's the Fleet-Telemetry path, say so and we stop here.)
3. If BLE-capable: how do updates arrive — unsolicited `RoutableMessage` pushes on `0213` like
   `vehicleStatus`? Same plaintext `FromVCSECMessage`/CarServer envelope, or a distinct response type?
4. Lifecycle: what `subscription_duration_s`/`subscription_ping_s` does the app use, must the phone re-arm
   (keepalive/ping cadence), and what happens on disconnect/reconnect?
5. Sensible `*_max_update_rate_ms` values the app actually sends (so we don't hammer the car).
6. Does a subscription conflict with, or replace, the `vehicleStatus` VCSEC pushes we already consume?

## P0-2 — UWB / precise localization on HW4: what are we actually losing?

**Context:** you flagged in RESPONSE-14 that on HW4 the app's UWB stack **is** constructed
(`q1.java` `o0()` true → `N0()` "setup UWB" @450), which kills RESPONSE-11's "no UWB on this car" premise.
Our measurements: with the link already up, our challenge→answer is **0–1 s**; drive engages ~**2–3 s** after
the user acts (we've just removed the reconnect cost, so a residual delay would be car-side localization).

**Ask:**
1. **Is UWB required for DRIVE on HW4, or still only an accelerator?** We *do* get drive over BLE today —
   so is UWB purely a latency/precision improvement, or does it gate anything (e.g. an interior-zone
   confidence threshold reached faster/only via ranging)?
2. **What does the UWB handshake look like on the wire** (`mf0/d`, `if0/c`, `VCSEC_FiraRequest`/
   `NISessionRequest`)? Which VCSEC messages start/stop it, and what does the phone send back?
3. **Can a third-party iOS app even do this?** Apple's `NearbyInteraction` accessory flow needs an
   accessory-configuration blob from the device. Does the car supply a standard NI accessory config over
   VCSEC (i.e. we *could* implement it), or does it depend on an Apple/Tesla entitlement or MFi-style
   pairing we can't obtain?
4. **The `0301/0302` bond:** RESPONSE-3/4 found an iOS-side bond, RESPONSE-11 found no `createBond` on
   Android. On **HW4**, is the OS-level LE bond a precondition for UWB ranging — and therefore for
   best-case drive latency? We deliberately avoid bonding (it's what wedges us). What exactly does avoiding
   it cost on HW4?
5. **If UWB is out of reach for us:** what is the *best achievable* BLE-only drive latency, and does the app
   do anything else we don't to speed the car's decision (e.g. RSSI/antenna hints — see P1-2)?

## P1-1 — BLE link stability + reconnect/connection policy (we measured 72 % downtime)

**Ours:** at rssi −77…−96 the car dropped us every ~20–60 s; re-scanning took 1–8 min (iOS background scan
throttling), so walk-ups silently failed. Now fixed with a standing pending connect. But we want *their*
policy, not our best guess.

**Ask:**
1. **Reconnect strategy:** what is `q1.java:1281`'s `postDelayed` reconnect (delay, backoff, retry cap)? And
   what is the **BG-scan timer @1332** for — do they run a background scan *alongside* a pending connect, and
   if so why?
2. On iOS specifically: does `BLEVehicle` hold a **standing `connect()`** to a peripheral retrieved by saved
   UUID (we inferred yes from `retrievePeripheralsWithIdentifiers:` in RESPONSE-12), and does it *ever* scan
   to reconnect a known car?
3. **Connection parameters:** do they request a specific connection interval / latency / supervision timeout,
   or any iOS connect options (`CBConnectPeripheralOptionNotifyOnConnectionKey`, transport bridging)? Our
   drops at −90 dBm may be tunable.
4. **MTU:** what value does the app request, and does it re-request after reconnect? (We negotiate 512-byte
   writes; RESPONSE-12 asked us to verify against `bleFraming`.)
5. Do they **keep the session warm across a disconnect** (reuse sessionKey/counter) or always re-handshake?
   We re-handshake (~300–600 ms); if they keep it warm, how do they handle the counter/epoch safely?
6. Any **link-quality gating** — e.g. ignoring the car below an RSSI threshold to avoid connect churn?

## P1-2 — What the PHONE contributes to the car's localization decision

**Ask:** RESPONSE-11 described the car-side 9-antenna RSSI + `sortedDeltaBayes` vector
(`q1.java:807-857`, `vc0/c1`). Does the **phone ever send** measurements/hints that feed the car's
interior/exterior decision — TX power, its own RSSI readings, `AppDeviceInfo` capability bits, IMU/motion
state (`rd0/t.java:391` `rejectionEnabled`, `DEVICE_STATIONARY`)? Concretely:
1. Is the `DEVICE_STATIONARY` self-rejection ever *armed* in production, and could our not implementing it
   make the car treat us differently (better or worse) than the official app?
2. Does `AppDeviceInfo` (`ob0/e.java:399`, incl. `UWBAvailable`) change how the car localizes or how quickly
   it escalates to a DRIVE challenge? **We currently answer the AppDeviceInfo request — with what?** If our
   reply understates capability, does the car de-prioritize us?

## P1-3 — Session / counter / epoch lifecycle + the resync algorithm

**Ask:**
1. The **`Math.max` counter resync** (`ee0/g.java:298`, `RESULT_SESSION_INFO_RECOVERED`, `ed0/c.java:405`) —
   give us the exact algorithm and *when* it triggers, so our recovery matches rather than approximates.
2. **Epoch: per-key or per-domain?** (RESPONSE-8 left this open as "benign either way".) When does the car
   **rotate** epoch, and what should the phone do on rotation mid-session?
3. The **duplicate/out-of-order fault code + namespace** for a rejected VS frame (RESPONSE-10 residual) — we
   want to recognize it precisely rather than by message-substring.
4. **DRIVE grant lifetime (RESPONSE-14 residual):** does the car always re-challenge before a DRIVE grant
   lapses, or can it lapse silently? If it can lapse silently, our purely reactive design loses drive without
   noticing — and we'd need a keepalive.
5. **Max simultaneous BLE centrals** the car accepts and its N+1 eviction policy (RESPONSE-10 residual) — we
   run phone-native + a Raspberry-Pi forwarder against the same car.

## P2-1 — The 19 state submessages we don't read

We request only **5** of the ~24 `l1.java` state submessages: `chargeState`, `climateState`, `closuresState`,
`driveState`, `locationState`. Missing: `guiSettings`, `legacyVehicleState`, `vehicleConfig`,
`parkedAccessoryState`, `chargeScheduleState`, `preconditioningScheduleState`, `sohState`,
`vehicleDetailState`, `tirePressureState`, `mediaState`, `mediaDetailState`, `softwareUpdateState`,
`vehicleState`, `parentalControlsState`, `alertState`, `lightShowState`, `vehicleImageState`,
`suspensionState`, `childPresenceDetectionState`.

**Ask (a compact table is ideal):** for each — **BLE-readable or cloud-only**, its request field/number, and
the 3–5 fields that actually drive UI. Prioritize: `vehicleState` + `legacyVehicleState` (odometer, locks,
software, sentry?), `tirePressureState`, `alertState`, `softwareUpdateState`, `sohState` (battery health),
`vehicleConfig` (so we can pick the right Godot model/options automatically), `guiSettings` (units — we
currently guess mph/°C).

## P2-2 — Commands the app has that we don't (which are BLE-capable?)

**Ours (BLE-proven):** lock/unlock, wake, frunk/trunk, charge port, charge start/stop, charge limit, amps,
climate on/off + temp, defrost, climate keeper (dog/camp), cabin-overheat, seat heat/cool, steering-wheel
heat, vent/close windows, honk, flash, remote start, sentry, valet, PIN-to-drive, parental controls, speed
limit, homelink, boombox, bioweapon, navigateTo, media (partial).

**Ask — which of these are BLE/local-capable, and their wire shape:**
1. **Summon / Autopark / Actually Smart Summon** (the big one — is it BLE-capable at all, or cloud+streaming?)
2. **Light show**, **suspension height**, **software update start/cancel**, **dashcam/Sentry clip
   save/view**, **media full control** (our `media.*` partially throws "unsupported over BLE"),
   **`navigateWaypoints`** (ours throws: the proto wants Place IDs, not lat/lon — how does the app build a
   multi-stop route, and can it be done offline?), **scheduled charge/precondition writes** (we read
   schedules; can we write them over BLE?).
3. Anything in their command set we haven't listed at all that works over BLE.

## P2-3 — Key management + enrollment parity

**Ask:**
1. Can we **list / rename / remove** whitelist keys over BLE (add works via offline `PRESENT_KEY`)? RESPONSE-11
   said the BLE `WhitelistEntryInfo` read returns no `permissions` on this car — is there any BLE-visible way
   to enumerate keys and their roles/permissions, or is UDS `0x705` truly the only path?
2. What does an **account-signed** key add grant that our offline `PRESENT_KEY ROLE_DRIVER` doesn't?
   (Drive works, so the practical gap may be nil — we want to know what we're missing, if anything.)
3. The **"Upgrade your phone key performance"** re-bond prompt (`READ_BONDING_CHARACTERISTIC_PROMPT`,
   RESPONSE-13 row 5) — what does reading the bonding characteristic actually do, and is it the UWB
   enablement path from P0-2?

## P2-4 — Walk-away auto-lock

RESPONSE-13 found the *notification* is server push, but the **behavior** is car-side. **Ask:** is walk-away
auto-lock decided purely by the car (RSSI/absence), or does the phone participate (a "departed" message,
absence reporting, geofence)? If the phone plays no part, we simply document that it works for us already.

---

## Answer format that helps us most
Per item: **BLE-local | cloud-only**, the wire shape (message + field numbers + domain), the app's own
parameters/cadence, and a **HIGH/MED/LOW** confidence with anchors. Flag cloud-only items **first** so we
don't design around them. Where our current implementation is *already* what the app does, just say
"matches — no change" (that's as valuable to us as a gap).
