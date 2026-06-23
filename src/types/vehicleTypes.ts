export type ThemeMode = 'dark' | 'light';

export type CameraMode = 'PARKED' | 'TOP_DOWN' | 'CLIMATE' | 'CHARGING' | 'CLOSURE_OPEN';
export type CarModel = 'modelS' | 'model3' | 'modelX' | 'modelY';
// Scene lighting preset (mirrors the harness lighting-mode cycle). 'view_relative' is omitted — it
// tracks the live orbit yaw, which is disabled on iOS 26.
export type LightingMode = 'mobile' | 'ambient_fill';
export type SeatPosition = 'frontLeft' | 'frontRight' | 'rearLeft' | 'rearMiddle' | 'rearRight';
export type SeatClimateModeName = 'off' | 'heat' | 'cool' | 'auto';
export type SteeringWheelClimateMode = 'off' | 'heat' | 'auto';

export interface SeatClimateMode {
  mode: SeatClimateModeName;
  level: 0 | 1 | 2 | 3;
}

export type SeatClimateModes = Record<SeatPosition, SeatClimateMode>;

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
  // Whether the car is awake (online) vs. asleep. Asleep dims the 3D car on every screen and shows
  // "Last seen ..." instead of "Parked". Stubbed for now; real wake state arrives via BLE.
  awake: boolean;
  vehicleConnected: boolean;
  tirePressureVisible: boolean;
  mediaPlaying: boolean;
  // Drive mode: when true the adapter sends a non-parked drive_state (shift D, speed > 0), which the
  // Godot scene reads to spin the wheels (VehicleManager wheel-spin path). Mirrors the harness "Drive".
  driving: boolean;
  // Which Tesla model the Godot scene renders. Switching this re-issues SHOW_PRODUCT with that model's
  // config (mirrors the harness S/3/X/Y buttons). Only Model Y is texture-verified on device.
  carModel: CarModel;
  // Persistent manual lights (harness J / N). Driven via the SET_VEHICLE_LIGHTS message, not the
  // product payload — the Godot scene has no product-state path for these.
  headlightsOn: boolean;
  brakeLightsOn: boolean;
  // Scene lighting preset (harness lighting-mode cycle). Adjusts the env energies in SET_ENV_PARAMS.
  lightingMode: LightingMode;
  steeringWheelClimateMode: SteeringWheelClimateMode;
  seatClimateModes: SeatClimateModes;
  cameraMode: CameraMode;
  theme: ThemeMode;
  // Per-car battery percentage shown in the Home header (0–100). Stubbed until BLE; each vehicle
  // carries its own so switching cars shows a different value.
  batteryLevel: number;
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
  awake: true,
  vehicleConnected: true,
  tirePressureVisible: false,
  mediaPlaying: false,
  driving: false,
  carModel: 'modelY',
  headlightsOn: false,
  brakeLightsOn: false,
  lightingMode: 'mobile',
  steeringWheelClimateMode: 'off',
  seatClimateModes: {
    frontLeft: { mode: 'off', level: 0 },
    frontRight: { mode: 'off', level: 0 },
    rearLeft: { mode: 'off', level: 0 },
    rearMiddle: { mode: 'off', level: 0 },
    rearRight: { mode: 'off', level: 0 },
  },
  cameraMode: 'PARKED',
  theme: 'dark',
  batteryLevel: 48,
};

export interface SeatClimateCapability {
  marker: 'seatRow1L' | 'seatRow1R' | 'seatRow2L' | 'seatRow2M' | 'seatRow2R';
  label: string;
  heatLevels: 0 | 1 | 2 | 3;
  coolLevels: 0 | 1 | 2 | 3;
  auto: boolean;
}

export interface VehicleClimateCapabilities {
  steeringWheel: {
    heating: boolean;
    auto: boolean;
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
    third_row_seats: string;
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

export const modelYProductConfig: VehicleConfig = {
  type: 'VEHICLE',
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
    third_row_seats: 'None',
    headlamp_type: 'Premium',
    aux_park_lamps: 'NaPremium',
    eu_vehicle: true,
    red_brake_calipers: true,
    window_tint_color: '0,0,0,153',
    has_tesla_badge: false,
    has_tesla_word_mark: false,
  },
  climate_capabilities: {
    steeringWheel: {
      heating: true,
      auto: true,
    },
    seats: {
      frontLeft: {
        marker: 'seatRow1L',
        label: 'Driver',
        heatLevels: 3,
        coolLevels: 3,
        auto: true,
      },
      frontRight: {
        marker: 'seatRow1R',
        label: 'Passenger',
        heatLevels: 3,
        coolLevels: 3,
        auto: true,
      },
      rearLeft: {
        marker: 'seatRow2L',
        label: 'Rear left',
        heatLevels: 3,
        coolLevels: 0,
        auto: false,
      },
      rearMiddle: {
        marker: 'seatRow2M',
        label: 'Rear middle',
        heatLevels: 3,
        coolLevels: 0,
        auto: false,
      },
      rearRight: {
        marker: 'seatRow2R',
        label: 'Rear right',
        heatLevels: 3,
        coolLevels: 0,
        auto: false,
      },
    },
  },
};

// The harness' S/3/X configs (LocalDevMessageInjector._vehicle_config_model_*). Climate capabilities
// are reused from Model Y — they only drive the RN climate UI, not the car visual we're switching.
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

function makeVehicleConfig(vehicleConfig: VehicleConfig['vehicle_config']): VehicleConfig {
  const { car_type, fascia_type, chassis_type } = vehicleConfig;
  return {
    type: 'VEHICLE',
    id: `local-${car_type}-${fascia_type}-${chassis_type}`,
    vin: '000Y',
    vehicle_config: vehicleConfig,
    climate_capabilities: modelYProductConfig.climate_capabilities,
  };
}

export const vehicleConfigs: Record<CarModel, VehicleConfig> = {
  modelY: modelYProductConfig,
  modelS: makeVehicleConfig({
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
  }),
  model3: makeVehicleConfig({
    ...baseVehicleConfig,
    car_type: 'model3',
    fascia_type: 'performancePoppyseed',
    chassis_type: 'model_3',
    exterior_color: 'GlacierBlue',
    wheel_type: 'Cypress21',
    interior_trim_type: 'Black',
    spoiler_type: 'CarbonFiber',
    red_brake_calipers: true,
    window_tint_color: '0,0,0,170',
  }),
  modelX: makeVehicleConfig({
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
  }),
};
