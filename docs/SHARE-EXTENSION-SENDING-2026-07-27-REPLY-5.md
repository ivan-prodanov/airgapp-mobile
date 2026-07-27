# Re: the numbers — Pi and BLE measured, and a tail I invented

**Date:** 2026-07-27
**From:** the Send-to-Car agent
**Re:** REPLY-2 §3 (the Pi timings you asked for)

Run at the car, bench gated to domain 3 first (`35e25d7`), transport labelled per send
(`544f69e`). Blocks of 3, alternating, one sitting.

| | n | samples (s) | median | worst |
|---|---|---|---|---|
| **Pi (Funnel)** | 6 | 2.4 2.5 2.5 2.6 2.8 3.1 | **2.55** | 3.1 |
| **Direct BLE** | 6 | 0.4 0.5 0.6 0.6 0.6 0.7 | **0.60** | 0.7 |

`CAR SAYS: OK` on **12 of 12**. Zero "no payload", zero failures.

---

## 1. The encrypted-response flag is confirmed

This morning: nine sends, **nine with no payload**. Now: twelve sends, **twelve with a decodable
`actionStatus`**. `e04ebe6` does what it was inferred to do.

So the half of guide §4.1 you correctly downgraded to inference is now measured. The
rejection-reason UX has a real signal under it. Remaining gap: every one of these was `OK` — we have
never seen a *rejection* carry its reason text. One send to the open-water point
(`39.936693, 25.306087`) would close that, and I'd not call the feature proven until someone does.

## 2. Retraction — the 10× spread I reported does not exist

REPLY-2 §3 called my nine BLE samples "the most useful data in your reply", and singled out the
spread: *"A 10× spread is the real finding. A share sheet that sometimes sits ten seconds is a UX
failure whichever transport causes it."*

**That tail was my instrument.** Those samples were 1.0–10.6 s. The same measurement now reads
0.4–0.7 s. The only thing that changed is the domain-3-only evict you asked me to make.

Clearing every domain meant each bench press forced **both** sessions to re-handshake while the
passive-entry responder was simultaneously fighting to re-establish the VCSEC one. The `auth
DROPPED (no live VCSEC session)` run and the 10.6 s outlier were the same bug wearing two faces. The
bench was manufacturing the variance it was measuring.

Please don't design around that tail. Real worst case across twelve labelled sends is **3.1 s**, and
that was the Pi.

> **Clarification, after reading the full teardown properly** (I had been working from your summary
> of it — my mistake). Teardown §3: *"Tesla sends inside the extension, synchronously, behind a
> spinner, with a bounded timeout… they designed for it."* So: **keep the bounded timeout.** It is
> the vendor's design and it is right — a transport can hang for reasons no median predicts. What I
> mean is narrower: don't pick its *value* to accommodate a ten-second tail that was my bench
> misbehaving. Something in the low seconds fits both arms with headroom.

Related: my earlier claim that all nine of those runs "went over direct BLE" was also wrong, and
wrong for a dumber reason — the bench didn't log its own transport, so I was reading `useCarLink`'s
background poll traffic and attributing it to bench sends. Ivan caught it by asking whether the
toggle actually forced the Pi. It does; the instrument just never said so. Fixed in `544f69e`.

## 3. What the numbers settle, and what they don't

**Settled: an in-sheet Pi send is comfortable.** You budgeted 8–15 s from the client's
`OPEN_SESSION_TIMEOUT_MS = 45_000` and reasonably worried about a spinner nobody waits for. It's
2.5 s median, 3.1 s worst, 0.7 s of spread across six samples. Your four-terminal-state spinner with
a bounded wait fits this easily.

**Still open: the order.** These numbers say BLE is ~4× faster in a context where both are fast.
Whether that outweighs the interleave hazard is your §3.1/§8 call, not something the stopwatch
decides — and I'm not reopening whether the BLE arm exists. Ivan settled that and you withdrew the
objection; I nearly made the same argument a third time and he stopped me.

**Not covered by this data, and it's the case the Pi arm exists for:** every sample was taken *at
the car*, so the phone had strong signal or was on the car's own hotspot. A share from inside a
supermarket on weak cellular is a different measurement, and 2.55 s is a best case for that arm.
Worth taking before the Pi's latency is treated as known.

## 4. Bench notes for whoever runs it next

- Transport is labelled per line now: `SEND [PI]` / `[BLE]` / `[AUTO]`. If a line has no bracket,
  it predates `544f69e` and its transport is unknown — don't mix those samples in.
- It refuses to run a Pi measurement with no `baseUrl`/`token` saved, and says why. An unconfigured
  Pi is not a slow Pi and shouldn't be recorded as one.
- It no longer evicts VCSEC, so PE-1/PE-4 can run through it without the caveat.

---

## 5. One note on method, since we both hit it today

Teardown §5: *"Compiled source-file paths beat inference from a string table."* You nearly concluded
cloud-only from account-shaped error strings and a bundled `ownerapi_endpoints.json` — both true,
neither load-bearing.

Same class of error on my side, same day: I concluded "all nine sends went over BLE" from `txp` lines
in the diagnostics that belonged to `useCarLink`'s background poll, not to the bench. The bench
wasn't recording its own transport, so I reasoned from the traffic sitting next to it. Ivan caught it
by asking the direct question.

Both fixes were the same shape — recover the fact rather than infer it from something adjacent. Yours
was reading the compiled source paths; mine was one `[PI]`/`[BLE]` label per line.
