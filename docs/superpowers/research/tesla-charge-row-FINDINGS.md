# Tesla's home-screen charging panel — recovered

**Date:** 2026-07-27
**Source:** `~/Downloads/tesla-haptics-work/main.jsbundle` (Tesla iOS v4.56), `hbc-decompiler`.
**Method:** read from the render chain and the dispatch/selector sites, not from adjacency. Line
numbers are into `main.decompiled.js`.

---

## 1. Where it lives — a dynamic row, sibling of the media card

```js
DynamicRowTypes = { ChargingAlerts, Charging, MediaControl, Referral,
                    TeslaElectric, BatteryTesting, Supercharger, … }   // @3886825
```

`Charging` and `MediaControl` are entries in the SAME dynamic-row list below the favourites row.
Order in the home screen's own height accumulator (@4561973–4562013):

| row | accumulated offset |
|---|---|
| `ChargingAlerts` | 30 × Gutter = 300 |
| `Charging` | 30 × Gutter = 300 |
| `MediaControl` | 14 × Gutter = 140 |

> ⚠️ **CORRECTED 2026-07-28. These are NOT row heights.** They are accumulated
> scroll offsets: a few lines below, the running total feeds
> `interpolate({inputRange: [...]})`. I read them as fixed heights and hardcoded
> the charge panel to 300pt. Measured against the real app (~3 px/pt on Ivan's
> side-by-side) **their charge panel is ~226pt and content-sized** — which it has
> to be, since a state with no Start button is shorter than one with it.
>
> The `MediaControl` 14 × Gutter = 140 coincidentally equals the media card's two
> recovered 70pt panels, which made the misreading look independently confirmed.
> A number agreeing with something true is not evidence that you read it right.

`Gutter` is 10. The MediaControl 140 does equal the media card's two independently-recovered 70pt
panels — but see the correction above: that agreement is what made a misreading look confirmed, so
it is a coincidence to be wary of rather than a cross-check to lean on.

## 2. Render chain

```
home screen dynamic-row switch (@3734369, RowTypes.Charging → ip 996)
  └─ VehicleChargeRow      @4158529   container: gathers state, renders ↓
       └─ ChargeRow        @4156086   presentational
```

`VehicleChargeRow` is a thin container. It spreads two hooks and adds nine explicit props:

```js
const state   = useSelector(chargeRowStateSelector);   // spread
const battery = useVehicleBatteryState();              // spread
<ChargeRow
  productId={vehicleId} vin={vin} sendCommand={sendCommand}
  chargeState={getSelectedChargeState} driveState={getSelectedDriveState}
  guiSettings={getSelectedGuiSettings} vehicleApiVersion={…}
  onGoing={getSelectedOngoingCommands} vehicleIsSemi={getIsSemi}
  {...state} {...battery} />
```

## 3. The conditional inputs — `chargeRowStateSelector` @3883935

Returns:

```js
{ chargeLimit, defaultChargeToMax, range, scheduledChargingText,
  dischargeLimit, dischargeLimitSocRange }
```

Built from these selectors (this is the "complex and conditional" part):

```
getSelectedVehicleIsPluggedIn      isChargingSelector
getSelectedVehicleChargePortOpen   getIsChargeStopped
getDisplayStartButtonSelector      getPowershareEligibleSelector
showPowershareBannerSelector       sliderMax / sliderSnapPoints
DEFAULT_DISCHARGE_LIMIT_SOC_RANGE
```

## 4. `ChargeRow`'s full prop list @4156090

```
productId  vin  sendCommand
scheduledChargingText  range  chargeLimit  defaultChargeToMax
dischargeLimit  dischargeLimitSocRange
batteryStates  usablePercentageCharged  nominalPercentageCharged
chargeState  driveState  vehicleApiVersion  onGoing  vehicleIsSemi
```

It reads `theme.textColor`, `theme.textColorLight`, `theme.textColorWarning`, and branches on
`isUsingTeslaSupercharger`. It holds three `useState`s and two `useEffect`s — one seeded from
`dischargeLimitSocRange.min`.

## 5. Sub-components in the same module

```
StartStopChargingButton      @4154764
OpenCloseChargePortButton    @4155670
ControlButtons               @4155758   (wraps the two above)
StopRestartPowershareButton  @4155147   (V2H — not applicable to us)
ReportIssueButton            @4154981   (cloud — not applicable)
```

