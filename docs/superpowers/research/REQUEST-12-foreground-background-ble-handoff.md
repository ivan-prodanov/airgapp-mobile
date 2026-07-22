# RE REQUEST #12 — the foreground↔background BLE-ownership handoff (native passive entry)

**Requested:** 2026-07-22
**Context:** we're building native background passive entry (RESPONSE-7's model): a native
`CBCentralManager` with State Restoration holds the car link and answers challenges while the app is
suspended. Foreground passive entry keeps using our existing JS inline responder. **One enrolled key**
(routable seal, confirmed on-car). The blocker below is the ONLY open coordination question; it blocks
just the final wiring phase, not the native module itself.

## The hard constraint that creates the problem

We proved on-car that **two `CBCentralManager`s in one app connected to the SAME car peripheral cancel
each other** ("Operation was cancelled" storms, connect-timeout wedges — fatal). So there must NEVER be
a moment where both the JS command path's central AND the native passive-entry central hold a link to
the car at once.

Today: the JS command path (`DirectBleTransport`) opens its own central when the selector picks BLE
(near the car, or when the Pi is unreachable). The native module will open a central for passive entry.
On a foreground→background transition these two must hand the single BLE link over cleanly.

## The questions

### Q1 — which of these two architectures does the official app actually use? (decisive)
- **(a) Lifecycle handoff:** JS owns the central in foreground; on `didEnterBackground`, JS drops its
  central and native takes over (and vice versa on foreground). Requires the transition to be ordered
  and reliable.
- **(b) Native owns the ONE central full-time** (foreground + background), and the JS/RN command path
  submits BLE commands *through* the native central via a bridge (RESPONSE-7 L1's `sendCommandTo:`
  pattern) — so there is only ever one central and the handoff question disappears.

Trace the official iOS app: is `BLEVehicle`'s central owned by a component that lives across
foreground/background (native, always-on), with the RN command layer bridging down to it — or does
anything in the RN layer open its own central? If it's (b), that's our answer and Q2/Q3 are moot.

### Q2 — if (a) lifecycle handoff: is it reliable enough?
- Does iOS guarantee `applicationDidEnterBackground` / `willResignActive` runs (and gives us enough
  time) to `cancelPeripheralConnection` + destroy the JS `CBCentralManager` BEFORE suspension — so the
  native central can connect cleanly? Or can the app suspend with the JS central still holding the link
  (leaving a stale connection the native central then fights)?
- With State Restoration, does the native central *inherit* the JS central's connection, or must the JS
  one be fully torn down first? Any interaction between two restore identifiers?
- Reverse direction (background→foreground): the native central is holding the link; JS wakes and its
  selector wants BLE — how does the official app prevent JS from opening a second central here?

### Q3 — the seam we can't see from our side
- Is there a supported way for one `CBCentralManager` to hand a live `CBPeripheral` connection to
  another within the same app, or is "one central owns the peripheral for the process lifetime" the
  only safe model (i.e. (b) is effectively forced)?

## What we're really asking
Just tell us the correct ownership model for our topology (one app, one car peripheral, JS command
path + native passive responder, one key): **(a)** a lifecycle handoff with the exact ordering that
makes it safe, or **(b)** native owns the single central and JS bridges BLE commands to it — with the
bridge surface we'd need. Either is fine; we need the one that won't reintroduce the two-central
contention.

## Constraints
Static RE of the iOS Mach-O (`BLEVehicle`/`BLEHelper` central ownership across app lifecycle) + the RN
bundle (does any JS path construct a central, or only bridge to native?). Cite locations + confidence.
If it's not statically determinable, say so and give the exact on-device test (we can drive
foreground/background transitions near the car and watch for contention).
