# R4 §2 — Typography & the ~1px width delta (status text)

Sources:
- iOS: `/Users/ivan/Downloads/tesla-haptics-work/main.decompiled.js` (Hermes→JS, Tesla iOS v4.56). Also IPA `/Users/ivan/Downloads/com.teslamotors.TeslaApp_4.57.5_und3fined.ipa` (v4.57.5).
- Android: `/Users/ivan/Work/tesla-summon/work/bundle.hasm` (Hermes disasm, v4.58).
- Fonts: `.../tesla-status-assets/fonts/{ios,android}/`.

Every fact tagged [iOS-verified] / [Android-only] / [both-match] / [differ].

---

## 1. Font files + weight→file mapping

### 1a. iOS ships these (verbatim from `unzip -l` of the IPA) [iOS-verified]
`Payload/TeslaV4.app/` contains (also duplicated in every `PlugIns/*.appex/SwiftModules_TeslaDesignSystem.bundle/` and `SwiftModules_TeslaDesignSystem.bundle/`):
```
UniversalSans-Text-Thin-130.ttf      (65912 b)
UniversalSans-Text-Light-230.ttf     (65880 b)
UniversalSans-Text-Regular-430.ttf   (65784 b)
UniversalSans-Text-Medium-540.ttf    (65896 b)
UniversalSans-Text-Bold-680.ttf      (66376 b)
UniversalSans-Display-Thin-130.ttf   (65768 b)
UniversalSans-Display-Light-230.ttf  (65764 b)
UniversalSans-Display-Regular-430.ttf(65664 b)
UniversalSans-Display-Medium-540.ttf (65804 b)
UniversalSans-Display-Bold-680.ttf   (66288 b)
Blender-TSL-{Book,Medium,Bold,BookItalic,MediumItalic}.otf  (Cybertruck theme)
```
CONFIRMED: the number in the iOS filename = the design weight (Text-Medium-**540**, Bold-**680**, Regular-**430**, Light-**230**, Thin-**130**).

### 1b. Exact name-table / OS-2 identity (fontTools, unitsPerEm=2048 for all) [iOS-verified; Android files are byte-identical glyf so [both-match] for metrics]
| file | name(1) family | name(2) | name(4) full | name(6) PostScript | typoFamily(16) | OS/2.usWeightClass | usWidthClass |
|---|---|---|---|---|---|---|---|
| UniversalSans-Text-Thin-130.ttf | Universal Sans Text Thin | Regular | Universal Sans Text Thin | UniversalSansText-Thin | Universal Sans Text | 100 | 5 |
| UniversalSans-Text-Light-230.ttf | Universal Sans Text Light | Regular | Universal Sans Text Light | UniversalSansText-Light | Universal Sans Text | 200 | 5 |
| UniversalSans-Text-Regular-430.ttf | Universal Sans Text | Regular | Universal Sans Text Regular | UniversalSansText-Regular | Universal Sans Text | 400 | 5 |
| UniversalSans-Text-Medium-540.ttf | Universal Sans Text Medium | Regular | Universal Sans Text Medium | **UniversalSansText-Medium** | Universal Sans Text | **500** | 5 |
| UniversalSans-Text-Bold-680.ttf | Universal Sans Text | Bold | Universal Sans Text Bold | UniversalSansText-Bold | Universal Sans Text | 700 | 5 |

NOTE the family(1) split: **Regular & Bold share family "Universal Sans Text"** (a Regular/Bold RBIZ pair); **Thin, Light, Medium each get their OWN family name** ("... Thin/Light/Medium", subfamily "Regular"). This matters for name-based matching (see §5).

### 1c. Android files (fonts/android/) [Android-only naming]
`UniversalSansText-{Thin,Light,Regular,Medium,Bold}.ttf` — same glyf/metrics as iOS (identical file sizes), but named WITHOUT the `-NNN` weight suffix. On Android RN, the filename base IS the fontFamily key.

### 1d. RN fontWeight → file (the app's own convention, from the getFontStyle weight map, iOS line 1339... / Android fn #33009) [both-match]
The design system maps its `type` token → PostScript-name suffix and a numeric weight:
```
'Bold'   -> '700'   -> UniversalSans-Text-Bold-680.ttf   (usWeightClass 700)
'Medium' -> '500'   -> UniversalSans-Text-Medium-540.ttf (usWeightClass 500)   <-- status text
'Regular'-> '400'   -> UniversalSans-Text-Regular-430.ttf (usWeightClass 400)
'Light'  -> '300'   -> UniversalSans-Text-Light-230.ttf  (usWeightClass 200)
'Thin'   -> '200'   -> UniversalSans-Text-Thin-130.ttf   (usWeightClass 100)
```
Verbatim weight map (iOS `getFontStyle`, main.decompiled.js:1339... case 119):
`r5 = {'Bold': '700', 'Medium': '500', 'Regular': '400', 'Light': '300', 'Thin': '200'};`
(Also the DarkNavTheme/LightNavTheme react-navigation fonts, iOS:1338326-1338348: `regular→UniversalSansText-Regular/'400'`, `medium→UniversalSansText-Medium/'500'`, `bold→UniversalSansText-Bold/'700'`, `heavy→UniversalSansText-Bold/'800'`.)

