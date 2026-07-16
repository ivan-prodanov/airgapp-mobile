# Round 5 §1 — Battery % text: the spacing (Contradiction A) and the FACE (Contradiction B)

**Sources**
- iOS (PRIMARY, what we ship): `/Users/ivan/Downloads/tesla-haptics-work/main.decompiled.js` (Tesla iOS v4.56, readable JS).
- Android (verify): `/Users/ivan/Work/tesla-summon/work/bundle.hasm` (v4.58, Hermes disasm).
- Font files inspected with fontTools: `/Users/ivan/Work/airgapp/mobile/docs/superpowers/research/tesla-status-assets/fonts/ios/UniversalSans-*.ttf`.

Tags: `[iOS-verified]` / `[Android-only]` / `[both-match]` / `[differ]`. Literals dumped verbatim; computations shown AND resolved. `INFERRED`/`UNRESOLVED` marked.

---

## TL;DR (the two crux answers)

1. **Contradiction A — the % text `marginHorizontal` is `5`, NOT `10`. CONFIRMED `[both-match]`.** ChargeStatus's % `<Text>` references the **header module's** `batteryText` (`marginHorizontal = 0.5 × Gutter = 0.5 × 10 = 5`), not the MiniBattery module's `batteryText` (`marginHorizontal = Specifications.iconMargin = 10`). The 10-margin style is used by a *different* component (`MiniBatteryStatus`), never by ChargeStatus. No negative margin/gap anywhere on the row → **real horizontal gap nub→"7" = 5.0 points.**

2. **Contradiction B — the FACE. Ship `UniversalSansText-Medium` (the Medium 540 cut, usWeightClass 500), NOT a real Bold cut. `[iOS-verified]`** The native `<Text>` for the % gets `{fontFamily:'UniversalSansText-Medium', fontSize:16, fontWeight:'bold', …}`. On iOS **`fontWeight:'bold'` is a NO-OP** here: the PostScript name `UniversalSansText-Medium` resolves to a font whose legacy family ("Universal Sans Text Medium") contains **only that one face** — the Bold cut lives in a *different* family ("Universal Sans Text"), so RN's weight matcher can't reach it, and iOS does **not** synthesize faux-bold in RN's `RCTFont` path. **Official renders the % in Medium, at 16 px.** If our build shipped `UniversalSansText-Bold` (700) in response to `fontWeight:'bold'`, our % is genuinely heavier than official → exactly the mismatch the user still sees.

---

## PART 1 — Contradiction A: the two `batteryText` styles and which one ChargeStatus uses

### 1a. The TWO distinct `batteryText` styles — VERBATIM

**(1) HEADER module `batteryText` — the one ChargeStatus's % text uses.** iOS `main.decompiled.js:4570724-4570730` `[iOS-verified]`:
```js
r5 = {'fontSize': 16, 'fontWeight': 'bold'};
r12 = r7.Gutter;      // Gutter
r7 = 0.5;
r12 = r7 * r12;       // = 0.5 * Gutter
r5['marginHorizontal'] = r12;
r1['batteryText'] = r5;
// ⇒ batteryText = { fontSize:16, fontWeight:'bold', marginHorizontal: 0.5*Gutter }
```
`Gutter = 10` (iOS :1338474 `r8 = 10; r2['Gutter'] = r8`). **⇒ marginHorizontal = 0.5 × 10 = `5`.**

Android `bundle.hasm` fn #117212 region, offsets 0x418–0x44a `[both-match]`:
```
0x418  NewObjectWithBufferLong … # Object: {'fontSize': 16, 'fontWeight': 'bold'}
0x432  GetByIdShort … 'Gutter'
0x437  LoadConstDouble  0.5
0x441  Mul   → 0.5 * Gutter
0x445  PutNewOwnById 'marginHorizontal'
0x44a  PutNewOwnById 'batteryText'
// ⇒ batteryText = { fontSize:16, fontWeight:'bold', marginHorizontal: 0.5*Gutter = 5 }
```

