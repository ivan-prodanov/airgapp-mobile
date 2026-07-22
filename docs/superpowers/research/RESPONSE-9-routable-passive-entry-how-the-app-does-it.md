# RE RESPONSE #9 — how the official app answers passive entry: **routable**, and it makes one key safe

**Answers:** `REQUEST-9-routable-passive-entry-how-the-app-does-it.md` (Q1–Q5 + the decision).
**Method:** static RE of the decompiled Tesla 4.58.0 Android app (jadx) + the iOS 4.57.0 Mach-O (corroborating). **4 trace finders → 2 adversarial-refutation verifiers → completeness critic.** Every hop is cited to `…/app-re/jadx/sources`.
**Verdicts:** T1 modality **HIGH**, T2 construction **HIGH**, T3 gate/SigningGate/deadline **HIGH**, T4 iOS **MED** (4.57.0 stand-in); V1 modality-decision **PARTIALLY_SUPPORTED/HIGH** (caught a real overreach — read it), V2 AAD/token-binding **SUPPORTED/HIGH**.

> **The APP decompile is definitive for what the app SENDS. Whether the CAR/VCSEC GRANTS it is off-image (VCSEC ECU) and is the one thing that needs a single on-car frame.** Marked throughout.

---

## TL;DR — the decision, and it flips RESPONSE-8's default (conditionally)

**ROUTABLE. On a routable-capable car the official app answers a passive-entry challenge with a `RoutableMessage{ UnsignedMessage{ authenticationResponse } }` sealed `AES_GCM_Personalized` with a RANDOM 12-byte nonce — the legacy `SignedMessage{AES_GCM_TOKEN}` (IV=counter) seal is not on the auth-response path at all when the routable regime is active.** (APP-PROVEN, HIGH.)

**What that does to the one-key-vs-two-keys question:** the entire two-keys recommendation in RESPONSE-8 existed for **one reason** — the legacy passive seal's `IV = be32(counter)`, which under one shared key turns a counter *collision* into AES-GCM **nonce reuse**. **The routable seal uses a random nonce, so that hazard structurally cannot occur.** Under the routable seal, passive entry and commands share one key + one `DOMAIN_VEHICLE_SECURITY` counter + one 32-wide window + the single-writer `SigningGate`, and a counter collision is just the **recoverable** `INVALID_TOKEN_OR_COUNTER(6)` + fresh `SignedSessionInfo` — not a crypto break. **So: port passive entry to the routable seal → one shared key is safe → skip the two-keys enrollment.** This is the outcome REQUEST-9 hoped for, and it is well-supported.

**The one honest contingency:** RESPONSE-8's on-car GRANT was measured on the **legacy** modality. That the car GRANTs a **routable, token-less** passive answer is **strong inference, not this-VIN measurement** (see the contrapositive below). Close it with the single-frame probe at the end **before deleting the legacy responder.**

---

## Q1 — modality the app SENDS: **routable** (APP-PROVEN, HIGH)

The full traced path, challenge → bytes on the wire (all `…/jadx/sources`):

