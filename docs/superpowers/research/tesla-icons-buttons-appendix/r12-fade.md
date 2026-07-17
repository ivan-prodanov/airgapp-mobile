# R12 §3 — Marker/content fade retrigger + reset semantics

Primary: `/Users/ivan/Downloads/tesla-haptics-work/main.decompiled.js` (iOS v4.56).
Cross-check: `/Users/ivan/Work/tesla-summon/work/bundle.hasm` (Android v4.58).
WE SHIP iOS.

---

## 0. Components located (iOS)

| Component | `// Original name:` line | fade `Animated.Value` created | fade slot |
|---|---|---|---|
| `VehicleControlsScreen` | 4039275 (`_fun98619`) | 4039613-4039620 | `_closure2_slot12` (reg `r16`) |
| `VehicleClimateControlsOverlay` | 5225920 (`_fun120884`) | 5226285-5226291 | `_closure2_slot7` (reg `r24`) |
| `VehicleHomeScreen` | 4560628 (`_fun110988`) | 4561352-4561368 | `_closure2_slot39` (reg `r15`) |

Note: the Home content-fade effect body is **`_fun111026`** @ 4562745-4562857, not `_fun110988` (that is the component itself). R10's line range 4562745-4562858 is correct.

---

## 1. Does the fade restart on EVERY markers response, or only the first?

**Answer: it starts EXACTLY ONCE per mount. Not per response. And even if it re-ran, it would be harmless — there is no reset-to-0 anywhere on the path.** [iOS-verified]

### Exact code path (Controls)

```
useEffect(fn, [vehicleId])                                 // 4039640-4039779; deps r9[0] = r2
  └─ if (!isFocused /*_closure2_slot9, useIsFocused()*/) return;   // 4039646-4039650
  └─ if (vehicleId != null) Godot.updateProduct({...})            // 4039654-4039673
  └─ Godot.moveCameraWithCompletion(
       {position: CameraPosition.TOP_DOWN, carType},              // 4039677-4039683
       _fun98627)                                                 // 4039684
       └─ _fun98627: if (!slot13) return;                         // 4039687-4039691
          └─ Godot.getVehicleMarkers(vehicleId, _fun98628)        // 4039695-4039763
             └─ _fun98628(markers):                               // 4039697-4039762
                  if (!slot13) return;                            // 4039701-4039705
                  if (!isEmpty(markers)) setMarkers(markers)      // 4039715-4039719
                  else setMarkers(getVehicleMarkersFallback(carType ?? CARTYPEMODELY,
                                    RouteName.VehicleControlsScreen))   // 4039720-4039747
                  // case 171 — reached from BOTH branches:
                  Animated.timing(fade /*slot12*/, {
                     easing: Easing.cubic, toValue: 1,
                     duration: 300, useNativeDriver: true }).start();   // 4039749-4039759
```

Verbatim options object, iOS 4039753:
```js
r1 = {'easing': null, 'toValue': 1, 'duration': 300, 'useNativeDriver': true};
```
(`easing` is patched to `Easing.cubic` on the next two lines.) Identical literal on Climate @ **5226418**.

### Is `.start()` guarded?

- **No ref, no flag, no `if` guards the `.start()` itself.** Case 171 is the join point of both the has-markers and the fallback branch — it always runs once control reaches `_fun98628` past the `slot13` check.
- The only guards are the two `_closure2_slot13` early-returns (4039687, 4039701). `slot13` is `useState(true)` (4039621-4039629); its setter `slot14` is called with `false` **only** in the effect's cleanup (4039769-4039774), i.e. on unmount / vehicleId change. Nothing ever sets it back to `true`.

### Why "once per mount", not "once per response"

