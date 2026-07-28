# Climate screen — full copy plan

**Date:** 2026-07-28
**Source:** `~/Downloads/tesla-haptics-work/main.decompiled.js` (Tesla iOS v4.56, `hbc-decompiler`),
`com.teslamotors.TeslaApp_4.57.5_und3fined.ipa`, `…apkmirror.com/base.apk`.
**Why this exists:** four styling passes were done by measuring screenshots and nudging numbers, and
every one of them was wrong somewhere. The call sites name the components; everything else follows
from that. This document is the recovered spec so the remaining work is transcription, not guessing.

---

## 0. The rule this document exists to enforce

> **Find the component, then read its style. Do not measure a screenshot.**

Every error in the four passes came from skipping that:

| guessed from a screenshot | actual, from the component |
|---|---|
| label 16/24 | BodyLabel **14/20/0.1** |
| icon 20 | **24** |
| row height from padding, 16pt sides | fixed **60** tall, **10pt** sides |
| radius 10, then 12, then 16 | **5** — `Specifications.borderRadius`. No `borderCurve`; the Button never sets one |
| setpoint = Regular (read `fontWeight:'400'`) | **Medium** — `fontWeight` cannot reach another cut |
| border = hairline | **2** |

---

## 1. Component tree (recovered)

`VehicleClimateScreen` @5221432.

```
VehicleClimateScreen
├─ interior/exterior temps        vehicle_climate_screen_{interior,exterior}_temp   @5221883
├─ setpoint row                   power ─ ‹ 20.0° › ─ vent
├─ Defrost Car                    <Button appearance=TOGGLE size=LARGE>             @5223636
├─ Bioweapon Defense Mode         same
├─ Camp Mode ─┐ one bordered group with an internal divider
│  Pet Mode ──┘
└─ Cabin Overheat Protection      heading + segmented (Off / No A/C / On)           @5224645
   └─ Approximate activation temperature   ← only when COP === ON                   @5221950
```

**The rows are not bespoke cards.** They are the design-system `Button`:

```jsx
<Button appearance={ButtonAppearance.TOGGLE}
        size={ButtonSize.LARGE}
        status={NONE | SELECTED | BUSY}
        style={[styles.largeButton, isCT && {justifyContent:'center'}]} />
```

---

## 2. The row spec — three objects composed

```
styles.largeButton                    @5221317   (climate screen's own)
  height 6*Gutter = 60
  justifyContent 'flex-start'
  alignItems 'center'
  width '100%'

LARGE size tier                       @1340527
  minWidth 5*Gutter = 50   minHeight 5*Gutter = 50
  paddingHorizontal 10     paddingVertical 13
  iconWidth 24  iconHeight 24  iconMarginHorizontal 10
  textMarginHorizontal 10

getButtonSizeStyle(theme, appearance, size)   @1340676
  returns ONLY { borderRadius, borderWidth } — size is not read
  borderRadius: Cybertruck -> 0, GHOST -> 0, else Specifications.borderRadius = 5
  borderWidth:  2, zeroed only for GHOST
  NO borderCurve anywhere in the module

getButtonFontStyle(LARGE)             @1340624
  -> TextCategory.BodyLabel = Medium 14/20/0.1
```

Icon-to-label gap is `iconMarginHorizontal (10) + textMarginHorizontal (10) = 20`.

---

## 3. Type ladder (complete)

`Typography`, non-Cybertruck block, ~@1339774-1339860. Each entry carries its own face via `type`.

| tier | face | size / line / tracking |
|---|---|---|
| display | Medium | 64/77/0 (weight 500) |
| display | Medium | **40/46/0 (weight 400 — see trap below)** |
| display | Medium | 32/36/0.5 |
| display | Medium | 24/28/0.5 |
| display | Medium | 20/24/0.5 |
| display | Medium | 18/24/0.5 |
| display | Medium | 16/24/0 |
| Body | **Regular** | 14/20/−0.1 |
| BodyLabel | Medium | 14/20/+0.1 |
| Caption | **Regular** | 12/16/−0.1 |
| CaptionLabel | Medium | 12/16/+0.1 |
| AxisLabel | Medium | 10/16/0 |
| Overline | Medium | 12/20/0.25, uppercase |

### ⚠️ The `fontWeight` trap — cost two passes

