# RE RESPONSE #14 — CONFIRM: proactive-DRIVE cadence + always-on single-serialized responder

**Answers:** `REQUEST-14-...md` (confirm/refute two hand-read claims).
**Method:** independent re-read of `com/teslamotors/plugins/ble/q1.java` (+ `ye0/n.java`, `ye0/j.java`, `ee0/g.java`, `gd0/d.java`) by me, then an adversarial verification workflow (2 refuters + critic). One refuter (Claim 2) failed to format its structured output; the critic re-did the Claim 2 trace itself, so nothing is lost.
**Verdict: BOTH CLAIMS CONFIRMED (HIGH).** Your read is correct. Two ship-critical refinements below — heed them so "drop the throttle" and "always-on consumer" don't turn into subtly wrong code.

---

## Claim 1 — proactive standing-DRIVE on every connect, NO throttle → **CONFIRMED (HIGH)**

- **(a) No throttle — confirmed.** `G0` (`q1.java:429`) guards *only* `this.f56955a.I == null || !getOnWhitelist()` (`:430`); asserts `AUTHENTICATION_LEVEL_DRIVE` hard-coded at `:433`; dispatches via `f56976v.h(rVar, currentTimeMillis(), cb)` (`:439`) with no time gate. **`G0` has exactly one call site** (`:1226`, inside `connectionEstablished` = `j(Peripheral)`), and `AUTHENTICATION_LEVEL_DRIVE` is the sole live use app-wide (`f0.java:91` is a `when`-map ordinal, not a call). The connection-start stamp `f56975u` (written `:1224`) is **read only once**, at `i0()` `:508`, to build handle-pull telemetry — **never to gate a re-assert**. The only three `postDelayed` timers in `q1` are device-info (`:1227`), reconnect (`:1281`), and BG-scan (`:1332`) — **none re-asserts DRIVE.** → **Drop your 3-min throttle; it has no counterpart in the app.**
- **(b) Freshness — you do NOT need a proactive drive-refresh timer.** `expires_at` is a **per-frame anti-replay** value (`clock + offset`, `gd0/d.java:107`), stamped into each signature's metadata — *not* a phone-side refresh obligation. Ongoing DRIVE freshness is **car-driven**: the only re-sign path is the reactive echo `z0` (`q1.java:631`), reached from `B0` (`:775-777`) on an inbound `AuthenticationRequest`, which signs at the **car's** `getRequestedLevel()` (`:660`). There is **no periodic proactive DRIVE re-assert** anywhere. So the app's model is: **one proactive assert per connect + reactive echo whenever the car re-challenges** — nothing more.
- **(c) `r0()` confirmed** (`q1.java:550`) = `sendDeviceInfoResponse` → `f56976v.j(ctx)` (`ye0/n.java:146`, the `AppDeviceInfo` handshake). Not a second DRIVE assert, not a status read.

> **⚠ REFINEMENT #1 (don't over-correct):** "no throttle" ≠ "re-assert continuously." The app fires `G0` **exactly once per connect, PROACTIVELY and synchronously at `connectionEstablished`** — it does *not* wait for the first challenge. So your single always-on `onFrame` consumer must **keep an explicit one-shot proactive DRIVE assert at connect**; a purely reactive loop that only answers inbound frames would **miss the initial assert and might never reach DRIVE** if the car doesn't spontaneously challenge. Removing the 3-min gate removes a *minimum interval*, it does not add continuous re-assertion.

---

## Claim 2 — foreground responder is ALWAYS-ON, one persistent handler, single serialized signer → **CONFIRMED (HIGH)**

- **(a) Always-on — confirmed.** `y(VehicleMessage, Peripheral)` (`q1.java:1436`, `@Override ble.g0`) is the sole receive callback; on every inbound with a `FromVCSECMessage` it calls `B0()` (`:1443`). `B0` (`:734`) answers `getAuthenticationRequest() → z0()` **inline on every frame**, with no gate on an open command session — challenges are answered whether or not a command is in flight. It also dispatches vehicleStatus, handle-pull alert (the 9-antenna RSSI/Bayes vector), whitelist/key status, and **CPD**.
- **(c) CPD on the same path — confirmed.** `B0` `:889` handles `getVCSEC_CPDMessage() → getCPDNotification()` → `INITIAL/ESCALATED_WARNING` → notification (`y0.l`) + a `CPD_NOTIFICATION_RESPONSE_*` ACK, routed back through the same `ye0.n` dispatcher (`ye0.n.i`). So your foreground CPD detection sits on the same always-on consumer — correct.
- **(b) Single serialized signer — confirmed, with the precise mechanism.** Every outbound message type — DRIVE-assert (`G0`), reactive auth-echo (`z0`), CPD-response, device-info, **and user commands (lock/unlock/drive)** — funnels through the one `ye0.n f56976v` (ctor `:407`) → the dispatcher `ye0.j` (`implements mb0.a`), which enforces **one in-flight request per VIN**: `inflightRequests` (`ye0.a`, `:97`) + `priorityQueue` (`ye0.o`, `:100`, internally `synchronized`); `K()` enqueues (`:980`) and starts only when `inflightRequests.b(vin)==null` (`:960/:986`); on finish `J()` clears and `R()` pumps the next (`:944-953`). **That dispatcher IS the serialization.** (The `SigningGate` `ee0/g.java` `ReentrantReadWriteLock` (`:45/:230`) + `Math.max` resync (`:298`) protects the per-key session *store*; `i()` is a per-`commandId` ownership tracker, **not** a blocking write mutex.)

