# Roadmap

Living doc. Newest state at the top of each section. Anything claimed "done" here should name the
measurement that proved it — this project has been burned repeatedly by conclusions that were
reasoned rather than measured.

---

## P0 — tomorrow

### The BLE wedge — every exchange times out while the car is still talking
See **[BLE-WEDGE-2026-07-26.md](BLE-WEDGE-2026-07-26.md)** for the full write-up.

Highest priority because it breaks real use: sending a location to the car hangs and needs an app
restart, and it is unproven whether a walk-up unlock survives it.

Order of work, and the order matters:
1. **Instrument first** (§5 of the doc). The single question: during a wedge, are inbound frames
   well-formed but for an OLD uuid (correlation), or not well-formed at all (framing)?
2. Only then fix (§6). Leading candidate is a reassembly-buffer desync that cannot self-clear
   because the push traffic that causes it also suppresses the 1000ms stale-gap flush.
3. **Re-examine `BACKGROUND_READ_TIMEOUT_MS = 1200`** — it may make this worse, since giving up
   sooner guarantees the car's reply lands after we stopped waiting.

Repro (cheap, no handle pull): run **PE-4** with the car **unlocked and a door open**. Passes when
locked, fails when unlocked.

### Push the branch
**439 commits ahead of `main`, unpushed.** Today alone: the VDS protocol work, the PII crypto, six
probes, four correctness fixes to the unlock path. All on one machine.

---

## In flight

### Vehicle-data subscription + PII (the live-data path)
The car **does** stream over BLE — proven by rate sweep (asked 5000ms → got 4979/5010; asked
2000ms → got 1982/1983; zero domain-3 frames in the baseline). 23/23 pushes decrypt.

`DriveState` is **gated** on this HW4 car: field 5 arrives present-and-empty with the content in an
encrypted field-11 envelope (`field_number = 5`). RESPONSE-19 expected cleartext and flagged the
choice as MCU2→HW4 divergent. It diverged. **So live speed needs the PII key, not just location.**

**BLOCKED — the car will not accept a request big enough to carry the key.** Measured by the
VDS-M7 size ladder (2026-07-26), one variable, bogus pem-shaped payloads so only SIZE varied:

```
sealed  80B   REPLIED  (cold open, 4591ms)
sealed 148B   REPLIED   270ms
sealed 276B   REPLIED   360ms      ≈ 382B on the wire
sealed 372B   SILENT   25006ms     ≈ 478B on the wire
sealed 420B   SILENT   25005ms
sealed 471B   SILENT   25002ms
```

The cap sits between ~382B and ~478B on the wire — i.e. **452 bytes**, the same
`MAX_RX_BUFFER_SIZE` Android applies to its INBOUND routables. RESPONSE-19 Q4 asked whether that
cap was bilateral and could not answer it statically. It is.

An RSA-2048 PKCS#1 PEM is 434 chars, which makes the sealed body 451B and the frame ~557B. **It
cannot fit.** The car drops it silently — no rejection, just 25s of nothing, exactly as
QtCarServer's "Dropping payload of size" / "exceeds maximumSize=" implies.

This very likely explains Tesla's own architecture: RESPONSE-19 noted the official app registers
its subscriber key through the **standalone cloud path** and only then subscribes over BLE. The
embedded field is real and BLE-legal, but unusable at RSA-2048 because it does not fit.

**Both fitting encodings tried (VDS-M8). The path is CLOSED over BLE, and here is why plainly.**

```
RSA-1024 PKCS#1 PEM        sealed 276B   REPLIED (0a 00)   7 pushes, wrapped key ABSENT
RSA-2048 PEM, stripped     sealed 380B   SILENT            over the cap
```

The two constraints are **mutually exclusive**:

- a key large enough for the car to accept (2048) produces a request that does not FIT;
- a key that fits (1024) is parsed and answered — and the car mints NO PII key for it.

