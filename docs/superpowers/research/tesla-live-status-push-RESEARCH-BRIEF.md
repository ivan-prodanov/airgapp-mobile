# RESEARCH BRIEF — How the official Tesla app updates closures/lock INSTANTLY (BLE push, not poll)

## Why this matters (the observed gap)

On the real car, the official Tesla app reflects a **frunk / trunk / door open or close INSTANTLY** — no pull-to-refresh. Our app only picks up the change on its next 20s VCSEC poll.

## What we already know (verified in OUR code — do not re-derive, CONFIRM/EXTEND)

Our `src/ble/directBleTransport.ts` already subscribes to the car's RX notify characteristic
(`monitorCharacteristicForService(SERVICE_UUID, RX_UUID, …)`, line ~195). Inbound frames are
reassembled into an inbox. But our `exchange()` is strictly request→reply: it drains the inbox
before writing, then keeps only the frame whose correlators match the command it just sent, and
**explicitly discards everything else as "unsolicited broadcasts / late replies"** (see the comments
at lines ~145 and ~213). 

So our strong hypothesis is: **VCSEC pushes unsolicited `VehicleStatus` messages over the BLE notify
characteristic on state change, and the official app applies them immediately; we receive the same
frames and throw them away.** This brief is to CONFIRM the exact mechanism and, crucially, the
implementation details we need to build it correctly — not to re-establish that a push exists.

## Source

Decompiled iOS app at `/Users/ivan/Downloads/tesla-haptics-work/main.decompiled.js` (Hermes-decompiled;
same source used by prior FINDINGS). Tag every hard claim `[iOS-verified]` with grep hit / line; mark
inferences `[INFERRED]`. Also cross-check against the Tesla vehicle-command BLE spec / VCSEC protobufs
if referenced in the bundle.

## Questions to answer (in priority order)

1. **Push vs fast-poll — which is it, precisely?**
   - Does the car send **unsolicited** `VehicleStatus` (VCSEC) frames on the notify characteristic when
     a closure/lock changes, which the app just listens for? OR does the app **rapid-poll** VehicleStatus
     over the kept-alive connection (and if so, at what cadence — the optimistic-buttons findings quoted
     5000ms online / 1200ms waking, which is NOT "instant", so a 5s poll can't explain instant closures)?
   - If BOTH exist, which one drives the instant closure UI specifically?

2. **The subscribe / enable step (CRITICAL for our impl).**
   - Is the push **automatic** once connected + subscribed to the GATT notify characteristic, or does the
     app first send a command to *request* a status stream (e.g. a VCSEC `InformationRequest` for a
     subscription, an "enable notifications"/status-subscribe write, or a keep-alive)? Quote the exact
     message/opcode if so.
   - Is there a periodic keep-alive/heartbeat the app sends to keep the car pushing?

3. **What exactly is pushed.**
   - The message type(s): is it the same `VehicleStatus` (with `closureStatuses`, `vehicleLockState`,
     `userPresence`) our poll already parses, or a different/lighter delta message? List the fields that
     arrive in a push.
   - Does the push cover ONLY VCSEC domain (closures/lock/presence), or also infotainment (charge/climate)?

4. **How the app processes a push.**
   - The handler: where an inbound notification frame is parsed and dispatched into state (redux action /
     reducer) WITHOUT a matching outbound request. Contrast with the request/reply path. Give the function
     line(s).

5. **Connection lifetime.**
   - Does the app hold ONE long-lived BLE connection (so pushes keep flowing), vs our open→exchange→close
     per poll? When does it connect/disconnect (foreground only? background?)? Does it re-subscribe on
     reconnect?

6. **Over the network path (their analogue of our Pi).**
   - When the app talks to the car via the cloud/Tesla infra rather than direct BLE, do closures still
     update push-style (streamed), or does it fall back to polling? This tells us whether "instant" is
     BLE-only in their app too, or whether a streamed forwarder is expected.

## Deliverable

Write findings to `docs/superpowers/research/tesla-live-status-push-FINDINGS.md`:
- A direct verdict on Q1 (push vs fast-poll) with the code evidence.
- The exact subscribe/enable sequence (Q2) — this is what we most need to implement it.
- The pushed message type + fields (Q3), the push handler (Q4), connection lifetime (Q5), network path (Q6).
- A short "what this means for our stack" section: what to change in `directBleTransport.ts` (stop
  discarding unsolicited `VehicleStatus`; route it to a telemetry apply) and `useCarLink.ts` (an
  event-driven apply path alongside the poll), and what the Pi forwarder would need (streaming) for
  instant-over-Pi.
