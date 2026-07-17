# R11 §2 — The dark line at the top of the Climate screen

**VERDICT: it is `StatusBarFade` (module 8567) — fixed app chrome, iOS-only, painted over the car render.
It is NOT the car, NOT paint-dependent, NOT the renderer, and NOT `headerGradient`.**

The user's instinct ("very likely unrelated to the car at all") is **correct**.

---

## 1. The `headerGradient` lead is a RED HERRING (it's Cybertruck-only)

The strong lead from the prompt — iOS **5221263**:

```js
r0['headerGradient'] = {'height': 300, 'position': 'absolute', 'width': '100%', 'zIndex': 4294967286 /* -10 */}
```

It **does** render a `LinearGradient`, at iOS **5222605**. But it is behind a theme gate.

Climate render fn `_fun120821` (iOS 5221433), gate assigned at iOS **5221531-5221532**:

```js
r14 = useContext(ThemeContext);         // dep[22] = module 2447
r8  = r14.theme;
r7  = AppTheme.CYBERTRUCK;
r63 = r8 === r7;                        // ⭐ r63 = (theme === AppTheme.CYBERTRUCK)
var _closure2_slot21 = r63;
```

At iOS **5222588** (`if(r63) { ... 2671 }`) this becomes:

```jsx
{isCybertruck
  ? <LinearGradient                                   // ← the headerGradient. CYBERTRUCK THEME ONLY.
      style={styles.headerGradient}                   // {height:300, position:'absolute', width:'100%', zIndex:-10}
      colors={[Colors.black, Themes[AppTheme.CYBERTRUCK].v5BackgroundColorTransparent]}
      start={{x: 0, y: 0.2}}
      end={{x: 0, y: 1}} />
  : <StatusBarFade />}                                {/* ⭐ ← THE ANSWER, for every non-CT theme */}
```

Resolved hexes for the CT branch: `Colors.black` = **`#000000`** (module 2450, `Colors` literal),
`Themes[CYBERTRUCK].v5BackgroundColorTransparent` = **`#16171800`** (module 2447, iOS 1337954-1337955).

`AppTheme` = `{LIGHT:0, DARK:1, CYBERTRUCK:2, AUTO:3}` (iOS 1337543+). Unless the user is on the
**Cybertruck** theme, `headerGradient` **never mounts**. Rule it out.

---

## 2. THE ANSWER — `StatusBarFade`, module 8567

`_closure1_slot10` = `dep[9]` = module **8567**. Climate's dep array (module id **11024**, iOS 5225197):

```
[1, 41, 3, 5, 11025, 11026, 8667, 2395, 2295, 8567, 4054, ...]
                                          ↑ index 9
```

Climate renders it with **NO PROPS** (iOS 5222649-5222654):

```js
r5 = _closure1_slot10;   // module 8567
r7 = r5.default;         // StatusBarFade
r5 = {};                 // ⭐ EMPTY PROPS — all defaults
r7 = r9.bind(r4)(r7, r5);
```

### Module 8567 verbatim (iOS 3931457-3931569), deps `[3, 5, 255, 2447, 4164]`

Name confirmed independently by the **Android** bundle, which retains the symbol:
`bundle.hasm:4355380` → `[Function #97962 "StatusBarFade" of 335 bytes]`.

```js
// styles (iOS 3931460-3931470)
StyleSheet.create({
  statusBarContainer: {height: Specifications.statusBarHeight,   // dep[2] = module 255
                       left: 0, position: 'absolute', right: 0, top: 0},
  statusBarFade:      {height: '100%', width: '100%'},
})

// component (iOS 3931471-3931556)
function StatusBarFade({colors, start, end, style}) {
  const ctx = useContext(ThemeContext);                          // dep[3] = module 2447
  if (colors == null) colors = [ctx.v5BackgroundColor, ctx.v5BackgroundColorTransparent];  // ⭐ default
  const x = 0;
  const startY = (start != null) ? start : 0;                    // ⭐ default 0
  const endY   = (end   != null) ? end   : 1;                    // ⭐ default 1
  return (
    <>
      {Platform.OS === 'ios' &&                                  // ⭐ iOS-ONLY. Android = nothing.
        <Animated.View style={[styles.statusBarContainer, style]}>
          <LinearGradient                                        // dep[4] = module 4164
            style={styles.statusBarFade}
            colors={colors}
            start={{x: x, y: startY}}
            end={{x: x, y: endY}} />
        </Animated.View>}
    </>
  );
}
```

