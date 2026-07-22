# RE RESPONSE #10 — connect-and-hold + one-session-over-two-transports + fast-fail hedging

**Answers:** `REQUEST-10-connection-hold-and-transport-hedging.md` (Q1–Q5 + the corrected build).
**Method:** static RE of `authd` + `command-router` (Go, `radare2`) + the decompiled Tesla 4.58.0 app (jadx) + airgapp. **3 trace finders → 2 adversarial-refutation verifiers → completeness critic.**
**Verdicts:** T1 connection-binding **HIGH**, T2 official-app **HIGH**, T3 duplicate/concurrency **HIGH**; V1 connection-agnostic **SUPPORTED/HIGH** (4 refutation angles failed), V2 duplicate-reject **SUPPORTED/HIGH** — and the critic corrected V2's fault-guard, which is the single most important build detail here.

> **Proven-vs-inferred boundary (unchanged from #8/#9):** the frame-build (app), the `authd` reference verifier, and `command-router` (the shared relay) are all **on-image and proven**. The **final byte-level verify of a `DOMAIN_VEHICLE_SECURITY` (unlock) frame runs on the VCSEC ECU, which is off-image** — confirmed here by the phone-key GATT UUIDs (`…b2d1-43f0-9b88-960cebf8b91e`) being **absent from the entire rootfs** and present only in the app. So a direct-BLE unlock never touches `authd` or `command-router`; VCSEC is the sole arbiter, and its match to the proven model is **strong inference**, closed by the probes below.

---

## TL;DR

**Q1 = YES — one crypto session over two pipes is viable.** A sealed VCSEC frame is **connection-agnostic**: it is validated purely by `{keyId, epoch, counter, nonce, tag, domain, VIN, expiresAt}`, the `routing_address` rides the **unsigned** envelope (so it's not covered by the GCM tag and can be rewritten freely), and the car **source-learns** the return path per message. So **the identical sealed bytes validate over the Pi link or the phone's BLE central**, and the response comes back over whichever pipe delivered the request. Build the connect-and-hold + same-frame fallback — **as single-writer**, because the counter/epoch/32-window are **per-KEY and shared across pipes**.

**Two corrections you must apply before building:**
1. **The fallback's duplicate-fault guard cannot key off the fault *number*.** The universal and VCSEC fault enums assign **opposite meanings to the same integers** (universal `6`=counter-reject = *landed*; VCSEC `6`=`AES_DECRYPT_AUTH` = *not* landed). Key off the **fresh `SignedSessionInfo`** the car attaches to the reject instead — if `returned epoch == sealed epoch && window-top ≥ N`, the frame landed = success.
2. **The official app is NOT a precedent.** It's connect-and-hold **one** BLE + **strictly sequential** fallback to Tesla **cloud** (Hermes WebSocket / signed-OAPI HTTPS / owner-API REST) — never two live BLE centrals under one VCSEC key. It gets its concurrency safety *for free* from sequential dispatch; your two-pipe design must supply single-writer discipline **explicitly**.

---

## Q1 — session bound to a CONNECTION or only to (key, epoch)? **Only (key, epoch) — connection-agnostic** (SUPPORTED/HIGH; VCSEC-final-verify inferred)

All four refutation angles failed:

1. **No per-connection element in the seal.** The AAD is exactly **7 fields** — `{SIG_TYPE, DOMAIN, PERSONALIZATION=VIN, EPOCH, EXPIRES_AT, COUNTER, FLAGS}` — on **both** the app builder (`gd0/d.java:113-125`) and the `authd` verifier (`authentication.(*Peer).extractMetadata@0x716080` makes exactly 7 `metadata.Add` calls; `verifyGCM@0x71a480`). The on-wire signature payload (`rc0/b.java`) is only `{epoch, nonce, counter, expires_at, tag}`. The one plausible connection field — `signer_identity.handle` (`rc0/h.java`, a per-KEY lookup alias) — is **not in the AAD** and is substitutable by the full pubkey (airgapp always sends the full pubkey). **Nothing binds a frame to a connection.**
2. **`routing_address` is unsigned and not per-connection.** It lives in the envelope's `from_destination` (`sc0/a.java:29-30` Destination oneof, tag 2; `sc0/h.java:32-33` tag 7) — **outside** the ciphertext and signature_data, so rewriting it doesn't break the GCM tag. In airgapp it's **per-session** (`randomBytes(16)` once per `openDirectSession`, `session.ts:353`); in the official app it's per-command (`requestId`). Either is fine.
3. **The response follows the delivering connection, not a fixed link.** `command-router`'s `checkFromAddress@0x6f8460` imposes **no** per-connection ownership on `routing_address` (only reserved *domains* are owned); `getAddressee@0x6f7a40` + `routeMessage@0x6f88e0` resolve the reply's `to_destination` against a **source-learned** `RoutingTable` (address→current-client) and forward over that client's GATT link. So the reply returns over whichever pipe most recently delivered a frame from that address.
4. **No per-connection handshake is required.** The counter/epoch/window are per-KEY state (`Verifier` under a per-key mutex, `Verify@0x719ea0`); `SessionInfoRequest` is a non-mutating per-key *read*. A second pipe under the same enrolled key resumes from the known counter — no re-registration.

**Consequence:** two pipes can share **one** session (one key/epoch/counter/routing_address). But because that window is **shared**, uncoordinated concurrent use races both the window and the router's address→pipe learning → **single-writer is mandatory** (not optional).

---

## Q2 — the 2-central gate (VCSEC multi-central-aware; cap off-image)

VCSEC is **provably multi-connection-aware** — `vcsec.(*AlertHandlePulledWithoutAuth).GetConnectionCount@0x687fa0`, `connectionCount`(tag 3)/`unknownDevicePresent`(tag 4), mirrored in the app (`f0.java:464`, `q1.java:802`). But the **max simultaneous central count and the N+1 policy (refuse-connect vs evict-oldest/weakest) are VCSEC-ECU-internal** — not in this image. The official app is **never** two-BLE-centrals to one car (its second path is cloud), so it gives no answer.

**Degrade (recommended):** because session state is per-KEY and **not** connection-bound, **eviction is non-fatal** — an evicted central reconnects and **resumes with the same counter/epoch/key, no re-handshake** (as long as single-writer kept the counter from drifting >32 behind). So: **BLE-native when the phone is present, Pi otherwise;** keep one pipe hot and the other a **cold, on-demand-resumable standby** rather than racing two hot centrals; pay only reconnect latency (~1–10 s) on fallback, never a correctness cost. Confirm the cap with probe (c).

---

## Q3 — duplicate-frame handling: exactly-once, but the *reply* is a fault, and the guard is subtle (SUPPORTED/HIGH; VCSEC dedup inferred)

- **`command-router` has a real idempotent `ResponseCache`** (LRU-100, keyed `domain.routing_address.uuid`: MISS→route, PENDING→drop, COMPLETED→resend the stored reply) — **but it is bypassed for your case.** Phone↔VCSEC BLE terminates on the VCSEC ECU (GATT UUIDs absent from the image), so a direct-BLE `VEHICLE_SECURITY` frame **never reaches** `command-router`'s cache. For **two BLE pipes**, VCSEC's own anti-replay is the only dedup.
- **`authd` (the on-image reference verifier) has no reply cache** → a duplicate counter → **`INVALID_TOKEN_OR_COUNTER(6)` + fresh `SignedSessionInfo`**, window state restored, no lockout. Verify-then-act under a per-key mutex → **the action applies exactly once**; a near-simultaneous two-pipe race gets exactly one accept + one reject (proven atomic for authd; inferred for VCSEC — probe (c) P-RACE).
- **So "no double-toggle" is TRUE** — but the second (fallback) delivery returns a **fault, not a success reply**. The hedging logic must interpret that fault as "the other leg already landed."

**⚠ The correction that makes this safe — do NOT key the guard off the fault number.** The two fault namespaces collide on the integers:

| code | universal `MessageFault_E` (`gateway.ts:166`) | VCSEC `SignedMessage_information_E` (`passiveEntryCapture.ts:86`) |
|---|---|---|
| 5 | `INVALID_SIGNATURE` — **not landed** | `FAULT_TOKEN_AND_COUNTER_INVALID` — **landed** |
| 6 | `INVALID_TOKEN_OR_COUNTER` — **landed** | `FAULT_AES_DECRYPT_AUTH` — **not landed** |

A bare-number guard ("treat 5/6 as success") would mark a **never-executed** command as done, or re-fire a landed one. **Correct guard: key off the fresh `SignedSessionInfo`** the car attaches to the reject (`authd` proven: `signatureError@0x719060 → signedSessionInfo@0x719740`; VCSEC inferred — probe (b) confirms it's attached). Under single-writer, counter `N` belongs only to this command, so:

- returned `epoch == sealed epoch` **and** `window-top ≥ N` → **the frame's counter was consumed → LEG LANDED → SUCCESS**, do not reseal. (Namespace-independent, unambiguous.)
- clean `operationStatus == 0` on either leg → success.
- `epoch != sealed epoch` (epoch rolled mid-command, rare within ~1 s) → **INDETERMINATE**: for idempotent reads reseal at the new epoch; for **actuation (unlock), re-query the car's actual state and reconcile — never assume success.**
- genuine `INVALID_SIGNATURE`/`AES_DECRYPT_AUTH` with epoch match but `window-top < N` → **not landed → real failure**, surface it.

---

## Q4 — how the official app does multi-transport: **connect-and-hold BLE + strictly-sequential to cloud** (APP-PROVEN, HIGH). Not a precedent.

- **Connect-and-hold:** `BLEService` is boot-started (`BLEBootReceiver`), foreground (`startForeground(333)`), continuously scanning; on discovery it builds a `Peripheral` and holds the GATT with `connectGatt(autoConnect)`, a reconnect wakelock, and `setStayConnectedWhenUnauthorized`. The command path never dials out — it posts to the bound service and returns `RESULT_BLE_SERVICE_DISCONNECTED` if not connected.
- **Selection & fallback:** `pb0/b.a` builds a **priority-ordered** list — **BLE always first**, remote = Hermes (WebSocket) / signed-OAPI (HTTPS) / owner-API (REST). The `eb0/f.i()` iterator sends **one** dispatcher, and advances by exactly +1 only if the result isn't in `TERMINAL_RESULTS = {SUCCESS, NOMINAL_ERROR}`. **Strictly sequential, single-in-flight — never a parallel/take-first hedge.**
- **Remote is Tesla cloud, not a BLE proxy** (all bearer-token). So the app **never** has "same VCSEC key, two live BLE sessions"; its shared `sessionInfoManager` consumes counters one-at-a-time *because* dispatch is sequential. **It is no template for your topology or its concurrency discipline.**
- **Timeouts:** one **60 s global** per-command cap; **no per-transport reply timeout** in the loop; per-transport internal retries: **BLE = 10 × 100 ms**, cloud = 3 × 3000 ms. (Your ~1 s hedge-trigger is a *new* mechanism — the app has no per-transport reply-wait to copy.)

---

## Q5 — counter discipline (SUPPORTED/HIGH)

Confirmed safe: **one crypto session, one local counter, seal once (`counter += 1`), replay the byte-identical frame on fallback — never a new counter.** airgapp already increments once per seal (`session.ts:560/629`) and the official app enforces single-in-flight per `(vin,key)` via the `SigningGate` (`ee0/g.java:764-802`, retry re-enters with the same `ownerCommandId`). The single-writer rule holds **even with one JS runtime** — one in-flight sealed counter across **both** pipes at a time.

---

## The corrected design (the deliverable)

Build a **new "hedged exchange"** — it does not exist today (`transportSelector.ts:105-113` catches only `openSession` failures, never a mid-flight exchange error, so it cannot swap a live command between pipes).

1. **Single-writer, one-in-flight counter (mandatory).** Only one command (one counter) outstanding across **both** pipes at a time; don't seal `K+1` until `K` resolves (success, landed-via-fault, or terminal). Extend `queue.enqueue(vin,…)` (`gateway.ts:284`) so **both legs of one command are the same enqueued unit**, not a new counter. This is what makes "duplicate-fault = landed" sound: the only frames bearing counter `N` are the ≤2 legs of command `N`.
2. **Seal once, replay identical bytes.** `counter += 1` exactly once; the fallback resends the byte-identical frame (same counter, nonce, tag, uuid, routing_address). Never reseal per transport — identical bytes give clean per-key window dedup and (for any MCU-relayed leg) a `ResponseCache` content collision.
3. **Duplicate-fault guard = `SignedSessionInfo` epoch+window-top**, not the fault number (see Q3 table). Dedupe by `ownerCommandId`/uuid and apply this short-circuit **before** `evaluateFault`'s generic retry — see the build-critical fix below.
4. **Share one `routing_address` across both pipes** (keep airgapp's per-session model). It keeps the two legs byte-identical. **Consequence you must handle:** the router maps one address to **one current client** (last-writer-wins), so the success reply can return on whichever pipe delivered **most recently** — *not* necessarily the pipe you sent leg-1 on. Therefore the hedged exchange **must listen on BOTH pipes and correlate by `request_uuid`** (`bleCorrelation.ts:frameAnswersRequest` already matches routing_address OR request_uuid — use it).
5. **~1 s is a hedge-*trigger*, not a deadline.** Send over the preferred warm pipe; if no correlated answer in ~1 s, send the identical bytes over the other; keep the overall command's longer bounded deadline. **Prefer a sequential stagger over a true parallel fan-out** — the ~1 s gap minimizes true concurrency at the shared window, which defends the one unproven step (VCSEC window atomicity). A same-counter double-accept would require *both* a non-atomic VCSEC window *and* sub-ms overlap; single-writer + the stagger makes that vanishingly unlikely (confirm with P-RACE).
6. **Degrade on eviction (non-fatal).** BLE-native when the phone is present, Pi otherwise; one hot pipe + one cold-resumable standby; never race two hot centrals if a 2-central cap is observed; serialize the counter across any handoff; treat eviction as expected (the session resumes without a re-handshake).

### ⚠ Build-critical airgapp fix (found while verifying — latent today, fatal if you ship the hedge)
`evaluateFault` (`session.ts:128-136`) classifies faults `4/5/6/15/17` as **session-stale → retryable → `refreshCachedSession` → reseal at N+1** (`gateway.ts:356-361`). On a **single** transport that's correct. On a **hedge where leg-1 already landed**, that path would refetch and **RE-FIRE at N+1 → double-actuation.** The hedged path must dedupe by `ownerCommandId`/uuid and apply the epoch+window-top short-circuit **before** `evaluateFault` runs. (Not live today — airgapp doesn't dual-deliver yet — but it's the exact bug the two-pipe design would introduce.)

---

## On-car probes (close the VCSEC-inferred parts)

Setup: one enrolled key; Pi live VCSEC session (central #1) at window-top `T`; a second BLE central (phone-native, #2) to the same VIN. Use `vcsecInformationRequest GET_STATUS` (idempotent — no physical actuation) for accept/dup tests. Read replies on `0000021**3**-b2d1-43f0-9b88-960cebf8b91e`, decode **both** universal `signedMessageStatus.signedMessageFault` and the inner VCSEC `operationStatus`/information fault (airgapp already has `bleCorrelation.ts`, `gateway.ts:faultName`, `passiveEntryCapture.ts`).

- **(a) P-DUP + P-ROUTE — connection-agnostic accept + response routing.** Seal one frame at `T+1` → bytes `B`. Deliver `B` on #1 → expect success (`operationStatus=0`, window `T→T+1`). Deliver **byte-identical** `B` on #2 → **viable iff** (i) a counter reject **with** fresh `SignedSessionInfo` (`epoch==B.epoch`, `window-top≥T+1`) and no second effect, **or** (ii) a cached success (action still once); **refuted iff** the action fires twice. Then change **only** `fromDestination.routingAddress` on a fresh `T+2` frame (leave ciphertext+signature intact), deliver on #2 → expect it still validates and the reply returns to the new address.
- **(b) Duplicate second reply — pin the guard.** Record the #2 reply's **namespace** (universal `signedMessageFault` vs VCSEC `operationStatus`), the **numeric code** (distinguish VCSEC 5/6 vs universal 6), and **whether `SignedSessionInfo` (epoch+top) is attached**. Cross-check: a deliberately **wrong-epoch** frame must produce a *different* signal than a same-epoch counter replay (so the guard can tell "landed" from "epoch-stale/not-landed").
- **(c) 2-central cap + eviction + race.** Bring up centrals up to N+1, reading `connectionCount`; record the max and whether N+1 is **refused** or the oldest **evicted**. On an evicted central, reconnect and send a fresh frame at the next counter **without** a new handshake → expect it validates (confirms per-key state survives eviction). **P-RACE:** deliver identical `B` on both centrals within a few ms → viable iff exactly one success + one reject; refuted (VCSEC window non-atomic) iff two successes.

---

## Residual unknowns (all VCSEC-ECU-internal) + provenance
VCSEC final-verify connection-agnosticism; the exact fault **code+namespace** for a duplicate BLE VS frame (and whether it attaches `SignedSessionInfo` — the guard depends on it); whether VCSEC has its own idempotent cache; VCSEC window RMW atomicity under a true two-central race; the max-central count + N+1 policy. Each has a probe above.

Traces `T1-connection-binding`, `T2-official-app-multitransport`, `T3-duplicate-and-concurrency`; verifiers `V1-connection-agnostic`, `V2-duplicate-reject-not-success` (SUPPORTED/HIGH; flagged the `evaluateFault` double-actuation latent bug); completeness critic (corrected the fault-namespace guard, the epoch-roll ambiguity, and the shared-address response-routing hazard). Findings in `~/Work/tesla-firmware/out/req10-findings/`. Key anchors: `gd0/d.java:113-125`, `sc0/a.java:29`, `sc0/h.java:32`, `rc0/b.java`, `rc0/h.java`; `authd extractMetadata@0x716080 / Verify@0x719ea0 / SlidingWindow.Update@0x71b5c0`; `command-router routeMessage@0x6f88e0 / getAddressee@0x6f7a40 / checkFromAddress@0x6f8460 / NewResponseCache@0x6f6480`; app `pb0/b.a`, `eb0/f.i`, `BLEService`/`Peripheral`, `ee0/g.java:764`; airgapp `session.ts:128/353/560`, `gateway.ts:284/356`, `transportSelector.ts:105`, `bleCorrelation.ts`. **Builds on RESPONSE-8/9; no supersession — this is additive.**
