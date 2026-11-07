# Reconnect latency / relay "flap" — UNSOLVED handoff

**Date:** 2026-11-07
**Status:** Fixed and verified on the car 2026-11-07: 3.4s and 3.6s from Connect to the first result across two real token replacements, with no evictions (was 43-51s). Several earlier attempts were made and **reverted** (see "Attempts that were reverted"). The rest of this doc is the original handoff and is wrong in the places listed here, so read this first.
**Repos:** `mobile` (Expo/RN, branch `feat/ble-carlink`) + `rpi` (`netfilterd`, branch `feat/containment-sni-mac`).

## Correction: what was actually wrong

**Causes A and B below are wrong, and D is missing its main trigger.**

- **Cause A is backwards.** BLE is not probed first. `preferred()` returns `pi` while the native link is down, so each 6s BLE wait came *after* a Pi failure, as the fallback.
- **Cause B has the wrong trigger.** After the 504 at 05:21:39.808, three more exchanges succeeded before the eviction at 05:21:40.760, and a real 504 only evicts one domain anyway.
- **Cause D's main trigger is `lockwatch`,** which this doc never mentions.

The real causes, stacked:

1. **Phone: nothing stopped the old generation.** `reload()` swapped the gateway, but the session cache and queue are per-process and nothing stopped running retry loops. The old loop held the queue for ~12s, then found the new generation's cached session, called its own dead selector, got `no active transport`, classified that as `unreachable` and evicted the working session. Log signature: `reason=unreachable` 2-5ms after an OK exchange, with no failing `exchange` line.
2. **Pi: `lockwatch` raced the phone for the adapter.** It opened its own session 10s after any session closed. A phone Open during that scan had nothing to preempt, then blocked on a lock that ignored its context. All nine POSTs of 29s or more that day started 1-4s before a `lockwatch` open, the worst 1m51s. The phone's 12s stall lands right on `lockwatch`'s 10s timer plus its ~2s scan, which is why it reproduced 3/3.
3. **Phone: errors lost their meaning.** The selector's `all transports failed` error dropped `kind:'auth'`, and its text contains "BLE connection closed", so a 401 read as a dead link and was retried.

The fixes:

- **Phone:** each gateway has a `lifetime` signal, retired by `retireGeneration` in `useCarLink` (see `src/ble/gateway.ts`, `src/ble/cancelled.ts`). The selector throws typed errors. The BLE wait is skipped unless the phone could not reach the relay at all (`bleWaitBudgetMs`). A link coming up triggers a poll.
- **Pi:** `lockwatch` only observes, so it never opens a session or keeps one alive. The adapter lock is cancellable (`bleLock`). A new Open also cancels one still in flight. Removing a token closes its sessions (`CloseForToken`).

Regression test: `src/ble/generation.test.ts`.

Measured after the fix (08:30-08:42 UTC, about 12 minutes, so a small sample). `lifecycle | reload:` in the phone log is the moment Connect took effect:

| Re-enrol | Connect | First result | Pi open | Evictions |
|---|---|---|---|---|
| Token 37 | 08:39:52.518 | 08:39:56.130, closures read (3.6s) | 1.96s | 0 |
| Token 38 | 08:40:22.430 | 08:40:25.801, `flashLights` (3.4s) | 1.47s | 0 |

The first routine poll landed later (4.9s and 6.0s) because it queued behind the wake commands that follow a re-enrol. Across the whole window: 10 of 10 sessions matched a phone POST, so `lockwatch` opened none. There were no BLE waits of 5s or more, compared with 367 earlier the same day. Both token removals closed the session in the same second.

Follow-up, deployed 2026-11-07 08:55 UTC: after a token is removed, the event stream retried every ~2.5s until the app was backgrounded or re-enrolled, because the 401 left the session cached and `peekPiSessionId` kept returning it. `withCachedSession` now drops the cached sessions on a 401, so the retries stop at the next read that gets one. A successful read brings the session and stream back.

Third re-enrol, after that fix (token 38 removed 09:01:37, Connect 09:01:52.852): first result in 3.1s, one Pi open, no stream retries after the removal, stream back at 09:02:04.015. The one eviction was `reason=cold-start-stale-session`, because a read was in flight when the session closed. That means this run never reached the new 401 eviction (`reason=auth` count 0), so that path is covered by tests but not yet seen on the device.

Still open:

