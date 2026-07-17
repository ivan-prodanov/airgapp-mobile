# R12 §2 — The shared `Button` default text style (iOS v4.56)

**Source:** `/Users/ivan/Downloads/tesla-haptics-work/main.decompiled.js` (Tesla iOS v4.56). All line numbers are iOS unless tagged.
**Method:** every value below is a VERBATIM literal dump. Inferences are tagged INFERRED. Nothing is read by adjacency.

---

## 0. TL;DR — the answer

The Controls frunk/trunk marker label resolves to:

```js
{ fontFamily:    'UniversalSansText-Medium',   // <- the PostScript name IS the weight
  fontSize:      14,   // overridden to 18 by styles.textColorGray/textColorDark
  lineHeight:    20,
  letterSpacing: 0.1,
  // NO fontWeight key at all on iOS (non-CJK)
  color:         theme.textColor  // overridden by textColorGray/textColorDark
}
```

**There is no `fontWeight` in the recovered default.** `TextCategory.BodyLabel`'s typography
entry literally does not carry one (unlike `H1XXXL`/`H1XXL`/`AxisLabel`, which do). The weight is
carried *entirely* by the PostScript name `UniversalSansText-Medium`, which selects
`UniversalSans-Text-Medium-540.ttf` — a **single-face family** (`usWeightClass 500`, design axis **540**).

**On the user's "600 matched" report — no conflict.** See §3. Universal Sans Medium is axis **540**,
i.e. materially heavier than a nominal 500 and much heavier than the 400 they fell back to. The team's
`fontWeight:'600'` was compensating for *not* selecting the Medium face by PostScript name. Ship the
PostScript name and drop the numeric weight.

---

## 1. Resolution chain (fully traced, no gaps)

| step | where | what |
|---|---|---|
| Controls module | **8716**, deps array @ **4041176** | `[1, 41, 3, 5, 2295, 8667, 2395, 8717, 1114, 255, 712, 2370, 2348, 2313, 8670, 4359, 2441, 2456, 1125, 8718, 2447, 2469, 1135, …]` |
| `Button` = dep **21** | @ 4040315 / 4040603 (`r1 = r1.Button`) | → module **2469** |
| `ButtonAppearance` = dep **20** | @ 4040321 / 4040611 | → module **2447** |
| module **2469** | body @ 1347974–1349696, deps @ **1349696** | pure `export *` barrel over `[2470, 2655, 2669, 2671, 2674, 3585, 2675, 2658, 4051, 4155, 4156, 2672, 4157, 4158, 2670, 4159, 4160, 2668, 4163, 4166, 4167, 4168, 4169, 4170, 4171, 4173, 4217]` |
| **`Button` component = module 2655** | reg @ **1427733**, deps `[1, 41, 204, 3, 5, 255, 2447, 2443, 1123, 2656, 2657, 2468, 2658, 2668]` | `r2['Button'] = require(deps[6]).styled(Component)` @ 1427726–1427730 |
| name key | @ **1427711** | `r7 = 'Button'; r3['styledComponentType'] = r7;` |
| `styled` HOC | module **2448**, @ **1337100–1337187** | `withStyledProps(Component.styledComponentType, theme, props)` @ 1337138 |
| dispatcher `withStyledProps` | @ **1337215** | `'Button'` → ip **783** @ 1337233-4 → `require(deps[8]).generateButtonThemedStyles(theme, props)` @ 4041419 (`1337419`) |
| `generateButtonThemedStyles` | module **2455** @ **1340735**, exported @ 1340764 | |
| `getButtonFontStyle(appTheme, size)` | module 2455 @ **1340543** | → `toTextThemedStyle(appTheme, TextCategory.*)` |
| `toTextThemedStyle` / `Typography` | module **2454** @ **1339977** / **1339862** | |
| `getFontStyle` | module 2454 @ **1339632** | |

---

## 2. §1 — The shared Button's default `textStyle`, VERBATIM

### 2a. `getComponentStyle` — how themedStyle becomes the text style
Module 2655 @ **1427110–1427145** (VERBATIM):

```js
r3 = ['textColor', 'textFontFamily', 'textFontSize', 'textLineHeight', 'textFontWeight',
      'textLetterSpacing', 'textMarginHorizontal', 'iconWidth', 'iconHeight', 'iconColor',
      'iconMarginHorizontal'];                                   // @1427106 (omit list for container)
...
r3 = function(a0) {              // Original name: getComponentStyle   @1427110
    r14 = a0;                    // = themedStyle
    r12 = r14.textColor;
    r11 = r14.textFontFamily;
    r10 = r14.textFontSize;
    r9  = r14.textLineHeight;
    r8  = r14.textFontWeight;
    r7  = r14.textLetterSpacing;
    r6  = r14.textMarginHorizontal;
    ...
    r1 = {};
    r1['color']            = r12;
    r1['fontFamily']       = r11;
    r1['fontSize']         = r10;
    r1['lineHeight']       = r9;
    r1['fontWeight']       = r8;
    r1['letterSpacing']    = r7;
    r1['marginHorizontal'] = r6;
    r0['text'] = r1;
```

