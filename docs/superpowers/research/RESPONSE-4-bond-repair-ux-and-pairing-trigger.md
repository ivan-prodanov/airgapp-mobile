# RE RESPONSE #4 — bond-repair UX + how the pairing sheet is triggered

**Answers:** `REQUEST-4-bond-repair-ux-and-pairing-trigger.md` (Q1 forget-device UX, Q2 pairing-sheet
trigger, Q3 degraded home, Q4 safety). 4 finders + 2 adversarial verifiers over the iOS Mach-O
(disassembly, not just strings), the RN bundles (Hermes v96 = string table only), Android jadx, and
firmware symbols. Confidence flagged per claim; **⚠ NOT-STATIC** marks what a binary can't settle.

## TL;DR — this reframes your premise

You wrote *"we cannot self-heal without [triggering the pairing sheet]."* **You can, and the sheet is
not the thing to chase.** Two facts change the plan:

1. **airgapp can't programmatically trigger a re-pair while wedged anyway.** On `iosErrorCode 14` the
   phone still holds the stale LTK, so iOS auto-encrypts on connect and the car rejects it **before any
   GATT** — every connect dies at the encryption step, so a read of `0301` never even executes. **No iOS
   API removes a bond** (Tesla itself falls back to instructing the user). The user forgetting the device
   is **unavoidable** — there is no programmatic substitute.
2. **You don't need the bond.** The command + passive-entry channel (`0212/0213/0214`) is **not**
   encryption-gated — it carries its own ECDH+AES-GCM and resumes the instant the stale LTK is gone. The
   bond (`0301/0302`) buys **UWB only**, which RSSI proximity doesn't need. So the moment the user forgets
   the device, airgapp reconnects un-encrypted and works — **exactly what Ivan observed** ("airgapp
   started working with no action of its own").

**So airgapp's recovery = detect code 14 → guide the user to forget the car in Bluetooth settings →
reconnect the un-encrypted command channel. No SMP, no `0301` read, no pairing sheet.** (The sheet is only
worth triggering if airgapp genuinely wants UWB back — see Q2 secondary path.)

---

## Q2 — how the pairing sheet is triggered (the crux), and the contradiction resolved

**Your contradiction was a timing conflation, not a bypass — my RESPONSE-3 addendum was right, it just
applies to the *post-forget* connection.** *(finder + verifier, high on the resolution)*

- The sheet is raised by the app reading the **encryption-required characteristic `00000301`** (a plain
  GATT **read**, not a write; `0302` is its sibling). iOS lazily starts SMP when you touch an
  encryption-required attribute with no stored LTK. The read executor
  `-[BLEVehicle readBondingCharacteristicWithShouldInformVehicle:]` is real (verified via `otool -oV`),
  reached through `optionallyBondOrRepairBondingWithReason:`, hard-gated behind
  **`whitelistHasKey==true && haveSentCommandOnThisConnection==true`** (`bin_strings 127003/127007`).
- **Why Ivan saw the sheet with "no VCSEC session":** that was true only *during the wedge* — every
  connect died at code 14 before any GATT. After he **forgot the device**, the phone held no LTK, so the
  next connect was a fresh **un-encrypted** link that **succeeded**; the LTK-independent VCSEC session ran,
  a command flowed → `haveSentCommandOnThisConnection` flipped true → the gated `0301` read fired → sheet.
  The gates were satisfied *post-forget*, no bypass needed.

**The one thing static RE can't settle (⚠ NOT-STATIC):** whether that post-forget sheet is
- **C1 — app-initiated** (the app's `0301` read triggers SMP), or
- **C2 — car-initiated** (the car sends a peripheral SMP *Security Request* on the fresh connect, and iOS
  raises the sheet with zero app GATT).

iOS Central exposes **no API** to observe an inbound Security Request, so app-code absence is expected
under both — the binary can't separate them. The app *ships an entire C1 machine* (7 `BLEReadBondingReason*`
triggers, cooldowns, retry/give-up), which is strong-but-not-conclusive evidence the designed mechanism is
C1. *(A caveat the verifier caught: there's a second, un-audited RN bridge —
`scanForPeripherals:…readBondingCharacteristic:(BOOL)…` — that passes a `readBonding` flag into the scan
pipeline, so the pooled "exactly one caller, fully gated" claim isn't airtight. It concerns Tesla's
internal gating only, not airgapp's action.)*

**Why this doesn't block you:** the `whitelistHasKey`/`haveSentCommandOnThisConnection` gates are **Tesla's
app policy, NOT an iOS requirement.** iOS raises the sheet from *any* read of an encryption-required
attribute. So **airgapp must not copy those gates.** And a bare `0301` read on a fresh post-forget
connection is **superset-safe**: under C1 the read triggers the sheet; under C2 the car already did and the
read is a harmless no-op. **Reading `0301` works under both hypotheses** — which is why the unresolved
C1/C2 question is not a blocker.

- `presentBondingPrelude` is a **cosmetic RN explainer** shown before the OS sheet — it does not read
  `0301` and gates nothing (*"bonding - skip prelude since we just setup phone key"*).
- On sheet **dismissal**: 30s cooldown + bounded retry + give-up (`"ran out of PEER_REMOVED_BONDING
  retries. CLEARING PERIPHERALS"`). **Do not loop reads against the controller** — that's the behavior
  class that got you two lockouts.

---

## Q1 — the "forget the device" screen (recreate it 1:1) — with a correction

**⚠ Correction to RESPONSE-3:** the string I quoted — *"Go to Bluetooth settings and forget the paired
`{{din}}` device, then retry"* — is the **Powerwall/energy** surface (`EnergyBleModule`, `{{din}}` = energy
Device Identification Number). The **vehicle** phone-key surface Ivan hit is different:

- **Component:** `VehicleSuggestRemoveBondRow` — an inline **row** (not a full modal), inside the "Set Up
  Phone Key" degraded card.
- **Copy (two shipped, localized variants):** **"Remove '{{name}}' in Settings > Bluetooth and try
  again"** and **"Remove '{{name}}' in Settings > Bluetooth and return here to upgrade phone key"** (EN +
  IT confirmed). `{{name}}` = the **vehicle display name**, which Tesla propagates into the BLE GAP name —
  so it equals what iOS shows on the sheet (**Ivan's `🔑 CHUŠKOPEK`**). *(high on value; the exact JS
  selector filling `{{name}}` is Hermes-opaque.)*
  > Note: the two finders disagreed slightly on whether the `{{din}}` copy can also appear in the vehicle
  > path; the stronger evidence (localized `{{name}}` strings + `EnergyBleModule.scanForEnergyPeripheral(String din)`)
  > says vehicle = `{{name}}`, energy = `{{din}}`. Either way, the copy names the device by its
  > **Bluetooth/GAP name**, which is your vehicle name.

