# RE RESPONSE #3 — the "Set Up Phone Key" recovery flow

**Answers:** `REQUEST-3-set-up-phone-key-flow.md` (Q1 trigger, Q2 what the tap does, Q3 lockout safety).
**Method:** 3 finders + 2 adversarial verifiers over Android jadx (native BLE SMs), both Hermes bundles,
`authd`/`command-router` disassembly, prior firmware/lifecycle RE. Confidence flagged per claim.
Glad #1/#2 landed on-car.

## TL;DR

- **Q1:** the connect-time "Set Up Phone Key" prompt is driven by the **`GET_WHITELIST_INFO` keyID
  membership sweep**, *not* `SessionInfo.status`. Your `status==KEY_NOT_ON_WHITELIST(1)` detection is
  valid but is the *command-path proxy*; **also run the sweep** to mirror the official connect behavior.
- **Q2:** there is **no lighter "reactivation."** The `reactivation/re-enrollment` strings that prompted
  this are a **false lead** (Hermes concatenation artifacts + account/payments strings). The "Set Up" tap
  builds the **same** `addKeyToWhitelistAndAddPermissions`; only the *signature envelope* differs. For an
  account-less/card-only client, recovery after a real wipe is a **plain PRESENT_KEY card re-tap.**
- **⭐ ADDENDUM (your "forget the car in Bluetooth settings" observation):** that flow is an **OS LE-bond
  repair, not a re-enroll** — the whitelist key survives, no card. It supersedes the "card re-tap" framing
  for *your* incident (which was a stale bond, not a wipe). Bonding exists **only for UWB**; a stale bond
  wedges the whole link (your all-client freeze). **airgapp should not bond** — see the Addendum below.
- **Q3:** **UNCERTAIN, and that's the honest answer.** Your 25 bad-IV frames provably **could not poison
  the counter** and provably **did not remove your whitelist entry**, and the MCU image has **no lockout
  logic** — but VCSEC's anti-abuse state is a *separate microcontroller not in any image*, so I can
  neither certify "safe" nor confirm "you caused it." The recovery signature (restart + re-enroll) points
  *away* from a timed rate-limiter. Treat VCSEC anti-abuse as **unknown-and-possibly-present**; your
  rate-limit + circuit-breaker is the right instinct — I give defensible bounds below.

---

## Q1 — What triggers "Set Up Phone Key"? (correction: it's the whitelist sweep, not `status`)

The official app decides "phone key not on whitelist" via **three convergent channels**, all funneling
to one boolean that `usePhoneKeySetup`/`usePhoneKeyPrompt` render as the prompt:

1. **Connect-time membership sweep (the primary one).** Both native connection state machines decode the
   car's `WhitelistInfo` and compare **their own `SHA1(pubKey)[0:4]`** against each entry; if absent and
   not pairing → `clearPeripheral(reason)`:
   - routable: `a2.java:167-173` (`Arrays.equals(entry, this.keyID)`), `:198` *"Did NOT find key [%s] in
     whitelist!"*, `:207` → `b0("native_not_on_whitelist_upon_connection_routable")`.
   - legacy: `gf0/b.java:425-443`, `native_not_on_whitelist_upon_connection_legacy`.
   - `q1.java:1088-1113` `clearPeripheral` persists the state + fires `ClearPeripheralsResult` to RN.
   - **Neither connection SM reads `SessionInfo.status` at all** (grep empty). *(HIGH)*
2. **Command-decoder path:** `SessionInfo.status == KEY_NOT_ON_WHITELIST(1)` (`rc0/l.java`) →
   `messagedecoding/a.java:150-161` → `Result.NOT_IN_WHITELIST` (`ed0/c.java`). This **is** a real trigger
   — it's the one you're already using — but it lives on the command path, not the connect handshake. *(HIGH)*
