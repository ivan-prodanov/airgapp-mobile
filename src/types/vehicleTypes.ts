export type ThemeMode = 'dark' | 'light';

export type CameraMode = 'PARKED' | 'TOP_DOWN' | 'CLIMATE' | 'CHARGING' | 'CLOSURE_OPEN';
// Current line-up + their pre-facelift "(older)" counterparts. The older trims render the same 3D body
// (we only ship the current Godot assets) but carry reduced climate_capabilities — older cars lacked
// ventilated seats, auto seat climate, and (earliest cars) a heated wheel — so they exercise every
// conditional branch in the climate UI.
export type CarModel =
  | 'modelS'
  | 'model3'
  | 'modelX'
  | 'modelY'
  | 'modelSLegacy'
  | 'model3Legacy'
  | 'modelXLegacy'
  | 'modelYLegacy'
  // Model X seat-count variants: 6-seater (captain chairs, no rear centre) and 7-seater (bench),
  // both with a heated 3rd row. They drive the Godot seat config via third_row_seats + rear_seat_type.
  | 'modelX6Seat'
  | 'modelX7Seat';
// Scene lighting preset (mirrors the harness lighting-mode cycle). 'view_relative' is omitted — it
// tracks the live orbit yaw, which is disabled on iOS 26.
export type LightingMode = 'mobile' | 'ambient_fill';
export type SeatPosition =
  | 'frontLeft'
  | 'frontRight'
  | 'rearLeft'
  | 'rearMiddle'
  | 'rearRight'
  | 'thirdRowLeft'
  | 'thirdRowRight';
export type SeatClimateModeName = 'off' | 'heat' | 'cool' | 'auto';
export type SteeringWheelClimateModeName = 'off' | 'heat' | 'auto';

export interface SeatClimateMode {
  mode: SeatClimateModeName;
  level: 0 | 1 | 2 | 3;
  // What AUTO is actually doing right now. Their `getSeatClimateIcon` (@3987850)
  // does not draw a generic "auto" glyph — while the seat is in auto it picks
  // the COOLING icon when the live cooling level is above off, and otherwise the
  // HEATING icon at the live heater level. So the car keeps reporting real
  // levels underneath auto, and the app shows which way it is working.
  //
  // We collapsed auto to { mode: 'auto', level: 0 } and drew one grey glyph for
  // every case, losing that. Null means auto is engaged but idle.
  autoActivity?: 'heat' | 'cool' | null;
}

// The steering-wheel heater mirrors the seats but tops out at level 2 (the real app's 2-1-off ramp)
// and never offers cooling.
export interface SteeringWheelClimate {
  mode: SteeringWheelClimateModeName;
  level: 0 | 1 | 2;
}

export type SeatClimateModes = Record<SeatPosition, SeatClimateMode>;

// Cabin Overheat Protection: the three-way mode and its activation threshold. The threshold is a
// STRING because it is a <Segmented> option key, not an arithmetic value (it is only ever compared
// and rendered). Maps to CarServer ClimateState.cabin_overheat_protection / cop_activation_temp.
export type CabinOverheatMode = 'off' | 'noac' | 'on';
// ONE value, because the car has one field. `ClimateState.climateKeeperMode` is a
// single enum {Unknown, Off, On, Dog, Party} — Camp and Pet are mutually
// exclusive in the vehicle, and Tesla's own screen treats them that way (tapping
// Camp while Pet runs prompts "Enabling Camp Mode will disable Pet Mode").
//
// We modelled them as two independent booleans, which made illegal states
// representable and produced two real bugs: both rows could light at once, and
// turning one OFF emitted an unconditional keeper=off that silently killed the
// other on the car while our UI kept it lit.
//
// 'on' is their plain "Keep Climate On", carried so a car in that mode round-
// trips instead of reading back as Off. Neither row lights for it.
export type ClimateKeeperMode = 'off' | 'on' | 'camp' | 'pet';
export type CabinOverheatTemp = '30' | '35' | '40';

// The car's real position, from the infotainment read's locationState/driveState. heading is the
// car's own compass bearing (which way it's pointing), null when the car doesn't report it.
export interface TirePressures {
  fl: number | null;
  fr: number | null;
  rl: number | null;
  rr: number | null;
  // The car's own placard values (TirePressureState fields 18/19).
  rcpFront: number | null;
  rcpRear: number | null;
  hardWarning: { fl: boolean; fr: boolean; rl: boolean; rr: boolean };
  softWarning: { fl: boolean; fr: boolean; rl: boolean; rr: boolean };
}

