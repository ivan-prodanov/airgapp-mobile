# Lock-gated WiFi — design

**Date:** 2026-07-27
**Repos:** `airgapp-rpi` (Go, most of the work) + `airgapp/mobile` (RN, one hook)
**Status:** design approved, not yet planned

## Goal

Stop the car burning 12 V battery staying awake to make blocked requests to Tesla's
servers while it is parked and nobody is in it.

The win is **drain**, not privacy. Privacy is already handled by the existing
per-device nftables policies. This document exists because a car that *thinks* it
has a network keeps the stack engaged — retry, back off, retry — and stays awake
doing it, whereas a car that finds no network concludes there is nothing to do and
sleeps.

**Non-goal:** dropping every last packet to Tesla. That is what the `Tesla` policy
already does, and it is the configuration we are moving *away* from while parked.

## Verified context

Everything below was read out of the two repos on 2026-07-26/27, not assumed.

1. **The car's own LTE is dead** (user-confirmed). The Pi's hotspot is the car's
   only path to the internet. Taking the AP down genuinely disconnects it rather
   than pushing traffic onto an unfiltered path.
2. **The car pushes `VehicleStatus` over BLE on every lock / closure / presence
   change, in plaintext, with no authentication and no subscribe command.**
   `docs/superpowers/research/tesla-live-status-push-FINDINGS.md`: *"Subscribing to
   the GATT notify characteristic is the enable step; the car pushes on change."*
   `src/ble/vcsecPush.ts` decodes these with no session keys — a push has no request
   to bind to, so it is not AES-GCM sealed.
3. **`VehicleStatus` carries `vehicleLockState`, `userPresence`, `vehicleSleepStatus`
   and closures** (`vcsec.proto:280-284`, vendored in both repos), and
   `src/ble/telemetry.ts:213` already parses all four.
4. **There is no heartbeat.** Same FINDINGS, line 117: *"No keep-alive/heartbeat for
   the push was found."* The push is edge-triggered only.
5. **The Pi already has the plumbing.** `internal/services/tesla_session.go` has the
   frame pump (`runPump` is the sole reader of `conn.Receive()`) and an unsolicited
   fan-out with `Subscribe(id)` / `Unsubscribe(id, subID)` already implemented and
   tested. Phases 0/1 of `2026-07-18-pi-push-streaming.md` have landed.
