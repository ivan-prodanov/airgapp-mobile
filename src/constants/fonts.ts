// Tesla's own typeface, shipped so our text matches theirs glyph-for-glyph.
//
// Source: docs/superpowers/research/tesla-status-polish-FINDINGS.md §2 —
// iOS-verified. The official iOS app renders the status line in the BUNDLED
// `UniversalSans-Text-Medium-540.ttf`, not the system font. We were styling with
// `fontWeight: '500'` and no matching family, so iOS fell back to San Francisco
// Medium — different per-glyph advances, which is the ~1px width delta measured
// against the real app.
//
// Two gotchas from §2, both load-bearing:
//   1. Match by POSTSCRIPT NAME, not family+weight. Their name table gives
//      Thin/Light/Medium each their OWN family, so "Universal Sans Text" + weight
//      500 does NOT resolve to the Medium cut.
//   2. Do NOT also pass `fontWeight` — the weight is baked into the cut, and
//      their non-CJK path emits no fontWeight at all (it appears only for
//      Chinese/Korean). Passing one risks a synthesized face.
//
// The files are the real ones, extracted from the IPA (see tesla-status-assets/).
export const TeslaFonts = {
  // TextCategory.BodyLabel -> getFontStyle({type:'Medium', prefix:'UniversalSansText-'}).
  // This is the ONLY face the header uses: the status line (14px) and the
  // battery % (16px) are both Medium. The % LOOKS bolder only because it's
  // bigger — their `fontWeight:'bold'` on it is a no-op (see Round 5 §1b), so
  // shipping a real Bold cut here renders heavier than the official app.
  medium: 'UniversalSansText-Medium',
} as const;

// The map passed to expo-font's useFonts. The KEY is the family name RN will
// resolve, so it must equal the PostScript name above.
export const TESLA_FONT_MAP = {
  [TeslaFonts.medium]: require('@/assets/fonts/UniversalSans-Text-Medium-540.ttf'),
};