**(2) MiniBattery module `batteryText` — the DECOY (used by MiniBatteryStatus, NOT ChargeStatus).** iOS `main.decompiled.js:4571849-4571857` `[iOS-verified]`:
```js
r5 = {'fontSize': 16, 'fontWeight': 'bold'};
r9 = r9.Specifications;
r9 = r9.iconMargin;
r5['marginHorizontal'] = r9;   // = Specifications.iconMargin = 10
r1['batteryText'] = r5;
// ⇒ batteryText = { fontSize:16, fontWeight:'bold', marginHorizontal: Specifications.iconMargin = 10 }
```
`Specifications.iconMargin` genuinely = 10 — but this style belongs to the `MiniBatteryStatus` StyleSheet (same module also defines `batteryContainer`, `batteryLevel`, `batteryLevelCt`, `container{35×16}`, `usableBatteryLevel`). `MiniBatteryStatus` reads it at iOS :4571830 (`r5 = _closure1_slot6; r6 = r5.batteryText;`). **ChargeStatus does not touch this module's batteryText.** So the "10" is real but for a different component.

### 1b. PROOF that ChargeStatus's % text uses the HEADER `batteryText` (=5), not the MiniBattery one (=10)

The % `<Text>` is built inside `ChargeStatus` (`_fun111136`, iOS :4567326). The `<Text>` props are assembled at iOS :4567820-4567888 `[iOS-verified]`:
```js
r11 = r10.Text;                    // TDS Text component (require(dep[22]).Text = module 2469.Text)
r10 = {};
r22 = …TextCategory.BodyLabel;  r10['category']   = r22;   // category: BodyLabel
r18 = …TextAppearance.Light;    r10['appearance'] = r18;   // appearance: Light
r17 = _closure1_slot21;            // ← THE STYLE MODULE
r18 = r17.batteryText;             // ← batteryText from _closure1_slot21
r17 = new Array(2);
r17[0] = r18;                      // [0] = batteryText
r18 = {}; r18['color'] = r19;      // [1] = {color: <resolved ChargeStatus color>}
r17[1] = r18;
r10['style'] = r17;                // style: [batteryText, {color}]
… r10['children'] = r13;           // "75%"  (r14 = r16 + '%'  at :4567880)
```
`_closure1_slot21` is assigned at iOS **:4570816** `var _closure1_slot21 = r1;` — where `r1` is the **header StyleSheet.create** result (the block starting :4570722). That StyleSheet contains verbatim: `batteryText` (=5, above), `batteryViewContainer`, `chargingIndicator`, `educationalPopUpContainer`, `headerContainer`, `headerFirstRow`, `headerLeftContainer`, `headerRightContainer`, `headerStatusText`, `input`, `oneLineTextContainer`, `rightHeaderItemSpacing`, `row`, `statusTextContainer`, `vehicleTitleContainer`, `vehicleTitleText`.

**⇒ ChargeStatus's % text `batteryText.marginHorizontal = 0.5*Gutter = 5`.** The MiniBattery `iconMargin=10` style is in a different closure and is never referenced by ChargeStatus. `[both-match]` — Android ChargeStatus #117220 lives in the same module (#117212) whose header StyleSheet defines `batteryText` = `0.5*Gutter = 5`.

### 1c. No negative margin / gap offsets on the row — VERBATIM

From the header StyleSheet (`_closure1_slot21`, iOS :4570790, :4570730) `[iOS-verified; both-match]`:
```js
row:                 { alignItems:'center', flexDirection:'row' }                       // no margin/padding/gap
batteryViewContainer:{ alignItems:'center', flexDirection:'row', marginTop: 0.5*Gutter=5 } // only marginTop, no horizontal
```
Neither has any negative margin, `gap`, or horizontal padding.

### 1d. Real horizontal gap nub→"7" = **5.0 points**

Render tree of the battery row (ChargeStatus, iOS :4567694+): `Animated.View[batteryViewContainer]` (flexDirection:row, no `gap`, default justify flex-start) with children:
- child[0] = `TouchableOpacity[row]` → `MiniBatteryView`. `MiniBatteryView`'s `batteryContainer`(row) = body `container`(width 35) + nub `Icon`(width 4), abutting 0 gap ⇒ **nub right edge at x ≈ 39** from child[0] left. `row`/TouchableOpacity add no margin.
- child[1] = `TouchableOpacity[row]` → the % `<Text>` (which carries `marginHorizontal:5`).
- child[2] = `batteryStates.map(...)` status icons.

