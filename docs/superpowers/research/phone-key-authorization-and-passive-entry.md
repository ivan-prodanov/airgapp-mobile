# Tesla phone key: authorization model, key type, and the road to passive entry

**Scope.** Answers two questions the user raised, in implementation-grade detail:

1. **Is Tesla's phone key a *different key type* than the one airgapp creates, and does that
   matter for unlock-on-approach?**
2. **Why does the official app add a phone key with no physical card (just "confirm on the
   car screen"), while airgapp requires tapping the NFC key card on the console — and why did a
   dead phone key re-add card-free?**

**Method.** Static RE of Tesla app **4.58.0-4392** on both platforms — Android
(`base.apk` → jadx + Hermes-v96 bundle) and iOS (`TeslaV4.app` Mach-O + `main.jsbundle`) — plus
the public `teslamotors/vehicle-command` source and airgapp's own `src/ble` + vendored protos.
Produced by a 14-agent workflow (8 finders across both apps/protocol/airgapp + 6 adversarial
verifiers). Confidence tags below reflect the verifier verdicts.

**Bottom line up front.**
- **Q1 — the key type is NOT different, and it is NOT the blocker.** airgapp enrolls a key that
  is byte-for-byte the same *type* as an official **driver** phone key
  (`KEY_FORM_FACTOR_IOS_DEVICE` + `ROLE_DRIVER`). Nothing in the car's per-key record
  distinguishes "added by card" from "added by touchscreen," and there is **no passive-entry
  capability flag** to be missing. The only thing standing between airgapp's existing key and
  walk-up unlock is a **persistent background BLE presence** the car can range and challenge.
  *(Verdict: SUPPORTED ×3, high confidence.)*
- **Q2 — the card is an *authorization/authority* difference, not a key-type difference.** The
  official app holds **owner authority** (your Tesla account, which owns the VIN, plus an
  on-car owner key), so the car will accept a **touchscreen "Approve"** or a **cloud push**.
  airgapp is deliberately **account-less and air-gapped** and self-enrolls as **`ROLE_DRIVER`**,
  so the only authorizer the car accepts from it is a **physical present-key (card) tap**. The
  card is a **root-of-trust/bootstrap** requirement, not a consequence of the key type.
  *(Verdict: PARTIALLY_SUPPORTED ×3 — thesis correct; see the "two offline paths" correction.)*

---

## Part 1 — Key type, and whether it matters for unlocking

### 1.1 The enrollment payload is identical across airgapp, official iOS, and official Android

All three build the **same VCSEC message**:

```
VCSEC.UnsignedMessage {
  WhitelistOperation (tag 16) {
    addKeyToWhitelistAndAddPermissions (tag 5) = PermissionChange {
      key            = PublicKey { PublicKeyRaw = <65-byte SEC1 P-256 point> }
      keyRole        = Keys.Role.ROLE_DRIVER (3)
      // permission[]  ← LEFT EMPTY by every app (see 1.3)
    }
    metadataForKey (tag 6) = KeyMetadata { keyFormFactor = <IOS_DEVICE(6) | ANDROID_DEVICE(7)> }
  }
}
```

- airgapp: `src/ble/bleEnroll.ts:62-81` → `ROLE_DRIVER(3)`, `KEY_FORM_FACTOR_IOS_DEVICE(6)`.
- official Android: `ob0/e.java:906` hardcodes `KeyMetadata(KEY_FORM_FACTOR_ANDROID_DEVICE)`,
  role only, **no** explicit permission bits.
- official iOS: enrolls `KEY_FORM_FACTOR_IOS_DEVICE` via the same
  `WhitelistOperation.addKeyToWhitelistAndAddPermissions` (binary proto descriptors
  `bin 72023-72065`).

**`IOS_DEVICE(6)` is exactly the form factor the official iOS app stamps on its own phone key.**
So on iOS the label is *identical*; on Android the only difference is the cosmetic
`ANDROID_DEVICE(7)` vs `IOS_DEVICE(6)` tag. There is no evidence anywhere that the car branches
passive-entry behavior on that label.

### 1.2 What the car actually stores per key — there is nothing else to gate on

`VCSEC.WhitelistEntryInfo` (`vc0/k3.java`) is the car's complete per-key record:

```
WhitelistEntryInfo {
  keyId                     = 1   // SHA1(pubkey)[…]
  publicKey                 = 2
  permissions[]             = 3   // repeated WhitelistKeyPermission  ← the effective unlock gate
  metadataForKey            = 4   // = KeyMetadata { keyFormFactor }  (form factor ONLY)
  secondsEntryRemainsActive = 5   // TTL (0 = permanent)
  slot                      = 6
  keyRole                   = 7
}
```

Grep across `vc0/`, the RN bundle, and the iOS binary for
`passiveEntry / passiveCapable / supportsPassive / uwbCapable / bondingRequired / addedVia` →
**zero hits.** There is:
- **no "passive-entry capable" flag**,
- **no UWB/NI capability field** stored per key,
- **no LE-bonding field** stored per key,
- **no "how it was added / authorized-by" field.**

`KeyMetadata` (`vc0/l1.java`) carries a **single** field — `keyFormFactor`. The app literally
cannot register any per-key "capability"; it can only attach a form-factor label. **So there is
nothing airgapp could have failed to set at enrollment.**

### 1.3 What gates passive (walk-up) entry

Three conditions, all car-side:

1. **Local BLE presence** — the key must hold a live, authenticated VCSEC session over GATT
   service `00000211-b2d1-43f0-9b88-960cebf8b91e`. (This is the one thing airgapp doesn't yet
   maintain in the background — see Part 3.)
2. **`WHITELISTKEYPERMISSION_LOCAL_UNLOCK` (value 1)** — walk-up is a *local* unlock. Its pair
   for driving is `LOCAL_DRIVE(2)`; the remote equivalents are `REMOTE_UNLOCK(3)/REMOTE_DRIVE(4)`.
   **There is no dedicated "passive"/"walk-up" permission bit** — walk-up is authorized by
   `LOCAL_UNLOCK`.
3. **Proximity** — the car computes the zone from its own BLE-RSSI array (± UWB antennas) and
   *issues* an `AuthenticationRequest` to whatever whitelisted, locally-present key is in range,
   tagged with an `AuthenticationReason`: `WALK_UP_UNLOCK(9)`,
   `PASSIVE_UNLOCK_EXTERIOR_HANDLE_PULL(5)`, `PASSIVE_UNLOCK_INTERIOR_HANDLE_PULL(6)`,
   `PASSIVE_UNLOCK_AUTOPRESENT_DOOR(7)` (`vc0/n.java`). **The car self-selects the key; the phone
   does not advertise eligibility.**

**UWB / NISession and LE-Secure bonding are NOT preconditions.** They are negotiated *per BLE
session* over the already-authenticated channel and **degrade gracefully** — iOS logs
`BLEBondingStatePhoneIncapable`, `"bonding - not bonding NISession not supported"`; the key still
unlocks over BLE-RSSI. UWB only *sharpens* ranging and enables Hands-Free Trunk. No UWB work is
required for basic walk-up.

### 1.4 The one genuine unknown (firmware-side) — and how to close it cheaply

airgapp sends `keyRole = ROLE_DRIVER` with an **empty `permission[]` list** (its
`PermissionChange` proto, `proto/vcsec.proto:104-108`, doesn't even *have* a permission field).
It relies on the **car expanding `ROLE_DRIVER → {LOCAL_UNLOCK, LOCAL_DRIVE, …}`**. That
role→permission table lives in **VCSEC firmware** and is not observable in any app.

Crucially, **this is not an airgapp handicap**: the official app's *additional-driver* phone keys
use the **identical** role-only mechanism (also no explicit bits — `ob0/e.java:906`), and those
keys do walk-up unlock. So airgapp's key is type-equivalent *by construction*.

**Verify it empirically in one shot** (turns the only static unknown into a runtime check):
after enrolling, issue `INFORMATION_REQUEST_TYPE_GET_WHITELIST_ENTRY_INFO` and read back
`WhitelistEntryInfo.permissions[]` for airgapp's keyID. If `LOCAL_UNLOCK(1)` is present, the key
is passive-eligible on that car's firmware — done.

### 1.5 The only form factor that WOULD break passive entry

`KEY_FORM_FACTOR_CLOUD_KEY(9)` is the only "remote-only" form factor — it holds no local BLE
credential, so it can only serve `REMOTE_UNLOCK`. **airgapp does not use it** on its direct-BLE
path (it uses `IOS_DEVICE`), so this doesn't apply. (Note: the `CLOUD_KEY` string that shows up
in the app bundle is `SET_ENERGY_PHONE_PUBLIC_KEY_FORM_FACTOR_CLOUD_KEY` — a **Powerwall/energy**
context, not the vehicle phone key. Red herring, cleared.)

> **Answer to Q1.** No, the key type is not meaningfully different — airgapp's key is the same
> type as an official driver phone key, and the card-vs-touchscreen *authorization method* is not
> even recorded on the key. The key type is **not** the reason airgapp can't unlock on approach.
> The missing ingredient is a **background BLE presence**, which is a client/runtime feature
> (Part 3), not a key-provisioning one.

---

## Part 2 — Why the official app needs no card, and airgapp does

### 2.1 The car's authorization gate: "Local Entity Auth"

When the car receives a whitelist add, VCSEC runs a **Local Entity Auth** step and reports the
outcome via `WhitelistOperation_Information` (`vc0/o3.java`). The load-bearing codes:

| Code | Meaning |
|---|---|
| `NOT_ALLOWED_TO_ADD_UNLESS_ON_READER (14)` | Car **insists** on a physical card at the console reader; refuses otherwise. |
| `…FAILED_TIMED_OUT_WAITING_FOR_TAP (25)` | Car waited for a **card tap**, timed out. |
| `…FAILED_TIMED_OUT_WAITING_FOR_UI_ACK (26)` | Car waited for a **touchscreen "Approve"**, timed out. |
| `…FAILED_UI_DENIED (24)` / `…CANCELLED (28)` | User denied/cancelled on screen. |
| `NO_PERMISSION_TO_ADD (5)` / `ATTEMPTING_TO_ADD_KEY_WITHOUT_ROLE (19)` | Requester not authorized / no role. |

So the car can satisfy the add with **either** a **card tap** (`WAITING_FOR_TAP`) **or** an
**on-screen confirm** (`WAITING_FOR_UI_ACK`). **Which one it demands is a firmware policy
decision** based on the *authority the requester already holds*. The card is the authorizer of
last resort; an owner-authenticated context unlocks the touchscreen-confirm alternative.

### 2.2 The full set of add paths (and their authorizers)

All of them build the **same** `addKeyToWhitelistAndAddPermissions` payload; they differ only in
**envelope + who vouches**. The command wrapper `ic0/c.java` carries three BLE whitelist fields;
`CommandActionExtensionsKt.java:481` selects the signature type:

| # | Path | Transport | Signature / envelope | Authorized by | Needs internet? |
|---|---|---|---|---|---|
| 1 | **Present-key (card)** — `presentKeyWhitelistOperation` (tag 16) | BLE | `SIGNATURE_TYPE_PRESENT_KEY(2)`, 1-byte placeholder sig (no crypto) | **Physical NFC card tap** on the console reader | No |
| 2 | **Session-signed** — plain `whitelistOperation` (tag 8) | BLE | `SIGNATURE_TYPE_AES_GCM` (authenticated ECDH session) | An **already-whitelisted key holding `ADD_TO_WHITELIST`** (i.e. an owner key) | No |
| 3 | **Shared-HMAC** — `sharedHmacWhitelistOperation` (tag 5) | BLE | HMAC over a provisioned shared secret | A provisioned fleet/pre-delivery secret (also the likely carrier of the QR secret) | No |
| 4 | **Over-network** — `add_remote_key_pair` | OwnerAPI HTTPS | account session | **Tesla-account ownership of the VIN** | Yes |
| 5 | **QR** — `addPublicKeyToWhitelistWithQrCode` | BLE (+ scan) | present-key-class (QR secret) | Scanning the car's **on-screen one-time QR** (+ BLE proximity) | No (account selects VIN) |
| 6 | **Over-proxy** — `proxyCommand` (tag 9) | proxy/cloud | relayed | proxy/account | Yes |
| 7 | **Pre-delivery over-network** | OwnerAPI HTTPS | account + Service-key root | account ownership (car not yet handed over) | Yes |

**airgapp implements only #1** (both its "direct BLE" and "via Pi" flows funnel to
`SIGNATURE_TYPE_PRESENT_KEY`). #4/#5/#6/#7 appear **only** in the official app's bundle, never in
airgapp.

