# RE REQUEST — passive-entry challenge protocol (car→phone direction)

**Requested:** 2026-07-20
**For:** the RE agent (Tesla iOS/Android app bundles + car firmware)
**Consumer:** `docs/superpowers/specs/2026-07-20-passive-entry-design.md` (M1/M2)

## Why this request exists

airgapp is building walk-up unlock. Everything on the *phone→car* side is
already solved and shipping (ECDH → AES-GCM session, commands, telemetry). What
is missing is the **car→phone** direction: the car ranges nearby keys and issues
an `AuthenticationRequest`, which the key must answer.

**We have no proto for any of it.** airgapp's vendored `gen.js` contains **no
`AuthenticationRequest`, no `AuthenticationResponse`, and no
`AuthenticationReason` enum**. We know the reason *codes* only from the earlier
app RE (`WALK_UP_UNLOCK=9`, `PASSIVE_UNLOCK_EXTERIOR_HANDLE_PULL=5`,
`PASSIVE_UNLOCK_INTERIOR_HANDLE_PULL=6`, `PASSIVE_UNLOCK_AUTOPRESENT_DOOR=7`,
`UI_UNLOCK_PASSIVE_AUTH=4`) — not the message shapes, so we can neither decode a
challenge nor construct a valid reply.

We are also running an empirical capture (M0) that logs every unsolicited frame
off the car. **These two efforts are complementary:** the capture gives ground
truth bytes for one firmware; this request gives the schema and the rules. Where
they disagree, the capture wins for *our* car, but we need the schema to know
what the fields MEAN.

## What has already been settled — do not re-derive

Established by prior RE + on-car measurement; treat as given.

- airgapp's key is type-identical to an official **driver** phone key
  (`ROLE_DRIVER` + `KEY_FORM_FACTOR_IOS_DEVICE`). Enrollment needs no change.
- Confirmed on-car: our entry is at **slot 4**, structurally identical to the
  car's three `ROLE_OWNER` keys (fields `[1,2,4,6,7]`), differing only in role.
- The car identifies keys by **`SHA1(pubkey)[:4]`** (a full 20-byte SHA1 target
  faults `10/DECODING`).
- **`WhitelistEntryInfo.permissions` is never present over BLE** on this
  firmware — not for our key, and not for the OWNER keys either. Do not propose
  reading permissions over BLE as a way to confirm `LOCAL_UNLOCK`; it is
  empirically ruled out.
- No UWB / `NISession` / LE bonding is required for basic walk-up.

## Questions, in priority order

### Q1 (blocking M1) — the challenge/response wire format

For `AuthenticationRequest` and its response:
- Containing message and **field numbers** (which `FromVCSECMessage` /
  `ToVCSECMessage` arm carries each), and full field layout of both.
- What the phone must **sign or echo**: is the response a normal AES-GCM
  `RoutableMessage` on the existing session, or its own envelope/signature type?
  Which counter/epoch/AAD rules apply?
- Does the request carry a nonce/challenge the response must return?

### Q2 (blocking the M1/M2 architecture) — **native or JS?**

**This is the decision driver.** The project rule is *do it the way the official
app does it*: if Tesla answers the challenge in native code we go native; if
their JS/RN layer answers it, JS is proven sufficient and we stay in JS.

- On **iOS**, is the challenge handled in the Mach-O (Swift/ObjC/CoreBluetooth
  delegate) or does it cross into the Hermes bundle?
- Same question for **Android** (native lib vs the RN bundle vs Java/Kotlin).
- If native: what is the response deadline / timeout the car enforces, and does
  their implementation pre-compute anything (a cached session, a pre-signed
  token) to hit it?

Our crypto is pure-JS `@noble`, and after an iOS suspension we would have to wake
Hermes and sign. Knowing where Tesla does the work tells us whether that is
viable or whether a native path is mandatory.

### Q3 (M2) — background lifecycle on iOS

- Does the official iOS app declare `bluetooth-central` **and** use Core
  Bluetooth **state restoration** (`CBCentralManagerOptionRestoreIdentifierKey`)?
  What restore identifier / delegate behaviour on relaunch-into-background?