### Does airgapp need its OWN write lock? **YES.**
The single-consumer *is* the write lock — **but only if the command path and the `onFrame` reactive-responder share that one consumer** (exactly your "one warm session + one write lock" design). `Math.max`-resync is **not** a substitute: it's a cross-session/restart/transport **recovery net** (surfaces as `RESULT_SESSION_INFO_RECOVERED`, `ed0/c.java:405`), not an in-process concurrency primitive. The DRIVE-assert, the reactive echo, and all VS-domain commands share **one** per-key `DOMAIN_VEHICLE_SECURITY` counter (the auth-response is a VCSEC `ic0.b`, `ob0/e.java:1132`). Two concurrent signs on that counter → a **hard car reject** (duplicate / out-of-order counter) → the second frame is dropped, recoverable only via a resync round-trip + retry.

> **⚠ REFINEMENT #2 (lock semantics):** make it a **DEFERRING serializer** (a queue/mutex that *blocks-then-runs*), **not a drop-on-contention try-lock.** The app **queues** the loser rather than dropping it, and the auth-echo is **time-boxed** (~6s car window), so the critical section must be **short**: hold the lock across the whole `read-counter → sign → increment → write` sequence so the shared counter can never be consumed twice concurrently, but release fast so a queued auth-echo still fits the car's window.

---

## airgapp implementation checklist (all app-consistent)

1. **Drop** the 3-min DRIVE throttle — no interval gate exists in the app.
2. **Assert DRIVE exactly once per BLE connect, proactively at `connectionEstablished`** (mirror `G0`), then stop. Do **not** re-assert on every `onFrame`.
3. **No proactive drive-refresh timer.** Implement the **reactive echo**: on every inbound VCSEC frame carrying an `AuthenticationRequest`, sign an `AuthenticationResponse` at the **car's** `requestedLevel` (not a hard-coded DRIVE). This is the app's only keep-alive.
4. **Single always-on foreground `onFrame` consumer** routes auth-echo, CPD-response, command-status, **and** user commands through the **same** consumer.
5. **One warm session + one DEFERRING write lock** shared by the command path and the `onFrame` responder; hold it across `read→sign→increment→write` so the shared VS counter is never consumed twice concurrently; release fast.
6. Keep **`Math.max` counter-resync** as a recovery net for restart/drift — not for concurrency.
7. CPD on the same path is correct.

---

## Residual unknowns (VCSEC-inferred / off-image) + one cross-cutting flag

- **Car-side DRIVE grant lifetime + re-challenge cadence are off-image.** The app's safety rests on the assumption that **the car always re-issues an `AuthenticationRequest` before a DRIVE grant lapses**; your one-per-connect + reactive-echo design inherits that same assumption. If the car ever lets a grant expire *silently* without re-challenging, a purely reactive design would lose DRIVE without noticing — worth an on-car watch (sit in the car, hold connection, see whether DRIVE persists without the car re-challenging).
- **The `~6s` `expires_at`** is VCSEC/native-stamped (from RESPONSE-9), not app-proven; the APK only proves per-frame `clock+offset`. Don't bake `6s` as a hard app-derived constant.
- **Shared-instance assumption:** that the `ye0.n` injected into `q1` (`f56976v`) wraps the *same* `ye0.j` as the UI command path is strongly-inferred (both injected from `BLEService`), not read from a construction line — but single-in-flight-per-VIN holds regardless of instance count (keyed by VIN). For airgapp the equivalent guarantee is *your* design choice: one consumer, one lock.
- **⚠ HW4 cross-cutting flag (not part of these two claims, but consequential):** you corrected the car to **HW4 Ryzen** — so RESPONSE-11's "BLE-only drive because this pre-Ryzen car has no UWB anchors" **premise is invalid**. On this car the UWB stack **is** active (`o0()` true → `N0()` "setup UWB" `q1.java:450`). REQUEST-14's two claims are BLE-layer and UWB-independent, so they're unaffected — **but the drive-*localization* question (why drive won't engage) may now genuinely involve UWB / the `0301/0302` bond you avoid.** RESPONSE-11's "drive is achievable BLE-only" conclusion should be re-examined for an HW4 car before you conclude a permission/localization fix will suffice.

## Provenance
Direct read: `q1.java:429/433/439/508/550/631/660/734/775-777/889/1213/1226/1436/1443`, `ye0/n.java:135/146/407`, `ye0/j.java` (dispatcher one-in-flight-per-VIN), `ee0/g.java:45/230/298/811`, `gd0/d.java:107`, `ob0/e.java:1132`, `ed0/c.java:405`. Verification workflow `req14-confirm` (C1 refuter CONFIRMED/HIGH; C2 refuter failed to format — critic re-traced Claim 2). Findings `~/Work/tesla-firmware/out/req14-findings/`. Builds on RE #8/#9/#10 (shared counter, routable seal, single-writer) and #12 (model-b single central).
