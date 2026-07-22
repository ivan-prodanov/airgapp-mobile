# RE REQUEST #10 — connect-and-hold + one-session-over-two-transports + fast-fail hedging

**Requested:** 2026-07-21
**Goal:** validate (or refute) a specific transport design before we build it. We want to keep BOTH
paths to the car live (the phone's own BLE central + the Raspberry-Pi forwarder) and switch between
them in ~1s, WITHOUT the counter drift or nonce hazards RE #8 warned about. The design hinges on one
car-side fact we must not guess.

## The design we intend to build (please pressure-test)

- The phone holds **ONE** BLE central connected to the car (connect-and-hold), AND the Pi stays
  connected on its own radio — so both transports are warm at dispatch time.
- Because the car's ECDH key is **static** (RE #8), we plan to treat this as **ONE crypto VCSEC
  session** (one key, one counter, one epoch) whose **sealed frames can be delivered over EITHER
  transport interchangeably** — the transport is just a pipe.
- On a command: seal once (counter += 1), send over the preferred warm transport with a **~1s**
  timeout (warm exchange is ~100–250ms on-car); on timeout, send the **identical sealed bytes** over
  the other transport (same counter → the car should dedupe, so no double-actuation of toggles).

## The linchpin questions (car-side / official-app behaviour)

### Q1 — is a VCSEC session bound to a CONNECTION, or only to the (key, epoch)? ⭐ decides the whole design
RE #8 established the anti-replay counter is per-`(key, epoch)` and persistent across connections. But
we need the stronger claim for "one session, two pipes":
- Is a signed frame validated **purely** by `{keyId, epoch, counter, nonce, tag}` — so the car accepts
  it regardless of **which BLE connection (or the Pi's connection) it arrived on** — or is there any
  **per-connection binding** (a handshake-established session handle, a connection-scoped nonce/token,
  a `routing_address` tied to the specific link) that would make a frame sealed under "the session"
  **fail if delivered over a different connection**?
- Our routable command carries `fromDestination.routingAddress` (`session.routingAddress`). Is that
  **per-key / per-app**, or **per-connection**? If per-connection, can two live connections share one,
  or must each connection handshake its own — which would force two sessions (two counters) and break
  the one-session model?

### Q2 — the 2-central gate (RE #8 test #2, asked as RE)
Does VCSEC tolerate the **Pi's central AND the phone's central connected at the same time**? The cap
and the N+1 policy (refuse-connect vs evict-oldest vs evict-by-role) are VCSEC-internal — say what the
firmware/app imply, and whether the official app is ever knowingly connected via two centrals to one
car. If the car evicts, our fallback is BLE-when-present / Pi-otherwise; confirm that's the right
degrade.

### Q3 — duplicate-frame handling (for our fallback)
If the **same** sealed frame (same counter) reaches the car **twice** (over both transports), what
happens: silent dedupe + idempotent same reply, a `REPEATED_COUNTER`/replay fault, or a
connection-specific response? And critically — if it was **already applied** (e.g. an unlock landed
over BLE) and the duplicate arrives over the Pi, does the car reply **success** or a **fault**? We plan
to treat "duplicate counter" as success; confirm that's safe and name the exact response.

### Q4 — how does the OFFICIAL app actually do multi-transport?
- Does the app keep BLE **connected continuously** while in range (connect-and-hold), and route
  commands to BLE-vs-cloud by availability? Does it ever **hedge** (send over two paths, take first) or
  strictly sequential-fallback? Cite the selection/hold logic.
- Its remote path is Tesla's **cloud** (separate auth), not a BLE-forwarding proxy under the same VCSEC
  key — so it may never face our exact "same key, two live BLE-side sessions" case. If so, say plainly
  that the official app is **not** a precedent for one-session-two-BLE-transports, and tell us what the
  correct construction is for our topology.
- Any per-command **timeout** / retry cadence values visible (BLE reply-wait, fall-to-cloud trigger)?

### Q5 — counter discipline for one session over two pipes
Confirm the safe rule: with ONE crypto session (one local counter) and two transports, sending a
frame at `counter=N+1` over transport A and, on timeout, the SAME `N+1` frame over transport B is
counter-safe (never a NEW counter on fallback). And that if we ever need to send a *different* command
while the first is still in flight, we must serialize (one in-flight sealed counter at a time) — i.e.
the single-writer rule still holds even though there's one JS runtime.

## What this unblocks
- **Q1 yes (session is key/epoch-bound, not connection-bound)** → build the one-session/two-pipe hold
  with 1s fast-fail + same-frame fallback. Preferred.
- **Q1 no (connection-bound)** → we cannot share one session across two live connections; fall back to
  a single held BLE central used when present, Pi otherwise (still fast, still one counter, but not
  literally simultaneous), and we hand off by fully switching, not by dual-delivery.

## Constraints
Static RE (car firmware VCSEC where reachable + `authd` + decompiled app), cite + confidence, mark
VCSEC-internal-inferred vs proven, and give the exact on-car probe for anything not statically
determinable (we have the log pipeline and can hold both links + wedge/walk-up on demand).