// Now playing, assembled from MediaState (15) + MediaDetailState (16). Two
// reads, because the 452-byte inbound cap allows one submessage per request.
export interface MediaNowPlaying {
  // The car's own opinion on whether it will accept transport commands.
  // `undefined` means "not read yet" and must not be treated as false — the
  // difference decides whether the buttons are absent or merely disabled.
  remoteControlEnabled: boolean | undefined;
  title: string | null;
  artist: string | null;
  album: string | null;
  station: string | null;
  // CarServer.MediaPlaybackStatus: 0 Stopped, 1 Playing, 2 Paused.
  playbackStatus: number | undefined;
  // CarServer.MediaSourceType (2 FM, 8 Bluetooth, 12 Spotify, …).
  sourceType: number | undefined;
  sourceName: string | null;
  volume: number | null;
  volumeMax: number | null;
  volumeIncrement: number | null;
  elapsedSec: number | null;
  durationSec: number | null;
}

export interface CarLocation {
  lat: number;
  lon: number;
  heading: number | null;
}

export interface VehicleViewState {
  frunkOpen: boolean;
  trunkOpen: boolean;
  driverFrontDoorOpen: boolean;
  passengerFrontDoorOpen: boolean;
  driverRearDoorOpen: boolean;
  passengerRearDoorOpen: boolean;
  leftFrontWindowOpen: boolean;
  rightFrontWindowOpen: boolean;
  leftRearWindowOpen: boolean;
  rightRearWindowOpen: boolean;
  climateOn: boolean;
  frontDefrostOn: boolean;
  rearDefrostOn: boolean;
  chargePortOpen: boolean;
  cableAttached: boolean;
  charging: boolean;
  locked: boolean;
  sentryEnabled: boolean;
  // Low Power Mode on/off. Optimistic-only — the car has a SET action but reports
  // no readback in our poll (bug 4). No "forced on" 3rd state until a read exists.
  lowPowerMode: boolean;
  // Keep Accessory Power On/off — the Charging page's second settings toggle
  // (CarServer.SetKeepAccessoryPowerModeAction, VehicleAction 138). Optimistic-only
  // for the SAME reason as lowPowerMode: the car accepts the SET but exposes NO
  // readback field over BLE (grep of every vendored proto + telemetry.ts: only the
  // SET action exists, no getVehicleData category carries it), so we cannot poll
  // its true value and it is not cached in carLinkCache. Resets to the default on a
  // cold start, exactly like lowPowerMode above.
  keepAccessoryPower: boolean;
  // Security & Drivers screen toggles (UI state for now; persisted per-vehicle like the rest).
  valetMode: boolean;
  parentalControls: boolean;
  speedLimitMode: boolean;
  pinToDrive: boolean;
  // Per-feature 4-digit PINs — the real Tesla app keeps a SEPARATE PIN for each, not one shared. `null`
  // until that feature's PIN is first set (by enabling it). Every enable AND disable of all four verifies
  // the PIN (first enable sets it); the "Clear PIN" row action removes it. Persisted per-vehicle.
  valetPin: string | null;
  parentalPin: string | null;
  speedLimitPin: string | null;
  pinToDrivePin: string | null;
  // The SHARED speed cap in MPH, used by BOTH Speed Limit Mode and Parental Controls'
  // "Limit Speed" — the car keeps ONE value for both (proven on-car: setting the
  // parental limit also moved Speed Limit Mode's). Stored as the EXACT km/h→mph value
  // so the km/h shown in the "…" panel steps by 1 cleanly (see fleet.ts speed helpers).
  speedLimitMph: number;
  // "Customize Parental Controls" panel sub-options (all non-renderer sheet state).
  // The parental "Limit Speed" VALUE is NOT here — it shares `speedLimitMph` above
  // (one cap on the car). Bug 11.
  parentalLimitSpeed: boolean;
  parentalReduceAccel: boolean;
  parentalRequireSafety: boolean;
  parentalCurfewNotify: boolean;
  // Whether the car is awake (online) vs. asleep. Asleep dims the 3D car on every screen and shows
  // "Last seen ..." instead of "Parked". Stubbed for now; real wake state arrives via BLE.
  awake: boolean;
  vehicleConnected: boolean;
  tirePressureVisible: boolean;
  mediaPlaying: boolean;
  // Drive mode: when true the adapter sends a non-parked drive_state (shift D, speed > 0), which the
  // Godot scene reads to spin the wheels (VehicleManager wheel-spin path). Mirrors the harness "Drive".
  driving: boolean;
  // ── Free telemetry already arriving in DriveState/ClosuresState (RESPONSE-15
  // Tier 1). Previously parsed and discarded; no extra request or bytes.
  // Gear name as the car reports it ('P'|'D'|'R'|'N'|'unknown' style oneof name).
  gear: string;
  speed: number | null;
  odometerMiles: number | null;
  // Instantaneous power: positive = drawing, negative = regen.
  powerKw: number | null;
  // The car's own "somebody is in it" flag, and its centre-screen state. These are
  // the inputs a real Driving status needs (see REQUEST-17).
  userPresent: boolean;
  centerDisplay: string | null;
  // Active navigation route, when the car has one.
  activeRoute: { destination: string | null; minutesToArrival: number | null; milesToArrival: number | null } | null;
  // Which Tesla model the Godot scene renders. Switching this re-issues SHOW_PRODUCT with that model's
  // config (mirrors the harness S/3/X/Y buttons). Only Model Y is texture-verified on device.
  carModel: CarModel;
  // Per-car config overrides chosen in the Add Car flow. null = use the model's
  // default from vehicleConfigs. When set, createShowProductMessage merges them
  // over vehicle_config, so the renderer applies them to this specific car.
  //   exteriorColor / wheelType — Godot ExteriorColorValue / MobileWheelTypeEnumMap keys.
  //   interiorTrim            — Godot InteriorMap key (Black / White / Cream …).
  //   performance             — trim: red brake calipers + rear spoiler on/off.
  exteriorColor: string | null;
  wheelType: string | null;
  interiorTrim: string | null;
  performance: boolean | null;
  // Persistent manual lights (harness J / N). Driven via the SET_VEHICLE_LIGHTS message, not the
  // product payload — the Godot scene has no product-state path for these.
  headlightsOn: boolean;
  brakeLightsOn: boolean;
  // Scene lighting preset (harness lighting-mode cycle). Adjusts the env energies in SET_ENV_PARAMS.
  lightingMode: LightingMode;
  steeringWheelClimate: SteeringWheelClimate;
  seatClimateModes: SeatClimateModes;
  cameraMode: CameraMode;
  theme: ThemeMode;
  // Per-car battery percentage shown in the Home header (0–100). Stubbed until BLE; each vehicle
  // carries its own so switching cars shows a different value.
  batteryLevel: number | null; // null = never read (no cache) → blank
  // Remaining range in MILES — the raw `battery_range` field, which is the source the official app
  // reads (it converts at display time, so we keep it unconverted; see batteryDisplay.ts). null until
  // a read supplies it. Tapping the Home battery % swaps the label to this.
  rangeMiles: number | null;
  // Live cabin + ambient temperatures (°C), shown on the climate view and the Home Climate row.
  // Mock for now; maps to BLE ClimateState.inside_temp / outside_temp per vehicle.
  interiorTempC: number | null;
  exteriorTempC: number | null;
  // The car's real GPS position from telemetry (DriveState/locationState lat/lon + heading). `null`
  // until a read supplies it — and ONLY ever non-null for the live car (telemetry applies only to the
  // active-is-live vehicle), so the map reads: carLocation present → real pin, else the mock offset
  // (demo cars, or the live car before its first location read). NOT renderer state — ignored by
  // hasVehicleVisualStateChanged.
  carLocation: CarLocation | null;
  /** When the car was seen at `carLocation` — gps_as_of, else our read time. */
  carLocationAt: number | null;
  // The car's saved Home/Work locations (ChargeState.home_location/work_location),
  // used to name the Set Schedules location dropdown (bugs 7 & 8). Null until read.
  homeCoord: { lat: number; lon: number } | null;
  workCoord: { lat: number; lon: number } | null;
  // TPMS in BAR, straight from the car (it reports bar and supplies its own
  // recommended cold pressure, so nothing is converted or hardcoded per model).
  // `null` until a tire read lands; a single wheel is null when its sensor has
  // not reported, which the UI shows as "—" rather than a confident 0.0.
  tirePressures: TirePressures | null;
  // Now playing. `null` until a media read lands. Cached like every other
  // rendered field, so a relaunch shows the last known track rather than an
  // empty card — see CarLinkCache.
  media: MediaNowPlaying | null;
  // ── Climate/charging setpoints ────────────────────────────────────────────────────────────────
  // These are the car's *requested* values (vs. the measured interior/exterior temps above). They
  // live here rather than in the screens so a command can be dispatched for them and telemetry can
  // populate them; none of them is renderer state (see hasVehicleVisualStateChanged's ignore list).
  //
  // Climate setpoint (°C), clamped to LO_TEMP..HI_TEMP in 0.5° steps — the bounds double as the
  // LO/HI sentinels. Maps to ClimateState.driver_temp_setting.
  targetTempC: number;
  // Whether COP is ACTIVELY cooling right now, as opposed to merely armed. It is
  // the last arm of the Home climate line (@3887821) and is its own proto field,
  // separate from the mode.
  copActivelyCooling: boolean;
  cabinOverheatMode: CabinOverheatMode;
  cabinOverheatTemp: CabinOverheatTemp;
  bioweaponOn: boolean;
  // Camp and Pet mode are INDEPENDENT toggles in the sheet (either, both, or neither can be on),
  // so they are two booleans rather than one keeper enum.
  climateKeeper: ClimateKeeperMode;
  // Charging setpoints. Limit is a percentage clamped to LIMIT_MIN..LIMIT_MAX; amps clamp to
  // AMP_MIN..AMP_MAX. Map to ChargeState.charge_limit_soc / charge_current_request.
  chargeLimitPercent: number;
  // ── Charge panel (home screen, below favourites) ──────────────────────────
  // The car's own ChargingState name — Charging / Complete / Stopped / Starting /
  // NoPower / Disconnected. `charging` above collapses all of those to a boolean,
  // which is enough for the status line but not for the panel.
  chargingState: string | null;
  // Minutes to the LIMIT the user set (falling back to full). null = not
  // reported, which is normal unplugged — the panel omits the line.
  minutesToChargeLimit: number | null;
  chargerPowerKw: number | null;
  // kWh added during the last charging session — the charge panel's second line.
  energyAddedKwh: number | null;
  /** DC / Supercharger. Hides the amp stepper — see telemetry's fastCharging. */
  fastCharging: boolean;
  chargerActualCurrentA: number | null;
  chargerVoltageV: number | null;
  chargerPilotCurrentA: number | null;
  chargeRateMph: number | null;
  chargingAmps: number;
}

