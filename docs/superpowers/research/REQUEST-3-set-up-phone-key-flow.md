# RE REQUEST #3 — the "Set Up Phone Key" recovery flow

**Requested:** 2026-07-20 (follow-up)
**Blocking:** C1 (key-loss recovery) + robustness of everything else.
**Your #1 and #2 answers were both exactly right on-car** — the schema decoded our captures,
and the 4-byte-IV seal is now implemented and validated against OpenSSL. Thank you. This is a
different, smaller question, prompted by a real incident.

## What happened (the incident this is about)

On 2026-07-20 the car stopped accepting BLE from **any** client — our app AND the official
Tesla app both failed to connect for ~20 minutes. The fix was: **restart the car**, after which
the official app showed a **"Set Up Phone Key"** prompt (card + text: *"Enable passive entry and
remote controls"*, a "Set Up" button). After completing that, **both apps immediately worked
again.**

We've already added detection: `SessionInfo.status == SESSION_INFO_STATUS_KEY_NOT_ON_WHITELIST(1)`,
which we had never been reading. We believe that is the signal the app keys "Set Up Phone Key" on.

## Questions

### Q1 — Is `SessionInfo.status = KEY_NOT_ON_WHITELIST(1)` the trigger?
Confirm (or correct) that the official app surfaces "Set Up Phone Key" when the car reports this
status during the session handshake — vs some other signal (a `commandStatus` fault, a
`WhitelistOperation_Information`, a cloud/account check, an absence of the key in a `GET_WHITELIST_INFO`
sweep). We want to key our UI on the same thing the app does.

### Q2 — What does the app DO when the user taps "Set Up Phone Key"? (the important one)
This is the flow we want to reproduce. Specifically:
- Does it send the SAME `addKeyToWhitelistAndAddPermissions` / `SIGNATURE_TYPE_PRESENT_KEY`
  enrollment we already implement (card tap), or a **different** path because the key was
  *previously* enrolled — e.g. a re-activation that needs no card, an owner-authenticated re-add,
  or a cloud re-push?
- Our earlier report (`phone-key-authorization-and-passive-entry.md` §2.5) distinguished "session
  stale" (silent re-derive) from "key gone" (real re-add). This incident is the "key gone" case.
  **Does a key that was enrolled, then dropped by a car reset, come back via a plain PRESENT_KEY
  re-tap, or does the car remember it and accept a lighter re-activation?**
- Is there any state the app persists that lets it re-enroll WITHOUT a fresh card tap after a
  car-side whitelist wipe? (We are account-less and card-only, so if the app relies on owner/cloud
  auth here, we simply prompt for the card — but we want to know.)

### Q3 — Was the ~20-min total BLE lockout a known VCSEC behavior?
The part that worries us most: BLE was dead to **every** client, not just ours, for ~20 min before
the restart. Is there a known VCSEC state — a lockout after repeated failed auth, a whitelist-full
condition, a wedged pairing state — that (a) blocks ALL centrals and (b) is cleared by a car
restart? We had, shortly before, sent ~25 malformed `AES_GCM_TOKEN` responses (wrong IV) during our
passive-entry testing. **We need to know whether repeated bad signed-messages can trip a
VCSEC-wide lockout**, because if so we must harden against ever doing it again (we've added a rate
limit + circuit breaker, but knowing the real threshold/mechanism would let us set them correctly).

## Why this matters beyond the incident
C1 (detect + guide re-enrollment) is on our roadmap regardless. Q2 tells us what our recovery UX
should actually DO — prompt for a card, or something lighter. Q3 tells us whether our testing can
brick the car and how to bound it. Static RE of the "Set Up Phone Key" tap handler + any VCSEC
lockout/counter state in `authd`/firmware is what we're after; flag confidence and say when
something is car-internal and not in any image (we can test those on-car, carefully).
