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
  // WEIGHT 400. The Typography ladder is not one face: the 40/46 display tier
  // carries `fontWeight: '400'` explicitly (against the 64/77 tier's '500'), and
  // the Body/Caption tiers carry `type: 'Regular'`. We shipped only Medium and
  // Bold, so every one of those rendered a step too heavy — which is exactly
  // what Ivan saw on the climate setpoint ("certainly not as bold").
  //
  // The file was already in the repo, extracted with the others, and simply
  // never bundled.
  regular: 'UniversalSansText-Regular',
  // WEIGHT 300. The climate setpoint ("20.0"). Ivan reported it as too bold
  // THREE times; each time I re-derived it from the Typography ladder's 40/46
  // display tier and re-confirmed "Medium". The ladder was never involved: the
  // climate screen has its OWN `temperatureText` style (@5221355) that bypasses
  // getFontStyle entirely --
  //
  //   { fontFamily: getUniversalSansFontFamily('Light'), fontSize: 40,
  //     fontWeight: '300', lineHeight: 4*Gutter = 40, paddingTop: Gutter = 10 }
  //
  // A screen-local style, not a category. Reading the ladder harder was never
  // going to find it, which is the lesson: when the user keeps reporting the
  // same delta, the assumption to question is WHICH style object applies, not
  // the value inside the one already being read.
  light: 'UniversalSansText-Light',
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
  [TeslaFonts.regular]: require('@/assets/fonts/UniversalSans-Text-Regular-430.ttf'),
  [TeslaFonts.light]: require('@/assets/fonts/UniversalSans-Text-Light-230.ttf'),
  [TeslaFonts.bold]: require('@/assets/fonts/UniversalSans-Text-Bold-680.ttf'),
};