- **SHOWN vs SKIPPED — it's error-gated, not state-queried.** iOS gives **no bond-state API** (`CBPeripheral`
  has no bonded flag; Android calls zero bond APIs). So the app can't ask "is there an OS bond?" It infers:
  - **SHOWN** iff the phone still holds a **stale LTK** → connect fails with `CBErrorPeerRemovedPairingInformation`
    → `encounterPeerRemovedBondingWhileConnecting` set → row rendered.
  - **SKIPPED (Ivan)** because he'd **already forgotten** it → no LTK → connect **succeeds** → the error
    branch is never reached → the flow falls straight through to reading `0301` → fresh pairing sheet. The
    app never affirmatively detects "bond absent"; it just never hits the error. *(`isBLEActivelyAttemptBonding`
    is a "pairing in progress?" query for the spinner, **not** a stale-bond detector.)*

- **Deep-link? No (on the vehicle path).** The iOS binary contains **no** Bluetooth-pane deep-link
  (`App-Prefs`/`prefs:root=Bluetooth` = zero hits; Apple removed those anyway). The only settings URL is
  `app-settings:` (opens *your app's* settings, used for the permission copy). So **"Settings > Bluetooth"
  is instructional text — the user navigates manually.** (The Android *energy* module has a real
  `android.settings.BLUETOOTH_SETTINGS` intent; the Android *vehicle* path only opens app-details.)

- **Retry affordance:** the vehicle row **auto-re-attempts** on foreground (`BLEReadBondingReasonAppBecomeActive`
  + siblings) and **auto-dismisses** when a clean connect + fresh bond succeeds — no vehicle "Retry" button
  (only the energy surface has explicit retry buttons). Matches Ivan's "restored immediately."

---

## Q3 — the degraded home screen (menus hidden + "Set Up Phone Key")

- **What drives it:** a per-vehicle, **connection-derived** state `phoneKeySupportedButNotPaired` — **not**
  `whitelistHasKey`, and **not** a "bond broken" flag. When the bond wedge severs connectivity, native
  retries exhaust → `clearPeripheral` empties the cached peripheral → RN sees "no paired peripheral" → it
  swaps the control rows (`vehicle_home_{controls,climate,location,summon,charging}_row`) for the
  `vehicle_home_phone_key_status_card` with subtitle **"Enable passive entry and remote controls."**
- **Why your intact key is irrelevant here:** the home decision is driven by *live connectivity*, and the
  wedge blocks the connection before the whitelist can even be read (`"not reading bonding since
  whitelistHasKey == false"` — it can't observe the key through a dead link). **The app isn't lying about a
  missing key; it genuinely can't see it through the wedge.**
- **Does the UI distinguish bond-wedge from key-not-on-whitelist?** **At the home: no** — both collapse to
  "Set Up Phone Key." (There is *no* `key_not_on_whitelist` connect-reason; membership is a separate state
  needing a live connection to evaluate.) **The branch to the right remedy happens inside the setup flow,
  keyed on the connect `reason`:**
  - `peer_removed_bonding` → **forget-device repair** (`VehicleSuggestRemoveBondRow`) — *your case*.
  - key genuinely unenrolled (`onWhitelist=false`, connect OK) → **enroll** (`addToWhitelistFromQR` / card).
  - `too_many_keys_on_whitelist` → free a car slot; phone bond-table full → free phone pairings;
    permissions/connectivity → enable BT/grant perms; `regenerate_qr_code` → new QR.
- **The home is a funnel; the intelligence is in the setup flow** — which is exactly why forgetting the
  device *first* (as Ivan did) shortcut straight to the pairing sheet. *(reason→screen routing is Hermes;
  string identities high, exact wiring ⚠ NOT-STATIC.)*

For airgapp: you can and should do **better than the official app here** — because you read the whitelist
over the Pi, you can *distinguish* bond-wedge (code 14, key present) from a real wipe (`KEY_NOT_ON_WHITELIST`)
before showing a remedy, instead of collapsing both to one "Set Up" state.

---

## Q4 — safety of the recovery plan: **conditional GO**, with a reframe *(verifier: PARTIALLY_SUPPORTED, high)*

- **"Never bond proactively" — approved.** The bond buys UWB only; commands/passive-entry need no bond.
  Not bonding also means airgapp never generates its *own* code-14.
- **"Trigger a re-pair to self-heal" — reframed:** airgapp *can't* do this while wedged (connect dies
  before GATT; no API to remove a bond). The **user forgetting the device is a mandatory, explicit UI
  step.** "Self-heal" is accurate for the **command channel** (resumes bond-free), only after that step.
- **Whitelist key untouched; works locked.** Confirmed — no unlock precondition anywhere in the bonding
  path; matches Ivan.
- **Same-phone bond is single & shared.** One OS LTK per phone↔car pair, shared by every app; there is **no
  per-app bond**. airgapp's re-pair *replaces* the one shared bond in place — it can't evict "the Tesla
  app's bond" (there's no separate one), and you only ever re-pair *after* code 14 (bond already dead for
  everyone), so there's nothing healthy to disturb. *(Car-side SMP bond-table capacity / cross-phone
  eviction = ⚠ NOT-STATIC, VCSEC-ECU-internal — but not your situation on one phone.)*
