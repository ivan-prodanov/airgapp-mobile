# R4 §5 — BusyIcon / mini_spinner: where used, size, tint, in-flight replace-vs-alongside, iconButtonBusyOpacity

Platforms: iOS = `/Users/ivan/Downloads/tesla-haptics-work/main.decompiled.js` (v4.56, readable JS).
Android = `/Users/ivan/Work/tesla-summon/work/bundle.hasm` (v4.58, Hermes disasm).

---

## 0. The BusyIcon component itself (default size, props, asset, tint mechanism)

### iOS — component def `main.decompiled.js:1428412-1428580` (Original name: BusyIcon)
Props destructured (verbatim register trace):
- `r1 = r0.size;` then `r9 = 20;` `if(size !== undefined) r9 = size;`  → **default size = 20** (`:1428416-1428421`)
- `r1 = r0.overridingTheme;` (`:1428423`)
- `r2 = r0.color;` (`:1428424`)
- `r5 = r0.large;` default `false` (`:1428425-1428429`)
- `r12 = r0.speed;` default `900` (`:1428431-1428434`)

Render (non-CYBERTRUCK, case 292, `:1428529-1428560`):
```
r5 = {};
r5['width']  = r9;   // = size (default 20)
r5['height'] = r9;   // = size
r5['tintColor'] = r2;   // = color prop   <-- TINT comes ONLY from `color` prop
...
Animated.Image  source = (large ? asset[7] : asset[8])  style=[ {width,height,tintColor}, {transform:[{rotate}]} ]
```
- **tintColor is literally the `color` prop.** If no `color` is passed, `tintColor = undefined` → the raw `mini_spinner.png` renders in its native color (white).
- CYBERTRUCK theme branch (case 406, `:1428562-1428575`): renders a **Lottie** instead — `jsx(LottieView.default, {source:null→asset[6], autoPlay:true, loop:true, style:{width,height,tintColor}})`. So on Cybertruck the spinner is a Lottie animation, not the rotating PNG. [iOS-verified]

Asset (`:1430467`):
```
{'__packager_asset': true, 'httpServerLocation': '/assets/assets/img', 'width': 36, 'height': 36,
 'scales': null, 'hash': '2577e2145143e3cd5311e395609d9a81', 'name': 'mini_spinner', 'type': 'png'}
```
A second identical copy (same hash) ships under payment-react-native (`:3356633`).

### Android — component def `bundle.hasm:1671046-...` (Function #35845 "BusyIcon", 468 bytes)  [both-match]
```
1671052  GetByIdShort size
1671053  LoadConstUInt8 Reg9, 20            # default size = 20
1671055  JStrictEqual (size===undefined) -> keep 20
1671057  GetById 'overridingTheme'
1671058  GetByIdShort 'color'
1671059  GetById 'large'  (default false, :1671060-62)
1671063  GetById 'speed'  (default 900,   :1671064-65)
1671123  LoadConstStringLongIndex 'asset:/img/mini_spinner.png'
```
Same prop set, same default 20, same asset. `tintColor` = `color` prop (same as iOS). CYBERTRUCK Lottie branch present in same fn.
Payment copy: Function #82695 "BusyIcon" (222 bytes) at `:3722636`, asset `mini_spinner` 36x36 same hash `:3722813`.

**FACT [both-match]: BusyIcon default size = 20. Spinner is tinted ONLY when caller passes a `color` prop; otherwise renders native white PNG.**

---

## 1. Enumeration of BusyIcon (spinner) call sites + size prop

iOS scan of every `X.BusyIcon;` reference (`main.decompiled.js`). Size marked LITERAL where I resolved the register to a constant/spec:

| iOS line | size prop | color/tint? | context (INFERRED unless noted) |
|---|---|---|---|
| 3992216 | **none → default 20** | **none → white** | **ControlButton BUSY state** (see §2). VERBATIM `jsx(BusyIcon, {})` |
| 4002688 | **20** (literal, `:4002690`) | none | air-suspension control, wrapped in `suspensionBusyIcon` style (`:4002681`) |
| 6609738 | **18** (literal `r31=18`, `:6609735-40`) | none → white | loading-bar status row; wrapped in `busyIcon` style; followed by BodyLabel Text |
| 7296855 | **18** (literal `r33=18`, `:7296857`) | none → white | second copy of the same loading-bar status row |
| 6882423 | **25** = `Specifications.mediumSmallIconSize` (`:6882428`) | **color = row.textColor** (`:6882430-31`) | Wall-Connector info row — **TINTED** |
| 7281951 | `Specifications.mediumIconSize` (=30) | none | list/settings row |
| 1427567 | register (`lineHeight`-derived) | **color = r24** | inline-with-text spinner |
| 3349784 | register (`lineHeight`) | **color = r17** | inline-with-text spinner |
| 5113113 | 15 (`r15=15`) | **color = r10** | small tinted spinner |
| 5115956 | register | none | rtc / camera (`rtcBusyIconContainer` `:5115931`) |
| 5350867 | 20 | none | — |
| 6609/6611 pair | 18 | none | loading-bar (dup) |
| 6791703 | SMALL/MEDIUM (platform-branch) | **color = r23** | tinted |
| 7804107 | 24 | **color = r12** | tinted |
| 8115771 / 8122324 | (size omitted → 20) | **color** | tinted, default size |
| 8527387 / 8528032 / 8565976 | IconSize.LARGE etc. | **color** | tinted |
| many others | register | none | various |