3. **`commandStatus` `FAULT_NOT_ON_WHITELIST(2)`** when the app thought it was whitelisted →
   `gf0/b.java:395-399` re-runs `GET_WHITELIST_INFO` (funnels back into #1). *(HIGH)*

**Recommendation:** keep your `status==1` gate, but **add the proactive `GET_WHITELIST_INFO` sweep**
(decode `WhitelistInfo`, match `SHA1(ourPub)[0:4]` against each entry) as the authoritative connect-time
membership check — that's what the official app keys the prompt on, and it works even when you're not
mid-command. Gate on **persistent** absence (see Q3 hardening) so a transient read doesn't force a card tap.

---

## Q2 — What does the tap do? (no reactivation; same add, different envelope)

**The `reactivation/re-enrollment` string family is a false lead** — verified: `reEnrollmentParametersValidUntil`
**does not exist** in the bundle (grep count 0; the real token is `EnrollmentParametersValid`, a
Storm-Watch/AutoPay **payments** string), and `reactivateMFAUrlSelector` is an **account-security WebView
deep-link** (`…manageMFA UrlSelector` family), not a phone-key MFA gate. There is **no VCSEC/BLE phone-key
reactivation concept** anywhere in 4.58.0 — app or native. *(HIGH; both finder + adversarial verifier
REFUTED the reactivation hypothesis.)*

**Tapping "Set Up" builds the SAME `WhitelistOperation.addKeyToWhitelistAndAddPermissions` (field 5) as the
card path** (`vc0/n3.java`). Only the **signature envelope** changes, chosen at `fd0/f.java`/`fd0/p.java`:

| Path | Envelope | Trust anchor | Available to airgapp? |
|---|---|---|---|
| `addPhoneKeyToVehicleOverNFC` | `presentKeyWhitelistOperation` → **`SIGNATURE_TYPE_PRESENT_KEY`** | physical NFC card on the reader | **YES — your only path** |
| in-session add | plain `whitelistOperation` → `SIGNATURE_TYPE_AES_GCM` | on-console **UI-ACK**, requires a **surviving `ADD_TO_WHITELIST` authorizer key** | No (no surviving authorizer after a wipe) |
| `addPhoneKeyToVehicleOverNetwork` / `…OverProxy` | OwnerAPI `add_key`/`add_remote_key` + `SIGNED_COMMAND` | **Tesla account** → Mothership signs with VCSEC root key (fault-23 `REQUIRES_ACCOUNT_CREDENTIALS`) | No (account-less) |
| QR / key-card deeplink | `addPublicKeyToWhitelistWithQrCode` / `PAIR_KEY_CARD_DEEPLINK` | on-screen QR / card-authorize | No (needs car screen/UI) |

**A wiped whitelist entry means the car literally forgot the keyID** (`UNKNOWN_KEY_ID(3)` /
`KEY_NOT_ON_WHITELIST(1)`) — there is nothing to "reactivate." The *only* thing the car remembers across a
disturbance is the **session** (epoch/counter/handle), and that self-heals (`INVALID_HANDLE(2)` /
`INCORRECT_EPOCH(15)` → refetch `SessionInfo`, re-derive, retry) — which you already do, and which is **not**
a re-add. No persisted token survives a wipe to re-assert trust; the local keypair `phone_auth_<email>_key_pair`
proves *who* you are, not *that the car should trust you*.

**So:** after a genuine wipe, **prompt for the physical card** (`PRESENT_KEY` re-add). Your existing model
(`KEY_NOT_ON_WHITELIST`/`UNKNOWN_KEY_ID` → re-add; `INVALID_HANDLE`/`INCORRECT_EPOCH` → self-heal) is
**correct and complete**; there is nothing lighter to build. Don't promise an automatic/offline restore.

---

## Q3 — Could the ~25 bad-IV frames trip a VCSEC-wide lockout? (calibrated: UNCERTAIN)

**I will not tell you it's safe, and I will not tell you you bricked it — neither is supportable.** Here's
exactly what's provable and what isn't.

### What the readable evidence proves (MCU image — HIGH confidence)
- **No lockout/rate-limit/attempt-counter exists in `authd` or `command-router`.** Full symbol-table + enum
  + string search is negative (every `ban`/`cooldown`/`too many` hit is a substring false-positive:
  `URBAN`, `Albanian`, Go-runtime `too many open files`, etc.).
- **The `Backoff` family is authd's OWN retry cadence, not a client ban.** `ExponentialBackoffTimer.Wait`
  (`0x804600`) has exactly three callers — `Announcer.Run` (UI-stream reconnect), `Proxy.SessionInfo`
  (session refetch), `Proxy.wait`. It gates how politely *authd* retries toward VCSEC, nothing about blocking phones.
- **A bad tag provably cannot poison the counter.** `dispatcher.(*session).decrypt` (`0x8004c0`) verifies
  the **AES-GCM tag first** (`0x800565`); `SlidingWindow.Update` (`0x71b5c0`) is reached **only on tag
  success**. Your wrong-IV frames returned *before* the replay window was ever touched — they could not
  advance the high-water mark, set a bitmap bit, or desync the expected counter. Auth failure **self-heals**
  via re-handshake (`"Authentication failed: %s. Fetching session info to resynchronize client"`). *(HIGH)*
- **`FAULT_AES_DECRYPT_AUTH(6)` sits *after* the whitelist/IV-length/token/counter checks** in
  `SignedMessageInformation_E` — so VCSEC **accepted your keyId and counter** and failed only at the GCM
  tag. A "poisoned counter" story has no footing.
- **Your 25 frames did not remove your whitelist entry.** The legacy SM answers an AES fault by
  *re-deriving keys* (`gf0/b.java:400-408` → `REQUEST_PUB_KEY`), never by mutating the whitelist. The
  not-on-whitelist state appeared **later**, when the car dropped/re-epoched during the outage. *(HIGH)*

### What is NOT provable (VCSEC ECU — off-image)
- VCSEC is a **separate microcontroller not in this image**; `VCSEC.odj.bin` is Fernet-encrypted. authd/
  cmdrouter are MCU-side clients and **cannot even express** a "stop advertising to all centrals" state —
  that (and any anti-abuse counter) lives in VCSEC. **Their silence says nothing about VCSEC.**
- So: a VCSEC-internal protective response to abnormal message cadence **cannot be ruled out**. This is a
  structural limit (separate ECU + encrypted blob), not something more static analysis can close.

### The honest verdict
**UNCERTAIN.** Your specific feared mechanism (bad tags incrementing a counter that locks out all centrals)
is **unsupported and partly contradicted** on the readable side. And the recovery signature argues *against*
a designed rate-limiter: **a timed cooldown self-clears on a timer and would not require a car restart or a
re-enroll.** A ~20-min all-client outage cleared only by reboot looks more like a **wedged VCSEC/BLE
peripheral or a whitelist/epoch-state disturbance** — possibly *coincident with*, not *caused by*, your
messages. But "coincidence" is inference, not proof. Net: temporal correlation with an unproven,
partly-counter-indicated mechanism. Confidence that VCSEC has *no* such lockout = **low-medium (cannot prove)**;
that the 25 messages *caused* it = **low**.

### Hardening — defensible bounds given the uncertainty
Because you cannot read VCSEC's limit, the engineering posture is to **minimize exposure to it**:

1. **Bound malformed frames to ZERO, not just rate-limit them.** The IV bug is fixed — a *correct* response
   that merely fails is far lower-risk than emitting wrong-IV frames. Never intentionally emit a frame you
   don't believe is valid.
2. **Match official cadence:** one passive-auth response per challenge (~1 per connection); **never burst**
   multiple responses to one challenge.
3. **Circuit-breaker (single-digit, an order of magnitude under the only datapoint ~25):** on the **1st**
   `FAULT_AES_DECRYPT_AUTH(6)` / IV / `INVALID_SIGNATURE` fault, **stop resending and re-fetch `SessionInfo`
   (re-handshake)** — mirror the image's own self-heal, don't retransmit. Treat **≥3** signature faults on
   the same session/epoch as "our crypto is wrong" → **open the breaker**, minutes-scale exponential backoff,
   require a clean session before any further attempt.
4. **Honour `BUSY`/`WAIT`:** on `OPERATIONSTATUS_WAIT` / `MESSAGEFAULT_ERROR_BUSY`, back off — don't resend faster.
5. **Distinguish the failure classes** (you can now name them): **tag/signature fault** ⇒ *keys/IV wrong* ⇒
   re-handshake, don't advance counters or resend; **counter/epoch fault** (`INVALID_TOKEN_OR_COUNTER`,
   `REPEATED_COUNTER`, `INCORRECT_EPOCH`, `INVALID_HANDLE`) ⇒ *session stale* ⇒ refetch `SessionInfo`;
   **`KEY_NOT_ON_WHITELIST`/`UNKNOWN_KEY_ID`** ⇒ *re-enroll* (card).
