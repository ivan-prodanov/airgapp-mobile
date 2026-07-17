# `getAdjustedStatusBarHeight` — the verbatim device table (Round 9)

**Source of truth:** iOS `main.decompiled.js` (Tesla iOS **v4.56**). All line numbers are iOS bundle lines. The function was read **unfiltered** (`sed`, no grep) and then **independently re-derived by a second agent** and **adversarially verified by a third**; both confirmed the decode with no disagreement on any row.

---

## ⚠️ R7 §2b was WRONG. Correcting it loudly.

R7 §2b said:

> identifiers `iPhone13,1 / iPhone13 / iPhone14,4 / iPhone14,6 / iPhone14 / iPhone15 / iPhone16 / iPhone17 / iPhone18 → 59`; other notch → 47; non-notch → 50.

**Two separate failures, both mine:**

1. **It flattened four distinct return values into "→ 59".** The real function returns **50, 47, 59, and a library fallback** depending on the identifier. R7 read this function through a *filtered grep* that stripped every `if` statement, then inferred the mapping from **adjacency** of the surviving lines. That is the exact failure mode this round exists to fix.
2. **"other notch → 47; non-notch → 50" was fabricated.** There is **no notch predicate anywhere in this function.** I invented it to explain the leftover `47`/`50` constants that the filtered read had orphaned.

**Your hypothesis was correct on every row**, including `iPhone14,6 → 20` (it reaches 20 via the fallback, not a literal). The verify pass also caught that R7's framing was wrong *on its own terms*: **the 50-vs-47 split is MINI vs NON-MINI, not notch vs non-notch** — the iPhone 12 mini and 13 mini both *have* notches.

---

## §1. The verbatim function `[iOS-verified]`

**`getAdjustedStatusBarHeight`** — fn **#32534**, iOS **1338493-1338578**. (R7 called it "statusBarHeight"; that is not its name.)

Hermes decompiler note: `if(!(a !== b)) goto X` ≡ **`if (a === b) goto X`**; `if(!(a != b)) goto X` ≡ **`if (a == b) goto X`**. Getting this inverted flips the entire table.

### 1a. Complete branch chain, in source order

```
case 0:   r3 = <react-native-device-info>.default.getDeviceId()
          if (Platform.OS === 'android')   -> 280
case 47:  if (r3 === 'iPhone13,1')         -> 275     // EXACT ===
case 60:  if (r3.includes('iPhone13'))     -> 270     // SUBSTRING .includes
case 82:  if (r3 === 'iPhone14,4')         -> 265     // EXACT ===
case 95:  if (r3 === 'iPhone14,6')         -> 231     // EXACT === -> FALLBACK
case 108: if (r3.includes('iPhone14'))     -> 226     // SUBSTRING
case 127: if (r3 == null)                  -> 152     // optional-chaining guard (`?.`)
case 133: if (r3.includes('iPhone15'))     -> 221
case 152: if (r3 == null)                  -> 175
case 156: if (r3.includes('iPhone16'))     -> 221
case 175: if (r3 == null)                  -> 198
case 179: if (r3.includes('iPhone17'))     -> 221
case 198: if (r3 == null)                  -> 231
case 202: if (!r3.includes('iPhone18'))    -> 231
case 221: return 59
case 226: return 47
case 231: return <module 2451>.getStatusBarHeight()   // called with ZERO args
case 265: return 50
case 270: return 47
case 275: return 50
case 280: return <module 2439>.getTopInset()          // ANDROID
```
Verbatim sample (iOS 1338505-1338514) showing the exact-vs-substring pairing:
```js
case 95:
    r1 = 'iPhone14,6';
    if(!(r3 !== r1)) { _fun32534_ip = 231; continue _fun32534 }   // === -> fallback
case 108:
    r2 = r3.includes;
    r1 = 'iPhone14';
    r1 = r2.bind(r3)(r1);
    if(r1) { _fun32534_ip = 226; continue _fun32534 }             // substring -> 47
```

### 1b. Decision table (evaluation order) — matches real-world insets on **every** row

| # | test | operator | returns | devices | real iOS inset |
|---|---|---|---|---|---|
| 1 | `=== 'iPhone13,1'` | **exact** | **50** | 12 mini | 50 ✓ |
| 2 | `.includes('iPhone13')` | **substring** | **47** | 12 / 12 Pro / 12 Pro Max | 47 ✓ |
| 3 | `=== 'iPhone14,4'` | **exact** | **50** | 13 mini | 50 ✓ |
| 4 | `=== 'iPhone14,6'` | **exact** | **fallback → 20** | SE 3 | 20 ✓ |
| 5 | `.includes('iPhone14')` | **substring** | **47** | 13 / 13 Pro / 14 / 14 Plus | 47 ✓ |
| 6 | `.includes('iPhone15')` | **substring** | **59** | 14 Pro / Max, 15 / Plus | 59 ✓ |
| 7 | `.includes('iPhone16')` | **substring** | **59** | 15 Pro / Max | 59 ✓ |
| 8 | `.includes('iPhone17')` | **substring** | **59** | 16 family | 59 ✓ |
| 9 | `.includes('iPhone18')` | **substring** | **59** | 17 / Air — **incl. our `iPhone18,4`** | 59 ✓ |
| 10 | *(else)* | — | **fallback** | older / unknown | see §4 |
| 11 | *(android, checked first)* | — | **`getTopInset()`** | — | `[differ]` |

