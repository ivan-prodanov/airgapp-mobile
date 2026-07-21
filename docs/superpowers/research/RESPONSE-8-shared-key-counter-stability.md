# RE RESPONSE #8 — is a shared key across Pi + phone-native provably unstable, or can a cutoff save it?

**Answers:** `REQUEST-8-shared-key-counter-stability.md`.
**Method:** static RE of the MCU2 firmware `authd` (Go, x86-64, `radare2` on `/usr/bin/authd`) + `command-router`, the decompiled Tesla 4.58.0 Android app (jadx), and airgapp's own port. **4 finders + 5 adversarial-refutation verifiers + 1 completeness critic** (the verifiers were told to *break* each claim; a claim only survives as SUPPORTED if refutation failed).
**Verifier verdicts:** C1 static-identity **SUPPORTED/HIGH**, C2 window-32 **SUPPORTED/HIGH**, C3 no-poison/no-lockout **SUPPORTED/HIGH**, C4 two-keys-independent **PARTIALLY_SUPPORTED/MED**, C5 legacy-asymmetry **SUPPORTED/HIGH**.

> **The one boundary that governs every answer:** the VCSEC *enforcement* firmware is a **separate microcontroller, not in this image** (zero phone-key GATT UUIDs `000002{11..14}-b2d1-43f0` anywhere in the rootfs; VCSEC reached only via the `com.tesla.VCSECRemote` proxy). `authd` is the MCU's client/relay and the car-role verifier for **`DOMAIN_AUTHD`/infotainment only** — it is **not** the enforcer for phone→VCSEC unlock/drive. So everything below is split into **PROVEN** (in this image) vs **INFERRED** (VCSEC almost certainly runs the same shared-protocol library, but its counter rule, session model, connection cap, and anti-abuse are off-image). I mark every claim. The decisive facts for your decision are genuinely on the VCSEC side — I give the exact on-car measurement for each.

---

## TL;DR — the verdict, and it changed under adversarial review

