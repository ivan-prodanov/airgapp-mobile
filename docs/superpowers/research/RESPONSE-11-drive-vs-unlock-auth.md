# RE RESPONSE #11 — what authorizes DRIVE vs UNLOCK, and is BLE-only phone-key drive achievable?

**Answers:** `REQUEST-11-drive-vs-unlock-auth.md` (Q1–Q5 + the verdict).
**Method:** static RE of the decompiled Tesla 4.58.0 Android app (jadx) + `authd` (Go, `radare2`) + on-disk firmware + airgapp. **4 trace finders → 2 adversarial-refutation verifiers → completeness critic**, plus an independent re-check of the load-bearing bond claim.
**Verdicts:** T1 drive-mechanics **HIGH**, T2 UWB-crux **HIGH**, T3 permission/prompt **MED**; V1 UWB-gate **SUPPORTED/HIGH** (3 refutation vectors failed), V2 permission-vs-localization **PARTIALLY_SUPPORTED/MED**. (One trace, T4 official-app-drive, failed to format its structured output — its content is fully covered by T2/V1/the critic below.)

> **Boundary:** the app decompile is definitive for what the phone *sends/checks*. The **drive-enable decision, the interior-zone thresholds, and the role→permission expansion run on the separate VCSEC ECU (off-image)** — marked throughout. Two off-image gates keep the end-to-end at *high-confidence*, not *proven*; both are BLE/permission, **neither is UWB**.

---

## TL;DR — keep chasing: BLE-only DRIVE is achievable, it is NOT UWB-gated

**Verdict: BLE-only phone-key DRIVE is achievable on this Intel MCU2 car. Unlock-only is NOT your honest ceiling.** The decisive confirmation: the **official Tesla app drives *this exact MCU2 car* with no OS LE bond and no UWB** — it has **zero `createBond` and zero `0301/0302` references app-wide** (independently re-verified: `a.java:40-45` lists only `0211/0212/0213/0214`), and its UWB stack is *never even constructed* on a pre-Ryzen car. So it drives over the **same `0212/0213` app session airgapp already uses**. The transport/architecture is proven drive-capable.

**You are not missing the drive *message*** — you already build it (it's the working unlock response with one byte flipped, `08 02` instead of `08 01`). **You're missing the interior *context*:** the car only issues (and honors) a `DRIVE` challenge when its BLE-RSSI localizer places the phone **inside the cabin** — which needs you **seated with a sustained `0212/0213` presence**, not a walk-up. Your earlier test answered `DRIVE(2)` to an *exterior* handle-pull; getting only unlock there is **expected**, not a permission signal.

**The two off-image things to confirm (neither is UWB):** (1) does your offline `PRESENT_KEY` `ROLE_DRIVER` enrollment actually carry `LOCAL_DRIVE(2)` — high-confidence yes, but the BLE whitelist read is **dead** on this car (see Q3), so use UDS `0x705`; (2) does an app-session-only phone reach VCSEC's interior drive-zone. **The single scenario that would make it truly unlock-only** is if VCSEC grants offline `PRESENT_KEY` adds a reduced permission set and requires an account/root-signed add for `LOCAL_DRIVE` (which you can't produce offline) — a **permission/enrollment** limit, never UWB.

---

## Q1 — the DRIVE grant mechanically (APP-PROVEN, HIGH)

**The drive response is the unlock response with one byte changed.** The auth engine has two send paths, both level-parametric:
- **Reactive echo** (`q1.java:631 z0()`): answers every `FromVCSECMessage.authenticationRequest` by echoing `pVar.getRequestedLevel()` verbatim (`:660`), gated only on `getOnWhitelist()` + token. `reasonsForAuth` is **telemetry only** (`ve0/a.java` → analytics strings; never affects the level).
- **Proactive standing-DRIVE** (`q1.java:429 G0()`, only caller `connectionEstablished()` `:1226`): on every (re)connect the phone asserts `AUTHENTICATION_LEVEL_DRIVE` unprompted, one-shot, gated only on whitelist.

