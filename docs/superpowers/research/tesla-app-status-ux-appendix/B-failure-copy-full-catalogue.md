# Section B — Command-Failure User-Facing Copy (Tesla Android app v4.58.0-4392)

Scope: exact, auditable strings for the vehicle-command **failure card** (title, body, behaviour).
Every row cites its source. `strings.xml` = `base_apktool/res/values/strings.xml` (English native resources).
`catalog` = the inline RN i18n English module embedded in the Hermes bundle at **bundle.hasm line 1140421**
(`NewObjectWithBufferLong`, ~8745 keys, assigned to module `exports`). `builder` = the failure-card builder
function at **bundle.hasm lines 4393900–4395450**.

---

## 0. HEADLINE FINDING — corrects the prior architecture note

The prior working assumption was that the in-app failure-card **body** English is *not* in the base bundle
(so it must be server-fetched). **That is wrong.** The English body **is inline in the Hermes bundle**.

- `command_error_timeout` resolves to the exact observed field body **`Command timeout, please try again.`**
  — present verbatim at **bundle.hasm line 1140421** (`catalog`).
- It was missed earlier because it lives **inside a `NewObjectWithBufferLong` buffer**, which the disassembler
  renders as one giant `# Object: {…}` comment. Individual values therefore never appear as standalone
  `# String: '…' (String)` lines, so grepping `all_strings.txt` (a de-duplicated list of standalone String/Identifier
  literals) for the value returns nothing. The **keys** appear (as `Identifier`s); the **values** are hidden in the buffer.

**Conclusion (with evidence): the in-app failure-card body English is (b) INLINE IN THE BUNDLE.**
- Not (a) native `strings.xml`: only ONE `command_error_*` key exists there — the title format (line 417). None of the
  bodies (`command_error_timeout`, `command_error_unexpected`, `command_error_GENERIC_`, the `vehicle_error_*` family,
  or the ~195 precondition keys) are in `strings.xml`.
- Not (c) server-fetched: there is **no i18n/locale JSON anywhere in `assets/` or `res/`** (searched). Instead the
  translations ship inline as **31 locale modules** compiled into the Hermes bundle (31 distinct object literals each
  containing key `command_error_timeout`; the English one is line 1140421). APK is tagged `24lang`; 31 modules =
  base + regional variants.

---

## 1. Failure TITLE

### 1a. Format string — two parallel systems

| System | Key | Exact value | Placeholder | Source |
|---|---|---|---|---|
| RN in-app card | `command_error_command_failed` | `{{command}} failed` | `{{command}}` (i18next) | catalog, bundle.hasm L1140421 |
| Native (push / background task) | `command_error_command_failed` | `%command% failed` | `%command%` (Android, `formatted="false"`) | strings.xml **L417** |

The RN card renders the title `{{command}} failed` where `{{command}}` is filled by a nested `tr()` call resolving a
`command_name_*` display name. Confirmed in `builder`: `tr('command_error_command_failed', { command: … })`
(bundle.hasm ~L4394965–4394970). The native `%command% failed` variant is used by the Android notification /
background-task path.

### 1b. `{{command}}` substitution — full command_name → English display-name table

Authoritative source is the RN catalog (107 keys, bundle.hasm L1140421). Native `strings.xml` (L418–448) carries a
31-key subset with identical values. Fallback when a command has no mapping: `command_name_GENERIC_` = `Command`.

