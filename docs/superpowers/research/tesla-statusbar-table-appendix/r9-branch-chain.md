# R9 §1 — `getAdjustedStatusBarHeight` independent re-derivation

Source: `/Users/ivan/Downloads/tesla-haptics-work/main.decompiled.js` (Tesla iOS v4.56), fn **#32534**, lines **1338482–1338578**. Read with `sed -n '1338480,1338600p'` — **no grep filter**.

Module context: this lives in **module 2450** (the `Specifications`/`Colors`/`Gray`/`Spacing` design-tokens module), registered at line 1338725–1338727:

```
r6 = 2450;
r5 = [1, 1116, 5, 2439, 2451, 2432];
r5 = r8.bind(r2)(r7, r6, r5);
```

Dependency map resolution (verified):

| dep idx | module id | what it is | evidence |
|---|---|---|---|
| 0 | 1 | babel `interopRequireDefault` helper | `r4 = r6.bind(r0)(r5[0])` used as interop wrapper at 1338437/1338457 |
| 1 | **1116** | **device-info** — exports `getDeviceId` | line ~494604 `r1['getDeviceId'] = r132;`, module id at 494737 |
| 2 | **5** | **react-native** — `Platform` | `_closure1_slot3 = require(dep[2])`, used as `.Platform.OS` |
| 3 | **2439** | native inset module — exports `getTopInset`, `getBottomInset`, `hasNotch`, `setNavigationBarColor` | line ~1334953 `Original name: getTopInset`, module id at 1335011 |
| 4 | **2451** | `react-native-status-bar-height` — exports `getStatusBarHeight`, `isExpo` | fn #32535/#32536 at 1338729–1338852, module id 2451 |
| 5 | 2432 | constants module exposing `HAS_NOTCH` | used by the **outer** fn only (see §Outer) |

