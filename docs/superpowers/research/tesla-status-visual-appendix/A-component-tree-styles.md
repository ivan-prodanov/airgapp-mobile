# R2 Section A — Component tree, styles, display rules (VehicleStatusText)

All from `bundle.hasm`. Component = `VehicleStatusText` fn **#117231** (hasm:5218968, 4179 bytes); its StyleSheet + siblings are in the enclosing module (hasm:5217700+). Sibling components in same module: `ChargeStatus` #117220, `SelectedVehicleChargeStatus` #117228, `HomeHeader` #117234, `VehicleHomeHeader` #117239, `VehicleHomeHeaderStaticPlaceHolder` #117255.

## A1. Component tree (exact, with predicates)

```
<Fragment>                                                     (jsxs Fragment, hasm:5219600 0xb3e)
 └─ <View style={statusTextContainer}>                         (hasm:5219639 0xb59)
     ├─ {connectingFlag &&                                     (JmpFalse Reg14, hasm:5219603 0xb63)
     │     <View style={{marginRight: Gutter*0.5 /*=5*/}}>     (hasm:5219560 0xba0)
     │       <BusyIcon size={<n>} />                           (GetById 'BusyIcon' id8529, hasm:5219578 0xbba)
     │     </View> }
     └─ (charging?                                             (JmpTrue Reg12, hasm:5219606 0xbde / 0xc77)
          //  NOT charging → single status line:
          <Text  automationID="vehicle_home_header_status_text"   (hasm:5219640 0xc30)
                 category={TextCategory.BodyLabel}                 (hasm:5219009 0xa1)
                 appearance={TextAppearance.Light}                 (hasm:5219014 0xb9)
                 style={[styles.headerStatusText, <inline>]}       (hasm:5219692 0xc41)
          >{statusString}</Text>
          //  charging → multi-line block:
          <View style={styles.headerStatusText}>                   (hasm:5219711 0xc8f)
            {<View style={oneLineTextContainer}> …speed / eta / charging-remaining… }  (hasm:5219721 0xcbc)
          </View>
        )
 </View>
</Fragment>
```

**Key structural facts (confirmed):**
1. The status area is **one `Text` node** in every non-charging state (a single line). It is **not** a Text-with-children or a concatenation; the string comes from a single `tr()` result (`statusString`, register Reg13).
2. The **spinner (`BusyIcon`) renders ONLY when the "connecting/undetermined" flag is true** (Reg14). In every other branch Reg14 is explicitly `LoadConstFalse` (hasm:5219 branches 0x8ff, 0x97d, 0x9a8, 0x9e4, 0xa0c, 0xa34…). So: no spinner in Parked/Charging/Asleep/Offline/etc.
3. **Charging is the only multi-line state** (Reg12 flag) — it renders a `View(headerStatusText)` with sub-`View`s (speed, charging-remaining, ETA) instead of the single Text.
4. **The component renders `null` (nothing) when there is no applicable status** and it is not charging/connecting (return-null path, hasm:5219572 0xb2d–0xb2f `LoadConstNull; JmpFalse Reg12 → return`). So an empty status = **zero rendered nodes**, not an empty string. This is a big part of "much less text" — Tesla renders nothing rather than a placeholder.
5. **No `numberOfLines` / `ellipsizeMode`** anywhere in #117231 → the status line is **not truncated** (it wraps: `headerStatusText` has `flexWrap:'wrap'`).
6. **No per-state icon** in this home-header component besides `BusyIcon`. (The `statusIcon` prop belongs to the separate status-ROW variant at hasm:8759817 — see icons section.)

## A2. StyleSheet values (exact; `Gutter` = 10)

