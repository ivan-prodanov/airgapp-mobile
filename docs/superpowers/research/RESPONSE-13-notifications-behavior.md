# RE RESPONSE #13 — the official app's Phone-Key / passive-entry notifications (LOCAL vs PUSH)

> **CORRECTION 2026-07-23 (Ivan's device outranks the doc): the car is HW4 Ryzen, NOT pre-Ryzen Intel MCU2.** RESPONSE-11's "pre-Ryzen MCU2" premise was wrong, so the "car lacks CPD radar" blocker was invalid — an HW4 car HAS the cabin-presence radar and CAN emit CPD. CPD is therefore BUILT (native). **Wire format extracted from the HW4 decompile (jadx), all PROVEN:**
> - `FromVCSECMessage.CPDMessage = field 55` (vc0/w0.java:109/297, `getVCSEC_CPDMessage`), a `CPDMessage` submessage (vc0/y.java).
> - `CPDMessage.CPDNotification = field 1` — enum `CPDNotification_E` (vc0/a0.java): **NONE=0, INITIAL_WARNING=1, ESCALATED_WARNING=2**.
> - Phone ACK: `ToVCSECMessage.CpdResponse = field 62` (vc0/e3.java:302) carrying `CPDNotificationResponse_E` (vc0/b0.java, tag 1) — OPTIONAL, not built in v1.
> - Delivery = unsolicited VCSEC push (RoutableMessage→field10 payload=FromVCSECMessage→field55→field1), same channel as vehicleStatus.
> - Detection = field55 present && field1 ∈ {1,2} → post "Child detected in car" / "Return to your vehicle immediately." (id CPD_WARNING_NOTIFICATION). Native handles it in the background (autonomous handleReply); JS foreground path (postCpdWarning + a manual proto scanner in vcsecPush) is a follow-up. NB: official app uses the `critical-alerts` entitlement (pierces silent/DND) — we don't hold it, so ours is a normal notification.


**Answers:** `REQUEST-13-notifications-behavior.md` (Q1–Q3 + the table).
**Method:** static RE of the official iOS `TeslaV4` 4.57.5 (arm64) Mach-O + its decoded `.strings` binary-plists (`plutil -convert json`) + Hermes bundle + Android jadx + airgapp source. **4 trace finders → 2 adversarial-refutation verifiers → completeness critic**, plus an independent re-read of airgapp's shipped copy.
**Verdicts:** T1/T2/T3/T4 all **HIGH**; V1 LOCAL-vs-PUSH **PARTIALLY_SUPPORTED/HIGH** (found one classification error — CPD — and fixed it); V2 keep-running + copy **SUPPORTED/HIGH** (byte-exact strings).

---

## TL;DR

- **The classification is a naming convention, verified against code:** `phone_key_notification_*` / `live_activity_notification_*` / `vehicle_ble_uwb_*` keys are **LOCAL** (built into `UNMutableNotificationContent` + `UNUserNotificationCenter.add`); `push_notification_*` / `push_notif_*` keys are **PUSH** (APNs categories/actions via `didReceiveRemoteNotification`). airgapp can clone the first set, must not build the second.
- **Your three are all LOCAL.** #1 (Bluetooth) is **verbatim correct**. #2 (keep-running) has a **must-fix copy bug** — you shipped the *Live-Activity* variant of a real Tesla string while running no Live Activity. #3 (bond-removed) is **airgapp-authored** (no official counterpart) — a product decision, not a bug.
- **Q3 answered:** "keep the app running" is scheduled **locally on `applicationWillTerminate`** (proven single caller — not scheduled-on-background, not a Live-Activity message, not push). Your mechanism already matches Tesla exactly; only the copy needs repair.
- **One bonus you *can* build:** **CPD "Child detected in car" is LOCAL over BLE, not push** — the only vehicle-state warning that's client-schedulable without a server (you keep the VCSEC BLE session).
- **PUSH-only (do not build):** every other vehicle-state alert (left-unlocked, windows/frunk/trunk open, Sentry, walk-away, climate/charging/software) and all Live Activities.

---

## PUSH-ONLY — flag up front, do NOT build (would require Tesla's servers)

All keyed `push_notification_*` / `push_notif_*`, registered as `UNNotificationCategory`/`UNNotificationAction` and dispatched via `-[AppDelegate application:didReceiveRemoteNotification:fetchCompletionHandler:]` (`aps-environment=production`; `remote-notification` bg mode; `PlugIns/NotificationExtension.appex`). The alert **title/body are server-supplied in the APNs payload — not bundled** — so there is literally nothing to clone:

- **18 vehicle-state categories** (`push_notification_*`): `lock` (**car left unlocked**), `close_windows`, `close_front_trunk`/`close_rear_trunk`/`close_sunroof`/`close_tonneau` (**left-open reminders**), `enable_sentry`/`disable_sentry`, `stop_charging`, `climate_on`/`off`/`on_override`, `camp_mode`/`override`, `dog_mode`/`override`, `update_software`/`cancel_software`.
- **14 action buttons** (`push_notif_action_*`): Lock, Stop Charging, Turn Climate On/Off, Turn Sentry Off, etc.
- **`push_notif_command_failed`** ("Failed" / "Something went wrong. Tap to open the app to retry") — string is built on-device, but only downstream of tapping a **remote** push's action button. No server push ⇒ never fires. Out of scope.
- **Walk-away auto-lock** — **zero** local footprint in the binary (only SwiftProtobuf field names like `door_open_driver_front` from `bleReceivedVehicleStatusUpdate:`). It's the server push set. PUSH.
- **"Phone Key added/removed on the car"** — only VCSEC `WHITELIST*` protocol enums exist, **no notification copy**. PUSH/na.
- **Live Activities** (Charging / Dog-Pet Mode / Service) — push-token-driven ActivityKit (see the Live Activity note). Out of scope.

---

## The per-notification table (all rows static-RE-proven; sites in `TeslaV4` Mach-O)

| # | key / name | trigger | LOCAL/PUSH | exact title | exact body | identifier | fg-present | debounce / clear | gating |
|---|---|---|---|---|---|---|---|---|---|
| 1 | `phone_key_notification_bluetooth_disabled_{title,message}` | `centralManagerDidUpdateState` → `.poweredOff(4)` **or** `.unauthorized(3)`; `-[BLEHelper warnAboutPhoneKeyIfNeeded:]`@0x1012a81cc, add@0x1012a8444 | **LOCAL** | "Bluetooth Disabled" | "Phone Key will not work until Bluetooth is enabled" | `phone_key_bluetooth_warning` | inferred | 2.0s trigger; **withdrawn on any non-poweredOff** (incl `.poweredOn`) via removePending@0x1012a8314 + removeDelivered@0x1012a8320 | ≥1 vehicle has `whitelistHasKey` |
| 2 | `phone_key_notification_user_kill_body` (+ LA variant) | `applicationWillTerminate` → `UserKillDetector.appWillTerminateWithApplication:`@0x1000fbb88 → scheduler func.1000fb608 (**sole caller**), add@0x1000fba20 | **LOCAL** | *(none — body-only)* | default "Keep the Tesla app running for the best phone key experience"; **overridden** to "…best Phone Key and Live Activity experience" only when iOS16.1+ && `areActivitiesEnabled` (@0x1000fb86c) | `com.tesla.user-kill-detector.phone-key` | inferred | 1.0s trigger; debounce keys exist (`userNotifiedKey`, `…time-since`) but window not decompiled | `[phoneKeyMgr isPaired]` (@0x1000fb6bc) |
| 3 | `phone_key_notification_cpd_warning_{title,message}` | **VCSEC `.CPDNotification_E` delivered OVER BLE** → `bleReceivedCPDWarning:`@0x10363990a; builder@0x100011c60 | **LOCAL (BLE, not APNs)** | "Child detected in car" | "Return to your vehicle immediately." | `CPD_WARNING_NOTIFICATION` | inferred | `CPD_NOTIFICATION_INITIAL`/`ESCALATED_WARNING`; **no** `push_notification_cpd` category; NSE has 0 CPD refs | live VCSEC BLE session near car; child-present state |
| 4 | `phone_key_notification_nearby_interaction_disabled_{title,message}` | handle-pull without NI auth → `PhoneLogManager.swift` builder@0x100191048 | **LOCAL** | "Failed to Unlock" | "Enable Nearby Interactions to improve phone key accuracy" | `ALERT_NI_DISABLED_HANDLE_PULL` | inferred | throttled via `LAST_NI_DISABLED_NOTIFICATION_TIMESTAMP` | NI/UWB unlock path |
| 5 | `vehicle_ble_uwb_experience_upgrade_notif_title` (re-bond/upgrade prompt) | bonding-char read prompt / re-bond after `peerRemovedPairingInformation`; `BLEHelperDelegation.swift`@0x100010834 | **LOCAL** | "Upgrade your phone key performance" *(title-only)* | *(none)* | `READ_BONDING_CHARACTERISTIC_PROMPT` | inferred | withdraw via `bleShouldWithdrawBondingNotificationForVIN:` | per-VIN bonding state |
| P | `push_notification_*` (18) / `push_notif_action_*` (14) / `push_notif_command_failed` | APNs payload / remote-push action | **PUSH** | server-supplied | server-supplied | `setNotificationCategories:` | n/a | server-controlled | server-controlled |

> Foreground presentation for every LOCAL row is governed by one shared `-[AppDelegate userNotificationCenter:willPresentNotification:withCompletionHandler:]` that wasn't disassembled per-notification, so "fg-present" is **inferred** (mostly irrelevant for #2, which fires on terminate). airgapp force-presents via its own delegate — a low-risk divergence.

---

## Your three — exact repairs

**#1 Bluetooth Disabled (`PassiveEntryCentral.swift:240-241`) — CORRECT, no change.** Title/body match `phone_key_notification_bluetooth_disabled_{title,message}` verbatim; your clear-on-`.poweredOn` mirrors Tesla's `removeDelivered`+`removePending`; your `isArmed()` gate mirrors `whitelistHasKey`. Optional fidelity nits (not bugs): Tesla also fires on `.unauthorized(3)` (BLE-permission-denied — add an `.unauthorized` case with the same copy if you want to cover it); Tesla uses a 2.0s trigger + default sound (you use immediate + silent — cosmetic).

**#2 Keep-app-running (`PassiveEntryAppDelegate.swift:46`) — MUST-FIX COPY.** You ship:
> "Keep the Tesla app running for the best **Phone Key and Live Activity** experience"

That is a **genuine** Tesla string (`live_activity_notification_user_kill_body`) — **not fabricated** — but it's the **wrong variant**: Tesla shows it **only** when `ActivityAuthorizationInfo().areActivitiesEnabled` (iOS 16.1+, a purely local capability read). You ship **no Live Activity**, so it over-promises a feature that doesn't exist. **Change the body to the phone-key-only variant:**
> "Keep the Tesla app running for the best phone key experience"  *(= `phone_key_notification_user_kill_body`)*

Trigger/mechanism need **no change** — `applicationWillTerminate` + `postAndWait` + empty title + `isArmed()` gate already match Tesla exactly. *(Higher-fidelity option: keep both strings and pick at runtime via `ActivityAuthorizationInfo().areActivitiesEnabled` — local, no network — but since you have no Live Activity, the plain string is the honest choice.)*

**#3 Bond-removed (`PassiveEntryCentral.swift:467`) — NOT a bug, a product decision.** Your body "Set up your Phone Key to lock, unlock, and start your car" is **airgapp-authored** — absent from the Mach-O, every `.strings` locale, the Hermes bundle, and Android. The trigger is legitimate and LOCAL (`CBError.peerRemovedPairingInformation` code 14). But Tesla has **no** bond-removed *notification*: it handles `peerRemovedPairingInformation` as an in-app BLE re-enrollment event, and its nearest native *notification* is a different one — "Upgrade your phone key performance" (`READ_BONDING_CHARACTERISTIC_PROMPT`, the re-bond prompt). **Keep your authored copy** (it reads well and is honest) — just don't treat it as mirroring an official string.

---

## Q3 — "keep the app running": LOCAL, scheduled on terminate (your mechanism already matches)

**Mechanism (proven):** `-[AppDelegate applicationWillTerminate:]`@0x100008e30 → `UserKillDetector.appWillTerminateWithApplication:`@0x1000fbb88 → scheduler func.1000fb608 (its **sole caller**, verified via `/r`). The scheduler: guard on `isPaired`; `setBody(phone_key_notification_user_kill_body)`; if iOS16.1+ && `areActivitiesEnabled`, overwrite with the LA body; `UNTimeIntervalNotificationTrigger(1.0s)`; `requestWithIdentifier("com.tesla.user-kill-detector.phone-key")`; `UNUserNotificationCenter.add`. Every symbol is `UN*` — **no APNs, no device token** ⇒ LOCAL. It is **not** scheduled-on-background+cancel (option a), **not** a Live-Activity-staleness message (option b), **not** push (option d) — it is your **option (c)**.

**Consequence (same for both apps, can't be beaten):** `applicationWillTerminate` fires on a foreground quit and on swipe-kill of an app **actively running in the background** (the BLE-central case), but **not** for a long-**suspended** app the user swipes away. Since it's schedule-on-terminate (proven single caller), it will **not** fire for the suspended-app swipe — **matching Tesla exactly**. So there's no better local approximation to chase; you already have the right one.

**Cheapest fix:** repair the copy (above). That's it — your `applicationWillTerminate` + `UNUserNotificationCenter.add` + empty-title + `isArmed()` are already the Tesla design.

---

## Live Activity note

ActivityKit Live Activities are a **separate subsystem** from phone-key reminders — three families: **Charging** (`ChargingWaitlistLiveActivityModule`), **Dog/Pet Mode** (`DogModeLiveActivitySyncManager`), **Service** (`ServiceLiveActivityModule`); umbrella `TeslaV4.LiveActivityAttributesProtocol`; widget `VEHICLE_LIVE_ACTIVITY`. They are **push-token-driven** — started via `Activity.request(…pushType:.token)`, updated/ended over APNs; the token plumbing (`LiveActivityTokenManager`, `attemptUploadPushToStartToken`, `"live-activity-pushToStart"`) goes to Tesla's backend (decisive log: *"Not starting a local dog mode live activity because we have never received a push token"*). **There is NO phone-key / passive-entry Live Activity** (negative grep in both `TeslaV4` and `TeslaWidgetsExtension.appex`). Live Activities touch the keep-running reminder **only** as a copy switch (`areActivitiesEnabled`). airgapp must not build any of this — and since it ships none, the LA copy variant is simply wrong for it (repair #2).

---

## The bonus you *can* build: CPD "Child detected in car" (LOCAL over BLE)

The one classification correction the verification produced: **CPD is LOCAL, not push.** `bleReceivedCPDWarning:`@0x10363990a receives a `.VCSEC.CPDNotification_E` **over BLE** and schedules a local notification (id `CPD_WARNING_NOTIFICATION`) from the `phone_key_notification_cpd_warning_*` strings — there is **no** `push_notification_cpd` category and the Notification Service Extension has **zero** CPD references. So it's the **only vehicle-state warning that's client-schedulable without a server**, and **airgapp could clone it** while near the car (you keep the VCSEC BLE session). Title "Child detected in car" / body "Return to your vehicle immediately." (Escalation levels `CPD_NOTIFICATION_INITIAL`/`ESCALATED_WARNING`.) — Rows 4/5 (Nearby-Interaction "Failed to Unlock"; UWB re-bond "Upgrade your phone key performance") are also LOCAL but only matter if you implement NI/UWB or bonding — inert on your pre-Ryzen, never-bond design.

---

## On-device tests + residual unknowns
- **Airplane-mode-near-car (the decisive LOCAL test):** with the phone offline near the car and a child present, if "Child detected in car" still fires → CPD is confirmed LOCAL/BLE (expected). Whether Tesla *also* pushes a server APNs CPD for the fully-away case has **zero** client footprint — unknowable statically, and out of scope for airgapp either way.
- **Lifecycle-timing (on-device confirm):** BT-toggle → bluetooth_disabled; swipe-kill of a *background-running* app → user_kill (won't fire for a long-suspended app — proven schedule-on-terminate); `peerRemovedPairingInformation` → re-bond prompt. Statically unambiguous (identifiers + call sites) but runtime-timing-dependent.
- **Open:** the user-kill once/debounce window (`userNotifiedKey`, `…time-since` — not decompiled; airgapp has no debounce, acceptable); per-notification foreground-present options (shared `willPresent` handler not disassembled).

## Provenance
Traces `T1-the-three-airgapp-ships`, `T2-local-vs-push-inventory`, `T3-live-activity-and-keep-running`, `T4-everything-else`; verifiers `V1-local-vs-push` (corrected CPD from PUSH→LOCAL), `V2-keep-running-and-copy` (byte-exact strings; corrected finder T4's wrong "airgapp #2 is correct" claim). Independent re-read of airgapp copy: `PassiveEntryCentral.swift:240-241/467`, `PassiveEntryAppDelegate.swift:46`. Findings `~/Work/tesla-firmware/out/req13-findings/`. Strings decoded from `en.lproj/{NativeLocalizable,CocoapodsLocalizable,InfoPlist}.strings` via `plutil -convert json`; scheduling sites in the `TeslaV4` arm64 Mach-O. Builds on the RESPONSE-12 iOS extraction; additive.