| Key | English | Also in strings.xml |
|---|---|---|
| command_name_GENERIC_ | Command | no |
| command_name_ACTUATE_FRONT_TRUNK | Actuate Front Trunk | no |
| command_name_ACTUATE_REAR_TRUNK | Actuate Rear Trunk | no |
| command_name_ACTUATE_TRUCK_TAILGATE | Actuate Tailgate | no |
| command_name_ADDCHARGESCHEDULEACTION | Add charging schedule | no |
| command_name_ADDPRECONDITIONSCHEDULEACTION | Add precondition schedule | no |
| command_name_ADD_PAYMENT | Add Payment | no |
| command_name_AUTOSTWHEATACTION | Auto Steering Wheel Heat | no |
| command_name_BATCHREMOVECHARGESCHEDULESACTION | Batch remove charging schedules | no |
| command_name_BATCHREMOVEPRECONDITIONSCHEDULESACTION | Batch remove precondition schedules | no |
| command_name_BOOMBOXACTION | Remote Fart | no |
| command_name_CALENDAR_SYNC | Calendar Sync | yes (L418) |
| command_name_CANCELSOHTESTACTION | Cancel battery state of health test | no |
| command_name_CANCEL_SOFTWARE_UPDATE | Cancel Software Update | yes (L419) |
| command_name_CHANGE_CHARGE_LIMIT | Set Charge Limit | yes (L420) |
| command_name_CHANGE_CLIMATE_TEMPERATURE_SETTING | Set Climate Temperature | yes (L421) |
| command_name_CHANGE_SUNROOF_STATE | Control Sunroof | yes (L422) |
| command_name_CHARGE_PORT_DOOR_CLOSE | Charge Port Close | yes (L423) |
| command_name_CHARGE_PORT_DOOR_OPEN | Charge Port Open | yes (L424) |
| command_name_CHARGING_AMPS | Set Charge Current | no |
| command_name_CLIMATE_OFF | Climate Off | yes (L425) |
| command_name_CLIMATE_ON | Climate On | yes (L426) |
| command_name_DELETEDASHCAMCLIPSACTION | Delete Dashcam Clips | no |
| command_name_FETCHKEYSINFOACTION | Fetch Keys | no |
| command_name_FLASH_LIGHTS | Flash Lights | yes (L427) |
| command_name_FORMATUSBACTION | Format USB Drive | no |
| command_name_GUESTMODEACTION | Set Guest Mode | no |
| command_name_HONK_HORN | Honk Horn | yes (L428) |
| command_name_LOCK | Lock | yes (L429) |
| command_name_MAX_DEFROST | Max Defrost | no |
| command_name_MEDIA | Media Command | no |
| command_name_PARENTAL_CONTROLS_ACTIVATE | Activate Parental Controls | no |
| command_name_PARENTAL_CONTROLS_CLEAR_PIN | Clear Parental Controls PIN | no |
| command_name_PARENTAL_CONTROLS_DEACTIVATE | Deactivate Parental Controls | no |
| command_name_PARENTAL_CONTROLS_SET_LIMIT | Set Parental Controls Speed Limit | no |
| command_name_PARENTAL_CONTROLS_TOGGLE_SETTING | Toggle Parental Controls Setting | no |
| command_name_PAY_BALANCE | Pay Balance | no |
| command_name_REMOTE_AUTO_SEAT_CLIMATE_REQUEST | Auto Seat Climate | yes (L430) |
| command_name_REMOTE_SEAT_COOLING_REQUEST | Seat Cooling | yes (L431) |
| command_name_REMOTE_SEAT_HEATER_REQUEST | Seat Heat | yes (L432) |
| command_name_REMOTE_START | Remote Start | yes (L433) |
| command_name_REMOTE_STEERING_WHEEL_HEATER_REQUEST | Steering Wheel Heat | yes (L434) |
| command_name_REMOVECHARGESCHEDULEACTION | Remove charging schedule | no |
| command_name_REMOVEPRECONDITIONSCHEDULEACTION | Remove precondition schedule | no |
| command_name_RESET_VALET_PIN | Set Valet PIN | yes (L435) |
| command_name_SCHEDULE_SOFTWARE_UPDATE | Schedule Software Update | yes (L436) |
| command_name_SEND_GPS_DESTINATION_TO_VEHICLE | Send Destination to Vehicle | no |
| command_name_SEND_GPS_TO_VEHICLE | Send Destination to Vehicle | no |
| command_name_SEND_SC_TO_VEHICLE | Send to Vehicle | no |
| command_name_SEND_TO_VEHICLE | Send to Vehicle | no |
| command_name_SEND_WAYPOINTS_TO_VEHICLE | Send Waypoints to Vehicle | no |
| command_name_SENTRY_MODE_ACTIVATE | Activate Sentry Mode | no |
| command_name_SENTRY_MODE_DEACTIVATE | Deactivate Sentry Mode | no |
| command_name_SETCOPTEMPACTION | Set Cabin Overheat Temperature | no |
| command_name_SETDISCHARGELIMITACTION | Set discharge limit | no |
| command_name_SETDISTANCEUNITACTION | Set distance unit | no |
| command_name_SETENERGYDISPLAYFORMATACTION | Set energy display format | no |
| command_name_SETFRONTZONELIGHTREQUESTACTION | Set front zone light brightness | no |
| command_name_SETKEEPACCESSORYPOWERMODEACTION | Set keep accessory power mode | no |
| command_name_SETLIGHTBARBRIGHTNESSACTION | Set Light Bar brightness | no |
| command_name_SETLIGHTBARDITCHACTION | Set Light Bar ditch on or off | no |
| command_name_SETLIGHTBARMIDDLEACTION | Set Light Bar middle on or off | no |
| command_name_SETLOWPOWERMODEACTION | Set low power mode | no |
| command_name_SETOUTLETSOCLIMITACTION | Set Power Outlets discharge limit | no |
| command_name_SETOUTLETSONOFFACTION | Set Power Outlets on or off | no |
| command_name_SETOUTLETTIMERACTION | Set Power Outlets timer | no |
| command_name_SETPOWERFEEDONOFFACTION | Set power feed on or off | no |
| command_name_SETPOWERFEEDSOCLIMITACTION | Set power feed discharge limit | no |
| command_name_SETPOWERFEEDTIMERACTION | Set power feed timer | no |
| command_name_SETPOWERSHAREDISCHARGELIMITACTION | Set Powershare limit | no |
| command_name_SETPOWERSHAREFEATUREACTION | Set Powershare feature on or off | no |
| command_name_SETPOWERSHAREREQUESTACTION | Set Powershare session on or off | no |
| command_name_SETREARZONELIGHTREQUESTACTION | Set rear zone light brightness | no |
| command_name_SETSUSPENSIONLEVELACTION | Set suspension level | no |
| command_name_SETTEMPERATUREUNITACTION | Set temperature unit | no |
| command_name_SETTENTMODEREQUESTACTION | Set CyberTent Mode on or off | no |
| command_name_SETTIMEDISPLAYFORMATACTION | Set time display format | no |
| command_name_SETTIREPRESSUREUNITACTION | Set tire pressure unit | no |
| command_name_SETTRAILERLIGHTTESTSTARTACTION | Start trailer light test | no |
| command_name_SETTRAILERLIGHTTESTSTOPACTION | Stop trailer light test | no |
| command_name_SETTRUCKBEDLIGHTAUTOSTATEACTION | Set bed lights power state | no |
| command_name_SETTRUCKBEDLIGHTBRIGHTNESSACTION | Set bed lights brightness | no |
| command_name_SET_CABIN_OVERHEAT_PROTECTION | Cabin Overheat Protection | yes (L437) |
| command_name_SET_CLIMATE_KEEPER_MODE | Set Climate Keeper | yes (L438) |
| command_name_SET_VEHICLE_NAME | Set vehicle name | yes (L439) |
| command_name_SPEED_LIMIT_ACTIVATE | Activate Speed Limit Mode | yes (L440) |
| command_name_SPEED_LIMIT_CLEAR_PIN | Clear PIN | yes (L441) |
| command_name_SPEED_LIMIT_DEACTIVATE | Deactivate Speed Limit Mode | yes (L442) |
| command_name_SPEED_LIMIT_SET_LIMIT | Set Limit | yes (L443) |
| command_name_STARTLIGHTSHOWACTION | Schedule Light Show | no |
| command_name_START_CHARGE | Start Charging | yes (L444) |
| command_name_START_POWERSHARE | Start Powershare | no |
| command_name_STOPLIGHTSHOWACTION | Stop Light Show | no |
| command_name_STOP_CHARGE | Stop Charging | yes (L445) |
| command_name_STOP_POWERSHARE | Stop Powershare | no |
| command_name_STWHEATLEVELACTION | Steering Wheel Heat Levels | no |
| command_name_TRIGGER_HOMELINK | HomeLink | yes (L446) |
| command_name_UNLOCK | Unlock | yes (L447) |
| command_name_UPDATE_ADDRESS | Update Address | no |
| command_name_UPDATE_PAYMENT | Update Payment | no |
| command_name_VALET_MODE_ACTIVATE | Activate Valet Mode | no |
| command_name_VALET_MODE_DEACTIVATE | Deactivate Valet Mode | no |
| command_name_VEHICLECONTROLRESETPINTODRIVEACTION | Reset PIN for PIN to Drive | no |
| command_name_VEHICLECONTROLSETPINTODRIVEACTION | Set PIN to Drive | no |
| command_name_WINDOW_CONTROL | Window Control | yes (L448) |