### 2.3 The signature-type crux (the whole answer in one line)

The public `tesla-control` makes it explicit with **two commands that build the identical
payload** but differ in envelope + authority:

- **`add-key-request`** → `SendAddKeyRequestWithRole` → `SIGNATURE_TYPE_PRESENT_KEY`,
  `requiresAuth:false`, fire-and-forget BLE write. Prints *"Confirm by tapping NFC card on center
  console."* **This is byte-for-byte what airgapp does.**
- **`add-key`** → `AddKeyWithRole` → the same payload as an **AES-GCM-Personalized, authenticated,
  encrypted** `RoutableMessage` to `DOMAIN_VEHICLE_SECURITY`, `requiresAuth:true`, **no card**.
  Requires the sending key to already be a trusted **owner** (`protocol.md`: "An Owner can
  authorize … adding and removing public keys"; a Driver "cannot manage other users' keys" →
  `NO_PERMISSION_TO_ADD`).

> **Correction to the earlier working thesis (caught by adversarial verification).** PRESENT_KEY
> is **not** "the only offline, account-less BLE authorization." There are **two** offline
> account-less BLE add authorizations: **(1) PRESENT_KEY** (card tap — needs *no* prior trust) and
> **(2) AES-GCM session-signed** (needs a *prior owner key* with `ADD_TO_WHITELIST`). The precise
> root cause of airgapp's card requirement is therefore **"holds no owner authority"** — neither a
> Tesla account **nor** a pre-existing on-car owner key — **not** "is offline" per se. An offline
> *owner* key can add further keys card-free.