- **Just Works pairing (no passkey) → MITM is real but bounded.** It touches only the **UWB link**
  (`0301/0302`, which also has FiRa STS secure ranging); **command auth (ECDH+AES-GCM over `0212–0214`) and
  the key are never exposed.** Window = one user-tapped pairing exchange, not standing exposure.
- **Recurrence is by design.** Tesla ships a whole retry/telemetry subsystem for peer-removed-bonding
  (per-VIN persistence, cloud upload, cooldowns) — you don't build that for a once-ever event; the car
  drops/rotates its LTK on reboot/update *(car firmware out of scope — inference)*. Tesla *reduces* it via
  the **IRK-fix bonding version** (`bin_strings 126957`, **verified verbatim — not retracted**: *"…the
  bonding version doesn't have the IRK fix, stop connecting"*; storing the car's IRK lets the phone resolve
  its rotating private address directly), plus keeping the bond warm. **Tesla's posture is the opposite of
  "never bond."** If airgapp reads `0301` for UWB, it re-enters this recurrence cycle; never reading it
  sidesteps airgapp-caused recurrence entirely.
- **Cross-app: benign.** Shared LTK + iOS serializes SMP, so a re-pair refreshes both apps (Ivan saw the
  benign direction). One **low-confidence** caveat: an airgapp-created bond won't update the Tesla app's
  `BLE_BONDING_VERSION` bookkeeping, which in the narrow `Location=Always ∧ not-in-beacon ∧ pre-IRK`
  corner could transiently trip Tesla's "stop connecting" guard until it re-reads `0301` on foreground.
  Another reason to prefer don't-bond.
