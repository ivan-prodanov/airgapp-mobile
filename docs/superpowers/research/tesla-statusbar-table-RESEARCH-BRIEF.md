# RESEARCH BRIEF #9 — `statusBarHeight`: the VERBATIM function (the summary looks flattened)

**You are the research agent.** Rounds 1–8 are the base. **Round 7 §2b cracked the biggest bug of the whole effort** — you documented that Tesla's `statusBarHeight` is a *hardcoded device-identifier lookup*, not the safe-area inset. We were passing `insets.top`; on the target phone (**iPhone18,4**, window **420×912**) the real inset is **68** while Tesla's table says **59**. That 9pt gap made every frame built from it wrong, and it predicted all three screens exactly (Controls 0% — `sbh` absent from its formula; Home 0% — its height is the absolute 355; **Climate −1.5%** — `sbh` is inside its height). Shipped, measured on device, fixed. Thank you.

**This round is one function.** Method rules stand: **VERBATIM, not summarised**; tag `[iOS-verified]` / `[both-match]` / `[differ]`.

**Deliverable:** `docs/superpowers/research/tesla-statusbar-table-FINDINGS.md`

---

## The problem: §2b's list is almost certainly a FLATTENED summary

R7 §2b reads:

> `statusBarHeight` (iOS ~1338500, verbatim device branches): identifiers `iPhone13,1 / iPhone13 / iPhone14,4 / iPhone14,6 / iPhone14 / iPhone15 / iPhone16 / iPhone17 / iPhone18 → 59`; other notch → 47; non-notch → 50.

**That mapping contradicts the devices' actual geometry:**

| identifier | device | real iOS top inset | §2b says |
|---|---|---|---|
| `iPhone14,6` | **iPhone SE 3** | **20** — home button, **no notch at all** | 59 |
| `iPhone13,1` | iPhone 12 mini | **50** | 59 |
| `iPhone14,4` | iPhone 13 mini | **50** | 59 |
| `iPhone14,7` | iPhone 14 | **47** | 59 |
| `iPhone15,2` | iPhone 14 Pro | 59 | 59 ✓ |
| `iPhone17,x` | iPhone 16 | 59 | 59 ✓ |

Tesla shipping a **59pt status bar on a no-notch SE** is not credible. Note also that a `iPhone13` prefix entry makes the `iPhone13,1` entry redundant — unless they return **different values**.

**Our hypothesis:** the function is a **branch chain returning DIFFERENT constants per device**, and the summary collapsed them into the single value 59. i.e. something shaped like:
```
iPhone13,1 -> 50   (12 mini)
iPhone13   -> 47   (12 / 12 Pro / 12 Pro Max)
iPhone14,4 -> 50   (13 mini)
iPhone14,6 -> 20   (SE 3 — no notch)
iPhone14   -> 47   (13 / 14 / Plus)
iPhone15   -> 59   (14 Pro / 15)
iPhone16   -> 59 ; iPhone17 -> 59 ; iPhone18 -> 59
```
That would match every real inset above. **Confirm or refute from the bytecode — do not reason from the device geometry as we just did.**

## What we need

1. **Dump `statusBarHeight` VERBATIM** (iOS ~1338500) — the complete function: every branch, every identifier string, **every return constant**, in order, with the comparison operator used (exact `===`? `startsWith`? `includes`? a regex? a map lookup?). This is the whole round; everything else is secondary.
2. **How is the device identified?** Which API/native module supplies the identifier it compares against (e.g. `react-native-device-info`, a Tesla native module, `Constants`)? What is the exact string format on a modern phone? We read `expo-device`'s `Device.modelId` (`"iPhone18,4"`) — confirm that's the same shape they compare.
3. **The notch predicate — NOT recovered, and we invented a stand-in.** §2b says "other notch → 47; non-notch → 50" but never gives the test that distinguishes them. Our code currently uses `insetTop > 20`, which is **ours, not theirs**. What is their actual condition (a second identifier list? a screen-height check? a native `hasNotch` flag?)?
4. **Fallback for unknown/newer devices**: what does their function return for an identifier it doesn't know (e.g. a future `iPhone19,x`)? A default constant, or does it fall through to the notch test?
5. **Non-phone devices**: iPad / simulator / Mac Catalyst — any branch? (We ship iPhone-only, so this is a nice-to-have.)
6. `[differ]` check: is the Android side really just `0` (R7 §2b), or does `statusBarOffset` differ there too?

## Why it matters

Every renderer frame is built from this number, and **Climate bakes it into its height** (`SCREEN_HEIGHT − statusBarHeight − 240`), so a wrong value silently rescales the car — invisible on Home and Controls, obvious on Climate. It is now the single highest-leverage constant in our renderer, and it's the one place we're knowingly shipping an invented predicate.

Our device (`iPhone18,4` → 59) is fine and verified on-device. This is about **every other iPhone**.

---

## Output format
1. **The verbatim function** — full branch chain, identifiers, return constants, operators.
2. **Identifier source + format.**
3. **The notch predicate** (replacing our invented `insetTop > 20`).
4. **Unknown-device fallback.**
5. **Citations**; **iOS-verified vs Android-only**. **Gaps**, plainly.

If any part won't resolve, say so — we'll keep our fallback and comment it as ours. A documented gap is fine; a flattened summary we mistake for a table is what cost us four turns this time.