### 2.4 Why the official app is card-free, and airgapp isn't

**Official app** holds **owner authority two ways**: (a) it's logged into the **Tesla account that
owns the VIN** (`isVehicleOwnerByVin`), and (b) it holds an on-car **owner** key. Given either,
the car accepts a **touchscreen "Approve" (UI-ACK)** or a **cloud push** — no card.

**airgapp** is architecturally the opposite, **by design**:
- **Never contacts Tesla's cloud.** `src/ble/teslaHostGuard.ts` fail-closed denylists
  `tesla.com / owner-api / owners-api / …`, and `src/ble/no-tesla-servers.test.ts` **fails the
  build** if any such literal appears in `src/ble/`. The only bearer token is the **Pi's**, not a
  Tesla OAuth token. (This is the "air-gapped" premise — it's the whole point of the app.)
- **Self-enrolls as `ROLE_DRIVER`** (`bleEnroll.ts:64`; Pi POC `SendAddKeyRequestWithRole(…,
  ROLE_DRIVER,…)`) — never `ROLE_OWNER`, so it never holds `ADD_TO_WHITELIST` and **cannot
  self-bootstrap** more keys.

With no account and no owner key, the **only** authorizer the car will accept from airgapp is the
**physical card tap**. That's the answer to "why them, not us."

### 2.5 The "it stopped working, I re-added it on screen with no card" episode

Two distinct channels report key state, and the app treats them very differently
(`key-invalidation-lifecycle` finder):

- **Session stale** (`INVALID_HANDLE` / `INCORRECT_EPOCH` / `INVALID_KEY_HANDLE`): the car
  attaches a fresh `SessionInfo`; the app silently re-derives session keys and retries. **No
  re-add, usually invisible.** This is ordinary "reconnect and it works."
- **Key gone** (`SessionInfo.status = KEY_NOT_ON_WHITELIST`, or fault `UNKNOWN_KEY_ID(3)`): the
  **whitelist entry itself** is gone → a real re-add is needed. The app detects non-membership
  directly (`a2.java` "Did NOT find key in whitelist" / `native_not_on_whitelist_upon_connection`)
  and prompts "set up phone key."

So the key "stopping" the other day means the **whitelist entry was actually removed** — most
plausibly a **car software update/reset that cleared the whitelist**, **slot eviction**
(`KEYCHAIN_IS_FULL(14)` / `whitelist_is_full`; the car has a fixed number of key slots and an
owner adding keys can evict old ones), or the **app's local keypair no longer matching** (reinstall
/ re-login regenerating `phone_auth_<email>_key_pair`). A merely-rotated epoch/session would **not**
have forced this.