**The car — not the response level — decides drive.** It escalates by sending *another* `authenticationRequest` at `requestedLevel=DRIVE(2)` with an **interior reason** (`INTERIOR_HANDLE_PULL(6)`, `ENTERED_HIGHER_AUTH_ZONE(8)`, `POWER_ON_VEHICLE_REQUEST(2)`, or `IMMOBILIZER(10)` — all in `vc0/n.java`), which it emits **only when its localizer places the phone in the interior/drive zone**. The engine (`AuthorizationResult.java:105-121`) passes the requested level through or *downgrades* to a rejection (stationary-IMU → `DEVICE_STATIONARY`; phone-key-off → `PASSIVE_DISABLED`) — it never upgrades. Drive is granted only when **all** hold: key has `LOCAL_DRIVE(2)` + a signed `DRIVE` response (you have this) + VCSEC classifies the phone *inside* + no proximity fault (`MESSAGEFAULT_ERROR_COMMAND_REQUIRES_PHYSICAL_PROXIMITY`). The decision + thresholds are VCSEC-ECU-side.

## Q5 — the exact routable DRIVE response (APP-PROVEN, HIGH)

Identical to RESPONSE-9's proven-working unlock, **except one varint**:
- **Envelope:** `RoutableMessage`, `to.domain = DOMAIN_VEHICLE_SECURITY`, `AES_GCM_Personalized`, **random nonce**, session-bound seal — byte-identical to the unlock envelope (the dispatcher `ye0/n.java:135 → ob0/e.java:1132` does **not** branch on level; **no `AuthenticationRequestToken` echo**, `token=null`).
- **Inner plaintext:** `UnsignedMessage{ authenticationResponse(tag 3) = AuthenticationResponse{ authenticationLevel(tag 1) = DRIVE(2) } }`. `estimatedDistance` and `authenticationRejection` are `OMIT_IDENTITY` (absent on wire). **On the wire the `AuthenticationResponse` is 2 bytes: `08 02`** (unlock is `08 01`). The whole delta from your working unlock is `01 → 02`.

Answer via your existing reactive-echo path; the proactive standing-DRIVE-on-connect is fine to add but is **not sufficient alone** — the car still waits for its own interior localization + a drive trigger (brake / power-on).

---

## Q2 — the UWB crux: **NOT UWB-gated; BLE-only is achievable** (V1 SUPPORTED/HIGH — 3 refutation vectors failed)

1. **The phone cannot even encode a UWB/NI/bond refusal.** The entire rejection enum (`vc0/o.java`) is `{NONE, DEVICE_STATIONARY, PASSIVE_DISABLED, NO_TOKEN, PASSIVE_DISABLED_AUTOMATION, DEVICE_NOT_UNLOCKED_ON_WRIST}` — no UWB/NI/bond reason exists. Neither auth path checks UWB/NI/bond.
2. **UWB is car-initiated and disabled for this generation.** The UWB stack is constructed only if `jf0/d.b(vin)` passes: `MOBILE_APP_FEATURE_ANDROID_UWB_ENABLED` **AND `api_version ≥ 77` AND `car_type ∈ {Model3+Poppyseed(Highland), ModelY+Bayberry(Juniper), Lychee, Tamarind, Cybertruck}`** (`jf0/d.java:80-104`) — all refresh/Ryzen. A pre-Ryzen MCU2 returns FALSE → `o0()/p0()` false → the UWB machinery is **never built** — yet passive unlock works. `AppDeviceInfo.UWBAvailable` (`ob0/e.java:399`) is a benign self-report that never suppresses drive.
3. **No UWB anchor hardware in this image.** The rootfs has zero uwb/fira/anchor files; `deploy/` has no vcsec/uwb ECU blob; `authd` carries `NISession`/`UWBAvailability` only as proto pass-through, never a gating branch.

**Interior localization is multi-antenna BLE-RSSI** — the `AlertHandlePulledWithoutAuth` per-channel vector (`q1.java:807-857`, `vc0/c1.java`): 9 antennas (Left/Right/Rear/Center/Front/Secondary/**NFCCradle**/RearLeft/RearRight) + `highThresh*Present` + a `sortedDeltaBayes`/`rawDeltaBayes` classifier. Interior antennas (Center/NFCCradle) decide "key inside."