- **Bonding grants a 3rd-party app no extra reach** — exactly `0301/0302` (UWB), nothing more; `0212–0214`
  are reachable un-encrypted regardless.

### Guardrails (ship these)
1. **Prefer RSSI-only; never read `0301/0302` unless UWB is truly required.** Eliminates the whole bonding
   question and any airgapp-caused code-14.
2. **On code 14: do NOT loop connect/read against the controller.** Surface forget-device guidance;
   reconnect only `0212–0214`. Adopt Tesla's cadence (30s cooldown, bounded retry, give-up).
3. **Treat user-forget as a mandatory explicit step** — no programmatic substitute exists.
4. **If you must bond (UWB):** only *after* user forget + a fresh successful connect, do **one** bare GATT
   read of `0301`. Do **not** replicate Tesla's `whitelistHasKey`/`haveSentCommand` gates, do **not**
   initiate SMP yourself, do **not** write `0301/0302`, do **not** loop.
5. **No writes to the security controller; no fuzzing.**

---

## Recommended airgapp recovery flow

```
on BleError iosErrorCode 14 (CBError.peerRemovedPairingInformation):
  1. (optional, you can, Tesla can't) read whitelist over Pi → if key present at its slot,
     classify as BOND WEDGE (not a wipe) with certainty.
  2. do NOT retry the encrypted connect in a loop; do NOT read 0301.
  3. surface guidance: "Remove '<vehicle name>' in Settings > Bluetooth, then return."
     (instructional text; there is no working iOS deep-link to the BT pane.)
  4. on app-foreground / user-return: reconnect. With the stale LTK now gone, the connect is
     un-encrypted and succeeds → run the VCSEC ECDH/AES-GCM session on 0212–0214 → commands +
     RSSI passive entry restored. NO bond, NO card, NO WhitelistOperation.
  [only if UWB is genuinely needed]
  5. after step 4 succeeds, read char 0301 once → iOS raises the (Just Works) pairing sheet →
     user taps Pair → LTK minted → UWB back. Never loop; never write.
```

## Safe on-car tests to settle C1 vs C2 (zero-write, no fuzzing — you've had two lockouts)
1. **Passive sniff:** during one user-driven forget+re-pair, capture the first SMP PDU direction. Central
   *"Pairing Request"* (from the phone) = **C1 app-initiated**; peripheral *"Security Request"* (from the
   car) = **C2 car-initiated** (then airgapp need only connect, no `0301` read at all).
2. **Zero-GATT cross-check:** after forgetting, have airgapp connect and send **nothing**. If the sheet
   appears with zero GATT from the phone → **C2**. If it appears only after airgapp reads `0301` → **C1**.
Both are reversible, involve no writes to `0301/0302`, and no connect loop.

## Corrections carried into this response
- RESPONSE-3's `{{din}}` "forget the paired device" copy was the **energy** surface; vehicle = `{{name}}`
  (`VehicleSuggestRemoveBondRow`). *(Q1 above.)*
- The IRK-fix / bonding-version guard is **verified verbatim** (`bin_strings 126957`) — an earlier grep
  missed it; do not retract.

## Provenance
Finders `pairing-trigger` (iOS disassembly), `forget-ux`, `degraded-home-state`, `safety-recurrence` +
verifiers `V-trigger` (PARTIALLY_SUPPORTED med — C1/C2 unresolved, action determinate) and `V-safety`
(PARTIALLY_SUPPORTED high — conditional GO). Reports: `scratchpad/findings7/*.md`. Supersedes the
"card re-tap" framing and the `{{din}}` copy in RESPONSE-3's addendum.