6. **Don't fuzz passive-auth against the live car.** If you must characterize the lockout, do it as
   instrumented reproduction on hardware you're willing to restart — never blind static assumption.

### Lockout-vs-wipe disambiguation (do this before ever prompting for a card)
The incident may have been a **transient lockout with the entry intact** (favored: both apps recovered after
one app's setup + a restart, and you didn't re-tap a card for airgapp) *or* a **genuine wipe**. You can't
separate them statically — but you can **on-car**: after such an event, **read `WhitelistInfo` for your
keyID** once (a) the session is cleanly refetched (rule out `INVALID_HANDLE`/`INCORRECT_EPOCH` self-heal) and
(b) any `BUSY`/backoff window has elapsed (rule out a spurious not-on-whitelist read during a lockout).
**Only prompt for a card when membership is *persistently* absent after that** — otherwise you'll demand
unnecessary, user-hostile card taps on transient disturbances.

---

---

## ADDENDUM — the "forget the `<car name>` Bluetooth device" flow you observed (a BLE **bond** repair, not a re-enroll)

Your on-car observation — *"Set Up Phone Key" → forget the car in OS Bluetooth settings → it just
reactivates, no card* — is the key that unlocks the whole incident. **This is an OS-level LE-bond repair,
not a VCSEC whitelist re-enrollment.** It also supersedes this report's earlier "recovery = card re-tap"
framing for *your* incident: that only applies to a genuine whitelist wipe, which this was **not**.
(2 finders + adversarial verifier, verdict **SUPPORTED high**.)