- Reconnect policy: service-UUID-scoped scan? Which UUIDs? Backoff?
- What keeps the session authenticated across a long suspension — do they
  re-handshake on wake, or persist session state?

### Q4 (M3, lower priority) — ranging and policy

- Which `AuthenticationReason` fires for a plain walk-up vs a handle pull, and
  does the phone's required response differ between them?
- Anything observable about RSSI thresholds / zone geometry, or how the car
  picks among several present keys.
- Any client-side opt-out the app exposes (we intend passive entry to be
  disableable and off by default).

## Constraints on the answer

- **Static RE only** — no Tesla cloud/account calls, no live-car experiments in
  this request. airgapp is air-gapped by design and its build fails on
  `tesla.com`/`owner-api` literals.
- **Cite locations** (class/file/offset, field numbers) the way the previous
  phone-key report did — its citations are what made it verifiable and let us
  falsify one of its recommendations on-car.
- **Flag confidence**, and say plainly when something is not in the image. A
  clear "not determinable statically" is more useful than a plausible guess; we
  have on-car capability and can test what you cannot resolve.
- If Q1's schema is recoverable as a `.proto` fragment, that is the single most
  useful deliverable — we hand-roll wire scanners rather than regenerate our
  60k-line `gen.js`, so field numbers + types matter more than generated code.

## What we will do with it

Q1 → implement decode + response (M1, foreground-only walk-up unlock, which is
also our behavioural proof that the key holds `LOCAL_UNLOCK`).
Q2 → decides native vs JS before we commit to the background work.
Q3 → M2 background presence.
Q4 → M3 polish and the off switch.

---

## ON-CAR CAPTURE (2026-07-20) — three unmodelled car→phone messages

M0 ran: every unsolicited frame logged over direct BLE while walking up to the
locked car. **36 frames, 24 distinct.** They arrive as `RoutableMessage`
envelopes (`to_destination=6`, `from_destination=7` = domain **2 / VCSEC**,
`payload=10`); the inner `FromVCSECMessage` field numbers seen were:

| inner field | count | modelled? |
|---|---|---|
| 1 (`vehicleStatus`) | 9 | yes — routine closure/lock pushes |
| **3** | 5 | **NO — primary suspect** |
| **44** (varint) | 2 | **NO** |
| **53** (LEN, 95B frame) | 1 | **NO** |

### The primary suspect: `FromVCSECMessage` field 3

Structure (consistent across all 5):

```
f3 {
  f2 = { f1 = <20 bytes> }   // KeyIdentifier{publicKeySHA1} shape (20B = SHA1)
  f3 = 2                     // constant across all samples
  f4 = <1 byte: 0x08 or 0x01>
}
```

**Timing is the strongest signal.** Nine of these arrived in a burst at roughly
**one per second** (06:15:00.5 → 06:15:08.9) and then stopped — *before* any
`vehicleStatus` traffic. A car-initiated message, repeated ~1 Hz and then
abandoned, is what an **unanswered challenge being retried** looks like. We
never replied to any of them.

Five distinct 20-byte values were observed (the car holds 5 keys, slots 0–4, so
these may be per-key identifiers — but note **none begins with our key's
`keyId` prefix `c6 e9 af 58`**, so they may instead be per-attempt nonces).
Resolving that ambiguity is exactly what we need the schema for.

Verbatim sample (full 41-byte frame, envelope included):

```
32 02 08 00 3a 02 08 02 52 1f 1a 1d 12 16 0a 14
29 d5 11 ed 01 e5 e9 1e f4 d8 9c be 8e 71 a2 55
33 dd 72 7e 18 02 22 01 01
```

Other observed 20-byte values (inside `f2.f1`):
`0c ca c7 db 46 79 e4 59 d7 b6 3f f0 a5 7d 5d 75 7e 07 f2 e6` (f4=0x08),
`a5 0f 6f 82 38 b4 63 8a 73 ba 5f 08 30 bf df 84 df 05 79 39` (f4=0x08),
`d8 aa ba 0a 5d a0 18 98 c5 47 5d a5 13 9a 44 6b 67 5d 16 5a` (f4=0x01),
`e5 ae c7 66 f6 45 c6 7b 55 9e 1d 8a ad 1f 11 97 b9 b5 c4 d7` (f4=0x08).

