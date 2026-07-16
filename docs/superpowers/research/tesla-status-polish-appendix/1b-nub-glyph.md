# §1.4/1.5 — `battery_nipple` nub glyph + the icon system (Round 4)

Sources:
- iOS: `/Users/ivan/Downloads/tesla-haptics-work/main.decompiled.js` (v4.56, Hermes→JS)
- Android: `/Users/ivan/Work/tesla-summon/work/bundle.hasm` (v4.58, Hermes disasm)

## HEADLINE ANSWER

`battery_nipple` is **NOT an icon-font glyph and NOT drawn Views**. It is a **react-native-svg vector component** (category (b) — a single `<Path d=…>`). Our approximation (a detached 4×16 solid bar) is wrong on two counts: (1) the artwork's viewBox is **3×16**, not 4×16; (2) the visible mark is a small **rounded bump occupying only y=5..11 (6 of 16 units tall), vertically centered**, hugging the right edge (x=1..3) — not a full-height solid bar.

### The path (THE glyph) — [both-match, verbatim]
```
viewBox = '0 0 3 16'   width=3  height=16  fill='none'  xmlns='http://www.w3.org/2000/svg'
<Path d='M1 5a2 2 0 0 1 2 2v2a2 2 0 0 1-2 2V5Z' fill='currentColor' />
```
- iOS: `main.decompiled.js:1489641` (d) and `:1489644` (viewBox/width/height), inside module 2845's `SvgComponent` (`:1489629`–`:1489649`).
- Android: `bundle.hasm:1742340` `# Object: {'d': 'M1 5a2 2 0 0 1 2 2v2a2 2 0 0 1-2 2V5Z', 'fill': 'currentColor'}` and `:1742341`-region `# Object: {'width': 3, 'height': 16, 'viewBox': '0 0 3 16', 'fill': 'none', 'xmlns': 'http://www.w3.org/2000/svg'}`.

Path geometry decoded (user units, viewBox 0 0 3 16):
- `M1 5`  → move to (1,5)
- `a2 2 0 0 1 2 2` → arc r=2 to (3,7)   (top-right rounded corner)
- `v2` → line to (3,9)
- `a2 2 0 0 1 -2 2` → arc r=2 to (1,11) (bottom-right rounded corner)
- `V5 Z` → line back to (1,5), close
- Net shape: flat left edge at x=1, rounded right, spanning **x∈[1,3], y∈[5,11]** → a 2-wide × 6-tall bump, centered vertically in the 16-tall box (center y=8). `fill='currentColor'` ⇒ tinted by the `color` prop the `Icon` passes down.

---

## 1) What renders it — the icon system (NOT a font)

Tesla's `Icon` component resolves an icon **name** → a lazily-imported **react-native-svg component module**. There is a name→name identifier enum, then a separate name→SVG-module registry.

### Name enum (identity map name→name, NOT a codepoint map) — [both]
- iOS `main.decompiled.js:1433045`:
  ```
  r6 = 'battery_nipple';
  r5['battery_nipple'] = r6;
  ```
- Android `bundle.hasm:1675811`:
  ```
  00000235: LoadConstStringLongIndex Reg8:6 string_id:483989   # 'battery_nipple'
  0000023b: PutByIdLong Reg8:5 Reg8:6 UInt8:49 string_id:483989 # 'battery_nipple'
  ```
  (map slot index 49; value = the string 'battery_nipple' itself — there is **no numeric codepoint** anywhere.)

### name→SVG-component registry (lazy import) — [iOS-verified, verbatim]
iOS `main.decompiled.js:1434969`:
```
r7 = r5.battery_nipple;
r6 = {};
r11 = function() { // Original name: _default, environment: r1
    r2 = _closure1_slot0;   // the require() fn
    r1 = _closure1_slot1;   // this barrel module's dep-id array
    r0 = 57;
    r1 = r1[r0];            // dep index 57
    r0 = undefined;
    r0 = r2.bind(r0)(r1);
    r0 = r0.default;
    return r0;             // → the SVG component
};
r6['default'] = r11;
r8 = r10.bind(r0)(r8, r7, r6);   // register name → lazy component
```
Barrel module dep array (iOS `:1445561`, module id `2676` at `:1445560`):
`[1, 102, 2677, 2791, 2792, 2793, …]` → index k≥3 = `2791+(k-3)`, so **index 57 = module 2845**.
Module 2845 registration: iOS `:1489653` `r6 = 2845;` — its factory (defined `:1489466`–`:1489652`) contains the `SvgComponent` with the path above.