- Fixed and deployed 09:27 UTC, not yet seen on the device: with a token removed, the focused-read loop kept sending a rejected open about every 1.9s (09:01:43-09:01:49) for as long as the app stayed in the foreground. `focusTick` only checked the cached `awake` flag, which a failed poll does not clear. Focused reads now also wait for the main poll to be succeeding (`focusedReadAllowed`).
- `syncStream` runs at the end of `tick`, after the infotainment read, so the stream opened 4s after the first poll succeeded in that run.
- One open at 08:35:20 ran for 5.3s without finishing before a newer open replaced it. Cause unknown; it blocked nothing.

---

## Symptom (user-reported)

After removing a relay user's token on the Pi dashboard and issuing a new one, then re-scanning the enrol QR on the phone, the car takes **~30–45 s to "properly refresh"** — the app keeps showing not-connected while it churns, before it finally stabilises. Same slowness is felt on the in-app **Reconnect** path.

The car and Pi are both healthy the whole time (the Pi answers, the car is awake). This is **latency/robustness**, not a dead link.

## Scenario that triggers it

**Relay path, phone NOT in Bluetooth range of the car.** The phone reaches the car only through the Pi forwarder (`/api/ble` over Tailscale Funnel). Direct phone↔car BLE is unavailable. This is the normal "away from the car" case and the one that flaps.

---

## Evidence (device log, `carlink-log.db`)

Pulled from the phone during an actual re-enrol. Phone timestamps are local; the **Pi clock runs ~2 h behind** so Pi `03:2x` = phone `05:2x`.

Timeline of one re-enrol (phone time):

```
05:21:20  openSession pi  ms:490    ok:false  err:unauthorized          ← old token just deleted
05:21:26  openSession ble ms:6001   ok:false  "native central did not connect within 6000ms"
05:21:34  openSession pi  ms:1958   ok:true                             ← FIRST connect (~14s in)
05:21:35  exchange pi ... wake  (verdict status:none bytes:0)
05:21:39  exchange pi  ms:4300  ok:false  (timeoutMs:4000)              ← one slow/failed read
05:21:40  [ble] evicted all sessions ... reason=unreachable dropped domains:2   ← WHOLE LINK torn down
05:21:41  closeSession pi ok
05:21:44  poll vcsec failed  (command deadline exceeded)
05:21:51  cmd settle flashLights  ms:25005  outcome:timeout            ← a command blocked 25s
05:22:00  openSession pi  ms:20009  ok:false  "fetch canceled"          ← a re-open hung (full budget)
05:22:06  openSession ble ms:6009   ok:false  "within 6000ms"           ← dead-BLE probe AGAIN
05:22:08  openSession pi  ms:1821   ok:true
05:22:12  openSession pi  ms:1959   ok:true                             ← finally stable (~52s total)
```

Key facts visible here:

1. **Direct BLE is probed first on nearly every open and always fails at ~6 s** ("native central did not connect within 6000ms (car asleep/out of range?)"). On the relay path the phone genuinely can't reach the car over BLE, so this 6 s is pure waste, paid on *every* re-open.
2. **A single transient read failure tears down the entire working relay link** (`reason=unreachable`), forcing a full cold re-open (6 s BLE + Pi open) instead of a cheap retry on the same session.
3. **Commands block up to 25 s** (`DEFAULT_COMMAND_DEADLINE_MS`) when the car doesn't answer, freezing the poll and adding to the churn.
4. Each individual Pi op, when it works, is fast (~200–2000 ms). **The Pi is not the bottleneck** — the churn is.

Pi-side journal for the same window (`journalctl -u netfilterd`, Pi clock −2 h) shows sessions opening in ~2 s and a stream of short-lived sessions with `preempting stale session … for a new Open` — i.e. the phone repeatedly opening fresh sessions.

---

## Root cause (code)

Three independent cost centres stack up into the ~45 s. All are in `mobile`, except the Pi-side mutex note.

### A. Dead-BLE probe on every open (`~6 s each`)

`mobile/src/state/useCarLink.ts:835`

```ts
preferred: () => (nativeLinkUpRef.current ? 'ble' : 'pi'),
```

The transport selector (`src/ble/transportSelector.ts`) consults `preferred()` first on **every** open. `nativeLinkUpRef` tracks the **passive-entry BLE link** state (`src/state/useCarLink.ts:1457-1498`, fed by `onPassiveEntryConnectionState`). On the relay path that signal can read **"connected"** while a *fresh command* `openSession` over `BridgedBleTransport` cannot actually reach the car — so `preferred()` returns `'ble'`, the selector probes BLE first, and it dies at ~6 s before falling back to the Pi. Candidate order in `getGateway` is BLE-first (`src/state/useCarLink.ts:748-768`).

