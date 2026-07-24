# RE REQUEST #14 — CONFIRM two findings I pulled from the decompiled app myself

**Requested:** 2026-07-23
**Type:** confirmation, not open research. I hand-read the Android jadx sources to answer "how does the
official app handle (1) the proactive standing-DRIVE cadence and (2) the foreground passive-entry
responder architecture," because I was about to build both by inference and that violates our rule.
Please independently verify (or refute) the two claims below against the binary — I read obfuscated
decompiled Kotlin, so a second pair of eyes on the anchors matters before I ship code that matches them.

Firmware/app on disk: HW4 Ryzen (corrected 2026-07-23 — RESPONSE-11's "pre-Ryzen MCU2" was wrong).
All anchors are in `~/Work/tesla-firmware/work/app-re/jadx/sources/com/teslamotors/plugins/ble/q1.java`
(the `q1` BLE auth engine) unless noted.

## Claim 1 — the proactive standing-DRIVE is asserted on EVERY connect, with NO throttle
- `connectionEstablished()` (@~1219) → on `getOnWhitelist()` calls `G0(new String[]{"connectionEstablished"})`
  (@1226) and separately `postDelayed(r0, 1000ms)` (@~1228).
- `G0(String[])` (@429) is the standing-DRIVE assert: guards `I != null && getOnWhitelist()`, then
  `I.d(…, vc0.m.AUTHENTICATION_LEVEL_DRIVE, …)` (@433) and sends it. **No time gate, no last-asserted
  timestamp, no cooldown** anywhere in `G0` or its caller.
- **My conclusion:** the app re-asserts standing DRIVE on every `connectionEstablished` (i.e. every
  (re)connect), bounded only by whitelist membership. My airgapp code had added a 3-min throttle — a
  deviation I'm now removing.
- **CONFIRM:** (a) is there truly no throttle/dedup on the standing-DRIVE assert path? (b) Does the DRIVE
  `AuthenticationResponse`'s `expiresAt` (~vehicleClock+6s, RESPONSE-9) mean the *car-side* DRIVE grant is
  short-lived and must be refreshed — i.e. is "on every connect" also a freshness requirement, not just an
  optimization? (c) What is the `postDelayed(r0, 1000ms)` at @1228 (a second, delayed assert? a status read?).

## Claim 2 — the foreground passive/challenge handling is ALWAYS-ON (one persistent receive handler, not session-scoped)
- `y(VehicleMessage, Peripheral)` (@1436, `@Override // …ble.g0`) is the central's receive callback. On
  **every** inbound message with a `FromVCSECMessage` it calls `B0(fromVCSECMessage, peripheral, …,
  receivedBytesTimestamp)` (@1443).
- `B0(w0Var, …)` (the FromVCSECMessage dispatcher, body around @765-800) handles, from ONE frame:
  vehicleStatus (@~770), `w0Var.getAuthenticationRequest()` → `z0(authenticationRequest, j11)` (@775-777,
  the reactive challenge ECHO), `getGenealogyRequest`, `getAppDeviceInfoRequest`, etc.
- `z0(vc0.p, long)` (@631) is the reactive echo that answers the challenge at `getRequestedLevel()`.
- **My conclusion:** the one per-VIN central runs a persistent notification handler that processes EVERY
  `0213` frame — challenges, status, CPD — continuously, independent of any command session. The passive
  responder is therefore ALWAYS-ON, not tied to command exchanges. airgapp today ties passive/CPD handling
  to the command transport's open session (a divergence); I'm restructuring to a single always-on
  foreground frame consumer with a warm session, matching this.
- **CONFIRM:** (a) is `y()`/`B0()` genuinely the sole, always-running receive path (i.e. challenges are
  answered whether or not a command is in flight)? (b) Is there a SINGLE signer/counter serialization such
  that a challenge answer and a command never sign concurrently (I assume one central = one serial write
  queue = one shared VS counter)? (c) Does `B0` also carry the CPD path (`CPDMessage` field 55 →
  `CPDNotification_E`), or is CPD dispatched elsewhere? (This confirms our foreground CPD detection sits on
  the same always-on path.)

## Why it matters to airgapp
Model (b) byte-pipe: native owns the ONE central; JS signs in the foreground. If Claim 2 holds, the
foreground passive responder must be a single persistent consumer of the native `onFrame` stream (not
per-command-session), sharing ONE warm session + ONE write lock with the command path — else two signers
race the shared VS counter. Claim 1 → drop our throttle. Please confirm both before I trust my own read.