export type VehicleStateKey = keyof VehicleViewState;

export const initialVehicleState: VehicleViewState = {
  frunkOpen: false,
  trunkOpen: false,
  driverFrontDoorOpen: false,
  passengerFrontDoorOpen: false,
  driverRearDoorOpen: false,
  passengerRearDoorOpen: false,
  leftFrontWindowOpen: false,
  rightFrontWindowOpen: false,
  leftRearWindowOpen: false,
  rightRearWindowOpen: false,
  climateOn: false,
  frontDefrostOn: false,
  rearDefrostOn: false,
  chargePortOpen: false,
  cableAttached: false,
  charging: false,
  locked: true,
  sentryEnabled: false,
  lowPowerMode: false,
  keepAccessoryPower: false,
  valetMode: false,
  parentalControls: false,
  speedLimitMode: false,
  pinToDrive: false,
  valetPin: null,
  parentalPin: null,
  speedLimitPin: null,
  pinToDrivePin: null,
  speedLimitMph: 85, // Tesla's default ≈ 137 km/h (what the UI shows)
  parentalLimitSpeed: true,
  parentalReduceAccel: true,
  parentalRequireSafety: true,
  parentalCurfewNotify: true,
  awake: true,
  vehicleConnected: true,
  tirePressureVisible: false,
  mediaPlaying: false,
  driving: false,
  gear: 'unknown',
  speed: null,
  odometerMiles: null,
  powerKw: null,
  userPresent: false,
  centerDisplay: null,
  activeRoute: null,
  carModel: 'modelY',
  exteriorColor: null,
  wheelType: null,
  interiorTrim: null,
  performance: null,
  headlightsOn: false,
  brakeLightsOn: false,
  lightingMode: 'mobile',
  steeringWheelClimate: { mode: 'off', level: 0 },
  seatClimateModes: {
    frontLeft: { mode: 'off', level: 0 },
    frontRight: { mode: 'off', level: 0 },
    rearLeft: { mode: 'off', level: 0 },
    rearMiddle: { mode: 'off', level: 0 },
    rearRight: { mode: 'off', level: 0 },
    thirdRowLeft: { mode: 'off', level: 0 },
    thirdRowRight: { mode: 'off', level: 0 },
  },
  cameraMode: 'PARKED',
  theme: 'dark',
  batteryLevel: null,
  rangeMiles: null,
  interiorTempC: null,
  exteriorTempC: null,
  carLocation: null,
  carLocationAt: null,
  homeCoord: null,
  workCoord: null,
  tirePressures: null,
  media: null,
  targetTempC: 19.5,
  copActivelyCooling: false,
  cabinOverheatMode: 'off',
  cabinOverheatTemp: '40',
  bioweaponOn: false,
  climateKeeper: 'off',
  chargeLimitPercent: 80,
  chargingState: null,
  minutesToChargeLimit: null,
  chargerPowerKw: null,
  energyAddedKwh: null,
  fastCharging: false,
  chargerActualCurrentA: null,
  chargerVoltageV: null,
  chargerPilotCurrentA: null,
  chargeRateMph: null,
  chargingAmps: 16, // AMP_MAX — a fresh car reports the max the cable/charger allows
};