### Sharpened questions

- **Q1a:** What is `FromVCSECMessage` field **3**? If it is the
  `AuthenticationRequest`, give its full schema and the matching response
  message + which `ToVCSECMessage` arm carries it.
- **Q1b:** Is `f2.f1` (20 bytes) a key identifier or a per-attempt nonce? If a
  key id, why is it 20 bytes when `InformationRequest` targeting requires the
  **4-byte** truncation?
- **Q1c:** What are fields **44** (varint, values 1 and 2) and **53**?
- **Q1d:** `f3 = 2` is constant and `f4` is a single byte alternating 0x08/0x01.
  Do either map to `AuthenticationLevel` / `AuthenticationReason`? Note 0x08 and
  0x01 do NOT match the reason codes we already have (WALK_UP_UNLOCK=9,
  PASSIVE_UNLOCK_*=5/6/7, UI_UNLOCK_PASSIVE_AUTH=4), so this is likely a
  different enum — which one?

**Caveat for the analyst:** the identification of field 3 as the challenge is
inference from shape and timing, not proof. We could not correlate frames to
exact handle-pull moments. Treat it as the strongest lead, not a settled fact,
and say so if the binaries disagree.

---

## CONTROL RUN (2026-07-20, 09:41 local) — Q1b ANSWERED: the 20 bytes are a NONCE

Second capture with the **official Tesla app's Bluetooth disabled**, so the
official phone key was NOT present and the car did **not** unlock.

**The car still challenged us.** 25 × `f3` in three ~1 Hz bursts
(09:41:39–43, 09:42:10–18, 09:43:22–32), plus `f53` ×8 (220B), `f45` ×3,
`f44` ×2, `f1` ×5. Since BLE is point-to-point, these arrived on **our**
session — they are addressed to us.

### `f2.f1` is a per-attempt nonce, not a key identifier

| run | distinct 20-byte values |
|---|---|
| Tesla app BT **on** | 6 |
| Tesla app BT **off** | 6 — **zero overlap with the first run** |

Fresh values every burst, none repeating across runs ⇒ **nonce**, not an id.
This closes Q1b and removes the "why 20 bytes when targeting needs 4" puzzle:
the two are unrelated.

Sample nonces from the control run:
`8007be483870be60fa9360c93a15020a39de7f22`,
`de58544e6d7aa21b499f2c3ccbaea549741f6e50`,
`bdd995ed356ec79575e74043654371d4cfd85d40`.

### Our key identity, independently confirmed

`SHA1(ourPublicKey)` = `c6e9af58 20c1c2bf b0648f6b 80fc3a96 efe7cb81`, whose
first 4 bytes are exactly the `keyId` the car reported for our slot-4 entry.
Confirms both the extracted pubkey and the `keyId = SHA1(pubkey)[:4]` rule.
**No `f3` nonce matches this**, as expected for a nonce.

### Working model (high confidence, still not proof)

The car ranges our key on approach and issues `f3` carrying a fresh 20-byte
nonce, ~1 Hz. We never reply. It retries ~6–10 times, gives up, and does not
unlock. This is the M0 success outcome: **the car considers our
`ROLE_DRIVER` key present and worth challenging**, which is as close to a
positive eligibility answer as we can get without replying.

### Remaining questions, re-scoped

Q1b is answered. Still open and now higher value:
- **Q1a** — the schema of `f3` and, above all, **the response message**: which
  `ToVCSECMessage` arm, what is computed over the nonce (HMAC with the session
  key? ECDSA over the nonce? AES-GCM on the existing session?), and the
  counter/epoch/AAD rules.
- **Q1c** — what are `f44` (varint 1/2), `f45`, and `f53` (220B, recurring
  ~every 8s)? `f53`'s size and cadence suggest a status/beacon rather than a
  challenge, but that is a guess.
- **Q1d** — `f3.f3 = 2` constant and `f3.f4` = single byte `0x08`/`0x01`. Which
  enums? (Not the `AuthenticationReason` values we hold: 4/5/6/7/9.)
- **Q2** unchanged and now urgent: native or JS. The car retries at ~1 Hz for
  only ~6–10 s, so the response budget is a real constraint.
