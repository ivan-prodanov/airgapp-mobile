// The official app's card transition.
//
// Source: docs/superpowers/research/tesla-transitions-markers-FINDINGS.md §1.
//
// THE MODEL (§1c, "the whole mechanism, assembled"):
//   - Home's CARD stays static at opacity 1 — `forFade` reads only `current`,
//     and for the non-top card `current.progress === 1`. It never fades or
//     slides. (R8 claimed a 118px parallax here; R10 disproved it.)
//   - Home's CONTENT blanks INSTANTLY (`duration = isFocused ? 300 : 0`).
//   - The pushed card (Controls/Climate) fades in OVER it: `forFade` =
//     `{cardStyle: {opacity: current.progress}}`, on the TransitionIOSSpec
//     spring, settling ~479ms.
//   - The pushed screen's CONTENT then fades in on its own 300ms clock once the
//     markers arrive — a second, unsynchronised clock (see useContentFade).
//   - `detachPreviousScreen: false` keeps Home MOUNTED underneath, so the
//     cross-fade has something to composite against.
//
// Popping is the same interpolator running backwards: the pushed card's
// `current.progress` goes 1 -> 0, so IT fades out and reveals Home beneath —
// which is why "everything fades out" when you leave, and why a plain panel swap
// (what we had) can never reproduce it.
//
// TransitionIOSSpec, verbatim (R8 §3 / R11 §1c — note the sheet slide rides this
// exact same curve): a spring with damping 500, stiffness 1000, mass 3.
// zeta = 500 / (2*sqrt(1000*3)) = 4.56 — over-damped, but neither Reanimated nor
// RN's spring has an over-damped branch, so it runs critically damped at
// w0 = sqrt(1000/3) = 18.26 rad/s => ~479ms to the 10/10 rest thresholds.
export const CARD_SPRING = {
  damping: 500,
  stiffness: 1000,
  mass: 3,
  overshootClamping: true,
  restDisplacementThreshold: 10,
  restSpeedThreshold: 10,
  useNativeDriver: true,
} as const;