export interface SeatClimateCapability {
  marker: 'seatRow1L' | 'seatRow1R' | 'seatRow2L' | 'seatRow2M' | 'seatRow2R' | 'seatRow3L' | 'seatRow3R';
  label: string;
  heatLevels: 0 | 1 | 2 | 3;
  coolLevels: 0 | 1 | 2 | 3;
  auto: boolean;
}

// Steering-wheel rim style — picks which Tesla wheel icon to draw. From VehicleConfig.steeringWheelType.
export type SteeringWheelType = 'round' | 'yoke' | 'squircle';

export interface VehicleClimateCapabilities {
  steeringWheel: {
    heating: boolean;
    // Max heat level (the real app uses 2 for the wheel: 2-1-off). 0 means no wheel heater.
    heatLevels: 0 | 1 | 2;
    auto: boolean;
    type: SteeringWheelType;
  };
  seats: Record<SeatPosition, SeatClimateCapability>;
}

export interface VehicleConfig {
  id: string;
  type: 'VEHICLE';
  vin: string;
  vehicle_config: {
    car_type: string;
    fascia_type: string;
    chassis_type: string;
    exterior_color: string;
    paint_color_override: string;
    wheel_type: string;
    spoiler_type: string;
    charge_port_type: string;
    interior_trim_type: string;
    // third_row_seats: 'None' | 'FlatFold' | 'FuturisFoldFlat' | 'FuturisNoFoldFlat' — anything but
    // 'None' enables a 3rd row. rear_seat_type is the Godot RearSeatType enum int (3=TwoSeat captain
    // chairs → 6-seater, 0=Base bench → 7-seater). Together they pick Model X's 5/6/7-seat interior.
    third_row_seats: string;
    rear_seat_type?: number;
    // Godot InteriorUpperTrimType enum int (0=BLACK, 1=GREY headliner/pillars). Vehicle.gd defaults
    // absent → 0, so only set it where the GREY map applies (Model Y Juniper).
    interior_upper_trim_materials?: number;
    headlamp_type: string;
    aux_park_lamps: string;
    eu_vehicle: boolean;
    red_brake_calipers: boolean;
    window_tint_color: string;
    has_tesla_badge: boolean;
    has_tesla_word_mark: boolean;
  };
  climate_capabilities: VehicleClimateCapabilities;
}