The selector is already sticky (`reprobeEvery`, `initialLastGood`) but `preferred()` overrides the stickiness and is re-evaluated every open, so the 6 s is re-paid each time.

### B. Whole-link teardown on a single read hiccup

`mobile/src/ble/gateway.ts`

```ts
// line 273
export function evictScopeFor(kind: string): EvictScope {
  return kind === "timeout" ? "domain" : "link";
}
// line 318-325
function classifyTransportError(...): "unreachable" | "timeout" | "auth" {
  if (kind === "auth") return "auth";
  if (kind === "timeout") return "timeout";
  // 'session-gone' / 'ble' / 'network' / 'http' / no kind → unreachable  ← CATCH-ALL
  return "unreachable";
}
```

`classifyTransportError` maps anything that isn't a clean `timeout`/`auth` to `"unreachable"`, and `evictScopeFor("unreachable")` is **`"link"`** — so one odd read (a `network`/`ble`/`http`/`session-gone` error, or a stale frame) tears down the whole relay session and forces a cold re-open. The eviction block is `src/ble/gateway.ts:459-498`, which **already documents this exact trap** from an earlier incident:

> "…classifyTransportError returns 'unreachable' as its CATCH-ALL … takes down BOTH domains — measured 2026-07-26 19:00: every link-scoped eviction read reason=unreachable, while the link re-opened 2ms later and exchanged at 73ms. It was never unreachable."

So this is a known false-positive teardown that was only partially addressed (stale-frame case) and still fires on transient relay reads.

### C. Long per-op budgets

- `OPEN_SESSION_TIMEOUT_MS = 45_000` — `mobile/src/ble/transport.ts:94`. A single Pi `openSession` that stalls holds for 45 s.
- `DEFAULT_COMMAND_DEADLINE_MS = 25_000` — `mobile/src/ble/gateway.ts:246`. A command that can't reach the car blocks 25 s.
- `POLL_MS = 20_000` — `mobile/src/state/useCarLink.ts:132`. After a failed poll tick the next retry is 20 s away.

### D. Pi-side: `bleMu` held across a ctx-blind scan

`rpi/internal/services/tesla_session.go:162-219` (`BLESessionService.Open`) + `rpi/internal/services/tesla.go` (`AcquireBLEForVIN`, `bleMu.Lock()` ~line 189).

`Open` calls `preemptExisting()` (closes **registered** sessions) then `AcquireBLEForVIN`, which takes `bleMu` with a **plain `Lock()` that ignores ctx** and holds it across the whole BLE scan+connect. `preemptExisting` does **not** interrupt an `Open` already stuck inside `AcquireBLEForVIN` (no session registered yet). So when the phone aborts a hung HTTP `openSession`, the Pi's goroutine keeps scanning and keeps holding `bleMu`, and the next `Open` queues behind it. The header comment (lines 170-181) explains the "newest client wins" preemption but it only covers registered sessions, not in-flight acquires.

---

## Attempts that were reverted (do not just redo blindly)

All in `mobile`, reverted on 2026-11-07 at the user's request after they didn't resolve the felt latency:

1. `OPEN_SESSION_TIMEOUT_MS` 45 s → 20 s. (Capped the single hang but the flap remained.)
2. **Cancellation on token change** — an external `AbortSignal` wired into `PiClient`, aborted by a per-gateway `AbortController` in `reload()`. This *did* help the first connect (45 s → ~14 s) but **does not free the Pi-side `bleMu`** (root cause D), so the flap after first connect was unchanged.
3. **"Connecting" vs "Offline" state + fast-hunt** (`CONNECT_RETRY_MS`/`CONNECT_GRACE_MS`, `hasContactedRef`): cosmetic honesty + 3 s retry before first contact. Didn't change felt latency.
4. **BLE-probe cooldown in the selector** (`preferFailCooldownMs`): after a BLE open fails, stop preferring BLE for 20 s. Targeted cost A directly, but the user still hit ~45 s because B (teardown) kept forcing cold re-opens and the first open still pays one 6 s BLE probe.

Lesson: fixing A **or** C alone leaves the flap because **B keeps re-triggering cold re-opens**, and D means the Pi can stay busy regardless of what the phone does. A durable fix likely needs **B + A together**, and possibly **D**.

---

## Recommended fix order for the next agent