**Direct answer to "is that all it does, or something more?": functionally, that's all.** Forgetting the
OS bond + auto re-pair on reconnect + re-running the normal VCSEC session **is the whole fix**; the
whitelist key is never touched (no re-enroll, no card, **no `WhitelistOperation`**). The only "more" is
non-key, optional, and off the critical path (listed at the end).

### The two-layer model (this is the crux)

There are **two independent security layers** on the same BLE link:

| Layer | Transport | Purpose | Gate |
|---|---|---|---|
| **VCSEC application session** | ECDH + AES-GCM over GATT chars **`…0212/0213/0214`** | **all commands + passive entry** | `whitelistHasKey` only |
| **OS LE bond (SMP)** | LTK/IRK, GATT chars **`…0301/0302`** | **UWB ranging only** (Nearby Interaction / FiRa) | downstream of the whitelist key |

Proof they're separate: iOS logs *"bonding — not reading bonding since `self.whitelistHasKey == false`"*
and *"not reading bonding since `haveSentCommandOnThisConnection == false`"* — the whitelist key and a
working command session are **preconditions** of bonding, never the reverse. `isReadyForCommands` checks
only `{peripheral state, whitelistHasKey, stayConnectedWhenUnauthorized}` — **no bonded flag.** Bonding
degrades gracefully (`BLEBondingStateCarUnsupported`/`PhoneIncapable`, *"NISession not supported"*): no
UWB, phone key still works.

### Why a *UWB-only* bond froze **all** BLE (your ~20-min all-client outage)

Once an LTK exists, **the OS auto-encrypts the link on every reconnect.** When the car drops/rotates its
side of the bond (reboot, BLE-stack wedge, IRK rotation) but the phone still holds the stale LTK,
CoreBluetooth **fails the CONNECT itself** with `CBErrorPeerRemovedPairingInformation` — which blocks the
VCSEC chars `…0212/0213/0214` too. So a bond that exists *only* for UWB, when stale, collaterally kills
commands + passive entry for **every** client that holds the stale bond — exactly your symptom. This is a
**transport-layer** wedge; the whitelist entry was intact the whole time.

### The recovery sequence (labeled: transport vs VCSEC-application)

1. **[detect · transport]** reconnect → `didFailToConnectPeripheral` with `CBError.peerRemovedPairingInformation`
   (`IOS_COREBTERROR_PEERREMOVEDPAIRINGINFORMATION`); secondary: *"Failed to read bonding characteristic
   from previously successful bonding, Resetting command peripheral"* (char `…0301`).
2. **[retry · transport]** backoff → *"ran out of PEER_REMOVED_BONDING retries. CLEARING PERIPHERALS."*
3. **[telemetry]** persist `PendingPeerRemovedBondingEvent {VIN, keyID, date}` → later
   `uploadPendingPeerRemovedBondingEvents` (cloud analytics + optional car `AppEventLog`) — **no key mutation.**
4. **[user fix · transport]** the app **cannot delete a bond programmatically on either OS**, so it shows
   `VehicleSuggestRemoveBondRow` + *"Go to Bluetooth settings and forget the paired `{{din}}` device, then
   retry"* (`openBluetoothSettings`). You forget it → OS drops the stale LTK/IRK.
5. **[reconnect · transport]** app clears the cached peripheral + rescans → fresh **unencrypted** connect
   succeeds (neither side holds a stale LTK now).
6. **[session · VCSEC]** `GetSessionInfo` → ECDH → AES-GCM session rebuilt with the **same enrolled key**.
   Commands + passive entry restored **here.** `whitelistHasKey` unchanged — **no re-enroll, no card.**
7. **[re-bond · transport, OPTIONAL, UWB only]** if `whitelistHasKey && NISession supported`: an app-level
   *prelude* explainer dialog (`presentBondingPrelude`, RN — **not** a VCSEC message, **not** the OS pairing
   sheet) → then reading the encryption-required char `…0301` implicitly triggers a fresh OS pairing sheet →
   new LTK/IRK → `BLEBondingStateBonded` → UWB back. **Skipped entirely on non-UWB phones/cars.**

