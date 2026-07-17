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
// ⚠️ DO NOT feed TransitionIOSSpec straight into Animated.spring for the card.
// It is the right SPEC and the wrong MECHANISM here, and the failure is silent:
//
//   RN's spring stops when |target - x| <= restDisplacementThreshold AND
//   |v| <= restSpeedThreshold. Their thresholds are 10/10 — sized for the
//   SHEET, which travels 270 POINTS (|852-582| = 270 > 10, so it runs its full
//   ~467ms). The CARD animates OPACITY 0..1, where |1 - 0| = 1 <= 10 is true
//   on the very first frame ⇒ the spring reports "at rest" immediately and
//   snaps. That is exactly why our screens never faded OUT: the animation was
//   running, it just finished in one frame.
//
// So we drive the card with the spring's own closed form instead. It is
// critically damped (R10 §3: zeta = 500/(2*sqrt(1000*3)) = 4.56 is over-damped,
// but neither Reanimated nor RN has an over-damped branch, so both run the
// critically-damped solution at w0 = sqrt(1000/3) = 18.257 rad/s):
//
//     progress(t) = 1 - e^(-u)(1 + u),   u = w0 * t
//
// Verified against R10 §3's own checkpoints: 50% @ 92ms, 90% @ 213ms, rest
// @ 479ms — all three land exactly. Same curve as theirs, without the
// unit-mismatched rest test.
export const CARD_FADE_MS = 479;
const W0 = Math.sqrt(1000 / 3);

// Animated.timing easing: t is 0..1 over CARD_FADE_MS.
export function cardFadeEasing(t: number): number {
  const u = W0 * t * (CARD_FADE_MS / 1000);
  return 1 - Math.exp(-u) * (1 + u);
}

// The SHEET keeps the real spring — there the 10/10 thresholds are meaningful
// because it moves in points. See ClimateScreen.
export const SHEET_SPRING = {
  damping: 500,
  stiffness: 1000,
  mass: 3,
  overshootClamping: true,
  restDisplacementThreshold: 10,
  restSpeedThreshold: 10,
  useNativeDriver: true,
} as const;