**So the panel is:** a charge-limit slider (with `sliderSnapPoints`), a charge-limit label, the last
session's energy, an amperage control, and a control-button row (Start/Stop Charging, Open/Close
Charge Port) — sized to whichever of those the current state actually shows. Measured at ~226pt for
the idle, unplugged state.

## 6. Show / hide — `VehicleHomeScreen` @4561054–4561138

```js
const chargePortOpen = useTypedSelector(getSelectedVehicleChargePortOpen);
const [showCharge, toggleCharge] = useState(chargePortOpen);       // useState + _slicedToArray(…,2)

useEffect(() => {                                                   // @4561574
  if (showCharge && <flag> && !chargePortOpen) toggleCharge(false);
});

<VehicleHomeHeader showCharge={showCharge} toggleCharge={toggleCharge} … />
```

`toggleCharge` IS the `useState` setter, handed to the header — that is the battery tap. The demo
screen stubs the same pair (`{toggleCharge: () => false, showCharge: false}` @4559458), which is a
second confirmation of the contract.

**It keys on the charge PORT being open, not on `charging`.** So it appears when you plug in before
current flows, stays when charging completes, and hides when you unplug.

## 7. What we can drive it with

All of it from `ChargeState`, already in our read set — no new request:

```
charging_state (Unknown/Disconnected/NoPower/Starting/Charging/Complete/Stopped/Calibrating)
charge_limit_soc  charge_limit_soc_min/max/std      charger_power / voltage / actual_current
charge_rate_mph   charge_energy_added               charge_miles_added_rated
minutes_to_full_charge   minutes_to_charge_limit    charge_port_*   conn_charge_cable
```

Commands we already build: `chargingSetLimitAction`, `startChargingAction`, `stopChargingAction`,
`openChargePortAction`, `closeChargePortAction`.

**Not applicable to us:** powershare / discharge limit (V2H), Semi, supercharger session/billing,
report-issue. Those are a large fraction of `ChargeRow`'s branches and should be omitted rather than
stubbed.


---

## 9. The panel's ACTUAL StyleSheet — read, not measured (2026-07-28)

Ivan, on the previous pass: *"you didnt copy it, you invented it on your own."* Correct — that
pass was pixel-estimates off a screenshot pair. These are read out of `ChargeRow`'s and
`VehicleChargeAmps`' own `StyleSheet.create` calls. `Gutter = 10`.

### ChargeRow — `StyleSheet.create` @4158978

| key | value |
|---|---|
| `container` | `marginBottom: Gutter`, `marginHorizontal: homeScreenGutter - homeScreenBoxGutter`, `minHeight: 8*Gutter`, `paddingTop: 1.5*Gutter` |
| `containerNonCT` | `backgroundColor: Themes[DARK].secondaryBackgroundColor`, `borderRadius: Gutter*0.5`, `opacity: 0.95` |
| `contentsContainer` | `flexDirection: 'column'`, `flexGrow: 1` |
| `chargeTextContainer` | `marginHorizontal: 0.5*Gutter` |
| `chargeRateText(x)` | `flexDirection:'row'`, `marginTop: 0.5*Gutter`, `marginBottom: x ? Gutter : 0` |
| `sliderContainer` | `alignSelf:'flex-start'`, `height: 3*Gutter`, `marginHorizontal: 1.5*Gutter` |
| `targetSlider` | `overflow:'visible'`, `width:'100%'` |
| `ampsContainer` | `marginHorizontal: 1.5*Gutter + 0.5*Gutter`, `marginTop: 1.5*Gutter` |
| `bottomCardMargin` | `marginBottom: 2.5*Gutter` — the View that WRAPS the amps |
| `controlsDivider` | `height: 1`, `backgroundColor: Themes[DARK].backgroundColor` |
| `controlButtonContainer` | row, `justifyContent:'space-evenly'`, `alignItems:'center'`, `width:'100%'` |
| `button` | `flex: 1`, `opacity: 0.9` |
| `chargeButton` | `minHeight: 46`, `paddingVertical: 13` |
| `chargeButtonText` | `textAlign: 'center'` — font comes from the Button, see below |
| `buttonDivider` | `width: 1`, `height: '100%'`, `backgroundColor: Themes[DARK].backgroundColor` |
| `disabledButtonText` | `opacity: 0.5` |
| `emphasizedChargeLimits` | `fontSize: 16`, `lineHeight: 20` |

**Two structural facts, not numbers:**

