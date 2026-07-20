# Passive entry (walk-up unlock) — design

**Date:** 2026-07-20
**Status:** design, not yet approved for implementation
**Supersedes:** roadmap C4 (proactive BLE switch-back)

## Goal

The car unlocks when you walk up to it with your phone in your pocket, with
airgapp closed — the way an official Tesla phone key behaves. No Tesla cloud,
no account, no UWB.

## What is already settled (do not re-litigate)

- **Our key needs no change.** Enrollment produces a `ROLE_DRIVER` /
  `KEY_FORM_FACTOR_IOS_DEVICE` key, byte-identical in type to an official driver
  phone key (research §1.1–1.2). Confirmed on-car 2026-07-20: our entry sits at
  slot 4 and is structurally identical to the car's three OWNER keys — same
  field set `[1,2,4,6,7]`, differing only in `keyRole`.
- **No UWB, no LE bonding, no `ROLE_OWNER` upgrade** is required (§1.3).
- **`LOCAL_UNLOCK` cannot be read.** The BLE `WhitelistEntryInfo` reply carries
  no `permissions` field for ANY key at ANY role on this firmware — three OWNER
  keys report none either. Eligibility is therefore only provable
  **behaviourally**. Do not build more read-based probes.
- **`bluetooth-central` background mode is already shipped** (roadmap C5).

## The two real unknowns

1. **Does the car challenge us at all?** Passive entry is car-initiated: the car
   ranges nearby keys and issues an `AuthenticationRequest` to whichever
   whitelisted, locally-present key it picks (§1.3). Whether it selects OUR key
   is the eligibility question we could not read. **If it never challenges us,
   the whole project is dead and nothing below matters.**
2. **We do not know the challenge's wire format.** Our vendored proto has **no
   `AuthenticationRequest`, no `AuthenticationResponse`, and no
   `AuthenticationReason` enum**. We know the reason *codes* from the decompiled
   Android app (`WALK_UP_UNLOCK=9`, `PASSIVE_UNLOCK_EXTERIOR_HANDLE_PULL=5`, …)
   but not the message shapes, and cannot decode or reply without them.

Both unknowns are answered by **one cheap experiment (M0)** before any
architecture is built.

## Milestones

### M0 — Capture the challenge (instrument only; no feature)

Log every unsolicited VCSEC frame, with raw hex, to the diagnostics file, then
walk up to the locked car with the app open and connected and pull a door handle.

- The plumbing already exists: `DirectBleTransport.onUnsolicited` →
  `handleVcsecPush` (built for instant closures) and
  `services/diagnosticFile.ts`. This is a logging change, not a feature.
- **Outcomes:**
  - **Frames arrive on handle-pull** → the car considers our key locally present
    and eligible. Eligibility effectively answered, AND we have the wire format.
  - **Only ordinary closure/lock pushes, no challenge** → the car is not
    selecting our key. Investigate why (ranging? role? presence?) before
    building anything.
- Cost: hours. Decisiveness: total. **Do this first.**

### M1 — Answer the challenge, foreground only

Implement decode + signed response using what M0 revealed, while the app is open
and connected. Walking up with the app foregrounded unlocks the car.

- **This is the definitive `LOCAL_UNLOCK` test** — the behavioural answer to the
  question the whitelist read could not give us.
- Deliberately excludes all iOS background complexity, so a failure here is a
  protocol failure and not an iOS-lifecycle failure. Do not conflate them.

### M2 — Background presence

Make it work with the app closed — the actual product.

- Core Bluetooth **state restoration**: `restoreStateIdentifier` on the
  `BleManager` + handling relaunch-into-background (deferred from C5).
- Reconnect policy: service-UUID-scoped scanning, reconnect on disconnect, and
  behaviour when the car sleeps and drops the link.
- **Ownership rule:** the passive-entry connection manager OWNS the BLE link.
  The command/telemetry path ATTACHES to it; it must not open or close its own.
  Two owners of one link is what caused the Pi orphan-session outage, and it is
  also why C4 was superseded.

### M3 — Robustness, battery, control

- Battery measurement over a full day; tune connection parameters if needed.
- A user-facing **off switch**. Automatic physical unlocking must be
  disableable, and should be off until explicitly enabled.
- Behaviour when several phones/keys are present; when the car is asleep.

## Risks, honestly stated

- **JS wake latency may be disqualifying.** The car waits only briefly for a
  challenge response. Our crypto is pure-JS (`@noble`), and after an iOS
  suspension the RN/Hermes runtime must wake, then sign. If that is too slow,
  the response path must move to native (Swift/ObjC), which is a materially
  bigger project. **Measure response latency in M1 before committing to M2.**
- **Unknown wire format** — mitigated by M0; if the capture is unreadable, this
  needs real RE effort and the estimate changes.
- **Security posture.** This makes the car open automatically on approach. It is
  the user's own car and their explicit goal, but it must be opt-in,
  disableable, and must not weaken the session crypto.
- **Eligibility is still unproven** until M1 succeeds. Equivalence with official
  driver keys is strong evidence (§1.4/§2.4) but is not proof.

## Acceptance criterion

Phone in pocket, app **closed**, walk up to the locked car, pull the handle →
it unlocks. Nothing short of that is "done"; every earlier milestone is a
checkpoint, not a claim.

## Explicitly out of scope

- UWB / `NISession` ranging and Hands-Free Trunk (§1.3 — not preconditions).
- Any cloud/OwnerAPI path (violates the airgap; the build test fails on it).
- `ROLE_OWNER` upgrade or card-free enrollment (§3.2) — unrelated to passive entry.
