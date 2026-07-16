# Tesla Android app — vehicle status area: exact look & feel (Round 2, visual layer)

**Target:** official Tesla Android app `com.teslamotors.tesla` **v4.58.0 (build 4392)**. Static RE of the React-Native **Hermes bytecode** (`bundle.hasm`) + apktool-decoded native resources. No dynamic analysis. Follow-up to `tesla-app-status-ux-FINDINGS.md` (Round 1: state machine + copy); this round is pixels/structure.

**Citation shorthand:** `hasm:N` = line N of `/Users/ivan/Work/tesla-summon/work/bundle.hasm`; `off 0xNNN` = bytecode offset inside the named function (stable across rebuilds); `xml:N` / `res/...` = decoded APK resources; `obj:N` = extracted object literal. **Confidence:** plain = read directly from an opcode/literal; **INFERRED** = interpretation; **UNRESOLVED** = not recovered. A wrong pixel is worse than a documented gap.

> ### ⚠️ SUPERSEDED IN PLACES BY ROUND 3 — see `tesla-status-assets-FINDINGS.md`
> Round 3 corrected three things in this document (verified against the user's real device):
> 1. **§3 spinner claim is WRONG.** The spinner does NOT appear only with "Connecting." It co-renders with the stale-data freshness text **"Last seen {{age}}" / "Asleep {{age}}"** (the `isDataStale` branch computes the spinner flag). "Connecting" is only that branch's null fallback. (Round-3 §A.)
> 2. **§4 offline/asleep rendering is WRONG.** "Asleep/Last seen {{age}}" is rendered by `VehicleStatusText` #117231 itself (via a `lastUpdatedString`/`isDataStale` hook), NOT by a separate component / parent-swap. (Round-3 §A.)
> 3. **§2 `statusTextContainer.marginTop` is WRONG (said 10).** Real value = **5** (`0.5×Gutter`; a `Mul` was missed). `batteryViewContainer.marginTop` is likewise 5. (Round-3 §C.)
> Also: the status-text colour left UNRESOLVED here is resolved in Round 3 = **`#8A8B8B` (dark) / `#606060` (light)** = `theme.textColorLight`. The battery is on its OWN row ABOVE the status line. The spinner asset is a white `mini_spinner.png` 36×36 mask.

---

## 0. Headline corrections to the two field observations

1. **"There's a loading bar next to the text when the user refreshes."** → It is **not a bar**. It is a small **rotating spinner PNG** (`BusyIcon` → `mini_spinner.png`), **18×18**, rendered inline just before the status text, spinning one turn per ~900 ms. There is **no** progress bar / `ProgressBar` / `LinearProgress` / shimmer / skeleton anywhere near the status text. A stock RN `RefreshControl` exists on the home list but its `refreshing` is hardcoded `false`, so its own spinner never persists — the visible feedback is the `BusyIcon`.
2. **"They show much less text than our app."** → Confirmed and explained: the status area is a **single `Text` node** (one line) in every state except Charging, it uses **no per-state icon** (text only), it **renders nothing at all** (zero nodes) when no status applies, and the offline/asleep state IS the freshness line ("Asleep 5 minutes" / "Last seen 2 hours ago") rather than a label plus a caption. Only Charging is multi-line.

---

## 1. Component tree of the status area

Component: **`VehicleStatusText`** fn **#117231** (hasm:5218968, 4179 bytes), inside the HomeHeader module (StyleSheet + siblings `HomeHeader` #117234, `VehicleHomeHeader` #117239, `ChargeStatus` #117220 at hasm:5217700+). It sits **under the car name** inside the header.

```
<Fragment>
 └─ <View style={statusTextContainer}>                          // row, align-center, marginTop:10   (off 0xb59)
     ├─ {showLoadingSpinner &&                                  // gated by Reg14 (JmpFalse off 0xb63)
     │     <View style={{marginRight:5 /*Gutter*0.5*/}}>        // off 0xba0
     │       <BusyIcon size={18} />                             // rotating mini_spinner.png (off 0xbba)
     │     </View>}
     ├─ (charging?
     │     // multi-line branch (ONLY charging):
     │     <View style={headerStatusText}>                      // off 0xc8f
     │        <View style={oneLineTextContainer}> …speed / ETA / charging-remaining… </View>
     │     </View>
     │   :
     │     // every other state — single line:
     │     <Text automationID="vehicle_home_header_status_text"  // off 0xc30
     │           category={TextCategory.BodyLabel}               // off 0xa1
     │           appearance={TextAppearance.Light}               // off 0xb9
     │           style={[headerStatusText, {}]}>                 // off 0xc41 (2nd elem empty → no per-state override)
     │       {statusString}
     │     </Text>)
     └─ {childPresenceDetected &&                               // NOT a liveness state
           <View style={{marginRight:5}}>
             <NamedIcon name={IconName.warning} size={IconSize.XSMALL/*16*/} color={Colors.warning/*#FFC107*/}/>  // off 0xf55
             <Text style={{color:Colors.transparentWhite90}}>{tr('vehicle_child_presence_detected')}</Text>
           </View>}
 </View>
</Fragment>
```

**Confirmed structural facts:**
- **One `Text` node** in every non-charging state — not a Text-with-children, not a concatenation. String is a single `tr()` result.
- **Charging is the only multi-line state** (a `View` with speed/ETA/charging-remaining sub-Views).
- **Renders `null` (nothing)** when no status applies and not charging/connecting (return-null at off 0xb2d). Empty status = zero nodes, not an empty string. (Big contributor to "much less text.")
- **No `numberOfLines`/`ellipsizeMode`** → the status line is **not truncated**; it wraps (`headerStatusText` has `flexWrap:'wrap'`).
- **No per-state glyph** in the status line — only the `BusyIcon` (Connecting) and the unrelated child-presence warning. Parked/Charging-text/Asleep/Offline/Low-Power/Mobile-Access/In-Service/Upgrade are **pure text**.
- **Offline/asleep freshness** ("Asleep {{age}}" / "Last seen {{age}}") comes from a separate selector **`vehicleDataLastUpdatedString`** (#30315, hasm:1440253); #117231 has **no** asleep/offline branch (it never references `ConnectionState`/`isVehicleOnline`). **INFERRED:** the parent renders the freshness string as the status line when offline/asleep, so it is still ONE line (not a second caption). Exact parent swap not opcode-proven end-to-end → gap.

---

## 2. Style table (exact values; `Gutter` base unit = 10, hasm:1566023)

| Element | Property | Value | Source |
|---|---|---|---|
| **statusTextContainer** (row wrapping spinner+text) | flexDirection / alignItems / marginTop | `row` / `center` / **10** | hasm:5217800 |
| spinner wrapper (inline) | marginRight | **5** (`Gutter*0.5`) | hasm:5219560 |
| **headerStatusText** | flexDirection / flexWrap / alignItems / justifyContent | `row` / `wrap` / `center` / `flex-start` | hasm:5217782 |
| oneLineTextContainer (charging sub-row) | marginLeft / position | `10` / `relative` | hasm:5217784 |
| **Status Text typography** | category | `TextCategory.BodyLabel` (token `bodyLabel`) | hasm:5219009 |
| | appearance | `TextAppearance.Light` | hasm:5219014 |
| | **fontSize** | **14** | hasm:1893435 (bodyLabel spec) |
| | **lineHeight** | **20** | hasm:1893435 |
| | **fontWeight** | **'500'** (Medium) | hasm:1893435 |
| | **letterSpacing** | **0.1** | hasm:1893435 |
| | **fontFamily** | **`UniversalSansText`** (Latin) / `Blender-TSL` (Chinese/Korean) | hasm:1893435 / 1567364 |
| | **color** | `theme.textColorLight` (muted/secondary; via `appearance:Light`) | generateTextThemedStyles hasm:1567411 |
| | numberOfLines / ellipsizeMode | none (no truncation, wraps) | hasm (absent in #117231) |

The design-system Typography scale (fn #41117, hasm:1893435, literal buffers): `body` = {14/20/'400'/-0.1}, **`bodyLabel` = {14/20/'500'/0.1}**, `caption` = {12/16/'400'/-0.1}, all `UniversalSansText`; the h-scale (h1..h4 = 24/20/18/16, h1_xxxl=48) uses `UniversalSansDisplay`/'500'. Design-system `Specifications` (hasm:3714899): `homeHeaderHeight:64, headerHeight:54, headerHorizontalGutter:30, homeScreenGutter:20, iconButtonBusyOpacity:0.5`; icon sizes `xxSmall12/xSmall16/small20/mediumSmall25/medium30/mediumLarge32/large36/xLarge60`.

**Per-state text colour:** The status label has an **empty per-state style-color object** (Reg29 `NewObject`, off 0x4af) — so there is **no per-state colour override** for liveness states; the colour is the themed `Text`'s `appearance:Light` = **`theme.textColorLight`** (muted). The **only** text-colour override in the whole component is **`Colors.powerRed` #FF3A3A**, used **only** for the Powershare error/initializing sub-state (off 0x8cb). `theme.textColorLight` is a theme accessor (resolves per light/dark) — **exact hex UNRESOLVED** (INFERRED near-white/light-grey; the sibling child-presence text uses `transparentWhite90` = rgba(255,255,255,0.9)).

---

## 3. The refresh indicator (answering the "loading bar")

**It is `BusyIcon` — a rotating spinner image, not a bar.** Three loading surfaces exist on the vehicle home; none is a bar:

| Surface | What it is | Shown when |
|---|---|---|
| **Header `BusyIcon`** (what the user sees "next to the text") | inline **rotating spinner PNG**, **18×18**, `mini_spinner.png`, **no tint** (asset colour), infinite native-driven **linear rotation, ~900 ms/turn** | status undetermined ("Connecting") **and** `canWake \|\| !fetchedDataRecently` |
| Godot 3D-car loading | native renderer flag `mobile_app_state.is_loading` | same VDU loop |
| RN `RefreshControl` on home `FlatList` | RN default pull-to-refresh control | **`refreshing` hardcoded `false`** → its spinner never persists; pull only fires the wake |

**`BusyIcon` internals** (design-system #35845, hasm:1671046 — INFERRED as the header's, strong): `Animated.Image` rotating `asset:/img/mini_spinner.png` via `Animated.loop(Animated.timing(…, {duration:speed/*900*/, useNativeDriver:true}), {iterations:-1})`, transform `rotate 0deg→360deg`. Component defaults: `size 20, speed 900, large false, color undefined`; **the header overrides `size` to 18** (`LoadConstUInt8 18` hasm:5219004, unchanged to render). Cybertruck theme → looping **Lottie** (`res/raw/spinner_ct.json`, INFERRED) instead of the PNG. There is a 2nd reanimated impl (#82695, payment flows) — visually identical.

**Trigger / gate:** the spinner is emitted **only** in the "Connecting"/undetermined status branch, gated by:
```
showLoadingSpinner = canWake || !fetchedDataRecently
```
`canWake` = selector `getSelectedVehicleCanWake` (hasm:5219042); `fetchedDataRecently` = `getSelectedVehicleDataFetchedRecently` (hasm:5219050). Confirmed by the debug log `'[VDU] Show loading spinner: … fetchedDataRecently … canWake'` (fn #117233, hasm:5219961). It is **data-state driven, not trigger-specific** — appears on any (re)connect (foreground poll, offline poll, pull-to-refresh, tap-status, command wake); **suppressed** when data is fresh and the car isn't wakeable (so NOT on every fetch). In every concrete state (Parked/Charging/Asleep/…) the flag is `false` → no spinner.

**Lifecycle:** purely reactive — re-derived from redux state each render; **no min-visible-duration / anti-flicker debounce** in the header path. The rotation runs while mounted and stops on unmount when the gate clears.

**RefreshControl:** the home screen `VehicleHomeScreen` (#117072) uses an `Animated.FlatList` (hasm:5210541) with `refreshing:false` (constant), `showsVerticalScrollIndicator:false`, `onRefresh` → fn #117131 → `vehicleWakeUp(vin, VehicleWakeReason.PULL_DOWN_REFRESH)` (hasm:5212695). No `tintColor`/`colors`/`progressViewOffset`/`size` set → RN platform defaults.

---

## 4. Display-rules table — what renders per state

State selection is a selector-driven if/else in #117231 (hasm:5219200–5219535); English from the Round-1 inline catalog. "Renders" = the single status `Text` unless noted.

| Vehicle state | Exact status string | Spinner? | Icon? | Lines | Text colour |
|---|---|---|---|---|---|
| **Connecting / undetermined** (null fallback) | **"Connecting"** (`connecting_label`) | **YES** (if `canWake\|\|!fresh`) | spinner only | 1 | textColorLight |
| Parked | "Parked" (`vehicle_home_parked_state`) | No | No | 1 | textColorLight |
| Charging | speed + charging-remaining + ETA | No | (bolt in top bar, §5) | **multi-line** | textColorLight |
| Charging start | "Starting to charge" (`vehicle_home_start_charging`) | No | No | 1 | textColorLight |
| Low Power | "Low Power Mode" (`vehicle_home_low_power_mode`) | No | No | 1 | textColorLight |
| **Asleep** | **"Asleep {{age}}"** (`vehicle_status_screen_asleep_age`, via #30315) | No | No | 1 | textColorLight |
| **Offline / unreachable** | **"Last seen {{age}}"** (`vehicle_status_screen_last_seen_age`, via #30315) | No | No | 1 | textColorLight |
| Mobile Access Disabled | "Mobile Access Disabled" (`vehicle_home_mobile_access_status`) | No | No | 1 | textColorLight |
| In / Out of Service | "In Service" / "Out of Service" (`vehicle_home_in_service_status`/`_out_of_service_status`); "Service Mode" (`vehicle_home_service_mode`) | No | No | 1 | textColorLight |
| App upgrade required | "Please upgrade the app" (`vehicle_home_upgrade_app_warning`) | No | No | 1 | textColorLight |
| Powershare (handshaking/initializing/reconnecting/faulted) | "Communicating" / "Grid outage detected" / … | No | No | 1 | **powerRed #FF3A3A** (error sub-states) |
| **No applicable status** | **(nothing rendered — `null`)** | No | No | **0** | — |
| Child-presence overlay (not a liveness state) | `vehicle_child_presence_detected` | No | warning triangle (XSMALL/16, #FFC107) | 1 | transparentWhite90 |

**Freshness caption vs status line:** In online states there is ONE Text (status only), **no stacked freshness caption**. In offline/asleep states the ONE Text's content **is** the freshness string. So the freshness IS the status line — there are never two stacked text lines except in **Charging** (multi-line). Freshness format is relative: asleep = `moment.fromNow(true)` (no "ago", e.g. "Asleep 5 minutes"), offline = `.fromNow()` ("Last seen 2 hours ago"). Widget freshness literal = "%s ago" (xml:2782).

---

## 5. Icons (per state)

**The home-header status line uses no per-state icon.** The only status-area glyph tied to a real vehicle state is the **charging bolt in the top bar** (`HomeHeader` #117234): `Icon` glyph **`charging_bolt`**, size **SMALL (20)**, tint **`Colors.powerRed` #FF3A3A**, rendered conditionally when charging (off 0x57f; gate off 0x53e). Menu/drawer button = `IconName.menu` (MEDIUMSMALL/25, `Colors.white` #ffffff).

**Correction to the brief's premise:** the "status **row**" at hasm:8759817 is **not** the vehicle-liveness row — it is **`RoadsideCoverageBanner`** (#180359), the roadside-assistance/warranty card. Its `statusIcon`/`statusMessage`/`statusCaption`/`onStatusPress` feed a **generic design-system `StatusMessage`** primitive (#42530), where `statusIcon` is a `<StatusIcon status=…/>` keyed by a **semantic** status (`error`/`warning`/`success`/`informative`), not by vehicle state. All 41 `statusIcon` refs app-wide are feature cards (payments, insurance, instrument-details, roadside) — **none is vehicle-liveness**.

**`StatusIcon` semantic table** (#42034, hasm:1931583) — the reusable status→glyph+colour used by feature cards (useful for any status chips we build):

| `status` | Glyph (`Icon data=`) | Colour token | Hex (light/dark) |
|---|---|---|---|
| `error` | `iconErrorFilled` | `secondaryNegative` | **#FF3A3A** |
| `warning` | `iconWarningFilled` | `secondaryWarning` | **#FFC107** |
| `success` | `iconSuccessFilled` | `secondaryPositive` | **#02AD5D** |
| `informative`/default | `iconInfoFilled` | `primary` | **#3E6BE2** |

**Drawables:** RN glyphs (`charging_bolt`, `iconErrorFilled`, `menu`, …) are **icon-font/vector data compiled into the JS bundle**, not native drawables. Native drawables exist only for the **home-screen widget / notifications**: `ic_charging_bolt*.xml`, `ic_low_power_mode_{on,off,on_disabled}*.xml`, `quantum_ic_cloud_off_vd_theme_24.xml` (offline/cloud-off), `ic_instruction_no_connection.xml`, `spinner.xml`. No native asleep/moon/wifi/bluetooth status drawable (only the GMS `cloud_off`). Native `colors.xml` status tokens: `battery_charging_color #00e185`, `battery_level_warning_color #ffc106`, `charging_notif_*`; the RN theme palette (`powerRed`, `secondaryNegative`, etc.) lives in the JS bundle (`obj:6184` static `Colors`, `obj:35310`/`35311` light/dark theme `colors`).

---

## 6. Interaction

- **The home-header status text is tappable.** `onStatusPress` fn **#117253** (in `VehicleHomeHeader` #117239, hasm:5221198) dispatches **`Actions.vehicleWakeUp(vin, VehicleWakeReason.TAP_STATUS_TEXT)`** (hasm:5221219–5221225). So tapping the status line wakes the car. (Distinct from `RoadsideCoverageBanner`'s own trivial `onStatusPress` #180361.)
- **Pull-to-refresh** on the home list → `vehicleWakeUp(vin, PULL_DOWN_REFRESH)` (§3).
- **Pressed/opacity state, exact hit area:** not recovered from disassembly (the Pressable/Touchable wrapper + activeOpacity/hitSlop weren't isolated) — **UNRESOLVED**.
- **State-transition animation** (fade/crossfade between status strings): none found in #117231 — the text swaps instantly on state change; only the spinner has its own continuous rotation. **INFERRED (absence).**

---

## 7. Citations (auditable)

- **Component/styles:** `VehicleStatusText` #117231 hasm:5218968; render off 0xb35–0xd94; `statusTextContainer` hasm:5217800; `headerStatusText` hasm:5217782; `Gutter=10` hasm:1566023; typography preset off 0xa1/0xb9 (hasm:5219009/5219014).
- **Typography scale:** fn #41117 hasm:1893435 (`body`/`bodyLabel`/`caption` buffers); weight map + appearance→color `getFontStyle` #33009 hasm:1567349, `generateTextThemedStyles` #33010 hasm:1567403; `TextCategory` enum hasm:1566987.
- **Refresh/spinner:** `BusyIcon` #35845 hasm:1671046 (loop #35846 hasm:1671161); header `size:18` hasm:5219004; jsx off 0xbba; gate `showLoadingSpinner` hasm:5219431–5219437, selectors hasm:5219042/5219050, log #117233 hasm:5219961; `VehicleHomeScreen` #117072 hasm:5208977, FlatList `refreshing:false` hasm:5210555, `onRefresh` #117131 → `PULL_DOWN_REFRESH` hasm:5212695.
- **Freshness:** `vehicleDataLastUpdatedString` #30315 hasm:1440253 (keys hasm:1440296/1440330).
- **Icons/colours:** child-presence NamedIcon off 0xf55; `powerRed` off 0x8cb; `HomeHeader` #117234 charging_bolt off 0x57f; `RoadsideCoverageBanner` #180359 hasm:8759769 (StatusMessage wiring off 0x293); `StatusIcon` #42034 hasm:1931583; palettes `obj:6184`/`obj:35310`-`35311`; native drawables `res/drawable*`, `res/values/colors.xml`.
- **Interaction:** `onStatusPress` #117253 hasm:5221198 → `TAP_STATUS_TEXT` hasm:5221224.
- **Appendix (full agent reports):** `tesla-status-visual-appendix/` A (component/styles), refresh-indicator, icons.

---

## 8. Gaps (not recovered — stated plainly)

1. **`theme.textColorLight` exact hex** (the status-text colour) — a theme accessor, not a static literal; INFERRED near-white/light-grey. Note the base `headerStatusText` StyleSheet has no colour of its own; colour comes from `appearance:Light`.
2. **Parent online↔offline swap** (VehicleStatusText vs the "Asleep/Last seen" freshness string): INFERRED from #117231 lacking an asleep/offline branch + #30315 producing that text; not opcode-proven end-to-end.
3. **BusyIcon header module binding** (#35845 vs #82695): INFERRED #35845; the require-index-39→module map not resolved (visual result identical either way). Cybertruck Lottie source filename (`spinner_ct.json`) INFERRED.
4. **`getSelectedVehicleDataFetchedRecently` "recent" threshold** (ms window): not located (likely a `TimeInMs` value).
5. **Pressed/opacity state + hit area** of the tappable status text: not isolated.
6. **Charging-bolt recolour** for non-charging sub-states: only the `powerRed` branch traced.
7. **RN glyph vector paths** (`charging_bolt`, `iconErrorFilled`, …): only glyph *names* recovered, not the vector data.
