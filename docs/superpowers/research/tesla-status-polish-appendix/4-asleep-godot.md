# R4 §4 — How the official Tesla app presents an ASLEEP vehicle

Sources:
- iOS: `/Users/ivan/Downloads/tesla-haptics-work/main.decompiled.js` (Hermes decompiled JS, iOS v4.56)
- Android: `/Users/ivan/Work/tesla-summon/work/bundle.hasm` (Hermes disasm, v4.58)
- Godot project: `split_assets_pack.apk` → `assets/godot/` (Android APK; the compiled `.gdc` scripts)

---

## TL;DR — the mechanism

There is **NO React-Native overlay View and NO `opacity` prop on the renderer view.**
The "dim" is a **renderer-side (Godot) screen-overlay quad**, driven from RN by a native
message `SET_SCREEN_OVERLAY_COLOR` carrying `{color, alpha, animated, duration, transition_type, ease_type}`.

Two DISTINCT renderer effects, two DISTINCT triggers — do not conflate:

| Effect | RN → Godot mechanism | Exact value | Driving boolean | What that boolean means |
|---|---|---|---|---|
| **Renderer DIM** | `setScreenOverlayColor(color, alpha)` → msg `SET_SCREEN_OVERLAY_COLOR` | color = **`ThemeContext.v5BackgroundColor`**, alpha = **`0.5`** when true else **`0`**; animated=true, duration=**0.5s**, transition=LINEAR, ease=OUT | **`isSelectedVehicleDataUnreliable`** | data QUALITY unreliable (CACHED_UNRELIABLE / UNABLE_TO_FETCH / NO_DATA) |
| **Renderer LOADING animation** | `updateProduct({… mobile_app_state:{is_loading, show_terrain}})` | `is_loading = true` | **`getSelectedVehicleShouldShowLoadingAnimation`** | dataQuality **=== NO_DATA** (never fetched) ONLY |

**Neither is tied to `ConnectionState.ASLEEP` directly.** "Asleep" is a *data-freshness*
condition here: an asleep car stops returning fresh `vehicle_data`, its data quality degrades,
and THAT (unreliable) triggers the dim. The literal word "asleep" only appears (a) in the
`ConnectionState` enum used by `isVehicleOnline/Offline`, and (b) as the freshness LABEL text
`"Asleep {{age}}"` — never as a renderer flag.

There is ALSO a separate **RN opacity 0.5 on the battery row** (R3 §C3), driven by yet a
third boolean `isDataStale` (>2 min). So three different 0.5 treatments with three triggers.

---

## 1. The dim mechanism — VERBATIM

### 1a. `setScreenOverlayColor` definition (iOS) — the RN→Godot bridge
`main.decompiled.js` ~line **1173339** (`Original name: setScreenOverlayColor`). Argument
defaults and the emitted native message (case 144):

```
r2 = r1.SET_SCREEN_OVERLAY_COLOR;
r1 = {};
r9 = a0;  r1['color'] = r9;
r9 = a1;  r1['alpha'] = r9;
r1['animated'] = r8;            // arg2, default true (case 0/19/29)
r1['duration'] = r7;            // arg3, default = defaultCameraAnimationDuration (case 51)
r1['transition_type'] = r6;     // arg4, default = <slot20>.LINEAR (case 88)
r1['ease_type'] = r5;           // arg5, default = <slot21>.OUT (case 125)
r1 = r3.bind(r4)(r2, r1);       // sendMessage(SET_SCREEN_OVERLAY_COLOR, {...})
```
So `setScreenOverlayColor(color, alpha)` with only 2 args → `animated:true, duration:0.5s,
transition_type:LINEAR, ease_type:OUT`.

