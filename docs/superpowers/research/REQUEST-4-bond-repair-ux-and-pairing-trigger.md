# RE REQUEST #4 — the bond-repair UX + how the app TRIGGERS the pairing sheet

**Requested:** 2026-07-20 (follow-up to RESPONSE-3's Addendum, which was correct)
**Goal:** recreate the official bond-repair flow **1:1** in airgapp, so it self-heals without
the user ever needing the Tesla app.

## Your Addendum was confirmed on-car — here is the observed flow

Ivan reproduced the whole thing on a live car. Sequence:

1. **Wedge detected.** airgapp logged the definitive signal you predicted:
   ```json
   {"name":"BleError","message":"Device … connection failed",
    "reason":"Peer removed pairing information","errorCode":200,"iosErrorCode":14}
   ```
   Whitelist read over the Pi at the same moment: our key **still at slot 4, ROLE_DRIVER,
   all 5 slots intact** — so definitively a bond wedge, **not** a wipe. Your two-layer model holds.
2. **Tesla app UX changed.** Its home screen **hid all the normal menus** (Controls/Climate/
   Location/Summon/Charging gone) and showed a degraded card:
   `Phone Key — "Enable passive entry and remote controls" [Set Up]`, plus a header subtitle
   `Set Up Phone Key`.
3. **Tap "Set Up"** → a step asking the user to **open Bluetooth settings and forget the car**.
   *(Ivan had already forgotten it, so this step was SKIPPED — we never saw it. This is the
   screen we need described; see Q1.)*
4. **iOS Bluetooth Pairing Request** appeared: `"🔑 CHUŠKOPEK" would like to pair with your iPhone.`
   → **Pair**.
5. **Everything restored immediately** — Tesla app menus came back, AND **airgapp started working
   again with no action of its own** (as expected: the LTK is OS-level and shared per phone-car pair).

**Important correction to our earlier assumption:** the car does **NOT** need to be unlocked for
this. It works with the car locked; you can unlock afterwards.

## What we need

### Q1 (blocking the UX) — the "forget the Bluetooth device" step we never saw
- **Exact screen(s) and copy.** Full strings, title/body/button labels, and the i18n keys
  (we saw `VehicleSuggestRemoveBondRow` and *"Go to Bluetooth settings and forget the paired
  {{din}} device, then retry"* in your report — is that the same screen, and is `{{din}}` the
  car's Bluetooth name, e.g. `🔑 CHUŠKOPEK`?).
- **When is it SHOWN vs SKIPPED?** Ivan had already forgotten the device and it was skipped —
  what does the app check to decide? (Can it actually detect the absence of an OS bond, or does it
  just attempt a connect and skip on success?)
- Does it deep-link into Settings (`App-Prefs:Bluetooth` / `openBluetoothSettings`), and does that
  still work on current iOS, or is it instructional text only?
- Is there a "retry / I've done it" affordance, or does it auto-detect and advance?

### Q2 (blocking the fix) — how does the app TRIGGER the iOS pairing sheet?
This is the crux; we cannot self-heal without it.
- Your report says reading the encryption-required characteristic **`0301`** implicitly triggers
  OS pairing. **Confirm exactly:** which characteristic/descriptor, read or write, and is any
  preceding VCSEC message required?
- Is `presentBondingPrelude` (the RN explainer dialog) purely cosmetic, or does it gate anything?
- **Does the trigger require the whitelist key / a working VCSEC session first?** You noted iOS logs
  *"not reading bonding since `whitelistHasKey == false`"* and *"…since
  `haveSentCommandOnThisConnection == false`"* — but in Ivan's case the VCSEC session could NOT be
  established (the car dropped us on the first handshake write), yet the Tesla app still got the
  pairing sheet. **So how is bonding triggered when no command session is possible?** That ordering
  is the thing we most need.
- Any timeout/retry behaviour if the user dismisses the sheet?

### Q3 — the degraded home-screen state
- What condition drives hiding the menus and showing the `Phone Key / Set Up` card? Is it the same
  `whitelistHasKey`/`clearPeripheral` boolean from RESPONSE-3 Q1, or a separate "bond broken" state?
- Does the app distinguish **bond-wedge** from **key-not-on-whitelist** in this UI, or is it one
  shared "phone key needs setup" state? (They need **different** remedies — forget-device vs a card
  tap — so if it's one state, how does the flow branch afterwards?)

### Q4 — safety check on our plan
We intend to **never bond proactively** (per your advice) but to **trigger a re-pair as recovery**
when we detect `iosErrorCode 14`. Sanity-check that:
- Is triggering a bond from a non-Tesla app problematic in any way we haven't considered?
- Once re-bonded, do we inherit the same staleness risk again later (i.e. is this recurring by
  design), and does the official app do anything to reduce recurrence?
- Anything car-side that our re-pair could disturb for the official app, given the LTK is shared?

## Constraints
- Static RE only; cite locations + flag confidence as before — your citations have been reliable
  and let us confirm each claim on-car.
- If the pairing trigger is **not** statically determinable, say so; we can experiment on-car, but
  we would rather not fuzz a security controller after two lockouts.