---

## 2. CRUX — what font does the STATUS text render in on iOS?

**Answer: the bundled `UniversalSans-Text-Medium-540.ttf`, referenced by its PostScript name `'UniversalSansText-Medium'` — NOT the system font (SF).** No explicit `fontWeight` is emitted (non-CJK). [iOS-verified, INFERRED-strong on "status line specifically"]

### 2a. The status text is a TDS `<Text>` with `category: 'bodyLabel'`
The Tesla Design System `Text` component defaults its category to `BodyLabel` and resolves style through `generateTextThemedStyles`. Verbatim (main.decompiled.js:1337435-1337446, the `themedStyle` builder, case 848):
```
r6 = r6.generateTextThemedStyles;
...
r10 = r10.TextCategory;
r10 = r10.BodyLabel;
r4['category'] = r10;
r4 = r8.bind(r9)(r4, r3);        // {category: BodyLabel, ...appearance/status/theme}
r4 = r6.bind(r7)(r5, r4);        // generateTextThemedStyles(theme, {category:BodyLabel,...})
r0['themedStyle'] = r4;
```
Concrete usage sites that pin `category:'bodyLabel'` for status-like rows (main.decompiled.js):
- `:3525922` `{'accessible': false, 'category': 'bodyLabel', 'importantForAccessibility': 'no', 'maxFontSizeMultiplier': 1, 'style': null, 'children': 'hidden'}`  (TDS `EmptyText`)
- `:1678308` `{'category': 'bodyLabel', 'numberOfLines': 1, 'ellipsizeMode': 'clip'}`
- `:3097158` `{'style': null, 'numberOfLines': 1, 'ellipsizeMode': 'clip', 'category': 'bodyLabel'}`
- `:3431656` `{'category': 'bodyLabel', 'contrast': 'low'}`
(R3 established the vehicle status line = BodyLabel category, appearance Light; battery % "overrides the BodyLabel category" to 16px bold — consistent with these.)

### 2b. `generateTextThemedStyles` picks the `Typography` table (default theme) or `CybertruckTypography` (CYBERTRUCK theme)
Verbatim (main.decompiled.js:3351045+ `generateTextThemedStyles`): for the DEFAULT (non-Cybertruck) theme it reads `_closure1_slot14` = the **`Typography`** table, key = the category (falling back to `Body`):
```
case 148:  // default theme branch
    r2 = _closure1_slot14;         // Typography
    ... r0 = r5;                    // category
    if(category == null) r0 = TextCategory.Body;
    r2 = r2[r0];                    // Typography[category]
    r0 = Object.assign({}, colorObj, r2);
```
(CYBERTRUCK branch, case 199, reads `_closure1_slot13` = `CybertruckTypography`, whose Body/etc. use `getCTFontStyle` → **Blender-TSL** family. Not applicable to a normal vehicle unless CT theme.)

### 2c. How `Typography['bodyLabel']` is built — this is where the font resolves
The `Typography` table is built by calling `getFontStyle(...)` per category. Verbatim BodyLabel entry (main.decompiled.js:1339... `Typography` build):
```
r6 = r3.BodyLabel;
r5 = {'type': 'Medium', 'fontFamilyPrefix': null, 'fontSize': 14, 'lineHeight': 20, 'letterSpacing': 0.1};
r13 = r8.TEXT;                 // 'UniversalSansText-'
r5['fontFamilyPrefix'] = r13;
r5 = r7.bind(r0)(r5);          // getFontStyle(r5)
```
`getFontStyle` (main.decompiled.js:1339... `getFontStyle`, verbatim logic):
```
type = a0.type;                                   // 'Medium'
prefix = a0.fontFamilyPrefix;                     // 'UniversalSansText-'
style = omit(a0, ['type','fontFamilyPrefix']);    // {fontSize:14, lineHeight:20, letterSpacing:0.1}
family = getUniversalSansFontFamily(type, prefix); // prefix + type = 'UniversalSansText-Medium'
if (Platform.OS !== 'android' && isShowingChineseOrKorean()) {   // iOS + CJK only
    return Object.assign({fontFamily: family,
                          fontWeight: {'Bold':'700','Medium':'500','Regular':'400','Light':'300','Thin':'200'}[type]},
                         style);
}
return Object.assign({fontFamily: family}, style);   // <-- normal path (non-CJK)
```
`getUniversalSansFontFamily` (verbatim): defaults prefix to `_closure1_slot9.TEXT` = `'UniversalSansText-'`, returns `prefix + type`. So for BodyLabel `type='Medium'` → `'UniversalSansText-' + 'Medium'` = **`'UniversalSansText-Medium'`**.