`defaultCameraAnimationDuration` VALUE (iOS `main.decompiled.js` line **1174109**):
```
r16 = 0.5;
r1['defaultCameraAnimationDuration'] = r16;
r11 = r11.QUART;   r1['defaultCameraAnimationTransition'] = r11;
r6 = r6.OUT;       r1['defaultCameraAnimationEase'] = r6;
```
→ duration = **0.5 (seconds)**. (Note: the store's default *camera* transition is QUART,
but `setScreenOverlayColor`'s OWN default transition is **LINEAR**, ease **OUT**.) [both — Android has same]

Android: `bundle.hasm:1385553` `# String: 'SET_SCREEN_OVERLAY_COLOR'`; function
`#29160 "setScreenOverlayColor" of 216 bytes` at `bundle.hasm:1390364`, emits
`SET_SCREEN_OVERLAY_COLOR` at `bundle.hasm:1390414`. [both-match]

### 1b. The call site in the vehicle-detail view (iOS) — color + alpha + gating
`main.decompiled.js` `_fun111021` (a `useEffect`), around line **4562440**:

```
case 0:   r2 = _closure2_slot15; r1 = true;
          if(!(r2 === r1)) { ...ip=72 (skip) }        // only when useIsFocused === true
case 13:  r2 = _closure2_slot12; r1 = _closure2_slot3;
          if(!(r2 === r1)) { ...ip=72 (skip) }         // only when showingProductId === this vehicle id
case 25:  r1 = _closure1_slot7; r3 = r1.default;
          r2 = r3.setScreenOverlayColor;
          r1 = _closure2_slot14;                        // arg0 color  = v5BackgroundColor
          r4 = _closure2_slot44;                        // the boolean = isSelectedVehicleDataUnreliable
          r0 = 0;
          if(!r4) { ...ip=66 }                          // if !unreliable → alpha 0
case 56:  r0 = 0.5;                                     // if unreliable → alpha 0.5
case 66:  r0 = r2.bind(r3)(r1, r0);                     // setScreenOverlayColor(v5BackgroundColor, 0|0.5)
```

`_closure2_slot14` (the color) assignment, `main.decompiled.js` line **4560812**:
```
r2 = r2.ThemeContext;   r2 = r3.bind(r4)(r2);          // useContext(ThemeContext)
r31 = r2.v5BackgroundColor;
var _closure2_slot14 = r31;
```
→ **overlay color = `ThemeContext.v5BackgroundColor`** (the current theme background — NOT a
hard-coded black). [iOS-verified; Android has identical selectors + same call shape at
`bundle.hasm:4420098`(isSelectedVehicleDataUnreliable) + `bundle.hasm:4420386`(setScreenOverlayColor)]

`_closure2_slot44` (the boolean) assignment, `main.decompiled.js` line **4561440**:
```
r1 = r1.isSelectedVehicleDataUnreliable;
r65 = r2.bind(r4)(r1);                                  // useTypedSelector(isSelectedVehicleDataUnreliable)
var _closure2_slot44 = r65;
```

### 1c. WHICH view it covers
The Godot **whole main render surface** (the 3D car scene), not the RN chrome. It is drawn by
the Godot `ScreenOverlay` node inside the renderer, so RN text/battery/buttons sitting ABOVE
the renderer are NOT dimmed by it. (The battery-row 0.5 is a *separate* RN opacity — see §5.)

### 1d. Godot side — `ScreenOverlay.gdc` (Android APK, verbatim readable strings)
`assets/godot/mobile/scripts/ScreenOverlay.gdc` string table:
```
res://mobile/scripts/ReactMsg.gd
/root/Mobile/MobileComm
Tween
on_set_screen_overlay_color
color
#000000            <- Godot-side DEFAULT color (black) if RN omits it; RN always sends v5BackgroundColor
alpha
animated
duration
333333             <- Godot-side default duration literal (0.333333); RN overrides with 0.5
transition_type
ease_type
```
So Godot handles `SET_SCREEN_OVERLAY_COLOR` in `on_set_screen_overlay_color`, tweening a
full-surface color quad's `alpha`. Message routed via `ReactMsg.gd` (`SET_SCREEN_OVERLAY_COLOR`
constant present in `ReactMsg.gdc`). [Android-verified via .gdc; the RN contract that feeds it
is both-match]