// ── Per-model climate capabilities (MOCK) ──────────────────────────────────────────────────────
// This table is the ONLY thing that decides which climate controls a model shows. Every value maps
// 1:1 to a field the Tesla CarServer protos already expose over BLE (the RPi POC pulls these today):
//   seat.heatLevels ← ClimateState.SeatHeater<pos> present · VehicleConfig.{hasFrontRowSeatHeaters,
//                     rearSeatHeaterType (NONE | LEFTRIGHTONLY | THREESEATS), hasThirdRowSeatHeaters}
//   seat.coolLevels ← ClimateState seat-cooler present     · VehicleConfig.hasSeatCooling
//   seat.auto       ← ClimateState.AutoSeatClimate<pos> present · VehicleConfig.hasAutoSeatClimate
//   wheel.heating   ← VehicleConfig.steeringWheelHeaterInstalled / ClimateState.SteeringWheelHeater
//   wheel.auto      ← ClimateState.AutoSteeringWheelHeat present
//   wheel.type      ← VehicleConfig.steeringWheelType
// When BLE lands, only climateCapabilitiesFor() changes — it reads these off the live vehicle instead
// of this table. Every consumer already goes through that one function, so nothing else moves.
type SeatSpec = { heat: 0 | 1 | 2 | 3; cool: 0 | 1 | 2 | 3; auto: boolean };
const HEAT_VENT_AUTO: SeatSpec = { heat: 3, cool: 3, auto: true }; // heated + ventilated + auto
const HEAT_ONLY: SeatSpec = { heat: 3, cool: 0, auto: false }; //     heated, no cooling, no auto
const NO_CLIMATE: SeatSpec = { heat: 0, cool: 0, auto: false }; //    seat has no climate function

