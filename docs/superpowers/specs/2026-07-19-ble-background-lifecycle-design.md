# BLE session lifecycle across background (roadmap C5)

**Date:** 2026-07-19
**Status:** approved, MVP scope (Core Bluetooth state restoration deferred)

## Problem

Backgrounding the app and returning tears the whole transport down and
rebuilds it: a ~6s BLE re-scan + reconnect + re-handshake on every foreground.
It feels like the app reloads. The official Tesla app keeps its BLE link and
resumes instantly.

Teardown today (`useCarLink.teardown`) is blanket and fires only on a true
`'background'` (transient `'inactive'` is already ignored): it
`closeAllCachedSessions()`, nulls the selector + gateway, and closes the current
transport's session — dropping a perfectly good direct-BLE GATT link.

## Root constraint

Without the `bluetooth-central` background mode, iOS suspends the app and Core
Bluetooth drops the GATT link during background — so keeping the JS transport
instance alone is useless (it would hand back a dead `CBPeripheral`). The link
can only survive with the native background mode enabled. Verified: Info.plist
has **no** `UIBackgroundModes`, and `BleManager()` has no `restoreStateIdentifier`.

## Design

### Part 1 — Native (full `xcodebuild`, never `expo prebuild`)

- `ios/airgapp/Info.plist`: add `UIBackgroundModes = [bluetooth-central]`,
  hand-edited (never `expo prebuild` — it clobbers the custom Godot `ios/`).
  Core Bluetooth then maintains the LL connection (empty PDUs at the negotiated
  interval) while the app is suspended, so the link survives a normal
  background→resume.

  ⚠️ **`/ios` is gitignored** (.gitignore:42), so this edit is NOT in version
  control and is lost if the native project is ever regenerated/restored.
  Reapply with:

  ```bash
  /usr/libexec/PlistBuddy -c "Add :UIBackgroundModes array" ios/airgapp/Info.plist
  /usr/libexec/PlistBuddy -c "Add :UIBackgroundModes:0 string bluetooth-central" ios/airgapp/Info.plist
  ```

  Verify with `/usr/libexec/PlistBuddy -c "Print :UIBackgroundModes" ios/airgapp/Info.plist`.
  A change here is baked into the `.app`, so it needs a full `xcodebuild`
  Release build — `deploy-js.sh` will NOT pick it up.

### Part 2 — JS (transport-aware lifecycle in `useCarLink`)

- **On background:** replace the blanket teardown with a transport-aware one.
  - `selectedTransport === 'ble'` → KEEP the DirectBleTransport, its session,
    and the GATT link; only stop the poll loop. (Command-in-flight deferral is
    unchanged.)
  - `selectedTransport === 'pi'` (or unknown) → close the Pi session as today
    (free the single slot / avoid the 5-min reaper), stop the stream.
- **On foreground:** nothing special — and deliberately NO explicit liveness
  probe. Investigation showed the self-heal already exists: `gateway.runAction`
  treats a transport-dead error by evicting the session and retrying under the
  BLE-first selector (gateway.ts, `isTransportDeadError` → `evictSession`). So:
  - Link alive → the first poll read succeeds on it. Instant, no re-scan.
  - Link dead → that read fails transport-dead → evict → re-open → reconnect,
    via the existing path. The "half-dead link" hazard is already handled; a
    hand-rolled probe here would only duplicate it.

## Out of scope (deferred follow-up)

- Core Bluetooth **state restoration** (`restoreStateIdentifier` +
  relaunch-into-background handling). Only helps when iOS *terminates* the app
  (memory pressure); without it, termination degrades to today's full
  reconnect. Validate the common-case win first.

## Risks

- Background power: holding a BLE connection draws a little more (matches the
  official app; the conn-param work already set a battery-reasonable interval).
- The kept link may still die on a long background — handled by the resume
  liveness probe.

## Test plan (on-car; needs phone + car + Pi)

1. Connect over BLE (dot blue). Background ~30s → foreground → live INSTANTLY,
   no scan spinner; closures still push; Pi journal shows no new session churn.
2. Long background (minutes) so the link drops → foreground → liveness probe
   fails cleanly → reconnects without wedging.
3. On Pi → background → confirm the Pi session is closed (journal), not left to
   the reaper.
