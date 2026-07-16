# Tesla Android app — Round 2: per-state icons & status-row variant (visual layer)

**Target:** official Tesla Android app `com.teslamotors.tesla` v4.58.0 (build 4392). Static RE of the Hermes bytecode (`bundle.hasm`) + native apktool resources (`base_apktool/res`).

**Citation shorthand**
- `hasm:N` → line N of `/Users/ivan/Work/tesla-summon/work/bundle.hasm`.
- `off 0xNNN` → bytecode offset inside the named function (stable across rebuilds; line numbers drift).
- `obj:N` → line N of `scratchpad/all_objects.txt` (extracted object literals).
- `res/...` → `scratchpad/base_apktool/res/...` (native decoded).
- Confidence: plain = directly read from an opcode/literal. **INFERRED** = interpretation. **UNRESOLVED** = not recovered.

---

## 0. Headline findings (read first)

1. **The home-header liveness status line renders NO per-state glyph.** `VehicleStatusText` (#117231) draws the state as **Text only**, with exactly two icon components in the whole function: an optional **`BusyIcon`** (spinner, for Connecting) and a **`NamedIcon`/warning** that belongs *only* to the **child-presence-detected** warning row — not to any liveness state (Parked/Charging/Asleep/Offline/Low Power/Mobile-Access/In-Service/Upgrade). Those eight states are pure text. This confirms and closes gap #3/#4 of the Round-1 FINDINGS.

2. **The "status **row**" at hasm:8759817 is NOT the vehicle-liveness row.** It is **`RoadsideCoverageBanner`** (#180359) — the roadside-assistance/warranty coverage card. Its `statusIcon`/`statusMessage`/`statusCaption`/`onStatusPress` props feed a **generic design-system `StatusMessage` row**, and the icon is a **`StatusIcon`** element keyed by a *semantic* `status` = `error | warning | success | informative`, **not** by vehicle state. So the brief's hypothesis ("per-vehicle-state icons live here") is corrected: per-state vehicle icons don't exist in this component; it's a reusable semantic-status pattern shared by feature cards.

3. **The only vehicle-status-area glyph tied to a real vehicle state is the CHARGING BOLT** in the top bar (`HomeHeader` #117234): `Icon` glyph **`charging_bolt`**, size **SMALL (20)**, tint **`Colors.powerRed` = #FF3A3A**, rendered conditionally when charging.

---

## 1. Home-header icon audit — `VehicleStatusText` #117231 (hasm:5218968, 4179 bytes)

Full disassembly saved: `scratchpad` tool-results `bgxwatq8q.txt` (file-lines 1–969 = this fn) and render slice `b9hb4efrk.txt`.

### 1.1 Every icon component in the function (exhaustive)

| # | Component | off | Condition it renders under | Props |
|---|---|---|---|---|
| 1 | **`BusyIcon`** (spinner) | 0xbba | conditional — gated on the "show loading spinner" flag (`JmpFalse` Reg14 at 0xb63; the flag string is `'[VDU] Show loading spinner: '`) | only `size` (passed through) |
| 2 | **`NamedIcon`** | 0xf55 | conditional — the **child-presence-detected** row only | `name`=`IconName.warning`, `size`=`IconSize.XSMALL`, `color`=`Colors.warning` |

There is **no third icon**. The status label itself is a `Text` (`automationID='vehicle_home_header_status_text'`, off 0xc30) whose `style` = `[headerStatusText, <colorObj>]` (off 0xc41–0xc55). Confirmed: **no `Icon`/`NamedIcon`/`Image`/glyph is attached to any liveness branch.**

### 1.2 The child-presence warning row (the only non-spinner icon)

`View(statusTextContainer)` → `View(marginRight: Gutter*0.5)` wrapping:
- `NamedIcon { name: IconName.warning, size: IconSize.XSMALL, color: Colors.warning }` (off 0xf55–0xfa9)
- `Text { style.color: Colors.transparentWhite90, children: tr('vehicle_child_presence_detected') }` (off 0xfd6–0x101d)

So the warning triangle is the **"child left in vehicle"** indicator, independent of connectivity. `IconSize.XSMALL` = **16 px** (INFERRED from the design-system `Specifications` map: xxSmall12 / **xSmall16** / small20 / mediumSmall25 / medium30 / mediumLarge32 / large36 / xLarge60; IconSize enum def hasm:1566426+).

### 1.3 State → text keys handled in #117231 (all text, no glyph)

Confirms Round-1 §1.3. Keys read directly (LoadConstString): `connecting_label` (0x927), `vehicle_home_parked_state` (0xa2b), `vehicle_home_low_power_mode` (via `setIsShowingLowPowerMode`, off 0x05), `vehicle_home_mobile_access_status` (0xa03), `vehicle_home_in_service_status` (0x9cd) / `vehicle_home_out_of_service_status` (0x9d8) / `vehicle_home_service_mode` (0x99f), `vehicle_home_upgrade_app_warning` (0x966), `vehicle_home_start_charging` (0x6bc). Plus a **Powershare** sub-state family (`powershare_state_active/initializing/handshaking/stopped/retrying/faulted…`, `cos_error_status`, `cos_charging_from_solar_status`) and trip-charging ETA (`vehicle_charge_eta_trip_charging_ready[_full]`).

### 1.4 Colours in #117231 (exactly 3 `Colors.*` refs)

| off | token | applied to | resolved hex |
|---|---|---|---|
| 0x8cb | `Colors.powerRed` | status-text `color` (`PutById color` on Reg29) — **Powershare error/initializing branch only** | **#FF3A3A** |
| 0xf9e | `Colors.warning` | child-presence NamedIcon `color` | **#ffc107** |
| 0xff5 | `Colors.transparentWhite90` | child-presence Text `color` | **rgba(255,255,255,0.9)** |

The per-state status-text colour object (Reg29) is an **empty `NewObject`** (off 0x4af) for every liveness state → the label inherits the base `headerStatusText` style colour with **no per-state override**. The only text-colour override in the whole function is `powerRed` in the Powershare branch. **`headerStatusText` base-style hex: UNRESOLVED** (StyleSheet style; likely white/near-white — INFERRED from the sibling child-presence text using `transparentWhite90`).

**Answer to the audit:** Besides `BusyIcon`, #117231 contains exactly one other icon — the child-presence `NamedIcon`/warning. **No liveness state (offline/asleep/parked/charging/low-power/…) draws a glyph in the home-header status line.** Colour is uniform (base style) for all liveness states; `powerRed` appears only for Powershare.

---

## 2. Top-bar `HomeHeader` #117234 (hasm ≈ 5219987, 1917 bytes) — the charging-bolt indicator

Same module, immediately after #117231. Icon inventory (all `Colors.*` resolved):

| Element | off | Glyph / name | Size | Colour | Gate |
|---|---|---|---|---|---|
| Drawer/menu button (variant A) | 0x489 | `Icon` `data=iconMenu` | — | `Colors.white` #ffffff | branch (`JmpTrue` Reg38 @0x47a) |
| Drawer/menu button (variant B) | 0x4d5 | `NamedIcon` `name=IconName.menu` | `IconSize.MEDIUMSMALL` (25) | `Colors.white` #ffffff | other branch |
| **Charging indicator** | 0x57f | `Icon` `name='charging_bolt'` | `IconSize.SMALL` (20) | **`Colors.powerRed` #FF3A3A** | **conditional** (`JmpFalseLong` Reg39 @0x53e — rendered when charging) style `styles.chargingIndicator` |

The charging-bolt colour is read directly as `powerRed` (#FF3A3A); the surrounding `chargingIndicator` block is conditional, so the *presence* is charging-gated. **INFERRED:** whether the bolt tint is ever recoloured for non-charging/error sub-states was not traced (single branch read).

---

## 3. Status-**row** variant = `RoadsideCoverageBanner` #180359 (hasm:8759769, 923 bytes)

hasm:8759814 (`GetById statusIcon`), :8759817 (the props the brief cited) are inside this fn. Full slice: `scratchpad/fn180359.txt`.

### 3.1 Identity & what renders it
`RoadsideCoverageBanner` is a **`Card`** (`animationDisabled`, style `card`) → `View(cardContainer)` containing:
- `Text{category:'h2', style:priceText}` = `formatCurrencyWithDecimals(price,currency)` + `Text` = `tr('ra_tow_estimate')`
- `Divider` (style `divider`)
- `View(statusContainer)` → **`StatusMessage`** (design-system, string_id 10956) with `items:[{ icon, message, caption, onPress }]`, `style:statusMessageStyle`.

The mapping of the banner's own props → StatusMessage (off 0x293–0x2b6): `icon ← statusIcon` (61792), `message ← statusMessage` (58030), `caption ← statusCaption` (45801), `onPress ← onStatusPress` (10417). Same shape is emitted a 2nd time (off 0x346, `encapsulated:true`).

### 3.2 Where the `statusIcon` value comes from — helper #180360 (hasm:8759983)
`statusIcon` is **not** a string/asset — it is a JSX **`<StatusIcon status=… size='default'/>`** element (component string_id **18183**), built per coverage state:

| Coverage state (branch) | `StatusIcon status` | `statusMessage` key | `statusCaption` key |
|---|---|---|---|
| not covered by Tesla | `'error'` | `ra_warranty_not_covered_by_tesla` | — |
| covered / pending review | `'informative'` | `ra_covered_by_tesla` | `ra_pending_adjuster_review` |
| warranty covered | `'success'` | `ra_warranty_covered_by_tesla` | — |

`size` is always `'default'` here (`NewObjectWithBufferLong … {'status':'…','size':'default'}` at off 0x66 / 0xd3 / 0x153).

### 3.3 The `StatusMessage` primitive (#42530, hasm:1958975) and wrapper (#131635, hasm:6133892)
- **#42530** (leaf): maps `items[]` into `encapsulatedContainer` / `unencapsulatedContainer` `View`s; each item = a status row `{icon, message, caption, onPress}`.
- **#131635** (banner wrapper, also named `StatusMessage`): adds `status`, `dismissable`/`onDismiss`, `containerProps`, `statusBarStyle`, `header`/`content`, `logEvent`, `testID`, `accessible`. Row is tappable via `onPress` and dismissable when `isSomething(handleCloseButtonClick)`.

**`statusIcon` is used by 16 feature banners** (41 total refs; PUT sites at hasm 4041135 `V2InstrumentDetailsView`, 6141478, 6155627, 6669414, 6682407, 7040550/7041013, 7333670, 8314487, 8760014/37/64 roadside, 8796995, 9409655, 9641244, 10010832 — payments, insurance, instrument details, roadside, etc.). **None is a vehicle-liveness row.**

---

## 4. `StatusIcon` design-system component #42034 (hasm:1931583, 450 bytes) — the status→glyph+colour table

This is the authoritative semantic-status → icon map. Slice: `scratchpad/fn42034_StatusIcon.txt`. Props: `status`, `size` (default `'default'`), `style`. Colours via `useTheme().colors.*`.

| `status` prop | branch off | Icon glyph (`Icon data=`) | Colour token (`theme.colors.*`) | Resolved hex (light / dark) |
|---|---|---|---|---|
| `error` | 0x169 | **`iconErrorFilled`** | `secondaryNegative` | **#FF3A3A / #FF3A3A** |
| `warning` | 0xb7 | **`iconWarningFilled`** | `secondaryWarning` | **#FFC107 / #FFC107** |
| `success` | 0x110 | **`iconSuccessFilled`** | `secondaryPositive` | **#02AD5D / #02AD5D** |
| `informative` / anything else (default) | 0x5e | **`iconInfoFilled`** | `primary` | **#3E6BE2 / #3E6BE2** |

- `size` prop passes straight to `Icon size=` (tokens `default`/`small`/`medium`/`large`; observed sizes on StatusIcon call-sites: default/small/medium/large — see §5).
- Theme hex from `obj:35310` (light) / `obj:35311` (dark): `primary #3E6BE2`, `secondaryPositive #02AD5D`, `secondaryWarning #FFC107`, `secondaryNegative #FF3A3A`. A greyscale theme variant (`obj:35312`) maps `primary #F6F6F6`, `secondaryPositive #898989` (INFERRED: high-contrast/mono theme).
- The glyph names (`iconErrorFilled` etc.) are **JS-bundle icon-font/vector `data` refs**, not native drawables (see §5).

---

## 5. Native drawables (`base_apktool/res/drawable*`)

**Key finding:** the RN status glyphs (`iconErrorFilled`, `iconWarningFilled`, `iconSuccessFilled`, `iconInfoFilled`, `charging_bolt`, `menu`) are **NOT present as native drawables** — they are icon-font/vector data compiled into the Hermes bundle and drawn by the RN `Icon`/`NamedIcon` components. Native drawables exist for the **home-screen widget & notifications** only.

Status-relevant Tesla-authored native drawables (real filenames):

| Drawable | Relevance |
|---|---|
| `ic_charging_bolt.xml`, `ic_charging_bolt_cybertruck.xml`, `ic_charge_bolt_no_margin.xml`, `ic_charge_plug.xml` | Charging (widget) — corresponds to RN `charging_bolt` |
| `ic_low_power_mode_on.xml`, `ic_low_power_mode_off.xml`, `ic_low_power_mode_on_disabled.xml` (+ `_cybertruck` variants) | Low Power Mode (widget/settings) |
| `quantum_ic_cloud_off_vd_theme_24.xml` | Offline / cloud-off (GMS-provided vector) |
| `ic_instruction_no_connection.xml`, `$ic_instruction_no_connection__0/__1.xml`, `…_passport…` | "No connection" illustration (onboarding/scanner) |
| `spinner.xml` (+ third-party `stripe_ic_loading_spinner`, `pi2_ui_loading_spinner`, `orca_ic_spinner_arrow`, `node_modules_tesla_paymentreactnative_assets_img_spinner.png`) | Spinners (native + SDK) |

No native `asleep`/`sleep`/`moon`/`offline`/`bluetooth`/`wifi` status drawable exists (only the GMS `cloud_off`). Third-party status glyphs (`stripe_ic_error/warning`, `orca_ic_error`, `mtrl_ic_error`, `a3ds2_ic_error_outline_24`) are SDK assets, not Tesla status UI.

### colors.xml native tokens (status-relevant) — `res/values/colors.xml` (+ `-night`)

| Token | Hex |
|---|---|
| `battery_charging_color` | `#00e185` |
| `battery_level_warning_color` | `#ffc106` |
| `charging_notif_background_color` | `#161616` |
| `charging_notif_text_primary_color` | `#f6f6f6` |
| `charging_notif_text_secondary_color` (`-night`) | `#b3b3b3` |

The RN theme/palette tokens (`powerRed`, `secondaryNegative`, `secondaryWarning`, `secondaryPositive`, `primary`, `transparentWhite90`, `warning`) are **NOT in native colors.xml** — they live in the JS bundle palette (`obj:6184`/`6185` static `Colors`; `obj:35310`/`35311` theme `colors`).

---

## 6. Per-state colour — consolidated

### 6.1 Static `Colors` palette hex (JS bundle, `obj:6184`)
`powerRed = #FF3A3A` · `warning = #ffc107` · `transparentWhite90 = rgba(255,255,255,0.9)` · `white = #ffffff` · (`statusError #DC3E2B`, `statusWarning #FFC107`, `statusInformative #3E6BE2`, `batteryCharging #00E286`, `red #ff0000`, `performanceRed #E31937` also present but unused by these components).

### 6.2 Theme `colors` semantic hex (JS bundle, `obj:35310` light / `35311` dark)
`primary #3E6BE2` · `secondaryPositive #02AD5D` · `secondaryWarning #FFC107` · `secondaryNegative #FF3A3A` · `foregroundNegative #FF3A3A(light)/#F65555(dark)`.

### 6.3 Per vehicle state (final answer)

| Vehicle state | Home-header glyph | Header text colour | Notes |
|---|---|---|---|
| Connecting | **`BusyIcon` spinner** | base `headerStatusText` (UNRESOLVED hex; INFERRED white) | fallback branch |
| Parked | none | base | text only |
| **Charging** | **`charging_bolt`** in top-bar `HomeHeader` (size SMALL/20, `powerRed` #FF3A3A) — *not* in the status line | base | bolt is charging-gated |
| Low Power | none (RN) | base | native widget uses `ic_low_power_mode_on.xml` |
| Asleep | none | base | text "Asleep {{age}}" |
| Offline / Last-seen | none | base | text "Last seen {{age}} ago"; native widget `quantum_ic_cloud_off` |
| Mobile Access Disabled | none | base | text only |
| In Service | none | base | text only |
| Upgrade | none | base | text `vehicle_home_upgrade_app_warning` |
| (Child-presence overlay) | `NamedIcon` warning (XSMALL/16, `warning` #ffc107) | text `transparentWhite90` | not a liveness state |
| (Powershare error) | none | **`powerRed` #FF3A3A** | energy sub-state |

**Design-system `StatusIcon` semantic states** (feature cards, incl. RoadsideCoverageBanner — the "status-row"): `error`→iconErrorFilled/#FF3A3A · `warning`→iconWarningFilled/#FFC107 · `success`→iconSuccessFilled/#02AD5D · `informative`→iconInfoFilled/#3E6BE2.

---

## 7. Gaps / UNRESOLVED

1. **`headerStatusText` base-style colour hex** — the default liveness-text colour (StyleSheet style). Not resolved to hex; INFERRED white/near-white from the sibling `transparentWhite90` text.
2. **Charging-bolt recolour logic** — read as `powerRed` in one branch; whether non-charging/warning sub-states retint it was not traced.
3. **RN glyph vector data** — `iconErrorFilled`/`charging_bolt`/etc. are bundle icon-font entries; their actual vector paths were not extracted (only the glyph *names*).
4. No vehicle-liveness consumer of `StatusMessage`/`StatusIcon` was found (searched all 41 `statusIcon` refs) — consistent with the header being text-only. Stated as a positive finding, not a gap.

---

## 8. Citations (auditable)

- `VehicleStatusText` #117231 — hasm:5218968; BusyIcon off 0xbba; child-presence NamedIcon off 0xf55–0xfa9 (`IconName.warning`/`IconSize.XSMALL`/`Colors.warning`); text-colour override `Colors.powerRed` off 0x8cb; `transparentWhite90` off 0xff5; empty colour obj off 0x4af.
- `HomeHeader` #117234 — hasm ≈5219987; charging_bolt Icon off 0x57f (`IconSize.SMALL`, `Colors.powerRed`), gate `JmpFalseLong` off 0x53e; menu `Colors.white` off 0x4b7/0x526.
- `RoadsideCoverageBanner` #180359 — hasm:8759769; StatusMessage wiring off 0x293–0x2b6 (statusIcon 61792 / statusMessage 58030 / statusCaption 45801 / onStatusPress 10417); builder #180360 hasm:8759983 (StatusIcon status='error'/'informative'/'success').
- `StatusIcon` #42034 — hasm:1931583; error→iconErrorFilled/secondaryNegative off 0x169/0x199/0x1ac; warning→iconWarningFilled/secondaryWarning off 0xb7/0xe7/0xfa; success→iconSuccessFilled/secondaryPositive off 0x110/0x140/0x153; default→iconInfoFilled/primary off 0x5e/0x8e/0xa5.
- `StatusMessage` primitive #42530 hasm:1958975; wrapper #131635 hasm:6133892.
- IconSize enum def hasm:1566426+ (XXSMALL/XSMALL/SMALL/MEDIUM/LARGE/XLARGE).
- Palettes — `all_objects.txt`: static Colors `obj:6184`/`6185`; theme colors `obj:35310` (light)/`35311` (dark)/`35312` (mono).
- Native — `res/drawable*` filenames as listed §5; `res/values/colors.xml` + `res/values-night/colors.xml` tokens §5.