`getVehicleMarkers` (iOS **1173701**, `_fun28720`) is a **one-shot request**, not a subscription:
```
registerRequestListener(GodotResponse.VEHICLE_MARKERS_RESPONSE, handler)  // 1173711-1173713
sendMessage(GodotRequest.GET_VEHICLE_MARKERS, {vehicle_id})               // 1173792-1173797
```
and the dispatcher (`_fun28726`, iOS 1173980-1174009) **clears the bucket after fanning out**:
```
requestListeners[type].forEach(fn => fn(payload));   // 1173997-1174005
requestListeners[type] = [];                          // 1174006-1174009   ← VERBATIM shape
```
`registerRequestListener` (iOS **1173671**) only ever `push`es (1173689-1173691) — it never removes. So the array is drained by the dispatcher, one callback invocation per request.

Likewise `moveCameraWithCompletion` (iOS **1173810**) registers a one-shot `MOVE_CAMERA_RESPONSE` listener gated on `animation_id === <the id moveCamera returned>` (1173825-1173831).

⇒ Per mount: effect runs once (deps `[vehicleId]`) → one `moveCamera` → one completion → one `getVehicleMarkers` → one `_fun98628` → **one `.start()`**.

⚠️ **The prompt's premise "markers are re-requested when the camera settles" does not hold for iOS Controls/Climate.** There is no camera-settle re-request; the camera move *is* what triggers the single request. UNRESOLVED whether some other module issues `GET_VEHICLE_MARKERS` — but it would not matter (next point).

### Would a re-run blink?

**No.** Grep of the entire `VehicleControlsScreen` body (4038800-4041600) for `_closure2_slot12`: the value is read at **4039752 only**. No `setValue`, no `stopAnimation`, no second `timing`. Same for Climate `_closure2_slot7`: read at **5226417 only**.

⇒ Any hypothetical re-`start()` runs `timing(fade, {toValue: 1})` from the *current* value (already 1) → 0-delta, **no blink**. The animation is idempotent by construction.

---

## 2. What resets the value to 0?

**iOS: NOTHING. Unmount only — and only because the `Animated.Value` object dies with the component.** [iOS-verified]

- Created via `useRef(new Animated.Value(0)).current` (4039608-4039620). Literal `0` is the constructor arg (reg `r65 = 0` @ 4039615), **unconditional**.
- Climate identical: `useRef(new Animated.Value(0)).current`, literal `0` (reg `r40 = 0` @ 5226286), 5226280-5226291.
- `useRef` ⇒ the Value survives every re-render; nothing re-seeds it.
- **No blur/focus reset path exists on iOS.** `useIsFocused()` (slot9 @ 4039482) is read *only* as an early-return guard inside the two `useEffect`s (4039513, 4039646) — it is **not** a dep of the markers effect (deps are `[vehicleId]`), so blur does not re-run it and does not fire its cleanup.
- The screen's `useFocusEffect` (4039583-4039607, callback `_fun98625`, deps `[v5BackgroundColor, isDataUnreliable]`) only calls `Godot.setScreenOverlayColor(color, isDataUnreliable ? 0.5 : 0)` — **it never touches the fade**.

### Behaviour: blur → refocus without unmount

The fade stays at **1**. `slot13` has already been flipped to `false` only if the effect cleaned up (unmount/vehicleId change), so a plain blur/refocus of a still-mounted screen leaves everything at 1. **No re-fade, no blank frame.**

### [differ] — R10's Android `stopAnimation` finding, corrected

R10 attributed `bundle.hasm` 5211977 to "the head of the Controls focus branch". **That is wrong.** The call site is:

```
==> 0000010c: JStrictNotEqualLong  → 0x1c0     # if (topRoute !== RouteName.ManageProductScreen) → Ret
==> 00000113: LoadFromEnvironment  <Reg8:4, Reg8:1, UInt8:39>   # env[1][39] == _closure2_slot39
==> 00000117: GetById              ... string_id: 43567  # 'stopAnimation'
==> 0000011d: Call1
==> 00000121: … Animated.timing(env[1][39], {easing: Easing.cubic, toValue: isFocused?1:0, duration, useNativeDriver:true}).start()
```
Slot **39** = **`VehicleHomeScreen`'s content fade**, and 0x113 is the join address of the five-route branch — i.e. the exact analogue of **iOS `case 275`** in `_fun111026`. So:

> **[differ]** In `VehicleHomeScreen`'s content-fade effect, Android calls `fade.stopAnimation()` immediately before `Animated.timing(...)` on the `toValue = isFocused ? 1 : 0` branch (`bundle.hasm` 0x0113-0x011d, ~line 5211977). iOS omits it (`main.decompiled.js` 4562814-4562818 goes straight `slot6.Animated.timing`). The Android `toValue: 1` branch (0x176-0x1bc, iOS `case 360`) has **no** `stopAnimation` on either platform.

Global `grep stopAnimation bundle.hasm`: every other hit is inside the RN `Animated` library itself (AnimatedValue/AnimatedNode/NativeAnimatedModule method tables). **There is no `stopAnimation` in Android's Controls or Climate either.** [both-match on Controls/Climate: no stopAnimation]

---

## 3. Home's content fade — is the LEAVE case really `duration: 0`?

**Yes, confirmed. And no, it is not gated on markers.** [iOS-verified] — `_fun111026`, iOS 4562745-4562857.

Deps array (4562741-4562744): `r63 = [r15, r3, r12]` =
- `r15` = `_closure2_slot39` = the fade `Animated.Value` (assigned 4561368)
- `r3`  = `_closure2_slot15` = `useIsFocused()` (assigned 4560818-4560820)
- `r12` = `_closure2_slot43` = `topRoute` = `useNavigationState(s => s.routes[s.index].name)` (4561422-4561436)

⇒ **R10's `[fade, isFocused, topRoute]` is correct.** No markers value, no `vehicleMarkers` state, nothing marker-derived in the deps or the body.

Decompiled logic (Hermes-inverted conditions resolved):

```js
const duration = isFocused ? 300 : 0;                 // 4562748-4562752
if (topRoute === ModalRoutes.ThirdPartySharingRequestModal   // 4562763  if(!(a!==b)) ≡ ===
 || topRoute === RouteName.ProductHomeScreen) {              // 4562772
    // case 360:
    Animated.timing(fade, {easing: Easing.cubic, toValue: 1,
                           duration, useNativeDriver: true}).start();   // 4562837-4562853
} else if (topRoute === RouteName.VehicleClimateScreen        // 4562780
        || topRoute === RouteName.VehicleControlsScreen       // 4562788
        || topRoute === ServiceRoutes.HomeScreen              // 4562797
        || topRoute === ServiceRoutes.TrackerScreen           // 4562805
        || topRoute === RouteName.ManageProductScreen) {      // 4562813  if(!(a===b)) goto 434 ≡ else nothing
    // case 275:
    Animated.timing(fade, {easing: Easing.cubic,
                           toValue: isFocused ? 1 : 0,        // 4562823-4562829
                           duration, useNativeDriver: true}).start();   // 4562814-4562835
}
// case 434: else — no animation at all
```

- **LEAVE case = `toValue: 0, duration: 0` ⇒ instant blank.** CONFIRMED (`duration` and `toValue` are driven by the *same* `isFocused` register, `r9`/`r0` = slot15, read twice: 4562748 and 4562823).
- ENTER case = `toValue: 1, duration: 300`.
- Note the `case 360` branch **also** uses the `isFocused ? 300 : 0` duration with a hard `toValue: 1` — so backgrounding Home under ProductHomeScreen/ThirdPartySharingRequestModal snaps it to **visible** instantly. (Not something we need, but it is what the code says.)

### 🔴 Home's initial value is NOT 0 — it is conditional