**Why the re-add needed no card:** you were the account owner, physically present, so the car
authorized the add via **Local Entity Auth `WAITING_FOR_UI_ACK`** (touchscreen "Approve") and/or
the **owner-account network path** — both card-free (2.1–2.3). airgapp, lacking both, would have
needed the card in the same situation.

> **Answer to Q2.** The card is an **authorization-authority** artifact, not a key-type one. The
> official app carries owner authority (account + owner key) that lets the car accept a touchscreen
> confirm or a cloud push; airgapp carries neither and enrolls as a driver, so the car will only
> accept a physical card tap. Nothing about this changes the *resulting* key — it unlocks
> identically once enrolled.

---

## Part 3 — Implementation guidance (fine details)

### 3.1 For the actual goal (unlock-on-approach): the key is already fine

Passive entry is a **client/runtime** feature, not an enrollment change. airgapp's existing
card-enrolled `IOS_DEVICE/ROLE_DRIVER` key is passive-eligible by construction. To make the car
unlock on approach:

1. **Maintain a persistent, background-resilient BLE presence** that keeps an **authenticated
   VCSEC session** alive (ECDH → SHA-1 KDF → AES-128-GCM, counter/epoch), so the car can range the
   phone and, on a handle-pull/zone event, issue an `AuthenticationRequest` with
   `WALK_UP_UNLOCK / PASSIVE_UNLOCK_*` that airgapp answers. This is the substance of the separate
   **passive-entry project** (see `[[project-tesla-passive-entry]]`) — iOS `bluetooth-central`
   background mode, service-UUID-scoped scans, `CBCentralManagerOptionRestoreIdentifierKey` for
   relaunch; Android `connectedDevice` foreground service + reconnect wakelock.