---

## 2. The LOADING animation (`mobile_app_state.is_loading`) — separate from the dim

### 2a. RN sends it via `updateProduct` (iOS), `_fun111022` useEffect (line ~4562555):
```
r0 = '[VDU] Show loading Godot animation:';        // log (line 4562559)
...
r1 = r2.updateProduct;
r0 = {};  r0['id'] = <vehicle id>;
r0['type'] = ProductType.VEHICLE;
r6 = {};
r6['is_loading']  = _closure2_slot45;               // getSelectedVehicleShouldShowLoadingAnimation
r6['show_terrain'] = _closure2_slot2;
r0['mobile_app_state'] = r6;
r0 = r1.bind(r2)(r0);
```
Guard (cases 0–302): this loading-true branch runs ONLY when
`useNavigationState route === RouteName.ProductHomeScreen`. On Climate / Controls / Service /
Demo / ManageProduct routes it falls to case 425 which forces
`mobile_app_state = {'is_loading': false, 'show_terrain': false}`. [iOS-verified]

`_closure2_slot45` origin, line **4561450**:
```
r1 = r1.getSelectedVehicleShouldShowLoadingAnimation;
r64 = r2.bind(r4)(r1);                               // useTypedSelector(...)
var _closure2_slot45 = r64;
```

Multiple other lifecycle points explicitly push `mobile_app_state = {is_loading:false,
show_terrain:false}` on the VEHICLE product (e.g. lines 4039672, 4559144, 4562601, 5226341) —
i.e. clearing the loading animation when a camera move / focus completes.