1. **Both dividers are painted in the PAGE background colour**, `Themes[AppTheme.DARK].backgroundColor`
   — which is why Ivan read the divider as *"transparent"* while ours looked *"whiteish/grayish"*. Ours
   was `rgba(255,255,255,0.12)`: LIGHTER than the card it sits on, the exact opposite of the intent.
   `buttonDivider` is **vertical** (1×100%), between the two buttons — we had no such element.

2. **The horizontal insets are not uniform.** From the card edge: text **5**, slider **15**, amps **20**,
   buttons **0**. Ours used one `paddingHorizontal: 18` for everything, which is why no row lined up.

### `VehicleChargeAmps` — its own module, `StyleSheet.create` @4168306

| key | value |
|---|---|
| `container` | row, `alignItems:'center'`, `justifyContent:'space-between'`, `height: 4.5*Gutter`, `position:'relative'` |
| `currentControlsContainer` | `backgroundColor: Gray.dark`, `borderRadius: Gutter*0.5` |
| `currentAdjustmentArrows` | `alignItems:'center'`, `justifyContent:'center'`, `zIndex: 100` |
| `currentTextContainer` | `position:'absolute'`, `left: 0`, `right: 0`, row, `justifyContent:'center'` |
| `currentText` | `getFontStyle({ type: 'Medium', fontSize: 15 })` |
| `currentTextInactive` | `opacity: 0.3` |

The chevrons are **space-between with ZERO horizontal padding** — they sit at the bar's edges. Ivan:
*"amperage < > button placement seem more inward on our side."* And the value is **15 Medium**, not the
16/600 we had. The value is absolutely centred across the full bar, so it cannot shift when a chevron
is hidden at a bound — their design gets for free what our "preserve the slot" trick was buying.

### Button typography — `getButtonFontStyle` @1340624

```
ButtonSize.SMALL -> TextCategory.BodyLabel      // 14 / 20 / 0.1
```

Full size map (`getButtonSizeStyle` @1340517): `SMALL = {minWidth:32, minHeight:32,
paddingHorizontal:12, paddingVertical:8, textMarginHorizontal:8, icon 16}`. Sizes PILL and
MEDIUMLARGE map to `CaptionLabel`; every other size maps to `BodyLabel`.

The charge-port button is `<Button appearance={GHOST} size={SMALL} textStyle={[color(textColorLight),
chargeButtonText]} style={[button, chargeButton]}>` — so **14pt**, dim, at 0.9 opacity. We had 17,
then 16, both invented.

### Method note

Registers are reused heavily across a module, so `grep 'r12 = '` gives the wrong value: the
assignments inside nested functions belong to a different frame. Match on the **module-closure indent
level** (12 spaces here) and take the last assignment before the `StyleSheet.create`. That is how
`r16=1`, `r12=1.5`, `r17=0.5`, `r10=1.5*Gutter`, `r21=0.5*Gutter` resolve — and why the naive read
gave `paddingTop: 26*Gutter = 260`, which is absurd on its face and was the tell.


---

## 10. The insets COMPOSE — the tree matters as much as the values (2026-07-28)

Ivan, on the left edges of the charge-limit text, the kWh line and the slider: *"in our app vs tesla
app. Why?"*

Recovering §9's numbers was not enough, because I applied them as siblings of the card. They are not
siblings. `ChargeRow`'s render (@4157717–4157752) nests them:

```
<View style={[container, containerNonCT]}>          @4158452, onLayout
  <View style={contentsContainer}>                   column, flexGrow 1
    <View style={chargeTextContainer}>               marginHorizontal 0.5*Gutter = 5
      <View style={[chargeStateHeader…]}>            <Text style={statusText}>  mH 1.5*Gutter = 15
      <View style={sliderContainer}>                 marginHorizontal 1.5*Gutter = 15
        <Slider style={targetSlider}/>
    <View style={bottomCardMargin}>                  marginBottom 2.5*Gutter = 25
      <VehicleChargeAmps style={ampsContainer}/>     marginHorizontal 2*Gutter = 20
    <View style={controlsDivider}/> <ControlButtons/>
```

So every left edge resolves to the SAME value:

| element | chain | left |
|---|---|---|
| charge-limit text | `chargeTextContainer` 5 + `statusText` 15 | **20** |
| kWh line | `chargeTextContainer` 5 + `statusText` 15 | **20** |
| slider | `chargeTextContainer` 5 + `sliderContainer` 15 | **20** |
| amps | `ampsContainer` 20 | **20** |
| buttons | `controlButtonContainer` width 100% | 0 |