The **only** "something more" beyond forget+reconnect+session: (a) the optional UWB re-bond (7); (b) the
telemetry drain (3); (c) possibly one **unsigned** VCSEC `Alert` ack
(`ALERT_CONFIRMATION_PEER_REMOVED_INFORMATION` — an `AppEventLog`/`Alert` acknowledgment, **not** a
`WhitelistOperation`, no key mutation; wiring not statically provable); (d) the prelude UI dialog. **None
touches the whitelist key.**

### Three DISTINCT "remove pairings" conditions — don't conflate

1. **Peer-removed-bonding** (yours): the *car* dropped its LE bond → forget the **car** in OS Bluetooth settings.
2. **Phone bond-table full**: *"Your phone has too many paired Bluetooth devices. Remove some…"* — the
   **handset's** OS LE bond table is full, blocking a new bond. (Different remediation.)
3. **Car whitelist-slot full**: the 20-slot VCSEC whitelist during *enrollment* (*"too many paired keys"*). (Different again.)

### What this means for airgapp — **don't bond**

- **airgapp should never bond.** Be a **BLE-RSSI + VCSEC-app-layer** client: never read the encryption-required
  bonding char `…0301/0302`, never mint an LTK. Commands + passive entry need only `whitelistHasKey` + the
  unencrypted VCSEC ECDH/AES-GCM session over `…0212/0213/0214`. Bonding buys **only UWB**, which RSSI-based
  passive entry doesn't need. Not bonding **structurally immunizes** airgapp from the peer-removed-bonding
  wedge (no stored LTK → the OS never auto-encrypts on reconnect → no `CBErrorPeerRemovedPairingInformation`).
- **But still implement detect + guide** — because the **official Tesla app may have previously bonded the
  same phone**, leaving a stale OS-level LTK that wedges the *shared* OS bond for **all** clients, airgapp
  included. So airgapp can be a *victim* of the official app's bond even though it never bonds. Handle it:
  (i) **detect** — iOS: `CBError.peerRemovedPairingInformation` in `didFailToConnect` (+ the secondary
  bonding-char read failure); Android: **infer** from persistent GATT `133`/`62` reconnect loops (the native
  layer surfaces *no* SMP auth-fail status, so there's no clean signal — this is a real Android limitation);
  (ii) **guide** — "Settings → Bluetooth → Forget `<car name>`, then reconnect" (you can't clear a bond in
  code on either OS); (iii) **recover** — just rescan + re-run the VCSEC session; the key survives.
- **This reframes your incident and the RESPONSE-3 Q3 guidance:** the recovery you'll usually need is a
  **bond repair (forget device), not a card re-tap.** So before ever prompting for a card (§Q3), also rule
  in/out a peer-removed-bonding wedge — a card tap would be the wrong, user-hostile remedy for a stale bond.

### Android specifics
The Android native BLE plugin uses **no** `BluetoothDevice` bond APIs at all (0 hits for
`createBond`/`removeBond`/`getBondState`/`refreshDeviceCache`/`BOND_*`), and defines **only** the VCSEC
service `00000211…` chars `0212/0213/0214` — **no `0301/0302` client** (UWB on Android rides a bundled FiRa
SDK inside VCSEC app-layer messages, `q1.java` `FiraSessionResult`, not an LE bonding char). Its only
native wedge-recovery is a **~30h-throttled "cycle Bluetooth" notification** (`BLEService.java:318-335`) —
coarse, and it does **not** detect peer-removed-bonding from an auth-fail status. The richer "forget the
`{{din}}` device" copy lives in the shared RN layer.

---

## Not determinable from any artifact (test on-car, carefully)
- Whether VCSEC has any internal anti-abuse counter / BLE-wide lockout, its threshold, and its duration — VCSEC-ECU-internal, `VCSEC.odj.bin` encrypted.
- Whether the 2026-07-20 event evicted the key vs merely locked out / wedged the peripheral — needs the on-car `WhitelistInfo` read above.
- The car-side tap-vs-UI-ACK decision for a card-free add (VCSEC policy) — irrelevant to airgapp (account-less), included for completeness.

## Provenance
Finders `setup-trigger-flow`, `reactivation-vs-reenroll`, `vcsec-lockout-safety` + verifiers
(`V-reactivation` REFUTED high; `V-lockout-safety` UNCERTAIN high). Key disasm: `authd`
`session.decrypt`/`SlidingWindow.Update`/`ExponentialBackoffTimer.Wait`. Full reports:
`scratchpad/findings5/*.md`. Builds on `phone-key-authorization-and-passive-entry.md` §2.5 and
`vcsec-phonekey-authz-firmware.md`.
