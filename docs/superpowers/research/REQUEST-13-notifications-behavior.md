# RE REQUEST #13 — how the official app sends its Phone-Key / passive-entry notifications

**Requested:** 2026-07-23
**Context:** airgapp now has native background passive entry working (model (b), RESPONSE-12) and BLE-only
DRIVE (RESPONSE-11). We're adding the official app's local reminders. We already ship three, driven from
our native `CBCentralManager` code via `UNUserNotificationCenter`:

1. **Bluetooth off** → title "Bluetooth Disabled", body "Phone Key will not work until Bluetooth is enabled"
   (we fire on `centralManagerDidUpdateState(.poweredOff)`, clear on `.poweredOn`).
2. **App terminating** → body "Keep the Tesla app running for the best Phone Key and Live Activity experience"
   (we fire on `applicationWillTerminate`).
3. **Car bond removed** (user forgot the device in iOS Settings → `peerRemovedPairingInformation`) → body
   "Set up your Phone Key to lock, unlock, and start your car" (we fire on the CBError, then flip the UI to
   the Set-Up state).

Screenshots of #1 and #2 as the OFFICIAL iOS app renders them are attached to the session. We picked our
own trigger points by iOS first-principles; we want to confirm them against what Tesla actually does, and
find anything we're missing.

**Hard constraint (unchanged):** airgapp must NEVER reach Tesla's servers. So the single most important
classification for us is **local vs server-push**: a notification scheduled locally
(`UNUserNotificationCenter` / `UNTimeIntervalNotificationTrigger` / region monitoring) we can replicate; one
delivered by APNs from Tesla's backend we CANNOT (and must not try to). Please tag every notification below
as **LOCAL** (client-scheduled, we can clone) or **PUSH** (server-driven, out of scope for us).

## What we need (answerable from the decompiled iOS app — `TeslaV4` — + Android + firmware)

### Q1 — the exact trigger + mechanism for OUR three
For each of the three above, from the app's notification-scheduling code:
- **Exact trigger:** what event/callback actually schedules it. E.g. is "Bluetooth Disabled" fired off
  `CBCentralManager` state, off `CBManagerAuthorization`, or a periodic check? Is "keep the app running"
  fired on `applicationWillTerminate`, on `applicationDidEnterBackground` with a delay, on a background-task
  expiration handler, or on a Live-Activity lifecycle event? Is "set up Phone Key" off a BLE bond error, off
  a whitelist read, off account state, or a push?
- **LOCAL or PUSH** (the tag above).
- **Exact title + body strings** (so ours match verbatim — confirm/repair our copy) and the notification
  **identifier / category / thread-id** if one is used (for dedup/replace).
- **Foreground behavior:** does the app present these as a banner while it is ACTIVE (i.e. does its
  `UNUserNotificationCenterDelegate willPresent` return options for them), or only when backgrounded? We just
  made ours present foreground; we want to know if Tesla does too or deliberately suppresses foreground.
- **Debounce / dedup / clear rules:** does it rate-limit, replace by identifier, and does it WITHDRAW any of
  them when the condition clears (e.g. remove "Bluetooth Disabled" when BT returns)?
- **Preconditions / gating:** only when a Phone Key is set up? only for the active vehicle? quiet hours?

### Q2 — everything ELSE Phone-Key / BLE / passive-entry related
List every OTHER local notification the app can raise that touches Phone Key, BLE, passive entry, walk-away
lock, or "app must be running", with the same fields (trigger, LOCAL/PUSH, strings, foreground behavior,
gating). Candidates we specifically want ruled in or out (don't limit to these):
- Phone Key **added / removed on the CAR** (whitelist changed), key **needs re-pairing**, key **not detected /
  place key card**.
- **Walk-away auto-lock** confirmations, "car left unlocked", "window left open", door/frunk/trunk left open.
- **Notification/Location/Bluetooth PERMISSION** nags (e.g. "enable Always Location for walk-up").
- Anything tied to **Live Activity** (the Pic-2 string names it): what is the Live Activity, what starts/ends
  it, and is the "keep the app running" reminder actually a Live-Activity-staleness message rather than a
  termination message? This changes our trigger.

### Q3 — the "keep the app running" mechanism specifically
This is the one we're least sure of. On iOS you cannot reliably run code at force-quit of a *suspended* app,
so if Tesla shows this after a swipe-kill, HOW? Options to confirm/refute from the binary:
- scheduled-on-background + cancelled-on-foreground (fires if never cancelled),
- a Live-Activity staleness/`.ended` local notification,
- a background-task-expiration handler,
- `applicationWillTerminate` only (catches foreground/background-running kills, misses long-suspended — our
  current approach),
- or a PUSH (in which case it's out of scope and we should drop the ambition of matching it exactly).
Whatever the real mechanism, tell us the **cheapest LOCAL approximation** that matches the user-visible
behavior without a server.

## Deliverable
Per-notification table: {trigger, LOCAL|PUSH, exact title, exact body, identifier/category, foreground-present
(y/n), debounce/clear rule, gating}. Plus a short note on the Live Activity and the Q3 verdict. Anchor claims
to the decompiled scheduling sites (file/offset) as usual. **Flag anything PUSH-only up front so we don't try
to build the un-buildable.**