**The `0301/0302` OS LE bond is not a drive precondition** (independently re-verified): the Android app has **no `createBond` and no `0301/0302`** anywhere. That bond (found on the **iOS** side in RESPONSE-3/4) is a **UWB-ranging** affair — and UWB is inert on this pre-Ryzen car — so your deliberate bond-avoidance costs you nothing for drive.

**Plainly: BLE-only phone-key drive is achievable here. There is no UWB remedy to need or miss.**

---

## Q3 — role / permission for drive (T3 MED; V2 PARTIALLY_SUPPORTED)

- **`LOCAL_UNLOCK(1)` and `LOCAL_DRIVE(2)` are distinct, independently-grantable bits** — unlock working proves nothing about drive. `WhitelistEntryInfo` carries `permissions[]`(field 3) and `keyRole`(field 7) as *independent* fields; `authd` has **no** role→permission expander (the `DRIVER→bitset` table is VCSEC-ECU policy, off-image).
- **airgapp enrolls `ROLE_DRIVER(3)` with NO permission list, via offline `PRESENT_KEY`** (`bleEnroll.ts:60-84`), relying 100% on VCSEC to expand the role. Whether `ROLE_DRIVER` expands to include `LOCAL_DRIVE` is **high-confidence yes** — your stored entry is byte-structurally identical to the car's OWNER keys except `keyRole`, and `ROLE_DRIVER` is the exact mechanism Tesla additional-driver keys use (they drive). But this is **equivalence inference**, not a positive read, and V2 could not statically exclude the one residual: that an *offline* `PRESENT_KEY` add gets a reduced set vs an account/root-signed add.
- **⚠ Your planned Pi BLE whitelist read is DEAD** — on this car the BLE `WhitelistEntryInfo` reply carries **no `permissions` field for ANY key** (all OWNER keys too; on-car 2026-07-20, `slotMask=31`), and the vendored proto drops field 3. So `vcsecGetWhitelistEntryAction`/`parseWhitelistPermissions` returns "none" **regardless** of whether the key has `LOCAL_DRIVE`. **It cannot disambiguate — don't rely on it.**
- **The only positive permission read is UDS** `GET_PERMISSION_FOR_KEY(0x705){KEYID=slot4(ours), PERMISSION=2 LOCAL_DRIVE} → ISSET`, swept against a known OWNER slot as control (map slot→key via `GET_WHITELIST_ENTRY 0x701`). Requires VCSEC gateway/OBD diagnostic access, **off the Pi BLE path**.

**The prompt is a presence state, not a permission verdict.** "Place the key card OR set up the phone key" maps to `Dots.DriveAuthHealth` — a real-time presence boolean (`"Key: Present / Not present / Key not detected. If using key card, press brake"`, `tow_mode_window.uiml:50-53`) + `KeyAuthPopup` (`showPhoneKeySetup` QR / `showObstruction` "use backup Key Card"). "Set up phone key" is the account/keyID-membership nudge airgapp (account-less) can never satisfy; "place the key card" is the console-NFC drive fallback when **no phone drive-key is authenticated/localized**. Distinct from the whitelist-membership check and from the UWB bond.

## Q4 — how the official app enables drive-away (from T2/V1 + the critic; T4 trace failed to format but is covered here)

Drive is the **same car-initiated challenge-response engine** as unlock (`q1.java`), just answering **interior/higher-zone** challenges at `DRIVE(2)`; the app also proactively asserts standing DRIVE on connect. It is **car-paced/event-driven**, not a phone-side stream, and works **BLE-only** over the `0212/0213` app session — **no `NISession`/UWB, no `createBond`/bond**. The "place card / set up phone key" prompt corresponds to the `DriveAuthHealth` **presence** state, not a distinct permission-denied state.

---

## The missing piece + what to build