`{type:'Medium', fontWeight:'400'}` does **NOT** mean the Regular face. `type` sets
`fontFamily: 'UniversalSansText-Medium'`, and the foundry puts Medium in its own single-face family,
so iOS cannot reach another cut through `fontWeight` and will not synthesize one. **It renders
Medium.** `src/constants/fonts.ts` documents this for the battery %; it was quoted in the commit that
then did the opposite.

Only `type: 'Regular'` (Body, Caption) is genuinely the Regular face.

**Fonts:** `UniversalSans-Text-{Medium-540, Bold-680, Regular-430}.ttf` — all three now bundled.
PostScript names verified from the TTF name tables: `UniversalSansText-{Medium,Bold,Regular}`.

---

## 4. Colour tokens

Dark theme block ~@1337960-1338060; `Colors` table @1338467.

| token | value | used for |
|---|---|---|
| `textColor` | `#F3F3F3` | engaged label, setpoint when climate ON |
| `textColorLight` | `#8A8B8B` | every idle label, icon, chevron |
| `borderColorWithOpacity` | `rgba(255,255,255,0.1)` | card border **(see open question)** |
| `buttonActivePrimary` | `Colors.buttonBlue` = `#3368FF` | engaged row fill |
| `buttonActiveSecondary` | `#2C2C2C` | selected segment pill |
| `btnBorderLineColorGray` | `rgba(255,255,255,0.2)` | candidate border |
| `nightCardBackground` | `#222324` | panel surfaces elsewhere |

`activeOpacity` values in use: 0.105, 0.3, **0.7** (×2), 0.85, 1.

---

## 5. States

From Ivan's four awake screenshots + the recovered `status` prop.

| state | row | setpoint block |
|---|---|---|
| climate OFF | idle | power glyph, label and number all `#8A8B8B` |
| climate ON | idle | power glyph, label and number all `#F3F3F3`; chevrons stay dim |
| row SELECTED | fill `#3368FF`, icon+label white | — |
| row pressed | whole row dims (~0.7) | — |
| row BUSY | `status=BUSY` — not yet modelled | — |

When a toggle engages, a bold white status line appears **above** the temps ("Defrosting Car"). Not
implemented.

---

## 6. Glyphs

`NamedIconViewComponent` @1432707 renders a **native** view, so nothing is in the JS bundle.

| glyph | located | where |
|---|---|---|
| `defrost_car` | ✅ | `base.apk` `res/drawable/ic_defrost_car.xml`; also iOS `TeslaDesignSystem.bundle/Assets.car` |
| `biohazard` | ✅ | same two places |
| `vent` | ✅ | `res/drawable/ic_vent.xml`; iOS catalog |
| Camp Mode | ❌ | not in any APK drawable, not in any of the 10 `Assets.car` catalogs |
| Pet Mode | ❌ | same |
| power | ❌ | not searched exhaustively |

**Extraction route (proven):** Android vector drawable → SVG → the same rasterise-to-data-URI
pipeline already used for `tirePressureIcon.ts` and `mediaSourceIcons.ts`, tinted at render.

**Still to find:** the icon NAME the camp/pet rows pass to `NamedIcon`. The label key is
`vehicle_climate_screen_camp_mode` @5222240; the icon name is set nearby and was not located. Find it
first — the asset is presumably named after it, and "camp"/"pet"/"dog"/"paw" all return nothing.

---

## 7. Conditional rules

**Activation-temperature row** @5221950:

```js
supportsCabinOverheatProtection
  && supportsSetCabinOverheatProtectionTemp
  && cabinOverheatProtection === CABINOVERHEATPROTECTIONON
```

Only on **On** — not Fan Only (our "No A/C"; their label for that enum is literally `..._no_ac`),
not Off. ✅ implemented.

Neither `supports*` flag is on the BLE protos (cloud vehicle config), so both are assumed true. The
proto does carry `supportsFanOnlyCabinOverheatProtection` — **do not** gate the No A/C option on it;
their options array is built unconditionally (`new Array(3)`, @5224664).

---

## 8. Open questions — do these before more styling