**No bytecode-vs-reality conflict to adjudicate** — the recovered table matches every real inset.

### 1c. Order is load-bearing in exactly three places

Each exact `===` carve-out is placed **before** the `.includes()` substring test that would otherwise swallow it. `.includes()` is **unanchored** — not `startsWith`, not a regex, not a map lookup:

| carve-out | must precede | if reordered |
|---|---|---|
| `'iPhone13,1'` (ip47) | `includes('iPhone13')` (ip60) | 12 mini regresses 50 → 47 |
| `'iPhone14,4'` (ip82) | `includes('iPhone14')` (ip108) | 13 mini regresses 50 → 47 |
| `'iPhone14,6'` (ip95) | `includes('iPhone14')` (ip108) | **SE 3 gets 47 — a 27pt phantom notch on a notchless phone** |

Latent substring hazard: a hypothetical `'iPhone130,1'` would match `includes('iPhone13')`. Not reachable today; worth knowing if you port the table.

---

## §2. Identifier source + format `[iOS-verified]`

The Specifications module's dependency map (iOS 1338726) is:
```js
r5 = [1, 1116, 5, 2439, 2451, 2432];
//    ^interop ^RNDI ^RN  ^getTopInset ^getStatusBarHeight ^SCREEN_HEIGHT/HAS_NOTCH
```

- **`_closure1_slot2.default` = moduleId 1116 = `react-native-device-info`** — *not* expo-device, *not* a Tesla native module. Evidence: the module emits `RNDeviceInfo_batteryLevelDidChange` / `RNDeviceInfo_powerStateDidChange` / `RNDeviceInfo_headphoneConnectionDidChange` (iOS 491780-492153) and exports `useIsHeadphonesConnected`, `useBrightness` (iOS 494730-494733).
- **`getDeviceId()`** (impl iOS 492568) resolves to:
  ```js
  getSupportedPlatformInfoSync({ defaultValue: 'unknown', memoKey: 'deviceId',
                                 getter: () => RNDeviceInfo.deviceId,
                                 supportedPlatforms: ['android','ios','windows'] })
  ```
  Note the **`defaultValue: 'unknown'`** — an unsupported platform yields `'unknown'`, which falls through to the fallback.
- **Format:** the raw `hw.machine` / `uname().machine` string, e.g. `"iPhone15,2"`. The literals in the table (`iPhone13,1`, `iPhone14,4`, `iPhone14,6`) unambiguously pin this format.
- **Is it the same as expo-device's `Device.modelId` (`"iPhone18,4"`)? Yes — same shape and same value in practice** `[INFERRED]`. Both surface `hw.machine`. This cannot be *proven* from the bundle (both are native reads), but the format is pinned by the literals. Your `Device.modelId` read is the right input.

---

## §3. The notch predicate — **there isn't one. Delete yours; don't replace it.** `[iOS-verified]`

`getAdjustedStatusBarHeight`'s entire body contains exactly **14 conditionals**: one `Platform.OS === 'android'` test, ten hardcoded iPhone identifier comparisons, and four `== null` optional-chaining guards. **No `hasNotch`, no screen-height test, no Dimensions read, no HAS_NOTCH reference.** R7 §2b's rule does not exist and *cannot* exist — no predicate implements it.

Your invented `insetTop > 20` has **no counterpart in the status-bar path**. Remove it; the replacement is the identifier table plus the `getStatusBarHeight()` fallback (§4).

**Where the fabricated rule probably came from:** there *is* a dimension test — but it lives one module away, inside the fallback (§4), and never influences the 47/50/59 literals.