1. **Intake:** `q1.y()` (`com/teslamotors/plugins/ble/q1.java:1437`) → `B0()` (:734) extracts `w0.getAuthenticationRequest()` (:775) → `z0()` (:631). The routable-arrival flag `z11 = getRoutableMessage()!=null` is computed (:1443) **but not forwarded** into `z0()`.
2. **Build + dispatch (`q1.z0()` :631):** on a grant (`onWhitelist && has-valid-token`) it builds the response `vc0.r` via `rd0.h.d(vin, pVar.getRequestedLevel(), reasons)` (:660) and dispatches through **`this.f56976v.h(rVarE, j11, listener)`** (:666), where `f56976v = ye0.n`. **No legacy signer is called here.**
3. **`ye0.n.h(r, long, listener)` (`ye0/n.java:135`)** → `e( ob0.e.f97095a.c(vin, ts, authResponse, "ble_authentication_response") , listener)` (:138) → dispatcher `ye0.j.a(cmd, …)`.
4. **The sole modality gate — `ye0.j.a()` (`ye0/j.java:1234`):** `isLegacyBle = ob0.d.a(vin, apiVersion, isRemoteBuilt, domain=VEHICLE_SECURITY, carType, isFetchingSessionInfo)`. Log line `"using legacy BLE? " + zA` (:1236). `isLegacyBle==false → V() → routableMessageBuilder (fd0.f) → gd0/d.java:117` stamps `TAG_SIGNATURE_TYPE = AES_GCM_PERSONALIZED`. `isLegacyBle==true → W() → toVCSECMessageBuilder (fd0.p) → gf0/b.java` legacy `AES_GCM_TOKEN`.
5. On a routable car the gate is **false**, so the legacy auth seal (`fd0.p`/`gf0.b.k()`/`a2.k()@:628`) is **unreachable for auth responses**. (It is not globally dead code — it's the intended path when the gate computes legacy; see Q2.)

`getDomain(authenticationResponse) → DOMAIN_VEHICLE_SECURITY` (`CommandActionsKt.java:23`), same domain (and counter) as `rkeAction`/`closureAction`/lock/unlock.

---

## Q2 — does the RESPONSE modality follow the CHALLENGE modality? **No — and this is the crux** (SUPPORTED, HIGH; with a nuance that matters to airgapp)

**Fully refuted that the app mirrors the challenge form.** `q1.z0()` receives no challenge-envelope input — `B0()` drops the `z11` routable-arrival flag before calling `z0()` (`q1.java:777`), and `ye0.j.a()` reads only `domain + cached apiVersion + carType`, never the challenge shape. **A legacy-form `FromVCSECMessage.authenticationRequest` (exactly what your car sends) is answered with whatever the regime gate picks, never mirrored.** So the routable answer *is* available to you even though your car challenges legacy. That is the decision-critical fact, and it holds.

**The nuance V1 caught (and it matters for an air-gapped app):** "routable-capable" is judged on the **app-cached cloud `apiVersion`** (`u5.vehicle_state.api_version`, `wb0/e.java:568`), **not physical capability**. For an auth response, `ob0/a.java:20-27` uses the cached `vehicle_data` if present, else falls back to `getApiVersion(authResponse) = null → 0`. With `apiVersion=0`, `ob0/d.java:103` computes `isLegacyBle=TRUE` → the stock app sends **legacy** `AES_GCM_TOKEN` (live token-binding code at `fd0/p.java:41-48`).

**Implication for airgapp:** your app is deliberately air-gapped and never caches cloud `vehicle_data`, so **stock logic would compute `apiVersion=0` and default to legacy.** This does **not** block the routable decision — it just means **airgapp must *choose* routable explicitly** (hardcode it, exactly as you already hardcode routable for commands via `session.ts`), not inherit the stock apiVersion gate. Don't port the `ob0/d.java` gate; bypass it.

---

## Q3 — exact routable passive response (so you can build it) (APP-PROVEN, HIGH; V2 SUPPORTED/HIGH)

You mostly already have this — it is your **command** seal with a different inner message. Field-by-field:

**Inner (what gets encrypted):** `VCSEC.UnsignedMessage` (`vc0.e3`) with the **`authenticationResponse` arm at tag 3** (`fd0/f.java:158-163` wraps `authResponse.getAuthenticationResponse()` into `e3`, tag 3 per `vc0/e3.java:31`). The `AuthenticationResponse` (`vc0.r`) carries **only**:
- `authenticationLevel` = **echo the challenge's `requestedLevel`** (`q1.z0()` passes `pVar.getRequestedLevel()`; token-less contrast path uses `AUTHENTICATION_LEVEL_NONE`),
- `estimatedDistance` = **0**,
- `authenticationRejection` = **NONE** (the car does all ranging; grant is reason-independent).

This is **byte-identical to what `passiveEntryAuth.ts:encodeAuthenticationResponse` already emits** — so your inner bytes need no change.

**Envelope:** `RoutableMessage` — `to_destination.domain = DOMAIN_VEHICLE_SECURITY(2)`; `from_destination.routing_address = <app routing addr>`; `uuid = {0x00}` (single byte; the challenge uuid is **not** echoed); `request_uuid` empty; `flags = FLAG_ENCRYPT_RESPONSE(0x02)` if you want the status reply encrypted; `protobuf_message_as_bytes = <ciphertext>`; `signature_data = AES_GCM_Personalized`.

**Seal (`AES_GCM_Personalized`, `gd0/d.java:102-126` + `rb0/e.java:238`):** ECDH session key; **RANDOM 12-byte nonce** (`SecureRandom`, *not* the counter); `counter` = next value from the **shared `DOMAIN_VEHICLE_SECURITY` `VehicleSessionInfo.incrementCounter()`**; `epoch` and `expiresAt (≈ vehicleClock + 6s)` from the session; `tag` = GCM tag.

**AAD — and where the token goes: NOWHERE (V2 SUPPORTED/HIGH after a real refutation hunt).** The AAD digest = `SHA-256(metadata TLV{ TAG_SIGNATURE_TYPE=AES_GCM_PERSONALIZED, TAG_DOMAIN=VEHICLE_SECURITY, TAG_PERSONALIZATION=VIN, TAG_EPOCH, TAG_EXPIRES_AT, TAG_COUNTER, TAG_FLAGS(only if >0) })` — **`TAG_CHALLENGE(6)` is deliberately unset.** The 20-byte challenge token is **not** in the AAD, **not** in a proto field (`vc0.r` has no token field), and **not** in the uuid. The app-internal container `ic0.b` *does* have an `authenticationRequestToken` field (tag 2), but `ob0/e.java:1136 new ic0.b(authResponse, null, null, 6, null)` forces it null, and its **only reader is the legacy builder `fd0/p.java:44-47`.** **Routable freshness is purely counter + epoch + expiresAt.**

> **This is the strongest static argument that the car is freshness-only:** the routable path *structurally cannot* bind the token (no field, dropped at `fd0/f.java:158-163`). If the car required challenge↔response token correlation, **no stock ≥80 app could ever passively unlock** — yet they do. Contrapositive ⇒ the car accepts a fresh-countered, token-less `authenticationResponse`. (Inference, not this-VIN proof — the probe closes it.)

---

## Q4 — does passive entry go through the SigningGate? **Yes** (APP-PROVEN, HIGH)

The auth response is a `requiresSigning` VCSEC/BLE `TeslaCommandRequest` and acquires the **same per-`(vin,key)` single-writer `SigningGate` slot as commands** (`ee0/g.i()`, taken at `ce0/l.a:262`, released in `ye0/j.M`). So the official app is strictly single-writer over the one shared counter — including passive entry. (Caveat: gated by `getSigningGate().getEnabledAndMeetsVersionThreshold()`; if that flag is OFF the gate is a no-op and only the atomic `incrementCounter` orders things. Moot for airgapp's own single-writer design, but note it.)

**Relevance to your Pi:** the app's gate only covers *its own* signers. Your Pi is a **second** signer the phone's gate can't see — which is why the shared-counter coordination is still yours to enforce (RESPONSE-8's L2 presence mutual-exclusion). The routable seal just makes a coordination slip **recoverable** instead of **catastrophic**.

---

## Q5 — counter/reject character + deadline (APP-PROVEN, HIGH; VCSEC accept INFERRED)

- Routable passive **shares the `DOMAIN_VEHICLE_SECURITY` counter with commands** (one `VehicleSessionInfo`), so a concurrent Pi command **can still cause a reject** — but it's the **recoverable** sliding-window fault `INVALID_TOKEN_OR_COUNTER(6)` + fresh `SignedSessionInfo` (RESPONSE-8: window 32, no poisoning, no authd lockout), **not** nonce reuse. Sending **forward** (top+1 after a `SessionInfo` refetch) is accepted under Pi-induced skew, up to the 32 window.
- **No auth-specific deadline.** `CP_a132_contractAuthTimeout` is an **EV-charging** fault (`ec0/g.java:494`), not BLE auth — disregard it. The only timing is the generic **6 s** app self-timeout mirrored into the seal's `expiresAt ≈ vehicleClock + 6 s` (`gd0/d.java:107`). Whether the car enforces it as `TIME_EXPIRED`, and the tolerance under clock skew, is off-image → measure.

---

## What this means for airgapp — the concrete change

**Supersede RESPONSE-8's two-keys default with: one key + routable passive seal.** The two-keys recommendation was driven by the legacy `IV=counter` nonce-reuse hazard; routable removes it. Specifically:

1. **Port `passiveEntryResponder` to seal routable, not legacy.** Reuse your existing command seal (`session.ts` `AES_GCM_Personalized`, `crypto.ts:336` random nonce) targeting `DOMAIN_VEHICLE_SECURITY` with the `UnsignedMessage{authenticationResponse}` inner. Your inner `AuthenticationResponse` bytes (`passiveEntryAuth.ts`) are already correct (echo `requestedLevel`, distance 0, rejection NONE).
2. **Retire `gcmShortIv.ts` / the 4-byte-IV path** once the probe confirms (below). Until then, **keep the legacy responder as a fallback** — it's your only *measured* GRANT (RESPONSE-8), so it's cheap insurance.
3. **Hardcode routable; do not inherit the stock apiVersion gate.** Air-gapped ⇒ no cached `vehicle_data` ⇒ stock logic would pick legacy (Q2 nuance). You want routable regardless.
4. **Keep single-writer discipline for the Pi.** The routable seal makes a Pi/phone counter collision recoverable, but you still want RESPONSE-7's presence mutual-exclusion so collisions (and the round-trip resyncs they cost, against the ~6 s stamp) stay rare at walk-up.
5. **One enrolled key is now fine.** No second whitelist slot, no second card tap.

---

## The single-frame on-car probe (closes the only off-image gap; no concurrency, no risk)

**Goal:** confirm the user's VCSEC GRANTs a routable, token-less `authenticationResponse`.

**Build** (reuse the command routable seal — *not* the legacy 4-byte-IV seal):
- Inner: `UnsignedMessage{ authenticationResponse = { authenticationLevel = <the challenge's requestedLevel>, estimatedDistance = 0, authenticationRejection = NONE } }`.
- Envelope: `RoutableMessage{ to.domain = VEHICLE_SECURITY, from.routing_address = <app addr>, uuid = {0x00}, flags = 0x02 (encrypt-response, optional) }`.
- Seal: `AES_GCM_Personalized{ epoch = current VS epoch, counter = next fresh from the shared VS session, nonce = 12 random bytes, expiresAt = vehicleClock + ~6 s }`; AAD = the standard command metadata TLV (sigType, domain, VIN, epoch, expiresAt, counter, flags-if>0); **bind no token.**

**Sequence:** (1) refresh a valid `DOMAIN_VEHICLE_SECURITY` session (`SessionInfoRequest` → epoch, counter high-water, clock). (2) Trigger **one** genuine passive challenge (walk-up / handle-touch); log token `T` for reference only. (3) Within ~6 s send **exactly one** routable `authenticationResponse` as above — **no commands in flight, no second frame.**

**Read the reply:**
- **GRANT** (doors unlock / `OPERATIONSTATUS_OK`) ⇒ **ROUTABLE-SAFE confirmed** → ship one-key routable, retire `gcmShortIv`, drop the legacy responder.
- **`INVALID_TOKEN_OR_COUNTER(6)` + fresh `SignedSessionInfo`** ⇒ anti-replay skew, **not** a modality rejection → resync epoch/counter high-water from the returned `SignedSessionInfo`, retry one frame.
- **`TIME_EXPIRED`** ⇒ `expiresAt` already past (skew/latency) → resync clock, retry; not a modality verdict.
- **A legacy-style `SignedMessage_information` fault (e.g. `INVALID_MESSAGE_TYPE`/`INVALID_SIGNATURE`) while your known-good legacy responder still GRANTs** ⇒ the car wanted `AES_GCM_TOKEN` → **MUST-BE-LEGACY** → keep two keys (or one key + strict monotonic counter + zero passive/command concurrency).
- **Decode error / `UNKNOWN_KEY_ID` / `INVALID_DOMAINS`** ⇒ framing bug (domain, key id, proto shape) → fix and retry; not a modality verdict.

**Disambiguator (only if ambiguous):** (a) run your RESPONSE-8-proven legacy responder as a positive control to prove the challenge/session pipeline is healthy; (b) V2's token-correlation test — answer a challenge that has already been **superseded** by a newer one (counter still fresh): if it still GRANTs ⇒ freshness-only (token binding absent on-car, routable safe); if only the *live*-challenge answer GRANTs ⇒ the car correlates challenge↔response and, since routable can't carry the token, passive must stay legacy.

---

## Honest boundary + residual unknowns
- **App SENDS routable = PROVEN; car ACCEPTS routable = INFERRED (strong).** RESPONSE-8 measured only the legacy GRANT. The probe closes it — don't delete the legacy path first.
- iOS corroboration is from **4.57.0** (4.58.0 IPA not in this environment): same dual-regime mechanism (routable `withAdditionalData:` default + legacy `AES_GCM_TOKEN` fallback), not a byte-exact match. Android 4.58.0 is definitive.
- `ef0.o.b()` (the challenge decoder) body wasn't decompiled, so "bare vs RoutableMessage-wrapped challenge" is inferred from the two-field `VehicleMessage` + the `z11` flag — not decision-critical (the app answers routable either way).
- Off-image, per the probe: routable-accept on *this* VIN, token-correlation vs freshness-only, the `expiresAt` tolerance window, and whether a routable answer to a *bare* challenge is accepted.

## Provenance
Traces `T1-modality-and-gate`, `T2-exact-routable-construction`, `T3-challenge-modality-gate-deadline`, `T4-ios-corroborate`; verifiers `V1-modality-decision` (caught the cached-vs-physical apiVersion overreach), `V2-aad-token-binding`; completeness critic + probe design (workflow `req9-routable-passive`, `~/Work/tesla-firmware/out/req9-findings/`). Key anchors re-read: `q1.java:631/734/1437`, `ye0/n.java:135`, `ob0/e.java:1132`, `ye0/j.java:1234`, `ob0/d.java:35/100-104`, `fd0/f.java:158-163/318`, `gd0/d.java:117`, `fd0/p.java:41-48`, `ic0/b.java:106`, `vc0/r.java`, `CommandActionsKt.java:23`, `ee0/g.java`. **Conditionally supersedes RESPONSE-8's two-keys default: one key is safe under the routable seal, pending the single-frame probe.**