Sizes actually seen as literals across sites: **12, 15, 18, 20, 24, 25(mediumSmall), 30(medium/iconSize), IconSize.LARGE**. Default when `size` omitted = 20.

Android BusyIcon call sites (string_id 8529 'BusyIcon'): 1543234, 1670050, 2135805, 2140393, 4117300, 4312517, **4417487 (ControlButton)**, 4538694, 4588620, 5219661, 5694221/5694279/5698883, 5764617, 5766210/5766418 (rtcBusyIconContainer `:5762938/5766395`), 5848951, 5853097/5853401, 5875343, 6038634, 7082603, 7361149, 7362457, 7363555, 7555326, 7644309, 8056769, 8072069, 8313455/8313697, 8590293, 8594898, 8936954, 8943584, 9217013, 9217592, 9257697. (Same component set as iOS.) [both-match structurally]

---

## 2. Control BUTTON with a command in flight — REPLACE, size, colour, opacity

### The ControlButton component (styledComponentType = 'ControlButton')
- iOS: render fn `_fun97743`; stylesheet + `styled` wrapper at `:3992536-3992575`.
- Android: Function #99079 "ControlButtonComponent" (1509 bytes); registered `styledComponentType='ControlButton'` at `:4417113-4417115`.

### 2a. Icon swap on BUSY — iOS `main.decompiled.js:3992182-3992220`  (VERBATIM logic)
```
case 537:  r5 = ControlButtonStatus.BUSY
           if(status(r20) !== BUSY)  -> case 570   // NOT busy
case 570:  r6 = module.NamedIcon
           r5 = Object.assign({name: r8}, r19 /*incl color,animationOn:false*/, r30)
           r5 = jsx(NamedIcon, r5)                 // real icon
           -> case 680
case 637:  r9 = module.BusyIcon                    // BUSY branch
           r6 = {}
           r5 = jsx(BusyIcon, r6)                  // <-- empty props
case 680:  r15 = r5                                 // same slot -> single child
```
**The NamedIcon is REPLACED by `jsx(BusyIcon, {})` in the same child slot — spinner is NOT placed alongside the icon.** `{}` props ⇒ **size = default 20, no `color` ⇒ tintColor undefined ⇒ white spinner.** [iOS-verified]

### 2a. Android `bundle.hasm:4417456-4417490`  (VERBATIM)  [both-match]
```
4417462  GetById 'ControlButtonStatus'
4417463  GetById 'BUSY'
4417464  JStrictEqual (status===BUSY) -> 0x27d
   // fall-through (NOT busy):
4417472  GetById 'NamedIcon'
4417476  PutNewOwnByIdShort  'name'
4417477  Object.assign(...)  ; 4417478 jsx(NamedIcon, …)
   // 0x27d BUSY branch:
4417487  GetById 'BusyIcon'
4417488  NewObject Reg6           # {}
4417489  Call3 jsx(BusyIcon, {})  # empty props -> default 20, white
```
Identical: **REPLACE, size 20, no tint (white).**

### 2b. iconButtonBusyOpacity (0.5) — where applied on the busy button
`busyDisabledStyle` is defined once in the ControlButton stylesheet:
- iOS `:3992540-3992548`:
```
r10 = {};
r11 = Specifications.iconButtonBusyOpacity;   // = 0.5
r10['opacity'] = r11;
r6['busyDisabledStyle'] = r10;                // busyDisabledStyle = { opacity: 0.5 }
```
- Android `:4417124-4417126`: `GetById 'iconButtonBusyOpacity'` → `PutNewOwnByIdShort 'opacity'` → `PutNewOwnByIdLong 'busyDisabledStyle'`. Same `{opacity:0.5}`. [both-match]

