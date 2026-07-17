# RESEARCH BRIEF #8 — The Climate sheet's geometry (and: does anything scale the car per-view?)

**You are the research agent.** Rounds 1–7 are the base. **Round 7 was excellent and unblocked us**: Controls now renders as an **exact copy** of the real app on-device (their `{top:0, height: SCREEN_HEIGHT−20}` → scale 0.9765 — my screenshot-derived guess of 1.0 was the +2.4% the user saw), and your `sheetHeight = 20` literal was the thing nobody could find by looking for sheet logic. Method rules stay:

- **VERBATIM dumps, not summaries.** **Tag every fact** `[iOS-verified]` / `[both-match]` / `[differ]` / `[Android-only]`. We ship iOS.

**Deliverable:** `docs/superpowers/research/tesla-climate-sheet-FINDINGS.md`. This is a **short, targeted** round — two questions.

---

## Status: everything on Climate's renderer side matches, yet it still looks wrong

We now send Climate exactly as R7 §2 resolved it, and our maths equals your §4 calibration table to 4 decimals on all three screens:

| screen | top | height | scale | center_y | on device |
|---|---|---|---|---|---|
| Home (PARKED) | 119 | 355 | 0.4167 | 296.5 | ✅ exact |
| Controls (TOP_DOWN) | 0 | 832 | 0.9765 | 416.0 | ✅ **exact copy** |
| Climate (CLIMATE) | 59 | 553 | 0.6491 | 335.5 | ❌ still off |

Same `buildFrame`, same Godot handler, same `keep_aspect: KEEP_HEIGHT`, same pose source. Two of the three are confirmed pixel-exact by eye. **So Climate's frame geometry cannot be wrong** — if it were, the other two would be too.

**User's report on Climate (device, verbatim):** *"the sheet is smaller"*; *"the car bottom I think starts at the same position but the front is off, ours shows more hood"*; *"the positions of the mirrors are slightly inward (to the center) compared to the tesla app — the entire car, not just the mirrors."*

---

## §1. The Climate sheet — exact geometry `[primary]`

**Our hypothesis, from YOUR literals — please confirm or kill it.** R7 §2a dumped their Climate frame as:

```
height = SCREEN_HEIGHT − statusBarOffset − 320 + 80      // literals 320 (iOS 5222040), 80 (iOS 5222043)
```

If **320 is their Climate sheet's collapsed height**, then on a 393×852/59 phone:
- car band = `59 .. 612`, their sheet top = `852 − 320 = 532`
- ⇒ the car band runs **exactly 80pt BEHIND the sheet** — i.e. **the sheet occludes the bottom 80pt of the car**, and the `+80` in their own formula is that overlap.

Ours: sheet = `useWindowDimensions().height * 0.25` = **213pt**, top at 639 ⇒ a **27pt empty gap** below the car and **nothing occluded** — which would explain "ours shows more hood" with **no change in car size**.

Please give us, verbatim:
1. **The Climate sheet component's geometry**: its **collapsed/peek height**, its **expanded height**, and all **snap points**. Resolve every constant to a number on a 393×852 phone, with names + cite.
2. **Is the `320` in the frame formula the sheet's height?** If not, what is it, and what IS the sheet's height? (If the two are unrelated, say so plainly — that kills our theory and is just as valuable.)
3. **Is the `+80` an intentional car-band/sheet overlap** (car renders behind the sheet), or does it mean something else?
4. Is the sheet **opaque** over the renderer, or translucent/blurred? Its background colour/material. (If the car is meant to be visible through it, the occlusion theory changes.)
5. Sheet **corner radius, grabber, and its top inset** — enough for us to match the panel itself, since the user wants it fixed first.
6. Does the frame get **re-sent when the sheet is dragged** (i.e. is the car band dynamic with the sheet position), or is it static at the collapsed geometry?

## §2. Does ANYTHING scale the car on the CLIMATE path specifically?

The user is confident the car is **uniformly smaller** (mirrors inward — a horizontal measurement a sheet cannot explain). Our frame, pose (`rotation [0,0,0]`, `offset [0,6,0.6]`, `cam_fov 40`), `keep_aspect` and env for CLIMATE are byte-identical to yours, and the same code path renders Home/Controls exactly. So if the car really is ~2–3% narrower **only on Climate**, something outside the frame/pose is doing it.

1. Does the CLIMATE path apply any **`vehicle_scale` / Slot / ProductSwitcher / root transform** that Home and Controls don't? (R6 §3: `get_vehicle_scale()` defaults 1.1 — is it ever **per-view**?)
2. Does their Climate send any **extra renderer message** we don't know about — e.g. `UPDATE_PRODUCT` with a different `mobile_app_state`, a seat/interior mode, a "fade roof"/cutaway flag — that changes the model or camera? We send `fadeRoof: true` on Climate; **is there an official equivalent, and does it affect scale?**
3. Is `cam_fov 40` on CLIMATE ever overridden at runtime for a Model 3/Y (e.g. by seat-count, interior variant, or a Climate sub-view)?
4. **If the answer to all of the above is "no"** — say so plainly. Then the sheet-occlusion theory (§1) is the whole story and we'll stop looking for a scale bug.

## §3. Low priority — transition speed

The user: *"switching to/from Controls … now looks **slightly faster** than the Tesla app"* (we send your 0.5s / TRANS_QUART / EASE_OUT on camera+env+frame, per R7 §5.3, which found no per-transition overrides).
1. Re-confirm there is **no** per-transition duration override on the Home↔Controls path.
2. Does their **route/screen push** (RN navigator) have its own duration that runs alongside, so the *perceived* motion is longer than the 0.5s camera tween? If so, give that duration/curve.

---

## Output format
1. **Climate sheet** — verbatim geometry, snap points, resolved numbers; the 320/+80 question answered yes or no.
2. **Per-view car scaling** — yes/no, with what.
3. **Transition** — override? navigator duration?
4. **Citations**; **iOS-verified vs Android-only** per fact. **Gaps**, plainly.