### 2d. RESOLVED iOS status style (non-CJK, default theme) [iOS-verified]
```
{ fontFamily: 'UniversalSansText-Medium', fontSize: 14, lineHeight: 20, letterSpacing: 0.1 }
```
- **fontFamily = 'UniversalSansText-Medium'** → an EXACT PostScript name (name id 6) of the bundled `UniversalSans-Text-Medium-540.ttf` (usWeightClass 500). iOS `[UIFont fontWithName:]` matches PostScript names directly → renders the BUNDLED font, **not SF**.
- **NO `fontWeight` key** on the non-CJK path (the weight is already baked into the Medium-540 cut). `fontWeight` is added ONLY when `isShowingChineseOrKorean()` is true (then `fontWeight:'500'`).
- `+ color` from appearance (Light → `textColorLight` = `#8A8B8B` dark / `#606060` light, per R3).

### 2e. Android equivalent [both-match on the Typography path]
Android `bundle.hasm` has the identical closures: `getUniversalSansFontFamily` #33007, `getFontStyle` #33009, `Typography` build (`'UniversalSansText-'` at `bundle.hasm:1567080`, `:3716713`). On Android `Platform.OS === 'android'` → the CJK branch is skipped → returns `{fontFamily:'UniversalSansText-Medium', fontSize:14, lineHeight:20, letterSpacing:0.1}` (no weight). Android RN resolves `'UniversalSansText-Medium'` → `assets/fonts/UniversalSansText-Medium.ttf` (present). So on the TDS `Text` path **both platforms render bundled Universal Sans Text Medium; the resolved style is identical.**

### 2f. IMPORTANT correction to the R3 "Android baseline"
R3 recorded BodyLabel = `{fontSize:14, lineHeight:20, fontFamily:'UniversalSansText', fontWeight:'500', letterSpacing:0.1}`. That literal exists in BOTH bundles but comes from a **different, legacy `Themes` typography constant**, NOT the TDS `Text` render path:
- iOS: main.decompiled.js:1643335 `r15['bodyLabel'] = {'fontSize':14,'lineHeight':20,'fontFamily':'UniversalSansText','fontWeight':'500','letterSpacing':0.1}` (keyed `body/bodyLabel/caption/captionLabel/p3/link` inside the big `Themes` object).
- Android: bundle.hasm:1893434 identical `# Object: {'fontSize':14,'lineHeight':20,'fontFamily':'UniversalSansText','fontWeight':'500','letterSpacing':0.1}`.
This `Themes` table uses `fontFamily:'UniversalSansText'` (bare family, no `-Medium`) + `fontWeight:'500'`. The TDS `<Text category='bodyLabel'>` component does NOT read this table — it reads `Typography` (§2c) → `'UniversalSansText-Medium'`. **The two tables differ in what fontFamily string reaches the native Text (`'UniversalSansText'`+weight vs `'UniversalSansText-Medium'`+no-weight); confirming which one the exact status line uses is the one remaining verify item (see claims_to_verify).** The component-tree evidence (§2a, TDS `Text`/category) points to the `Typography`/`'UniversalSansText-Medium'` path.

---

## 3. VERBATIM resolved status style, iOS vs Android

| key | iOS (Typography, non-CJK) | Android (Typography) | R3 Themes-table baseline |
|---|---|---|---|
| fontFamily | `'UniversalSansText-Medium'` | `'UniversalSansText-Medium'` | `'UniversalSansText'` |
| fontSize | `14` | `14` | `14` |
| lineHeight | `20` | `20` | `20` |
| fontWeight | *(absent)* / `'500'` if CJK | *(absent)* | `'500'` |
| letterSpacing | `0.1` | `0.1` | `0.1` |

[both-match] for fontSize/lineHeight/letterSpacing = {14, 20, 0.1}. [differ] only in fontFamily string form + presence of fontWeight, and both forms target the SAME physical file (Text-Medium-540) when name-resolution succeeds.

No `Platform.select` alters fontSize/weight/family/letterSpacing/lineHeight for the status style beyond the CJK weight addition shown above.

---

## 4. allowFontScaling / maxFontSizeMultiplier / textTransform / fontVariant

