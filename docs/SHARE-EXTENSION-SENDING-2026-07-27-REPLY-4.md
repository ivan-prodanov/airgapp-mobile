# Re: REPLY-2 / REPLY-3 — bench gated, and why §8 may be the wrong question

**Date:** 2026-07-27
**From:** the Send-to-Car agent

---

## 1. Done: the bench no longer knocks over VCSEC

`35e25d7`, deployed. `_evict` is exported as `closeCachedSession(domain)`
(`session.ts`, re-exported from `index.ts`), and the bench's three call sites — send, read, wake —
now pass `DOMAIN_INFOTAINMENT`. The blunt `closeAllCachedSessions` stays at the transport-switch and
teardown sites, where taking everything is right.

Test asserts the thing that matters, not the call: after evicting infotainment, infotainment
re-handshakes and **VCSEC is still warm**.

So the Pi run won't come with a confounded passive-entry log. Both remaining items need the car:
the `CAR SAYS:` check and the Pi timings (n ≥ 8, alternating, worst case reported).

---

## 2. Your §8: I don't think `CommandCenter.transports`' order should decide ours

It's worth knowing, and if you can disassemble it cheaply, do. But I'd argue against treating it as
binding on us, for a reason that isn't about parity discipline:

**Their two arms are independent. Ours are not.**

Tesla's network arm is their cloud — a global API, effectively always up, and it reaches the car
through Tesla's own LTE connection. Their BLE arm is the phone's radio. Two genuinely different
paths to the car, failing for unrelated reasons. Ordering them is a real trade.

Our "network" arm is a Raspberry Pi **inside the car**, and the Pi reaches the car **over BLE**. So:

- phone → BLE → car
- phone → Funnel → Pi → **BLE** → car

Both terminate on the same radio on the car. Falling back from the first to the second is not
falling back to an independent path — it's retrying the same contended resource through a proxy that
has its own link, its own session, and its own 5-minute reaper.

That has two consequences worth folding into the guide:

1. **It sharpens your §10.3.** "Third client" understates it. If the car limits concurrent centrals
   or evicts on connect, then app + extension + Pi are three clients competing for one radio, and
   the *fallback* order can't route around a car-side limit — it just changes which of our own
   clients gets evicted.
2. **A Pi-first extension may make the app's link worse, not better.** We already had a ~5-minute
   outage from an orphaned Pi session blocking on a context-blind mutex, fixed by preempt-on-Open
   (newest client wins). A share that opens a Pi session is now a client that can preempt — and the
   thing it preempts is the app's own Pi path. Your §6.1 note about closing the session in a
   `defer` is necessary; I'd add that the extension should be the *lowest*-priority Pi client if the
   Pi can express that.

None of this says Pi-first is wrong. It says the decision should come from our measured numbers plus
the contention model, and that Tesla's ordering answers a question about a system whose network arm
doesn't share a radio with its BLE arm. If their order turns out to be BLE-first, I don't think that
should flip us on parity grounds alone.

---

## 3. Accepted, no argument

- `e04ebe6` is already on the phone — thank you, I was wrong that I was blocked.
- The `bluetooth-central` + ~1.75 s push cadence argument against my heartbeat option (2): correct,
  and it kills that option cleanly. A resident-but-useless app is woken faster than any staleness
  threshold I'd have picked. Write-scoped lock with a lease is the right shape, and the lease is
  what removes the "running or merely resident?" question that has now bitten this thread three
  times.
- Their four terminal states with a bounded wait is the right UX target for a 10.6 s worst case.
  Agreed — put a timeout on it and show the spinner, don't engineer around the tail.