(strings.xml also has `command_name_WINDOW_CONTROL`="Window Control" etc.; the "yes" column marks the 31 native duplicates.
Native list is at strings.xml L418–448.)

---

## 2. Failure BODY catalogue — THE KEY DELIVERABLE

The `builder` resolves the body by mapping the command result's status/error into an i18n key, then `tr(key)` against the
inline catalog, storing the result in property `localizedCommandError`. Two tiers of body exist: **(A) transport/session-level
generic bodies** (timeout, connection, auth, network) and **(B) command-specific precondition bodies** (~195 keys).

### 2A. Transport / generic bodies (the highest-value rows)

All values from catalog (bundle.hasm L1140421) unless noted. These are the bodies shown when a command fails for reasons
other than a vehicle-state precondition.

| Error condition | Key | Exact English body | Source |
|---|---|---|---|
| **Timeout** (deadline exceeded; the observed field case) | `command_error_timeout` | `Command timeout, please try again.` | catalog L1140421; selected in builder L4394970 |
| Generic / unmapped failure (fallback body) | `command_error_GENERIC_` | `Command failed` | catalog L1140421 |
| Unexpected / internal error | `command_error_unexpected` | `An unexpected error occurred, please try again.` | catalog L1140421; builder ref |
| Vehicle connection lost | `vehicle_error_connection_error` | `Vehicle Connection Error` | catalog; builder ref |
| Network request failed | `vehicle_error_network_request_error` | `Check internet connection` | catalog; builder ref |
| Timeout (network layer) | `vehicle_error_timeout_error` | `Check Internet Connection` | catalog |
| Not authorised / session expired | `vehicle_error_unauthorized` | `Session Expired` | catalog |
| Insufficient privileges (key perms) | `vehicle_error_insufficient_privileges` | `Unpair your phone key and pair it again to retry.` | catalog; builder ref |
| Mobile access disabled on car | `vehicle_error_mobile_access_disabled` | `Mobile Access Disabled` | catalog; builder ref |
| App not in vehicle whitelist (phone key) | `vehicle_error_not_in_whitelist` | `Set up Phone Key and try again.` | catalog; builder ref |
| Not in whitelist (QR/device path) | `vehicle_error_not_in_whitelist_qr` | `Authorize mobile device and try again.` | catalog; builder ref |
| Server error (car server) | `vehicle_error_car_server_error` | `Vehicle Server Error` | catalog |
| Server error (generic) | `vehicle_error_server_error` | `Server Error` | catalog |
| Server maintenance | `vehicle_error_server_maintenance` | `Server Maintenance` | catalog |
| App too old for command | `vehicle_error_update_and_try_again` | `Please update app and try again` | catalog |
| Unknown | `vehicle_error_unknown_error` | `Unknown Error` | catalog |
| Command title (all failures) | `command_error_command_failed` | `{{command}} failed` | catalog |

**Status-code → key mapping.** The builder inspects a gRPC/Carserver-style status string and branches. Codes observed as
string literals in the builder region (bundle.hasm L4393900–4395450): `deadline_exceeded`, `failed_precondition`,
`permission_denied`, `unauthenticated`, `not_supported`, `internal_error`, `initializing`, `could_not_wake_buses`,
`pre_delivery`, and dash-forms `no-network`, `mobile-access-disabled`, `insufficient-privileges`, `not-in-whitelist`,
`signed-commands-required`, `pre-condition`. The failure *type* enum drives selection — e.g. a `vehicleCommandFailure`
of type `Timeout` (LoadConstString `'Timeout'`, builder L~4394945) routes to `command_error_timeout`. **INFERRED (mapping
detail):** exact code→key pairs for every branch were not each traced; the timeout branch (`Timeout` → `command_error_timeout`)
and the generic fallbacks (`command_error_GENERIC_` / `command_error_unexpected`) are directly confirmed. The `vehicle_error_*`
family is loaded in the same builder for the auth/network/whitelist/mobile-access branches.

There is **no distinct "vehicle asleep" body in the command-failure path.** `command_error_*` has no `asleep`/`offline` key.
Sleep is handled upstream by a wake step (`vehicle_ops_enable_summon_wake_failed`="Unable to wake up vehicle",
`autopark_summon_error_wake_up_timeout`="System wake timed out"), not by the command failure card. **INFERRED.**
There is **no "rate limited" body** in the command-failure path (rate-limit strings in the bundle are HTTP/Sentry headers
and energy-product copy, not vehicle-command UI).

### 2B. Command-specific precondition bodies (full table, ~195 keys)

All from catalog bundle.hasm L1140421. These are the bodies shown for `failed_precondition`-class results; the failing
command's specific condition selects the key. Verbatim (`\n` = literal newline in the string):

