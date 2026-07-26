# RE REQUEST #19 — vehicle-data subscription over BLE: the PII key, and the encrypted-state envelope

**Status of the thing this is about: NOT a hypothesis. Measured on the car.**

RESPONSE-15 P0-1 concluded the vehicle-data subscription was "a 12-byte experiment, rank it ~17th, the app never sends it over BLE and 4.58.0 kill-switches it." We built the experiment. **The car pushes state over BLE, at the rate we ask for.** Two independent runs, car parked and locked, direct BLE:

| | baseline (nothing subscribed) | requested 5000 ms | requested 2000 ms |
|---|---|---|---|
| run 2 | 7 frames, **0** from domain 3 | 6 frames, median gap **4979 ms** | 16 frames, median gap **1982 ms** |
| run 3 | 0 frames | 7 frames, median gap **5010 ms** | 16 frames, median gap **1983 ms** |

The cadence tracked a parameter we chose, at two different rates, in a single run — nothing else on that link follows a number we picked (our own polls are 20 s VCSEC / 60 s infotainment). **23/23 pushes decrypted.**

Your refutations were all correct and all turned out to be about the *app*, not the *car*. The load-bearing evidence was the car-side chain you also found — `handleSubscription → transmitCarData → handleSendToInfotainmentDispatcher`, handle-keyed with zero transport selection. **The car supports more than the app exercises.** Please carry that lesson into the answers below: we need what the CAR accepts, and "the app doesn't do this" is not an answer.

## What we have nailed down (so you don't re-derive it)

- `VehicleAction` tag **37** = `VehicleDataSubscription`. Confirmed semantically, not just by ACK — see the oracle below.
- Sub-fields confirmed on the wire: **3** = `subscription_duration_s`, **10** = `LocationState_max_update_rate_ms`, **12** = `subscription_ping_s`.
- Sealed body for one state, 60 s TTL, 5 s rate, 10 s ping: `12 0A AA 02 07 18 3C 50 88 27 60 0A`.
- ⚠ **Correction to RESPONSE-15:** the cancel frame is printed there as `12 02 AA 02 00`. That is a typo — the body `AA 02 00` is three bytes, so the length prefix is `03`. Correct frame: `12 03 AA 02 00`.
- **Push AAD binding:** every push decrypts as an `AES_GCM_Response` whose `REQUEST_HASH` is the GCM tag of **the subscribe request that armed the subscription**. We tested three candidates; 23/23 opened on that one, 0/23 on the alternatives.
- Push envelope: `to_destination.routing_address` is constant within a subscription and changes between subscriptions; `from_destination.domain = 3`.

## The blocker — Q1 (decisive, everything else is secondary)

Omitting `pii_key_request` does **not** merely skip an optional extra. The car replies with the literal string **`No PII request`** (your own QtCarServer find), and then delivers:

```
12 <len>          Response.vehicleData
  42 00           location_state (field 8) — PRESENT AND EMPTY
  5a <len>        field 11 — UNDECLARED in any proto we hold
    08 08           field 1 = 8      ← location_state's own field number
    12 61|62        field 2 = 97-98 bytes, Shannon entropy 7.91 bits/byte
    1a 1c           field 3 = 28 bytes  ← 12-byte GCM nonce + 16-byte GCM tag?
```

Field 2 changes **completely on every push while the car sits still** — plaintext location would be byte-identical — so it is ciphertext with a fresh nonce. Read with `No PII request`, the envelope appears to be *"the content of field 8, encrypted to a subscriber key you did not give me."*

**Q1a. What are the inner field numbers of `pii_key_request` (`fc0/x5` field 13)?** You reported it carries `fc0/z2 subscriberPublicKey` and `fc0/a3 subscriberPublicKeyExpiration` — we need the **tags**, the **key encoding** (SEC1 uncompressed 65 B? compressed 33 B? DER?), and whether the **expiration is required** for the car to accept the request at all, plus its unit/epoch.

