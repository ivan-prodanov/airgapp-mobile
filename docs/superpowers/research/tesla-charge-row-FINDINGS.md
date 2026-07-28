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