`statusText` @4159289 is `{fontFamily: getUniversalSansFontFamily('Medium'), marginHorizontal:
1.5*Gutter}` — the piece that makes the texts line up with the slider rather than sitting 15 further
left.

**It carries no `fontSize`.** The size comes from the call site: all four `statusText` renders
(@4157150, @4157222, @4158084, @4158122) pass `category={TextCategory.BodyLabel}`, i.e. **14/20/0.1**.
We had CaptionLabel 12/16, so the kWh line read visibly smaller. This is the same trap as the tyre
labels — the type was in the call site, not in the style that looked like it owned the type.

### The card's own inset

```
Gutter = 10                                   @1338473
Specifications.homeScreenGutter    = 20       @1338673
Specifications.homeScreenBoxGutter = 10       @1338674
container.marginHorizontal = 20 - 10 = 10
```

The card sits **10** from the screen edge. Our HomeScreen `menu` pads 16, so the card carries
`marginHorizontal: 10 - 16` to land in the same place.

### The lesson, which is the reusable part

Three passes on the same panel:

1. one `paddingHorizontal: 18` for everything — invented;
2. read 5 / 15 / 20 out of the StyleSheet and applied them as siblings — rendered 5 / 5 / 15, three
   different edges, none correct;
3. read the RENDER as well, found the nesting, and all four resolve to 20.

Pass 2 felt like a recovery and was still wrong. **A style value is meaningless without the tree it
attaches to** — recover the JSX nesting alongside the StyleSheet, or the numbers will be right and
the layout still wrong.


---

## 11. Per-state behaviour: which controls appear when (2026-07-28)

Ivan, on the non-idle states: *"the amperage is available in all states is that expected? the visible
buttons is that expected to be the only visible buttons?"* No to both.

### 11.1 The amperage gate — @4157698

```js
showAmps = vehicleApiVersion >= MIN_SET_CHARGE_AMPS_CAR_API_VERSION
        && !vehicleIsSemi
        && fastcharging !== true
        && !showPowershareDischargingContent
```

**The stepper is HIDDEN on DC.** On a Supercharger the current is not the phone's to set. The other
three terms never vary for us (no Semi, no powershare, car well past the API floor), so
`fastCharging` is the whole gate in our build. `ChargeState.fast_charger_present` was in the proto
and simply never read — the same class of miss as `cableAttached` in §7.

Their wrapper View (`bottomCardMargin`) is built unconditionally and only its CHILD is conditional,
so the 25pt gap above the divider survives a DC session. Ours now matches.

### 11.2 The button matrix — ControlButtons @4155758

Slots, resolved from the assignment that FOLLOWS each definition:

```
slot21 = UnlockChargePortButton      @4154627
slot22 = StartStopChargingButton     @4154764
slot23 = ReportIssueButton           @4154981
slot24 = StopRestartPowershareButton @4155147
slot25 = OpenCloseChargePortButton   @4155670
```

Children are `[left, divider-if-both, right]`:

| state | left | right |
|---|---|---|
| unplugged | — | **Open/Close Charge Port** (25) |
| unplugged + nearbySite | Report Issue (23) | Open/Close Charge Port (25) |
| **plugged in** | **Start/Stop Charging** (22), iff `chargePortCanStartOrStopCharging === true` | **Unlock Charge Port** (21) |
| supercharging + nearbySite | Report Issue (23) | canStartOrStop ? Start/Stop (22) : Unlock (21) |
| powershare active/stopped | — | — unless stopReason is RETRY: StopRestartPowershare (24) + Unlock (21) |

**We had no Unlock Charge Port button at all**, and instead HID the port control whenever a cable was
seated — so a plugged-in car showed Start/Stop alone where theirs shows two.

`UnlockChargePortButton`'s command is `RKE_ACTION_OPEN_CHARGE_PORT` — the SAME action as opening the
port. With a cable seated it releases the latch rather than opening a door, so only the label
changes (`vehicle_controls_charge_port_unlock`). This is the frunk lesson again: one command, two
meanings by context. Reading the label without reading the action would have had us inventing a
second command that does not exist.

Not applicable to us and deliberately omitted: ReportIssue (cloud), StopRestartPowershare (V2H).

### 11.3 The kWh line across states

