# VCSEC status pushes go only to authenticated keys — measured on-car

**Date:** 2026-07-27
**Method:** simultaneous capture from two listeners on the same car, same seconds — the Pi's `netfilterd` journal and the phone's `carlink-log.db`.
**Status:** settled. This falsifies the premise of the lock-gated-WiFi spec.

## The claim that was wrong

`docs/superpowers/specs/2026-07-27-lock-gated-wifi-design.md` asserted that a
keyless Raspberry Pi could passively observe the car's lock state, because
unsolicited VCSEC pushes are plaintext:

> a push has no request to bind to, so it arrives as a PLAINTEXT FromVCSECMessage

The plaintext part is true. **"Therefore anyone connected can read them" does not
follow, and is false.** The car does not send state to a listener that has not
proved it holds a key.

## The measurement

Both listeners were connected to the car over BLE during the same visit.

**Phone** (enrolled key, authenticated session) — `carlink-log.db`, cat `push`:

```
14:51:10  vcsec {"locked":false,"closures":{"frontDriverDoor":"open", …}}
14:53:12  vcsec {"locked":false}
14:53:22  vcsec {"locked":true}
```

**Pi** (connected GATT central, no keys) — same minutes, 12:51–12:53 BST = 14:51–14:53 EEST:

```
[BLE-SESSION] preempting stale session … for a new Open
[LOCKWATCH]  detached … 37 frames seen
```

and across a separate 43-minute attachment spanning a full unlock → sit → exit →
lock cycle:

```
[LOCKWATCH] detached after 43m1s — 38 frames: 0 status, 0 activity, 38 undecodable
```

**Zero VehicleStatus frames reached the Pi. Ever.**

## What the car DOES send a keyless listener

Every one of those 38 frames was the same shape, at ~1 Hz, on connect and again
on approach:

```
len=31  from_domain=DOMAIN_BROADCAST  to_domain=DOMAIN_BROADCAST  no modelled payload
UNKNOWN_FIELDS(31B)=1a1d12160a14ea6edd419f3189defe9cc2567e14f3d4d7cdbe331802220101
```

Decoded by hand:

```
1a 1d                     field 3, len 29
   12 16                    field 2, len 22
      0a 14 <20 bytes>        field 1 = 20B
   18 02                    field 3 = 2
   22 01 01                 field 4 = 1B
```

`f3 { f2 { f1 = <20B> }, f3 = 2, f4 = 1B }` — character-for-character the
passive-entry challenge in `RESPONSE-passive-entry-challenge-protocol.md`.

So the car is not ignoring the Pi. It **interrogates** it — "are you a key?" —
about eight times at 1 Hz, gets no answer, and then tells it nothing.

## Why the phone cannot substitute either

The same log settles the fallback. During a visit where the phone was in a
pocket with the app backgrounded (15:15:45 entry → 15:16:38 lock), the phone
logged **no pushes at all**, while the Pi logged challenge frames at 15:16:34.

`useCarLink` tears the transport down on `AppState → background`, so the phone
only receives pushes while foregrounded with a live BLE session.

| Listener | Walk-away lock observed? |
|---|---|
| Pi, keyless | never — car sends it nothing |
| Phone, app foregrounded | yes, but you are standing at the car |
| Phone, pocket / walking away | no — transport torn down |

**Walk-away lock happens *because* the phone left BLE range**, so the phone is
structurally the worst-placed observer of the one event the feature needed.

## Consequences for the lock-gated-WiFi feature

1. **Passive observation by the Pi is impossible** without enrolling the Pi as a
   key — which the architecture forbids, and which would park an unlock-capable
   key permanently inside the car.
2. **`ActivityLease` in `lockgate.go` has never fired and never could.** It was
   designed around these approach frames on the assumption they classify as
   `SignalActivity`. They are `DOMAIN_BROADCAST`, so `DecodeLockSignal` rejects
   them one gate earlier as `SignalNone`. Every test covering the lease passed,
   because they all fed it synthetic vehicle-security frames built from the same
   wrong assumption. **The tests validated the model of the car, not the car.**
3. The remaining candidate design is region-exit (see below), which does not ask
   the car anything.

## Separately measured, and it undercuts the goal itself

**The car drops its WiFi association when it sleeps** — `iw dev wlan0 station
dump` showed no stations while the car held a valid DHCP lease. So while parked
and asleep the AP costs it nothing; it is not connected. The traffic exists when
the car is *awake*, and it is awake for its own reasons (Sentry, charging,
preconditioning, use). That is the "symptom, not cause" outcome flagged in the
original brainstorm, arrived at from a different direction.

## The one unknown left

`modules/expo-passive-entry/ios/CarRegionMonitor.swift` monitors the car's
iBeacon (`74278BDA-B644-4520-8F0C-720EAF059935`, UUID-only) and its own comment
names the open question:

> whether the car emits an iBeacon frame at all, and whether that emission is
> sleep-gated. If `car beacon: ENTERED` never appears in a week of real use, the
> car isn't beaconing

That is unanswerable from `carlink-log.db` today, because nothing in `src/`
subscribes to the module's `log` event — `logExternal` reaches the native
console only. Fixed in the same change as this document.

**Do not design on "the car beacons" until that log shows it.** That is the
mistake this whole document exists to record.
