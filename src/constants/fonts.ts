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
  // The status line (14px).
  medium: 'UniversalSansText-Medium',
  // The battery % (16px).
  //
  // Tesla's literal for it IS `fontWeight: 'bold'` (R5 §1a), but R5 §1b argued
  // that resolves to nothing in their app: the category hands the Text a
  // fontFamily of 'UniversalSansText-Medium', and the foundry's name table puts
  // Medium in its own single-face family, so `fontWeight` can't reach the Bold
  // cut and iOS won't synthesize one — leaving their % rendering Medium.
  //
  // On device the user reads our % as LESS bold than the status line below it,
  // and asked for them to match. Note §1b's reasoning is INFERRED-strong, not
  // measured ("the native pick wasn't measured on-device") — and §1c of R10 has
  // since proven a "verbatim" finding can be wrong. So we ship the Bold cut,
  // which is what their literal plainly asks for. Device over inference.
  bold: 'UniversalSansText-Bold',
} as const;

// The map passed to expo-font's useFonts. The KEY is the family name RN will
// resolve, so it must equal the PostScript name above.
export const TESLA_FONT_MAP = {
  [TeslaFonts.medium]: require('@/assets/fonts/UniversalSans-Text-Medium-540.ttf'),
  [TeslaFonts.bold]: require('@/assets/fonts/UniversalSans-Text-Bold-680.ttf'),
};
