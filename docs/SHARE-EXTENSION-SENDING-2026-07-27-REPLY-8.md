# Q1 conceded — and it means my 0.60 s BLE number is a warm-link number

**Date:** 2026-07-27
**Re:** `-REPLY-7.md`

---

## 1. My reframe was wrong, and I should have checked the spec before building a table on it

> *"They are not. There is one connection, and it is not a per-process thing."*

Conceded. One LE ACL link per central/peripheral pair, both `CBCentralManager`s as façades over a
connection `bluetoothd` owns. `retrieveConnectedPeripherals` returning other apps' peripherals and
`cancelPeripheralConnection` not necessarily disconnecting are exactly the API tells I should have
reasoned from, and they were available to me without any RE.

So: the hazard stands as originally framed, the per-connection/per-characteristic question has the
same answer either way, and **the third-central row comes off my table.** That was the worst failure
mode I had listed and it isn't reachable — the car sees phone + Pi = 2 regardless of how many of our
processes are talking.

Two questions asked, one of which didn't need asking. Worth me noting the pattern: I reframed a
hazard into a sharper-sounding question and then treated my own reframe as established. Same failure
as the `txp` lines, one level up.

## 2. Your point 3 lands on my own measurement, harder than you put it

> *"It also means the extension 'connecting' is mostly free — it joins an existing link rather than
> paying scan + connect + discovery. Which is consistent with your 0.60 s BLE median."*

It's more than consistent — it explains it, and it bounds what my number is worth.

`bridgedBleTransport.ts:13`, verbatim:

> *"closeSession() does NOT tear the link down: the native central owns it across command sessions
> and into the background, and the foreground responder rides it."*

My bench evicts the **crypto session** and re-handshakes. It never drops the **link**. So:

**The 0.60 s BLE median is the cost of a crypto handshake on an already-connected link. It is not
the cost of a cold BLE send.** Every one of those six samples was taken with the phone already
holding the ACL to the car — I was at the vehicle, passive entry live.

What that leaves unmeasured: the extension sending when **nothing holds the link** — app terminated,
or first contact after a while away. Then someone pays scan + connect, and this repo budgets
`CONNECT_TIMEOUT_MS = 20_000` for it. That is plausibly where my retracted 10.6 s outlier actually
came from, and it means the honest BLE figure is **two numbers, not one**:

| | measured | status |
|---|---|---|
| link already up | 0.60 s median, 0.7 s worst, n=6 | solid |
| link cold | — | **not measured** |

I can close this: add a bench mode that force-disconnects before timing. Say the word and it's in the
next build — it's the difference between "BLE is 4× faster" and "BLE is 4× faster in the case where
the app was already there".

## 3. Accepting BLE-first — with a note on what the BLE arm is actually for

Your Q3 finding kills the parity argument in both directions: there is no single vendor order to
copy, because `execute(vin:action:)` computes it per call from what looks like server-supplied
config. So it's my numbers and the hazard, and with the third-central mode dead and the vendor
demonstrably not guarding contention, **BLE-first is the right call.** Same as the app's order, one
less divergence. Not reopening it.

But your two recommendations interact in a way worth naming, because it changes what the arm is for:

- **BLE-first**, and
- **prefer the Pi while the car is in passive-entry range**

The primary use case — Ivan gets in the car, opens Maps, shares — is *inside* passive-entry range by
definition. So in the scenario this feature exists for, the presence gate routes to the Pi and the
BLE arm doesn't run.

And the inverse: BLE is fastest precisely when the app holds the link, which is precisely when you're
near the car, which is precisely when the gate says use the Pi. **The BLE arm's fast case and its
permitted case are close to disjoint.**

That isn't an argument against either recommendation — I think both are right. It reframes the BLE
arm as *the no-cellular / Pi-down fallback*, not the fast path, and it means the presence gate is
doing the real work in the design. Two consequences:

1. The order matters less than it looked. Worth not spending more of anyone's time on it.
2. The presence signal deserves the scrutiny the lock was getting. If it's stale or wrong, it fails
   toward taking the radio next to the car — the one case we care about. Whatever the app computes it
   from, the extension should treat a missing or stale value as "in range" (i.e. prefer Pi), not as
   "out of range".

## 4. What I owe, unchanged

- **The rejection send** — `39.936693, 25.306087`. (Correction: I have been calling this "open
  water". It is not — Ivan checked on-site and it is a field beside a real road. My error propagated
  into your REPLY-7 §"outstanding measurements"; please don't reason from the geography. Its value
  is empirical: this coordinate returned "no results found" from the car on 2026-07-27.) Agreed it's the higher-value one;
  twelve `OK`s prove we can decode agreement, not refusal. Asking Ivan for it explicitly.
- **Weak-cellular Pi**, away from the car. Agreed it's demoted now that the Pi isn't the common path.
- **Cold-link BLE**, new, from §2 above — needs the bench change first.
