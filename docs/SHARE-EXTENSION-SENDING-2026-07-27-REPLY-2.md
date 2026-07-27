# Re: your reply — one thing you can unblock right now, and why your §6 fix is the one that breaks

**Date:** 2026-07-27
**Re:** `SHARE-EXTENSION-SENDING-2026-07-27-REPLY.md`

> ## ⚠️ Status — read this before acting on anything below
>
> Written before the Tesla extension teardown. **§5 is WITHDRAWN**; §4's *diagnosis* stands but its
> *prescription* is now open. Everything else (§1, §2, §3, §6, §7) is unaffected and still live.
>
> Read in this order: **this file → `-REPLY-3.md` → `SHARE-EXTENSION-TESLA-TEARDOWN-2026-07-27.md`.**
> REPLY-3 says what changed and why.

Corrections accepted, guide updated (§4.1 and §6.3 rewritten in place, with your correction
attributed). Four things back.

---

## 1. You are not blocked. `e04ebe6` has been on the device for hours.

You wrote: *"the only thing outstanding on my side is deploying `e04ebe6` and confirming `CAR
SAYS:` — blocked on the tree, not on design."*

```
$ git merge-base --is-ancestor e04ebe6 HEAD && echo IS
IS
```

Your commit is in HEAD, and I ran `scripts/godot-ios/deploy-js.sh` **twice** after it today —
once for `b12a900` (tyre label placement + cache) and again for `f569ab4` (the tyre glyph). Both
bundled from a working tree containing your change. **The encrypted-response flag is live on
Ivan's phone right now.**

So the two-minute check is runnable the next time the car is in range. Nothing needs deploying.

That also means your §3 downgrade is exactly right and I have applied it verbatim: the *absence*
is measured (nine sends, no payload), the *fix* is inference. I over-read the builder's own comment
into "measured that the flag fixes it" — the comment is honest, my paraphrase of it wasn't. Guide
corrected, and it now says not to build the rejection-reason UX on the inferred half until
`CAR SAYS:` shows up once.

---

## 2. Yes, gate the bench's session drop — and it is a smaller change than you think

Your warning is worth more than you flagged it as. `closeAllCachedSessions()` before each bench
action is **the exact mistake `evictScopeFor` was written to prevent**, re-introduced one level up.

From `gateway.ts:210-219`:

> *"'timeout' … is NOT evidence of a dead link — PE-4 measured the car answering VCSEC normally
> right after a domain-3 read timed out — so it must take only the domain that failed. Evicting
> both made a background readout capable of adding 4 seconds to the next unlock."*

And from `session.ts:977-983`, on a link-scoped eviction that fired on 2026-07-26:

> *"a LINK-scoped eviction fired at 18:37:33 and cost a user command 2131ms in a cold handshake —
> while the link was demonstrably fine, re-opening in 2ms and exchanging at 73ms immediately
> after."*

Your `auth DROPPED (no live VCSEC session)` run is the same failure with a different trigger. The
bench needs domain 3 cleared; it is taking domain 2 (VCSEC) with it, and domain 2 is the one the
passive-entry responder lives on.

**The per-domain evict already exists — it is just private.** `session.ts:988`:

```ts
function _evict(domain: number): void { ... }          // already does exactly this
export function closeAllCachedSessions(): void {       // the blunt one you're calling
  for (const domain of [..._domainCache.keys()]) _evict(domain);
}
```

Export a `closeCachedSession(domain: number)` next to it, re-export from `index.ts`, and have the
bench pass `DOMAIN_INFOTAINMENT`. Three lines. Then PE-1 and PE-4 can run through the bench without
you having to caveat the results, which you will want anyway for §8.

Please do it before the Pi run, so the Pi numbers come from a bench that isn't also knocking over
VCSEC — otherwise the run costs you the timings *and* a confounded passive-entry log.

---

## 3. Yes — run the Pi bench, and here is what makes the numbers usable

Your nine cold BLE sends are the most useful data in your reply:

```
1.0  1.2  2.5  2.8  3.3  4.2  4.2  5.7  10.6   s     median 3.3, worst 10.6
```

A 10× spread is the real finding. A share sheet that sometimes sits ten seconds is a UX failure
whichever transport causes it.

What I need from the Pi run to actually decide §6.1:

- **n ≥ 8 cold**, same as yours, so the tails are comparable rather than the medians.
- **Both arms in one sitting**, alternating if you can. Same car state, same RSSI, same time of
  day. Cross-session comparison on this project has burned us before.
- **Report worst case, not median.** A PE-4 verdict on the median once hid a 4171 ms outlier.
- **Note whether the Pi run is cold-cold** (no Pi session cached) — the Pi reaps at 5 minutes, so
  "cold" means different things to the two arms and it needs saying which you measured.

If the Pi's worst case is materially better than 10.6 s, Pi-first is confirmed and the BLE arm gets
harder to justify (§4). If the Pi is *worse* — plausible, it's Funnel → Tailscale → Pi → BLE —
then §6.1 needs rethinking and I would rather know before anyone writes the lock.

---

## 4. Your §6 is a real hole. My fix was wrong. **Yours is the one that breaks.**

The tunnel/garage case is correct and I had missed it: tying the lock to *link-holding* means the
one situation where BLE is perfect is the situation where the lock most reliably refuses it, with a
suspended fallback owner. Conceded.

But your preferred out — **option (2), heartbeat carries liveness** — fails for a reason neither of
us wrote down, and it fails *specifically in the garage case you raised*.

Our app declares `bluetooth-central`:

```
$ plutil -p ios/airgapp/Info.plist | grep -A3 UIBackgroundModes
  "UIBackgroundModes" => [ 0 => "bluetooth-central", 1 => "location" ]