Closure slots (established in fn #32533, lines 1338429–1338462):

```
1338431:  r6 = a1;              // require
1338433:  r5 = a6;              // dependencyMap
1338434:  var _closure1_slot0 = r6;     // = require
1338435:  var _closure1_slot1 = r5;     // = dependencyMap
1338454:  r3 = 1;
1338455:  r3 = r5[r3];                  // dep[1] = 1116
1338456:  r3 = r6.bind(r0)(r3);         // require(1116)
1338457:  r3 = r4.bind(r0)(r3);         // _interopRequireDefault(...)
1338458:  var _closure1_slot2 = r3;     // = deviceInfoModule (has .default)
1338459:  r3 = 2;
1338460:  r4 = r5[r3];                  // dep[2] = 5
1338461:  r7 = r6.bind(r0)(r4);         // require('react-native')
1338462:  var _closure1_slot3 = r7;     // = react-native
```

So `_closure1_slot1[4]` = dep id **2451** (`getStatusBarHeight`) and `_closure1_slot1[3]` = dep id **2439** (`getTopInset`).

---

## 1. Verbatim bytecode dump (lines 1338482–1338578)

```js
            r4 = function() { // Original name: getAdjustedStatusBarHeight, environment: r1
                _fun32534: for(var _fun32534_ip = 0; ; ) switch(_fun32534_ip) {
case 0:
                    r1 = _closure1_slot2;
                    r2 = r1.default;
                    r1 = r2.getDeviceId;
                    r3 = r1.bind(r2)();
                    r1 = _closure1_slot3;
                    r1 = r1.Platform;
                    r2 = r1.OS;
                    r1 = 'android';
                    if(!(r2 !== r1)) { _fun32534_ip = 280; continue _fun32534 }
case 47:
                    r1 = 'iPhone13,1';
                    if(!(r3 !== r1)) { _fun32534_ip = 275; continue _fun32534 }
case 60:
                    r2 = r3.includes;
                    r1 = 'iPhone13';
                    r1 = r2.bind(r3)(r1);
                    if(r1) { _fun32534_ip = 270; continue _fun32534 }
case 82:
                    r1 = 'iPhone14,4';
                    if(!(r3 !== r1)) { _fun32534_ip = 265; continue _fun32534 }
case 95:
                    r1 = 'iPhone14,6';
                    if(!(r3 !== r1)) { _fun32534_ip = 231; continue _fun32534 }
case 108:
                    r2 = r3.includes;
                    r1 = 'iPhone14';
                    r1 = r2.bind(r3)(r1);
                    if(r1) { _fun32534_ip = 226; continue _fun32534 }
case 127:
                    r1 = null;
                    if(!(r3 != r1)) { _fun32534_ip = 152; continue _fun32534 }
case 133:
                    r4 = r3.includes;
                    r2 = 'iPhone15';
                    r2 = r4.bind(r3)(r2);
                    if(r2) { _fun32534_ip = 221; continue _fun32534 }
case 152:
                    if(!(r3 != r1)) { _fun32534_ip = 175; continue _fun32534 }
case 156:
                    r4 = r3.includes;
                    r2 = 'iPhone16';
                    r2 = r4.bind(r3)(r2);
                    if(r2) { _fun32534_ip = 221; continue _fun32534 }
case 175:
                    if(!(r3 != r1)) { _fun32534_ip = 198; continue _fun32534 }
case 179:
                    r4 = r3.includes;
                    r2 = 'iPhone17';
                    r2 = r4.bind(r3)(r2);
                    if(r2) { _fun32534_ip = 221; continue _fun32534 }
case 198:
                    if(!(r3 != r1)) { _fun32534_ip = 231; continue _fun32534 }
case 202:
                    r2 = r3.includes;
                    r1 = 'iPhone18';
                    r1 = r2.bind(r3)(r1);
                    if(!r1) { _fun32534_ip = 231; continue _fun32534 }
case 221:
                    r1 = 59;
                    return r1;
case 226:
                    r1 = 47;
                    return r1;
case 231:
                    r3 = _closure1_slot0;
                    r2 = _closure1_slot1;
                    r1 = 4;
                    r1 = r2[r1];
                    r2 = undefined;
                    r1 = r3.bind(r2)(r1);
                    r1 = r1.getStatusBarHeight;
                    r1 = r1.bind(r2)();
                    return r1;
case 265:
                    r1 = 50;
                    return r1;
case 270:
                    r1 = 47;
                    return r1;
case 275:
                    r1 = 50;
                    return r1;
case 280:
                    r2 = _closure1_slot0;
                    r1 = _closure1_slot1;
                    r0 = 3;
                    r0 = r1[r0];
                    r1 = undefined;
                    r0 = r2.bind(r1)(r0);
                    r0 = r0.getTopInset;
                    r0 = r0.bind(r1)();
                    return r0;
                }
            };
```

## 1b. Complete branch chain, in source order, every operator + target + return

Hermes idiom key: `if(!(a !== b)) goto X` ⇒ **if (a === b) goto X**. `if(!(a != b)) goto X` ⇒ **if (a == b) goto X**.

| ip | test | operator | true → | meaning |
|---|---|---|---|---|
| 0 | `r3 = DeviceInfo.default.getDeviceId()` — no args | — | — | fetch identifier |
| 0 | `Platform.OS === 'android'` | `===` (via `!(!==)`) | **280** | android early-out |
| 47 | `r3 === 'iPhone13,1'` | **`===` exact** | **275** | → return 50 |
| 60 | `r3.includes('iPhone13')` | **`.includes()` substring** | **270** | → return 47 |
| 82 | `r3 === 'iPhone14,4'` | **`===` exact** | **265** | → return 50 |
| 95 | `r3 === 'iPhone14,6'` | **`===` exact** | **231** | → return `getStatusBarHeight()` |
| 108 | `r3.includes('iPhone14')` | **`.includes()` substring** | **226** | → return 47 |
| 127 | `r3 == null` | `==` loose (optional-chain guard) | 152 | skips the iPhone15 probe |
| 133 | `r3.includes('iPhone15')` | **`.includes()` substring** | **221** | → return 59 |
| 152 | `r3 == null` | `==` loose | 175 | skips iPhone16 probe |
| 156 | `r3.includes('iPhone16')` | **`.includes()` substring** | **221** | → return 59 |
| 175 | `r3 == null` | `==` loose | 198 | skips iPhone17 probe |
| 179 | `r3.includes('iPhone17')` | **`.includes()` substring** | **221** | → return 59 |
| 198 | `r3 == null` | `==` loose | **231** | null → `getStatusBarHeight()` |
| 202 | `!r3.includes('iPhone18')` | **`.includes()` substring, negated** | **231** | miss → `getStatusBarHeight()`; hit falls through to 221 → 59 |

Return blocks (all four constants + two calls):

| ip | returns |
|---|---|
| 221 | literal **59** |
| 226 | literal **47** |
| 231 | `require(dep[4]=2451).getStatusBarHeight()` — **called with zero arguments** |
| 265 | literal **50** |
| 270 | literal **47** |
| 275 | literal **50** |
| 280 | `require(dep[3]=2439).getTopInset()` |

The `r3 == null` guards at 127/152/175/198 are Babel/Hermes codegen for `deviceId?.includes(...)`. Note the asymmetry: the **first three** exact/`includes` checks (ips 47, 60, 82, 95, 108) are **unguarded** — they call `r3.includes` directly. If `getDeviceId()` returned `null`, ip 60 would **throw** before ever reaching the null guard at 127. So the `?.` guards are dead code in practice on the null path (unreachable), a source-level inconsistency rather than a real behavior.

---

## 2. Decision table (evaluation order; order-sensitivity called out)

| # | identifier matched | operator | result | order load-bearing? |
|---|---|---|---|---|
| 1 | `Platform.OS === 'android'` | `===` | `getTopInset()` (native) | yes — precedes all device checks; on Android `getDeviceId()` returns e.g. `SM-G991B`, never reaches the iPhone chain |
| 2 | `'iPhone13,1'` | `===` exact | **50** | **YES** — must precede #3; `'iPhone13,1'.includes('iPhone13')` is `true`, so reordering makes iPhone13,1 return 47 |
| 3 | `includes('iPhone13')` | substring | **47** | catches iPhone13,2 / 13,3 / 13,4 (and would re-catch 13,1 if #2 removed) |
| 4 | `'iPhone14,4'` | `===` exact | **50** | **YES** — must precede #6 |
| 5 | `'iPhone14,6'` | `===` exact | `getStatusBarHeight()` → **20** on iOS | **YES** — must precede #6. Confirmed: the `iPhone14,6` exact check is at **ip 95**, the `includes('iPhone14')` substring is at **ip 108**. Exact comes FIRST. If reordered, SE3 returns 47 (a notch inset on a notchless phone). |
| 6 | `includes('iPhone14')` | substring | **47** | catches iPhone14,2/14,3/14,5/14,7/14,8 |
| 7 | `?.includes('iPhone15')` | substring | **59** | no |
| 8 | `?.includes('iPhone16')` | substring | **59** | no |
| 9 | `?.includes('iPhone17')` | substring | **59** | no |
| 10 | `?.includes('iPhone18')` | substring | **59** | no |
| 11 | anything else / `null` | fallthrough | `getStatusBarHeight()` | terminal default |

**Summary of order-sensitivity:** the three exact `===` checks (`iPhone13,1`, `iPhone14,4`, `iPhone14,6`) are all deliberately placed **before** their corresponding `includes()` substring checks. Each is a carve-out that the substring check would otherwise swallow. Reordering any of them silently breaks exactly one device family.

---

## 3. Reconciliation against real iOS top insets

| device | identifier | code path | code returns | real inset | verdict |
|---|---|---|---|---|---|
| iPhone 12 mini | iPhone13,1 | #2 exact | 50 | 50 | ✅ |
| iPhone 12 / 12 Pro / 12 Pro Max | iPhone13,2/3/4 | #3 substring | 47 | 47 | ✅ |
| iPhone 13 mini | iPhone14,4 | #4 exact | 50 | 50 | ✅ |
| iPhone SE 3 | iPhone14,6 | #5 exact → `getStatusBarHeight()` | **20** (see below) | 20 | ✅ |
| iPhone 13 / 13 Pro / 13 Pro Max / 14 / 14 Plus | iPhone14,2/3/5/7/8 | #6 substring | 47 | 47 | ✅ |
| iPhone 14 Pro / 14 Pro Max / 15 family | iPhone15,x | #7 | 59 | 59 | ✅ |
| iPhone 15 Pro / 16e | iPhone16,x | #8 | 59 | 59 | ✅ |
| iPhone 16 family | iPhone17,x | #9 | 59 | 59 | ✅ |
| iPhone 17 / Air | iPhone18,x | #10 | 59 | 59 | ✅ |

**The recovered table matches reality on every row.** Bytecode and reality agree here, so no conflict to adjudicate.

### Why `iPhone14,6` → `getStatusBarHeight()` → 20

Traced into module **2451** (fn #32535/#32536, lines 1338729–1338852). This is stock `react-native-status-bar-height`. At module load it computes an "isIPhoneX" flag into `_closure1_slot2`:

```js
r6 = r4.height;  r5 = r4.width;     // Dimensions.get('window')
r4 = false;  var _closure1_slot2 = r4;
if (Platform.OS === 'ios') {
  if (!Platform.isPad) {
    if (!Platform.isTVOS) {
      r3 = (width === 375);
      if (r3) r3 = (height === 812);
      if (!r3) {
        r4 = (width === 414);
        if (r4) r4 = (height === 896);
        r3 = r4;
      }
      _closure1_slot2 = r3;          // isIPhoneX
    }
  }
}
```

and `getStatusBarHeight(a0)`:

```js
Platform.select({
  ios:     isIPhoneX ? 44 : 20,
  android: a0 ? 0 : StatusBar.currentHeight,
  default: 0
})
```

fn #32534 calls it as `r1.bind(r2)()` — **zero arguments**, so `a0 === undefined` (falsy). On iOS the `android` key is irrelevant.

SE3 is 375×667 → matches neither `375×812` nor `414×896` → `isIPhoneX = false` → **20**. ✅ matches the real SE3 inset.

---

## 4. Is there ANY notch predicate / screen-height test / hasNotch flag in `getAdjustedStatusBarHeight`?

**No. Unambiguously no.**

`getAdjustedStatusBarHeight` (fn #32534, lines 1338482–1338578) contains **exactly 14 conditional branches**, enumerated exhaustively in §1b. Every one of them is either:
- a `Platform.OS === 'android'` test, or
- a string comparison against a hardcoded `iPhoneNN[,M]` literal (`===` or `.includes()`), or
- a `== null` optional-chaining guard.

There is **no** `hasNotch`, **no** `HAS_NOTCH`, **no** `Dimensions.get(...)`, **no** height/width comparison, **no** safe-area lookup, and **no** boolean notch flag anywhere in the function body. Verified by unfiltered read of the full 97-line body — the dump in §1 is the entire function, start brace to end brace.

**R7 §2b's claimed rule "other notch → 47; non-notch → 50" does not exist in this function.** There is no predicate that could implement it. The literal `50` is returned from exactly two ips (265, 275), both reached only by an **exact `===` match on a specific device string** (`iPhone14,4` and `iPhone13,1` — the two *mini* models), not by any notch test. Both of those devices *have* notches, which directly contradicts R7's "non-notch → 50" framing. The 50/47 split is **mini vs. non-mini**, not notch vs. non-notch.

### Where notch tests DO exist (nearby — likely the source of R7's confusion)

Two real notch predicates live **outside** fn #32534:

**(a) In the OUTER fn #32533**, at lines 1338592–1338616, `HAS_NOTCH` comes from `require(dep[5]=2432)` and drives two *other* properties:

```js
case 294:  ...
           r4 = 5;
           r17 = r5[r4];
           r17 = r6.bind(r0)(r17);       // require(dep[5] = 2432)
           r18 = r17.HAS_NOTCH;
           r17 = r4;                     // r17 = 5
           if(!r18) { _fun32533_ip = 352; continue _fun32533 }
case 350:
           r17 = 0;
case 352:
           r1['hamburgerTopPadding'] = r17;       // HAS_NOTCH ? 0 : 5
           r17 = r7.Platform;
           r19 = r17.OS;
           r18 = 50;
           r17 = 'ios';
           if(!(r19 === r17)) { _fun32533_ip = 405; continue _fun32533 }
case 378:
           r19 = r5[r4];
           r19 = r6.bind(r0)(r19);
           r21 = r19.HAS_NOTCH;
           r19 = 60;
           if(!r21) { _fun32533_ip = 402; continue _fun32533 }
case 399:
           r19 = 80;
case 402:
           r18 = r19;
case 405:
           r1['bottomNavBarHeight'] = r18;        // ios ? (HAS_NOTCH ? 80 : 60) : 50
```

⇒ `hamburgerTopPadding = HAS_NOTCH ? 0 : 5`; `bottomNavBarHeight = (Platform.OS === 'ios') ? (HAS_NOTCH ? 80 : 60) : 50`. **Neither touches statusBarHeight/statusBarOffset.**

**(b) The `isIPhoneX` screen-dimension test inside module 2451** (quoted in §3). This *is* a screen-height test, but it is a transitive dependency reached only via the `getStatusBarHeight()` fallback — it is not a branch in fn #32534, and it never influences the 47/50/59 literals.

Note also that module **2439** exports a `hasNotch` function (line ~1334960, `Original name: hasNotch`) — available to this module via dep[3], but fn #32534 only ever pulls `.getTopInset` off it.

---

## 5. What does an unknown/newer identifier (e.g. `'iPhone19,4'`) return?

**Exact trace** for `r3 = 'iPhone19,4'` on iOS:

| ip | evaluation | outcome |
|---|---|---|
| 0 | `Platform.OS === 'android'` → `'ios' === 'android'` = false | fall through |
| 47 | `'iPhone19,4' === 'iPhone13,1'` = false | fall through |
| 60 | `'iPhone19,4'.includes('iPhone13')` = false | fall through |
| 82 | `=== 'iPhone14,4'` = false | fall through |
| 95 | `=== 'iPhone14,6'` = false | fall through |
| 108 | `.includes('iPhone14')` = false | fall through |
| 127 | `'iPhone19,4' == null` = false | fall through |
| 133 | `.includes('iPhone15')` = false | fall through |
| 152 | `== null` = false | fall through |
| 156 | `.includes('iPhone16')` = false | fall through |
| 175 | `== null` = false | fall through |
| 179 | `.includes('iPhone17')` = false | fall through |
| 198 | `== null` = false | fall through |
| 202 | `!('iPhone19,4'.includes('iPhone18'))` = `!false` = **true** | **→ 231** |
| 231 | `return require(2451).getStatusBarHeight()` | |

Then inside module 2451: `isIPhoneX` = `ios && !isPad && !isTVOS && ((w===375 && h===812) || (w===414 && h===896))`.

A hypothetical iPhone19,4 will have neither 375×812 nor 414×896 logical dimensions (those are the iPhone X/XS and XR/11 sizes; every device from the 12 onward differs) ⇒ `isIPhoneX = false` ⇒ **returns 20**.

**This is a latent bug.** Any iPhone newer than the iPhone18,x generation falls off the end of the hardcoded chain and gets **20** — the pre-notch SE value — instead of the ~59 it actually needs. The fallback is not a graceful degrade; it degrades to the *smallest* possible value, roughly 39pt short. Ships as a hardcoded allowlist requiring an app update per hardware generation. (Same for iPad: `getDeviceId()` on iPad returns `iPad*`, matches nothing, → `getStatusBarHeight()` → `isIPhoneX` false because `Platform.isPad` short-circuits → **20**.)

---

## 6. `.includes()` substring hazards

**Does an earlier branch swallow a later device?** In the shipped order — **no**, but only because three exact-match carve-outs are placed first. The design is intentional and fragile.

1. **`'iPhone13'` vs `'iPhone13,1'` — YES, `'iPhone13,1'.includes('iPhone13')` is `true`.** This is a live hazard, defused only by ordering: the exact `=== 'iPhone13,1'` at ip 47 fires first and returns 50. Swap ips 47 and 60 and the iPhone 12 mini silently regresses 50 → 47.

2. **`'iPhone14'` swallows both `'iPhone14,4'` and `'iPhone14,6'`.** Both are `true` under `.includes('iPhone14')`. Defused by the exact checks at ip 82 (→50) and ip 95 (→`getStatusBarHeight()`) preceding ip 108. Answering the question asked directly: **yes, the `iPhone14,6` exact check (ip 95) precedes the `iPhone14` substring check (ip 108)** — verified in the raw dump. If reordered, SE3 would get **47** instead of **20**, i.e. a 27pt phantom notch inset on a device with no notch — the most visible of the three reorder failures.

3. **Identifiers matching two patterns:** every `iPhone13,x` matches both #2/#3 or just #3; every `iPhone14,x` matches #4/#5/#6 or just #6. Resolution is purely first-match-wins via the switch's fallthrough order. No identifier matches two *different-generation* patterns — `'iPhone15'`, `'iPhone16'`, `'iPhone17'`, `'iPhone18'` are mutually exclusive as substrings of any real `iPhoneNN,M` string.

4. **Prefix-extension hazard (latent, not yet live):** `.includes()` is an unanchored substring test, so `'iPhone13'` would also match a hypothetical `'iPhone130,1'`, and `'iPhone1'`-style short needles would be catastrophic. Apple's identifiers are currently 2-digit (`iPhone13`–`iPhone18`), so this is inert today. It becomes live at `iPhone100+` — not a practical concern. However, note there is **no `iPhone12` / `iPhone11` / `iPhone10` branch at all**: those older devices (iPhone 11 = `iPhone12,x`, XS = `iPhone11,x`, X = `iPhone10,x`) fall to the `getStatusBarHeight()` default, where `isIPhoneX` correctly resolves them to 44 via the 375×812 / 414×896 dimension test. So the pre-12 lineup is handled by the library, and the hardcoded chain only covers iPhone 12 and newer. Worth flagging: `.includes('iPhone13')` does **not** match `'iPhone130,1'`-class strings today, but it also does **not** accidentally catch `'iPhone12,1'` — no cross-generation bleed.

---

## Outer function fn #33533 — `statusBarHeight` vs `statusBarOffset` (verbatim, 1338580–1338592)

```js
            r1 = r7.Platform;
            r1 = r1.OS;
            r20 = 'android';
            r15 = 0;
            if(!(r1 !== r20)) { _fun32533_ip = 294; continue _fun32533 }
case 290:
            r15 = r4.bind(r0)();      // getAdjustedStatusBarHeight()
case 294:
            r1 = {'edgePadding': 20, 'pillContainerHeight': 24, 'iconButtonBusyOpacity': 0.5, 'statusBarHeight': null, 'headerHeight': 54};
            r11 = 20;
            r4 = r4.bind(r0)();       // getAdjustedStatusBarHeight()  — SECOND, UNCONDITIONAL call
            r1['statusBarHeight'] = r4;
            r1['statusBarOffset'] = r15;
```

⇒ **`Specifications.statusBarHeight = getAdjustedStatusBarHeight()` — unconditional, on every platform** (so on Android it is `getTopInset()`).
⇒ **`Specifications.statusBarOffset = (Platform.OS === 'android') ? 0 : getAdjustedStatusBarHeight()`.**

The `'statusBarHeight': null` in the object literal is just the initializer shape; it is overwritten on the very next instruction. The function is invoked **twice** (ip 290 and ip 296) — the values are identical, it is only a missed CSE. Correcting the prompt's placeholder: `Specifications['statusBarHeight'] = <getAdjustedStatusBarHeight()>`, not something else.

---

## Verdict on the supplied decode

The decode presented in the task prompt is **correct in full** — all 14 branches, all 6 return sites, all targets, and both closure-slot resolutions match my independent unfiltered read. The resulting table (iPhone13,1→50; includes iPhone13→47; iPhone14,4→50; iPhone14,6→`getStatusBarHeight()`; includes iPhone14→47; includes iPhone15/16/17/18→59; unknown→`getStatusBarHeight()`; android→`getTopInset()`) is confirmed byte-for-byte. **No disagreement.**

Additions beyond that decode:
- `getStatusBarHeight()` is called with **zero args**, and resolves to **20** on iPhone14,6 and on every unknown/newer device (44 only for X/XS/XR/11-class dimensions). The `→ getStatusBarHeight()` cells are now concrete numbers.
- Both `50` returns are the **mini** models, not "non-notch" — refuting R7 §2b's framing on its own terms.
- `HAS_NOTCH` exists in the outer fn but governs `hamburgerTopPadding` and `bottomNavBarHeight` only.
- Latent bug: devices past iPhone18,x get 20.