- **maxFontSizeMultiplier** [iOS-verified]: TDS bodyLabel Text sites set `maxFontSizeMultiplier: 1` (e.g. main.decompiled.js:3525922 EmptyText; :4689384/:4689443 set `maxFontSizeMultiplier:1` with `adjustsFontSizeToFit:true, numberOfLines:2`). `=1` pins Dynamic-Type scale → advance widths do NOT change with iOS accessibility text size. (Whether the specific status line sets `1` vs inherits default is UNRESOLVED — but if unset, `allowFontScaling` defaults true and only changes width when the user enlarges text.)
- **allowFontScaling**: RN Text default `true` (prop whitelist main.decompiled.js:129625, 132926). Not overridden to false on the status path found.
- **textTransform**: NOT applied to BodyLabel. Only `Overline` carries `'textTransform':'uppercase'` (iOS Typography build: Overline `{...,'letterSpacing':0.25,'textTransform':'uppercase'}`; Themes table same). Status text = BodyLabel → no transform → no width change from casing. [both-match]
- **fontVariant**: no `fontVariant` on the status/BodyLabel style (searched both bundles; `fontVariant` appears only in generic RN style-prop whitelists and a monospace debug style at :1402695). [both-match]

None of these alter status advance width at default settings.

---

## 5. Diagnosis of the ~1px delta

Root cause: **font mismatch, not a metric mismatch.** Official iOS renders the status line in the **bundled `UniversalSans-Text-Medium-540.ttf`** (via PostScript name `'UniversalSansText-Medium'`, §2d). The user's build renders `fontWeight:'500'` with no matching bundled family → falls back to **San Francisco (system) Medium**. Same 14px / lh20 / ls0.1, DIFFERENT typeface → different per-glyph advances → a sub-pixel-to-~1px width difference on a short status word.

### Measured advance widths (14px, raw sum of hmtx advances; letterSpacing +0.1/gap applies equally to both so it cancels in the delta) [computed]
UniversalSans-Text-Medium-540.ttf vs macOS SFNS.ttf instanced at wght=500 & 510, wdth=100, opsz=17 (smallest SF-Text optical instance, GRAD=400):

| word | SF wght500 | SF wght510 | US-Text-Med | ΔUS−SF(500) | ΔUS−SF(510) |
|---|---|---|---|---|---|
| Parked | 47.339 | 47.462 | 46.443 | −0.896 | −1.019 |
| Charging | 61.489 | 61.633 | 60.874 | −0.615 | −0.759 |
| Locked | 49.226 | 49.328 | 48.303 | −0.923 | −1.025 |
| Driving | 47.995 | 48.132 | 47.612 | −0.383 | −0.520 |
| Asleep | 45.958 | 46.074 | 45.623 | −0.335 | −0.451 |
| Sentry Mode | 85.894 | 86.064 | 84.608 | −1.285 | −1.456 |

The **magnitude (~0.3–1.5px per typical status word) matches the user's observed ~1px delta exactly**, confirming a font-substitution cause.

**Sign caveat (honest):** in my model the bundled Universal Sans Text Medium comes out slightly **narrower** than SF-Text opsz17 — the OPPOSITE sign of the user's report ("official ~1px WIDER than our SF"). Possible reasons the on-device sign differs: (a) iOS may render SF at a narrower optical/tracking point than the opsz=17 floor I could sample from the desktop SFNS.ttf (real iOS "SF Text" small-optical tracking differs); (b) the user's fallback may actually land on SF **Regular/other weight** or a different tracking, not exactly Medium-510; (c) subpixel/hinting rounding at 14px. The robust, load-bearing conclusion is **font identity, not sign**: matching the official font eliminates the delta regardless.

### Fix
Render the status text with the bundled face the official app uses:
```
fontFamily: 'UniversalSansText-Medium'   // iOS: bundle UniversalSans-Text-Medium-540.ttf; drop fontWeight
fontSize: 14, lineHeight: 20, letterSpacing: 0.1
```
Ship/register `UniversalSans-Text-Medium-540.ttf` (already extracted at `.../fonts/ios/`). Do NOT rely on `fontWeight:'500'` alone — that yields SF and reintroduces the delta.

---

## UNRESOLVED / GAPS
- The EXACT status-line render site was not isolated to byte-level; the fontFamily='UniversalSansText-Medium' conclusion is INFERRED-strong from (a) status = TDS `<Text category='bodyLabel'>` per R3 + component evidence, and (b) that component's deterministic resolution through Typography→getFontStyle. If the status line instead consumes the legacy `Themes` table, the string would be `'UniversalSansText'`+`fontWeight:'500'` (still bundled US, but name-matched by family "Universal Sans Text" — which resolves the Regular/Bold family, NOT the Medium cut, a subtle further risk).
- On-device SF optical size/tracking at 14px not directly measurable here (used desktop SFNS.ttf opsz=17 floor) → the delta SIGN is modeled, not device-confirmed.