`Gutter` base spacing unit = **10** (`LoadConstUInt8 10` → `PutById 'Gutter'`, hasm:1566023). Design-system `Specifications` object (hasm:3714899): `homeHeaderHeight:64, headerHeight:54, headerHorizontalGutter:30, homeScreenGutter:20, homeScreenBoxGutter:10, iconButtonBusyOpacity:0.5`; icon sizes `xxSmall12, xSmall16, small20, mediumSmall25, medium30, mediumLarge32, large36, xLarge60, activityIndicatorSize60, activitySmallIndicatorSize30`.

| Style (StyleSheet.create key) | Exact object | hasm |
|---|---|---|
| `statusTextContainer` (the row wrapping spinner+text) | `{flexDirection:'row', alignItems:'center', marginTop:10}` | 5217800 (0x5c2–0x5e6) |
| spinner wrapper (inline) | `{marginRight:5}` (`Gutter*0.5`) | 5219560 (0xb92–0xba0) |
| `headerStatusText` | `{flexDirection:'row', flexWrap:'wrap', alignItems:'center', justifyContent:'flex-start'}` | 5217782 (0x55c–0x56a) |
| `oneLineTextContainer` (charging sub-row) | `{marginLeft:Gutter/*10*/, position:'relative', …width}` | 5217784 (0x582–0x5a6) |
| `batteryText` (battery %, adjacent) | `{fontSize:16, fontWeight:'bold', marginHorizontal:5}` | 5217742 (0x418–0x44a) |

## A3. Status-text typography (the actual tokens)

The status `Text` is a **design-system themed `Text`** (not RN primitive), given:
- `category = TextCategory.BodyLabel` (token string `'bodyLabel'`; TextCategory enum at hasm:1566987 lists `h1_xxxl, h1_xxl, h1..h5, body, bodyLabel, caption, captionLabel, overline, axisLabel`).
- `appearance = TextAppearance.Light`.

