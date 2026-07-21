# RE RESPONSE #6 — classic-BT (media) pairing recovery + copy fix

**Answers:** `REQUEST-6-classic-bt-pairing-recovery.md`. 3 finders + 1 safety verifier over the car firmware
(`QtCarBluetooth`, `btd`, `bsa_server`), both apps, and BT fundamentals (CTKD, asymmetric link keys).
**This one is partly my fault:** RESPONSE-5 flagged the two-radio nuance but RESPONSE-3/4 shipped the
"forget the device" instruction with no media warning. Corrected copy is in §Q4.

## FIRST — recovery order (user is stuck now). Least-destructive first.

`🔑 CHUŠKOPEK` is the **VCSEC BLE phone key** and is already healthy. **Stop re-forgetting it** — it's the
wrong radio and can never fix car audio (no cross-transport key sharing; see Q2). The broken thing is the
**MCU classic** pairing, which needs a **fresh** classic pairing (a plain reconnect won't do it — the car
short-circuits to a failing connect with its stale key).

- **Step 0 (free, do first).** On the iPhone, Settings → Bluetooth, look for a **second** car entry —
  the classic/media one, distinct from `🔑 CHUŠKOPEK`, likely showing **Not Connected** (it may carry the
  same name, or a model name). If present, **Forget that row.** Destroys only the phone's stale classic
  half; touches nothing car-side; cannot affect the phone key. *(If there's no second row, the phone
  already holds no classic key — skip to Step 1.)*
