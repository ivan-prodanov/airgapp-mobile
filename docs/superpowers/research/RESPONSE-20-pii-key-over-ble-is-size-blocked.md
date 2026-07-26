# RESPONSE #20 — registering a PII subscriber key over BLE is impossible by construction

**Answering:** `REQUEST-20-pii-key-over-ble-is-size-blocked.md`
**Method:** static RE of the car firmware `QtCarServer` (`CarDataEncryptionManager`, x86-64 MCU2-Intel
2026.14.3) + Android app + Hermes bundle. Your on-car measurements (HW4-Ryzen 2026.20.6.6) line up
with the image exactly, so the generation caveat is *satisfied* here rather than hanging over us.

---

## Verdict: you cannot. Stop and bank the poll.

Your read was right, and it's worse than "the key doesn't fit." The car doesn't want a 2048-bit
key at all — **it requires an RSA‑4096 subscriber key, and only 4096**, whose public key is ~800
bytes in the format the car parses. That is roughly **double** the ~452 B inbound cap the car itself
enforces. There is no MTU knob, no per-key exception, and no chunked BLE registration path. The only
transport that can carry a key that large is **`TRANSPORT_HERMES` (Tesla cloud)** — which is exactly
what the official app uses, and exactly what your air-gap forbids.

Your 1024 experiment failed for **two independent reasons**, either of which is fatal and neither
fixable under the cap: **wrong size** (128-byte wrap ≠ the required 512) **and wrong PEM format**
(you sent PKCS#1; the car parses SPKI). More on the format below — I owe you a correction there.

This is a clean negative. The crypto you built is correct and will decrypt real envelopes; it just
can never be handed a car-minted key over BLE.

---

## The proof — Q1 (is there a minimum key size?)

It isn't a *minimum*, it's an *exact* requirement. In `CarDataEncryptionManager::encryptPiiKey`
(`QtCarServer` @ 0x978770) the car RSA-wraps the symmetric PII key to your public key and then checks
the **wrapped-ciphertext length**:

```
0x978963  call  CarDataEncryptionManager::rsaEncrypt   ; eax = RSA_public_encrypt() length = RSA_size(pub)
0x978968  mov   ebp, eax
0x97896d  call  RSA_free
0x978972  cmp   ebp, 0x200                              ; 0x200 = 512
0x978978  je    0x978ad8                                ; == 512 → mint & attach PiiKeyResponse
          ; else → Logger("cipher length was " << ebp << " instead of " << 512), no key minted
```

- `rsaEncrypt` (@ 0x977e40) is a thin wrapper over `RSA_size` + `RSA_public_encrypt`, so `ebp` is
  the modulus size in bytes. **`cmp ebp, 0x200` is the ONLY size comparison in the whole function** —
  there is no alternate `cmp ebp, 0x100` (256/RSA-2048) or `0x80` (128/RSA-1024) success path. The
  car accepts **exactly 512 bytes = RSA-4096, nothing else.** *(PROVEN, disassembly.)*
- The error string is literally **"cipher length was `<N>` instead of `<512>`"** (rodata
  0x124ba9d/0x124baaf).
- Your RSA-1024 key wraps to **128 bytes**. `128 ≠ 512` → the log fires, **no PII key is minted**,
  the subscription is otherwise accepted → you got `0a 00` and pushes with no field 900. This is the
  complete, exact explanation of measurement #3. It was never going to mint, at any size below 4096,
  in any PEM format.
- Corroborating invariant: a sibling function (@ 0xa5ce30) carries the string **"Recipient public
  keys and wrapped keys must be of the same size for key="** — the car wraps one symmetric PII key to
  a *set* of recipient keys and requires them all to be the same RSA size. Tesla's fleet PII keys are
  4096; the hardcoded `== 512` is that standard baked in.

**So Q1's answer: the required size is 4096, exact. Registering it over BLE is impossible because
4096 cannot fit under the car's own inbound cap.** State it and stop — that's your ask granted.

### The size arithmetic that closes it

An RSA-4096 **public** key:

| encoding | size |
|---|---|
| raw modulus + exponent | ~518 B |
| SPKI DER (what the car parses) | ~550 B |
| base64 of that DER | ~740 chars |
| SPKI PEM (`BEGIN PUBLIC KEY` + newlines) | **~800 chars ≈ 800 B** |

…before the protobuf string framing and the ~90 B + 16 B AES-GCM envelope you measured. Call it
**~900 B on the wire.** Your measured silent-drop threshold is ~452 B framed. Not close. Even the
most compact possible transport of a 4096 public key is ~2× the cap.

---

## Correction to RESPONSE-19 — I got two details wrong, own them

1. **Format: it's SPKI, not PKCS#1.** RESPONSE-19 told you `subscriber_public_key` is a PKCS#1
   `-----BEGIN RSA PUBLIC KEY-----` PEM. **Wrong.** The car parses it with OpenSSL
   **`PEM_read_bio_RSA_PUBKEY`** (@ 0x978931), which reads **SubjectPublicKeyInfo /
   `-----BEGIN PUBLIC KEY-----`**. The app agrees — the Hermes bundle reformats to
   `-----BEGIN PUBLIC KEY-----` (SPKI) before sending, and the RN helper `zc/c.o()` I cited (PKCS#1)
   is the *generic* RNRSA export, not the PII path. So your 1024 run, following my guidance, also had
   the wrong header/ASN.1 and would not have parsed even if the size had matched.
2. **Size: it's exactly 4096, not "2048 default."** RESPONSE-19 inferred RSA-2048 from RNRSA's
   `generate()` default. The PII path calls `generateKeys(4096)` explicitly (the literal isn't
   string-searchable in Hermes, but the car's `== 512` gate makes it certain — a 2048 key wraps to
   256 and is rejected identically to your 1024).

Neither correction rescues the feature; both make the negative *more* certain (4096 is even more
unfittable than 2048). But you deserve the accurate mechanism, and I'd rather flag my own errors than
let you burn another run on an SPKI-formatted 2048 key that still can't mint.

---

## Q2 — is cloud registration architecturally required? Yes.

There is exactly one message shape that carries the subscriber key (`CarServer.PiiKeyRequest`,
`subscriber_public_key` string), and two ways to send it:

- **Standalone top-level PII request → pinned to `TRANSPORT_HERMES` (cloud)** by the app's own
  transport selector (`pb0/b.b()`, RESPONSE-19). This is the path the official app uses. Cloud has no
  452 B cap, so a ~900 B 4096 key rides fine.
- **Embedded in the subscription (x5 field 13) → rides BLE.** This is your path, and it's the one the
  cap kills.

Internally the car has a D-Bus method `handle_subscriber_key(subscriber_public_key: s,
subscriber_key_string: s, subscriber_key_expiration_s: i)` that writes the subscriber into its DB —
but that method is invoked *by the cloud-request handler inside the MCU*, not reachable as a BLE
message of its own. **There is no BLE-reachable path — no alternate message, no multipart form — that
delivers a 4096-byte-class key to the car.** The official app registers over cloud precisely because
the key cannot fit over BLE. It's a necessity, not a preference.

## Q3 — is the ~452 B cap negotiable? Not usefully, and it wouldn't matter.

- The drop is an application-layer size cap, not just an ATT-MTU limit — the car logs
  `exceeds maximumSize=` / `string length exceeds max size` and silently discards, matching your
  ladder (≥~478 B framed → silent). There is no per-key, per-role, or MTU-negotiated exception in the
  handler; the cap applies to the reassembled command regardless of characteristic or MTU.
- Even if you could double it, a 4096 SPKI PEM (~800 B) plus envelope (~900 B) would need the cap
  pushed to ~2× with margin, and nothing suggests that's reachable from a BLE peer. So Q3 is moot:
  the size requirement and the cap are set by the same vendor to be mutually exclusive over BLE.

## Q4 — is `0a 00` really a refusal? It's "subscription OK, key mint silently failed."

- `0a 00` = an empty `actionStatus` = generic OK for the *subscription action*. The subscription did
  take effect (your 7 pushes). The **PII-key mint is a separate step** inside
  `getPiiKeyResponse → handleSubscriberKey → encryptPiiKey`; when `encryptPiiKey` hits the
  `128 ≠ 512` gate it logs and returns without attaching a `PiiKeyResponse`. The client sees no field
  900 and no error — the failure is only in the car log.
- The car-side reason strings you can match if you ever get console/diag access:
  **`cipher length was … instead of …`** (the size gate), `No PII key data`,
  `encryptVehicleData failed. Bailing`, `PEM_read_bio_RSA_PUBKEY failed with` (format/parse gate),
  `RSA_public_encrypt failed with`. A parse failure (wrong PEM format) and a size failure land in
  different strings — worth knowing, but academic now.

## Q5 — does a registered key persist? Yes — but every route you own is capped.

The car keeps a **subscriber database**, so registration is one-time and durable, not per-session:
- `CarDataEncryptionManager::{writeKeyRow, updateKeyRow, dump_subscriber_database}`, records of type
  `SubscriberKeyData{QString subscriber_public_key, QByteArray pii_key, int64 expiration}`.
- TTLs are config-driven (`VehicleDataSubscriberKeyExpirationPeriod` for the subscriber key,
  `VehicleDataPiiKeyRotationPeriod` for the symmetric key). The car checks
  `now_ms >= mPiiKeyData->mPiiKeyExpiration` and re-wraps on rotation; a still-valid key short-circuits
  (`Subscriber's PII key still valid`). The exact periods are runtime config, not literals in this
  image, so I can't hand you the day count — but persistence is real and keyed to the subscriber
  public key.

**Why this doesn't save you:** persistence would turn it into a one-time provisioning problem *if you
had any route that could carry the 4096 key even once*. You don't. The Pi is BLE (same cap). The only
large-message route is Tesla's cloud (Hermes), which is the air-gap line you won't cross. And the key
the car *already* holds (the official app's, cloud-registered) is wrapped to a private key you don't
possess — which is exactly why those existing field-11 envelopes are undecryptable to you. Dead end
in every air-gapped direction.

---

## What you keep, and one thing to re-check

- **Bank the screen-keyed poll for whatever states arrive in the clear.** The PII gate is per-state,
  decided car-side (`addPiiKeys`). You measured that on your HW4 car **DriveState is gated** (field 5
  empty, `field_number=5` envelope) — so, importantly, the poll and the subscription **both** lose
  live speed *and* location on this car, since both flow through the same PII gating. Cleartext states
  (charge, climate, closures, etc.) still come through on either path.
- **Worth a five-minute measurement before you fully close this:** subscribe with *only* cleartext
  states (ChargeState=5, ClimateState=6, ClosuresState=11 rate tags) and confirm they arrive
  populated (field 3/4/9) with no field-11 envelope. That tells you the exact cleartext surface you
  can build live UI on without any PII key. My expectation: everything except LocationState and
  DriveState is cleartext, but the DriveState gating already surprised us once, so measure rather than
  trust me.
- **Live location is gone for the air-gapped client, full stop.** The car's own coordinates live only
  in LocationState, which is PII-gated behind a key you can't register. No workaround exists.

## Bottom line

The two constraints aren't a gap in what you tried — they're a designed mutual exclusion: the car
demands a 4096-bit subscriber key and refuses to receive one over BLE. Registering a PII key
air-gapped is impossible. The crypto you built is correct and worth keeping for the day you ever have
a car-minted key by some other means; today, ship the poll for cleartext states and treat live gated
state (location, and on this car speed) as unavailable offline.
