# RE REQUEST #20 — the PII key cannot be registered over BLE. Is that by design?

**Short version:** RESPONSE-19 Q1c was right that the scheme is fully air-gappable — local RSA
keypair, car wraps an AES key to it, everything offline. We implemented it end to end and it is
unit-tested against an independently-built envelope. **It still cannot be used over BLE, because
the two constraints are mutually exclusive.** We would like to know whether that is a fact about
the car or a gap in what we tried.

Everything below is measured on the car (HW4-Ryzen, 2026.20.6.6), direct BLE, one variable at a
time.

## What we measured

**1. There is a hard request-size cap of ~452 bytes on the wire.** Size ladder, identical
`pii_key_request` field, bogus pem-shaped payloads so only LENGTH varied:

| sealed body | on the wire (≈ +90B envelope +16B tag) | result |
|---|---|---|
| 80 B | ~186 B | REPLIED (270-4591 ms) |
| 148 B | ~254 B | REPLIED |
| 276 B | ~382 B | REPLIED |
| 372 B | ~478 B | **SILENT, 25 s** |
| 420 B | ~526 B | **SILENT** |
| 471 B | ~577 B | **SILENT** |

The car does not reject an over-cap request — it says nothing at all, consistent with QtCarServer's
`Dropping payload of size` / `exceeds maximumSize=`. **This answers your own Q4: the 452 B cap
(Android's `MAX_RX_BUFFER_SIZE`) is BILATERAL.** You flagged it as not statically decidable.

**2. An RSA-2048 PKCS#1 PEM cannot fit.** 434 chars ⇒ 451 B sealed ⇒ ~557 B framed. Dropped in
silence, every time. Stripping the `-----BEGIN/END-----` markers and newlines gets it to 360 chars
⇒ 380 B sealed ⇒ ~486 B framed — **still silent.**

**3. A key that FITS is answered, but the car mints no PII key.** RSA-1024 PKCS#1 PEM, 256 chars
⇒ 276 B sealed:

```
REPLIED — outcome ok, reply payload `0a 00`
7 pushes arrived at the requested DriveState rate
VehicleData field 900 (pii_key_response): ABSENT on every push
```

So the subscription itself works and the request parses. The car simply does not return an
`encrypted_pii_key` for a 1024-bit subscriber key.

**4. DER is not an escape.** `subscriber_public_key` is a protobuf STRING → UTF-8 on the wire, so
every byte above 0x7F is re-encoded: DER arrives corrupted AND longer. We did not waste a run on it.

## The questions

**Q1 (decisive). Is there a minimum subscriber key size?** We read the 1024 result as "refused for
being 1024", but `0a 00` carries no reason. If the car requires 2048, then registering a subscriber
key over BLE is IMPOSSIBLE by construction — 2048 cannot fit under a cap the car itself enforces —
and we would like that stated so we can stop. If 1024 should have worked, then something else about
our request is wrong and we would like to know what.

**Q2. Is cloud registration architecturally required?** RESPONSE-19 noted the app registers its
subscriber key through the **standalone (cloud) path** and only then subscribes over BLE. Given the
size arithmetic, we now suspect that is not a preference but a necessity. Is there ANY BLE-reachable
path that registers a subscriber key — a different message, a chunked/multi-part form, a
registration that persists across sessions so it only has to happen once by some other route?

**Q3. Is the ~452 B cap negotiable?** MTU exchange, a larger characteristic, a fragmenting path at
the application layer, a per-key or per-role limit? Or is 452 fixed for every BLE peer?

**Q4. Is `0a 00` really a refusal?** It decodes as an empty `actionStatus`, i.e. generic OK, and the
subscription plainly took effect. Does the car log a reason for declining to mint a key
(`handlePiiKeyRequest` / `Rotate PII key` / `check_pii_key` neighbourhood)? A string we could match
would turn our guess into a fact.

**Q5. Does a PII key, once registered by ANY route, persist?** `mPiiKeyData` and
`VehicleDataPiiKeyRotationPeriod` suggest per-subscriber state with a TTL. If a key registered once
survives, the constraint changes shape entirely — it becomes a one-time provisioning problem rather
than a per-subscription one. What is the TTL, and what is it keyed to (public key, key id, phone
key identity)?

## Why it matters to us

On this HW4 car **`DriveState` is PII-gated** — field 5 arrives present-and-empty with the content
in a field-11 `EncryptedData` envelope (`field_number = 5`). You expected cleartext and flagged the
choice as MCU2→HW4 divergent; it diverged. So without a PII key we lose live LOCATION *and* live
SPEED, not just location.

Everything else in RESPONSE-19 checked out on the wire and we are grateful for it: tag 37, the
per-state rate table (DriveState = 7), `EncryptedData` = {field_number, ciphertext, nonce‖tag with
nonce first}, AAD = be32(field_number), and the embedded-vs-standalone transport pin. The crypto is
implemented and passes end to end against an independently-built envelope. **The only thing
standing between us and live gated state is getting one public key to the car.**

## If the answer is "you cannot"

Say so plainly and we will stop — we have a working screen-keyed poll as the live-data path and
would rather bank that than grind. A clean negative is worth as much to us here as a workaround.
