# Tesla Android app — Round 2 (visual layer): the refresh indicator / "loading bar" and `BusyIcon`

**Target:** official Tesla Android app `com.teslamotors.tesla` **v4.58.0 (build 4392)**. Static RE of the Hermes bytecode disassembly (`bundle.hasm`) + apktool-decoded native resources. No dynamic analysis.

**Citation shorthand:** `hasm:N` = line N of `/Users/ivan/Work/tesla-summon/work/bundle.hasm`. `res:...` = decoded APK under `scratchpad/base_apktool/`. Opcode offsets are the `0x....` addresses shown inside each function. **Confidence:** plain = directly read from an opcode/literal; **INFERRED** = interpretation not proven by a single opcode; **GAP** = not recovered.

---

## TL;DR — answering the user's observation directly

> "There's a loading bar next to the text when the user refreshes."

**Correction: it is NOT a bar. It is a small rotating spinner icon — the `BusyIcon` component — rendered inline immediately *before* the status text.** It is a **rotating PNG image** (`mini_spinner.png`), animated by a continuous 0°→360° rotation (~900 ms/turn, infinite loop). On the Cybertruck theme the same slot renders a looping **Lottie** animation instead. There is **no progress bar, no `<ProgressBar>`, no `LinearProgress`, no shimmer/skeleton** anywhere by the status text (verified: zero `ProgressBar`/`LinearProgress`/`progress` hits in the home/status module `hasm:5195000–5220000`).

Three distinct "loading" surfaces exist on the vehicle home screen — none of them a bar:

| # | Surface | What it is | Shown when |
|---|---|---|---|
| A | **Header `BusyIcon`** (the thing the user sees "next to the text") | inline **rotating spinner PNG**, 18×18, before the status text | status undetermined ("Connecting") **and** `canWake \|\| !fetchedDataRecently` |
| B | **Godot 3D-car loading state** | native renderer flag `mobile_app_state.is_loading=true` (the 3D car itself shows a loading anim) | driven by same VDU (vehicle-data-update) loop |
| C | **RN `RefreshControl` on the home `FlatList`** | RN's *default* pull-to-refresh control, auto-created from `onRefresh`+`refreshing` | **`refreshing` is hardcoded `false`** → its native spinner never persists; the pull only fires the `onRefresh` wake |

So the visible "refresh indicator" = **A (the `BusyIcon` spinner)**, backed by B. The RN RefreshControl (C) is present but its own spinner is suppressed.

---

## 1. What is `BusyIcon`?

**It is a spinner — specifically a rotating image asset, NOT a native `ActivityIndicator`, NOT a progress bar.** The bundle contains **two** implementations named `"BusyIcon"` (`'BusyIcon'` = string_id 8529):

| Impl | fn / hasm | Animation engine | Asset(s) | Notes |
|---|---|---|---|---|
| **#35845** (design-system, used by header — see §1.3) | fn #35845, `hasm:1671046` (468 bytes) | legacy **`Animated.Value` + `Animated.Image`** | `asset:/img/spinner.png` (large) / `asset:/img/mini_spinner.png` (default) | has a **Cybertruck → Lottie** branch; co-located with `LottieView` fn #35860 (`hasm:1671723`) in the same design-system module |
| **#82695** (`@tesla/payment-react-native`) | fn #82695, `hasm:3722636` (222 bytes) | **react-native-reanimated** (`useSharedValue` + `useAnimatedStyle`) | registered assets `spinner` (100×100) / `mini_spinner` (36×36) from `@tesla/payment-react-native/assets/img` (fns #82699/#82700, `hasm:3722775`/`3722798`) | payment-flow variant; visually identical rotating spinner |

Both are the same visual concept: a **spinning image**. Detail per implementation:

### 1.1 #35845 (the one the header uses) — props, animation, asset

Props read at function entry (`hasm:1671051–1671078`):
| Prop | Opcode | Default |
|---|---|---|
| `size` | `0x05` GetByIdShort 'size'; `0x0a` LoadConstUInt8 **20** | **20** |
| `overridingTheme` | `0x16` GetById 'overridingTheme' | — |
| `color` | `0x1c` GetByIdShort 'color' | undefined (→ no tint) |
| `large` | `0x21` GetById 'large'; default via `0x27` LoadConstFalse | **false** |
| `speed` | `0x30` GetById 'speed'; `0x3a` LoadConstInt **900** | **900** |

