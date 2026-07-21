# RE REQUEST #8 — is a SHARED key across Pi + phone-native provably unstable, or can a cutoff save it?

**Requested:** 2026-07-21 (follow-up to RESPONSE-7 L2)
**Goal:** reach a DEFINITIVE conclusion — for airgapp's two-path setup (Pi forwarder + phone-native
BLE, same enrolled key), is walk-up unlock ever at risk from the shared counter, and can an
aggressive "cut the Pi session the instant BLE detects the car" mitigation make ONE key provably
safe? Or must we use two keys?

## The setup + what we already know (please build on / correct)

- Two paths sign VCSEC frames under the **same enrolled key** → same `keyId=SHA1(pub)[:4]`:
  the **Pi** (dumb byte-forwarder; the phone does the crypto and relays ciphertext) and a future
  **phone-native** central for passive entry.
- The counter is **per-`(keyId, epoch)` and shared across clients** — confirmed in our own
  Tesla-derived code (`session.ts:502-516`, ported from `de0/C15009g.java:303-319`): on a
  SessionInfo refetch we take `Math.max(local, carReported)` *"because another client may have sent
  commands."* So both paths advance one car-side counter.
- RESPONSE-7 L2 concluded two concurrent sessions under one keyId **race the counter**. We want to
  know precisely how the car behaves, and whether coordination can eliminate the race.

## The scenario to adjudicate
App foreground, Pi session live and actively polling (advancing the shared counter). User walks up;
the phone-native BLE central connects and, on a handle-pull, must answer a challenge under the same
keyId. Our proposed mitigation: **the moment the native central detects/connects to the car, cut the
Pi's VCSEC session immediately** (close it; if needed, via an explicit command) so only one sender
exists by the time the handle is pulled.

## The questions that actually decide it (car-side VCSEC / authd — you have the 3.7 GB rootfs)

### Q1 — anti-replay model (the exact check)
- Is the counter check a **strict monotonic `>`** or a **sliding window**? If a window, what size, and
  what is the accept/reject rule for a counter **≤ window-top** vs a **forward jump**?
- What EXACT fault does a rejected (stale/replayed/out-of-window) frame return —
  `FAULT_AES_DECRYPT_AUTH`, a counter-specific fault, `TIME_EXPIRED`, or silent drop? Cite the
  VCSEC/authd symbol.
- Does a single rejected frame have any **persistent** effect (lockout, counter poisoning, session
  invalidation), or is it stateless-reject? (RESPONSE-3 Q3 said no lockout in authd — reconfirm for
  the counter path specifically.)

### Q2 — is the counter session-scoped or key/epoch-scoped? (does cutting the Pi session help?)
- Is the anti-replay state tied to the transient BLE/ECDH **session**, or purely to
  **`(keyId, epoch)`** and therefore persistent across sessions?
- Concretely: if we CLOSE the Pi's session, does the car's counter for that keyId **reset / release**,
  or does it persist so the native module simply continues from the last value (via SessionInfo
  read)? (We assume the latter — confirm.)

### Q3 — THE LINCHPIN: does the car allow concurrent authenticated sessions under ONE keyId?
- When the phone-native central completes a fresh `SessionInfoRequest` handshake under a keyId that
  **already has a live session** (the Pi's), does the car:
  (a) **invalidate/evict the prior session** (so the Pi's subsequent frames are rejected — i.e. the
      car ENFORCES one-session-per-key and the handoff is automatic), or
  (b) **keep both sessions live** sharing the one counter (so only OUR coordination prevents the
      race)?
- If (a): a native connect naturally cuts the Pi off car-side — is there still an **in-flight window**
  (a Pi frame already on the wire when the native handshake lands)? What happens to it?
- This single answer largely decides whether one key + cutoff is provably safe (a) or only
  practically safe (b).

### Q4 — connection / session slots
- How many concurrent BLE centrals AND how many authenticated VCSEC sessions does the car tolerate
  (per key, and total across keys)? What happens on the N+1th (refuse connect, evict oldest, refuse
  session)? This bounds whether Pi + phone-native can even both be connected, and whether two KEYS
  changes it.

### Q5 — what does the official app / firmware assume?
- Does anything in the firmware or app assume **one active client per key** at a time? Any evidence
  of the app deliberately tearing a BLE session before/So another can take over (the pattern we'd
  copy for the cutoff)?
- Two-keys sanity check: distinct keyIds ⇒ **fully independent** counters/epochs/anti-replay with no
  shared car-side state at all — confirm there is no other per-key-pair coupling we're missing.

## What we want out of this
A definitive verdict: **(1)** one shared key is unstable-by-design (race unavoidable) → two keys; or
**(2)** the car enforces one-session-per-key (Q3a) so a native connect auto-cuts the Pi and one key is
provably safe; or **(3)** it's coordination-dependent (Q3b) and we can close the window to X but not
to zero (quantify X). Plus the exact on-car test to confirm it.

## On-car test we can run (we have the pipeline + can wedge/walk up)
Bring the phone-native direct-BLE session UP while the Pi session is live under the same key; send a
Pi command and a native frame back-to-back; record: does the car reject one, with which fault; does
the native handshake evict the Pi session (send a Pi frame AFTER the native handshake and see if it's
rejected); repeat with our SessionInfo-refetch-before-send on/off. Tell us the precise sequence to run
so the result is unambiguous.

## Constraints
Static RE of the car firmware (VCSEC/authd), iOS/Android apps as before; cite locations + confidence;
flag anything only measurable on-car and give the exact measurement.