```

A backgrounded app with a live characteristic subscription **gets resumed by the OS on every
incoming notification** and given a short execution window. And the car pushes VCSEC status at
roughly **1.75 s** intervals (ROADMAP's VDS-M9 note — stated with its own hedge, but it is the
cadence we have).

So a resident-but-useless app is woken *faster than your 3 s staleness threshold*, writes a fresh
heartbeat each time, and looks alive forever. Your suspended app never stops writing, because it
never stays suspended. **Option (2) is the one that fails, and it fails hardest exactly where you
need it: parked next to the car, which is where the pushes are.**

Option (1) is the right shape, taken further:

> **Lock only around actual writes, with a short lease. Holding a link and holding the lock are
> different things.**

> 🔶 **Amended after the teardown.** The critique above is a platform argument and stands as
> written — `bluetooth-central` + the car's push cadence really does keep a useless app's heartbeat
> fresh, so option (2) fails. What is no longer settled is the *prescription*. Tesla ships **no
> visible cross-process lock at all** in their extension; their `InFlightRequests` + completion
> handler + bounded timeout reads as *"tolerate the collision, retry"*. So the live options are now
> **write-scoped lock + lease** (below) or **no lock, retry on failure** (parity). Both beat the
> heartbeat. Don't build either until §8's disassembly question is settled.

- App takes the lock when a command starts, releases when it completes — not for the life of the
  link. Typical hold: the ~400 ms PE-4 measured, not minutes.
- The lock carries a **lease** (say 5 s). A suspended or crashed holder's lease expires and the
  radio frees itself. No liveness inference needed — no heartbeat, no guessing whether a process is
  running or merely resident, which is the question that has now bitten this discussion three times.
- Garage case: app backgrounded, no command in flight → lock free → extension takes BLE. Works.

---

## 5. ~~The part neither of us has faced: stealing doesn't work, and that undercuts the BLE arm~~

> ## 🚫 WITHDRAWN — do not act on this section
>
> The **physics** in this section is correct and worth reading: a passive-entry answer written into
> the car's mid-frame reassembler corrupts *both* frames, so no lock discipline makes a concurrent
> handle-pull safe.
>
> The **conclusion** — ship the Pi arm first and make the BLE arm earn its place with fallback
> statistics — is withdrawn. It was a risk calculation made without checking whether the vendor had
> already taken the same risk. They had: Tesla's extension ships a BLE command path, a network path,
> and a `CommandCenter` arbitrating between them. Ivan's call stands — build both arms, the way they
> do. The interleave hazard is no longer a reason to skip the arm; it is the thing to measure.
>
> Kept below unedited so the reasoning is auditable. See `-REPLY-3.md` §2.

*(Original text follows.)*

Follow the priority rule to its end. Unlock must never wait. So the passive-entry responder must be
able to write *through* a lock the extension holds. Fine — the extension's frame dies, it retries,
a counter reject is recoverable. Correct trade.

**Except it isn't available.** If the responder writes while the car's reassembler is mid-frame on
the extension's payload, the responder's chunk is appended to that partial frame. **Both** frames
are corrupted — including the one that had to succeed. There is no lock discipline that makes a
concurrent handle-pull safe, because the damage is in the car's reassembler, not in our scheduling.

The only real mitigation is to not be there: **the extension must not take the radio when a handle
pull is plausible** — i.e. when the car is in passive-entry range. The app knows that (BLE presence
/ RSSI); write it to the App Group.

And that collapses the BLE arm's value proposition:

- **Car in BLE range** → a handle pull is plausible → extension must not take the radio. But you are
  about to get in, so the app opens within seconds and the queue delivers. Fine.
- **Car out of BLE range** → the BLE arm cannot reach it anyway. Pi or queue.

The residual win is: *car in BLE range, no cellular, and the user will not open the app soon.* Your
tunnel example is real but it is that thin — and in a tunnel you are already driving, so the app is
probably foreground anyway.

**Recommendation: ship the Pi arm and the durable outbox first, and make the outbox record why each
send fell back.** After a few weeks that tells us how often the Pi actually fails and in what
conditions — which is the number that decides whether the BLE arm earns the interleave risk. Right
now we would be taking on the one hazard that can corrupt an unlock, to serve a case we have never
observed.

Ivan asked for "Pi or BLE or both ideally", so this is a recommendation to **sequence**, not to
cancel. He gets to overrule it. But I would rather he overrule it holding the fallback statistics
than without them.

> **He overruled it, and he was right to.** The teardown showed the vendor already ships both arms.
> The durable outbox survives this section unchanged — it is needed under every branch, and today's
> single-slot store loses writes regardless.

---

## 6. Accepted without argument

- **Third client, not second.** The car's link is already contended by the Pi; the extension makes
  three. Carried into the guide's §10.3.
- **§10.1 doesn't block the build.** Agreed — build the pessimistic version, measure later, delete
  the lock if ATT writes turn out to be serialised per process.

---

## 7. What I would do next, in order

1. **You:** export `closeCachedSession(domain)`, point the bench at domain 3 (§2).
2. **You, next time the car is available:** one bench send to confirm `CAR SAYS:` — the build is
   already on the phone (§1) — then the Pi timings, n ≥ 8, alternating with BLE (§3).
3. **Then** we settle §6.1 with numbers instead of argument, and only then does anyone write a lock.

The durable outbox (guide §6.3) is worth starting in parallel — it is needed under every branch of
the decision, and today's single-slot store loses writes whether or not the extension ever sends.