### Confirmation there is NO Tesla icon font
APK `base.apk` `assets/fonts/` + `res/font/` list (verbatim, `unzip -l`): AntDesign, Blender-TSL-Medium, Entypo, EvilIcons, Feather, FontAwesome(+5 Brands/Regular/Solid), Fontisto, Foundation, Ionicons, MaterialCommunityIcons, MaterialIcons, Octicons, Poppins-Medium/Regular, SimpleLineIcons, UniversalSansDisplay/Text (Bold/Light/Medium/Regular/Thin), Zocial, blender_tsl_*, cursive, metric_*, plaid_*, roboto_*, universal_sans_text_*. **All are stock react-native-vector-icons sets or Tesla text fonts — none is a Tesla glyph/UI-icon font, and none contains `battery_nipple`.** ⇒ the icon system is SVG-component-based, confirming category (b). No font file to extract.

---

## 2) Font file to name/extract
**N/A — there is no icon font.** The glyph is a bundled SVG vector (module 2845). Nothing to extract from `assets/fonts/`. The reusable artifact is the `d=` string above.

---

## 3) The nub's box, gap, colour, composition — VERBATIM, both platforms

### iOS render — `MiniBatteryView` (`main.decompiled.js`, fn starts `:4571513`)
Defaults read from props (`:4571537`–`:4571558`):
- `r10` = customHeight, default **16**  (`:4571537` `r10 = 16;`)
- `r11` = customWidth, default **35**; `r12 = r11` (`:4571542`–`4571543`)
- `r27` = customBorderWidth, default **1** (`:4571552`)
- `r23` = customBorderRadius, default **3** (`:4571558`)

Body container View style (`:4571655`–`4571661`), verbatim:
```
r19['backgroundColor'] = r28;   // pillBackgroundColor (ThemeContext) / customBackgroundColor / CT override
r19['borderColor']     = r9;    // == r28 in non-CT theme (see color trace)
r19['borderWidth']     = r27;   // 1
r19['borderRadius']    = r23;   // 3
r19['width']           = r12;   // 35
r19['height']          = r10;   // 16
```
(merged over StyleSheet `container`, see §StyleSheet.)

The nub Icon (`:4571788`–`:4571795`), verbatim:
```
r7 = r6.Icon;
r6 = {};
r13 = 'battery_nipple';
r6['name']   = r13;                 // 'battery_nipple'
r6['height'] = r10;                 // = body height (default 16)
r10 = 4;
r10 = r10 * r12;                    // 4 * customWidth
r10 = r10 / r11;                    // / 35   →  width = 4*customWidth/35  (default = 4)
r6['width']  = r10;
r6['color']  = r9;                  // = border color (see trace)
r5 = r8.bind(r3)(r7, r6);
```
No `margin*`, no `position`, no `zIndex`, no `left/right` on the Icon ⇒ **gap = 0**; it is a plain flow child.

Composition (`:4571560`+, root & children):
- Root `View` style = `batteryContainer` = `{'alignItems':'center','flexDirection':'row'}` (`:4571844`).
- children array `r4`: `r4[0]` = the battery **body** View (`:4571663` block), `r4[1]` = the **nub Icon** (`:4571863` `r4[1] = r5`).
- ⇒ nub is the **second child in a `flexDirection:'row', alignItems:'center'` row**, i.e. sits **immediately to the right of the body, butted against it (0 gap), vertically centered**. It is NOT absolutely positioned and does NOT overlap the body/border.