1. ~~**Where does the card border come from?**~~ **RESOLVED @1338100-1338110.** The confusion was a
   naming one: the idle row is their *Disabled* toggle set and the engaged row the *Enabled* one, so
   every search for "the inactive border" kept landing on transparent.

   ```
   buttonEnabledToggleBackground  = Colors.buttonBlue = #3368FF   (ENGAGED)
   buttonEnabledToggleBorder      = Colors.buttonBlue = #3368FF
   buttonEnabledToggleText        = #F1F1F1
   buttonDisabledToggleBackground = Colors.transparent            (IDLE)
   buttonDisabledToggleBorder     = #2C2C2C
   buttonDisabledToggleText       = #969696
   ```

   The border is a **solid dark grey**, not translucent white. `rgba(255,255,255,0.1)` happened to
   compute to roughly the same shade over this backdrop — worse than being obviously wrong, because
   it would have drifted the moment the surface behind it changed. `#2C2C2C` is also
   `buttonActiveSecondary`, the selected segment pill, so one value covers both.
2. ~~**`ButtonSize.LARGE`'s own radius.**~~ **RESOLVED — and the question was malformed.** Ivan:
   *"make sure you get it from the right button… the one on iOS looks rectanglish and all your doings
   is very round buttons"*. Correct on both counts.

   The 48→16 / 40→10 tiers I had been sourcing radius from are in **`getInputSizeStyleMap`**
   (@1341498) — the sizing table for **text inputs**. Inputs are round; these buttons are not. I
   never checked the enclosing function name, and the tier shape was plausible enough that four
   passes of nudging the number never questioned the table.

   The real `getButtonSizeStyle` (@1340676) takes `(theme, appearance, size)` and returns only
   `{borderRadius, borderWidth}`. **Radius does not vary by size** — so "LARGE's own radius" never
   existed to be found:

   ```
   Cybertruck theme -> 0
   appearance GHOST -> 0
   everything else  -> Specifications.borderRadius = 5   (@1338718)
   borderWidth       -> 2, zeroed only for GHOST
   ```

   `borderWidth: 2` was right by luck — both tables happened to say 2. `borderCurve: 'continuous'`
   was pure invention: it appears nowhere in the button module.

3. ~~**The segmented control's component.**~~ **RESOLVED: `ToggleSelector`** (@1870333) — found by
   searching for the one function reading both an `options` and a `busy` prop. Stylesheet @1870274:

   ```
   wrapper     { borderRadius: 5, borderWidth: 1, height: 50, width: '100%' }
   innerHandle { borderRadius: 5, height: '100%' }
   handle      { height: '100%', position: 'absolute' }
   option      { flex: 1, alignItems: 'center', justifyContent: 'center' }
   options     { flexDirection: 'row', height: '100%', justifyContent: 'space-around', zIndex: 2 }
   ```

   Dark theme: border `Gray.mildDarker` **#212121** on both track and pill; pill fill `Gray.dark`
   **#353535**; track fill also #212121 (transparent only when `hideBackground` is passed, which the
   climate call site does not pass). **No padding, no gap** — the pill is full height, inset by the
   1px border alone. Mine was inset 4pt with a 9pt radius, which read as a floating capsule.
4. **The setpoint row's own spec** — power/vent are almost certainly Buttons too. Ours currently
   breaks out of the content inset by a measured −12; find the real container.
5. **`status=BUSY`** — what it renders. We show nothing.

---

## 9. Implementation checklist

Done:

- [x] Bundle `UniversalSans-Text-Regular-430.ttf`; register in `TESLA_FONT_MAP`
- [x] Row = 60 tall, `paddingHorizontal` 10, `justifyContent: flex-start`, 20pt icon gap
- [x] Row label BodyLabel 14/20/0.1, icon 24
- [x] `borderWidth: 2`, `borderRadius: **5**`, no `borderCurve`
- [x] Idle `#8A8B8B` / engaged `#3368FF` + white
- [x] Setpoint 40/46/0 **Medium**, tracks `climateOn`
- [x] Content inset 28; setpoint row breaks out to 16
- [x] Activation-temperature row gated on COP === On

Open:

- [x] Border colour from source (§8.1); radius from the right component (§8.2)
- [x] Segmented control from its real component, `ToggleSelector` (§8.3)
- [ ] Camp/Pet icon names, then extract all five glyphs
- [ ] "Defrosting Car" status line
- [ ] `status=BUSY` treatment
- [ ] Sweep the rest of the app for Body/Caption tiers still rendering Medium now that Regular ships