| Key | English body |
|---|---|
| command_error_ACTUATE_TAILGATE_invalid_value | Unsupported tailgate command |
| command_error_ACTUATE_TRUNK_invalid_value | Unsupported trunk command |
| command_error_ACTUATE_TRUNK_not_parked | Vehicle must be in Park (P) first |
| command_error_AUTOSTWHEATACTION_not_supported | Auto Steering Wheel Heat not supported |
| command_error_BOOMBOXACTION_remote_boombox_failed | Eat more beans |
| command_error_CAMP_MODE_ON_cpd_enabled_low_soc_override_message | Battery is low and Child Left Alone Detection is active. Enabling Camp Mode will consume energy and disable Child Left Alone Detection. Continue? |
| command_error_CAMP_MODE_ON_cpd_enabled_override_message | Child Left Alone Detection is active and enabling Camp Mode will disable it. Continue? |
| command_error_CAMP_MODE_ON_low_power_mode_override_message | Low Power Mode is on and enabling Camp Mode will consume energy. Continue? |
| command_error_CAMP_MODE_ON_low_soc_override_message | Battery is low and enabling Camp Mode will consume energy. Continue? |
| command_error_CANCEL_SOFTWARE_UPDATE_already_installing | A software update is already installing |
| command_error_CANCEL_SOFTWARE_UPDATE_no_update_scheduled | No software update is scheduled |
| command_error_CANNOT_TURN_BUSES_ON | An unexpected error occurred. Your vehicle may not be able to execute this command. |
| command_error_CHANGE_SUNROOF_STATE_acc_off | Unable to close sunroof. Please try again later. |
| command_error_CHANGE_SUNROOF_STATE_calibrating | Roof calibration in progress. Please try again later. |
| command_error_CHANGE_SUNROOF_STATE_not_supported | Sunroof not supported by vehicle |
| command_error_CHARGE_PORT_DOOR_CLOSE_cable_connected | Failed to close Charge Port.\nA cable is connected. |
| command_error_CHARGE_PORT_DOOR_CLOSE_non_motorized_charge_port | Failed to close Charge Port.\nCharge Port is non-motorized. |
| command_error_CHARGE_PORT_DOOR_OPEN_car_wash | Failed to open Charge Port.\nCar wash in progress. |
| command_error_CHARGE_PORT_DOOR_OPEN_charging | Failed to open Charge Port.\nCharging in progress. |
| command_error_CHARGING_AMPS_charging_amps_out_of_bounds | Charge current too high. |
| command_error_CLIMATE_OFF_camp_mode | Cannot turn off climate when Camp Mode is active |
| command_error_CLIMATE_OFF_climate_keeper | Cannot turn off climate when Climate Keeper is active |
| command_error_CLIMATE_OFF_cpd_active | Cannot turn off climate when Child Left Alone Detection is active |
| command_error_CLIMATE_OFF_dog_mode | Cannot turn off climate when Pet Mode is active |
| command_error_CLIMATE_OFF_pet_mode | Cannot turn off climate when Pet Mode is active |
| command_error_CLIMATE_ON_cpd_active | Climate failed to start.\nClimate is unavailable when Child Left Alone Detection is active. |
| command_error_CLIMATE_ON_door_open | Climate failed to start.\nOne or more doors are open. |
| command_error_CLIMATE_ON_door_open_low_soc_override_message | Battery is low and one or more doors are open. Enabling climate control will consume energy. Continue? |
| command_error_CLIMATE_ON_door_open_override_message | One or more doors are open. Do you still want to enable climate control? |
| command_error_CLIMATE_ON_hvac_fault | Climate failed to start.\nClimate is currently unavailable due to system faults. |
| command_error_CLIMATE_ON_loc_soc | Your vehicle has insufficient charge.\nClimate control will be disabled to conserve energy. |
| command_error_CLIMATE_ON_low_power_mode | Low Power Mode is on.\nClimate control has been disabled to conserve energy. |
| command_error_CLIMATE_ON_low_power_mode_override_message | Low Power Mode is on and enabling climate control will consume energy. Continue? |
| command_error_CLIMATE_ON_low_soc | Your vehicle has insufficient charge.\nClimate control has been disabled to conserve energy. |
| command_error_CLIMATE_ON_low_soc_override_message | Battery is low and enabling climate control will consume energy. Continue? |
| command_error_FLASH_LIGHTS_ingear | Failed to flash lights. Vehicle is not in Park (P). |
| command_error_HONK_HORN_ingear | Failed to honk horn. Vehicle is not in Park (P). |
| command_error_HVAC_BIOWEAPON_MODE_climate_keeper_mode_on_pet | Cannot switch on Bioweapon Defense Mode when Climate Keeper, Pet Mode or Camp Mode is active. |
| command_error_LIGHT_BAR_CONTROL_not_in_tent_or_off_road_mode | Vehicle must be in CyberTent Mode or Off Road Mode to change Light Bar brightness |
| command_error_LOCK_doors_open | Failed to lock vehicle. One or more doors are open. |
| command_error_MAX_DEFROST_cpd_active | Climate controls are disabled when Child Left Alone Detection is active |
| command_error_MAX_DEFROST_door_open | Climate failed to start.\nOne or more doors are open. |
| command_error_MAX_DEFROST_low_power_mode | Low Power Mode is on.\nClimate control has been disabled to conserve energy. |
| command_error_MAX_DEFROST_low_soc | Your vehicle has insufficient charge.\nClimate control has been disabled to conserve energy. |
| command_error_MAX_DEFROST_pet_mode | Defrost {{category_name}} cannot be started while Pet Mode is enabled. Please disable Pet Mode and try again. |
| command_error_MEDIA_PREVIOUS_TRACK_remote_media_control_disabled | Go to your audio settings and enable Allow Mobile Control to use this feature |
| command_error_OPEN_FRUNK_too_far_from_vehicle | Failed to open frunk. Please move closer to your vehicle. |
| command_error_PARENTAL_CONTROLS_ACTIVATE_not_in_park | Parental Controls can only be activated while your vehicle is in Park (P) |
| command_error_PARENTAL_CONTROLS_CLEAR_PIN_not_in_park | Failed to clear PIN. Vehicle must be in Park (P). |
| command_error_PARENTAL_CONTROLS_CLEAR_PIN_parental_controls_active | To clear the PIN, you must first turn off Parental Controls |
| command_error_PARENTAL_CONTROLS_DEACTIVATE_not_in_park | Parental Controls can only be deactivated while your vehicle is in Park (P) |
| command_error_PARENTAL_CONTROLS_ENABLE_SETTING_not_in_park | Parental Controls settings can only be changed while your vehicle is in Park (P) |
| command_error_PARENTAL_CONTROLS_ENABLE_SETTING_parental_controls_active | To change Parental Controls settings, you must first turn off Parental Controls |
| command_error_PARENTAL_CONTROLS_SET_LIMIT_invalid_limit | Please select a valid speed limit |
| command_error_PARENTAL_CONTROLS_SET_LIMIT_parental_controls_active | To change the speed limit, you must first turn off Parental Controls |
| command_error_PET_MODE_ON_cpd_enabled_low_soc_override_message | Battery is low and Child Left Alone Detection is active. Enabling Pet Mode will consume energy and disable Child Left Alone Detection. Continue? |
| command_error_PET_MODE_ON_cpd_enabled_override_message | Child Left Alone Detection is active and enabling Pet Mode will disable it. Continue? |
| command_error_PET_MODE_ON_low_power_mode_override_message | Low Power Mode is on and enabling Pet Mode will consume energy. Continue? |
| command_error_PET_MODE_ON_low_soc_override_message | Battery is low and enabling Pet Mode will consume energy. Continue? |
| command_error_POWERFEED_generic_error | Failed to update power feed. |
| command_error_POWERSHARE_generic_error | Failed to update Powershare. |
| command_error_PRE_DELIVERY | Command will be enabled after delivery is accepted |
| command_error_REMOTE_AUTO_SEAT_CLIMATE_REQUEST_HVAC_is_in_override_mode | Auto seat only available when HVAC in AUTO |
| command_error_REMOTE_AUTO_SEAT_CLIMATE_REQUEST_not_supported | Auto seat climate not supported by vehicle. |
| command_error_REMOTE_CLIMATE_SETTINGS_NOT_ENABLED | Cannot command climate settings with climate off. |
| command_error_REMOTE_SEAT_COOLING_REQUEST_not_supported | Seat cooling not supported by vehicle. |
| command_error_REMOTE_SEAT_COOLING_REQUEST_not_yet_supported | Seat cooling not supported by vehicle. |
| command_error_REMOTE_SEAT_HEATER_REQUEST_climate_off | Seat heater failed to turn on.\nTry again with climate on. |
| command_error_REMOTE_SEAT_HEATER_REQUEST_door_open | Seat heater failed to turn on.\nOne or more doors are open. |
| command_error_REMOTE_SEAT_HEATER_REQUEST_invalid_seat | Seat heater failed to turn on.\nInvalid seat selected. |
| command_error_REMOTE_SEAT_HEATER_REQUEST_low_power_mode | Low Power Mode is on.\nRemote seat heater control has been disabled to conserve energy. |
| command_error_REMOTE_SEAT_HEATER_REQUEST_low_soc | Your vehicle has insufficient charge.\nRemote seat heater control has been disabled to conserve energy. |
| command_error_REMOTE_SEAT_HEATER_REQUEST_not_supported | Seat heater not supported by vehicle. |
| command_error_REMOTE_START_not_enabled | Remote Start is not enabled on your vehicle. |
| command_error_REMOTE_START_remote_start_disabled | Keyless Driving is not enabled on this vehicle |
| command_error_REMOTE_START_unauthorized | Failed to enable Keyless Driving.\nPlease sign out of the app, sign back in and try again. |
| command_error_REMOTE_STEERING_WHEEL_HEATER_REQUEST_climate_off | Steering wheel heater failed to turn on.\nTry again with climate on. |
| command_error_REMOTE_STEERING_WHEEL_HEATER_REQUEST_door_open | Steering wheel heater failed to turn on.\nOne or more doors are open. |
| command_error_REMOTE_STEERING_WHEEL_HEATER_REQUEST_low_power_mode | Low Power Mode is on.\nRemote steering wheel heater control has been disabled to conserve energy. |
| command_error_REMOTE_STEERING_WHEEL_HEATER_REQUEST_low_soc | Your vehicle has insufficient charge.\nRemote steering wheel heater control has been disabled to conserve energy. |
| command_error_REMOTE_STEERING_WHEEL_HEATER_REQUEST_not_supported | Steering wheel heater not supported by vehicle |
| command_error_RESET_VALET_PIN_valet_mode_on | Failed to reset Valet Mode Pin.\nValet Mode enabled. |
| command_error_SCHEDULELIGHTSHOW_doors_open | Close all doors to schedule Light Show |
| command_error_SCHEDULELIGHTSHOW_frunk_open | Close frunk to schedule Light Show |
| command_error_SCHEDULELIGHTSHOW_hazards_on | Turn off hazards to schedule Light Show |
| command_error_SCHEDULELIGHTSHOW_locked | Unlock vehicle to schedule Light Show with Dance Moves |
| command_error_SCHEDULELIGHTSHOW_not_in_idle | A Light Show has already been scheduled |
| command_error_SCHEDULELIGHTSHOW_not_in_park | Vehicle must be in Park (P) to schedule Light Show |
| command_error_SCHEDULELIGHTSHOW_pet_mode | Turn off Pet Mode to schedule Light Show |
| command_error_SCHEDULELIGHTSHOW_sentry | Turn off Sentry Mode to schedule Light Show |
| command_error_SCHEDULELIGHTSHOW_trunk_open | Close trunk to schedule Light Show |
| command_error_SCHEDULELIGHTSHOW_unsupported | Light Show not supported |
| command_error_SCHEDULELIGHTSHOW_user_present | Exit the vehicle to schedule Light Show |
| command_error_SCHEDULELIGHTSHOW_valet_mode | Turn off valet mode to schedule Light Show |
| command_error_SCHEDULELIGHTSHOW_vehicle_not_idle | Light Show unavailable, please try again |
| command_error_SCHEDULE_SOFTWARE_UPDATE_already_installing | A software update is already installing |
| command_error_SCHEDULE_SOFTWARE_UPDATE_climate_keeper | Please disable Climate Keeper before starting software update |
| command_error_SCHEDULE_SOFTWARE_UPDATE_connected_to_fast_charger | Please disconnect from fast charger before starting software update |
| command_error_SCHEDULE_SOFTWARE_UPDATE_connected_to_supercharger | Please disconnect from Supercharger before starting software update |
| command_error_SCHEDULE_SOFTWARE_UPDATE_cpd_active | Unable to start software update while a child is detected in your vehicle |
| command_error_SCHEDULE_SOFTWARE_UPDATE_falcon_door_open | Please close Falcon Wing doors before starting software update |
| command_error_SCHEDULE_SOFTWARE_UPDATE_game_mode | Please exit any running games to start software update |
| command_error_SCHEDULE_SOFTWARE_UPDATE_insufficient_charge | Vehicle has insufficient charge to start software update |
| command_error_SCHEDULE_SOFTWARE_UPDATE_not_in_park | Vehicle must be in Park (P) to start software update |
| command_error_SCHEDULE_SOFTWARE_UPDATE_sentry_mode | Please disable Sentry Mode before starting software update |
| command_error_SCHEDULE_SOFTWARE_UPDATE_theater_mode | Please exit Tesla Theater to start software update |
| command_error_SCHEDULE_SOFTWARE_UPDATE_update_failure_popup | Unable to start software update, please try again from the vehicle infotainment screen |
| command_error_SCHEDULE_SOFTWARE_UPDATE_update_not_available | No software update is available |
| command_error_SEND_TO_VEHICLE_src_not_supported | Please send a valid video link |
| command_error_SEND_TO_VEHICLE_url_redirect_detected_error | Please send a valid video link |
| command_error_SETCOPTEMPACTION_not_supported | Setting Cabin Overheat Temperature not supported |
| command_error_SETOUTLETSONOFFACTION_low_power_mode | Low Power Mode is on.\nPower outlets have been disabled to conserve energy. |
| command_error_SETOUTLETSONOFFACTION_soc_too_low | Your vehicle has insufficient charge.\nPower outlets have been disabled to conserve energy. |
| command_error_SETOUTLETS_generic_error | Failed to update outlets. |
| command_error_SETSUSPENSIONLEVEL_baja_mode_active | Leveling disabled while in Baja mode |
| command_error_SETSUSPENSIONLEVEL_charging_cable_connected | Leveling disabled while charging cable is connected |
| command_error_SETSUSPENSIONLEVEL_disabled | Leveling disabled |
| command_error_SETSUSPENSIONLEVEL_doors_open | Lowering disabled in Off-Road while doors are open |
| command_error_SETSUSPENSIONLEVEL_jack_mode_active | Leveling disabled while in Jack Mode - open Controls > Service or drive above 5 mph (8 km/h) to disable Jack Mode |
| command_error_SETSUSPENSIONLEVEL_showroom_mode_active | Leveling disabled while in Showroom Mode |
| command_error_SETSUSPENSIONLEVEL_system_check_in_progress | Leveling disabled, system check in progress |
| command_error_SETSUSPENSIONLEVEL_system_check_required | Leveling disabled, system check required - press brake to begin |
| command_error_SETSUSPENSIONLEVEL_transport_mode_active | Leveling disabled while in Transport Mode |
| command_error_SETTRUCKBEDLIGHTAUTOSTATEACTION_in_driving_gear | Vehicle must be in Park (P) to change bed lights AUTO mode |
| command_error_SET_CLIMATE_KEEPER_MODE_cpd_enabled | Climate Keeper cannot be enabled until permission is granted to disable Child Left Alone Detection. |
| command_error_SET_CLIMATE_KEEPER_MODE_feature_not_enabled | Climate Keeper not enabled |
| command_error_SET_CLIMATE_KEEPER_MODE_hvac_fault | Climate Keeper not available.\nClimate Keeper is currently unavailable due to system faults. |
| command_error_SET_CLIMATE_KEEPER_MODE_low_power_mode | Low Power Mode is on.\nClimate control has been disabled to conserve energy. |
| command_error_SET_CLIMATE_KEEPER_MODE_low_soc | Your vehicle has insufficient charge.\nClimate control has been disabled to conserve energy. |
| command_error_SET_CLIMATE_KEEPER_MODE_not_available | Climate Keeper not available |
| command_error_SET_CLIMATE_KEEPER_MODE_not_in_park | Vehicle must be in Park (P) to enable Climate Keeper. |
| command_error_SET_CLIMATE_KEEPER_MODE_not_supported | Climate Keeper not supported |
| command_error_SET_CLIMATE_KEEPER_MODE_showroom_mode | Climate Keeper cannot be enabled while vehicle is in showroom mode. |
| command_error_SET_CLIMATE_KEEPER_MODE_transport_mode | Climate Keeper cannot be enabled while vehicle is in transport mode. |
| command_error_SET_CLIMATE_KEEPER_MODE_very_low_soc | Your vehicle has insufficient charge.\nClimate control has been disabled to conserve energy. |
| command_error_SET_PET_MODE_cabin_too_hot | Pet Mode unavailable\nThe cabin is too hot to enable Pet Mode. Please wait and try again after the cabin cools down. |
| command_error_SET_PET_MODE_initializing | Pet Mode initializing\nPet Mode is initializing, please wait and try again. |
| command_error_SET_PET_MODE_invalid | Pet Mode unavailable\nPet Mode is currently unavailable due to system faults. |
| command_error_SET_SENTRY_MODE_factory_mode | Sentry Mode cannot be enabled while vehicle is in factory mode |
| command_error_SET_SENTRY_MODE_game_mode | Sentry Mode cannot be enabled while vehicle is in game mode |
| command_error_SET_SENTRY_MODE_low_power_mode | Sentry Mode cannot be enabled while vehicle is in Low Power Mode |
| command_error_SET_SENTRY_MODE_low_soc | Vehicle does not have sufficient charge to enable Sentry Mode. |
| command_error_SET_SENTRY_MODE_not_parked | Vehicle must be in Park (P) to enable Sentry Mode. |
| command_error_SET_SENTRY_MODE_not_supported | Sentry Mode not supported by vehicle |
| command_error_SET_SENTRY_MODE_party | Sentry Mode cannot be enabled while vehicle is in Camp Mode |
| command_error_SET_SENTRY_MODE_pet_mode | Sentry Mode cannot be enabled while vehicle is in Pet Mode |
| command_error_SET_SENTRY_MODE_showroom_mode | Sentry Mode cannot be enabled while vehicle is in showroom mode. |
| command_error_SET_SENTRY_MODE_theater_mode | Sentry Mode cannot be enabled while vehicle is in theater mode |
| command_error_SET_SENTRY_MODE_transport_mode | Sentry Mode cannot be enabled while vehicle is in transport mode |
| command_error_SET_SENTRY_MODE_updating | Sentry Mode cannot be enabled while vehicle is updating |
| command_error_SET_SENTRY_MODE_valet_mode | Sentry Mode cannot be enabled while vehicle is in Valet Mode. |
| command_error_SET_TEMPERATURE_cpd_active | Climate controls are disabled when Child Left Alone Detection is active |
| command_error_SET_VALET_MODE_ON_invalid_password | Failed to enable Valet Mode.\nInvalid password. |
| command_error_SET_VALET_MODE_ON_not_in_park | Failed to enable Valet Mode. Vehicle must be in Park (P). |
| command_error_SET_VEHICLE_NAME_not_supported | Setting vehicle name not supported by vehicle |
| command_error_SPEED_LIMIT_ACTIVATE_incorrect_pin | The PIN you entered was incorrect |
| command_error_SPEED_LIMIT_ACTIVATE_no_pin_set | Please enter a valid, numeric PIN |
| command_error_SPEED_LIMIT_ACTIVATE_not_in_park | Speed Limit Mode can only be activated while your vehicle is in Park (P) |
| command_error_SPEED_LIMIT_CLEAR_PIN_incorrect_pin | The PIN you entered was incorrect |
| command_error_SPEED_LIMIT_CLEAR_PIN_speed_limit_mode_active | To clear the PIN, you must first turn off Speed Limit Mode |
| command_error_SPEED_LIMIT_DEACTIVATE_incorrect_pin | The PIN you entered was incorrect |
| command_error_SPEED_LIMIT_DEACTIVATE_not_in_park | Speed Limit Mode can only be deactivated while your vehicle is in Park (P) |
| command_error_SPEED_LIMIT_SET_LIMIT_invalid_limit | Please select a valid speed limit |
| command_error_SPEED_LIMIT_SET_LIMIT_not_in_park | Speed Limit can only be set while your vehicle is in Park (P) |
| command_error_SPEED_LIMIT_SET_LIMIT_speed_limit_mode_active | To change the speed limit, you must first turn off Speed Limit Mode |
| command_error_START_CHARGE_check_vehicle | Failed to start charging.\nPlease check your vehicle for details. |
| command_error_START_CHARGE_complete | Failed to start charging.\nCharging is already complete. |
| command_error_START_CHARGE_disconnected | Failed to start charging.\nCharger disconnected. |
| command_error_START_CHARGE_is_charging | Failed to start charging.\nCharging in progress. |
| command_error_START_CHARGE_no_power | Failed to start charging.\nCharger has no power. |
| command_error_STWHEATLEVELACTION_not_supported | Steering Wheel Heat Levels not supported |
| command_error_TENT_MODE_LIGHT_CONTROL_not_in_park | Vehicle must be in Park (P) to change light zone |
| command_error_TENT_MODE_LIGHT_CONTROL_not_in_tent_mode | Vehicle must be in CyberTent Mode to change light zone |
| command_error_TENT_MODE_ON_not_in_park | Vehicle must be in Park (P) to turn on CyberTent Mode |
| command_error_TRAILERLIGHTTESTSTART_generic_error | Failed to start trailer light test. |
| command_error_TRAILERLIGHTTESTSTART_trailer_mode_disabled | Trailer Mode must be ON to run trailer light test. |
| command_error_TRAILERLIGHTTESTSTOP_generic_error | Failed to stop trailer light test. |
| command_error_TRIGGER_HOMELINK_no_homelink_nearby | There are no HomeLink-enabled garage doors near your vehicle |
| command_error_TRIGGER_HOMELINK_not_supported | HomeLink not supported by vehicle |
| command_error_TRIGGER_HOMELINK_too_far_from_vehicle | Please move closer to your vehicle |
| command_error_TRIGGER_HOMELINK_unavailable | HomeLink control from the mobile app is not available on your vehicle |
| command_error_VEHICLECONTROLRESETPINTODRIVEACTION_PIN_to_Drive_is_on | Failed to reset Drive PIN.\nPIN to Drive enabled. |
| command_error_VEHICLECONTROLRESETPINTODRIVEACTION_Valet_mode_is_on | Failed to reset Drive PIN.\nValet Mode enabled. |
| command_error_VEHICLECONTROLSETPINTODRIVEACTION_Valet_mode_is_on | Failed to enable PIN to Drive.\nPIN to Drive already on. |
| command_error_WINDOW_CONTROL_feature_not_supported | Window commands not supported |
| command_error_WINDOW_CONTROL_not_in_park | Vehicle must be in Park (P) to use window commands |
| command_error_WINDOW_CONTROL_too_far_from_vehicle | Please move closer to your vehicle |
| command_error_WINDOW_CONTROL_unsupported_command | Unsupported window command |
| command_error_WINDOW_CONTROL_vehicle_location_invalid | Could not verify vehicle location |