// thirdRow defaults to NO_CLIMATE — only the Model X 6-/7-seaters pass a real spec for it. Seats with
// NO_CLIMATE render no control (and Godot doesn't emit their marker anyway), so it's safe everywhere.
function makeSeats(
  front: SeatSpec,
  rearOuter: SeatSpec,
  rearCenter: SeatSpec,
  thirdRow: SeatSpec = NO_CLIMATE,
): Record<SeatPosition, SeatClimateCapability> {
  const s = (marker: SeatClimateCapability['marker'], label: string, spec: SeatSpec): SeatClimateCapability => ({
    marker,
    label,
    heatLevels: spec.heat,
    coolLevels: spec.cool,
    auto: spec.auto,
  });
  return {
    frontLeft: s('seatRow1L', 'Driver', front),
    frontRight: s('seatRow1R', 'Passenger', front),
    rearLeft: s('seatRow2L', 'Rear left', rearOuter),
    rearMiddle: s('seatRow2M', 'Rear middle', rearCenter),
    rearRight: s('seatRow2R', 'Rear right', rearOuter),
    thirdRowLeft: s('seatRow3L', 'Third row left', thirdRow),
    thirdRowRight: s('seatRow3R', 'Third row right', thirdRow),
  };
}

type WheelCap = VehicleClimateCapabilities['steeringWheel'];
const WHEEL_ROUND_AUTO: WheelCap = { heating: true, heatLevels: 2, auto: true, type: 'round' };
const WHEEL_ROUND_NO_AUTO: WheelCap = { heating: true, heatLevels: 2, auto: false, type: 'round' };
const WHEEL_YOKE_AUTO: WheelCap = { heating: true, heatLevels: 2, auto: true, type: 'yoke' };
const WHEEL_NONE: WheelCap = { heating: false, heatLevels: 0, auto: false, type: 'round' }; // no heated wheel

const CLIMATE_CAPS: Record<CarModel, VehicleClimateCapabilities> = {
  // ── Current line-up — fully featured (ventilated + auto front seats, heated+auto wheel) ──────────
  // Model Y (Juniper) / Model 3 (Highland): ventilated+auto front, rear OUTBOARD heat only
  // (rearSeatHeaterType=LEFTRIGHTONLY → no rear-centre), round wheel heat+auto.
  modelY: { steeringWheel: WHEEL_ROUND_AUTO, seats: makeSeats(HEAT_VENT_AUTO, HEAT_ONLY, NO_CLIMATE) },
  model3: { steeringWheel: WHEEL_ROUND_AUTO, seats: makeSeats(HEAT_VENT_AUTO, HEAT_ONLY, NO_CLIMATE) },
  // Model S/X (refresh): premium — ventilated+auto front + all THREE rear seats heated
  // (rearSeatHeaterType=THREESEATS → rear-centre control). Model X uses the YOKE wheel.
  modelS: { steeringWheel: WHEEL_ROUND_AUTO, seats: makeSeats(HEAT_VENT_AUTO, HEAT_ONLY, HEAT_ONLY) },
  modelX: { steeringWheel: WHEEL_YOKE_AUTO, seats: makeSeats(HEAT_VENT_AUTO, HEAT_ONLY, HEAT_ONLY) },

  // ── Older line-up (pre-facelift) — lacked ventilation & auto seat climate; wheel heat limited ────
  // Model Y (pre-Juniper): heated-only seats, round wheel heats but NO auto.
  modelYLegacy: { steeringWheel: WHEEL_ROUND_NO_AUTO, seats: makeSeats(HEAT_ONLY, HEAT_ONLY, NO_CLIMATE) },
  // Model 3 (pre-Highland, early): heated-only seats AND no heated wheel at all → wheel control absent.
  model3Legacy: { steeringWheel: WHEEL_NONE, seats: makeSeats(HEAT_ONLY, HEAT_ONLY, NO_CLIMATE) },
  // Model S/X (classic, pre-2021): heated front + all three rear seats, but no cooling/auto; round wheel.
  modelSLegacy: { steeringWheel: WHEEL_ROUND_NO_AUTO, seats: makeSeats(HEAT_ONLY, HEAT_ONLY, HEAT_ONLY) },
  modelXLegacy: { steeringWheel: WHEEL_ROUND_NO_AUTO, seats: makeSeats(HEAT_ONLY, HEAT_ONLY, HEAT_ONLY) },

  // ── Model X seat-count variants (current Palladium body, yoke) — exercise captain-chairs / 3rd row ─
  // 6-seater: row-2 CAPTAIN CHAIRS (no rear centre) + heated 3rd row. 7-seater: row-2 BENCH (centre) +
  // heated 3rd row. heated 3rd row ← VehicleConfig.hasThirdRowSeatHeaters.
  modelX6Seat: { steeringWheel: WHEEL_YOKE_AUTO, seats: makeSeats(HEAT_VENT_AUTO, HEAT_ONLY, NO_CLIMATE, HEAT_ONLY) },
  modelX7Seat: { steeringWheel: WHEEL_YOKE_AUTO, seats: makeSeats(HEAT_VENT_AUTO, HEAT_ONLY, HEAT_ONLY, HEAT_ONLY) },
};

