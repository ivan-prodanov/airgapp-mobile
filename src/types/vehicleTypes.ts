export type ThemeMode = 'dark' | 'light';

export type CameraMode = 'PARKED' | 'TOP_DOWN' | 'CLIMATE' | 'CHARGING' | 'CLOSURE_OPEN';
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
  steeringWheelClimateMode: SteeringWheelClimateMode;
  seatClimateModes: SeatClimateModes;
  cameraMode: CameraMode;
  theme: ThemeMode;
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