Raw DER is not an escape: `subscriber_public_key` is a protobuf STRING, i.e. UTF-8 on the wire, so
bytes above 0x7F are re-encoded and DER arrives corrupted AND longer. It is an invalid encoding of
this field, not a compact one.

So an air-gapped client cannot register a subscriber key over BLE. This is consistent with, and
probably explains, RESPONSE-19's observation that the official app registers its key through the
**standalone cloud path** and only then subscribes over BLE — a route we will not take.

**Consequence, stated rather than hedged:** live LOCATION is out of reach, and on this HW4 car so
is live SPEED, because `DriveState` is PII-gated here. The subscription itself works fine — 7
pushes arrived on the 1024 rung — we simply cannot open the envelopes.

What is NOT ruled out, and would need the miner (REQUEST-20):
- whether the car has a minimum subscriber key size, or refused the 1024 key for another reason;
- whether any BLE-reachable path registers a subscriber key at all, or whether the cloud
  registration is architecturally required;
- whether the ~452B cap is negotiable (MTU, or a fragmenting path we have not found).

Until then the screen-keyed poll below is the live-data story, and it is a good one.

Prior context: the car DOES stream over BLE — proven by rate sweep (asked 5000ms → got 4979/5010;
asked 2000ms → got 1982/1983; zero domain-3 frames in the baseline), 23/23 pushes decrypt, and
`DriveState` is gated on this HW4 car (field 5 present-and-empty, content in a field-11 envelope).
The crypto is unit-tested end to end against an independently-built envelope, so nothing here
points at our implementation.

### Screen-keyed focused read (live speed via polling)
Enabled. Gated on three measured fixes: deaf window (PE-1, 15 lost → 0, answered at 2ms),
eviction scope (PE-5, lock session survives), command latency (PE-4, 4171ms → 387ms worst).

- **Untested: the actual outcome.** Nobody has driven the car and watched the speed line update on
  its own. Everything so far is link-level measurement.
- Cadences: security 1250 / scheduling 2500 / location 5000 are PROVEN; controls 1650 and climate
  5000 are INFERRED. Home→drive is OUR choice, not recovered.

---

## Known hazards, not yet fixed

### Two gateways over one session counter
`carlink.tsx`'s `makeGateway()` builds its own `SessionQueue`; `useCarLink` has another. Two
writers on one monotonic counter — the exact race `SessionQueue` exists to prevent, one level up.

Mitigated for the eight **probes** (they hold the app's polling while they run). **Still live for
the debug screen's Lock / Unlock / Wake buttons.** Proper fix is one shared gateway — a real
refactor of `carlink.tsx`, deliberately not started at the end of a long day.

### The `writePending` deferral is freshest-first
If several challenges pile up inside the seal→write hazard, only the newest is answered. Correct
in principle — the car re-challenges with a new nonce and older ones are dead — but unverified
against a real burst.

---

## Backlog

- `getGuiSettings` (Tier 2) — authoritative km/h vs mph instead of inferring. Self-contained.
- REQUEST-19 Q3 leftovers: does an active subscription hold the car AWAKE? Do subscriptions
  survive a BLE reconnect? Do they accumulate? **Do not ship a standing subscription until the
  keep-awake question is answered** — battery.
- ~30 BLE-buildable commands and 19 unread state submessages (RESPONSE-15 P2).
- Multi-stop nav: dropped. f21 is the only message honouring PREPEND/APPEND and cannot be trusted
  with coordinates; route state is unreadable while locked.

---

## Method notes worth keeping

Six times on 2026-07-26 a probe hid the evidence it was built to collect: hex printed only for
frames passing the predicate under test; a reply logged as ASCII so the distinguishing bytes were
lost; pings rendered as "no recognised state slices"; swallowed ack errors; a verdict on the
median that buried a 4171ms outlier; a load that omitted the priority it was meant to model.

The rule that came out of it: **never gate the evidence dump on the classification being tested,
and never verdict on a statistic that can average away the failure case.** A probe that cannot
show it did the thing it was testing must report VOID, not a result.