**Not a new message — the interior context.** Concretely:
1. **Be seated with a sustained `0212/0213` presence** (connect-and-hold from RESPONSE-10, held while *seated*, not just on approach). Only then does the car's RSSI localizer zone you "inside" and escalate to a `DRIVE(2)` challenge with an interior reason.
2. **Answer that challenge with `08 02`** — your existing reactive-echo path already does this (it echoes `requestedLevel`, which will be `DRIVE`). No new proto, no new seal; the envelope is byte-identical to your working unlock.
3. **Confirm `LOCAL_DRIVE(2)`** via UDS `0x705` (the BLE read is dead). If absent, re-enroll with an explicit permission list `[LOCAL_UNLOCK, LOCAL_DRIVE]`; if VCSEC refuses `LOCAL_DRIVE` to any offline `PRESENT_KEY` add, that — and only that — is the honest unlock-only ceiling (permission limit, not UWB).

---

## On-car probes (corrected order — the BLE whitelist read is dead)

1. **Seated + brake challenge capture (cheapest *useful* first step).** Hold a sustained interior `0212/0213` session; sit inside, foot on brake; log the car's `authenticationRequest` stream (every `requestedLevel` + reason + timing); answer each with `08 02`. **Drive enables → localization/operational was the only blocker (permission fine) → done.** Refused while seated and answering DRIVE → go to (2) or it's an unmet interior-RSSI threshold (cross-check the `vc0.c1` present-vector at `q1.java:807-857`). Car never escalates to DRIVE while seated → your app-session presence isn't zoning you inside (sustained connection / phone position / antenna-present vector to close).
2. **Permission read via UDS** `GET_PERMISSION_FOR_KEY(0x705){slot4, PERMISSION=2}` vs a known OWNER slot. (Do **not** waste effort on `GET_WHITELIST_ENTRY_INFO` over BLE — proven non-diagnostic here.)
3. **UWB negative control (settles it for good).** During (1), confirm the car sends **no** `VCSEC_FiraRequest`/`NISessionRequest` on `0212/0213` and the phone reports `UWB_AVAILABILITY_UNAVAILABLE_UNSUPPORTED_DEVICE`, yet the car still issues/honors the DRIVE challenge. Drive enabling (or even `COMMAND_REQUIRES_PHYSICAL_PROXIMITY` rather than a UWB/NI error) with UWB unavailable ⇒ UWB is conclusively not the gate.

---

## Residual unknowns (all VCSEC-off-image, none UWB) + provenance
Whether an offline `PRESENT_KEY` `ROLE_DRIVER` add expands to `LOCAL_DRIVE(2)` (high-conf yes, read via `0x705`); the exact interior BLE-RSSI/Bayes drive-zone threshold and whether an app-session-only phone reaches it; whether `rejectionEnabled` (armed vs shadow `AuthConfig`) lets the phone's own stationary-IMU self-reject suppress a seated DRIVE grant (`rd0/t.java:391`, server flag); whether the car emits the DRIVE escalation on `0212/0213` as expected (the seated capture confirms).

Traces `T1-drive-grant-mechanics`, `T2-uwb-crux`, `T3-role-permission-and-prompt` (+ `T4` failed-to-format, covered); verifiers `V1-uwb-gate` (SUPPORTED/HIGH), `V2-permission-vs-localization` (PARTIALLY_SUPPORTED — refuted the "BLE whitelist read shows LOCAL_DRIVE" prediction, corrected the probe order); completeness critic (verdict + missing piece + probe order). Independent re-check: `createBond`/`0301`/`0302` absent from the Android app (`a.java:40-45`), reconciling the iOS-side bond finding of RESPONSE-3/4. Findings in `~/Work/tesla-firmware/out/req11-findings/`. Key anchors: `q1.java:429/631/660/807-857/1226`, `vc0/m.java`/`n.java`/`o.java`/`r.java:71-121`/`m3.java`, `jf0/d.java:80-104`, `ob0/e.java:399/1132/1136`, `ye0/n.java:135`, `AuthorizationResult.java:105-121`, `bleEnroll.ts:60-84`, `whitelistPermissions.ts:9-38`, `tow_mode_window.uiml:50-53`, `key_auth_popup.uiml`; `authd` `MESSAGEFAULT_ERROR_COMMAND_REQUIRES_PHYSICAL_PROXIMITY` / `ImmobilizationControl` / `WHITELISTKEYPERMISSION_LOCAL_DRIVE`. Builds on RESPONSE-9 (routable) + RESPONSE-10 (connect-and-hold); additive, no supersession.