1. **B first (highest leverage):** stop classifying a transient relay read as `unreachable`/link-teardown. A slow Pi read should be a same-session/same-domain retry, not a full link eviction. Scope the change to `classifyTransportError` + the eviction block in `gateway.ts:459-498`; keep `auth` terminal. Verify with a fresh `carlink-log.db` that `reason=unreachable` link evictions stop appearing on transient reads.
2. **A:** don't re-probe direct BLE on every relay re-open. Either gate `preferred()`'s `'ble'` vote on a *recent successful* BLE open (not just "passive link up"), or add the reverted `preferFailCooldownMs` back. Confirm the `"within 6000ms"` BLE failures stop repeating per-open.
3. **C (cheap, optional):** shorten `OPEN_SESSION_TIMEOUT_MS` toward the real cold-open budget (~15–20 s) and consider a shorter first-contact poll cadence.
4. **D (deeper, Pi-side):** make `AcquireBLEForVIN` honour ctx / bound the scan so an aborted/preempted open can't pin `bleMu`. Touches `rpi/internal/services/tesla.go` + `tesla_session.go`.

**Validate every change against a real re-enrol with a fresh log** — do not trust reasoning alone; this issue burned several "obvious" fixes that didn't move the needle.

---

## How to reproduce + diagnose

Device: `Ivan's iPhone` (`F3867E6E-E95F-5B2A-9C4E-06D1D72475A1`), bundle id `local.airgapp.mobile`. Car present on the Pi's Wi-Fi (relay path), phone away from the car's BLE range.

Repro: on the Pi dashboard Remote-access → remove the user → add a new one → scan its QR in the app. Watch the header take ~30–45 s to settle.

Pull the phone log (data is in `-wal`, copy all three):

```bash
DEV=F3867E6E-E95F-5B2A-9C4E-06D1D72475A1
for f in carlink-log.db carlink-log.db-wal carlink-log.db-shm; do
  xcrun devicectl device copy from --device $DEV \
    --domain-type appDataContainer --domain-identifier local.airgapp.mobile \
    --source "Documents/SQLite/$f" --destination "./$f"; done
```

Useful queries (sqlite3):

```sql
-- all openSession attempts with duration + outcome
SELECT datetime(t/1000,'unixepoch','localtime'), substr(data,1,120)
FROM log WHERE cat='txp' AND msg='openSession' ORDER BY t DESC LIMIT 25;

-- failures / evictions / connecting transitions
SELECT datetime(t/1000,'unixepoch','localtime'), level, cat, msg, substr(data,1,90)
FROM log WHERE data LIKE '%"ok":false%' OR msg LIKE '%failed%' OR msg LIKE '%evict%'
ORDER BY t DESC LIMIT 40;
```

Pi side (clock −2 h):

```bash
ssh pi@100.127.251.30 'sudo journalctl -u netfilterd --no-pager -n 4000 | grep -iE "BLE-SESSION|preempt|reaped"'
```

Native BLE + Godot go to the phone's device log, not the SQLite ring: `idevicesyslog` while reproducing.

---

## Constraints (must hold)

- **The car must never reach Tesla's real servers.** Any change to network/transport paths keeps that invariant. The Pi denylist + https guard live in `rpi` and `mobile/src/ble/teslaHostGuard`.
- Diagnose with evidence (a fresh log), never speculation — this issue specifically punished guessing.
- Do **not** `expo prebuild` (clobbers the embedded Godot `ios/`/`android/`).
- rpi: the live filter/session DB is `/var/lib/netfilterd/netfilter.db` (not in git) — back it up before any Pi change.

## Key files

| File | What |
|---|---|
| `mobile/src/ble/gateway.ts` | retry loop, `classifyTransportError` (318), `evictScopeFor` (273), eviction block (459-498), deadlines (246, 271) |
| `mobile/src/ble/transport.ts` | `PiClient`, `OPEN_SESSION_TIMEOUT_MS` (94) |
| `mobile/src/ble/transportSelector.ts` | sticky BLE-first/Pi-fallback selector, `preferred()` hook |
| `mobile/src/ble/bridgedBleTransport.ts` | direct-BLE command transport (the ~6 s connect) |
| `mobile/src/state/useCarLink.ts` | `getGateway` (candidates 748-768), `preferred` (835), `nativeLinkUp` tracking (1457-1498), `POLL_MS` (132), `reload()` |
| `rpi/internal/services/tesla_session.go` | `BLESessionService.Open`/`preemptExisting`/reaper, `bleMu` lifetime |
| `rpi/internal/services/tesla.go` | `AcquireBLEForVIN`, ctx-blind `bleMu.Lock()` |
