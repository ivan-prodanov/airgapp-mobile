# RE REQUEST #7 — how the Tesla app architects passive entry (native, one central, background)

**Requested:** 2026-07-21
**Goal:** design airgapp's passive-entry to match the official app's ARCHITECTURE — a native
background BLE service — instead of the JS approach we just proved doesn't work. We want to build
M2 (background presence) correctly the first time, from RE, not assumption.

## What we empirically found (please confirm or refute against the decompiled apps)

We shipped a "dedicated passive-entry BLE link" in JS: a SECOND `DirectBleTransport` (hence a second
`CBCentralManager`) held open for passive entry, running alongside our command path (which for us is
usually the Raspberry-Pi network forwarder). On-car diagnostics over a full session:

- **`link: UP` = 0** — the dedicated link never once established.
- **`Operation was cancelled` × 16**, **`connect timed out (link wedged)` × 24**, **real
  `iosErrorCode 14` (peer-removed-bond) = 0.**
- The command-path BLE `openSession` and the dedicated link's BLE attempts interleave against the
  **same peripheral**, each calling `cancelConnection` on the other. They knocked each other down
  continuously, and the repeated timeouts even manufactured FALSE bond-wedge verdicts.

**Our conclusion:** two `CBCentralManager` instances in one iOS app, both connecting to the same car,
cannot coexist — they cancel each other. Passive entry only ever worked through the *inline* responder,
i.e. when the ONE command-path BLE connection was up. We've now disabled the dedicated JS link.

→ **Q0. Is that conclusion correct?** Does the official app use exactly **one** `CBCentralManager`
(iOS) / one `BluetoothGatt` client (Android) for EVERYTHING — passive entry, commands, telemetry —
rather than separate managers per concern? Cite where the single manager is constructed and shared.

## The core questions

### Q1 — Central/connection topology
- One shared central for passive entry AND commands, or separate? (Q0.)
- Does the app keep the BLE connection **permanently open while in range** to receive challenges
  instantly, or connect on-demand per approach? What triggers a connect — the phone scanning, or the
  car advertising and the phone reacting?
- How are the VCSEC command characteristics (`0212/0213/0214`) and passive-entry challenge frames
  multiplexed over the one connection? Same notify characteristic, same session, or distinct?

### Q2 — Background execution (the crux of M2)
- **How does passive entry work while the app is SUSPENDED?** Specifically on iOS: does it rely on
  **CoreBluetooth State Preservation and Restoration** (`CBCentralManagerOptionRestoreIdentifierKey`
  + the `bluetooth-central` background mode)? Cite the restore identifier / Info.plist modes if
  visible.
- When the car sends the challenge to a suspended app, what wakes the process — a characteristic
  notification via state restoration? A connection event? And how long does iOS give it to respond?
- Does passive entry survive **force-quit**, or only suspend? (We assume force-quit kills it — confirm.)
- Android equivalent: foreground service, `BLE_PERIPHERAL`/companion-device, or a connection held by
  a bound service? Cite.

### Q3 — The signer in the background
- We already have the seal working in JS (4-byte-IV AES-GCM, RE #2 — proven on-car). But RE #2 Q2
  said a JS/Hermes runtime is **not guaranteed alive** on a background CoreBluetooth wake. So:
- Does the official app compute the challenge response in **native code** (Swift/Kotlin) so it can
  sign during a background wake without the JS runtime? Or does its RN bundle stay resident?
- If native: where does the native signer get the **session key and counter** — is the ECDH +
  key derivation also native, and where is the private key stored (Keychain / Keystore) and read from
  during a background wake?
- What is the smallest native surface we'd need: just the sign step, or the whole VCSEC session
  (ECDH handshake + counter management) in native?

### Q4 — Coexistence with our Pi command path
This is our specific constraint and the thing we must not get wrong:
- Our commands normally go over the **Pi (network)**, and passive entry needs **local BLE**. Given Q0
  (one central), if a **native** service owns the single BLE central for passive entry, how must the
  **JS side** behave to avoid re-introducing the two-manager contention? Options we see:
  (a) JS never touches BLE at all — all BLE (commands included) goes through the native central, JS
  keeps only the Pi path; or
  (b) native owns BLE exclusively and JS commands are Pi-only whenever native holds the connection.
- Which does the official app's structure imply is correct? Is there a single native BLE layer that
  BOTH the command path and passive entry call into (i.e. the RN command path is itself just a bridge
  over the native central)?

### Q5 — Connection lifecycle & range
- How does the app decide it's "in range" and should hold the link — RSSI threshold, advertisement
  presence, region monitoring? Any hysteresis so it doesn't thrash at the edge of range (which is
  exactly where our two managers thrashed)?
- On disconnect (walked away), does it actively reconnect in a loop, or wait for the OS restoration
  callback? What backoff?

## Deliverable we want
A concrete target architecture for airgapp: the native module surface (iOS + Android), the background
mechanism, where the signer/keys live, and the exact rule for JS↔native BLE ownership so commands
(Pi) and passive entry (native BLE) never contend. Cite decompiled locations + confidence, and flag
anything not statically determinable that we should measure on-car (we have the pipeline and can wedge
/ walk up on demand).

## Constraints
- Static RE of the iOS Mach-O, both RN bundles, Android jadx, and the car firmware, as before.
- Do NOT assume our JS findings are the only truth — if the official app does something other than a
  single central, tell us; the contention conclusion above is ours to be checked, not a given.