`busyDisabledStyle` is then pushed into the button's style arrays **only when status === BUSY** (else an empty `{}`):
- iOS text/children container (`:3992485-3992496`):
```
if(status === ControlButtonStatus.BUSY) r15 = busyDisabledStyle;  else r15 = {};
r14[2] = r15;  r9['style'] = r14;
```
- iOS iconContainer style (`:3992384-3992400`):
```
if(status !== BUSY) { if(!disabled) r19={} else r19 = (r26===true ? busyDisabledStyle : {}) }
else r19 = busyDisabledStyle;
r14[2] = r19;   // iconContainer style array
```
So **on BUSY the whole icon-container (the spinner) AND the label are dimmed to opacity 0.5**, on top of the icon→spinner swap. (Also reused for `disabled` when the appearance flag `r26` is set.) [iOS-verified; Android builds the same `busyDisabledStyle` and applies it in the same fn — treat opacity-0.5-on-busy as [both-match] structurally, VERBATIM application traced on iOS only → mark Android application INFERRED.]

**Net in-flight look of a control button: icon glyph replaced by a white 20px `mini_spinner`, and the icon container + text label faded to 50% opacity.**

---

## 3. Is the spinner ever TINTED? (per-site color prop)

Yes at several sites; tint = the `color` prop → `tintColor`.
- **Control button in-flight: NOT tinted** — `jsx(BusyIcon,{})` ⇒ white. [both]
- **Loading-bar / header status: NOT tinted** — `{size:18}` only ⇒ white. [iOS-verified] (R3 header-passes-no-tint→white **confirmed**).
- **suspensionBusyIcon: NOT tinted** — `{size:20}` only. [iOS]
- **Wall-Connector row (`:6882423-31`): TINTED** — `size = mediumSmallIconSize(25)`, `color = row.textColor`. [iOS]
- Inline-with-text spinners `:1427567, :3349784, :5113113, :6791703, :7804107, :8115771, :8122324, :8527387, :8528032, :8565976` all pass a `color` (usually the accompanying text's color). [iOS]

So tinting is **per-call-site**, driven entirely by whether the caller passes `color`. The two sites §5 cares about (control button, header) pass **no** color ⇒ white.

---

## 4. iconButtonBusyOpacity — every application traced

Value = **0.5**, defined in two spec objects (both platforms):
- Small header-ish specs (iOS `:1338587`; Android `:1566038`):
  `{'edgePadding':20,'pillContainerHeight':24,'iconButtonBusyOpacity':0.5,'statusBarHeight':null,'headerHeight':54}`
- Full design-system `Specifications` (iOS `:3349016`; Android `:3714899`):
  `{'pillContainerHeight':24,'iconButtonBusyOpacity':0.5,'headerHeight':54,...,'smallIconSize':20,'mediumSmallIconSize':25,'mediumIconSize':30,'iconSize':30,'largeIconSize':36,...}`

Usages:
1. **ControlButton `busyDisabledStyle`** — iOS `:3992546`, Android `:4417124`. `{opacity:0.5}`, applied to icon-container + label style arrays while `status===BUSY` (see §2b). This is the canonical "busy button dimmed to 0.5" case. [both-match def; iOS-verified application]
2. **A list/period component `disabled` style** — iOS `:5255566` (`:5255562-5255568`): `r3['disabled'] = {opacity: Specifications.iconButtonBusyOpacity}` — reused as a generic disabled dim, NOT tied to a spinner. Android counterpart `:5954336`. [both]

No other consumers of `iconButtonBusyOpacity`.

---

## busyIcon wrapper style (header/loading-bar) — VERBATIM
iOS `:6609079-6609083`: `r6 = {}; r6['marginRight'] = r7;  r3['busyIcon'] = r6;` where `r7 = 7` (`:6609055`) ⇒ **busyIcon = { marginRight: 7 }**. Sibling styles: `barStatus = {paddingTop: Gutter}`, `centeredRow = {alignItems:'center', flexDirection:'row'}`, `loadingBarContainer = {height:80, justifyContent:'flex-end', paddingBottom: Gutter}`. [iOS-verified]

## ControlButton full stylesheet — VERBATIM (iOS `:3992540-3992569`)  [both-match, Android `:4417126-4417147`]
```
busyDisabledStyle = { opacity: 0.5 }                                   // = Specifications.iconButtonBusyOpacity
container         = { alignItems:'center', flexDirection:'column', justifyContent:'center' }
cyclingText       = { width:'100%' }
iconContainer     = { alignItems:'center', flexDirection:'column', justifyContent:'center' }
notification      = { right:-15, top:-35 }                             // uint32 4294967281 / 4294967261
pressContainer    = { borderRadius:90, bottom:0, left:0, position:'absolute', right:0, top:0 }
text              = { lineHeight:14, paddingTop: Gutter*0.2, textAlign:'center' }
```
