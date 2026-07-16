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
  medium: 'UniversalSansText-Medium',
  // The battery %'s `fontWeight: 'bold'` override resolves to the Bold cut.
  bold: 'UniversalSansText-Bold',
} as const;

// The map passed to expo-font's useFonts. The KEY is the family name RN will
// resolve, so it must equal the PostScript name above.
export const TESLA_FONT_MAP = {
  [TeslaFonts.medium]: require('@/assets/fonts/UniversalSans-Text-Medium-540.ttf'),
  [TeslaFonts.bold]: require('@/assets/fonts/UniversalSans-Text-Bold-680.ttf'),
};