- **Style** (`hasm:1671101–1671106`, `0xeb–0xf5`): `{ width: size, height: size, tintColor: color }`. With no `color` passed, `tintColor: undefined` → the PNG renders in its own (white/grey) colour.
- **Asset selection** (`0x141` `JmpTrue …, large`): `large===true` → `spinner.png`; else → **`mini_spinner.png`** (`hasm:1671116–1671120`, `LoadConstStringLongIndex 'asset:/img/mini_spinner.png'` string_id 168946 / `'asset:/img/spinner.png'` string_id 122570).
- **Animation** (`useEffect` closure #35846, `hasm:1671161+`): `Animated.loop( Animated.timing(value, { toValue: 1, duration: speed, easing: Easing.…, useNativeDriver: true }), { iterations: -1 } ).start()` (opcodes at `0x3b` `Animated.loop`, `0x47` `Animated.timing`, `0x5b` `toValue`, `0x64` `duration`, `0x68` `Easing`, `0x7b` `useNativeDriver`, `0x88` `LoadConstInt -1` = infinite, `0x9d` `.start`). The value is `interpolate({ inputRange:[0,1], outputRange:['0deg','360deg'] })` (`hasm:1671108–1671112`) applied as a `{transform:[{rotate}]}` on the `Animated.Image`.
  - **Net: an infinite, native-driven, linear rotation, one full turn per `speed` ms (default 900 ms).**
- **Cybertruck branch** (`0x114–0x120`: `theme === AppTheme.CYBERTRUCK`): instead renders `Animated.default` (the `LottieView`) with props `{ source: <require[6]>, autoPlay: true, loop: true }` (`NewObjectWithBuffer {'source':null,'autoPlay':true,'loop':true}` at `hasm:1671133`, `0x1a4`), sized by the same `{width,height}`. **INFERRED:** the Lottie source is `res/raw/spinner_ct.json` (Cybertruck spinner Lottie, 26 KB) — `spinner.json` (5.4 KB) and `spinner_ct.json` both confirmed present in `res/raw/`.

### 1.2 #82695 (payment variant) — reanimated version

- `useSharedValue(0)` (`0x45`), `useAnimatedStyle` (worklet #82697, `hasm:3722688`): `interpolate(value,[0,1],[0,360]) + 'deg'` → rotate transform.
- `startAnimation` (fn #82698, `hasm:3722711`): `value = withRepeat( withTiming(1, { duration: <speed>, easing: Easing.linear }), -1 )` — infinite **linear** spin, duration = `speed` (default 900). Bound to the `Image`'s `onLayout`.
- Same `{ width:size, height:size, tintColor:color }` style; default `size` 20.

### 1.3 Which one does the header (`VehicleStatusText`) use, and the resolved `size`

**`size` prop passed by `VehicleStatusText` = `18`** (directly read). The prop object built for `BusyIcon` sets only `size` (`hasm:5219602`, `0xbc2` `PutNewOwnByIdShort <Reg20>, 'size'`), and `Reg20` is loaded **once** at function entry (`hasm:5219004`, `0x8b` `LoadConstUInt8 Reg20, 18`) and is **not reassigned** anywhere before the render (verified: the only later write to Reg20 is at `0xfec`, after the BusyIcon jsx). So the header spinner is **18×18** (overriding the component default of 20), rendering **`mini_spinner.png`** (no `large` passed) with **no explicit tint** (asset's own colour), spinning ~900 ms/turn.

- **Component identity (INFERRED, strong):** the header imports the **design-system #35845** (Animated.Image + Cybertruck-Lottie), not the payment #82695. Evidence: #35845 lives in the shared design-system module alongside `LottieView` (#35860); the header is theme-aware (its parent `HomeHeader` reads `getSelectedVehicleIsCybertruck`, `hasm:5220050`), matching #35845's `AppTheme.CYBERTRUCK` Lottie branch; #82695 is bundled with `@tesla/payment-react-native` asset registration and is payment-scoped. **GAP:** the exact require-map index (`BusyIcon` is fetched from local require index **39** at `hasm:5219600` `0xbae LoadConstUInt8 39`) was not resolved to a module id, so the #35845 binding is inferred, not opcode-proven. Either way the on-screen result is identical (rotating spinner, 18 px).

**Render shape** (`VehicleStatusText` #117231, `hasm:5219571–5219603`): `View{style:[…, marginRight: Gutter*0.5]}` → `jsx(BusyIcon, { size: 18 })`, emitted **only** inside the connecting branch (gated by Reg14, see §3). `Gutter*0.5` = the gap between spinner and text (`0xb8d` GetById 'Gutter', `0xb92` LoadConstDouble 0.5, `0xba0` PutNewOwnById 'marginRight').

---

## 2. Is there a SEPARATE refresh indicator / "loading bar"? (RefreshControl on the home scroll view)

**Answer: (a) The user's "loading bar" is the `BusyIcon` spinner from §1 (option (a) in the brief), not a real bar and not a persistent RefreshControl.** But a **RN `RefreshControl` does exist** on the home list — its own spinner is just suppressed.

### 2.1 Home screen = `VehicleHomeScreen` → `Animated.FlatList`

The vehicle home screen is `VehicleHomeScreen` (fn #117072, `hasm:5208977`). Its scrollable body is an **`Animated.FlatList`** (`hasm:5210541`, `0x1bdf` GetById 'FlatList') with these props (`hasm:5210538–5210567`):

| Prop | Value | hasm / opcode |
|---|---|---|
| `renderItem` | `renderVehicleMenuItem` | `0x1c0a` / `0x1c10` |
| `showsVerticalScrollIndicator` | `false` | `0x1c1e`/`0x1c20` |
| `contentContainerStyle` | `listContentContainer` | `0x1c2f` |
| **`refreshing`** | **`false`** (constant — same `LoadConstFalse` reg as above, not reassigned) | `0x1c34` |
| `bounces` | `(Reg50 !== Reg51)` computed | `0x1c39`/`0x1c3d` |
| **`onRefresh`** | pull-down wake handler (§3 / §4) | `0x1c42` |
| `onScroll` | parallax scroll handler | `0x1c47` |
| `removeClippedSubviews` | true | `0x1c51` |

- **No custom `refreshControl` prop** is passed (verified: zero `'refreshControl'` hits in `hasm:5195000–5218000`). When a `FlatList`/`ScrollView` receives `onRefresh`+`refreshing` without a custom `refreshControl`, **React Native auto-creates its default `RefreshControl`.** So a stock RefreshControl IS mounted.
- **But `refreshing` is hardcoded `false`.** **INFERRED behaviour:** with `refreshing`永 false, the native RefreshControl spinner retracts immediately after the pull gesture and never shows a persistent loading state. The app deliberately relies on the **header `BusyIcon`** (and the Godot `is_loading` animation) for the visible "refreshing" feedback instead of the platform RefreshControl spinner.
- **Default RefreshControl styling:** because no `tintColor` / `colors` / `progressViewOffset` / `size` are set on it, they are all RN defaults. **GAP:** there is no explicit tint/offset to report for the home RefreshControl — none is specified in code.
- The demo screen `VehicleDemoHomeScreen` (fn #117134, `hasm:5212835`) renders a parallel `Animated.FlatList` also with `refreshing:false` (`hasm:5213251`) but its `onScroll` is an `Animated.event(contentOffset.y, {useNativeDriver:true})` and it does **not** wire `onRefresh` (demo has no live pull-to-refresh).

### 2.2 Other RefreshControls in the app (not the home car view)

RN `RefreshControl` **is** used elsewhere (energy, lists, webviews) — e.g. `hasm:5455321, 5462054, 5510456, 5514469, 5849066, 5853553, 5889715, 6005577`, and several set `progressViewOffset` (`hasm:266559, 280465, 1978376, 2043626, …`). These are unrelated to the vehicle status header.

---

## 3. Triggers & the gate that shows the header spinner

The header spinner (`BusyIcon`) is emitted **only** when the status resolves to the **"Connecting" fallback** (status undetermined) — the connecting branch in `VehicleStatusText` (`hasm:5219419–5219445`, i.e. `0x908–0x945`), which loads `connecting_label` = "Connecting" and computes the spinner flag `Reg14`. In every concrete-state branch (Parked, Charging, Asleep, Mobile-Access-Disabled, In-Service, Powershare states, …) `Reg14` is set `LoadConstFalse` → **no spinner**. The `View`+`BusyIcon` subtree is guarded by `JmpFalse Reg14` at `hasm:5219582` (`0xb63`).

### 3.1 The exact gate

Within the connecting branch the spinner flag is (`hasm:5219431–5219437`, `0x930–0x93d`):

```
showLoadingSpinner  =  canWake ? canWake : !fetchedDataRecently
                    ≡  canWake || !fetchedDataRecently
```

where (both directly read, results stored to the render env):
- **`canWake`** = redux selector **`getSelectedVehicleCanWake`** → env slot 0 (`hasm:5219042` GetById; `hasm:5219047` `0x154` Call; `0x159` StoreToEnvironment[0]).
- **`fetchedDataRecently`** = redux selector **`getSelectedVehicleDataFetchedRecently`** → env slot 1 (`hasm:5219050` GetById; `0x17a` Call; `0x17f` StoreToEnvironment[1]).

This is confirmed by the debug log emitted from the same `useEffect` (closure #117233, `hasm:5219961`): it concatenates **`'[VDU] Show loading spinner: ' + <flag> + ' - fetchedDataRecently: ' + <val> + ', canWake: ' + <val>`** (strings at `hasm:5219975–5219987`; `[VDU]` = the Vehicle-Data-Update subsystem).

### 3.2 What this means for "which actions show it"

- The gate is **data-state driven, not trigger driven.** The spinner shows whenever reachability is undetermined **and** (the car can be woken **or** data isn't fresh) — **regardless of whether the fetch was user-initiated or a background poll.** It is **not** limited to pull-to-refresh or tap.
- Concretely it appears while (re)connecting after: app foreground, a poll that found the car offline, a pull-to-refresh wake, a tap-status wake, or a command-triggered wake — any path that leaves the header in the undetermined state with stale/wakeable data.
- If the car **cannot** be woken **and** data **was** fetched recently, **no spinner even in the connecting state** (a real nuance vs. "spinner on every fetch").

### 3.3 Pull-to-refresh trigger (the `onRefresh` wake)

The home `FlatList.onRefresh` is the closure **fn #117131** (created in `VehicleHomeScreen` at `hasm:5210331`, `CreateClosureLongIndex function_id 117131`). It (`hasm:5212661–5212700`):
1. logs `'[VDU] wake pull down'` (`hasm:5212677`),
2. dispatches **`Actions.vehicleWakeUp(vin, VehicleWakeReason.PULL_DOWN_REFRESH)`** (`hasm:5212685–5212695`: GetById 'vehicleWakeUp', 'VehicleWakeReason', **'PULL_DOWN_REFRESH'**),
3. then `'Pull to Refresh, sync pseudonym and directives if possible.'` (`hasm:5212700`).

So **pull-to-refresh = a `PULL_DOWN_REFRESH` wake dispatch**; the resulting undetermined→online transition drives the header spinner via §3.1. (Tap-status-text = `TAP_STATUS_TEXT` wake, handled by the status-row `onStatusPress` per Round-1 §5.2; same spinner gate applies.)

---

## 4. Lifecycle — when it appears / stops

- **Appears / disappears reactively.** `showLoadingSpinner` is re-derived on every render from the two redux selectors (`getSelectedVehicleCanWake`, `getSelectedVehicleDataFetchedRecently`) plus the status-branch selection. There is **no `setTimeout`, no min-visible-duration / anti-flicker debounce** in the `VehicleStatusText` spinner path (searched; none found). It is the same "compute from state each render" pattern as the command-timeout selector in Round 1 — appears when the state says so, clears the moment the status resolves to a concrete state or `fetchedDataRecently` flips true (with `canWake` false).
- **Animation lifecycle within the icon:** the rotation is an independent `Animated.loop(..., {iterations:-1})` (#35845) / `withRepeat(..., -1)` (#82695) started on mount/layout and running continuously while the icon is mounted; it stops simply by the icon unmounting when the spinner flag goes false. (#35846 also calls `stopAnimation` + `setValue(0)` before (re)starting the loop.)
- **The Godot 3D-car loading (surface B)** is toggled by dispatching `updateProduct({ id, type: ProductType.VEHICLE, mobile_app_state: { is_loading: <bool>, show_terrain } })` (`hasm:5211747–5211761`, logged as `'[VDU] Show loading Godot animation:'` string_id 244826). Same VDU loop; native renderer owns the actual animation.

---

## 5. Direct answers to the brief's 5 questions

1. **What is `BusyIcon`?** A **spinner = a rotating image**, not an `ActivityIndicator`, not a progress bar, not a shimmer. Two impls (#35845 Animated.Image, #82695 reanimated). Header uses the design-system #35845 (INFERRED). **Size in header = 18** (resolved: `LoadConstUInt8 18` at `hasm:5219004`, unchanged to the render). Asset = `mini_spinner.png`. Tint = none passed (asset colour). Animation = infinite native-driven linear rotation 0°→360°, one turn / `speed` (default **900 ms**). Cybertruck theme → looping **Lottie** (`spinner_ct.json`, INFERRED) instead of the PNG.
2. **Separate refresh indicator / "loading bar"?** **No real bar.** Answer = **(a)** the `BusyIcon` spinner shown during connecting/refresh. A stock RN `RefreshControl` **(b)** does exist on the home `FlatList` (auto-created from `onRefresh`+`refreshing`) but **`refreshing` is hardcoded `false`**, so its native spinner never persists; no custom tint/offset. **No `ProgressBar`/`LinearProgress`/shimmer (c)** anywhere near the status text.
3. **Triggers.** Gated by `showLoadingSpinner = canWake || !fetchedDataRecently`, evaluated only in the undetermined ("Connecting") status branch. **Data-state driven, not trigger-specific** — shows on any (re)connect (foreground poll, offline poll, pull-to-refresh `PULL_DOWN_REFRESH`, tap `TAP_STATUS_TEXT`, command wake). **Not** every fetch: suppressed when data is fresh and the car isn't wakeable. Gate selectors: `getSelectedVehicleCanWake` (`hasm:5219042`), `getSelectedVehicleDataFetchedRecently` (`hasm:5219050`).
4. **Lifecycle.** Purely reactive from redux state per render; **no min-duration / debounce timer** in the header path. Rotation runs continuously while mounted; unmounts when the flag clears.
5. **RefreshControl on the home scroll view.** Yes — RN default one on `VehicleHomeScreen`'s `Animated.FlatList` (`hasm:5210541`). Props: `refreshing:false` (constant), `onRefresh` → fn #117131 → `vehicleWakeUp(PULL_DOWN_REFRESH)` (`hasm:5212685`), `onScroll` (parallax), `bounces` (computed), `showsVerticalScrollIndicator:false`. No `tintColor`/`colors`/`progressViewOffset`/`size` set (RN defaults).

---

## 6. Gaps (not recovered — stated plainly)

1. **Header `BusyIcon` module binding is INFERRED (#35845), not opcode-proven.** The `BusyIcon` is fetched from require index 39 (`hasm:5219600`); the index→module-id map was not resolved. Visual result is identical for either impl.
2. **Cybertruck Lottie source asset** for the header spinner is INFERRED as `res/raw/spinner_ct.json` (both `spinner.json` and `spinner_ct.json` confirmed present; the code-side `require[6]` source was not mapped to a filename).
3. **`getSelectedVehicleDataFetchedRecently` "recently" threshold** (the ms window that defines "recent") — the selector is an anonymous reselect arrow; its time constant was not located. (Likely a `TimeInMs` value; not confirmed.)
4. **Default RefreshControl visuals** (tint/size) for the home list are RN platform defaults — nothing app-specified to report.
5. **Exact `speed`/`color` at every call site** — 40+ `BusyIcon` call sites exist app-wide; only the header (`size:18`, no color) was fully traced. Component defaults are `size 20`, `speed 900`, `large false`, `color undefined`.

---

## 7. Citation index (auditable)

- **BusyIcon defs:** #35845 `hasm:1671046` (Animated.Image + Cybertruck Lottie), animation loop #35846 `hasm:1671161`; #82695 `hasm:3722636` (reanimated), worklet #82697 `hasm:3722688`, `startAnimation` #82698 `hasm:3722711`; asset registrations #82699/#82700 `hasm:3722775/3722798`; `LottieView` #35860 `hasm:1671723`.
- **Assets:** `asset:/img/mini_spinner.png` / `asset:/img/spinner.png` (strings 168946 / 122570); native PNGs `res/drawable-mdpi/node_modules_tesla_paymentreactnative_assets_img_{mini_,}spinner.png`; Lottie `res/raw/spinner.json`, `res/raw/spinner_ct.json`.
- **Header render + size 18:** `VehicleStatusText` #117231 `hasm:5218968`; `size` load `hasm:5219004` (`0x8b`); BusyIcon jsx `hasm:5219596–5219603` (`0xbba`/`0xbc2`, string_id 8529); spinner-View guard `hasm:5219582` (`0xb63`).
- **Spinner gate:** flag formula `hasm:5219431–5219437` (`0x930–0x93d`); `getSelectedVehicleCanWake` `hasm:5219042` (env slot 0); `getSelectedVehicleDataFetchedRecently` `hasm:5219050` (env slot 1); debug log #117233 `hasm:5219961–5219987`; `connecting_label` `hasm:5219427`.
- **Home screen / RefreshControl:** `VehicleHomeScreen` #117072 `hasm:5208977`; `Animated.FlatList` + props `hasm:5210538–5210567` (`refreshing:false` `0x1c34`, `onRefresh` `0x1c42`); `VehicleDemoHomeScreen` #117134 `hasm:5212835` (`refreshing:false` `hasm:5213251`).
- **Pull-to-refresh wake:** onRefresh closure #117131 created `hasm:5210331`; body `hasm:5212661–5212700`; `'[VDU] wake pull down'` `hasm:5212677`; `PULL_DOWN_REFRESH` dispatch `hasm:5212695`.
- **Godot loading:** `'[VDU] Show loading Godot animation:'` `hasm:5211750`; `updateProduct(… mobile_app_state.is_loading …)` `hasm:5211747–5211761`.