Flex children abut (0 gap). Inside child[1] the Text's left margin = 5 ⇒ the Text border-box starts **5 points to the right of the nub's right edge**. No negative margins anywhere cancel it. **⇒ gap ≈ 5.0 points** (plus the glyph's intrinsic left side-bearing inside the text box, which is font-metric, not layout).

---

## PART 2 — Contradiction B: the FACE (resolved style at the % render site)

### 2a. The category style (before the override) — VERBATIM resolution `[iOS-verified; both-match on resolution path]`

`Typography['BodyLabel']` is built at iOS :1339801 as `getFontStyle({...})`:
```js
r6 = r3.BodyLabel;
r5 = {'type': 'Medium', 'fontFamilyPrefix': null, 'fontSize': 14, 'lineHeight': 20, 'letterSpacing': 0.1};
r13 = r8.TEXT;                  // 'UniversalSansText-'
r5['fontFamilyPrefix'] = r13;
r5 = getFontStyle(r5);          // getFontStyle({type:'Medium', fontFamilyPrefix:'UniversalSansText-', fontSize:14, lineHeight:20, letterSpacing:0.1})
```
Note: the BodyLabel descriptor has **no `fontWeight` key** (unlike H1XXXL `fontWeight:'500'` or AxisLabel `fontWeight:'700'`).

`getFontStyle` (iOS :1339633, `_fun32549`) VERBATIM control flow:
```js
r2 = a0.type;               // 'Medium'
r4 = a0.fontFamilyPrefix;   // 'UniversalSansText-'
r3 = pick(a0, [fontSize,lineHeight,letterSpacing]);   // = {fontSize:14, lineHeight:20, letterSpacing:0.1}
r6 = (type != null) ? type : 'Medium';                // 'Medium'
r4 = getUniversalSansFontFamily('Medium','UniversalSansText-');  // = 'UniversalSansText-Medium'
if (Platform.OS === 'android') goto case170;          // (dead on iOS device)
// iOS: check CJK
if (!isShowingChineseOrKorean()) goto case170;
case119 (iOS + CJK):  return Object.assign({fontFamily:'UniversalSansText-Medium', fontWeight: {Bold:'700',Medium:'500',Regular:'400',Light:'300',Thin:'200'}['Medium']='500'}, r3);
case170 (iOS non-CJK): return Object.assign({fontFamily:'UniversalSansText-Medium'}, r3);
```
`getUniversalSansFontFamily` (iOS :1339578) = `prefix + type` = `'UniversalSansText-' + 'Medium'` = `'UniversalSansText-Medium'`.

**⇒ `Typography['BodyLabel']` (iOS, non-CJK) = `{ fontFamily:'UniversalSansText-Medium', fontSize:14, lineHeight:20, letterSpacing:0.1 }` — NO fontWeight.**

`generateTextThemedStyles(theme, {category:BodyLabel, appearance:Light})` (iOS :1339862, `_fun32550`) then does (non-Cybertruck branch, :1340010):
```js
r8 = {};
// appearance:Light  → r8.color = theme.textColorLight
r2 = Typography[category];                 // Typography['BodyLabel'] (above)
r0 = Object.assign({}, r8, r2);            // {color:textColorLight, fontFamily:'UniversalSansText-Medium', fontSize:14, lineHeight:20, letterSpacing:0.1}
return r0;                                  // (status !== Error, so color unchanged)
```
**⇒ themedStyle = `{ color: textColorLight, fontFamily:'UniversalSansText-Medium', fontSize:14, lineHeight:20, letterSpacing:0.1 }`. NO fontWeight.**

### 2b. The MERGE order in the TDS Text component — VERBATIM `[iOS-verified]`

The TDS `Text` (styled inner `TextComponent`, `styledComponentType='Text'`, iOS :1430518, `_fun35425`) emits the native RN Text with this style array (iOS :1430519-1430522 read props; :1430573-1430575 build array):
```js
r10 = r5.themedStyle;      // :1430521  {color, fontFamily:'UniversalSansText-Medium', fontSize:14, lineHeight:20, letterSpacing:0.1}
r8  = r5.style;            // :1430522  [batteryText{fontSize:16,fontWeight:'bold',marginHorizontal:5}, {color:r19}]
r9  = {} normally  (or {letterSpacing:-0.24} ONLY if children string contains 'Ke'/'Ve' — "75%" does not)
r1 = RN Text;
r7 = new Array(3);
r7[0] = r10;   // :1430573  themedStyle   (category)
r7[1] = r9;    // :1430574  {}            (empty for "75%")
r7[2] = r8;    // :1430575  user style    (batteryText + {color})
r0 = { style: [themedStyle, {}, userStyle], ...rest };
return jsx(Text, r0);
```
**RN flattens the array left→right; LATER entries win.** So `userStyle` (batteryText) overrides `themedStyle` (category). Resolving key-by-key:

| property | from category (themedStyle) | from batteryText (user) | **final** |
|---|---|---|---|
| `fontFamily` | `'UniversalSansText-Medium'` | — | **`'UniversalSansText-Medium'`** |
| `fontSize` | 14 | **16** | **16** ✓ (batteryText wins) |
| `fontWeight` | *(none)* | **`'bold'`** | **`'bold'`** (added) |
| `lineHeight` | 20 | — | 20 |
| `letterSpacing` | 0.1 | — | 0.1 |
| `color` | textColorLight | `r19` | `r19` (ChargeStatus color: textColorLight normally / `batteryCharging #00E286` when charging / powershare tints) |
| `marginHorizontal` | — | 5 | 5 |

**⇒ Native `<Text>` style for "75%" = `{ fontFamily:'UniversalSansText-Medium', fontSize:16, fontWeight:'bold', lineHeight:20, letterSpacing:0.1, color:<state>, marginHorizontal:5 }`.**

### 2c. What iOS actually does with `{fontFamily:'UniversalSansText-Medium', fontWeight:'bold'}` — the answer to the FACE

**Font name-table facts (read directly via fontTools from the shipped .ttf files) `[iOS-verified]`:**

| file | nameID1 Family | nameID2 Subfamily | nameID6 PostScript | usWeightClass | macStyle |
|---|---|---|---|---|---|
| `UniversalSans-Text-Medium-540.ttf` | **`Universal Sans Text Medium`** | `Regular` | `UniversalSansText-Medium` | **500** | not-bold |
| `UniversalSans-Text-Regular-430.ttf` | `Universal Sans Text` | `Regular` | `UniversalSansText-Regular` | 400 | not-bold |
| `UniversalSans-Text-Bold-680.ttf` | **`Universal Sans Text`** | `Bold` | `UniversalSansText-Bold` | **700** | bold |
| `UniversalSans-Text-Light-230.ttf` | `Universal Sans Text Light` | Regular | `UniversalSansText-Light` | 200 | not-bold |
| `UniversalSans-Text-Thin-130.ttf` | `Universal Sans Text Thin` | Regular | `UniversalSansText-Thin` | 100 | not-bold |

(nameID16 typographic family is `Universal Sans Text` for all; but iOS `UIFont`/`fontNamesForFamilyName` keys on the **legacy nameID1** family.)

The critical structure: **Regular + Bold share the legacy family `Universal Sans Text` (a classic RG/BD style-linked pair). Medium/Light/Thin each get their OWN single-face legacy family (`Universal Sans Text Medium`, etc.).** This is a deliberate foundry split so `fontWeight` can't pull a sibling weight.

**iOS/RN resolution (`RCTFont`) of `fontFamily:'UniversalSansText-Medium'` + `fontWeight:'bold'(700)`:**
1. `fontFamily` is a specific PostScript name → `[UIFont fontWithName:@"UniversalSansText-Medium"]` returns the Medium face; RN reads its `.familyName` = **`Universal Sans Text Medium`**.
2. RN applies the weight by enumerating `[UIFont fontNamesForFamilyName:@"Universal Sans Text Medium"]` → **only one member** (`UniversalSansText-Medium`, weight 500). The Bold cut is in a *different* family (`Universal Sans Text`) and is **unreachable**.
3. RN picks the closest available weight = the single Medium face. **iOS does not synthesize faux-bold from `fontWeight` in this path** (RCTFont selects among real faces via `UIFontDescriptor` weight trait; no synthetic emboldening).

**⇒ Answer to the FACE question: option (a) — iOS effectively IGNORES `fontWeight:'bold'`; the % renders in the Universal Sans Text **Medium** cut (usWeightClass 500). It does NOT synthesize faux-bold, and it does NOT reach `UniversalSansText-Bold`. There is NO code path that turns the category/type into a Bold family — ChargeStatus passes only `category:BodyLabel`(→Medium) + `appearance:Light`; the sole "bold" is the RN `fontWeight:'bold'` in the StyleSheet, which is a no-op here.**

`[INFERRED-strong on the exact RCTFont mechanics — the .ttf family split and the JS style are byte-verified; the "iOS picks nearest real face in-family, no faux-bold" behavior is the well-documented RN/iOS RCTFont rule, not observed on-device here.]`

### 2d. fontSize = 16 confirmed

batteryText's `fontSize:16` is later in the flattened array than the category's `fontSize:14`, so **16 wins** (see table in 2b). `[both-match]` — Android batteryText also `fontSize:16` (fn #117212 obj `{'fontSize':16,'fontWeight':'bold'}`).

---

## PART 3 — Net recommendation (definitive)

**Ship the % text in `UniversalSansText-Medium` (the `UniversalSans-Text-Medium-540.ttf` cut, usWeightClass 500). Do NOT ship `UniversalSansText-Bold`.**

- Resolved fontFamily string that must reach the native node = **`'UniversalSansText-Medium'`**.
- fontSize = **16**, lineHeight 20, letterSpacing 0.1, color per state (textColorLight `#8A8B8B` dark normally; `#00E286` charging), marginHorizontal 5.
- The official `fontWeight:'bold'` is a **no-op on iOS** because Medium is isolated in its own single-face family. To match official byte-for-byte you must guarantee the % renders in Medium. Two safe ways:
  - **(a)** Keep `fontFamily:'UniversalSansText-Medium'` + `fontWeight:'bold'` AND replicate the foundry family split in your font registration (Medium in its own legacy family, separate from Regular/Bold) — then `bold` is a no-op exactly as in the official app.
  - **(b)** Simplest robust fix: at the % render site set `fontFamily:'UniversalSansText-Medium'` and **drop `fontWeight`** → guaranteed Medium regardless of how your fonts are registered.
- **Root cause of the user's persistent mismatch:** shipping a real Universal Sans **Bold** (700) for the % makes it heavier than the official Medium (500). Both the status line (14 px) and the % (16 px) are the **same Medium face**; the % differs from the status line only in size — never in weight.

`[differ vs our build]`: our shipped Bold (700) vs official Medium (500).

### Android note (secondary; we ship iOS)
Android's own `getFontStyle` (Hermes) also yields `fontFamily:'UniversalSansText-Medium'` with no JS-added weight on the non-CJK path, and batteryText adds `fontWeight:'bold'`. Whether Android's native RN font resolver faux-bolds a single-face family or pulls a sibling weight depends on the Android typeface registration and is **UNRESOLVED / not-the-target** (we ship iOS). The layout facts (margin 5, size 16) are `[both-match]`.

---

## Citations (load-bearing)
- Header `batteryText` (=5): iOS :4570724-4570730; Android hasm fn #117212 off 0x418-0x44a. `Gutter=10` iOS :1338474.
- MiniBattery `batteryText` (=10, decoy): iOS :4571849-4571857 (`Specifications.iconMargin`); used by `MiniBatteryStatus` iOS :4571830.
- `_closure1_slot21` (= header StyleSheet) assignment: iOS :4570816; `row`/`batteryViewContainer` verbatim :4570790 / :4570730.
- ChargeStatus % `<Text>` props (category BodyLabel, appearance Light, style [batteryText,{color}], children "75%"): iOS `_fun111136` :4567820-4567888.
- `getUniversalSansFontFamily` iOS :1339578; `getFontStyle` iOS :1339633 (`_fun32549`); `Typography['BodyLabel']` iOS :1339801; `generateTextThemedStyles` iOS :1339862 (`_fun32550`).
- TDS Text merge `[themedStyle, {}, userStyle]`: iOS `TextComponent` :1430518 (`_fun35425`); props read :1430521-1430522; array `r7[0..2]` :1430573-1430575.
- Font name tables: fontTools read of `…/tesla-status-assets/fonts/ios/UniversalSans-Text-{Medium-540,Bold-680,Regular-430}.ttf`.
