# Charging faults over BLE — what the car can tell us, and what the official app does with it

**2026-09-05.** Research for "restart charging after it stops on an error, remotely". Sources, in
order of authority: the iPhone's own log ring (pulled today), the decompiled Tesla app
(`/Users/ivan/Work/tesla-summon/work/bundle.hasm`, function index `fn_index.txt`), the firmware
findings in `/Users/ivan/Work/tesla-firmware/out/req15-findings/P2-1-state-submessages.md`, and our
vendored protos. Nothing below was measured on the car yet — §7 lists what still has to be.

## 1. What today's log shows (2026-09-05, 18:36–18:38 UTC, via the Pi session)

Five `chargeStart` dispatches (18:36:13, :20, :48, 18:37:55) and two `chargeStop`. **Every one was
accepted**: `cmd settle … outcome:"ok"`, `gateway car verdict {status:"none", reason:"", bytes:0}` —
an empty CarServer reply, which is how the car says OK with nothing to add. The car never refused
the start, so there is no rejection reason to read. The log carries **no charge-state reads at all**
around the attempts (the focus poll's results are not logged), so the "~30 s then reverts" is
Ivan's observation only. Optimistic `charging` is released 1.5 s after settle
(`SETTLE_GRACE_MS`), and the home plan reads `charge` every ~3.75 s, so the 30 s the panel showed
"Charging" is most likely the car itself reporting `Charging` and then `Stopped` — a fault after
energising, not a refused command.

## 2. The car names the fault: `AlertState`, and it is BLE-local

CarServer `VehicleData` has an `alert_state` submessage the app never requests:

```
GetVehicleData.getAlertState = 20;           // GetAlertState {} — a field-less marker
VehicleData.alert_state       = 25;
message AlertState { repeated ChargingAlert charging_alerts = 1; Timestamp timestamp = 2000; }
message ChargingAlert { ChargingAlertName alert_name = 1; ChargingAlertType alert_type = 2; }
enum ChargingAlertType { INVALID_ALERT_TYPE = 0; WARNING = 1; NOTIFICATION = 2; }   // bundle enum literal
enum ChargingAlertName { INVALID_ALERT_NAME = 0; … 127 named faults, table in §3 }
```

- Numbers: bundle case tables (`Object: {'NOTHING': 0, … 'ALERT_STATE': 19 …}` is the slice enum;
  `GetAlertState` wrapper field **20** at `bundle.hasm:1009558`; response tag 25 per the firmware
  map). The firmware doc lists alert_type as 1 NOTIFICATION / 2 WARNING; the bundle's enum literal
  says WARNING=1, NOTIFICATION=2 — trust the bundle, verify on the car.
- **Served locally by the car**: `CarAPIHandlerImpl::alert_state` exists in QtCarServer (firmware
  findings, "car implements 22 of 24 submessages locally"). It is charging alerts ONLY.
- **The official app does not fetch it over BLE.** `setGetalertstate` has 3 references, all in the
  proto class; the BLE poller (`startBleVehicleUpdates`) dispatches location / climate / schedules /
  drive / charge / parked accessory / tyres only. It does have the reducer slice
  (`AlertStateVehicleSlice`) and the UI (`VehicleChargingAlertsRow`, `VehicleChargingAlertsScreen`),
  fed from the cloud path. We would be the first BLE client to read it — hence §7.
- Streaming alternative: `VehicleDataSubscription.AlertState_max_update_rate_ms = 17` is already in
  `proto/car_server.proto:181`, so the fault could also ride the existing tag-37 subscription.
- Our proto is missing all of it: `GetVehicleData` (`proto/car_server.proto:237`) stops at
  `getParentalControlsState = 19`; `VehicleData` (`proto/vehicle.proto:14`) has no field 25; no
  `AlertState` / `ChargingAlert` / `ChargingAlertName` messages. Regenerate with
  `npm run build:teslaproto` after adding them.

## 3. Alert name → the text Tesla shows (recovered from `getChargingAlertInfoFromAlert`, fn #30341)

The function is a 129-arm if-chain (the last arm is the fall-through of a `JStrictNotEqualLong`, and UMC_A018 uses the short `JStrictEqual` — a first extraction that only matched `JStrictEqualLong` missed both): `alert_name === ChargingAlertName.X → { title: tr(title_N),
subtitle: tr(subtitle_M), errorCode: 'X_CODE', alertType }`. English from the in-bundle translation
table (`bundle.hasm` line 1140421). The *family* column is mine, keyed on the remedy wording — it
is the grouping the retry logic in the design uses.

| # | ChargingAlertName | Title (Tesla app) | Remedy line (Tesla app) | family |
|---|---|---|---|---|
| 1 | BMS_A007_SW_SLOWED_CHG_BATT_COLD_OBSOLETE | Battery is heating - Keep charge cable inserted | Charge rate will increase once battery is warm | info |
| 2 | BMS_A076_SW_DCH_WHILE_CHARGING | Weak power source | Unable to charge battery | other |
| 3 | CC_A001_GNDMONINTRPTLINESIDE | Unable to charge - Insufficient grounding | Proper wiring or outlet grounding must be verified | equipment |
| 4 | CC_A002_GNDMONINTRPTLOADSIDE | Unable to charge - Insufficient grounding | Disconnect and retry or use different equipment | replug |
| 5 | CC_A003_CCIDTRIPPED | Unable to charge - Wall Connector GFCI tripped | Disconnect and retry or use different equipment | replug |
| 6 | CC_A004_CCIDSELFTESTFAULT | Unable to charge - Wall Connector issue | Wall Connector needs service | equipment |
| 7 | CC_A005_GROUNDEDNEUTRAL | Unable to charge - Wall Connector GFCI tripped | Disconnect and retry or use different equipment | replug |
| 8 | CC_A006_INPUTOVERCURRENT | Unable to charge - Wall Connector overcurrent | Disconnect and retry or use different equipment | replug |
| 9 | CC_A007_INPUTOVERVOLTAGE | Unable to charge - Input voltage too high | Voltage must be within Wall Connector rating | other |
| 10 | CC_A008_INPUTUNDERVOLTAGE | Unable to charge - Input voltage too low | Voltage must be within Wall Connector rating | other |
| 11 | CC_A009_INPUTMISWIRED | Unable to charge - Input wired incorrectly | Input wiring to Wall Connector must be corrected | equipment |
| 12 | CC_A010_CONTACTORWELDED | Unable to charge - Wall Connector issue | Wall Connector needs service | equipment |
| 13 | CC_A011_AMBIENTOT | Unable to charge - Wall Connector too hot | Let Wall Connector cool and try again | replug |
| 14 | CC_A012_WALLPLUGOT | Unable to charge - Wall connection too hot | Outlet or Wall Connector wiring must be checked | thermal |
| 15 | CC_A013_VEHCONNOT | Unable to charge - Charge handle too hot | Check charge handle or charge port for debris | thermal |
| 16 | CC_A014_MCUSELFTESTFAULT | Unable to charge - Wall Connector issue | Wall Connector needs service | equipment |
| 17 | CC_A015_PILOTAFAULT | Unable to charge - Vehicle connection issue | Insert charge handle fully into charge port | replug |
| 18 | CC_A016_PILOTBFAULT | Unable to charge - Vehicle connection issue | Insert charge handle fully into charge port | replug |
| 19 | CC_A017_PILOTCFAULT | Unable to charge - Vehicle connection issue | Insert charge handle fully into charge port | replug |
| 20 | CC_A018_PILOTDFAULT | Unable to charge - Vehicle connection issue | Insert charge handle fully into charge port | replug |
| 21 | CC_A019_PROXDISCONNECTED | Unable to charge - Vehicle connection issue | Insert charge handle fully into charge port | replug |
| 22 | CC_A020_3VRAILINCORRECT | Unable to charge - Wall Connector issue | Wall Connector needs service | equipment |
| 23 | CC_A021_CB_NOMASTER | Unable to charge - No primary Wall Connector | Check that primary unit is powered and available | equipment |
| 24 | CC_A022_CB_TOOMANYMASTERS | Unable to charge - More than 1 primary unit | Ensure only 1 Wall Connector is set as primary | equipment |
| 25 | CC_A023_CB_TOOMANYSLAVES | Unable to charge - Too many Wall Connectors | Ensure no more than 3 units paired with primary | equipment |
| 26 | CC_A024_CB_MASTERISETTOOLOW | Unable to charge - Low Wall Connector current | Primary unit current setting must be increased | equipment |
| 27 | CC_A025_EVSETEMP | Unable to charge - Wall Connector issue | Wall Connector needs service | equipment |
| 28 | CC_A026_WALLPLUGTEMP | Unable to charge - Wall Connector issue | Wall Connector needs service | equipment |
| 29 | CC_A027_VEHICLEHANDLETEMP | Unable to charge - Wall Connector issue | Wall Connector needs service | equipment |
| 30 | CC_A028_CB_ROTARYSELECT | Unable to charge - Incorrect switch setting | Wall Connector rotary switch must be adjusted | equipment |
| 31 | CC_A029_PILOTFFAULT | Unable to charge - Vehicle connection issue | Insert charge handle fully into charge port | replug |
| 32 | CC_A030_MASTERSLAVEMISMATCH | Unable to charge - Primary / paired unit mismatch | Wall Connector current ratings must match | equipment |
| 33 | CC_A041_INPUTWIRINGFOLDBACK | Charge rate reduced - Wall connection hot | Outlet or Wall Connector wiring must be checked | info |
| 34 | CC_A042_PCBATEMPFOLDBACK | Wall Connector internal temperature is high | Maximum charge rate reduced | info |
| 35 | CC_A043_CONFIGURATIONREQUIRED | Wall Connector configuration must be completed | Refer to Installation Guide to enable charging | dc |
| 36 | CP_A004_PROXIMITYRATIONALITY | Charging equipment not recognized | Try again or try different equipment | replug |
| 37 | CP_A010_PILOTRATIONALITY | Charging equipment communication error | Try again or try different equipment | replug |
| 38 | CP_A046_LOSTCOMMSEVSE | Charging equipment communication lost | Check power source and charging equipment | other |
| 39 | CP_A049_MULTIPLECABLESDETECTED | Unable to charge | Multiple charge cables detected - Use only one | other |
| 40 | CP_A052_CHADEMONOTSUPPORTED | Unable to charge | CHAdeMO charging stations not supported | dc |
| 41 | CP_A053_PROXLATCHEDNOPILOT | Unable to charge - Charge station not powered | Check power source or try a different station | power |
| 42 | CP_A055_CHARGESTOPPEDNOPILOT | Charging equipment communication lost | Check power source and charging equipment | other |
| 43 | CP_A058_ACCHARGINGBLOCKED | Unable to AC charge - System will retry shortly | Disconnect and retry or use different equipment | replug |
| 44 | CP_A062_SCOUTOFSERVICE | Supercharger stall out of service | Try a different stall | dc |
| 45 | CP_A063_SCUPDATEINPROGRESS | Supercharger update in progress | Try a different Supercharging stall | dc |
| 46 | CP_A064_SUPERCHARGINGBLOCKED | Supercharging not enabled | Try AC charging | dc |
| 47 | CP_A066_PROXLATCHEDIDLEPILOT | Charging equipment not ready | See equipment instructions to start charging | other |
| 48 | CP_A067_GBDCCONNFAULT | Charging equipment reports error | Check equipment for error code or message | other |
| 49 | CP_A074_FAILEDTOESTABLISHV2GCOMM | Charging equipment communication error | Unplug via Mobile App or Touchscreen and retry | replug |
| 50 | CP_A091_WRONGSUPERCHARGERHANDLE | Charge cable handle incompatible | Use different Supercharger handle type | dc |
| 51 | CP_A101_WCFOLDBACKACTIVE | Charge rate reduced - Wall connection hot | Outlet or Wall Connector wiring must be checked | info |
| 52 | CP_A102_WCOVERTEMPFAULT | Unable to charge - Wall connection too hot | Outlet or Wall Connector wiring must be checked | thermal |
| 53 | CP_A108_CHADEMOOVERTEMPFAULT | Charging adapter temperature high | DC Fast Charging / Supercharging unavailable | thermal |
| 54 | CP_A110_THERMALVELOCITYHIGH | Charge port requires service | Charging may be unavailable | equipment |
| 55 | CP_A120_COMBOADAPTERFOLDBACK | Charging adapter temperature high | Maximum charge rate reduced | info |
| 56 | CP_A131_EVSECOMMTIMEOUT | Charging session was not started in time | Disconnect charge cable - Then connect and retry | replug |
| 57 | CP_A132_CONTRACTAUTHTIMEOUT | Charging station authentication required | See station instructions to start charging | dc |
| 58 | CP_A133_PROXNEVERLATCHED | Unable to charge - Vehicle connection issue | Insert charge handle fully into charge port | replug |
| 59 | CP_A135_SDPATTEMPTSFAILED | Charging equipment communication error | Unplug via Mobile App or Touchscreen and retry | replug |
| 60 | CP_A139_PILOTFAULTED | Charging equipment reports error | Check equipment for error code or message | other |
| 61 | CP_A140_SUPERCHARGERFAULTED | Unable to charge - Supercharger reports an error | Unplug and retry / Try a different charging stall | replug |
| 62 | CP_A141_CHADEMOADAPTERFAULT | Charging equipment reports error | Check equipment for error code or message | other |
| 63 | CP_A142_GBDCSCCONNFAULT | Unable to charge - Supercharger reports an error | Unplug and retry / Try a different charging stall | replug |
| 64 | CP_A143_UNSUPPORTEDCHARGEADAPTER | Charging adapter has electric arc flash hazard | Use different charging equipment | dc |
| 65 | CP_A146_CCSEVSEMALFUNCTION | Charging station reports error | Check charging station for error code or message | dc |
| 66 | CP_A151_BADPILOTDIODEDETECTED | Charge port error detected - Service is required | AC charging may not function / OK to Supercharge | dc |
| 67 | CP_A152_PILOTEDGEDETECTIONFAILED | Charge port error detected - Unable to charge | Schedule service to restore charging functionality | equipment |
| 68 | FC_A141_CA_VEHCONN_OT | Charging adapter temperature high | DC Fast Charging / Supercharging unavailable | thermal |
| 69 | FC_A142_CA_EVSECONN_OT | Charging adapter temperature high | DC Fast Charging / Supercharging unavailable | thermal |
| 70 | FC_A143_CA_PCB_OT | Charging adapter temperature high | DC Fast Charging / Supercharging unavailable | thermal |
| 71 | FC_A151_CA_VEHTOEVSEDELTALO | Charging adapter temperature high | Maximum charge rate reduced | info |
| 72 | FC_A154_CA_VEHTOPCBDELTALO | Charging adapter temperature high | Maximum charge rate reduced | info |
| 73 | FC_A161_CA_VEHTEMPHIFOLDBK | Charging adapter temperature high | Maximum charge rate reduced | info |
| 74 | FC_A162_CA_EVSETEMPHIFOLDBK | Charging adapter temperature high | Maximum charge rate reduced | info |
| 75 | FC_A163_CA_PCBTEMPHIFOLDBK | Charging adapter temperature high | Maximum charge rate reduced | info |
| 76 | FC_A266_GB_NEGPIN_OT | Charging adapter temperature high | DC Fast Charging / Supercharging unavailable | thermal |
| 77 | FC_A267_GB_POSPIN_OT | Charging adapter temperature high | DC Fast Charging / Supercharging unavailable | thermal |
| 78 | FC_A268_GB_PCB_OT | Charging adapter temperature high | DC Fast Charging / Supercharging unavailable | thermal |
| 79 | FC_A272_GB_NEGTOPOSDELTAHI | Charging adapter temperature high | Maximum charge rate reduced | info |
| 80 | FC_A273_GB_NEGTOPOSDELTALO | Charging adapter temperature high | Maximum charge rate reduced | info |
| 81 | FC_A274_GB_NEGTOPCBDELTAHI | Charging adapter temperature high | Maximum charge rate reduced | info |
| 82 | FC_A282_GB_NEGTEMPHIFOLDBK | Charging adapter temperature high | Maximum charge rate reduced | info |
| 83 | FC_A283_GB_POSTEMPHIFOLDBK | Charging adapter temperature high | Maximum charge rate reduced | info |
| 84 | FC_A284_GB_PCBTEMPHIFOLDBK | Charging adapter temperature high | Maximum charge rate reduced | info |
| 85 | FC_A286_GB_EVSECONNUNLOCKED | Maximum DC Fast Charge rate reduced | Adjust handle latch or contact station operator | info |
| 86 | PCS_A007_CHGPHASETEMPHOT | Charging system temperature high | Maximum charge rate reduced | info |
| 87 | PCS_A016_CHGALLPHASESFAULTED | Cannot charge - Poor grid power quality possible | Retry / Try other charge location or Supercharging | power |
| 88 | PCS_A017_CHGWALLPOWERREMOVAL | Charging stopped - Power lost while charging | Check power source and charging equipment | power |
| 89 | PCS_A019_ACCHARGEPOWERLIMITED | Power grid or vehicle issue limiting AC charging | Unplug and retry / Try different charging location | replug |
| 90 | PCS_A032_EXCESSIVEGRIDTRANSIENTSDETECTED | Poor electric grid power quality detected | Try different charging station or location | power |
| 91 | PCS_A052_ACVOLTAGENOTPRESENT | External charging equipment not providing power | Check power source or try different equipment | power |
| 92 | PCS_A053_CHGINPUTVDROPHIGH | Charge rate reduced - Unexpected voltage drop | Remove extension cords / Have wiring inspected | info |
| 93 | PCS_A054_CHGINPUTVDROPTOOHIGH | Charging stopped due to large voltage drop | Remove extension cords / Have wiring inspected | voltage-drop |
| 94 | PCS_A055_CHGLINEIMPEDANCEHIGH | Charge rate reduced - Unexpected voltage drop | Remove extension cords / Have wiring inspected | info |
| 95 | PCS_A056_CHGLINEIMPEDANCETOOHIGH | Charging stopped due to large voltage drop | Remove extension cords / Have wiring inspected | voltage-drop |
| 96 | PCS_A059_CHGINPUTOVRMS | Unable to charge | Voltage too high - Try a different power source | other |
| 97 | PCS_A073_UNEXPECTEDACINPUTVOLTAGE | External charging equipment error detected | Try different charging equipment | other |
| 98 | PCS_A078_CHGSTOPDCDCTOOHOT | Vehicle systems over temperature limit | AC charging unavailable / Try DC charging | thermal |
| 99 | PCS_A088_GRIDFREQDROOPDETECTED | Vehicle charging with off-grid Powerwall | Charging rate adjusted to allow power sharing | info |
| 100 | PCS_A090_EXPECTEDACVOLTAGESOURCEMISSING | Charging slowed - Some AC phases not powered | Check power source and charging equipment | info |
| 101 | PCS_A096_MICROGRIDOVERLOADED | Charging interrupted - Powerwall energy level low | Unplug handle - Retry when energy is available | replug |
| 102 | PCS2_A019_DCACADCTEMPTOOHIGH | Electrical AC power system unavailable | Outlets and AC charging unavailable | power |
| 103 | PCS2_A020_DCACBDCTEMPTOOHIGH | Electrical AC power system unavailable | Outlets and AC charging unavailable | power |
| 104 | PCS2_A024_DCACATXTEMPTOOHIGH | Electrical AC power system unavailable | Outlets and AC charging unavailable | power |
| 105 | PCS2_A025_DCACBTXTEMPTOOHIGH | Electrical AC power system unavailable | Outlets and AC charging unavailable | power |
| 106 | PCS2_A062_ACVOLTAGENOTPRESENT | External charging equipment not providing power | Check power source or try different equipment | power |
| 107 | PCS2_A063_CHGUNKNOWNGRIDCONFIG | Cannot charge - Poor grid power quality possible | Retry / Try other charge location or Supercharging | power |
| 108 | PCS2_A112_CHGINPUTVDROPTOOHIGH | Charging stopped due to large voltage drop | Remove extension cords / Have wiring inspected | voltage-drop |
| 109 | PCS2_A115_CHGWALLPOWERREMOVAL | Charging stopped - Power lost while charging | Check power source and charging equipment | power |
| 110 | PCS2_A116_CHGPERSISTENTFAULT | Unable to AC charge - Unplug and retry | Or try DC Fast Charging / Supercharging | replug |
| 111 | UMC_A001_GNDMONINTRPTLINESIDE | Unable to charge with Mobile Connector | Inadequate outlet grounding - Try a different outlet | equipment |
| 112 | UMC_A002_GFCITRIPPED | Unable to charge - Mobile Connector GFCI tripped | Unplug charge handle from charge port and retry | replug |
| 113 | UMC_A003_GFCISELFTESTFAULT | Unable to charge - Mobile Connector error | Unplug from wall outlet and retry | replug |
| 114 | UMC_A004_INPUTOVERVOLTAGE | Unable to charge with Mobile Connector | Voltage too high / Try a different wall outlet | other |
| 115 | UMC_A005_INPUTUNDERVOLTAGE | Unable to charge with Mobile Connector | Voltage too low / Try a different wall outlet | other |
| 116 | UMC_A006_CONTACTORWELDED | Unable to charge - Mobile Connector error | Unplug from wall outlet and retry | replug |
| 117 | UMC_A007_PCBAOT | Mobile Connector control box temperature high | Let Mobile Connector cool to resume charging | thermal |
| 118 | UMC_A008_WALLPLUGOT | Unable to charge - Wall plug temperature high | Wall outlet and wiring inspection recommended | thermal |
| 119 | UMC_A009_VEHCONNOT | Cannot charge - Charge handle temperature high | Check charge handle or charge port for debris | thermal |
| 120 | UMC_A010_INPUTOT | Mobile Connector to adapter connection hot | Let cool - Plug adapter fully into Mobile Connector | replug |
| 121 | UMC_A011_PROXDISCONNECTED | Charging equipment communication error | Try again or try different equipment | replug |
| 122 | UMC_A012_PILOTFAULT | Charging equipment communication error | Try again or try different equipment | replug |
| 123 | UMC_A013_SA_TEMPERATURE | Wall plug adapter error - Charge rate reduced | Plug adapter fully into Mobile Connector and retry | info |
| 124 | UMC_A014_SA_GENEALOGY | Wall plug adapter error - Charge rate reduced | Plug adapter fully into Mobile Connector and retry | info |
| 125 | UMC_A015_SA_CONNECTION | Wall plug adapter error - Charge rate reduced | Plug adapter fully into Mobile Connector and retry | info |
| 126 | UMC_A016_PCBAOTFOLDBACK | Mobile Connector control box temperature high | Maximum charge rate reduced | info |
| 127 | UMC_A017_WALLPLUGOTFOLDBACK | Charge rate reduced - Wall plug temperature high | Wall outlet and wiring inspection recommended | info |
| 128 | UMC_A018_VEHCONNOTFOLDBACK | Charge rate reduced - Handle temperature high | Check charge handle or charge port for debris | info |
| 129 | UMC_A019_INPUTOTFOLDBACK | Mobile Connector to adapter connection hot | Maximum charge rate reduced | info |

Family counts: info 29 · replug 29 · equipment 18 · other 14 · thermal 14 · power 12 · dc 10 · voltage-drop 3 (the family rule lives in
`src/ble/chargingAlerts.ts`; `info` = a reduced-rate notice, the car is still charging).

The row UI (`VehicleChargingAlertsRow`, fn #92996): `DynamicRowTypes.ChargingAlerts`, 30 × Gutter
tall, a Pressable with `NamedIcon` `warning` (alertType WARNING) or `info_hollow`, title in
`BodyLabel`, subtitle in the light colour, tap → owner's-manual troubleshooting page
(`OWNERS_MANUAL_TROUBLESHOOTING_ALERTS_GUID_*`). It sits ABOVE the Charging row in the home list.

## 4. ChargeState fields the car already sends us that `telemetry.ts` ignores

| field | # | meaning | why it matters here |
|---|---|---|---|
| `charge_port_latch` | 35 | `ChargePortLatchState` SNA 1 / Disengaged 2 / Engaged 3 / **Blocking 4** | the re-plug macro's step gate |
| `charge_cable_unlatched` | 159 | bool: cable seated but latch not engaged | drives Tesla's "Charge port latch not engaged" tip (§5) |
| `user_charge_enable_request` | 132 | bool: the user's last start/stop intent as the car holds it | tells "user stopped" from "car stopped" |
| `charge_enable_request` | 133 | bool: whether the car is currently asking to charge | same |
| `charger_phases` | 134 | 1 or 3 | 3-phase Type 2 home charging |
| `charge_port_cold_weather_mode` | 136 | bool | picks the "latch may be frozen" wording |

All six are already typed in `src/ble/proto/gen.d.ts` (`chargePortLatch`, `chargeCableUnlatched`,
…); only the parse in `telemetry.ts` (charge slice, ~line 372) is missing.

## 5. How the official app's charge UI is gated (helpers in the vehicle module, ~fn #30639–30658)

- `canStartStopCharging`: `chargingState ∈ {STARTING, CHARGING, CALIBRATING, STOPPED}`.
- `canUnlockChargePort`: `chargingState ∈ {COMPLETE, STOPPED, NOPOWER}` && one more predicate
  (Call4 on the vehicle; not decoded).
- `isVehiclePluggedIn`: `∈ {CHARGING, CALIBRATING, STARTING, NOPOWER, COMPLETE, STOPPED}`;
  `TYPE_NOT_SET / UNKNOWN / DISCONNECTED` → false.
- `isChargingStopped`: `=== STOPPED`.
- `ChargeRow` (fn #102773) latch tip: **if `chargeCableUnlatched === true`** render a
  `chargeTipRow`: header `charging_not_engaged` = "Charge port latch not engaged"; body =
  `coldWeatherMode ? charging_frozen : charging_obstruction` = "Latch may be frozen - Fully insert
  cable or try defrosting through app" / "Fully insert charge cable or check for obstruction".
- Buttons: `StartStopChargingButton` → `VehicleAction.CHARGINGSTARTSTOPACTION` (6), busy keyed on
  that command type; `UnlockChargePortButton` → VCSEC `RKE_ACTION_OPEN_CHARGE_PORT` (4). There is
  **no retry / restart affordance anywhere** in the official app.

## 6. The levers the protocol has (and does not have)

VCSEC `RKEAction_E`: UNLOCK 0, LOCK 1, OPEN_TRUNK 2, OPEN_FRUNK 3, **OPEN_CHARGE_PORT 4,
CLOSE_CHARGE_PORT 5**, CANCEL_EXTERNAL_AUTHENTICATE 6, UNKNOWN 19, REMOTE_DRIVE 20,
AUTO_SECURE_VEHICLE 29, WAKE_VEHICLE 30, UNLOCK_AND_REMOTE_DRIVE 31. We send the charge port via
`closureMoveRequest.chargePort = OPEN/CLOSE` (`builders.ts:119-128`), same mechanism.

CarServer `VehicleAction` (full table recovered — 130 cases): the charging ones are
`chargingSetLimitAction` 5, `chargingStartStopAction` 6 (start / start_standard / start_max_range /
stop), `setChargingAmpsAction` 43, `chargePortDoorClose` 61, `chargePortDoorOpen` 62, the schedule
actions 97/98/107/108, `setLowPowerModeAction` 130. **There is no "reset charge port", "retry", or
"re-plug" action.** A software re-plug therefore has to be composed from unlatch → (re-latch) →
start, plus `setChargingAmps` for the voltage-drop family.

## 7. Measured on the car, 2026-09-05 22:40 local (over the Pi, from the Mac)

Built the same day (spec `docs/superpowers/specs/2026-09-05-restart-charging-design.md`, plan
`docs/superpowers/plans/2026-09-05-restart-charging.md`), deployed to the iPhone, and driven from
the Mac with `devicectl device process launch --payload-url airgapp://restart-charging`. Log ring:

```
19:40:17 gateway | car verdict | {"label":"wake","status":"none"}            <- car was asleep; VCSEC wake
19:40:18 charge  | restart: before | {"state":"charging","latch":"engaged","cableUnlatched":"false","amps":16,"alerts":"-"}
19:40:18 charge  | restart: result | {"ok":true,"reason":"charging","attempts":0}
```

- **`getAlertState` over BLE does not fault**: the scoped `alerts` read returned a decrypted
  VehicleData (a faulted read would have logged `alerts read failed`). With the car charging
  normally the list was empty; whether the car NAMES a fault is still to be seen at the next one.
- **`charge_port_latch` / `charge_cable_unlatched` parse on the real car** (Engaged / false).
- The macro did the right thing on a healthy car: no commands sent.
- Not yet exercised: the unlatch → start cycle itself (needs a plugged-in, not-charging car —
  either the next real fault, or a deliberate Stop Charging followed by Restart).

### 7.1 The fault, named — 2026-09-06 00:11 local

Ivan reported the car had been faulted earlier and "unfaulted itself" (charging again, nothing
pressed). The log ring shows the app sent NO charging command between his last Start (21:37) and
the first launch of the new build (22:37) — only VCSEC `wake`s when he opened the app at 22:16 and
22:31. A second restart run at 00:11 read the car; the persisted cache
(`Library/Application Support/local.airgapp.mobile/RCTAsyncLocalStorage_V1/<md5 of
carlink.cache.<vin>>`) holds the full read:

```
chargingState Charging · SoC 42% · energyAdded 3.26 kWh · minutesToLimit 1370
chargerPilotCurrentA 13 · chargerActualCurrentA 8 · chargerVoltageV 215 · chargerPowerKw 1
chargingAlerts: [ 92 PCS_A053_CHGINPUTVDROPHIGH
  "Charge rate reduced - Unexpected voltage drop" / "Remove extension cords / Have wiring inspected"
  kind notification ]
```

- **`alert_state` over BLE works and NAMES the fault.** First real alert decoded end to end.
- The supply is weak: the EVSE offers 13 A, the car takes 8 A at 215 V — its own foldback for
  PCS_A053. The hard stop after 1–2 h is the severe form of the same family (PCS_A054/A056
  "Charging stopped due to large voltage drop"): a plug/wiring that heats up, resistance rises,
  the drop crosses the threshold, the car stops; a plain Start at full current trips it again
  within seconds; once cooled the car retries at reduced current on its own. Nobody "unfaulted"
  it — the car did, at 8 A.
- Durable remedy per Tesla's own line: lower the current (the macro's voltage-drop branch does
  this first) and have the socket / extension inspected.
- Gap found: the app never read the car's amps SETTING (`charge_current_request` 137), so the
  stepper showed the 16 A default; now parsed into `chargingAmps`.

## 8. Still to measure (each is a one-minute test with the cable seated)

1. `getAlertState` over BLE while the centre screen shows a charging fault: does the car answer,
   with which `alert_name` / `alert_type`, and does the list clear after a successful start?
2. After an app unlatch (`charge_port_latch` → Disengaged, `charge_cable_unlatched` → true), does
   `chargingStartStopAction.start` re-engage the latch and go Starting → Charging on its own, or
   does the car insist on a physical re-insert? And does `closureMoveRequest.chargePort = CLOSE`
   re-latch a seated cable without starting?
3. Does the EVSE see the unlatch as end-of-session (control pilot back to state A / its own
   "session ended" log), or only as C → B? This decides whether EVSE-side faults (GFCI, power lost)
   are ever remotely recoverable from the car side.

### 7.2 "The 60 s sync never runs" was a logging artefact — 2026-09-06

The ring showed zero `poll` rows in 24 h. It was the SINK, not the poll: `logSink.ts` trims the
noisy categories (`txp`, `poll`, `read`, `console`) with `seq <= MAX(seq) - 20000`, `MAX(seq)` is
table-wide (a July-30 capture left it at 37,836), and logbus restarts `seq` at 0 every boot — so
every later boot's poll/read rows were deleted on the next flush. Proof: the 19:43Z boot has 828
surviving rows over seq 0..6422 with 812 gaps (5,595 rows deleted) — the tick and the focus poll
ran the whole time. It also explains the original "Start shows charging for ~30 s then reverts":
the 60 s sync read the real state back. Fix: the stored seq continues from `MAX(seq)`
(`src/services/logSeq.ts`, applied in `logSink.ts`).

Verified 2026-09-06 09:14Z after the sink fix: the new boot's rows run seq 37874..37982 with
**0 gaps**; `poll | vcsec {txp:"pi"}` every 20 s; `poll | infotainment {ms:4396, alerts:0}` at
09:14:50 and 09:15:49 — the 60 s sync runs and requests `alerts` while the cable is seated.
