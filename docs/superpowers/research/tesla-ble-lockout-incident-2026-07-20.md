# Checkpoint — the 2026-07-20 car-wide BLE lockout

**Status:** parked for later (belongs to the "Set Up Phone Key" / C1 work, NOT to
be worked now). Recorded while fresh so it can be reproduced deliberately later.
**Open question feeding this:** `REQUEST-3-set-up-phone-key-flow.md` Q3.

## What happened

During passive-entry M1 testing, over a few minutes we sent the car **~25
malformed `AES_GCM_TOKEN` signed messages** — responses to its
`AuthenticationRequest` with a **wrong IV** (four 12-byte layouts × the cycle).
Every one was rejected by VCSEC with
`SIGNEDMESSAGE_INFORMATION_FAULT_AES_DECRYPT_AUTH(6)`.

Shortly after, the car **stopped accepting BLE connections from every client** —
airgapp AND the official Tesla app both failed to connect for ~20 minutes
(symptom in our logs: scan succeeds, `connect()` wedges → 10s timeout, every
attempt). It cleared only after:

1. **Restarting the car**, then
2. the official Tesla app prompting **"Set Up Phone Key"** (card + "Enable
   passive entry and remote controls"), and
3. completing that flow — after which **both apps worked immediately**.

## Two candidate causes (not yet distinguished)

1. **Repeated bad signed-messages tripped a VCSEC lockout.** ~25 GCM-auth
   failures against a security controller in minutes is exactly the shape of a
   lockout/anti-hammer trigger. If real, this is a genuine hazard our testing can
   cause. This is REQUEST-3 Q3.
2. **The whitelist entry was dropped car-side** (a reset/eviction), and the
   connect failures were incidental / the same de-enrollment surfacing. The "Set
   Up Phone Key" prompt is consistent with `SessionInfo.status =
   KEY_NOT_ON_WHITELIST(1)`, which we now detect (commit e128365).

These are not mutually exclusive: a lockout could have accompanied a
de-enrollment.

## Reproduction plan (LATER — deliberately, once, with the car owner present)

To distinguish the two, when we choose to reproduce:

1. Confirm baseline: key enrolled, both apps connect, `GET_WHITELIST_INFO` shows
   our slot filled.
2. With the CIRCUIT BREAKER DISABLED (so it doesn't stop us), send N malformed
   `AES_GCM_TOKEN` responses (wrong IV) and count them. Watch for:
   - the connect-wedge symptom appearing (→ lockout exists; note N);
   - whether `SessionInfo.status` flips to `KEY_NOT_ON_WHITELIST` (→ de-enroll).
3. Record the threshold N and whether a car restart alone clears it, vs restart +
   re-enroll.

This directly calibrates the responder's `MAX_CONSECUTIVE_FAULTS` /
`RATE_WINDOW_MS` guards, which are currently set conservatively by guess.

## Guards already in place (so normal testing can't reproduce it)

`passiveEntryResponder.ts`: rate limit (≤12 answers / 10 s) + a circuit breaker
that stops signing after `MAX_CONSECUTIVE_FAULTS` consecutive car rejections. The
breaker is fed the car's verdict (`commandStatus` → `noteVerdict`). These bound
the failure blast radius until Q3 gives us the real mechanism.

## Do NOT

- Do not reproduce this incidentally. The reproduction above is a deliberate,
  owner-present experiment for the C1 work — not something to trip while iterating
  on the seal. That is what the circuit breaker is for.