// THE mock→BLE boundary. Today: hard-coded per-model table above. Tomorrow: read from the live
// vehicle's BLE ClimateState/VehicleConfig (keyed per VIN). Callers never change.
export function climateCapabilitiesFor(model: CarModel): VehicleClimateCapabilities {
  return CLIMATE_CAPS[model];
}

export const modelYProductConfig: VehicleConfig = {
  type: 'VEHICLE',
  // fascia 'performanceBayberry' → res://Ego/Bayberry/Bayberry.tscn — the CURRENT (Juniper) Model Y body.
  // (The Y_High scene is the OLDER pre-Juniper body, used by the "(older)" trim.)
  id: 'local-modely-performanceBayberry-model_y',
  vin: '000Y',
  vehicle_config: {
    car_type: 'modely',
    fascia_type: 'performanceBayberry',
    chassis_type: 'model_y',
    exterior_color: 'UltraRed',
    paint_color_override: '',
    wheel_type: 'ArachnidV221',
    spoiler_type: 'CarbonFiber',
    charge_port_type: 'EU',
    interior_trim_type: 'White',
    interior_upper_trim_materials: 1,
    third_row_seats: 'None',
    headlamp_type: 'Premium',
    aux_park_lamps: 'NaPremium',
    eu_vehicle: true,
    red_brake_calipers: true,
    window_tint_color: '0,0,0,153',
    has_tesla_badge: false,
    has_tesla_word_mark: false,
  },
  climate_capabilities: CLIMATE_CAPS.modelY,
};

// The harness' S/3/X configs (LocalDevMessageInjector._vehicle_config_model_*). vehicle_config drives
// the car visual; climate_capabilities now come per-model from CLIMATE_CAPS (see makeVehicleConfig).
const baseVehicleConfig: VehicleConfig['vehicle_config'] = {
  car_type: 'modely',
  fascia_type: 'original',
  chassis_type: 'model_y',
  exterior_color: 'PearlWhite',
  paint_color_override: '',
  wheel_type: 'Unknown',
  spoiler_type: 'None',
  charge_port_type: 'EU',
  interior_trim_type: 'Black',
  third_row_seats: 'None',
  headlamp_type: 'Premium',
  aux_park_lamps: 'NaPremium',
  eu_vehicle: true,
  red_brake_calipers: false,
  window_tint_color: '0,0,0,153',
  has_tesla_badge: false,
  has_tesla_word_mark: false,
};

function makeVehicleConfig(vehicleConfig: VehicleConfig['vehicle_config'], model: CarModel): VehicleConfig {
  const { car_type, fascia_type, chassis_type } = vehicleConfig;
  return {
    type: 'VEHICLE',
    id: `local-${car_type}-${fascia_type}-${chassis_type}`,
    vin: '000Y',
    vehicle_config: vehicleConfig,
    climate_capabilities: climateCapabilitiesFor(model),
  };
}