**Tesla does have a real `HAS_NOTCH`** — just not for this. Defined in module **2432** (the same module as `SCREEN_HEIGHT`, fn #32420, iOS 1333927/1334019):
```js
HAS_NOTCH = <device-info>.default.hasNotch() || (Platform.OS === 'ios' && <module 6>.hasNotch())
```
It is consumed **only** by (iOS 1338592-1338616):
- `hamburgerTopPadding = HAS_NOTCH ? 0 : 5`
- `bottomNavBarHeight  = (Platform.OS === 'ios') ? (HAS_NOTCH ? 80 : 60) : 50`

Use it for those if you need them — **never for the status bar.**

---

## §4. The fallback + unknown-device behaviour `[iOS-verified]`

Case 231 calls **`require(2451).getStatusBarHeight()`** with **zero arguments** (so `skipAndroid` is `undefined`/falsy).

**Module 2451 = stock `react-native-status-bar-height`.** (Exports `getStatusBarHeight` + `isExpo`; contains `getExpoRoot` probing `global.Expo`/`__expo`/`__exponent`; deps `[5]` = react-native only.) A *second* `getStatusBarHeight` exists at iOS 3528829 — that one is **`react-native-iphone-x-helper`** and is **not** what case 231 resolves to. Ruled out by moduleId.

```js
// fn #32536, iOS 1338743
getStatusBarHeight(skipAndroid) = Platform.select({
    ios:     isIPhoneX ? 44 : 20,
    android: skipAndroid ? 0 : StatusBar.currentHeight,
    default: 0 })
```
```js
// fn #32535, iOS 1338782-1338822 — computed ONCE at module-eval time
const { height: H, width: W } = Dimensions.get('window');
let isIPhoneX = false;
if (Platform.OS === 'ios' && !Platform.isPad && !Platform.isTVOS)
    isIPhoneX = (W === 375 && H === 812) || (W === 414 && H === 896);
```
⇒ **44** iff the window is *exactly* 375×812 or 414×896 (and not iPad/tvOS). **20** for everything else. The `isPad`/`isTVOS` short-circuit is read verbatim from the bytecode (iOS 1338790-1338800). The flag is **frozen at module load** — it does not react to rotation or split-view.

### Why the architecture is shaped this way
The library is **correct for ≤ iPhone 11** (X/XS/11 Pro/XS Max/11 → 44; SE/6/7/8/SE2/SE3 → 20). Tesla's identifier table is a **patch on top for iPhone 12+**, which the stale library cannot know. Two consequences that explain the odd-looking rows:
- **SE 3 (`iPhone14,6`) is deliberately routed *back* to the library** — its 375×667 correctly yields 20. Delegating is cheaper than hardcoding.
- **The minis need exact carve-outs because the library gets them *wrong*.** The 12 mini and 13 mini are *also* 375×812, so the library would return **44** — but their real inset is **50**. Rows 1 and 3 exist precisely to override that.

### ⚠️ Unknown / newer devices: Tesla's fallback is stale, and fails to the *smallest* value
An identifier such as `'iPhone19,4'` falls through all 14 branches → case 231 → its dimensions (e.g. 402×874, 420×912, 440×956) match neither 375×812 nor 414×896 → `isIPhoneX = false` → **returns 20**.

**Not 44. Not 59. Twenty.** Any iPhone newer than the `iPhone18,x` generation gets the pre-notch SE value — roughly **39pt short**. It is a hardcoded allowlist that **requires an app update per hardware generation**, and it degrades to the *smallest* possible value rather than gracefully.

**This matters more for us than for Tesla**, because Climate bakes `sbh` into its height (`SCREEN_HEIGHT − statusBarHeight − 240`): a future phone would silently rescale the car by ~39pt. **Recommendation:** ship the table verbatim for exact parity on all shipping devices, but consider *deliberately deviating* in the fallback — e.g. fall back to `insets.top` instead of `getStatusBarHeight()` for unknown identifiers. That is a **conscious divergence from Tesla**, and should be commented as such. Our own device (`iPhone18,4` → row 9 → **59**) is unaffected and already verified on-device.

---

## §5. Export semantics + Android `[differ]`

Verbatim (fn #32533, iOS 1338579-1338592):
```js
r15 = 0;
if (Platform.OS === 'android') goto 294;        // android: r15 stays 0
case 290: r15 = getAdjustedStatusBarHeight();
case 294:
  r1 = {'edgePadding':20,'pillContainerHeight':24,'iconButtonBusyOpacity':0.5,
        'statusBarHeight':null,'headerHeight':54};
  r4 = getAdjustedStatusBarHeight();            // called AGAIN, unconditionally, all platforms
  r1['statusBarHeight'] = r4;                   // the fn's RESULT (not the fn)
  r1['statusBarOffset'] = r15;
```
- **iOS:** `Specifications.statusBarHeight` **===** `Specifications.statusBarOffset` **===** `getAdjustedStatusBarHeight()`. R7's claim that they're equal on iOS is **correct** `[INFERRED-but-solid: same function, frozen inputs, no side effects]`.
- **Android `[differ]`:** `statusBarHeight = getTopInset()`, but `statusBarOffset = 0`. R7's "android → 0" applies to **`statusBarOffset` only** — `statusBarHeight` is *not* 0 on Android.
- **`getTopInset()` = module 2439 = a Tesla-internal native wrapper**, `NativeModules.ScreenUtilsModule` (iOS 1335005-1335011), exporting `getScreenHeight`, `getScreenWidth`, `getTopInset`, `hasNotch`, `setNavigationBarColor`. Not a public library.

---

## §6. Drop-in reimplementation (iOS)

```ts
// Faithful port of Tesla's getAdjustedStatusBarHeight (iOS v4.56, fn #32534).
// ORDER IS LOAD-BEARING: the exact === checks must precede the .includes() checks,
// because 'iPhone14,6'.includes('iPhone14') === true.
function getAdjustedStatusBarHeight(): number {
  const id = Device.modelId;                     // hw.machine, e.g. "iPhone18,4"
  if (id === 'iPhone13,1') return 50;            // 12 mini
  if (id.includes('iPhone13')) return 47;        // 12 / Pro / Pro Max
  if (id === 'iPhone14,4') return 50;            // 13 mini
  if (id === 'iPhone14,6') return statusBarHeightFallback();  // SE 3 -> 20
  if (id.includes('iPhone14')) return 47;        // 13 / 14 / Plus
  if (id?.includes('iPhone15')) return 59;       // 14 Pro / 15
  if (id?.includes('iPhone16')) return 59;       // 15 Pro
  if (id?.includes('iPhone17')) return 59;       // 16
  if (id?.includes('iPhone18')) return 59;       // 17 / Air   <-- ours
  return statusBarHeightFallback();
}

// react-native-status-bar-height, evaluated ONCE at module load (Tesla's exact behaviour).
const { width: W, height: H } = Dimensions.get('window');
const isIPhoneX = Platform.OS === 'ios' && !Platform.isPad && !Platform.isTVOS
               && ((W === 375 && H === 812) || (W === 414 && H === 896));
function statusBarHeightFallback(): number { return isIPhoneX ? 44 : 20; }
// ^ NOTE: returns 20 for any future iPhone. See §4 — consider deviating deliberately.
```

---

## §7. Gaps (stated plainly)

- **Android v4.58 was not cross-checked** for the branch chain this round — every §1 finding is `[iOS-verified]` only. (Moot for us: we ship iOS, and Android takes the `getTopInset()` branch before any identifier test.)
- **`getTopInset()`'s unit (px vs dp) and value are UNRESOLVED** — it's native Java/Kotlin in `ScreenUtilsModule`, not in the JS bundle. `[Android-only]`
- **Simulator behaviour is UNRESOLVED from the bundle.** `SIMULATOR_MODEL_IDENTIFIER` has **0 hits** — the substitution lives in RNDI's ObjC. Known library behaviour `[INFERRED]`: a simulator yields `"arm64"`/`"x86_64"` unless the env var substitutes a real identifier; either way an unmatched value → fallback → 20.
- **expo-device `Device.modelId` ≡ RNDI `getDeviceId()`** is `[INFERRED]` from library semantics — both are native reads, unprovable from the bundle. The format is pinned by the literals.
- **Mac Catalyst is UNRESOLVED** — no branch exists on the reachable path. It would fall to case 231; `isPad` may be true there, forcing `isIPhoneX = false` → 20.
- **iPad**: no branch. `getDeviceId()` returns an `iPad*` identifier → no match → fallback; `Platform.isPad` short-circuits `isIPhoneX` → **20**. (The `isPad` short-circuit is read verbatim; "getDeviceId returns iPad*" is library semantics.)
- Real-world inset values used in the reconciliation column are **general iOS knowledge, not read from the bundle** — they are a sanity check on the read, not a source of truth. The bytecode is authoritative and agrees with them.

---

## §8. Citations (iOS v4.56)

- `getAdjustedStatusBarHeight` fn #32534: **1338493-1338578**; identifier literals 1338495 / 1338499 / 1338503 / 1338506 / 1338510 / 1338518 / 1338525 / 1338532 / 1338539; returns 221→59, 226→47, 231→fallback, 265→50, 270→47, 275→50, 280→getTopInset.
- Outer fn #32533 (Specifications): 1338428-1338592; depmap `[1,1116,5,2439,2451,2432]` @1338726; exports @1338589-1338590; `HAS_NOTCH` uses @1338592-1338616.
- `react-native-device-info` = module 1116: `getDeviceId` @492568; `RNDeviceInfo_*` events @491780-492153; hooks @494730-494733.
- `react-native-status-bar-height` = module 2451: `getStatusBarHeight` fn #32536 @1338743; `isIPhoneX` fn #32535 @1338782-1338822 (isPad/isTVOS @1338790-1338800); module id @1338852. Not-this-one: `react-native-iphone-x-helper` @3528829.
- `ScreenUtilsModule` = module 2439 @1335005-1335011.
- `HAS_NOTCH` / `SCREEN_HEIGHT` = module 2432, fn #32420 @1333927 / 1334019.