**Resolved DEFINITIVELY** from the Typography scale object (fn #41117, hasm:1893435 — the `body`/`bodyLabel`/`caption` specs are literal `NewObjectWithBufferLong` buffers):

| category token | fontSize | lineHeight | fontFamily | fontWeight | letterSpacing |
|---|---|---|---|---|---|
| `body` | 14 | 20 | UniversalSansText | '400' | -0.1 |
| **`bodyLabel`** (the status text) | **14** | **20** | **UniversalSansText** | **'500'** (Medium) | **0.1** |
| `caption` | 12 | 16 | UniversalSansText | '400' | -0.1 |
| (h-scale for ref) h1_xxxl=48/56, 32/36, 24/28(h1), 20/24(h2), 18/24(h3), 16/20(h4) — all UniversalSansDisplay/'500' |

- **fontFamily**: `UniversalSansText` (Latin) / `Blender-TSL` (Chinese/Korean, via `isShowingChineseOrKorean`, hasm:1567364).
- **appearance → COLOR, not weight** (I initially misread this): in `generateTextThemedStyles` (#33010, hasm:1567403) `appearance` selects the text COLOR — `Default→textColor`, `Light→textColorLight`, `Alternative→reverseTextColor` (hasm:1567411-1567425). So **`appearance:Light` ⇒ `color = theme.textColorLight`** (the muted/secondary text colour token; a theme accessor resolving per light/dark — exact hex is a theme lookup, see icons/colour section).

So the status line is definitively: **UniversalSans, fontSize 14, lineHeight 20, fontWeight '500' (Medium), letterSpacing 0.1, color = `textColorLight` (muted)**, no truncation, wraps, in a horizontal row (`headerStatusText`) after the car name with `marginTop:10`.

## A4. Display-rules table (which string renders per state)

Selector-driven if/else inside #117231, in order (hasm:5219200–5219535). English resolved from the inline catalog (round-1 dictionary). "Renders" = the single status Text unless noted.

| State (predicate) | Exact string | Spinner? | Lines | hasm |
|---|---|---|---|---|
| Charging (`ChargingState.CHARGING` etc.) | speed + charging-remaining + ETA | No | **multi-line** | 5219300–5219460 |
| Charging start | "Starting to charge" (`vehicle_home_start_charging`) | No | 1 | 5219 (0x…) |
| Powershare handshaking | "Communicating" (`powershare_state_handshaking`) | No | 1 | 5219500 (0x8f6) |
| Powershare initializing | "Grid outage detected" (`powershare_state_initializing`) | No | 1 | 5219 |
| Powershare reconnecting | (`powershare_state_reconnecting_to_grid_title`) | No | 1 | 5219 |
| Powershare faulted | (`powershare_status_faulted_title`) | No | 1 | 5219 |
| Parked | "Parked" (`vehicle_home_parked_state`) | No | 1 | 5219528 (0xa2b) |
| Low Power | "Low Power Mode" (`vehicle_home_low_power_mode`) | No | 1 | 5219 |
| COS error | "Charge on Solar error" (`cos_error_status`) | No | 1 | 5219 |
| Service Mode | "Service Mode" (`vehicle_home_service_mode`) | No | 1 | 5219506 (0x99f) |
| In / Out of Service | "In Service" / "Out of Service" (`vehicle_home_in_service_status` / `_out_of_service_status`) | No | 1 | 5219511 (0x9cd/0x9d8) |
| Mobile Access Disabled | "Mobile Access Disabled" (`vehicle_home_mobile_access_status`) | No | 1 | 5219517 (0xa03) |
| App upgrade required | "Please upgrade the app" (`vehicle_home_upgrade_app_warning`) or "Set up Phone Key" (`phone_key_pairing_intro_title`) | No | 1 | 5219 (0x966/0x971) |
| **Connecting / undetermined** (null fallback) | **"Connecting"** (`connecting_label`) | **YES (BusyIcon)** | 1 | 5219 (0x927–0x93d) |
| No applicable status | (nothing rendered — `null`) | No | 0 | 5219572 (0xb2d) |

**Asleep / Offline freshness line** — NOTE: `#117231` has **no asleep/offline branch**. The "Asleep {{age}}" / "Last seen {{age}}" text is produced by a separate selector **`vehicleDataLastUpdatedString`** (#30315, hasm:1440253; exported from the vehicle-selectors barrel #30273 at hasm:1434895). Logic (round-1 §1.5): asleep → `tr('vehicle_status_screen_asleep_age',{age})` with `moment.fromNow(true)` (no "ago"); offline → `tr('vehicle_status_screen_last_seen_age',{age})` with `.fromNow()` ("ago"); online/no-age → `tr('connecting_label')`. **INFERRED:** the parent (HomeHeader #117234) renders this freshness string as the status line when the car is offline/asleep, swapping it for #117231's online states. So there is still only ONE status line in these states too (not a separate caption stacked under another line).

## A5. Truncation / freshness caption question (answering the brief)
- **Are status line + freshness two Text nodes?** In online states: ONE Text (status only); no freshness caption is stacked. In offline/asleep states: ONE Text whose content IS the freshness string ("Asleep {{age}}" / "Last seen {{age}}"). **So the freshness IS the status line in offline/asleep — not a second line.** The only genuinely multi-line state is **Charging**.
- **Truncation:** none (`numberOfLines`/`ellipsizeMode` absent); wraps via `flexWrap:'wrap'`.

## A6. Gaps for this section
- `bodyLabel` fontSize/lineHeight/weight/letterSpacing: **RESOLVED** (14 / 20 / '500' / 0.1) from hasm:1893435 — no longer a gap.
- `textColorLight` exact hex: it is a theme accessor (`theme.textColorLight`) resolving per light/dark; not a static literal in this module (see colour section for any colors.xml/theme resolution).
- BusyIcon `size` prop value passed by #117231: register-traced to a reused index; deferring exact value to the refresh-indicator investigation.
- HomeHeader #117234 online/offline swap of VehicleStatusText vs freshness string: INFERRED from #117231 lacking an asleep branch + #30315 producing the asleep/offline text; not opcode-proven end-to-end.