1. **One shared key is NOT catastrophic on the *routable* path, but it is affirmatively *unsafe* on the *legacy passive-entry* path you actually use — and neither is "provably race-free."** The two paths are different anti-replay schemes (proven), and the legacy one (IV = the counter) is the sharp edge.
2. **Cutting the Pi session does NOT make one key safe by itself, and the car does NOT auto-cut the Pi.** REQUEST-8's option (2) ("a native connect evicts the Pi car-side") is **not** something the in-image layer does — `authd` has no per-connection session object to evict — and it is **unproven (not disproven) for VCSEC**. Don't build on it.
3. **Two keys is the robust answer** — it removes the counter race *and* the nonce-reuse hazard *by construction* — **but it is not unconditionally "provable," and it is gated on one unknown: does VCSEC tolerate ≥2 concurrent BLE centrals?** (It is provably multi-connection-*aware*; the cap is off-image.) Measure that first; it gates one-key and two-key equally.
4. **If you keep one key, the only provably-safe form is strict single-writer serialization** (presence mutual-exclusion: exactly one of Pi/phone ever signs, onto one counter — which is literally what Tesla's own app does per-`(vin,key)`). Autonomous concurrent signers on one key, on the legacy path, is the one thing you must not ship.

**Recommendation: enroll the Pi and the phone-native central as two separate keys** (two whitelist slots), *after* an on-car check that VCSEC keeps both centrals connected. If a second enrollment is operationally unacceptable, run **one key with hard single-writer serialization** and never let both sign concurrently.

---

## The reframe you need before the verdict: there are TWO anti-replay schemes, and your two paths use different ones

The counter question only makes sense once you see that "the counter" is two different things:

| | **Routable / universal** (your **command** path, Pi-relayed) | **Legacy VCSEC `SignedMessage`** (your **passive-entry** path) |
|---|---|---|
| Wire | `RoutableMessage` + `AES_GCM_Personalized{epoch,nonce,counter,expiresAt,tag}` | `SignedMessage{token, ciphertext, sigType=AES_GCM_TOKEN(3), tag, keyId, counter}` |
| **GCM nonce** | **random 12 bytes** (`crypto.ts:336`), counter in AAD | **the counter itself**, `IV = be32(counter)` (`passiveEntryResponder.ts:112`) |
| Anti-replay fault enum | `MessageFault_E`: `INVALID_TOKEN_OR_COUNTER=6`, `REPEATED_COUNTER=26` | `SignedMessage_information_E` (**separate enum**): `FAULT_IV_SMALLER_THAN_EXPECTED=3`, `FAULT_TOKEN_AND_COUNTER_INVALID=5`, `FAULT_AES_DECRYPT_AUTH=6` |
| Verifier location | **`authd` in-image (PROVEN)** for `DOMAIN_AUTHD`; VCSEC-domain **INFERRED** same lib | **VCSEC ECU only — off-image**; decode-only stubs in `authd` |
| Which car uses it | `apiVersion≥80` (or Cybertruck≥74, or VIN∋"ROB") — `ob0/d.java:c()` `vehicleSupportsRoutableOverBle` | pre-80 cars; and it is what airgapp emits for passive entry regardless |

Two independently-verified facts make this the crux:

- **The counter is genuinely shared within the VCSEC domain, under one key** (C2, C5, PROVEN app-side): `CommandActionsKt.getDomain()` maps `authenticationResponse` **and** `rkeAction`/`closureAction`/`informationRequest`/`whitelistOperation` all to `DOMAIN_VEHICLE_SECURITY` (`:23-24`); `ee0/g.java:48,51` keeps exactly one `VehicleSessionInfo` per `(vin, sourcePublicKey, domain)`. So a passive-entry grant and a lock/unlock share **one** counter under one key. Only infotainment (`carServerAction`) is a separate counter.
- **Tesla's own app already names this race** (PROVEN): `gf0/b.java:369-371` logs `"WARNING! VCSEC and phone IV were inconsistent outside of pairing. VCSEC: %d Phone: %d"` and reconciles with `Math.max(old,new)` (`ee0/g.java:298`). That warning fires precisely when *another actor advanced the car's counter* between your fetch and your send. The multi-client counter race is a **known, handled** condition in the official app — handled by *resync*, not by eviction.

---

## Q1 — the exact anti-replay check + fault + persistence

**Routable path (PROVEN in `authd`, HIGH):** a **sliding window of size 32**, not strict-monotonic.
`SlidingWindow.Update @0x71b5c0` and the inlined copy in `Verifier.Verify @0x71a0f6`: state = `uint32 top` + `uint64 bitmap`.
- `counter > top` → **accept**, advance (shift bitmap by the delta).
- `counter ∈ [top−32, top−1]` and its bit unset → **accept**, set the bit.
- `counter == top`, or already-seen in-window, or `> 32` below top → **reject**.
- Reject fault = **`INVALID_TOKEN_OR_COUNTER` (6)** (`mov ebx,6; call signatureError @0x719060`). (`REPEATED_COUNTER=26` exists in the enum but `authd`'s verifier emits 6, per `sc0/d.java:144`.)

**Legacy passive-entry path (VCSEC-internal — NOT in image; C5 SUPPORTED/HIGH that it is a *separate* path):** its counter/IV faults come from the distinct `SignedMessage_information_E` enum (values proven in `vc0/x2.java:104-111`), and `authd` contains **only decode/marshal stubs** for it (`vcsec.(*SignedMessage).GetCounter @0x657540` etc.) — **no legacy validator**. So the window/fault-6/resync facts above **do not transfer to passive entry**. The fault name `FAULT_IV_SMALLER_THAN_EXPECTED(3)` (IV = the counter) reads as a **strict-monotonic "counter below the floor" reject** — but whether VCSEC applies a window or strict-monotonic here, and whether it returns a resync token, is **the #1 thing to measure** (below).

**Persistent effect of a reject (PROVEN in `authd`, HIGH):** *none.* Every reject branch **restores `top`/`bitmap` before writeback** (the window advances only on accept — no poisoning), and the signature is verified *before* the window is touched (`cmp [rsp+0x50],0; jne` at `0x71a0da`), so a bad-tag frame never advances the counter. A counter-reject returns fault 6 **plus a fresh `SignedSessionInfo`** for immediate one-round-trip resync (`signatureError → signedSessionInfo → sessionInfo @0x719480`). There is **no lockout/rate-limit in `authd`** — the only `ExponentialBackoffTimer` is BLE/DBus comms retry (`Announcer.Run`, `Proxy.SessionInfo`), unrelated to the counter.

> ⚠ **Do not transfer "no lockout" to VCSEC.** Your 2026-07-20 incident (all BLE clients frozen ~20 min after ~25 malformed frames, needing a restart + re-enroll) **cannot** be explained by `authd`'s counter path (it is stateless-reject with a helpful resync). An all-client, multi-minute, restart-to-clear freeze points at the **off-image VCSEC ECU / BLE radio** anti-abuse — exactly the component you hit for VCSEC over BLE. One shared key's collision path is a *reject generator*, so it is the setup most likely to re-provoke that wedge. This is a concrete downside of one key.

---

## Q2 — session-scoped or (key, epoch)-scoped? Does cutting the Pi help?

**Scope = `(key, epoch)`, persistent across connections (PROVEN in `authd`, HIGH; VCSEC INFERRED).** The window/counter/epoch live *inside the per-key `Verifier`* held in `map[KeyID]*Key` — not in any per-connection object. `Verifier.sessionInfo @0x719480` is a **non-mutating read** (it does not rotate the epoch or reset the counter; `rotateEpochIfNeeded` is reachable only from `NewVerifier` and `adjustClock`, never from the session-info path).

**Consequence:** closing the Pi's BLE session **does not reset or release the car's counter**. The survivor just continues from the last value it reads back in `SessionInfo.counter`. So "cut the Pi" buys you *stopping a second sender*, **not** a fresh counter — exactly as you assumed. (VCSEC: measure that its counter is likewise persistent across a disconnect — test #5 below.)

---

## Q3 — THE LINCHPIN: concurrent authenticated sessions under one keyId

**For the in-image layer this is MOOT, and it's moot for a deeper reason than "the car keeps both sessions."** Under one enrolled key, the Pi and the phone derive the **identical session key** and are the **same cryptographic identity** to the car:

- **The car's session pubkey is STATIC/per-domain, not a per-connection ephemeral** (C1, SUPPORTED/HIGH after three refutation angles failed). `sessionInfo @0x719480` returns `SessionInfo.publicKey` via a getter on the **stored, disk-loaded** P-256 key (`/var/lib/authd.ecdh_creds`), with **no keygen** in the request path; the only randomness reachable is the 16-byte `epoch`, which rotates on counter rollover, not per handshake. Corroborated by the client-role guard string `"public key in SessionInfo doesn't match value used to initialize Signer"` — the protocol *assumes a stable peer key across fetches*. This also **corrects airgapp's own code comment** (see below).
- Since ECDH is static-static under one enrolled key, both clients compute `SHA1(ECDH(sameEnrolledPriv, carStaticPub))[:16]` → the **same** session key, hit the **same** per-key `Verifier`, share **one** counter+epoch+window. **There is no per-connection session to evict**, so the car cannot "hand off" by eviction at this layer, and `Q3(a)` is structurally impossible here; the reality is `Q3(b)`-like — one shared anti-replay state, coordination entirely on you.

**But for VCSEC specifically, "the car auto-cuts the Pi on a native connect" is UNVERIFIABLE, not false.** A constrained micro *could* hold a single live session slot and evict on a new handshake (which would make auto-cut real and one key naturally safer). The in-image proof only covers `authd`. **This is test #3 — run it before assuming either way.**

---

## Q4 — connection / session slots

- **Routable relay (PROVEN):** not the limiter. `command-router`'s dispatcher tracks in-flight forwarded requests in a `golang-lru.NewWithEvict(100)` (~100 concurrent, evict-oldest); concurrent requesters are a *design feature* via 16-byte `routing_address` destinations. The fixed routing table is internal services (Hermes/VCSEC/Authd/…), not per-phone.
- **Raw BLE-central cap to the VCSEC radio (NOT-IN-IMAGE):** VCSEC is **provably multi-connection-aware** — it reports `AlertHandlePulledWithoutAuth.connectionCount` and `unknownDevicePresent` — so ≥2 concurrent centrals is architecturally supported. **The cap and the N+1 policy (refuse-connect vs evict-oldest) are VCSEC-internal.** This gates the *entire* Pi+phone concurrency premise, for one key *and* two keys: if VCSEC accepts only one authenticated central, neither design lets Pi and phone coexist. **Test #2, first.**

---

## Q5 — what the app/firmware assume; two-keys sanity check

- **The official app assumes NO single-active-client and has NO cross-client eviction to copy** (F4, PROVEN app-side). It is **reconcile-not-evict**: on any counter divergence it `Math.max`-reconciles + refetches (`ee0/g.java:298`). It serializes only its **own** concurrent signs, per `(vin, key)`, via a **`SigningGate` (`ee0/g.java:763-802`)** — a single-writer lock. So your proposed "cut the Pi" cutoff is *your* invention; the closest Tesla analogue is single-writer serialization, not eviction.
- **Two keys are independent — with an honest MED-confidence hedge (C4).** Proven where visible: `authd` keeps `map[KeyID]*Key`, each key its own self-contained `Verifier` (counter `+0x20`, epoch `+0x24`, embedded `SlidingWindow +0x60`), with **no global/cross-key counter** and per-instance epoch RNG; the app keeps a distinct `VehicleSessionInfo` per `(vin, sourcePublicKey, domain)`. The only shared cross-key object is the whitelist slot table + a **version counter that is a whitelist/firmware *edit* version, not a per-message anti-replay counter** (correction: it lives on `vcsec.FirmwareInfo`, `GetVersionCounter @0x727980` — not `WhitelistInfo` as REQUEST-8 supposed). **Residual unknown:** whether the *epoch* is per-key or shared per-domain — benign either way (worst case a `Math.max` resync, never a lockout), but confirm (test #6). VCSEC per-key enforcement is **INFERRED**, so "provably independent" is right for the model in-image but should read "**independent by construction in the proven model, contingent on VCSEC per-key enforcement + the multi-central cap.**"

---

## The finding that decided it: one shared key is *unsafe on the legacy path*, not merely "racy"

The completeness critic caught what the counter-race framing missed. On the **legacy passive-entry seal the IV *is* the counter** (`be32(counter)`, `passiveEntryResponder.ts:112`), and two same-key clients share an **identical** session key (C1). Therefore, on that path:

- A counter **collision** is not a benign "second frame rejected" — if two signers ever emit a legacy seal at the same counter under one key, that is **AES-GCM (key, nonce) reuse on different plaintexts** → GHASH auth-key recovery (forgery) + plaintext-XOR leak. Your own code knows this: `session.ts:106` "AES-GCM nonce reuse is fatal" — but it only prevents reuse *within one client*.
- **How live is this in your exact topology?** I checked, and it's precise: your **command path uses a random 12-byte nonce** (`crypto.ts:336`), so the **Pi(routable)** and **phone(legacy)** nonce spaces are disjoint — they do **not** directly reuse a nonce. The nonce-reuse catastrophe requires **two *legacy* signers** under one key, which airgapp currently prevents with **one load-bearing guard**: `passiveEntryLink` runs at most one passive link (`stands down when the command path is on BLE`, `:88-90`). So today the direct trigger is guarded — but:
  - the guard is now safety-critical and must **never regress**, and
  - on a **legacy-regime car** (`apiVersion<80`) your *commands* would also be legacy `IV=counter`, and then **Pi(legacy)+phone(legacy) under one key = direct nonce reuse on any collision.**
- **What *does* trigger directly in Pi(routable)+phone(legacy):** the shared counter. The Pi's routable polls advance the car's top; the phone's legacy `IV=counter` then falls **below** top → `FAULT_IV_SMALLER_THAN_EXPECTED` → **rejected passive auth = missed walk-up unlock**, recoverable only by refetch+reseal (a round-trip that can blow the walk-up deadline — and the legacy path may not even hand back a resync token; VCSEC-internal).

**Two distinct enrolled keys collapse this entire class:** different enrolled key → different session key → (a) no shared counter to collide, and (b) even a coincidental equal counter value is **not** a nonce reuse (different keys). That is why two keys, not "one key + cutoff," is the clean answer.

---

## Adjudicating REQUEST-8's three options

- **(2) "One key is provably safe because a native connect auto-cuts the Pi car-side" — REJECTED as a foundation.** The in-image layer has no per-connection session to evict; for VCSEC it's unproven. Do not rely on car-enforced handoff.
- **(1) "One shared key is unstable → two keys" — essentially correct, sharpened.** One key across **autonomous concurrent signers** is unsafe on the legacy path (collision rejects at best; nonce-reuse catastrophe if the single-passive-link guard ever fails or the car is legacy-regime; plus the VCSEC reject-burst wedge risk). Not merely "not provable" — affirmatively "don't ship this shape."
- **(3) "Coordination-dependent; can we close the window to X?" — yes, and there's a provably-safe form.** One key is safe **iff** you enforce **strict single-writer serialization** (presence mutual-exclusion: exactly one of Pi/phone signs at a time, onto one monotonic counter — Tesla's own `SigningGate` pattern). The residual X is the **hand-off window** between two physically separate devices (phone↔Pi network latency); on the legacy path any slip in that window is a nonce reuse, so the correctness bar is "airtight," not "small." And it fails exactly when the phone must sign **autonomously** (Pi unreachable) — which is the whole point of passive entry.

**Net recommendation (unchanged in substance from RESPONSE-7's L2, now with the crypto reason and the confidence corrected):**

1. **Two keys** — enroll the phone-native central and the Pi as separate whitelist slots. Removes the counter race and the nonce-reuse class by construction. **Contingent on test #2** (VCSEC keeps ≥2 centrals). Cost: a second card-tap enrollment (or an owner-signed add if P4 pans out).
2. If two keys is unacceptable: **one key with hard single-writer serialization** — presence mutual-exclusion, exactly one signer live, and **never** two legacy signers. Keep the `passiveEntryLink` single-link guard as a safety invariant.
3. **On `apiVersion≥80` cars, prefer answering passive entry on the *routable* path** (`authenticationResponse` → `DOMAIN_VEHICLE_SECURITY`), whose **random nonce removes the nonce-reuse coupling entirely** and whose reject is the recoverable window fault. (Verify your car's regime — test #1c.)

---

## ⚠ Correct these in airgapp before relying on the current design

- **False premise in the code comments.** `passiveEntryResponder.ts:50-55` and `passiveEntryLink.ts:14-19` justify keeping the Pi and direct-BLE sessions separate because *"each handshake derives a fresh key from the car's **ephemeral** pubkey, so a Pi session and a direct-BLE session have different keys and counters."* **That is wrong** (C1 proven): the car's pubkey is **static**, so under **one enrolled key** the Pi session and the direct-BLE session derive the **same** key and share the **same** counter. The separation you think you have is illusory; real separation requires **two distinct enrolled keys**. Anyone who collapses to one key trusting that comment will believe the derived keys still differ — they won't.
- **The single-passive-link guard is now safety-critical**, not just an efficiency choice — document it as the invariant that prevents legacy nonce reuse.
- **Don't seed the legacy passive counter from the routable `SessionInfo` and assume the window protects it.** The routable window/resync is proven; the legacy check is VCSEC-internal and likely stricter. Treat a legacy passive reject as *not necessarily recoverable in-deadline*.

---

## The on-car test — layered so the result is unambiguous (incorporates the critic's fixes)

Run these **in order**; do not fold them together (a reject caused by a dropped radio link must not be mis-read as a counter result). Arm your circuit breaker, keep total induced rejects **well under the ~25** that wedged VCSEC on 2026-07-20, and after every reject confirm a normal command still works within seconds (self-heal) vs a persistent freeze. **Log `connectionCount` throughout.**

1. **Regime + enum probe (no concurrency).** (1a) Read your car's `apiVersion` / confirm `vehicleSupportsRoutableOverBle`. (1c) Send a well-formed legacy passive `SignedMessage` and a routable command; capture the **raw fault byte** and map it: routable `MessageFault 6/26` vs legacy `SignedMessage_information 3/5/6`. This tells you which path your car honors for passive entry.
2. **VCSEC concurrent-central cap (pure connectivity, NO commands).** Bring the Pi central up + authenticate; then bring the phone-native central up (first under a **different** enrolled key, then under the **same** key). Read `connectionCount`. Record: both stay connected / 2nd refused / 1st dropped, and any fault. **This gates the whole two-key recommendation.**
3. **Eviction discriminator (Q3).** Pi authenticates and sends a **forward, never-used** counter (expect accept). Phone-native completes a fresh `SessionInfoRequest` under the **same** keyId. Then Pi sends **another forward** counter. **Accept ⇒ no eviction (Q3b).** **Reject with a *session/handle* fault (`INVALID_HANDLE`/`SESSION_INFO_STATUS_INVALID`) ⇒ eviction (Q3a, auto-cut real).** **Reject with a *counter* fault ⇒ merely stale, not eviction.**
4. **Legacy monotonic-vs-window (single client — SAFE, no nonce reuse).** One key, one signer: send legacy passive at counter `N` (accept), then replay `N−5`. `FAULT_IV_SMALLER_THAN_EXPECTED(3)`/`FAULT_TOKEN_AND_COUNTER_INVALID(5)` for anything below top ⇒ **strict-monotonic** (the window does *not* protect passive entry). Accepting `N−5..N−1` ⇒ windowed. Parse the fault frame for an attached `sessionInfo`/token ⇒ resync-capable vs dead-end. *(Do this single-client to avoid performing the very nonce reuse you're testing for.)*
5. **Counter persistence across disconnect (Q2).** Client A advances to `N`, fully disconnects at BLE, reconnects (fresh handshake, same key, **same epoch** — pin the epoch bytes), reads `SessionInfo.counter`. Still `~N` ⇒ persistent per-`(key,epoch)`, cutting the session releases nothing. Reads `0`/accepts low ⇒ connection-bound.
6. **Two-key independence + epoch granularity (the differential that validates the recommendation).** Enroll A and B. Drive B's VCSEC counter hard (many valid commands, or force a rollover) while A is idle; then send an old-counter frame under A and confirm rejection depends **only on A's own window**, and read **A's epoch bytes** before/after: unchanged ⇒ per-key epoch (fully independent); changed ⇒ per-domain-shared epoch (A must refetch after B rotates — benign but real). Repeat step-3's collision sequence with A and B on **different** keys and confirm **zero** cross-effect.
7. **Controlled shared-counter collision (the race itself — routable arm only, to stay nonce-safe).** Fetch `SessionInfo` once, share counter `N`. Pi sends `N+1` (accept). Phone-native sends the **duplicate** `N+1` — capture the fault. Phone-native then sends `N+2` (forward) — confirm accept. This shows the shared window rejects the *duplicate value* (not reordering) and that resync (`Math.max` + refetch) pulls the second client past the first within one epoch. *(Run this on routable frames — a legacy same-counter collision would literally perform the nonce reuse; use step 4's single-client replay for the legacy monotonic question instead.)*

**What each unknown decides:** #2 → is Pi+phone concurrency even possible (gates everything). #3 → is auto-cut real (Q3). #4 → does the window protect passive entry or is legacy strict (governs one-key recoverability). #5 → does cutting the Pi reset anything (Q2). #6 → is two-keys truly independent (validates the recommendation). #7 → the recoverable-vs-fatal character of a routable collision. #Wedge-watch across all → whether one key's reject bursts re-provoke the 2026-07-20 freeze.

---

## What remains VCSEC-internal (measure, don't assume)

The legacy passive counter rule (window vs strict, resync-token yes/no); the VCSEC concurrent-central cap + N+1 policy; whether a fresh VCSEC handshake evicts a prior session; VCSEC anti-abuse/lockout thresholds and scope; VCSEC epoch granularity (per-key vs per-domain). All are on the separate ECU; each has its exact test above.

## Provenance
Finders `f1-authd-antireplay`, `f2-counter-sharing`, `f3-concurrency-slots`, `f4-coordination-twokeys` (`~/Work/tesla-firmware/out/req8-findings/`); adversarial verifiers C1–C5 + completeness critic (workflow `req8-verify`). Key `authd` symbols/offsets re-verified on disk (`SlidingWindow.Update @0x71b5c0`, `Verifier.Verify @0x719ea0`, `sessionInfo @0x719480`, `Key.Authenticate @0x809d60`, `KeyManager.add @0x80c580`, `NewVerifier @0x718e20`). App locations re-read (`CommandActionsKt.java:23`, `ob0/d.java:c()`, `ee0/g.java:48/51/298/763`, `gf0/b.java:88/369/601/938`, `vc0/x2.java:104-111`). airgapp cross-checks: `session.ts`, `crypto.ts:336`, `passiveEntryResponder.ts:112`, `passiveEntryLink.ts:88`, `gcmShortIv.ts`, `passiveEntryCapture.ts:84`. Corrects RESPONSE-7's L2 by adding the crypto (nonce-reuse) reason and the proven `authd` model, and downgrades "two keys provably safe" / "auto-cut false" to the confidence the evidence supports.
