# RE REQUEST #9 — how does the official app answer PASSIVE ENTRY: legacy or routable? (the linchpin)

**Requested:** 2026-07-21 (direct follow-up to RESPONSE-8's line-115 recommendation, which we never
asked about head-on)
**Why this is now the deciding question:** RESPONSE-8 established that one shared key is *dangerous
only on the legacy passive seal* (IV = counter → nonce-reuse). If the official app answers passive
entry on the **routable** path (random nonce), then one shared key becomes SAFE and we avoid the
whole two-keys build. So the entire one-key-vs-two-keys decision reduces to: **what does the app
actually send to answer a passive-entry challenge on an apiVersion≥80 car, and will the car grant it?**

## What we've already PROVEN on-car (so you can anchor)
- The car sends passive-entry challenges as a **legacy** `FromVCSECMessage.authenticationRequest`
  (captured 2026-07-20: `f3{ f2{f1=<20B nonce>}, f3=2, f4=1B }`, reason 5 = handle-pull).
- We answered with a **legacy** `SignedMessage{ AES_GCM_TOKEN }`, IV = `be32(counter)`, AAD = the 20B
  token — and it **GRANTED / unlocked** (M1 proven). So legacy definitely works.
- Our **command** path is **routable** (`AES_GCM_Personalized`, random 12-byte nonce, `crypto.ts:336`)
  and works — so our car is in the ≥80 / routable-capable regime.
- RESPONSE-8: passive `authenticationResponse` and commands both map to `DOMAIN_VEHICLE_SECURITY`
  → **one shared (key,epoch) counter**; legacy IV=counter is the nonce-reuse hazard; routable random
  nonce removes it; and the app has a per-`(vin,key)` single-writer `SigningGate` (`ee0/g.java:763`).

## The questions (app decompile = definitive; VCSEC-accept = inferred + we'll confirm on-car)

### Q1 — what modality does the app SEND to answer a passive-entry challenge?
- Trace the passive-entry responder in the iOS `BLEVehicleLogic.mm` / the Android
  `Peripheral`/`AuthEngine` path from the `0213` challenge (`FromVCSECMessage.authenticationRequest`)
  to the bytes it writes back. Is the response:
  - (a) a **legacy** `SignedMessage{ signatureType = AES_GCM_TOKEN(3) }` (IV = counter), or
  - (b) a **routable** `RoutableMessage` carrying `UnsignedMessage{ authenticationResponse }` sealed
    with `AES_GCM_Personalized` (random nonce, counter in AAD)?
- If it can be either, **what gates the choice** — `apiVersion≥80` / `vehicleSupportsRoutableOverBle`
  (`ob0/d.java:c()`), a capability flag in the challenge, or the challenge's own envelope type?

### Q2 — does the RESPONSE modality have to match the CHALLENGE modality?
- We captured a **legacy** challenge on our ≥80 car. Does a ≥80 car *also* emit a **routable**
  challenge (and we only saw legacy for some reason), or does it always challenge legacy and the app
  answers **routable anyway**? i.e. can a legacy `authenticationRequest` be answered with a routable
  `authenticationResponse`, or must legacy be answered with legacy?
- This is the crux: if the car challenges legacy and requires a legacy answer, routable-passive is
  not available to us and one key stays dangerous → two keys. If the app answers routable regardless,
  we're clear.

### Q3 — exact construction of the routable passive response (so we can build it right)
If (b) is real: give the precise message — envelope fields, `to/from` domains, the
`UnsignedMessage.authenticationResponse` sub-fields (authenticationLevel / estimatedDistance /
rejection), the `AES_GCM_Personalized` fields (epoch, nonce source, counter, expiresAt, tag), and the
**AAD contents** (what replaces the legacy 20B token — is the challenge nonce bound as AAD, and how?).
We already have the routable `AES_GCM_Personalized` seal for commands; we want to know what differs
for the auth response.

### Q4 — does the app route passive entry through the SigningGate?
- Does the passive-entry sign go through the same `SigningGate` (`ee0/g.java:763-802`) as commands, so
  the app is strictly single-writer over the one shared counter? (This tells us the app's own
  coordination model — relevant because our Pi is a *second* signer the phone's gate can't cover.)

### Q5 — the counter/reject character on the routable passive path
- Confirm: routable passive still shares the `DOMAIN_VEHICLE_SECURITY` counter with commands (so a
  concurrent Pi command can still cause a **reject**), but the reject is the **recoverable** sliding-
  window fault (`INVALID_TOKEN_OR_COUNTER 6` + resync `SignedSessionInfo`), NOT nonce reuse. And that
  the phone sending **forward** (top+1 after a SessionInfo refetch) is accepted even under Pi-induced
  skew, up to the 32 window.
- Any **auth-specific deadline** that a resync round-trip must fit (the `CP_a132_contractAuthTimeout`
  from RESPONSE-7)? Quantify if visible.

## The decision this unblocks
- **If the app answers passive entry ROUTABLE on ≥80 cars** → one shared key is safe; we port passive
  entry to the routable seal (reusing our existing command GCM, retiring the 4-byte-IV `gcmShortIv`),
  and skip the two-keys enrollment. This is our preferred outcome.
- **If passive entry must be LEGACY** → one key stays nonce-reuse-dangerous → two enrolled keys.

## Constraints
- App decompile is definitive for Q1/Q3/Q4; be explicit where VCSEC-accept is inferred vs provable.
- Cite locations + confidence as before. If Q2 is not statically determinable, say so and give the
  exact minimal on-car probe (we can send one routable `authenticationResponse` to a real challenge
  and read GRANT vs a fault — single frame, no concurrency, no risk).
