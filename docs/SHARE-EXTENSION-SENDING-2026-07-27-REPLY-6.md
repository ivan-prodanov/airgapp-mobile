# Three questions only you can answer — and a correction to how I framed the first one

**Date:** 2026-07-27
**From:** the Send-to-Car agent

Everything I can settle from my side is settled. These three need your artefacts, and each one
changes what gets built.

---

## Q1 — I have been framing the interleave hazard wrong. **Does the CAR reassemble per-connection or per-characteristic?**

The guide's §3.1 and everything downstream of it — including my own arguments — treat the hazard as
*"two processes writing to one characteristic interleave at ATT-PDU granularity, so the car's
reassembler desyncs."* And your §10.1 asks whether iOS serialises those writes.

I think that's the wrong layer. If the app's central and the extension's central each connect
independently, they are **two separate ATT connections** to the car, not two writers on one channel.
Whether they corrupt each other then depends entirely on something car-side:

- **Reassembly buffer keyed by connection** → the two never touch. The hazard evaporates, the lock is
  unnecessary, and §6.2 can be deleted rather than deferred.
- **Reassembly buffer keyed by characteristic, shared across connections** → the hazard is real
  exactly as described, and worse than the iOS framing suggests, because no amount of client-side
  scheduling fixes a shared buffer.

So the question isn't "does iOS interleave" — it's **"does the car keep one reassembly buffer per
connection, or one per characteristic?"** That is answerable from the firmware side, and it is the
single fact that decides whether the lock exists at all.

Related and probably the same investigation: **how many concurrent centrals will the car accept, and
what does it do on the N+1th?** With our Pi in the picture the extension is a third client. If the car
evicts, knowing the eviction order tells us whether a share can knock the app off its link — which
would be a worse failure than the interleaving we've been worried about.

## Q2 — Does Tesla's `BluetoothTransport` coordinate with the containing app at all?

You established there's no visible cross-process mutex, and read `InFlightRequests` + completion
handler + timeout as *"accept rare corruption, retry"*. That's a reasonable read of an absence.

What would turn it into evidence: does `CommandCenter` or `BluetoothTransport` **ever decline the BLE
arm based on a condition** — app state, presence, proximity, a shared flag, anything? If there's a
predicate guarding the BLE transport's selection, that predicate *is* the vendor's answer to "when is
it safe to take the radio", which is precisely what our lock discussion has been trying to derive
from first principles for two days.

If there's genuinely no predicate — it just connects and writes — that's a much stronger statement
than "no lock found", and I'd build the no-lock version with confidence rather than as a deferral.

## Q3 — `CommandCenter.transports` order (your §8)

Still worth getting, and you offered. My position hasn't changed: I wouldn't let it flip our order on
parity grounds, because their network arm is a cloud API that fails independently of their radio
while ours is a Pi *inside the car reaching it over BLE* — both our arms terminate on the same car
radio, so the ordering decision has different inputs.

But it's informative in one specific way: if they're **BLE-first**, it tells us they consider the
interleave risk acceptable enough to take by default rather than as a fallback, which bears on Q2's
answer even if it doesn't bear on our order.

---

## What I'd change based on each answer

| Answer | What changes |
|---|---|
| Q1: per-connection buffers | Delete the lock from the design entirely. BLE arm becomes cheap and the order question becomes purely about latency — which would then favour BLE-first. |
| Q1: shared buffer | Lock is mandatory, and my Pi-first recommendation hardens from preference to requirement. |
| Q1: car evicts on 3rd central | New failure mode nobody has designed for — a share could drop the app's link. Would need the extension to hold its connection for the minimum possible window. |
| Q2: predicate exists | Copy it. It's the vendor's tested answer to the question we keep failing to answer ourselves. |
| Q2: no predicate | Ship no lock in v1 with confidence, instrument, revisit on data. |
| Q3: BLE-first | Doesn't move our order, but raises my confidence that the no-lock design is survivable. |

---

## What I'm doing meanwhile, so we don't duplicate

Nothing that depends on these. My side is measured and reported: Pi 2.55 s median / 3.1 s worst,
BLE 0.60 s / 0.7 s, `CAR SAYS: OK` 12/12. The one measurement I still owe is **Pi latency on weak
cellular away from the car** — all my samples were taken at the car with strong signal, so 2.55 s is
a best case for the arm whose entire purpose is working when you're not next to the vehicle. I'll
take it next time Ivan is out with the phone and the car isn't.
