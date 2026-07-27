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

| row | height |
|---|---|
| `ChargingAlerts` | 30 × Gutter = **300** |
| `Charging` | 30 × Gutter = **300** |
| `MediaControl` | 14 × Gutter = **140** |

`Gutter` is 10. **The MediaControl 140 independently confirms the media card's two 70pt panels** —
recovered separately in `tesla-tpms-markers-FINDINGS.md`'s sibling work and now cross-checked from
a second place in their code.

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

**So the 300pt is:** a charge-limit slider (with `sliderSnapPoints`), a percentage/range readout,
scheduled-charging text, and a control-button row (Start/Stop Charging, Open/Close Charge Port).

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