### iOS colour trace (nub `color` = `r9`)
- `:4571582` `r28 = r5.pillBackgroundColor;`
- `:4571588`+ `r20 = <colorHelper>(…)` (fill-level colour, separate).
- `case 319` `:` if `customBackgroundColor` (`r0`) provided → `r28 = r0;`
- `case 322` `r9 = r28;`  ⇒ nub colour = body background/border colour.
- `case 328` (Cybertruck theme, `r7` true) → `r9 = Colors.secondaryTextDarkMode;`
- ⇒ **[iOS-verified] nub colour = `r9` = the same value as the body's `borderColor` and `backgroundColor`: `pillBackgroundColor` from ThemeContext by default, overridden by `customBackgroundColor` prop, or `Colors.secondaryTextDarkMode` on the Cybertruck theme.** (Because `fill='currentColor'`, the SVG takes this `color`.)

### Android render — `bundle.hasm` (fn near `:5222360`)
Nub Icon (`:5222407`–`:5222420`), verbatim opcodes:
```
00000331: GetByIdShort  Reg8:7 Reg8:6 UInt8:33 string_id:25    # 'Icon'
00000336: NewObject     Reg8:6
00000338: LoadConstStringLongIndex Reg8:13 string_id:483989     # 'battery_nipple'
0000033e: PutNewOwnByIdShort Reg8:6 Reg8:13 string_id:192       # 'name'
00000342: PutNewOwnByIdShort Reg8:6 Reg8:10 string_id:158       # 'height'  (= r10, body height)
00000346: LoadConstUInt8 Reg8:10 UInt8:4                        # 4
00000349: Mul  Reg8:10 Reg8:10 Reg8:12                          # 4 * customWidth(r12)
0000034d: DivN Reg8:10 Reg8:10 Reg8:11                          # / 35 (r11)
00000351: PutNewOwnByIdShort Reg8:6 Reg8:10 string_id:252       # 'width'  = 4*customWidth/35
00000355: PutNewOwnByIdShort Reg8:6 Reg8:9  string_id:98        # 'color'  = r9 (border colour)
00000359: Call3 ...
0000035f: PutOwnByIndex Reg8:4 Reg8:5 UInt8:1                   # children[1] = nub Icon
```
⇒ **Identical to iOS**: name `battery_nipple`, height = body height, width = `4*customWidth/35`, color = border colour, placed as `children[1]` (2nd child, right of body). No margin/position on the Icon. `battery_nipple` SVG path/viewBox also byte-identical (`:1742340`).

---

## §StyleSheet — MiniBattery StyleSheet.create (iOS, verbatim `:4571844`–`:4571862`)
```
batteryContainer = {'alignItems': 'center', 'flexDirection': 'row'}
batteryLevel     = {'borderRadius': 1, 'left': 1, 'position': 'absolute', 'zIndex': 1}
batteryLevelCt   = {'borderRadius': 0, 'left': 1, 'position': 'absolute', 'top': 1, 'zIndex': 1}
batteryText      = {'fontSize': 16, 'fontWeight': 'bold', 'marginHorizontal': Specifications.iconMargin}
container        = {'alignItems': 'center', 'flexDirection': 'row', 'height': 16, 'position': 'relative', 'width': 35}
usableBatteryLevel = {'backgroundColor': Colors.blue, 'borderRadius': 1, 'height': 12, 'left': 1, 'position': 'absolute', 'zIndex': 2}
```
(`usableBatteryLevel.backgroundColor` overwritten to `Colors.blue` at `:4571860`; the effective fill colour at runtime is computed separately — batteryGreen / warning etc.)

Note: the body's outer `container` is width **35** × height **16**; the nub adds width **4** to its right in the row ⇒ full MiniBattery footprint ≈ **39 × 16** (default props). `container` itself has no explicit nub — the nub is a sibling appended by `batteryContainer`'s row.

---

## Why the 4×16 detached-bar approximation is wrong
1. Artwork viewBox is **3×16**, drawn into a **4-wide** box. react-native-svg default `preserveAspectRatio='xMidYMid meet'` ⇒ scale = min(4/3, 16/16) = **1**, content centered → the 3-wide art sits centered in the 4-wide slot (~0.5px slack each side), rendered at native scale.
2. The mark is **not** a full-height solid rectangle. It is a **rounded bump y=5..11 (6/16 tall, vertically centered), x=1..3**, flat on its left edge, rounded (r=2) on its right corners — the classic battery positive terminal.
3. It is `flexDirection:'row'` adjacent to the body with **0 gap**, colour = the pill/border colour (not a distinct accent), fill via `currentColor`.
