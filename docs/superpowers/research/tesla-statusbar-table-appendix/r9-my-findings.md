# R9 — my independent read (iOS main.decompiled.js v4.56)

## R7 §2b WAS FLATTENED — the team is right. 4 distinct returns collapsed into "→59", and I FABRICATED the notch predicate.

## THE FUNCTION: `getAdjustedStatusBarHeight` (fn #32534, iOS 1338493-1338578) — VERBATIM control flow
Hermes: `if(!(a !== b)) goto X` ≡ **if (a === b) goto X**;  `if(!(a != b)) goto X` ≡ **if (a == b) goto X**.
```
case 0:   r3 = <deviceInfo>.default.getDeviceId()
          if (Platform.OS === 'android') -> 280
case 47:  if (r3 === 'iPhone13,1')        -> 275        // EXACT ===
case 60:  if (r3.includes('iPhone13'))    -> 270        // SUBSTRING .includes
case 82:  if (r3 === 'iPhone14,4')        -> 265        // EXACT
case 95:  if (r3 === 'iPhone14,6')        -> 231        // EXACT -> FALLBACK
case 108: if (r3.includes('iPhone14'))    -> 226        // SUBSTRING
case 127: if (r3 == null) -> 152                        // null-guards = source `?.` optional chaining
case 133: if (r3.includes('iPhone15'))    -> 221
case 152: if (r3 == null) -> 175
case 156: if (r3.includes('iPhone16'))    -> 221
case 175: if (r3 == null) -> 198
case 179: if (r3.includes('iPhone17'))    -> 221
case 198: if (r3 == null) -> 231
case 202: if (!r3.includes('iPhone18'))   -> 231
case 221: return 59
case 226: return 47
case 231: return <module 4>.getStatusBarHeight()        // library fallback
case 265: return 50
case 270: return 47
case 275: return 50
case 280: return <module 3>.getTopInset()               // ANDROID
```

### DECISION TABLE (evaluation order matters!)
| # | test | op | returns | device | real inset |
|---|------|----|---------|--------|-----------|
| 1 | `=== 'iPhone13,1'` | exact | **50** | 12 mini | 50 ✓ |
| 2 | `.includes('iPhone13')` | substring | **47** | 12 / 12 Pro / 12 Pro Max | 47 ✓ |
| 3 | `=== 'iPhone14,4'` | exact | **50** | 13 mini | 50 ✓ |
| 4 | `=== 'iPhone14,6'` | exact | **getStatusBarHeight() → 20** | SE 3 | 20 ✓ |
| 5 | `.includes('iPhone14')` | substring | **47** | 13 / 13 Pro / 14 / 14 Plus | 47 ✓ |
| 6 | `.includes('iPhone15')` | substring | **59** | 14 Pro/Max, 15/Plus | 59 ✓ |
| 7 | `.includes('iPhone16')` | substring | **59** | 15 Pro/Max | 59 ✓ |
| 8 | `.includes('iPhone17')` | substring | **59** | 16 family | 59 ✓ |
| 9 | `.includes('iPhone18')` | substring | **59** | 17 / Air (incl. **iPhone18,4** = ours) | 59 ✓ |
| 10 | else | — | **getStatusBarHeight()** | older/unknown | see below |
| 11 | android | — | **getTopInset()** | — | [differ] |

**ORDER IS LOAD-BEARING**: rows 1/3/4 (exact) MUST precede rows 2/5 (substring), because
`'iPhone14,6'.includes('iPhone14') === true` — reorder and the SE 3 gets 47 instead of 20.
Substring hazard: `.includes` not `startsWith` ⇒ a hypothetical 'iPhone130,1' would match row 2.

## THE FALLBACK: `getStatusBarHeight` = **react-native-status-bar-height** (fn #32536, iOS 1338743)
```
getStatusBarHeight(skipAndroid) = Platform.select({
    ios:     isIPhoneWithMonobrow ? 44 : 20,
    android: skipAndroid ? 0 : StatusBar.currentHeight,
    default: 0 })
```
`isIPhoneWithMonobrow` (fn #32535, iOS 1338782-1338822) — **hardcoded dimension check**:
```
const {height: H, width: W} = Dimensions.get('window');
let isIPhoneWithMonobrow = false;
if (Platform.OS === 'ios' && !Platform.isPad && !Platform.isTVOS)
    isIPhoneWithMonobrow = (W === 375 && H === 812) || (W === 414 && H === 896);
```
⇒ ONLY iPhone X/XS/11Pro (375×812) and XSMax/11ProMax/11 (414×896) → **44**. Everything else → **20**.

### Why the design works — and where it BREAKS
The library is correct for **≤ iPhone 11**: X/XS/11Pro/XSMax/11ProMax → 44; SE/6/7/8/SE2/SE3 → 20.
Tesla's identifier table is a **patch on top for iPhone 12+**, which the stale library doesn't know.
SE 3 is explicitly routed BACK to the library (row 4) because its 375×667 correctly yields 20.
⚠️ **BUT the fallback is STALE for FUTURE devices**: an unknown `iPhone19,x` (e.g. 402×874 / 420×912)
→ monobrow **false** → **20**. Not 44, not 59. Tesla's own code returns 20 for the next iPhone.
Copying faithfully means inheriting that bug (Climate's height bakes in sbh ⇒ ~39pt error).

## THE NOTCH PREDICATE — R7 §2b's "other notch → 47; non-notch → 50" IS FABRICATED
`getAdjustedStatusBarHeight` contains **NO notch test of any kind**. The 47/50 are per-identifier constants.
Tesla DOES have a separate `HAS_NOTCH` (module of SCREEN_HEIGHT, fn #32420, iOS 1333927/1334019):
```
HAS_NOTCH = <deviceInfo>.default.hasNotch() || (Platform.OS === 'ios' && <module 6>.hasNotch())
```
…but it is used ONLY for `hamburgerTopPadding = HAS_NOTCH ? 0 : 5` and
`bottomNavBarHeight = (OS==='ios') ? (HAS_NOTCH ? 80 : 60) : 50` — **never for the status bar.**
⇒ The team's invented `insetTop > 20` has NO counterpart: delete it, don't replace it.

## EXPORT SEMANTICS (fn #32533, iOS 1338579-1338592) VERBATIM
```
r15 = 0;
if (Platform.OS === 'android') goto 294;      // android: r15 stays 0
case 290: r15 = getAdjustedStatusBarHeight();
case 294:
  r1 = {'edgePadding':20,'pillContainerHeight':24,'iconButtonBusyOpacity':0.5,'statusBarHeight':null,'headerHeight':54};
  r4 = getAdjustedStatusBarHeight();          // called AGAIN, unconditionally, ALL platforms
  r1['statusBarHeight'] = r4;                 // = fn RESULT (not the fn)
  r1['statusBarOffset'] = r15;                // = 0 on android, else fn result
```
⇒ **iOS: statusBarHeight === statusBarOffset === getAdjustedStatusBarHeight()** (R7 correct here).
⇒ **Android [differ]: statusBarHeight = getTopInset(); statusBarOffset = 0.** (R7's "android → 0" = statusBarOffset only.)
