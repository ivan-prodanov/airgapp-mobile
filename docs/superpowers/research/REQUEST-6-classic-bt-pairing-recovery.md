# RE REQUEST #6 — classic-BT (media) pairing broken by our forget-the-device guidance

**Requested:** 2026-07-20 (URGENT — user's car audio/phone pairing is broken right now)
**Goal:** restore the MCU classic-BT pairing WITHOUT risking the phone key, and fix our copy so the
bond-repair flow stops causing this.

## What happened

Our bond-repair card (built from RESPONSE-3/4/5) instructs: *"Remove '🔑 CHUŠKOPEK' in Settings >
Bluetooth and try again."* The user did that. The BLE phone-key path recovered fully — our logs show
repeated `connect ok` with `name: "🔑 CHUŠKOPEK"`, and phone keys work in both airgapp and the
official Tesla app.

**But the car can no longer connect to the phone for media/calls.** Car touchscreen → Paired Devices
shows `Ivan's iPhone — Not Connected — "Connection failed, please try again…"`. Re-forgetting
`🔑 CHUŠKOPEK` on the phone does not help. The user does **not** want to "Forget Device" on the car.

Our working hypothesis: forgetting on the phone dropped BOTH link keys; the BLE side re-established
itself (VCSEC session needs no bond), but the **classic-BT** side never did — because per RESPONSE-4
we deliberately never read `0301`, so we never trigger any pairing. The car retains its stale half →
asymmetric pairing → connect fails.

RESPONSE-5 already flagged the two-radio nuance ("MCU classic-BT device (adapter alias = friendly
name, for phone audio) and the BLE phone-key device (VCSEC)") and we under-weighted it.

## Questions

### Q1 (blocking, user is stuck) — least-destructive recovery
- Can the classic-BT pairing be re-established **without** "Forget Device" on the car? Is there a
  car-side re-pair / "Add New Device" path that overwrites a stale entry in place?
- If the car-side forget IS required, confirm precisely what it destroys: does removing
  `Ivan's iPhone` from the MCU Paired Devices list touch the **VCSEC whitelist** (phone key) at all?
  Our read is NO (separate ECU, separate store) — the user has already forgotten the phone-side entry
  with keys surviving, which supports it, but we want it confirmed before advising an action he is
  reluctant to take.
- What exactly is lost on a car-side forget — Priority Device, contacts/messages sync, and the
  profile association (`ivan.fsd`)? Anything else (e.g. does it disturb other drivers' profiles)?

### Q2 — is one iOS entry two transports?
- Is `🔑 CHUŠKOPEK` a single **dual-mode** device entry (BR/EDR + LE on one address), or does iOS keep
  separate entries for the MCU (classic) and VCSEC (BLE)? Our BLE peripheral reports
  `name: "🔑 CHUŠKOPEK", localName: null`, and the user's Settings list shows exactly one such entry
  marked Connected while classic is failing.
- If dual-mode: does "Forget This Device" on iOS necessarily drop the classic link key too — i.e. is
  our instruction UNAVOIDABLY destructive to media pairing? That decides whether this is a copy fix
  or a "don't recommend forget at all" fix.

### Q3 — what does the official app do about this?
- Does the official Tesla app's `VehicleSuggestRemoveBondRow` flow warn that media/phone pairing will
  need re-pairing? Any accompanying string we missed (we only extracted the one line)?
- Does the official app's bonding step (`presentBondingPrelude` → `0301` read) ALSO restore the
  classic pairing, or is classic re-pair always a manual car-side flow? This matters: if their
  bonding incidentally repairs classic, then our never-bond policy has a user-visible cost we should
  document (or reconsider).

### Q4 — should our copy change?
Proposed: keep the forget instruction (it is the only fix for the BLE wedge) but add that media and
call pairing will need to be set up again on the car afterwards. Is that accurate, or is there a
sequencing that avoids the breakage entirely (e.g. forget → immediately re-pair from the car before
the phone reconnects over BLE)?

## Constraints
- Static RE only; cite locations and flag confidence. **Q1 is time-sensitive** — the user's car audio
  is broken now, and he is unwilling to take a destructive step on our say-so after we got the
  two-radio distinction wrong once already.
- If any of this is not statically determinable, say so plainly and tell us what is safe to try
  on-car, ordered least-destructive first.