### 2b. Style precedence at the `<Text>` call site
Module 2655 @ **1427647–1427665** (VERBATIM shape):

```js
r24 = require(deps[13]).Text;          // deps[13] = module 2668 (TDS Text)
r31 = new Array(3);
r31[0] = r33;                          // = componentStyle.text  (themedStyle-derived)
r31[1] = _closure1_slot10.text;        // = local styles.text
r31[2] = r32;                          // = props.textStyle       <-- WINS
r26['style'] = r31;
r26['numberOfLines'] = r30;
r26['children']      = r23;
```
And the local `styles.text` is **empty** — @ **1427721-2**: `r9 = {}; r1['text'] = r9;`
(`StyleSheet.create({container:{alignItems:'center',flexDirection:'row',justifyContent:'center',overflow:'hidden',position:'relative'}, icon:{}, stallButtonStrikethrough:{position:'absolute',width:2}, text:{}})` @ 1427713–1427722.)

⇒ **`props.textStyle` overrides themedStyle.** The marker's `textColorGray = {color:'rgba(255,255,255,0.7)', fontSize:18}` therefore overrides only `color` and `fontSize`. **`fontFamily`, `lineHeight`, `letterSpacing` survive from themedStyle.**

> ⚠️ Note the resulting mismatch, faithfully reproduced from the bundle: **fontSize 18 with lineHeight 20**
> (BodyLabel's 20 is not overridden). That is a 1.11 ratio, tighter than the 1.43 BodyLabel was designed for.
> If the team's label looks vertically cramped vs. the app, this is why — match it, don't "fix" it.

### 2c. `generateButtonThemedStyles` — VERBATIM (module 2455 @ 1340735)
```js
r1 = function(a0, a1) {          // Original name: generateButtonThemedStyles
    r0 = a0;  r1 = a1;
    r8  = r1.appearance;
    r11 = r1.status;
    r7  = r1.size;
    r9  = r1.useCybertruckUIPrimaryStyle;
    r3 = getButtonAppearanceStyle(r0, r8, r9);            // _closure1_slot5
    r2 = getButtonStatusStyle(r0, r8, r9, r11);           // _closure1_slot6
    r0 = r0.theme;
    r11 = getButtonSizeStyle(r0, r8, r7);                 // _closure1_slot9
    r0 = Object.assign({}, r3, r2, r11, undefined);       // size style is LAST of the three
    return r0;
};
```
The **font keys come only from `getButtonSizeStyle`** (last writer). Appearance/status contribute only
colors. No conflict.

### 2d. `getButtonSizeStyle` — VERBATIM (module 2455 @ 1340672)
```js
r3 = function(a0, a1, a2) {      // Original name: getButtonSizeStyle  (appTheme, appearance, size)
    r7 = a0; r10 = a1; r6 = a2;
    r11 = require(deps[2]).AppTheme.CYBERTRUCK;
    r2 = {}; r9 = 0;
    if(!(r7 !== r11)) goto 117;                  // appTheme === CYBERTRUCK -> borderRadius 0
case 67:
    r12 = ButtonAppearance.GHOST; r11 = 0;
    if(!(r10 !== r12)) goto 114;                 // appearance === GHOST     -> borderRadius 0
case 83:
    r11 = require(deps[3]).Specifications.borderRadius;
case 114: r9 = r11;
case 117: r2['borderRadius'] = r9;

    r9 = ButtonAppearance.GHOST;
    if(!(r10 === r9)) goto 137;
case 135: r1 = 0;                                // GHOST -> borderWidth 0
case 137: r2['borderWidth'] = r1;                // else r1 === 2

    r8 = _closure1_slot7;                        // size -> padding/dimension map
    r1 = r6;
    if(r1) goto 162;
case 152: r1 = ButtonSize.MEDIUM;                // size default = MEDIUM (for the PADDING map only)
case 162: r1 = r8[r1];
    r0 = getButtonFontStyle(r7, r6);             // <-- passes the RAW, un-defaulted size (r6)
    r0 = Object.assign(r2, r1, r0);
    return r0;
};
```
🔑 The padding map defaults to MEDIUM, but **`getButtonFontStyle` receives the raw `size`** — `undefined`
for the markers, which pass no `size` prop.

### 2e. `getButtonFontStyle` — VERBATIM (module 2455 @ **1340543**)
```js
r3 = function(a0, a1) {          // Original name: getButtonFontStyle   (appTheme, size)
    r3 = a0; r4 = a1;
    r1 = require(deps[4]).isNil(r4);
    if(r1) goto 466;                                 // <-- size == null  ->  case 466
case 48:  if(!(ButtonSize.PILL        !== r4)) goto 412;
case 65:  if(!(ButtonSize.XSMALL      !== r4)) goto 359;
case 82:  if(!(ButtonSize.SMALL       !== r4)) goto 306;
case 99:  if(!(ButtonSize.MEDIUM      !== r4)) goto 253;
case 116: if(!(ButtonSize.MEDIUMLARGE !== r4)) goto 199;
case 130: if(!(ButtonSize.LARGE       !== r4)) goto 146;
case 144: return r2;                                 // undefined
case 146: return toTextThemedStyle(r3, TextCategory.BodyLabel);     // LARGE
case 199: return toTextThemedStyle(r3, TextCategory.CaptionLabel);  // MEDIUMLARGE
case 253: return toTextThemedStyle(r3, TextCategory.BodyLabel);     // MEDIUM
case 306: return toTextThemedStyle(r3, TextCategory.BodyLabel);     // SMALL
case 359: return toTextThemedStyle(r3, TextCategory.BodyLabel);     // XSMALL
case 412: return toTextThemedStyle(r3, TextCategory.CaptionLabel);  // PILL
case 466: return toTextThemedStyle(r3, TextCategory.BodyLabel);     // isNil(size)  <-- OUR PATH
};
```

**⇒ ANSWER TO §2: `TextCategory.BodyLabel`.** (Both because `size` is nil *and* because MEDIUM maps there
anyway — the markers land on BodyLabel by two independent routes.)

---

## 3. §2 — Yes, it routes through the TDS Typography → `getFontStyle` path

### 3a. `TextCategory` enum — VERBATIM (module 2454 @ **1339498–1339528**)
```js
{ H1XXXL:'h1_xxxl', H1XXL:'h1_xxl', H1:'h1', H2:'h2', H3:'h3', H4:'h4', H5:'h5',
  Body:'body', BodyLabel:'bodyLabel', Caption:'caption', CaptionLabel:'captionLabel',
  P3:'p3', Overline:'overline', AxisLabel:'axis_label' }
```

### 3b. `Typography` (the DEFAULT, non-Cybertruck map) — `_closure1_slot14`, exported @ **1339862**
`toThemedTextStyle(appTheme, category)` @ **1339948**: `appTheme === CYBERTRUCK ? CybertruckTypography[c] : Typography[c]`.
(Verified sense: @1339960 `if(!(a0 !== CYBERTRUCK)) goto 57`; case 47 = slot14 = `Typography`; case 57 = slot13 = `CybertruckTypography`.)

VERBATIM entries (module 2454 @ 1339772–1339862), pre-`getFontStyle`:

| category | literal object | has `fontWeight`? |
|---|---|---|
| `H1XXXL` | `{type:'Medium', fontFamilyPrefix:DISPLAY, fontSize:64, fontWeight:'500', lineHeight:77, letterSpacing:0}` | ✅ `'500'` |
| `H1XXL` | `{type:'Medium', fontFamilyPrefix:DISPLAY, fontSize:40, fontWeight:'400', lineHeight:46, letterSpacing:0}` | ✅ `'400'` |
| `H1` | `{type:'Medium', fontFamilyPrefix:DISPLAY, fontSize:32, lineHeight:36, letterSpacing:0.5}` | ❌ |
| `H2` | `{type:'Medium', fontFamilyPrefix:DISPLAY, fontSize:24, lineHeight:28, letterSpacing:0.5}` | ❌ |
| `H3` | `{type:'Medium', fontFamilyPrefix:DISPLAY, fontSize:20, lineHeight:24, letterSpacing:0.5}` | ❌ |
| `H4` | `{type:'Medium', fontFamilyPrefix:DISPLAY, fontSize:18, lineHeight:24, letterSpacing:0.5}` | ❌ |
| `H5` | `{type:'Medium', fontFamilyPrefix:TEXT, fontSize:16, lineHeight:24, letterSpacing:0}` | ❌ |
| `Body` | `{type:'Regular', fontFamilyPrefix:TEXT, fontSize:14, lineHeight:20, letterSpacing:-0.1}` | ❌ |
| **`BodyLabel`** | **`{type:'Medium', fontFamilyPrefix:TEXT, fontSize:14, lineHeight:20, letterSpacing:0.1}`** | ❌ **none** |
| `Caption` | `{type:'Regular', fontFamilyPrefix:TEXT, fontSize:12, lineHeight:16, letterSpacing:-0.1}` | ❌ |
| **`CaptionLabel`** | **`{type:'Medium', fontFamilyPrefix:TEXT, fontSize:12, lineHeight:16, letterSpacing:0.1}`** | ❌ **none** |
| `P3` | `{type:'Medium', fontFamilyPrefix:TEXT, fontSize:10, lineHeight:16, letterSpacing:0}` | ❌ |
| `Overline` | `{type:'Medium', fontFamilyPrefix:TEXT, fontSize:12, lineHeight:20, letterSpacing:0.25, textTransform:'uppercase'}` | ❌ |
| `AxisLabel` | `{type:'Medium', fontFamilyPrefix:TEXT, fontSize:12, fontWeight:'700', lineHeight:18, letterSpacing:0}` | ✅ `'700'` |

(`fontFamilyPrefix` is written as `null` in the literal then immediately overwritten with
`FontFamilyPrefix.TEXT`/`.DISPLAY` on the next lines — dumped here already resolved.)

> 🔴 **CORRECTION TO R2.** R2 recorded `TextCategory.BodyLabel = UniversalSansText 14px/lineHeight20/**weight500**/letterSpacing0.1`.
> The size/lineHeight/letterSpacing are right. **The `weight500` is wrong** — `BodyLabel` carries no
> `fontWeight` key. R2 almost certainly transcribed `type:'Medium'` (which `getFontStyle` maps to `'500'`
> *only on the Android/CJK branch*, and which it **strips** on the normal iOS branch) as a `fontWeight`.
> The `H1XXXL`/`H1XXL`/`AxisLabel` rows prove the key is deliberately present when intended and
> deliberately absent here.

### 3c. `FontFamilyPrefix` — VERBATIM (module 2454 @ **1339564–1339569**)
```js
r8 = {};
r5 = 'UniversalSansText-';     r8['TEXT']    = r5;
r5 = 'UniversalSansDisplay-';  r8['DISPLAY'] = r5;
// and, separately:
r5 = 'Blender-TSL-';           // _closure1_slot10 (Cybertruck)
```

### 3d. `getUniversalSansFontFamily` — VERBATIM (module 2454 @ **1339578**)
```js
r5 = function(a0) {   // Original name: getUniversalSansFontFamily  (type, prefix = FontFamilyPrefix.TEXT)
    if (arguments.length > 1 && arguments[1] !== undefined) r1 = arguments[1];
    else                                                    r1 = FontFamilyPrefix.TEXT;
    return r1 + a0;   // string concat
};
```

### 3e. `getFontStyle` — VERBATIM (module 2454 @ **1339632–1339685**) 🔑 THE CRUX
```js
r3 = ['type'];                       // _closure1_slot4 (omit list for getCTFontStyle)
r3 = ['type', 'fontFamilyPrefix'];   // _closure1_slot5 (omit list for getFontStyle)   @1339547

r7 = function(a0) {                  // Original name: getFontStyle
    r6 = a0;
    r2 = r6.type;
    r4 = r6.fontFamilyPrefix;
    r3 = omit(r6, ['type','fontFamilyPrefix']);       // -> the "rest": fontSize/lineHeight/letterSpacing/(fontWeight if present)
    r6 = 'Medium';
    if (r2 != null) r6 = r2;                          // type defaults to 'Medium'
    r4 = getUniversalSansFontFamily(r6, r4);          // -> 'UniversalSansText-Medium'

    r5 = Platform.OS;
    if(!(r5 !== 'android')) goto 170;                 // OS === 'android'  ->  case 170
case 86:
    if(!( require(deps[4]).isShowingChineseOrKorean() )) goto 170;   // iOS, non-CJK -> case 170
case 119:                                             // iOS + Chinese/Korean ONLY
    r0 = {};
    r0['fontFamily'] = r4;
    r5 = {'Bold':'700', 'Medium':'500', 'Regular':'400', 'Light':'300', 'Thin':'200'};
    r0['fontWeight'] = r5[r6];
    return Object.assign(r0, r3);
case 170:                                             // <-- ANDROID and iOS-non-CJK
    r0 = {};
    r0['fontFamily'] = r4;
    return Object.assign(r0, r3);                     // NO fontWeight synthesised
};
```

**Branch sense triple-checked.** `if(!(OS !== 'android')) goto 170` ≡ `if (OS === 'android') goto 170`.
So: **Android → 170.** **iOS → falls to case 86**, then `isShowingChineseOrKorean()`; false → **170**.
Only **iOS + Chinese/Korean** reaches case 119 and gets a synthesised numeric `fontWeight`.
(INFERRED rationale, not from the bundle: under CJK the `UniversalSansText-*` PostScript name has no
glyph coverage, iOS falls back to the system face, and a numeric weight is the only lever left. Reported
as a guess; the control flow itself is READ.)

**⇒ `Typography.BodyLabel` on iOS/English evaluates to, VERBATIM:**
```js
{ fontFamily: 'UniversalSansText-Medium', fontSize: 14, lineHeight: 20, letterSpacing: 0.1 }
```

### 3f. `toTextThemedStyle` — VERBATIM (module 2454 @ **1339977**)
```js
r1 = function(a0, a1) {      // Original name: toTextThemedStyle  (appTheme, category)
    r1 = toThemedTextStyle(a0, a1);
    r0 = {};
    r0['textFontFamily']    = r1.fontFamily;      // 'UniversalSansText-Medium'
    r0['textFontSize']      = r1.fontSize;        // 14
    r0['textLineHeight']    = r1.lineHeight;      // 20
    r0['textFontWeight']    = r1.fontWeight;      // undefined  <-- key present, value undefined
    r0['textLetterSpacing'] = r1.letterSpacing;   // 0.1
    return r0;
};
```
`fontWeight: undefined` then flows into `getComponentStyle`'s `r1['fontWeight'] = r8` — RN ignores an
`undefined` style value, so **no weight is ever applied.**

---

## 4. §3 — The exact Universal Sans cut

### 4a. Name table (measured, not guessed)
`fontTools` over `/Users/ivan/Work/airgapp/mobile/docs/superpowers/research/tesla-status-assets/fonts/ios/`:

| file | PostScript (nameID 6) | Family (nameID 1) | Subfamily (nameID 2) | `usWeightClass` |
|---|---|---|---|---|
| `UniversalSans-Text-Thin-130.ttf` | `UniversalSansText-Thin` | Universal Sans Text **Thin** | Regular | 100 |
| `UniversalSans-Text-Light-230.ttf` | `UniversalSansText-Light` | Universal Sans Text **Light** | Regular | 200 |
| `UniversalSans-Text-Regular-430.ttf` | `UniversalSansText-Regular` | Universal Sans Text | Regular | 400 |
| **`UniversalSans-Text-Medium-540.ttf`** | **`UniversalSansText-Medium`** | Universal Sans Text **Medium** | Regular | **500** |
| `UniversalSans-Text-Bold-680.ttf` | `UniversalSansText-Bold` | Universal Sans Text | **Bold** | 700 |
| `UniversalSans-Display-Thin-130.ttf` | `UniversalSansDisplay-Thin` | Universal Sans Display Thin | Regular | 100 |
| `UniversalSans-Display-Light-230.ttf` | `UniversalSansDisplay-Light` | Universal Sans Display Light | Regular | 200 |
| `UniversalSans-Display-Regular-430.ttf` | `UniversalSansDisplay-Regular` | Universal Sans Display | Regular | 400 |
| `UniversalSans-Display-Medium-540.ttf` | `UniversalSansDisplay-Medium` | Universal Sans Display Medium | Regular | 500 |
| `UniversalSans-Display-Bold-680.ttf` | `UniversalSansDisplay-Bold` | Universal Sans Display | Bold | 700 |

**R5 §1b's trap CONFIRMED, and it is worse than stated.** `Medium` is family
`"Universal Sans Text Medium"` with subfamily `"Regular"` — its *own* single-face family. `Regular` and
`Bold` share family `"Universal Sans Text"` (a normal 2-face RIBBI pair); Thin/Light/Medium each get a
private family. So:
- `fontFamily:'Universal Sans Text'` + `fontWeight:'500'|'600'` can reach **only Regular(400) or Bold(700)** — never Medium.
- **Only the PostScript name `UniversalSansText-Medium` selects the Medium face.** That is exactly what the app does.

### 4b. **ANSWER: Medium (540). It is a cut we already ship. Nothing to extract.**
`/Users/ivan/Work/airgapp/mobile/docs/superpowers/research/tesla-status-assets/fonts/ios/UniversalSans-Text-Medium-540.ttf` is present and is byte-for-byte the file the IPA ships at `Payload/TeslaV4.app/UniversalSans-Text-Medium-540.ttf`.

### 4c. There is NO 600/SemiBold cut — anywhere
Full `.ttf`/`.otf` inventory of `~/Downloads/com.teslamotors.TeslaApp_4.57.5_und3fined.ipa`:
- **Universal Sans (Text + Display):** Thin-130, Light-230, Regular-430, Medium-540, Bold-680 — **five cuts, that is all.** No SemiBold, no 600.
- Blender-TSL (Cybertruck): Book, Medium, Bold (+ Italics), `.otf`.
- Vendor-only, irrelevant: `FourthlineSDK.framework/roboto_*`, `FourthlineVision.framework/robotoMono_semiBold.ttf`, `GoogleMaps.bundle/{DroidSansMerged,Tharlon}-Regular.ttf`.

The `SwiftModules_TeslaDesignSystem.bundle` (native side, also in every `.appex` and watchOS) ships only
the **Medium-540 + Bold-680** subset of Universal Sans Text — further evidence that Medium is *the* label face.

### 4d. 🎯 The "600 matched on-device" question — **NO CONFLICT. The user is right.**

The recovered default is **not** numeric 600 — it carries **no numeric weight at all**. But the question
"does the resolved cut's PostScript name imply a heavier rendered weight than its numeric `fontWeight`?"
answers itself decisively:

- The face's own `usWeightClass` is **500**, but the **filename axis value is 540** — Universal Sans is a
  variable-axis superfamily whose static instances are cut at true axis positions (130 / 230 / **430** /
  **540** / 680). Note **Regular is 430, not 400**, and **Bold is 680, not 700**. The `usWeightClass`
  values (100/200/400/500/700) are *rounded CSS buckets*, not the real design weights.
- So the app's label renders at design weight **540** on a scale where Regular is **430**. The delta from
  Regular is **+110** — i.e. the *rendered* face is meaningfully heavier than a nominal "500", and sits
  roughly two-thirds of the way from a CSS 500 toward a CSS 600.
- The team's `fontWeight:'600'` was, on a fallback family, the closest reachable approximation of the
  540 face. Dropping it fell back to RN's **400** — which on the shared `"Universal Sans Text"` family
  resolves to the **Regular-430** face, a full 110 axis units lighter. **That is exactly the "no longer
  bold enough" the user reported.** Their perception is accurate and their 600 was a correct empirical
  match.

**Recommendation:** stop expressing this as a numeric weight. Set
`fontFamily: 'UniversalSansText-Medium'` and **omit `fontWeight` entirely**, matching the app byte-for-byte.
If a numeric weight must be kept for a non-iOS/fallback path, **600 is the right approximation** — keep it.

---

## 5. §4 — Does `ButtonAppearance.GHOST` alter the text style?

### 5a. `ButtonAppearance` enum — VERBATIM (module 2455 @ **1340031–1340047**)
```js
{ PRIMARY:'primary', FILLED:'filled', SECONDARY:'secondary', OUTLINE:'outline',
  TERTIARY:'tertiary', GHOST:'ghost', OUTLINE_GHOST:'outline_ghost', TOGGLE:'toggle' }
```
### 5b. `ButtonStatus` — VERBATIM (@ **1340049–1340066**)
```js
{ DISABLED:'disabled', BUSY:'busy', NONE:'none', SELECTED:'selected',
  SELECTED_BUSY:'selected_busy', SELECTED_BUSY_TEXT:'selected_busy_text',
  SELECTED_DISABLED:'selected_disabled' }
```
### 5c. `ButtonSize` — VERBATIM (@ **1340068–1340080**)
```js
{ PILL:'pill', XSMALL:'xsmall', SMALL:'small', MEDIUM:'medium',
  MEDIUMLARGE:'medium_large', LARGE:'large' }
```
### 5d. `getButtonAppearanceStyle` — the GHOST branch, VERBATIM (module 2455 @ **1340124–1340131**)
GHOST is the **fall-through default** (every other appearance is tested and jumps away first):
```js
case 155:
    r0 = ButtonAppearance.GHOST;      // dead load; the branch is already decided
    r0 = {};
    r6 = r2.textColor;   r0['textColor'] = r6;
    r6 = r2.textColor;   r0['iconColor'] = r6;
    return r0;
```
**⇒ GHOST contributes `textColor` + `iconColor` and NOTHING else.** No `backgroundColor`, no
`borderColor`, **no font family / weight / size / opacity.**

Per-appearance resolution summary (all VERBATIM from 1340094–1340247):

| appearance | ip | keys returned |
|---|---|---|
| `FILLED` | 474 | `borderColor`, `backgroundColor`, `textColor`, `iconColor` (all `…MatchCybertruckUI…` when CT) |
| `SECONDARY` | 380 | `backgroundColor`, `borderColor`, `textColor`, `iconColor` |
| `OUTLINE` | 323 | `borderColor`, `backgroundColor`, `textColor`, `iconColor` |
| `OUTLINE_GHOST` | 275 | `borderColor`, `textColor`, `iconColor` |
| `TOGGLE` | 191 | `borderColor`, `backgroundColor`, `textColor`, `iconColor` |
| **`GHOST`** (+ `PRIMARY`/`TERTIARY`, which fall through) | **155** | **`textColor`, `iconColor` only** |

### 5e. `getButtonStatusStyle` with no `status` prop
The markers pass no `status`. @ **1340309-10**: the `NONE`/undefined path returns `r4 = {};` — **empty**.
(`BUSY`/`SELECTED_BUSY`/`SELECTED_BUSY_TEXT` → ip 177 → `{textColor: theme.textColorLight, iconColor: theme.textColorLight}`.)
**⇒ no status-driven font or opacity change either.**

### 5f. GHOST's only structural effect (from `getButtonSizeStyle`, §2d)
- `borderRadius: 0` (non-GHOST, non-CT → `Specifications.borderRadius`)
- `borderWidth: 0` (non-GHOST → `2`)

### 5g. The `opacity 0.5` R10 saw is NOT from the Button
It is Controls' own local `styles.disabledStyle`, applied in the marker's `style` array —
VERBATIM @ **4040325-4040332** / **4040630-4040637**:
```js
r42 = _closure1_slot32;  r43 = r42.textButton;
r42 = new Array(2);  r42[0] = r43;
if(r35) goto 3049;
case 3037: r43 = _closure1_slot32.disabledStyle;   // enabled === false
case 3049: r43 = {};
case 3051: r42[1] = r43;   r36['style'] = r42;   r36['disabled'] = !r35;
```
Marker container style, VERBATIM @ **4041132-3**: `{'height': 30, 'minHeight': 0, 'paddingVertical': 0}` → `styles.textButton`.

**⇒ ANSWER TO §4: No. `GHOST` does not touch weight, family, size, or opacity — only `textColor`/`iconColor` (+ `borderRadius:0`, `borderWidth:0`).**

---

## 6. §5 — `ControlButton` / `ControlButtonAppearance.STATELESS_GHOST`

### 6a. 🔑 Which of the two copies is LIVE — **RESOLVED**
R10 flagged duplicate `generateControlButtonThemedStyles` at **1340789** and **3355150**. Mapping every
`r6 = <id>;` registration line to its module:

| definition line | module | verdict |
|---|---|---|
| **1341167** (export @ 1341215; the `1340793` R10 cited is the `__esModule` placeholder `= undefined` at the head of the same module) | **2456** | ✅ **LIVE** |
| 3355150 (export @ 3355198-ish) | **6415** | ❌ **DEAD duplicate** |

**Proof it is 2456, not 6415** — Controls (8716) reaches it two independent ways:
1. **Direct:** `ControlButtonAppearance` is read from **dep[17]** — VERBATIM @ **4037362-4037369**:
   ```js
   r1 = 17;  r6 = r6[r1];  r6 = require(r6);
   r6 = r6.ControlButtonAppearance;
   r6 = r6.STATELESS_GHOST;
   r2['appearance'] = r6;
   ```
   and Controls' deps array @ 4041176 has **index 17 = 2456**.
2. **Via `styled`:** module 2448's `withStyledProps` @ **1337236-7** routes `'ControlButton'` → ip **718** →
   `require(deps[9]).generateControlButtonThemedStyles(theme, props)` @ **1337403**.

Module 2456 registration @ **1341217-8**: `r6 = 2456; r5 = [1, 102, 2449, 2450, 2454];` — its dep[4] = **2454**,
the same live `Typography`/`getFontStyle` module the Button uses. The 6415 copy hangs off the parallel
dead 62xx–64xx component-library tree (`6374`/`6376`/`6377`/`6414`/`6415`), which nothing in Controls references.

### 6b. `ControlButtonAppearance` enum — VERBATIM (module 2456 @ **1340799–1340810**)
```js
{ STATELESS_FILLED:'stateless_filled', STATELESS_FEEDBACK:'stateless_feedback',
  STATELESS_GHOST:'stateless_ghost', STATEFUL_ON:'stateful_on', STATEFUL_OFF:'stateful_off' }
```
Plus (@ 1340812–1340835):
```js
ControlButtonColorScheme = { DEFAULT:'default', ALTERNATIVE:'alternative' }
ControlButtonStatus      = { EDITING:'editing', DISABLED:'disabled', BUSY:'busy', NONE:'none' }
ControlButtonSize        = { SMALL:'small', MEDIUM:'medium', LARGE:'large' }
```

### 6c. `generateControlButtonThemedStyles` — VERBATIM (module 2456 @ **1341167**)
```js
r1 = function(a0, a1) {      // Original name: generateControlButtonThemedStyles
    r0 = a0;  r1 = a1;
    r7 = r1.appearance;   if(!r7) r7 = ControlButtonAppearance.STATELESS_FILLED;
    r9 = r1.status;       if(!r9) r9 = ControlButtonStatus.NONE;
    r8 = r1.themeStyle;   if(!r8) r8 = ControlButtonColorScheme.DEFAULT;
    r6 = r1.size;         if(!r6) r6 = ControlButtonSize.MEDIUM;      // <-- size DEFAULTS to MEDIUM here
    r2 = getButtonColorStyle(r0, r7, r9, r8);
    r0 = r0.theme;
    r1 = getButtonSizeStyle(r7, r0, r6);      // (appearance, appTheme, size)  -- note the arg order differs from Button's!
    return Object.assign({}, r2, r1);
};
```
🔑 Unlike the Button, **ControlButton defaults `size` to `MEDIUM` *before* calling the size/font path.**

### 6d. ControlButton's `getButtonFontStyle` — VERBATIM (module 2456 @ **1341069**)
```js
r3 = function(a0, a1) {      // Original name: getButtonFontStyle   (appTheme, size)
    r3 = a0; r2 = a1;
    if(!(ControlButtonSize.SMALL !== r2)) goto 170;
case 26:  if(!(ControlButtonSize.MEDIUM !== r2)) goto 114;
case 40:  if(!(ControlButtonSize.LARGE  !== r2)) goto 58;
case 54:  return undefined;                                          // no font style at all
case 58:  return toTextThemedStyle(r3, TextCategory.CaptionLabel);   // LARGE
case 114: return toTextThemedStyle(r3, TextCategory.CaptionLabel);   // MEDIUM   <-- OUR PATH
case 170: return toTextThemedStyle(r3, TextCategory.CaptionLabel);   // SMALL
};
```
**All three sizes → `CaptionLabel`.** (The size branch is vestigial for typography; it only varies icon
dimensions via `_closure1_slot7`.)

And ControlButton's `getButtonSizeStyle` — VERBATIM (@ **1341134-1341162**):
```js
r5 = [ControlButtonAppearance.STATELESS_GHOST, ControlButtonAppearance.STATELESS_FEEDBACK].includes(a0);
r1 = 2;  if(r5) r1 = 0;
r2['iconContainerBorderWidth'] = r1;         // STATELESS_GHOST -> 0
r1 = _closure1_slot7[size];                  // icon dims
r0 = getButtonFontStyle(a1 /*appTheme*/, size);
return Object.assign(r2, r1, r0);
```
**⇒ `STATELESS_GHOST`'s only structural effect is `iconContainerBorderWidth: 0`.** It does not touch the label font.

### 6e. **ANSWER TO §5 — the ControlButton label (Flash/Honk/Start row + Climate seat buttons):**
```js
{ fontFamily:    'UniversalSansText-Medium',   //  === UniversalSans-Text-Medium-540.ttf
  fontSize:      12,
  lineHeight:    16,
  letterSpacing: 0.1,
  // NO fontWeight  (iOS non-CJK)
}
```
i.e. **same family/cut as the Button** (Medium-540, weight carried by the PostScript name only), but
**`CaptionLabel` (12/16)** instead of **`BodyLabel` (14/20)**.

---

## 7. Cross-check: the TDS `<Text>` path agrees
`withStyledProps` @ **1337230-1**: `'Text'` → ip **848** — VERBATIM @ **1337446–1337459**:
```js
r6 = require(deps[7]).generateTextThemedStyles;
r4 = {};
r10 = require(deps[7]).TextCategory.BodyLabel;
r4['category'] = r10;
r4 = Object.assign(r4, r3 /*props*/);        // props.category overrides
r4 = r6(r5 /*theme*/, r4);
r0['themedStyle'] = r4;
```
So the TDS `<Text>` default category is **also `BodyLabel`**. Module 2655 renders `require(deps[13]).Text`
(deps[13] = module **2668**) **without** a `category` prop, so the inner Text independently resolves
BodyLabel → `UniversalSansText-Medium`, and the Button's own themedStyle-derived text style is then layered
on top via the `style` array (§2b). **Both routes converge on the same face — no ambiguity.**

(`generateTextThemedStyles` @ **1339866**, module 2454, defaults `category` to `TextCategory.Body` @1339913 when
null — but the dispatcher always passes `BodyLabel` explicitly, so that default is unreachable from `<Text>`.
It also overrides `color` to `Colors.red` when `status === TextStatus.Error` @1339933–1339945.
`TextAppearance = {Default:'default', Alternative:'alternative', Light:'light', Pill:'pill'}` @1339530-9;
`TextStatus = {None:'none', Error:'error'}` @1339541-6.)

---

## 8. What to ship (iOS — WE SHIP iOS)

```js
// Controls frunk/trunk marker label — matches Tesla v4.56 exactly
const markerLabel = {
  fontFamily:    'UniversalSansText-Medium',   // ships as UniversalSans-Text-Medium-540.ttf
  fontSize:      18,        // marker override (styles.textColorGray/textColorDark)
  lineHeight:    20,        // inherited from BodyLabel, NOT overridden — keep the 18/20 mismatch
  letterSpacing: 0.1,       // inherited from BodyLabel
  color:         isLight ? Colors.transparentBlack70 : 'rgba(255,255,255,0.7)',
  // DO NOT set fontWeight. The PostScript name is the weight.
};

// ControlButton label (Flash / Honk / Start, Climate seat buttons)
const controlButtonLabel = {
  fontFamily:    'UniversalSansText-Medium',
  fontSize:      12,
  lineHeight:    16,
  letterSpacing: 0.1,
  // DO NOT set fontWeight.
};
```
Register `UniversalSans-Text-Medium-540.ttf` in `UIAppFonts` and reference it by the PostScript name
`UniversalSansText-Medium`. Setting `fontFamily:'Universal Sans Text'` + any `fontWeight` **cannot** reach
this face (§4a) — that is the bug that produced the "not bold enough" regression.

---

## 9. Confidence ledger

| claim | status |
|---|---|
| Controls dep[21] = 2469 → barrel → module 2655 = shared `Button`; `styledComponentType = 'Button'` | **READ** |
| Marker Button passes no `size` → `isNil(size)` → `BodyLabel` | **READ** |
| `Typography.BodyLabel` literal has **no** `fontWeight` key | **READ** (verbatim, contrasted against H1XXXL/H1XXL/AxisLabel which do) |
| `getFontStyle` emits `fontWeight` **only** on iOS+CJK; Android and iOS-non-CJK get `fontFamily` only | **READ** (branch sense triple-checked) |
| Resolved family = `'UniversalSansText-Medium'` | **READ** |
| `UniversalSansText-Medium` ⇒ `UniversalSans-Text-Medium-540.ttf`, own single-face family, `usWeightClass 500` | **MEASURED** (fontTools) |
| No 600/SemiBold Universal Sans cut exists in the IPA | **MEASURED** (full `unzip -l` inventory) |
| `GHOST` contributes only `textColor`/`iconColor` (+`borderRadius:0`,`borderWidth:0`) | **READ** |
| `status` absent → `{}` → no opacity/font change | **READ** |
| Module **2456** live / **6415** dead | **READ** (dep[17] of Controls' deps array @4041176 = 2456; `r6 = 2456;` @1341217) |
| ControlButton → `CaptionLabel` 12/16/0.1, same Medium face | **READ** |
| "540/430/680 are true variable-axis positions; usWeightClass are rounded buckets" | **INFERRED** from the filename↔usWeightClass mismatch across all 10 files (130/230/430/540/680 vs 100/200/400/500/700). The mismatch is measured; the *variable-axis* explanation is a guess. Does not affect any shipping recommendation. |
| Rationale for the iOS+CJK `fontWeight` branch (glyph-coverage fallback) | **INFERRED** — control flow is READ, the *why* is a guess |
| `fontSize:18` + `lineHeight:20` on the marker is intentional Tesla behaviour | **UNRESOLVED** — the *values* are READ; whether Tesla intends it or it is their bug is not recoverable from the bundle |
| Android v4.58 (`bundle.hasm`) parity | **NOT CHECKED** — out of scope; we ship iOS. Note `getFontStyle`'s Android branch also emits no `fontWeight`, so parity is expected but UNVERIFIED. |