- **Step 1 (zero car-side destruction).** On the **car**: Bluetooth → **Add New Device** (car becomes
  discoverable). Then **initiate the pairing from the phone** (tap the car in the phone's Bluetooth list),
  confirm the passkey on both screens. This drives a fresh SSP that overwrites the car's stale key in place.
  **Critical:** don't tap the *phone* in the car's paired list — that path (`smPairDevice` → *"was paired
  already, connect it directly"*) reconnects with the stale key and fixes nothing. If the car refuses
  (a possible `btd` rebond-reject branch), it fails harmlessly → Step 2.
- **Step 1-ALT (cleanest, if offered).** In the **official Tesla app**, phone-key screen → **"Set Up
  Bluetooth Audio"**, if shown for this car. It sends `CarServer.BluetoothClassicPairingRequest`; the car's
  `PairManager` **forgets-then-pairs atomically** (no asymmetry window). Destroys only the stale classic key.
- **Step 2 (reliable fallback — the step he's reluctant about, and it is SAFE for the phone key).**
  On the **car**: Bluetooth → Paired Devices → *Ivan's iPhone* → **Forget Device**, then Add New Device and
  re-pair from the phone. Destroys **only**, for this one entry: the stale classic link key (the cure),
  paired-device metadata, this phone's cached phonebook/call-history (**auto re-syncs** on next connect),
  and its auto-connect priority (rebuilt). **Does NOT touch:** other phones, other drivers' profiles (the
  classic device DB is adapter-global, not per-driver), or the VCSEC phone key.

**Why Step 2 is safe for the phone key (verifier SUPPORTED, high; 4 refutation angles all failed):**
`QtCarBluetooth`'s forget path (`forgetDevice`/`removeDeviceFromDB` → `BluetoothStackServiceInterface::removeDevice`)
talks only to D-Bus `com.tesla.BluetoothStack` + `com.tesla.VehicleServiceDbus` — **never**
`com.tesla.VCSECRemote`; `btd`'s only "whitelist" is the HCI LE accept-list (radio scan filter), **not**
VCSEC's P-256 slots; CTKD is confined to the MCU's own chip and can't reach the VCSEC ECU; and your **own
Pi read** already showed the whitelist intact (key at slot 4) after the earlier BT-key drop. **A car-side
media Forget cannot remove or disturb the phone key.**

---

## What actually broke, and an honest correction to the framing

Your hypothesis was *"the phone-side forget dropped BOTH link keys."* That's **only true if iOS had merged
the two radios into one Settings row.** Architecturally, forgetting the **VCSEC BLE** entry cannot touch the
**MCU classic** link key — different chip, different BD_ADDR, no CTKD. So there are two possible causes and
**static RE cannot tell which:**
1. iOS showed the two same-named devices as **one merged row**, and forgetting it dropped both the LE LTK
   *and* the classic link key (BLE self-healed; classic didn't). *(dual-mode finder's reading.)*
2. iOS kept them **separate**, forgetting the BLE row didn't touch classic, and the classic link broke from
   the **same earlier BT-stack wedge** that caused the original peer-removed-bonding. *(copy finder's reading.)*

Either way **the remedy is identical** (re-pair classic), and either way **the phone key was never at risk.**
I'm flagging this rather than repeating a confident single-cause story — that's the mistake that bit you.

---

## Q2 — one dual-mode device, or two? **Two separate radios on two ECUs, same name.** *(high)*

- **MCU classic** (media/HFP/phonebook) = a Broadcom `BCM4359` controller driven by `bsa_server`/`btd`,
  D-Bus `com.tesla.BluetoothStack`, adapter alias = the vehicle name `🔑 CHUŠKOPEK` (rides in the classic
  **EIR**, so iOS sees it *before* connect).
- **VCSEC BLE** (phone key) = a **separate microcontroller** with its own radio/identity, D-Bus
  `com.tesla.VCSECRemote`, 20 P-256 whitelist slots. It advertises **`localName:null`** — its `🔑 CHUŠKOPEK`
  name only appears from GAP `0x2A00` *after* connect.
- ⇒ **Two BD_ADDRs, two key stores that never touch.** NOT one dual-mode device. Whether iOS renders them
  as one merged row or two is an **iOS-internal decision, not determinable from the car** — I won't assert
  it (that's the residual uncertainty behind "what did he actually forget"). Your paradox (one row
  *Connected* on the phone while the car says *Not Connected*) fits two identities collapsed under one
  label: the **name** from the dead classic device, the **Connected** state from the live BLE link.
- **CTKD is physically impossible here** *(high — state plainly)*: cross-transport key derivation (H6/H7)
  only works inside one dual-mode controller that owns both links to the peer. The MCU chip and the VCSEC
  chip are separate ECUs. So an LE bond can **never** regenerate the classic link key — and the phone key
  fully recovering tells you **nothing** about classic media.

---

## Q3 — what the official app does *(high)*

- **No media warning exists.** Exhaustive sweep of 554k clean RN strings (+ iOS native): the remove-bond
  card is exactly *"Remove '{{name}}' in Settings > Bluetooth and try again"* with **no** accompanying
  mention of media/calls/audio/phonebook/re-pair. The official app tells you to forget the device and says
  nothing about the side effect. So we're not missing a string — there isn't one.
- **Bonding (`0301` read) cannot restore classic** — it's an LE bond with the VCSEC ECU (for UWB), no CTKD
  bridge. So **airgapp's never-bond policy cost you nothing here**: the classic break is independent of
  whether the LE side ever bonds, and the official app's bonding step doesn't fix classic either.
- **But the official app *does* have an in-app classic re-pair path** — `phone_key_complete_set_up_bluetooth_audio`
  → **"Set Up Bluetooth Audio"** → `CarServer.BluetoothClassicPairingRequest` (a VehicleAction; a `reserved`
  slot in the public proto) → the car's `PairManager` `start_forgetting → start_pairing`. So classic re-pair
  is **not** touchscreen-exclusive; the app can command it, and it forgets-then-pairs atomically. *(exists:
  high; surfaced for this specific build: medium.)*

---

## Q4 — corrected copy

"Keep the forget but warn media will break" is **half-right**. Two fixes: **(a)** scope the forget to the
BLE phone-key entry by name; **(b)** do **not** assert media *will* break (forgetting the BLE key doesn't
architecturally drop the classic key — a flat warning repeats the over-confidence error); **(c)** warn
*conditionally* and route the media fix to the **car** side (which forgets-then-pairs atomically, avoiding
the asymmetry window). airgapp does nothing on the classic path.

> **Re-pair phone key**
> Forget only the phone-key entry — the one named **"🔑 CHUŠKOPEK"** — in iPhone **Settings → Bluetooth**,
> then come back. This re-establishes the secure phone-key link. It does **not** remove your key from the car.

> ⓘ *If car audio or calls stop connecting afterward:* that's a **separate** Bluetooth connection on a
> different radio, not the phone key — forgetting the key can't fix or break it, so don't keep forgetting
> "🔑 CHUŠKOPEK" to fix audio. Re-pair it **from the car**: **Bluetooth → Add New Device**, then pair from
> your phone (or **Set Up Bluetooth Audio** in the Tesla app). Re-pairing audio does **not** affect your key.

Micro-rules going forward: always distinguish **"phone key" (BLE/VCSEC)** from **"car audio" (classic/MCU)**
— an action on one never affects the other; prefer **car-initiated** classic re-pair; and reassure that a
car-side Forget of the media device is safe for the phone key.

---

## Not statically determinable (flagged, not guessed)
- **The exact cause of the classic break** (merged-row forget vs. a coincident BT-stack wedge) — iOS row
  grouping isn't in the car firmware. Doesn't change the fix.
- **Whether the no-forget Step 1 re-pair is accepted in place** — `btd` is stripped around the rebond
  accept/reject branch (`CM_REBOND_REJECTED_BY_APPLICATION` exists next to the accept path). Its failure is
  harmless (no state lost) → fall through to Step 2.
- **The exact classic stack branch** — `btd` selects `bcm`/`qca`/`bluez` at runtime from files absent in
  this image (`is-tcu-available`, `BTQC6595` sysfs). Recovery is identical; only the internal key-store
  path differs (and the user never touches files).
- I did **not** disassemble the `com.tesla.VehicleServiceDbus` *provider* to rule out a theoretical
  indirect "BT-device-removed → notify VCSEC" reaction; nothing in `QtCarBluetooth` emits such a signal and
  the Pi read shows VCSEC survived a key drop, so residual risk is effectively nil but not a zero-LoC proof.

## Provenance
Finders `classic-recovery`, `dual-mode-transports`, `official-copy-and-bonding` + verifier `car-forget-safety`
(**SUPPORTED, high** — car-side media Forget is safe for the phone key; 4 refutation angles failed). Reports:
`scratchpad/findings9/*.md`. Corrects the "forgetting dropped both keys" framing in REQUEST-6 and the
missing media caveat in RESPONSE-3/4.