// Visual configs (car_type/fascia/chassis pick the Godot body, per ProductManager.get_vehicle_node_path).
// Current trims use the NEWEST body (the 2023+ refreshes live in their own folders); the "(older)" trims
// point at the genuinely older High/classic scene:
//   Y: 'performanceBayberry'→Bayberry (CURRENT Juniper) · fascia 'original'→Y_High (older)
//   3: 'performancePoppyseed'→Poppyseed (CURRENT Highland) · fascia 'original'→Model3_High (older)
//   S: car 'lychee'→S_Palladium (CURRENT refresh)        · 'models'→Model_S (classic pre-2021)
//   X: car 'tamarind'→X_Palladium (CURRENT refresh)      · 'modelx'→Model_X (classic pre-2021)
const modelS_vc: VehicleConfig['vehicle_config'] = {
  ...baseVehicleConfig,
  car_type: 'lychee',
  fascia_type: 'original',
  chassis_type: 'model_s',
  exterior_color: 'GarnetRed',
  wheel_type: 'Arachnid21Black',
  interior_trim_type: 'Black',
  spoiler_type: 'None',
  red_brake_calipers: true,
  window_tint_color: '0,0,0,128',
};
const model3_vc: VehicleConfig['vehicle_config'] = {
  ...baseVehicleConfig,
  car_type: 'model3',
  fascia_type: 'performancePoppyseed', // → v2023/Poppyseed = the CURRENT (Highland) body. Model3_High = older.
  chassis_type: 'model_3',
  exterior_color: 'GlacierBlue',
  wheel_type: 'Cypress21',
  interior_trim_type: 'Black',
  spoiler_type: 'CarbonFiber',
  red_brake_calipers: true,
  window_tint_color: '0,0,0,170',
};
const modelX_vc: VehicleConfig['vehicle_config'] = {
  ...baseVehicleConfig,
  car_type: 'tamarind',
  fascia_type: 'original',
  chassis_type: 'model_x',
  exterior_color: 'PearlWhite',
  wheel_type: 'MachinaV219',
  interior_trim_type: 'Cream',
  spoiler_type: 'None',
  red_brake_calipers: false,
  window_tint_color: '0,0,0,190',
};

// Older bodies: same base visual but with the older-body car_type/fascia so a genuinely older 3D body
// renders (not a clone of the current one). Y/3 older = the High scenes via fascia 'original'.
const modelY_old_vc: VehicleConfig['vehicle_config'] = {
  ...modelYProductConfig.vehicle_config,
  fascia_type: 'original',
  // GREY upper trim is Juniper-only; the pre-Juniper (Y_High) body keeps the BLACK default.
  interior_upper_trim_materials: 0,
};
const model3_old_vc: VehicleConfig['vehicle_config'] = { ...model3_vc, fascia_type: 'original' };
const modelS_old_vc: VehicleConfig['vehicle_config'] = { ...modelS_vc, car_type: 'models' };
const modelX_old_vc: VehicleConfig['vehicle_config'] = { ...modelX_vc, car_type: 'modelx' };

// Model X seat-count variants reuse the current X (Palladium) body but enable the 3rd row. third_row_seats
// !== 'None' + rear_seat_type 3 (TwoSeat)→6-seat captain chairs, 0 (Base)→7-seat bench (Model_X_Palladium
// .setup_seat_config). They need DISTINCT ids so the renderer re-shows + re-runs the seat config on switch.
const modelX6_vc: VehicleConfig['vehicle_config'] = { ...modelX_vc, third_row_seats: 'FlatFold', rear_seat_type: 3 };
const modelX7_vc: VehicleConfig['vehicle_config'] = { ...modelX_vc, third_row_seats: 'FlatFold', rear_seat_type: 0 };

export const vehicleConfigs: Record<CarModel, VehicleConfig> = {
  // Current line-up (newest body).
  modelY: modelYProductConfig,
  modelS: makeVehicleConfig(modelS_vc, 'modelS'),
  model3: makeVehicleConfig(model3_vc, 'model3'),
  modelX: makeVehicleConfig(modelX_vc, 'modelX'),
  // Older line-up (pre-facelift body + reduced climate_capabilities).
  modelYLegacy: makeVehicleConfig(modelY_old_vc, 'modelYLegacy'),
  modelSLegacy: makeVehicleConfig(modelS_old_vc, 'modelSLegacy'),
  model3Legacy: makeVehicleConfig(model3_old_vc, 'model3Legacy'),
  modelXLegacy: makeVehicleConfig(modelX_old_vc, 'modelXLegacy'),
  // Model X 6-/7-seater (current body) — distinct ids so switching re-applies the seat config.
  modelX6Seat: { ...makeVehicleConfig(modelX6_vc, 'modelX6Seat'), id: 'local-tamarind-model_x-6seat' },
  modelX7Seat: { ...makeVehicleConfig(modelX7_vc, 'modelX7Seat'), id: 'local-tamarind-model_x-7seat' },
};