`charge_energy_added` resets when a session begins, accumulates through it, and retains the last
session's total once disconnected — so it genuinely differs per state. Every value being 0 was a hole
in our demo presets, which never set the field, not a fault in the panel.


---

## 12. The complete TEXT model (2026-07-28)

Ivan: *"right of Charge limit should be the current state no? while charging the text '0kwh added
during last charging session' seems off it should be different."* Both right; both were missing.

`chargeRowStateSelector` (@3884280-3884400) returns two text fields, not one:

```
chargingStateText     one string, rendered RIGHT of the limit in chargeStateHeader
chargingTextStrings   an ARRAY, rendered as a ROW beneath it (chargeRateText)
```

### 12.1 `chargingStateText` — getVehicleChargingStateText @1225331

Four branches on `ChargingState`; every other state (Disconnected, Starting, Unknown) has **no arm**,
so the header's right side is simply empty.

| ChargingState | key | English (in-bundle) |
|---|---|---|
| Charging | `vehicle_status_screen_charging` | Charging |
| Complete | `vehicle_status_screen_charging_complete` | Charging Complete |
| Stopped | `vehicle_status_screen_charging_stopped` | Charging Stopped |
| NoPower | `vehicle_status_screen_charging_no_power` | No Power* |

\* the only one of the four whose English literal is not in the bundle; the other three are.

#### Where it actually goes — @4157228, and NOT where I first put it

```jsx
<View style={chargeStateHeader}>                          // row, space-between
  <Text style={[statusText, {color: textColor}]}>
    {"Charge limit: 80%"}
    <Text style={[statusText, {color: textColorLight}]}>  // NESTED -> inline
      {"  \u00b7  " + chargingStateText}
    </Text>
  </Text>
  {showChargeLimitingIcon && <TooltipIcon style={chargeControllerTipIconContainer}/>}
</View>
```

Two corrections to my first pass, which put the state on the far right as a second flex child:

1. **The state is a NESTED `<Text>` inside the limit `<Text>`**, so it runs INLINE:
   `Charge limit: 80%  ·  Charging`. Same face and size; only the colour differs
   (`textColorLight` vs `textColor`).
2. **The `space-between` is for the OTHER child** — a charge-limit-reason tooltip icon. THAT is what
   gets pushed right, not the state text.

So the `space-between` was real and my inference about what it was for was invented. A layout
property tells you there are two children; it does not tell you which two.

**Between the texts is a literal string, not a gap:** they build
`''.concat(SpecialCharacters.dotSeparator, '  ')` with `this = '  '` — two spaces, U+00B7 MIDDLE DOT,
two spaces — and prepend it to the state, only when the limit string is non-null.
`SpecialCharacters = {degree:'°', dotSeparator:'·', bullet:'•', percentage:'%', zeroWidthJoiner:'\u200d'}`.

We do not render the tooltip (it needs `getChargeLimitReason`, cloud-side), so our row has one child
— kept as a row anyway, since that is the shape the icon would slot into.

### 12.2 `chargingTextStrings` — the branch that matters

```js
if (isCharging) {                                    // @971
  if (isFastCharging || units === KW)  push(getVehicleChargingkWText())
  if (units !== KW)                    push(getChargeRateDistanceDisplayValue())
  if (chargeAdded != null)             push('+' + getChargeAddedText())
  if (supercharger || roaming)         push(getVehicleChargeSessionCostText())
  if (!isFastCharging)                 push(getVehicleChargingCurrentAndVoltageText())
} else {                                             // @868
  if (chargeAdded != null && isChargeAddedNotNil)
    push(tr('vehicle_charge_screen_range_added', {range: getChargeAddedText()}))
}
```

**The "added during last charging session" sentence belongs to the IDLE state only.** While charging
the row is live values, and the added energy appears as a bare `+N kWh`. We rendered the idle line
unconditionally, so a charging car described its last session instead of its current one.

`getVehicleChargingCurrentAndVoltageText` @1231969 builds `<n>A` (or `<a>/<b>A`) and `<n>V` and joins
them with `SpecialCharacters.dotSeparator` → **"16A · 230V"**. It needs `charger_actual_current` and
`charger_voltage`, neither of which we read; both are now extracted.

Omitted deliberately: `getChargeRateDistanceDisplayValue` (needs GuiSettings units — we take the kW
branch throughout, same assumption as §9) and `getVehicleChargeSessionCostText` (Supercharger
billing, cloud-only).
