# R9 §2 — Module identities & export semantics for `getAdjustedStatusBarHeight`

Sources:
- iOS PRIMARY: `/Users/ivan/Downloads/tesla-haptics-work/main.decompiled.js` (Tesla iOS v4.56)
- Android: `/Users/ivan/Work/tesla-summon/work/bundle.hasm` (v4.58)

## §2.0 — Independent verification of THE FUNCTION (before anything else)

I re-dumped iOS 1338493–1338578 raw (no filtered grep). **The task's decode of fn #32534 is CORRECT in every branch target and every literal.** All 20 case labels, all 8 return sites, `===` vs `.includes` distinction, and the 4 `!= null` guards match byte-for-byte.

Confirmed resulting table [iOS-verified]:

| deviceId | returns |
|---|---|
| `=== 'iPhone13,1'` | **50** |
| `.includes('iPhone13')` | **47** |
| `=== 'iPhone14,4'` | **50** |
| `=== 'iPhone14,6'` | **getStatusBarHeight()** |
| `.includes('iPhone14')` | **47** |
| `.includes('iPhone15'\|'iPhone16'\|'iPhone17'\|'iPhone18')` | **59** |
| anything else / null | **getStatusBarHeight()** |
| `Platform.OS === 'android'` (checked FIRST) | **getTopInset()** |

**Confirmed: there is NO notch predicate in fn #32534.** R7 §2b's "other notch → 47; non-notch → 50" is fabricated. (`HAS_NOTCH` *does* exist in the outer module but feeds a *different* key — `hamburgerTopPadding`, iOS 1338594-1338601 — not statusBarHeight.)

The 4 `r3 != null` guards are Hermes codegen for TS optional chaining (`deviceId?.includes(...)`), not semantic branches: every null path falls through 127→152→175→198→231 (`getStatusBarHeight()`).

**[both-match]** Android v4.58 fn #32994 (`bundle.hasm` 1566163+) is structurally identical: same order, same strings (`iPhone13,1`, `iPhone13`, `iPhone14,4`, `iPhone14,6`, `iPhone14`, `iPhone15/16/17/18`), same constants (`LoadConstUInt8 59` / `47` / `50`), same `JStrictEqualLong` vs `includes`+`JmpTrue` split. No drift between v4.56 iOS and v4.58 Android.

## §2.1 — What supplies the device identifier