```js
// iOS 4561352-4561368  (r3 = _closure2_slot15 = isFocused; r49 = 1)
r1 = 0;
if (!r3) goto 1703;   // if (!isFocused) keep 0
r1 = r49;             // = 1
1703:  fade = useRef(new Animated.Value(r1)).current;
```
⇒ **`useRef(new Animated.Value(isFocused ? 1 : 0)).current`** — Home mounts already-visible when it mounts focused, so its 300ms enter never plays on cold mount. Controls/Climate are hard `0`.

### Other writes to Home's fade

`grep _closure2_slot39` over 4560000-4566000 → **4562818 and 4562841 only** (the two `timing` targets). The `setValue` at **4563195** is on `r48` = `_closure2_slot40` = **`scrollY`**, not the fade:
```js
if (topRoute === RouteName.VehicleSummonScreenV2 && !isFocused) scrollY.setValue(0);   // 4563185-4563196
```
UNRELATED to the fade. [iOS-verified]

---

## 4. Do the Controls/Climate content fades assume a card is fading underneath?

**No. Both are safe to lift into an in-page panel as-is.** [iOS-verified]

Three things checked:

**(a) Initial `Animated.Value` argument** — both are a hard literal `0`, not a card-derived or focus-derived seed:
- Controls: `r65 = 0` @ 4039615 → `new Animated.Value(0)` (contrast Home, §3, which *is* conditional).
- Climate: `r40 = 0` @ 5226286 → `new Animated.Value(0)`.

**(b) No opacity site composes anything.** Every site assigns the bare `Animated.Value` register — **no `interpolate`, no `Animated.multiply`, no second animated input**:

Controls (`r16` = `slot12`; verified no reassignment of `r16` between 4039620 and 4040900):
| line | site |
|---|---|
| 4040095 | vehicle-markers overlay (`opacity`, `vehicleMarkers`, `verticalOffset`, `leftOffset`, `rightOffset`) |
| 4040130, 4040197, 4040307, 4040464, 4040561 | markers / buttons |
| 4040815, 4040833, 4040855, 4040881 | buttons |

= the 10 sites R10 reported. Climate: **1 site**, 5226528:
```js
// <Animated.View style={[styles.buttonsOverlay, {opacity: fade}]} …>
r23 = styles.buttonsOverlay; r22 = [r23, {opacity: r24}]; r4['style'] = r22;
```

**(c) No reliance on a card to hide a pre-fade frame** — because there is no pre-fade frame to hide: the Value is 0 at mount and the only mutation is 0→1. The markers themselves are `null`/undefined until `setMarkers` runs in the *same* callback that calls `.start()` (Controls 4039717/4039743 → 4039758; Climate 5226382/5226408 → 5226423), so the content does not exist before the fade begins. Nothing reads a card/route transition progress in either component.

⇒ **For our in-page panels: keep the hard `Animated.Value(0)`, keep `timing(→1, 300ms, Easing.cubic, useNativeDriver:true)` fired inside the markers callback, and add no reset.** Do **not** copy Home's `isFocused ? 1 : 0` seed (that exists only because Home is the always-mounted route underneath the card) and do **not** copy Android's `stopAnimation()` (that lives in Home, on a branch that can reverse to `toValue: 0` — ours never reverses, so there is nothing to stop).

---

## Open / unresolved

- **UNRESOLVED**: whether any other module sends `GodotRequest.GET_VEHICLE_MARKERS` for an already-mounted Controls/Climate. Not found in the two screens' bodies. Moot for the blink question (§1) — a second response cannot blink an unresettable `toValue: 1`.
- **Pre-existing quirk, not fade-related**: `slot13`/`slot8` (`useState(true)`) is set to `false` by the effect cleanup and is **never restored to `true`**. Since the effect deps are `[vehicleId]`, a vehicle switch runs cleanup → `slot13 = false` → the *re-run* effect's `_fun98627`/`_fun98628` both early-return, so **markers may never load after an in-place vehicle change** (the `setState(false)` and the effect re-run race). Not verified dynamically — flagged as INFERRED from the control flow at 4039687/4039701/4039769-4039774 (Climate: 5226356/5226368/5226441-5226444).