2. **Answer the car's proximity challenge** — the runtime must respond to the car-initiated
   `AuthenticationRequest` (this is the car→phone direction, distinct from airgapp's current
   phone→car command flow).
3. **One-time validation** — after enrollment, `INFORMATION_REQUEST_TYPE_GET_WHITELIST_ENTRY_INFO`
   and confirm `permissions[]` contains `LOCAL_UNLOCK(1)` (closes the 1.4 firmware unknown).

No UWB, no LE-bonding, no form-factor change, no `ROLE_OWNER` upgrade is required for basic walk-up.

### 3.2 OPTIONAL — "card once, card-free thereafter" enrollment

If the goal is to *reduce* card taps (not required for passive entry), the protocol supports an
offline, account-less pattern:

1. **Bootstrap once with a card:** enroll a **`ROLE_OWNER(2)`** key via one `PRESENT_KEY` card tap
   (change the bootstrap key's `keyRole` in `bleEnroll.ts:64` from `ROLE_DRIVER(3)` to
   `ROLE_OWNER(2)`). *The first key still needs the card — there is no cardless-AND-account-less
   first-key primitive.*
2. **Add subsequent keys card-free:** build `addKeyToWhitelistAndAddPermissions` inside a **plain
   `whitelistOperation` (CommandAction tag 8, NOT `presentKeyWhitelistOperation` tag 16)** and sign
   it with the owner key as an **`SIGNATURE_TYPE_AES_GCM`** `RoutableMessage` over the authenticated
   BLE session (airgapp already has the ECDH/session/counter/AAD machinery for commands; the add
   builder just needs to route through it instead of the raw one-shot PRESENT_KEY write). This is
   exactly `tesla-control add-key` / `AddKeyWithRole`.