6. **The Pi can decode VCSEC in Go** — `go.mod` already pulls
   `teslamotors/vehicle-command` (Ivan's fork) and `google.golang.org/protobuf`.
7. **The AP is `hostapd` on 5 GHz ch36**, chosen so 2.4 GHz stays clear for BLE
   (`internal/services/hotspot.go:129`). `HotspotService.Apply()` already shells out
   to `systemctl restart hostapd` through the `Executor`.

## Decisions

| Question | Decision | Why |
|---|---|---|
| Mechanism | **`systemctl stop/start hostapd`** | The goal is drain. A blackholed-but-present network is the worst case — the car keeps trying. No SSID means nothing to try. |
| DROP vs REJECT | **N/A — no traffic reaches the firewall** | Superseded by radio-off. (For the record: for a *privacy* goal DROP is better; for a *drain* goal REJECT would be, because silent timeouts hold the car awake.) |
| connman carve-out | **None** | Keeping `connman.vn.tesla.services` alive is exactly what keeps the car's connection manager engaged. The car concluding "this network is dead" is the desired outcome here, not a problem to work around. |
| Predicate | `LOCKED && NOT_PRESENT` | See below. |
| Unknown state | **Fail open** — AP up | A wrong state must always mean "leaked some traffic", never "stranded the car offline". |
| Re-sync | **Phone posts authoritative state opportunistically** | The Pi holds no keys and cannot poll `GET_STATUS`. The phone can, and already does. |
| Sequencing | **Observe-only phase first** | Isolates the BLE link's own cost from the WiFi saving, and proves the signal before it can break anything. |

### The predicate

```
AP down  ⟺  lockState == LOCKED  AND  userPresence == NOT_PRESENT
```

Anything else — including every `UNKNOWN` — means AP up.

The presence term is **not** an optimisation and is not optional. Teslas auto-lock
at drive-away, so the car is `LOCKED` for the whole drive; without the presence term
the AP would go down every time you pull away and take nav, music and streaming with
it. Both terms arrive in the same already-decoded message, so the cost is one `&&`.

Deliberately **not** gated on which of `LOCKED` / `INTERNAL_LOCKED` the car reports
while driving. Either way you are `PRESENT` while driving, so the AP stays up. What
the car actually reports is recorded in Phase 1 as information, not as a blocker.

`SELECTIVE_UNLOCKED` and `INTERNAL_LOCKED` both fall through to "AP up" — neither is
`LOCKED`.

### State machine

| State | AP | Entered by |
|---|---|---|
| `parked_locked` | **down** | push or phone re-sync: `LOCKED` + `NOT_PRESENT` |
| `in_use` | up | any push that is not the above |
| `unknown` | up | Pi boot, BLE link loss, decode failure, watcher crash |

## Architecture

### Pi — `airgapp-rpi`

**`internal/services/lockwatch.go`** (new) — a supervisor goroutine that:

- ensures a BLE session exists, and calls the existing `Subscribe(id)` on it;
- protobuf-decodes each unsolicited frame to `FromVCSECMessage.vehicleStatus`,
  reading `vehicleLockState` and `userPresence`;
- evaluates the predicate and drives the AP (Phase 2 only);
- on preemption by a phone `Open`, re-subscribes to the phone's session; when that
  session is reaped, opens its own.

Requires one small addition to `BLESessionService`: a `CurrentSession()` accessor, so
the watcher can attach to whatever session is live rather than fighting
`preemptExisting` for ownership.

**`HotspotService.SetEnabled(bool)`** (new) — `systemctl stop|start hostapd` via the
`Executor`. Deliberately separate from `Apply()`, which rewrites config and restarts.
Debounced ~2 s so a burst of pushes cannot thrash the radio.

**`POST /api/ble/lock-state`** (new) — bearer-auth'd, same middleware as the rest of
`/api/ble`. Body carries lock state, presence, and a source tag. Feeds the same
evaluator as a BLE push.

**Pi UI** — current lock/presence state, AP up/down, age of last push, and a
three-way override: `auto` / `force-on` / `force-off`. Not optional: this feature
silently removes the car's internet, so its state must be visible and defeatable
without SSH.

### Phone — `airgapp/mobile`

One hook in `src/state/useCarLink.ts`, at the point where an authoritative
`lockState` already lands from either the push or the 20 s VCSEC poll: fire-and-forget
a POST to the Pi through the existing `PiClient` in `src/ble/transport.ts`. Deduped on
change. Failures are ignored — this is a best-effort re-sync, never a command path.

## Phases

### Phase 1 — observe-only

Everything above **except** any call to `SetEnabled`. The watcher connects, decodes,
logs, and displays. It cannot take the AP down.

Run for two to three nights. This single deployment answers:

- **G5 — what does the standing BLE connection itself cost?** SoC drop with the
  connection held and no other change. This number cannot be recovered later if
  Phase 1 and Phase 2 ship together.
- **G1 — do pushes arrive on an *idle* connection?** Today the Pi only observes
  frames during phone-driven sessions. If they do not arrive when idle, the whole
  design fails here, cheaply.
- **G3 — does a key-card unlock produce a push?** Tap the card once and read the log.
  Expected yes (VCSEC pushes on state change regardless of cause), but this is the
  claim the "card fallback" was declared unnecessary on, so it gets verified rather
  than assumed.
- **G2 (informational)** — what the car reports while driving.

### Phase 2 — enforcement

Wire the evaluator to `SetEnabled`, add both safety valves, add the approach
optimisation. Ships against a signal already watched for three days.

## Safety valves

With the AP down and the car's LTE dead, a wedged watcher means an offline car — and
a Pi reachable only over Tailscale.

1. **Fail open on `unknown`.** Boot, BLE loss, decode failure → AP up. A crashed or
   confused watcher degrades to today's behaviour.
2. **Max-down watchdog.** The AP never stays down longer than a ceiling (start at
   12 h). It comes back up, re-syncs, and re-blocks if the car really is still
   locked. This is what covers a *confidently wrong* `parked_locked`, which valve 1
   does not.

## Rejoin latency

Radio-off costs ~10–30 s of scan → assoc → DHCP after unlock, exactly when you are
getting in and want maps.

Mitigation: bring the AP up on **any** push that is not "still locked and still
absent" — approach, presence, closure — not only the lock transition itself. Per
`docs/superpowers/research/RESPONSE-passive-entry-challenge-protocol.md` the car emits
challenge frames at ~1 Hz on approach, several seconds before the unlock lands, on the
same notify channel the watcher is already subscribed to. That converts most of the
rejoin window into head start.

Gated on the Pi actually observing those frames — confirm in Phase 1.

## What this does *not* guarantee

**Not 100% correct, and it cannot be**, for a structural reason:

- the push is edge-triggered with no heartbeat (context §4), and
- the Pi holds no keys, so it cannot send `GET_STATUS` to re-read the truth.

If the BLE link blips across a lock transition, the Pi's view is stale and nothing
self-corrects until the next transition. The phone re-sync narrows this; it does not
close it.

What *is* guaranteed is the **direction** of every failure. Fail-open plus the
watchdog means a wrong state always costs some traffic and some battery, never a car
that cannot reach the network. That one-directional bound is the real guarantee on
offer, and it is the one worth having.

Closing the gap fully would require enrolling the Pi as its own key so it could poll —
rejected, because it breaks the "Pi never holds keys" property the whole architecture
is built on and parks an unlock-capable key permanently inside the car.

## Success metric

**G0 — drain delta.** The app already polls SoC over BLE. Log it across a baseline
week and a feature week with comparable parking. If drain does not move, the traffic
was a *symptom* of the car being awake for other reasons (Sentry, cabin overheat,
scheduled preconditioning, charging) rather than a *cause* — and the honest outcome is
deleting the feature, not keeping it.

Note for calibration: a Pi 4 draws roughly 4 W continuously, on the order of 100 Wh/day.
That is a real fraction of typical Tesla vampire drain, and it is possible the Pi's own
load dominates whatever this recovers. Phase 1 measures both numbers.

**G4 — rejoin behaviour.** Does the car re-associate reliably when the AP returns, and
how long does it take? Measured in Phase 2.

## Testing

- Table-driven Go tests over all four `VehicleLockState_E` values × presence values ×
  unknown/garbage input, asserting the predicate.
- Fake `conn` driving the watcher through preempt / reap / reconnect / frame-decode
  failure, asserting fail-open at every transition.
- Fake `Executor` asserting `stop`/`start hostapd` calls, debounce coalescing, and the
  watchdog ceiling.
- Existing `tesla_session_test.go` covers the pump and fan-out already.
- On-car: gates G0–G5 above.