**Q1b. What is `VehicleData` field 11?** Name, message definition, and the meaning of its field 1 (we read 8, which matches `location_state`'s tag — is field 1 a *state selector*, so one envelope can carry any PII state?).

**Q1c. How is field 2 encrypted, and can an air-gapped client decrypt it?** Specifically: is the content key derived by ECDH against the `subscriber_public_key` we supply (in which case our own P-256 device key is enough and this is fully solvable), or against a Tesla-held/cloud key (in which case it is not, and we stop)? What are field 3's 28 bytes — nonce‖tag, and in which order? What is the AAD?

**Q1d. Is there a non-PII path to live location at all?** E.g. does a `DriveState` subscription return coordinates in the clear, or is every location field PII-gated regardless of which state is subscribed?

We are meanwhile running a candidate sweep on-car (key at tag 1 vs 2, with and without an expiry field) using `No PII request` as the oracle — a candidate that parses must change that reply. **If we report back that a candidate won, Q1a is answered and you can skip it.**

## Q2 — per-state rate tags (cheap, unblocks breadth)

We declared only `LocationState_max_update_rate_ms = 10` because it is the only per-state tag you recovered a number for. You listed thirteen more states by NAME (ChargeState, ClimateState, ClosuresState, DriveState, GuiSettings, VehicleConfig, VehicleState, ParkedAccessoryState, ChargeScheduleState, PreconditioningScheduleState, AlertState, SuspensionState, ChildPresenceDetectionState). **Please give the tag numbers.**

We deliberately will not guess these: an unknown tag is skipped silently by the car, so a wrong guess is indistinguishable from "this state is not supported" — the exact ambiguity that made our first probe run uninterpretable.

Priority order for us: **DriveState** (speed/gear — this is the live-status use case), ChargeState, ClimateState, ClosuresState.

## Q3 — subscription lifecycle over BLE

Not covered by your Hermes-path answer, and it decides whether this can ship as a feature rather than stay a probe.

1. **Sleep.** What happens when the MCU dozes with a live subscription — silently dropped, or resumed on wake? Does an active subscription *keep the MCU awake*? (Battery-relevant; we will not ship something that stops the car sleeping.)
2. **Reconnect.** Does a subscription survive a BLE drop/reconnect, or must the phone re-arm? If it survives, what is it keyed to — the session, the connection handle, or the key?
3. **Multiple subscriptions.** Ours accumulate if not cancelled. Does a second subscribe from the same key REPLACE the first or ADD to it? Is there a per-key or per-car cap?
4. **The ack.** You found `handleAck:` in QtCarServer. Does the car expect the phone to ACK pushes, and what happens over BLE if it never does — back-off, drop, or nothing?
5. **Ping.** We set `subscription_ping_s = 10` and did not obviously receive distinct ping frames (every push was a state frame). What does a ping look like on the wire, and is it distinguishable from a state push?

## Q4 — is our 1024 B inbound cap a real constraint?

Android's `MAX_RX_BUFFER_SIZE = 452` discards longer inbound routables; ours is `MAX_BLE_MESSAGE_SIZE = 1024`. Our one-state pushes are 242-243 B, comfortably inside both. **Is the cap bilateral** — i.e. does the CAR also cap what it will send over BLE, and does it silently drop a state whose serialized size exceeds that, or fragment it? This decides whether subscribing to several states at once is viable or whether we must subscribe one at a time.

## Q5 — the thing that started all this (lower priority now, but still open)

Independent of the subscription: `startBleVehicleUpdates` (#159624, the sibling saga that passes `useBluetooth=TRUE`) polls infotainment over BLE **per active screen** at 1250–5000 ms. `tesla-live-status-push-FINDINGS.md:42` has the range and the screen literals, but only the security-screen→1250 ms mapping is unambiguous. **Which delay goes with which screen** (`'on controls screen, fetching drive state'` @6831997, `'on climate screen, fetching climate only'` @6831987, and the 1650/2500/5000 constants)? And does that loop change cadence while DRIVING, or only by screen?

This is our fallback if Q1c comes back "cloud key only" — we would match Tesla's real BLE strategy instead.

## Honesty note on our side

The first version of our probe reported a false `NO_PUSHES` because of two bugs of ours: we read `Destination` field 2 (`routing_address`) instead of field 1 (`domain`), and our push predicate excluded frames carrying a `request_uuid` — which your own RESPONSE-15 identifies as this mechanism's correlation tag. Nine perfectly good 5-second pushes got classified as nothing. **Treat any earlier negative we reported to you about BLE pushes as void.**