Android: `bundle.hasm:5211752` `# String: '[VDU] Show loading Godot animation:'`; selector
strings at `bundle.hasm:1501163` (getSelectedVehicleShouldShowLoadingAnimation) and
`bundle.hasm:1436032` (shouldShowLoadingGodotAnimation fn #30698). [both-match]

### 2b. Godot consumes it — `VehicleData.gdc` (Android APK)
`assets/godot/mobile/scripts/data/VehicleData.gdc` parses the payload; string table includes:
```
... speed, shift_state, is_climate_on, is_preconditioning, is_front_defroster_on,
    is_rear_defroster_on, is_loading, show_terrain, wheel_turn_deg, skin, vin,
    vehicle_state, vehicle_config, mobile_app_state, car_wrap_state ...
```
So `mobile_app_state.is_loading` / `show_terrain` are first-class fields the Godot VehicleData
reads. (The `.gdc` is compiled bytecode; only the field names are recoverable — the exact
scene response to `is_loading=true` is UNRESOLVED beyond "shows the loading Godot animation"
per the RN log string.) [Android-verified names; behaviour INFERRED/UNRESOLVED]

---

## 3. What actually drives each boolean — the ground truth (iOS)

Selector wiring, `main.decompiled.js` ~1284067–1284101:
```
isSelectedVehicleDataStale        = createSelector(store => isVehicleDataStale(store))
isSelectedVehicleDataUnreliable   = createSelector(getSelectedVehicleDataQuality, q => isVehicleDataUnreliable(q))
getSelectedVehicleShouldShowLoadingAnimation = createSelector(store => shouldShowLoadingGodotAnimation(store))
getSelectedVehicleDataFetchedRecently        = createSelector(store => fetchedDataRecently(store))
```

Helper impls, `main.decompiled.js` 1240398–1240760:

**`getVehicleDataQuality(v)` (fn #30237, line 1240398):**
```
v == null                      -> VehicleDataQuality.NO_DATA
unableToFetchDataRecently(v)   -> VehicleDataQuality.UNABLE_TO_FETCH
!isVehicleDataStale(v)         -> VehicleDataQuality.LIVE
   else (stale):
     diff = (last_seen||0) - vehicleConfigTimestampMS(proto_vehicle_data)
     if diff <= TimeInMs.TEN_MINUTES  AND  <slot151>(proto_vehicle_data) -> CACHED_RELIABLE
     else                                                                -> CACHED_UNRELIABLE
```

**`isVehicleDataQualityReliable(q)` (fn #30238):** true iff q ∈ {LIVE, CACHED_RELIABLE};
false for CACHED_UNRELIABLE, UNABLE_TO_FETCH, NO_DATA, undefined, null.

**`isVehicleDataUnreliable(q)` (fn #30239, line 1240562):** `return !isVehicleDataQualityReliable(q)`.
→ **DIM shows when quality ∈ {CACHED_UNRELIABLE, UNABLE_TO_FETCH, NO_DATA}.** [iOS-verified;
Android fn `#30693 "isVehicleDataUnreliable" of 22 bytes` @ `bundle.hasm:1461868` — same 22-byte `!reliable`]

**`isVehicleDataStale(v)` (fn #30240, line 1240571):** true if `proto_vehicle_data` /
`getVehicleConfig()` is null, OR `every(dataTimestamps, olderThan TimeInMs.TWO_MINUTES)`.
→ i.e. all data > **2 minutes** old. [both-match; R3 confirmed]

**`fetchedDataRecently(v)` (fn #30243, line 1240656):** `!olderThan(last_received_vehicle_data_timestamp, TWO_MINUTES)`.

**`shouldShowLoadingGodotAnimation(v)` (fn #30244, line 1240683):**
```
return getVehicleDataQuality(v) === VehicleDataQuality.NO_DATA;
```
→ **loading animation ONLY for a never-fetched vehicle (NO_DATA).** An asleep car WITH cached
data does NOT get the loading animation. [iOS-verified; Android fn
`#30698 "shouldShowLoadingGodotAnimation" of 55 bytes` @ `bundle.hasm:1462001`]

`VehicleDataQuality` enum values: `LIVE, CACHED_RELIABLE, CACHED_UNRELIABLE, UNABLE_TO_FETCH, NO_DATA`.

---

## 4. Transition (awake ↔ dimmed)

From §1a defaults, the dim is animated: `setScreenOverlayColor(color, alpha)` →
`animated:true, duration:0.5s (defaultCameraAnimationDuration), transition_type:LINEAR,
ease_type:OUT`. The Godot `ScreenOverlay` runs this on a **`Tween`** on the overlay quad's
`alpha` (Godot default duration constant `333333`=0.333s is overridden by RN's 0.5s).
So awake→dimmed = alpha 0→0.5 and dimmed→awake = 0.5→0, each a **0.5 s linear ease-out tween**.
[duration/ease iOS-verified; Tween Android-verified via ScreenOverlay.gdc]

(Distinct: `updateGodotScreenOverlayColor` fn #97801 @ line 3994817 defines a separate
`withSequence(withTiming(1,1000ms), withTiming(1,10000ms), withTiming(0,2000ms))` reanimated
value — a pulsing overlay used elsewhere; not the asleep dim path. Noted, not load-bearing.)

---

## 5. What else changes when asleep / stale / unreliable

- **Status header text** (R3, reconfirmed here): the freshness label `lastUpdatedString` reads
  **`"Asleep {{age}}"`** (or `"Last seen {{age}}"`), or `"Connecting"` when null. Driven by the
  **stale** branch (`isDataStale`), NOT by the renderer-dim boolean. So "Asleep" is a TEXT
  string, not a renderer state.
- **Spinner** co-renders with that stale branch (`canWake || !fetchedDataRecently`) — see R3 §A.
- **Battery row opacity** (R3 §C3, fn #117221): the whole battery row `Animated.timing` →
  **opacity 0.5** when **`isVehicleDataStale`** (instant to 0.5, restore to 1.0 over 500 ms).
  This is a **React-Native opacity animation on the RN battery-row component**, driven by
  **stale (>2 min)** — a DIFFERENT boolean and a DIFFERENT layer than the Godot renderer dim
  (which is driven by **unreliable**). The combined selector at `main.decompiled.js:4567300`
  reads BOTH `isSelectedVehicleDataStale` (idx 4) and `isSelectedVehicleDataUnreliable` (idx 5)
  plus `getSelectedVehicleDataFetchedRecently` (idx 6) into the header — confirming they are
  independent inputs.
- Favourite/control buttons: no evidence found that the renderer-dim boolean disables them;
  UNRESOLVED (out of the §4 renderer scope).

---

## 6. Sleep vs. staleness — which boolean drives the renderer dim? (the key question)

**The renderer dim is driven by DATA RELIABILITY (`isSelectedVehicleDataUnreliable` →
`isVehicleDataUnreliable(dataQuality)`), NOT by `ConnectionState.ASLEEP`.**

- `ConnectionState.ASLEEP` (enum value `'asleep'`, def `main.decompiled.js:1254624`) is consumed
  ONLY by `isVehicleOnline` / `isVehicleOffline` (fns #30234/#30235, line ~1240216) — used for
  online/offline gating, NOT for the overlay.
- Asleep affects the renderer dim only **transitively**: asleep car → no fresh `vehicle_data` →
  timestamps age → `getVehicleDataQuality` returns CACHED_UNRELIABLE/UNABLE_TO_FETCH →
  `isVehicleDataUnreliable = true` → overlay alpha 0.5.
- The loading animation (`is_loading`) is driven by `dataQuality === NO_DATA` — first-ever load
  only, independent of sleep.
- The header battery-row 0.5 opacity is driven by `isDataStale` (>2 min) — a THIRD boolean.

So the three "0.5" effects the team may have conflated are distinct:
1. Godot renderer dim (theme-bg color, alpha 0.5, 0.5s tween) ← **isVehicleDataUnreliable**
2. RN battery-row opacity 0.5 (500 ms restore)             ← **isVehicleDataStale**
3. (loading spinner + Godot loading animation)             ← **NO_DATA / stale branch**

**Our build's `rgba(0,0,0,0.6)` full-screen blackout is wrong on 3 counts:** (a) it's a
full-screen RN overlay, official is a renderer-only Godot quad; (b) official color is
`ThemeContext.v5BackgroundColor`, not hard black; (c) official alpha is **0.5**, not 0.6; and it
animates in/out over 0.5 s LINEAR/OUT rather than being an instant hard overlay.

---

## Platform coverage / confidence

- RN→Godot contract (`SET_SCREEN_OVERLAY_COLOR`, `mobile_app_state.is_loading/show_terrain`,
  `updateProduct`, `[VDU] Show loading Godot animation`): **both-match** (iOS JS + Android hasm).
- Driving selectors/helpers (`isVehicleDataUnreliable`, `shouldShowLoadingGodotAnimation`,
  `getVehicleDataQuality`, `isVehicleDataStale`): **both-match** (iOS full logic read; Android
  function sizes/names confirm same, byte-for-byte logic not re-decompiled).
- alpha=0.5, duration=0.5s, transition=LINEAR, ease=OUT, color=v5BackgroundColor: **iOS-verified**
  (Android call shape identical; exact literal 0.5/0.5s read on iOS).
- Godot `ScreenOverlay.gdc` / `VehicleData.gdc` behaviour: **Android-verified** (compiled .gdc,
  string-level; iOS ships the same Godot project but I read the Android copy).

## UNRESOLVED / gaps
- Exact Godot scene reaction to `is_loading=true` (which node/animation) — `.gdc` is compiled;
  only field names recovered.
- `<slot151>` predicate inside `getVehicleDataQuality` CACHED_RELIABLE branch not fully named.
- Whether control/favourite buttons dim/disable under the renderer-dim boolean — not found.
- iOS Godot `.gdc` not independently diffed against Android's (assumed identical project).