**Hard caveats — verify on a live car before relying on it (firmware-side, not in any binary):**
- Does current firmware actually confer `ADD_TO_WHITELIST` on a `ROLE_OWNER` key added over BLE, or
  still demand a reader tap (`NOT_ALLOWED_TO_ADD_UNLESS_ON_READER(14)`)?
- Does it demand account credentials for the add
  (`MESSAGEFAULT_ERROR_COMMAND_REQUIRES_ACCOUNT_CREDENTIALS(23)` → "resend via Fleet API")? Offline
  BLE cannot supply those. Community reports (`vehicle-command` #216/#168) show BLE `add-key`
  behaving inconsistently on newer firmware.

If either fires, "card-free AND fully-offline" is firmware-blocked and the per-key card tap stays
mandatory. Probe each attempt with `GET_WHITELIST_ENTRY_INFO`.

### 3.3 Reference: the exact numeric values (for hand-encoding)

```
Keys.Role:              NONE=0 SERVICE=1 OWNER=2 DRIVER=3 FM=4 VEHICLE_MONITOR=5
                        CHARGING_MANAGER=6 SERVICE_TECH=7 GUEST=8 RIDER=9 PREDELIVERY=10 INFOTAINMENT=11
KeyFormFactor:          UNKNOWN=0 NFC_CARD=1 BLE_DEVICE=3 NFC_DEVICE=4 BLE_AND_NFC=5
                        IOS_DEVICE=6 ANDROID_DEVICE=7 CLOUD_KEY=9 APPLE_WATCH=17 HARMONY_OS_NEXT=19 …
WhitelistKeyPermission: ADD_TO_WHITELIST=0 LOCAL_UNLOCK=1 LOCAL_DRIVE=2 REMOTE_UNLOCK=3 REMOTE_DRIVE=4
                        CHANGE_PERMISSIONS=5 REMOVE_FROM_WHITELIST=6 REMOVE_SELF=7
                        MODIFY_FLEET_RESERVED_SLOTS=8 UNKNOWN=31   ← NOTE: unset decodes to ADD_TO_WHITELIST(0), not "none"
VCSEC.SignatureType:    NONE=0 PRESENT_KEY=2         (pairing envelope; public proto has only these two)
Signatures.SignatureType(command auth): AES_GCM=0 AES_GCM_PERSONALIZED=5 HMAC=6 HMAC_PERSONALIZED=8 AES_GCM_RESPONSE=9
CommandAction whitelist fields: sharedHmacWhitelistOperation=tag5  whitelistOperation=tag8(AES_GCM)  presentKeyWhitelistOperation=tag16(PRESENT_KEY)
AuthenticationReason:   UI_UNLOCK_PASSIVE_AUTH=4 PASSIVE_UNLOCK_EXTERIOR_HANDLE_PULL=5
                        PASSIVE_UNLOCK_INTERIOR_HANDLE_PULL=6 PASSIVE_UNLOCK_AUTOPRESENT_DOOR=7 WALK_UP_UNLOCK=9
```

---

## Car-side firmware follow-up (resolved separately)

The firmware-side items below were then investigated against the car's MCU2 image —
see [`tesla-firmware/out/vcsec-phonekey-authz-firmware.md`](../../../../tesla-firmware/out/vcsec-phonekey-authz-firmware.md).
Key results: (1) the VCSEC *enforcement* firmware is a separate microcontroller, so the
role→permission table, tap-vs-touchscreen policy, and proximity thresholds are confirmed
**VCSEC-ECU-side**, not in the MCU image — validating the caveats here. (2) The **"account
credential" (fault-23) is concretely a Mothership-signed AES-GCM command using the VCSEC root
key** (`GET_SESSION_INFO` → `mothership…/aes_gcm_sign_command` op `add_key_and_add_permissions`
→ `SEND_PROTOBUF`) — so the official app's card-free add = Tesla's cloud signs it with the root
key; airgapp offline can't, hence the card (physical proximity) is the substitute. (3) Concrete
**live-probe tooling** now exists to close P1/P4: read `WhitelistEntryInfo.permissions[]` over BLE,
or UDS `GET_WHITELIST_ENTRY(0x701)`/`GET_PERMISSION_FOR_KEY(0x705)`; whitelist = 20 slots (0 reserved).

## EMPIRICAL RESULT (2026-07-20, on-car) — the BLE permissions read is IMPOSSIBLE

Ran the §1.4/§3.1.3 probe against the car. **The recommended method does not work
on this firmware, and the reason is not our key.**

Targeting (previously undocumented): the car accepts `keyId = SHA1(pubkey)[:4]`.
A full 20-byte SHA1 target faults `10 (DECODING)`; the `publicKey` oneof arm
returns nothing. The `[…]` truncation in §1.2 is therefore **4 bytes**.

Our entry reads back fine — 88 bytes, `slot=4`, `keyRole=3 (ROLE_DRIVER)`,
`keyFormFactor=6 (IOS_DEVICE)` — but carries **no `permissions` field (3)**.

The decisive part is the CONTROL GROUP. `GET_WHITELIST_INFO` reports
`slotMask=31, entries=5`; reading every filled slot:

| slot | keyRole | fields present | permissions |
|---|---|---|---|
| 0 | 1 SERVICE | 1,2,7 | none |
| 1 | 2 OWNER | 1,2,4,6,7 | none |
| 2 | 2 OWNER | 1,2,4,6,7 | none |
| 3 | 2 OWNER | 1,2,4,6,7 | none |
| 4 | 3 DRIVER (**ours**) | 1,2,4,6,7 | none |

**Three OWNER keys — which certainly hold `LOCAL_UNLOCK` — report no permissions
either.** So §1.4's test cannot answer the question on this firmware: the BLE
reply never carries field 3 for ANY key at ANY role. `permissions[]` is not
materialized into the BLE `WhitelistEntryInfo` here, contradicting the
firmware-RE note that VCSEC "returns the materialized permissions[]" (that
likely describes the UDS/diagnostic surface, not this one).

**What this DOES establish:** our entry is byte-structurally identical to the
official OWNER keys — same field set, differing only in `keyRole`. Nothing is
missing from our enrollment's stored record, which was the actual worry.

**Consequence:** `LOCAL_UNLOCK` cannot be confirmed by reading. Combined with
§1.4/§2.4 (official *additional-driver* keys use the identical role-only
mechanism and do perform walk-up unlock), eligibility is supported by
equivalence but only provable **behaviourally** — i.e. by the end-to-end
walk-up test once a background BLE presence exists. Do not spend more effort on
read-based probes.

## What is firmware-side (not resolvable from any binary) — verify on a live car

- The `ROLE_DRIVER → WhitelistKeyPermission[]` expansion (does it include `LOCAL_UNLOCK`? — almost
  certainly yes; official driver keys prove it). Read back via `GET_WHITELIST_ENTRY_INFO`.
- The car's card-tap-vs-touchscreen policy for a given add (`WAITING_FOR_TAP` vs `WAITING_FOR_UI_ACK`
  vs `NOT_ALLOWED_TO_ADD_UNLESS_ON_READER`).
- Whether an owner-role BLE signed add is accepted card-free, or triggers fault-23 / reader-tap.
- Whitelist slot count and eviction/expiry policy.
- Exact numeric RSSI/UWB thresholds and zone geometry for issuing `WALK_UP_UNLOCK`.

## Provenance

14-agent workflow, 4.58.0-4392 both platforms + `vehicle-command` + airgapp. Claim A
(key-type sufficiency): **SUPPORTED ×3, high confidence**. Claim B (card vs cardless):
**PARTIALLY_SUPPORTED ×3** — thesis confirmed, with the "only offline path" overreach corrected to
"two offline paths; root cause is missing owner authority." Related:
`[[project-tesla-passive-entry]]`, `[[reference-tesla-app-status-ux-findings]]`.
