# R10 — my independent read (iOS main.decompiled.js v4.56)

## 🔑 THE CAR-COLOUR LOGIC — FOUND. It is a TWO-TIER rule (computed HSB, falling back to a paint-enum table).

### Tier 1 (preferred): `isLightHSB(h, s, b)` — fn #30231, iOS 1240024-1240050. VERBATIM decode.
Hermes note: `if(!(!(x))) goto Y` ≡ **if (x) goto Y** (double negation).
```js
function isLightHSB(h, s, b) {
  if (b > 0.55) return true;    // case 0  -> 68
  if (b < 0.38) return false;   // case 17 -> 64
  if (s < 0.3)  return true;    // case 31 -> 60
  return h < 180;               // case 48 (warm hue = light, cool hue = dark)
}
```
Exported `r2['isLightHSB'] = r9` @1240053; also @1220431.

### Tier 2 (fallback): `isLightColorFor(paintEnum)` — fn #12652, iOS 500287-500440; export @500442.
Flat `===` chain over paint enum `_closure1_slot9`:
- **→ case 581 `r0 = true; return r0`** (LIGHT): `null`, `undefined`, `TYPE_NOT_SET`, `UNKNOWN`, `PEARLWHITE`, `WHITE`, `PEARL`, `SILKROADSILVER`
- **→ case 577 `r0 = false; return r0`** (DARK): `REDMULTICOAT, SOLIDBLACK, SILVERMETALLIC, MIDNIGHTSILVER, DEEPBLUE, DEFAULTCOLOR, BLACK, SILVER, GREY, BLUE, GREEN, BROWN, SIGRED, RED, STEELGREY, METALLICBLACK, …, ULTRARED, STEALTHGREY, LUNARSILVER, GLACIERBLUE, DIAMONDBLACK, FROSTBLUE, MARINEBLUE, GARNETRED`
- **→ case 575 `return r0`** where r0 = **undefined** — for an enum member not listed (falsy ⇒ treated as dark).
NOTE the default: null/undefined/UNKNOWN ⇒ **true (light)**.

### The selector: `hasLightExteriorColor(state)` — fn #30232, iOS 1240055; export @1240114 (also @1220299).
```
if (carType === CARTYPECYBERTRUCK) return false;     // case 165
else return isLightColorFor(<paint getter _closure1_slot149>(state));
```
**Only ONE consumer in the whole bundle: iOS 4037242** — the Controls module (fn #98593). Confirms the user: this is Controls-only.
Controls builds a `createSelector` → `_closure1_slot12` = `{ lightExteriorColor: hasLightExteriorColor(state), vehicleId: getSelectedVehicleId(state) }` (iOS 4037238-4037249).
Consumed once, iOS 4039294: `r12 = r0.lightExteriorColor` via `useShallowEqualSelector(_closure1_slot12)`.

### How the two tiers combine (Controls fn #98619, iOS 4039810-4039843) VERBATIM
```
case 1174: r2 = r17.frunk_color;              // HSB triple off the vehicle config
case 1182: r31 = r12;                         // DEFAULT = lightExteriorColor (enum tier)
           if (r2 == null) goto 1249;         // no frunk_color -> keep enum result
case 1189: r31 = r12;
           if (!(r2.length >= 3)) goto 1249;  // malformed -> keep enum result
case 1204: r31 = isLightHSB(r2[0], r2[1], r2[2]);   // frunk_color HSB wins
case 1249: ...
```
⇒ **`isLight` = frunk_color(HSB) present && length>=3 ? isLightHSB(h,s,b) : hasLightExteriorColor(state)**

### The colour decision (Controls fn #98619, iOS 4040340-4040353) VERBATIM
```
           if (!r31) goto 3082;                     // NOT light  -> textColorGray
case 3069: if (!r7)  goto 3094;                     // light      -> textColorDark
case 3072: r31 = r23.frunk_opened;
           if (!(r31 === r41)) goto 3094;           //            -> textColorDark
case 3082: r31 = styles.textColorGray;
case 3094: r31 = styles.textColorDark;
case 3106: r36['textStyle'] = r31;
```
(r7 / r41 identities still to resolve — reader/verifier.)

### THE STYLE LITERALS (Controls module StyleSheet, iOS 4041133-4041151) VERBATIM
```js
r1['textButton']    = { height: 30, minHeight: 0, paddingVertical: 0 };
r1['textColorDark'] = { color: Colors.transparentBlack70, fontSize: 18 };   // LIGHT car
r1['textColorGray'] = { color: Colors.transparentWhite70, fontSize: 18 };   // DARK car
```
Colors palette (iOS 1338464, dumped in R9): `transparentBlack70 = 'rgba(0,0,0,0.7)'`; `transparentWhite70 = 'rgba(255,255,255,0.7)'`.

⇒ **RED Model Y (user's car) → `rgba(255,255,255,0.7)` @ 18px**
⇒ **WHITE car → `rgba(0,0,0,0.7)` @ 18px**
Team currently ships `{fontSize:19, fontWeight:'600', color:'rgba(255,255,255,0.92)'}` — **wrong on all three**:
fontSize 18 not 19; **NO fontWeight** (regular, inherited); alpha **0.7** not 0.92.
Markers are **Button** components with `appearance: ButtonAppearance.GHOST` (R7 saw @4040608-4040612),
`style = [textButton, disabled ? disabledStyle : {}]`, `textStyle = <the above>`.

## Bottom button row (§2.5)
`VehicleControlButtonType.{FLASH_LIGHTS, HONK_HORN, REMOTE_START, HOME_LINK, VENT}` (iOS 4037262-4037300),
via `getOptionalVehicleControlButtonsForSelectedVehicle` (createSelector @4037255).