### Resolved for Climate (no props)

| property | value |
|---|---|
| component | `Animated.View` > `LinearGradient` (module 4164 exports `LinearGradient`, iOS 1798184) |
| position | `absolute`, `top: 0`, `left: 0`, `right: 0` → **full width, flush to the top edge** |
| height | `Specifications.statusBarHeight` = **59** on the user's phone (see table below) |
| colors | **`['#161718', '#16171800']`** (DARK/CT theme) · `['#FAFAFA', '#FAFAFA00']` (LIGHT theme) |
| start | `{x: 0, y: 0}` |
| end | `{x: 0, y: 1}` |
| style | `undefined` — **no opacity override, always fully on** |

**Geometry on the user's 420×912 / 59 device:** a **420 × 59 pt** band at `y = 0`, vertical gradient,
**fully opaque `#161718` at y=0 → fully transparent at y=59**. Soft bottom edge (no hard line — matches
the user's word "shadow/tint" rather than a crisp rule).

### Why it appears *over the car*

Climate's `container` (iOS 5221247-5221251) is **transparent**:

```js
r4['backgroundColor'] = Colors.transparent;  r4['flex'] = 1;   r0['container'] = r4;
```

The Godot car renderer sits **behind** the RN Climate screen (Home owns `godotView`, iOS 4560498).
`StatusBarFade` is `children[0]` of the transparent container, so it paints **on top of the car render**
but **below** every later RN sibling. Hence: a dark tint band lying across the top of the car —
i.e. across the frunk/windscreen region.

Climate's child order (iOS 5222608-5222690):
```
children[0] = StatusBarFade | headerGradient        ← the band
children[1] = VehicleClimateControlsOverlay          (dep[43]=11027 — checked: NO gradient/shadow;
                                                      its `buttonsOverlay`/`container` are bare
                                                      {top:0,left:0,right:0,bottom:0} transparent boxes,
                                                      iOS 5227029-5227033)
children[2] = <View backButtonContainer pointerEvents="box-none"><HeaderButton name="back" …/></View>
children[3] = <BottomSheet animateOnMount={false} enableDynamicSizing … />
```

`StatusBarFade` is the **only** thing painting the top edge of Climate.

---

## 3. `Specifications.statusBarHeight` — full device table

`getAdjustedStatusBarHeight()`, module **255**, iOS 1338483-1338545 (complete, all branches followed):

| device (`DeviceInfo.getDeviceId()`) | height |
|---|---|
| Platform.OS === 'android' | `getTopInset()` |
| `iPhone13,1` (mini) | 50 |
| includes `iPhone13` | 47 |
| `iPhone14,4` | 50 |
| `iPhone14,6` (SE3) | `getStatusBarHeight()` |
| includes `iPhone14` | 47 |
| includes `iPhone15` / `iPhone16` / `iPhone17` / `iPhone18` | **59** ⭐ |
| else | `getStatusBarHeight()` |

**59 matches the user's stated `420×912/59` device exactly.**

---

## 4. Is it Climate-only? **NO.**

Modules importing 8567 (`grep '^    r5 = \[.*\b8567\b.*\];$'`):

| module | screen | renders StatusBarFade? |
|---|---|---|
| 8566 | screen wrapper (has `showStatusBarFade` prop, iOS 3930344) | via prop |
| 10328 | **Home** | ✅ `<StatusBarFade start={0.7} style={{opacity: <animated>}} />` (iOS 4564202-4564209) |
| 10394 | — | imports |
| **11024** | **Climate** | ✅ `<StatusBarFade />` — **no props, static, always fully opaque at y=0** |
| 14743, 17964, 18382, 18870 | — | import |
| **8716** | **Controls** | ❌ **deps do NOT contain 8567** (iOS 4041176) — Controls never renders it |

**Key contrast:** Home passes `start={0.7}` **and an animated `opacity`**, so its fade is scroll-driven and
usually invisible. **Climate passes nothing** → `start={x:0,y:0}`, no opacity → **permanently on at full
strength**. That is why the user notices it on Climate and not elsewhere.

(Home's `headerGradientCT`, iOS 4560498/4564143, is likewise Cybertruck-gated; its height is
`MAX_LIST_HEADER_HEIGHT + statusBarHeight + 30`.)

---

## 5. Paint/car dependent, or fixed chrome? → **FIXED CHROME**

Depends **only** on `ThemeContext.v5BackgroundColor` and `getDeviceId()`. It reads **nothing** from the
vehicle: no VIN, no paint colour, no `vehicleConfig`, no car state. Identical on every car.

---

## 6. Renderer-side (§2 Q3) — NOT NEEDED

The prompt scoped renderer investigation to *"if nothing in RN accounts for it"*. **RN accounts for it
completely and exactly**: right screen (Climate), right edge (top), right size (59pt), right colour
(near-black `#161718`), right character (soft-bottomed tint), right platform (iOS), and a mechanism that
explains why Climate shows it and Controls doesn't.

**Honest scope note:** I therefore did **not** re-open the Godot suspects — the `Background` MeshInstance,
`SET_SCREEN_OVERLAY_COLOR`, `ap_scene_env.tres` fog, or a vignette. They are **not ruled out by new
evidence this round**; they are *unnecessary* given a sufficient, precisely-matching RN mechanism. Prior
work already noted `SET_SCREEN_OVERLAY_COLOR` is alpha 0 (a no-op) in the normal case (R10).
If the device check below fails, those remain the next places to look.

---

## 7. Reproduce / rule out on device

- The band ends **exactly at y = 59pt** (top 6.5% of a 912pt screen) and fades smoothly to nothing.
- **Switch to the LIGHT theme** → the band becomes `#FAFAFA` (a *light* haze), not dark. This is the
  cheapest discriminator: if the tint **inverts with the theme**, it is `StatusBarFade`. If it stays dark,
  it is not, and the Godot suspects in §6 come back on the table.
- **Switch to the Cybertruck theme** → the 59pt band is replaced by a **300pt** `#000000 → #16171800`
  gradient starting at 20% down. Much taller and much darker.
- Go to **Controls** → the band should be **absent entirely**.

---

## For airgapp parity

To reproduce: absolutely-position a full-width, `statusBarHeight`-tall vertical `LinearGradient` at
`top: 0`, `colors: [bg, bg + '00']`, `start: {x:0,y:0}`, `end: {x:0,y:1}`, **behind** all other screen
chrome but **above** the car renderer. To omit: simply don't render it — it is decorative
status-bar legibility scrim, carries no state, and is already absent on Android.

---

## Source index (all iOS `/Users/ivan/Downloads/tesla-haptics-work/main.decompiled.js`)

| line | what |
|---|---|
| 5225196-5225197 | Climate module id **11024** + dep array |
| 5221247-5221251 | Climate `container` = transparent, flex 1 |
| 5221263 | `headerGradient` style |
| 5221531-5221532 | `r63 = theme === AppTheme.CYBERTRUCK` |
| 5222588 | the `if(r63)` gate |
| 5222605-5222634 | CT `LinearGradient` (colors/start/end) |
| 5222649-5222654 | **`jsx(StatusBarFade.default, {})`** ← the answer |
| 3931457-3931569 | **module 8567 `StatusBarFade`** (styles + component + deps) |
| 1338483-1338545 | `getAdjustedStatusBarHeight()` device table |
| 1337543-1337550 | `AppTheme` enum |
| 1337929-1337930 | LIGHT `v5BackgroundColor` `#FAFAFA` / `#FAFAFA00` |
| 1337954-1337955 | DARK+CT `#161718` / `#16171800` |
| 1338643 (`Colors` literal) | `Colors.black` = `#000000`, `Colors.transparent` = `'transparent'` |
| 1798184-1798188 | module **4164** exports `LinearGradient` |
| 4041175-4041176 | Controls module **8716** + deps (no 8567) |
| 4564202-4564209 | Home `<StatusBarFade start={0.7} style={{opacity}}/>` |
| 5227029-5227033 | `VehicleClimateControlsOverlay` styles (bare, no fill) |

Android cross-check: `/Users/ivan/Work/tesla-summon/work/bundle.hasm:4355380` — `StatusBarFade` symbol,
same `Platform.OS === 'ios'` gate (`JmpFalseLong` → empty Fragment), so it is a **runtime no-op on Android**.
