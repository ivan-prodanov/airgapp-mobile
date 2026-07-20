# RE REQUEST #2 — the exact AAD + IV for the passive-auth seal

**Requested:** 2026-07-20 (follow-up to `REQUEST-passive-entry-challenge-protocol.md`)
**Blocking:** M1 walk-up unlock. Everything else works; this is the last byte-level gap.
**Your previous answer was excellent** — the schema decoded our captured frames exactly.
This is the one item you yourself flagged as "must test on-car", and the on-car test has
now run and *narrowed it sharply*. Below is hard evidence, not speculation.

## Where we are: the car evaluates our response and rejects ONLY the crypto

We implemented your recipe and answered a real challenge. The car replies, every time:

```
FromVCSECMessage.commandStatus(4) {
  operationStatus = 2
  signedMessageStatus(2) { counter = <OUR counter, echoed>, information = 6 }
}
        information 6 = SIGNEDMESSAGE_INFORMATION_FAULT_AES_DECRYPT_AUTH
```

That fault is enormously informative — it tells us what already WORKS:

| stage | status | because |
|---|---|---|
| `ToVCSECMessage`/`SignedMessage` envelope parsed | ✅ | else a decode fault |
| `keyId = SHA1(pubkey)[:4]` matched our key | ✅ | else `FAULT_NOT_ON_WHITELIST(2)` |
| token accepted as a token | ✅ | else `FAULT_INVALID_TOKEN(4)` |
| counter accepted (not replayed) | ✅ | else `FAULT_TOKEN_AND_COUNTER_INVALID(5)` |
| IV **length** accepted | ✅ | else `FAULT_IV_SMALLER_THAN_EXPECTED(3)` |
| **AES-GCM tag verify** | ❌ | **`FAULT_AES_DECRYPT_AUTH(6)`** |

So the message reaches the crypto and fails there alone: **our AAD and/or IV bytes differ
from what VCSEC computes.** Nothing else is wrong.

## What we have already ELIMINATED on-car (do not re-suggest these)

With `AAD = the bare 20-byte token`, we tried all four plausible 12-byte IV layouts —
each on its own challenge, each verdict attributed by the echoed counter:

| IV layout | verdict |
|---|---|
| 8 zero bytes ‖ counter BE32 | FAULT_AES_DECRYPT_AUTH |
| counter BE32 ‖ 8 zero bytes | FAULT_AES_DECRYPT_AUTH |
| 8 zero bytes ‖ counter LE32 | FAULT_AES_DECRYPT_AUTH |
| counter LE32 ‖ 8 zero bytes | FAULT_AES_DECRYPT_AUTH |

⇒ Either the IV is not a counter-in-a-zero-block, or **the AAD is not the bare token**
(a wrong AAD produces this exact fault regardless of IV).

## Our exact construction, so you can diff it against theirs

```
sessionKey = SHA1(ECDH_P256(ourPriv, carEphemeralPub))[:16]   // same key our COMMANDS use successfully
plaintext  = UnsignedMessage{ authenticationResponse(3) =
               AuthenticationResponse{ authenticationLevel=2(DRIVE, echoed),
                                       estimatedDistance=0, authenticationRejection=0 } }
             = 08 02 10 00 18 00   wrapped as  1a 06 08 02 10 00 18 00
aad        = <the 20-byte token, verbatim>
iv         = <the 4 layouts above>
ct,tag     = AES-128-GCM(sessionKey, iv, aad, plaintext)
frame      = ToVCSECMessage{ signedMessage(1) = SignedMessage{
               protobufMessageAsBytes(2)=ct, signatureType(3)=3, signature(4)=tag(16B),
               keyId(5)=SHA1(pub)[:4], counter(6)=<counter> } }     // token(1) omitted
```

## The questions

### Q1 (blocking) — what are the AAD bytes, exactly?
Our **working** command path (AES_GCM_PERSONALIZED over `RoutableMessage`) does NOT use a
bare AAD — it uses a TLV **metadata block**: `SIGNATURE_TYPE, DOMAIN, PERSONALIZATION(VIN),
EPOCH, EXPIRES_AT, COUNTER, FLAGS` + terminator/checksum. Our tag table also has
**`CHALLENGE = 6`**, which looks purpose-built for a token.

**So: for `AES_GCM_TOKEN`, is the AAD the bare token, or a metadata block?** If a block,
give the **exact tag list, order, value encodings, and terminator/checksum rule** — byte
for byte. If it really is the bare token, say so and the answer must be the IV.

### Q2 (blocking) — the exact 12-byte IV construction
`SignedMessage` has no nonce field, so it must be derived. Given the four layouts above are
eliminated, what is it? Candidates we'd like ruled in/out: a fixed per-session IV prefix
from the handshake; a hash over counter/token; the counter as 12-byte BE; an IV carried in
a field we're omitting.

### Q3 (path selection) — legacy vs universal, on 2024+ firmware
You noted a modern firmware "may also accept the universal `RoutableMessage` path
(AES_GCM_Personalized, challenge in `TAG_CHALLENGE`)". **Which does the official app use
for passive auth on current firmware?** Note our car answered with `signedMessageStatus`,
which suggests it at least *parses* the legacy path — but parsing is not preference.
If the universal path is what's used, that's ideal: it transmits a random nonce, so Q2
disappears entirely, and we already have that path working for commands.

### Q4 (cheap, likely) — is the plaintext right?
Is the sealed plaintext the serialized **`UnsignedMessage{authenticationResponse}`** (what
we send), or the **bare `AuthenticationResponse`** without the wrapper? A wrapper mismatch
would also present as a tag failure if the AAD covers length, and is trivial for us to flip.

## What would settle it fastest

A **byte-level trace or pseudocode of the seal** from the Android decompile
(`rb0/a.java:178-190`, `gf0/b.java:923-940`, `z.java:20-25` were your citations) — i.e. the
literal arguments passed to the GCM init: key, IV bytes, AAD bytes, in order. We can
reproduce anything if we can see the inputs.

**Confidence flags matter here.** We can test any hypothesis on-car within minutes and get
a precise per-attempt verdict (the fault codes above), so a ranked list of candidates is
genuinely useful — we will burn through it. What we cannot do is guess the space blind.