(Note: the bundle `command_error_*` **key** list contains ~14 additional keys that have no value in the EN catalog
— e.g. `command_error_ACTUATE_TAILGATE`-adjacent variants, `command_error_MEDIA_PREVIOUS_TRACK_user_not_present`,
`command_error_SETSUSPENSIONLEVEL_system_check_required` is present above but a few `_not_supported`/`_generic_error`
siblings referenced as keys resolve to the same shared strings. The table above is every `command_error_*` that has a
distinct EN value in catalog L1140421.)

---

## 3. Card BEHAVIOUR

| Property | Finding | Evidence |
|---|---|---|
| Surface | A dismissable **error card** pushed via `Actions.put(setErrorData(...))` with title+body | builder region, `setErrorData`/`Actions.put`, bundle.hasm L4393900–4395450 |
| Auto-dismiss duration | **`ERROR_CARD_TIMEOUT` = 7000 ms (7 s)** | `LoadConstInt: 7000` then `PutById ERROR_CARD_TIMEOUT`, bundle.hasm **L1516214–1516228** (function #31920). Read into the card at builder L~4394940+ |
| Manual retry button on card | **No retry button is attached in the builder** — the only retry logic is *automatic* (telemetry keys `retry_attempt`, `retry_delay_ms`, `retry_result`, `retry_success`, `retry_response_string`). Generic label `button_retry`="Retry" exists but is used by other flows (phone-key pairing, energy setup), not the command-failure card. **INFERRED (absence of evidence in builder).** | builder region strings; `button_retry` catalog L1140421 |
| `vehicle_command_retry` | **Telemetry/enum, not UI.** Present as bundle String `'vehicle_command_retry'` (all_strings L168831) and Identifier `VEHICLE_COMMAND_RETRY` (L51473); **no** catalog value → never rendered. It names the automatic client-side retry that runs *before* the failure card is shown. **INFERRED (role).** | all_strings L168831/L51473; absent from catalog |
| Tappable | **INFERRED**: not determinable from disassembly; no `onPress`/navigation wired to the error card in the builder region examined. |
| Enum states | `CommandResult` status enum: `COMMAND_FAILED`, `COMMAND_SUCCESSFUL`, `COMMAND_TIMED_OUT`, plus `COMMAND_TIMEOUT_ERROR_PREFIX`, `HERMES_COMMAND_TIMEOUT` / `'Hermes - Command Timeout'` (BLE/Hermes transport timeout label, likely log/telemetry). | all_strings L15564–15572, L26588, L26951; COMMAND_TIMEOUT_ERROR_PREFIX code refs bundle.hasm L2294716, L7618181, L8124171 |

### Native background/push failure (separate surface — not the in-app card)
| Key | Value | Source |
|---|---|---|
| background_task_failed_default_title | Unable to Complete Command | strings.xml L198; also catalog L1140421 |
| background_task_failed_default_body | Open the Tesla App to complete your request. | strings.xml L197; also catalog L1140421 |
| push_notif_command_failed_title | Failed | strings.xml L1473 (native only; not in catalog) |
| push_notif_command_failed_body | Something went wrong. Tap to open the app to retry | strings.xml L1474 (native only) |

---

## 4. TONE / STRUCTURE of failure copy

Observed conventions across the catalogue (all from catalog L1140421):

- **Title**: `<Command display name> failed` — sentence-initial cap on the command name only, lowercase `failed`, **no
  trailing period** (`{{command}} failed`).
- **Body case**: Sentence case. Feature/mode proper nouns are Title-Cased ("Climate Keeper", "Sentry Mode", "Park (P)",
  "Low Power Mode", "Child Left Alone Detection").
- **Trailing period**: Inconsistent. Full-sentence bodies usually end with a period (`Command timeout, please try again.`,
  `An unexpected error occurred, please try again.`). Short imperative/label bodies usually **omit** it
  (`Command failed`, `Session Expired`, `Check internet connection`, `Vehicle must be in Park (P) first`).
- **Two-line pattern**: Many bodies use a literal `\n` to split a summary line from a reason line, e.g.
  `Failed to start charging.\nCharger disconnected.` (`\n` present in the source string).
- **Length**: Short. Generic bodies 3–7 words; precondition bodies one sentence; only the "override/continue" confirmation
  prompts run longer (they end with `Continue?` / `Do you still want to…?`).
- **Voice**: Direct, imperative remediation ("Set up Phone Key and try again.", "Please move closer to your vehicle",
  "Vehicle must be in Park (P)…"). Two playful Easter-egg strings exist (`Remote Fart`, and the Boombox failure
  `Eat more beans`).

---

## 5. Provenance summary (mechanism)

1. User taps a control → RN dispatches `sendVehicleCommand`. Client may auto-retry (`vehicle_command_retry`, telemetry
   `retry_*`).
2. On terminal failure, the **failure-card builder** (bundle.hasm L4393900–4395450) inspects the `CommandResult`
   status/failure-type (`Timeout`, `failed_precondition`, `permission_denied`, `unauthenticated`, `deadline_exceeded`,
   `no-network`, `mobile-access-disabled`, `not-in-whitelist`, `insufficient-privileges`, …).
3. It builds **title** = `tr('command_error_command_failed', { command: tr('command_name_<TYPE>') })` = `<Name> failed`,
   and **body** = `tr(<selected key>)` (e.g. `command_error_timeout`, a `vehicle_error_*` key, a specific
   `command_error_<CMD>_<reason>` key, or fallback `command_error_GENERIC_` / `command_error_unexpected`).
4. `tr()` resolves against the **inline English RN module** (bundle.hasm L1140421) — 1 of 31 locale modules compiled into
   the Hermes bundle. **Nothing here is server-fetched.**
5. Card is dispatched via `Actions.put(setErrorData(...))` and auto-dismisses after `ERROR_CARD_TIMEOUT` = 7000 ms.

**Sources of truth (files/lines):**
- `base_apktool/res/values/strings.xml` — native: title format L417, command_name L418–448, background/push L197–198/L1473–1474.
- `bundle.hasm` L1140421 — inline EN i18n catalog (all `command_error_*`, `command_name_*`, `vehicle_error_*` bodies).
- `bundle.hasm` L4393900–4395450 — failure-card builder (selection logic + timeout branch confirmation).
- `bundle.hasm` L1516214–1516228 — `ERROR_CARD_TIMEOUT = 7000`.