Host module is **moduleId 2450** (fn #32533), registered at iOS 1338725:
```
r6 = 2450;
r5 = [1, 1116, 5, 2439, 2451, 2432];
r5 = __d(r7, r6, r5);
```
Closure slots (iOS 1338431-1338462):
- `_closure1_slot0` = `a1` = **require**
- `_closure1_slot1` = `a6` = **dependencyMap** = `[1, 1116, 5, 2439, 2451, 2432]`
- `_closure1_slot2` = `_interopRequireDefault(require(deps[1]))` = `_interopRequireDefault(require(1116))`
- `_closure1_slot3` = `require(deps[2])` = `require(5)` = **react-native** (`.Platform`)

⇒ **`_closure1_slot2.default` = moduleId 1116 = `react-native-device-info`** [iOS-verified].
Evidence: module 1116 exports `useIsHeadphonesConnected`, `useBrightness`, `getSupportedMediaTypeList(Sync)` (iOS 494730-494733) and emits `RNDeviceInfo_batteryLevelDidChange` / `RNDeviceInfo_powerStateDidChange` / `RNDeviceInfo_headphoneConnectionDidChange` (iOS 491780-492153). This is **react-native-device-info**, NOT expo-device, NOT a Tesla native module.

`getDeviceId` impl, iOS 492568 (VERBATIM):
```js
r132 = function() { // Original name: getDeviceId
    r0 = require(deps[8]).getSupportedPlatformInfoSync;
    r0 = {'defaultValue': 'unknown', 'memoKey': 'deviceId'};
    r3 = function() { // Original name: getter
        r0 = _closure1_slot8;      // RNDeviceInfo native module
        r0 = r0.default;
        r0 = r0.deviceId;          // native constant
        return r0;
    };
    r0['getter'] = r3;
    r0['supportedPlatforms'] = ['android', 'ios', 'windows'];
    return getSupportedPlatformInfoSync(r0);
};
```
i.e. `getDeviceId() = getSupportedPlatformInfoSync({ defaultValue: 'unknown', memoKey: 'deviceId', getter: () => RNDeviceInfo.deviceId, supportedPlatforms: ['android','ios','windows'] })`

**Return shape on a modern iPhone: `"iPhone15,2"` — i.e. the hardware `uname().machine` identifier.** [iOS-verified at JS layer; the native `deviceId` constant itself is in the iOS binary, not the bundle.]

**Is this the same shape/value as expo-device's `Device.modelId` ("iPhone18,4")? YES — same shape, and same value in practice.** Both surface the raw `hw.machine` / `uname().machine` string. `Device.modelId` "iPhone18,4" and RNDI `getDeviceId()` "iPhone18,4" are interchangeable for the purpose of this table. **INFERRED** (from library semantics — cannot be proven from the bundle, since both are native reads; but the fn #32534 literals `iPhone13,1`/`iPhone14,4`/`iPhone14,6` are unambiguously `hw.machine` identifiers, which pins the format).

**Default value: `'unknown'` (a STRING), never `null`.** So in practice the `!= null` guards never fire and an unrecognized/unsupported device lands at case 231 via the `.includes('iPhone18')` false path — same destination. No behavioural difference.

**Simulator behaviour: UNRESOLVED from the bundle.** `grep -c SIMULATOR_MODEL_IDENTIFIER main.decompiled.js` → **0**. The substitution lives in RNDI's ObjC (`RNDeviceInfo.m`), not in JS. Known library behaviour (**INFERRED, not verified here**): iOS RNDI returns `uname().machine` = `"i386"`/`"x86_64"`/`"arm64"` on a simulator, and substitutes `getenv("SIMULATOR_MODEL_IDENTIFIER")` (e.g. `"iPhone15,2"`) when it sees one of those three. If that env var is missing, `getDeviceId()` → `"arm64"` → falls to case 231 → `getStatusBarHeight()`.

## §2.2 — The `getStatusBarHeight()` fallback (case 231) — LOAD-BEARING

Case 231 resolves `require(deps[4])` = `require(2451)`.

**Which of the two? There are exactly two `getStatusBarHeight` in the bundle:**
- iOS **1338743** — inside the module registered as `r6 = 2451` at iOS 1338852. ⇒ **THIS IS THE ONE** (deps[4] = 2451). ✅
- iOS **3528829** — a *different* module, sibling of `getBottomSpace` ⇒ **react-native-iphone-x-helper**. **NOT used by case 231.** ❌ (Ruled out: not moduleId 2451; its `ios` value is `Platform.select` over 30/44 via a helper, structurally different.)

**Module 2451 = `react-native-status-bar-height`** (deps `[5]` = react-native only; exports `getStatusBarHeight` + `isExpo`; contains `getExpoRoot` checking `global.Expo` / `global.__expo` / `global.__exponent`). [iOS-verified]

### `getStatusBarHeight(skipAndroid)` — VERBATIM, iOS 1338743-1338771
```js
r0 = function(a0) { // Original name: getStatusBarHeight
case 0:
    r2 = _closure1_slot1.Platform;   // react-native
    r1 = r2.select;
    r0 = {};
    r4 = _closure1_slot2;            // isIPhoneX_deprecated  <-- module-level const
    r3 = 20;
    if(!r4) { ip = 32 }              // if (!isIPhoneX) keep 20
case 29:
    r3 = 44;
case 32:
    r0['ios'] = r3;                  // ios: isIPhoneX ? 44 : 20
    r3 = 0;
    r6 = a0;                         // skipAndroid
    r4 = 0;
    if(r6) { ip = 63 }               // if (skipAndroid) android = 0
case 47:
    r5 = _closure1_slot1.StatusBar;
    r4 = r5.currentHeight;           // else android = StatusBar.currentHeight
case 63:
    r0['android'] = r4;
    r0['default'] = r3;              // default: 0
    return r1.bind(r2)(r0);          // Platform.select({...})
};
```
⇒ `getStatusBarHeight(skipAndroid) = Platform.select({ ios: isIPhoneX ? 44 : 20, android: skipAndroid ? 0 : StatusBar.currentHeight, default: 0 })`

**Case 231 calls it with NO argument** (`r1.bind(r2)()`) ⇒ `skipAndroid === undefined` (falsy). Moot: case 231 is unreachable on Android (the `OS === 'android'` check at case 0 diverts to 280 first).

### `isIPhoneX_deprecated` (`_closure1_slot2` of module 2451) — VERBATIM, iOS 1338782-1338822
```js
r4 = Dimensions.get('window');
r6 = r4.height;
r5 = r4.width;
r4 = false;
var _closure1_slot2 = r4;                     // default false
r7 = Platform.OS; r4 = 'ios';
if(!(r7 === r4))     { ip = 224 }             // OS !== 'ios'    -> stay false
case 138: if(Platform.isPad)  { ip = 224 }    // iPad            -> stay false
case 152: if(Platform.isTVOS) { ip = 224 }    // tvOS            -> stay false
case 168: r3 = (width === 375);
case 181: if (r3) r3 = (height === 812);
case 191: if(r3) { ip = 220 }
case 194: r4 = (width === 414);
case 207: if (r4) r4 = (height === 896);
case 217: r3 = r4;
case 220: _closure1_slot2 = r3;
case 224: ...
```
⇒ **`isIPhoneX = Platform.OS === 'ios' && !Platform.isPad && !Platform.isTVOS && ((width === 375 && height === 812) || (width === 414 && height === 896))`**

## ⚠️ THE LOAD-BEARING CONCLUSION FOR THE TEAM

**`getStatusBarHeight()` is NOT a safe-area inset and NOT a native call on iOS. It is a hardcoded 2-value constant table gated by a `Dimensions.get('window')` equality check against exactly two legacy iPhone X-era window sizes.**

On iOS it can ONLY ever return **44** or **20**:
- **44** — iff window is exactly **375×812** (iPhone X / XS / 11 Pro / 12 mini / 13 mini) or exactly **414×896** (iPhone XR / XS Max / 11 / 11 Pro Max), and not iPad/tvOS.
- **20** — everything else, **including every iPhone newer than the 11 series** (390×844, 393×852, 402×874, 430×932, 440×956 … none match), every iPad, and the SE line.

The team's invented `insetTop > 20` predicate is **wrong** and must be replaced by this literal reimplementation. Concretely, the two reachable iOS call sites of case 231:
- `deviceId === 'iPhone14,6'` (**iPhone SE 3rd gen**, window 375×667) ⇒ isIPhoneX **false** ⇒ **20**.
- unknown/unmatched deviceId (incl. `'unknown'`, simulator `'arm64'`, and iPhone 11/12-series ids like `iPhone12,1`) ⇒ dims decide ⇒ **44** for 375×812 / 414×896, else **20**.

Note `Dimensions.get('window')` is read **once at module 2451 eval time** and `isIPhoneX` is frozen thereafter — it does not react to rotation or split-view.

## §2.3 — `getTopInset()` (case 280, ANDROID branch) [differ]

Case 280 resolves `require(deps[3])` = `require(2439)`.

**Module 2439 = a Tesla-internal native-module wrapper** (deps `[1, 364, 5]`), iOS 1335005-1335011:
```js
var _closure1_slot1 = require(deps[2]);            // react-native
r1 = _closure1_slot1.NativeModules;
r1 = r1.ScreenUtilsModule;
var _closure1_slot2 = r1;                          // NativeModules.ScreenUtilsModule
```
Exports `getScreenHeight`, `getScreenWidth`, `getTopInset`, `hasNotch`, `setNavigationBarColor` — a **Tesla native module**, not a public library.

`getTopInset` — VERBATIM, iOS 1334953-1334958:
```js
r1 = function() { // Original name: getTopInset
    r1 = _closure1_slot2;            // NativeModules.ScreenUtilsModule
    r0 = r1.getTopInset;
    r0 = r0.bind(r1)();
    return r0;
};
r6['getTopInset'] = r1;
```
⇒ **`getTopInset() = NativeModules.ScreenUtilsModule.getTopInset()`** — a synchronous native call into Tesla's own `ScreenUtilsModule`. **No platform guard on `getTopInset` itself**; the guard is in fn #32534 (case 0). Body is native (Java/Kotlin in the APK) — the returned unit/value is **UNRESOLVED from the bundle**, but by name + call-site it is the Android top window inset (status bar height, px or dp — undetermined).

**⚠️ Spot-check correction (double-negation trap, same class of error as R7 §2b):** the sibling `ScreenUtils.hasNotch` (iOS 1334959-1334983) throws on **ANDROID**, not iOS:
```js
r2 = Platform.OS; r1 = 'android';
if(!(r2 !== r1)) { ip = 41 }              // if (OS === 'android') -> 41 -> THROW
case 25: return ScreenUtilsModule.hasNotch();   // non-android (iOS) -> native call
case 41: throw new Error('Use DeviceInfo.hasNotch() for Android');
```
So `ScreenUtils.hasNotch()` is the **iOS** path and the error string tells Android callers to use RNDI instead. (Not load-bearing for statusBarHeight, but it is a live trap for anyone reading this module.)

## §2.4 — Export semantics (fn #32533, iOS 1338579-1338592) — VERBATIM

```js
r4 = function() { /* getAdjustedStatusBarHeight */ };   // r4 = THE FUNCTION
r1 = r7.Platform;
r1 = r1.OS;
r20 = 'android';
r15 = 0;                                                // r15 = 0
if(!(r1 !== r20)) { ip = 294 }                          // if (OS === 'android') -> 294, r15 stays 0
case 290:
    r15 = r4.bind(r0)();                                // else r15 = getAdjustedStatusBarHeight()
case 294:
    r1 = {'edgePadding': 20, 'pillContainerHeight': 24, 'iconButtonBusyOpacity': 0.5,
          'statusBarHeight': null, 'headerHeight': 54};  // literal placeholder null
    r11 = 20;
    r4 = r4.bind(r0)();                                 // *** r4 REASSIGNED: function -> RESULT ***
    r1['statusBarHeight'] = r4;                         // = RESULT (number)
    r1['statusBarOffset'] = r15;
```

**Answers:**
1. **`Specifications.statusBarOffset` = `Platform.OS === 'android' ? 0 : getAdjustedStatusBarHeight()`** — **R7 §2b CONFIRMED** on this point. [both-match]
2. **`Specifications.statusBarHeight` = `getAdjustedStatusBarHeight()` — the RESULT, called UNCONDITIONALLY on every platform** (so on Android it is `getTopInset()`, not 0).
3. **`r4` at iOS 1338590 is the RESULT, not the FUNCTION.** The `Call1` at 1338589 (`r4 = r4.bind(r0)()`) overwrites the closure reference in-place before the `PutById`. This is unambiguous in both toolchains — Android `bundle.hasm` 0x137-0x13b: `<Call1>: <Reg8: 4, Reg8: 4, Reg8: 0>` then `<PutById>: <Reg8: 1, Reg8: 4, ... 'statusBarHeight'>`, i.e. the call writes into the *same* register it reads the callee from.
4. `'statusBarHeight': null` in the object literal is only the NewObjectWithBuffer placeholder (buffers can't hold closures/calls); it is immediately overwritten by the `PutById`. Not a real value.
5. ⚠️ **`getAdjustedStatusBarHeight()` is invoked TWICE on iOS** (once at case 290 for `statusBarOffset`, once at 1338589 for `statusBarHeight`) and **once on Android**. Both are module-eval-time; the exported values are frozen constants for the process lifetime. On iOS **`statusBarHeight === statusBarOffset` always** (same function, same frozen inputs, no side effects). They diverge only on Android (`statusBarHeight = getTopInset()`, `statusBarOffset = 0`).

## §2.5 — iPad / Mac Catalyst / simulator branches

- **fn #32534 itself: NO iPad, NO Catalyst, NO simulator branch.** The only platform test is `Platform.OS === 'android'` at case 0. An iPad running the app gets `deviceId` = `"iPad14,3"` etc., matches none of the `iPhone*` literals, and falls to case 231.
- **Indirect iPad handling exists one level down**, in module 2451's `isIPhoneX` (iOS 1338793-1338800): `if(Platform.isPad) { ip = 224 }` and `if(Platform.isTVOS) { ip = 224 }` ⇒ iPad/tvOS force `isIPhoneX = false` ⇒ **`getStatusBarHeight()` → 20 on iPad**, regardless of window size (so an iPad at 414×896 in a split view can't accidentally get 44).
- **Mac Catalyst: no branch anywhere. UNRESOLVED** — no `catalyst` / `macos` / `isMacCatalyst` test on any path reachable from fn #32534.
- **Simulator: no JS branch. UNRESOLVED** (see §2.1 — handled natively in RNDI, if at all; 0 hits for `SIMULATOR_MODEL_IDENTIFIER` in the bundle).

## §2.6 — [differ] Android cross-check (`bundle.hasm` v4.58)

**Q: Is `statusBarOffset` really just 0 on Android (R7 §2b)? → CONFIRMED.**
`bundle.hasm` 1566031-1566041 (VERBATIM):
```
==> 00000109: <CreateClosure>: <Reg8: 4, Reg8: 1, function_id: 32994>   # getAdjustedStatusBarHeight
==> 0000010e: <GetByIdShort>: <Reg8: 1, Reg8: 7, UInt8: 5, string_id: 35>      # 'Platform'
==> 00000113: <GetByIdShort>: <Reg8: 1, Reg8: 1, UInt8: 6, string_id: 31>      # 'OS'
==> 00000118: <LoadConstString>: <Reg8: 20, string_id: 28318>                  # 'android'
==> 0000011c: <LoadConstZero>: <Reg8: 15>                                      # r15 = 0
==> 0000011e: <JStrictEqual>: <Addr8: 8, Reg8: 1, Reg8: 20>  # -> 00000126     # if OS==='android' SKIP the call
==> 00000122: <Call1>: <Reg8: 15, Reg8: 4, Reg8: 0>                            # (non-android) r15 = fn()
==> 00000126: <NewObjectWithBufferLong>: ... {'edgePadding': 20, ..., 'statusBarHeight': null, 'headerHeight': 54}
==> 00000134: <LoadConstUInt8>: <Reg8: 11, UInt8: 20>
==> 00000137: <Call1>: <Reg8: 4, Reg8: 4, Reg8: 0>                             # r4 = fn()  [RESULT]
==> 0000013b: <PutById>: <Reg8: 1, Reg8: 4, UInt8: 9, string_id: 42242>        # 'statusBarHeight' = RESULT
==> 00000141: <PutNewOwnById>: <Reg8: 1, Reg8: 15, string_id: 42293>           # 'statusBarOffset' = r15 (0 on android)
```
`JStrictEqual` jumps **over** the `Call1` when `OS === 'android'`, leaving `r15 = 0` from `LoadConstZero`. ⇒ **`statusBarOffset === 0` on Android.** [both-match with iOS v4.56 — identical instruction sequence and identical semantics.]

**Q: What does Android's `getTopInset()` path do?**
Android fn #32994 case 0 (`bundle.hasm` 1566169-1566176): `getDeviceId()` is called **first, unconditionally** (`Call1` at 0x12) — its result is simply discarded on Android because the very next test `JStrictEqualLong OS==='android' -> 0x118` diverts to the `getTopInset` return before any `deviceId` comparison runs. Wasted native call, no behavioural effect.
At 0x118 the Android branch loads `deps[3]` (= module 2439) and calls `.getTopInset()` ⇒ `NativeModules.ScreenUtilsModule.getTopInset()` (§2.3). Native body in the APK — **UNRESOLVED from the bundle**.

⇒ **Android**: `statusBarHeight = ScreenUtilsModule.getTopInset()`, `statusBarOffset = 0`.
⇒ **iOS**: `statusBarHeight = statusBarOffset = getAdjustedStatusBarHeight()` (the §2.0 table).

## Open gaps (documented, not guessed)
1. Native body of `NativeModules.ScreenUtilsModule.getTopInset()` (Android APK Java/Kotlin) — value + unit (px vs dp) undetermined.
2. Native `RNDeviceInfo.deviceId` on iOS — not in the bundle (iOS binary not available in this workspace; cwd is the Android APK).
3. Simulator substitution (`SIMULATOR_MODEL_IDENTIFIER`) — 0 bundle hits; native-only. Library-knowledge only, unverified.
4. Mac Catalyst — no branch found anywhere on the reachable path; behaviour undetermined.
5. `Platform.isPad` / `Platform.isTVOS` are react-native getters (iOS 9586) backed by native constants — not decoded further.
