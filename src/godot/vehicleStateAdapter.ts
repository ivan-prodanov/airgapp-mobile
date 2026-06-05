import { PixelRatio } from 'react-native';

import { cameraPresets } from './cameraPresets';
import type { FrameData, GodotMessage } from '../types/rendererMessages';
import { modelYProductConfig, type CameraMode, type ThemeMode, type VehicleConfig, type VehicleViewState } from '../types/vehicleTypes';

export const VEHICLE_ID = modelYProductConfig.id;

export function createAppConfigMessage(): GodotMessage<'APP_CONFIG'> {
  return {
    type: 'APP_CONFIG',
    data: {
      // RN swap: web used `window.devicePixelRatio || 1`.
      pixelRatio: PixelRatio.get(),
      fontScale: 1,
      scaleFramebufferOnBackground: true,
    },
  };
}

export function createGodotConfigMessage(): GodotMessage<'GODOT_CONFIG'> {
  return {
    type: 'GODOT_CONFIG',
    data: {
      light_theme_color: '#F7F7F7',
      dark_theme_color: '#161718',
    },
  };
}

export function createThemeMessage(theme: ThemeMode): GodotMessage<'SET_APP_THEME'> {
  return {
    type: 'SET_APP_THEME',
    data: { theme },
  };
}

export function createFrameMessage(frame: FrameData): GodotMessage<'UPDATE_MAIN_VIEW_FRAME', FrameData> {
  return {
    type: 'UPDATE_MAIN_VIEW_FRAME',
    data: frame,
  };
}

export function createShowProductMessage(state: VehicleViewState, config: VehicleConfig = modelYProductConfig): GodotMessage<'SHOW_PRODUCT'> {
  return {
    type: 'SHOW_PRODUCT',
    data: {
      ...config,
      ...createGodotStatePayload(state),
    },
  };
}

export function createUpdateProductMessage(state: VehicleViewState): GodotMessage<'UPDATE_PRODUCT'> {
  return {
    type: 'UPDATE_PRODUCT',
    data: {
      ...modelYProductConfig,
      ...createGodotStatePayload(state),
    },
  };
}

export function createMoveCameraMessages(mode: CameraMode, animated: boolean): GodotMessage[] {
  const preset = cameraPresets[mode];
  return [
    {
      type: 'SET_ENV_PARAMS',
      data: {
        rotation: preset.environment.rotation,
        env_energy: preset.environment.env_energy,
        amb_energy: preset.environment.amb_energy,
        animated,
        duration: 0.75,
      },
    },
    {
      type: 'MOVE_CAMERA',
      data: {
        rotation: preset.moveCamera.rotation,
        offset: preset.moveCamera.offset,
        cam_fov: preset.moveCamera.cam_fov,
        keep_aspect: preset.moveCamera.keep_aspect,
        animated,
        duration: 0.75,
        animation_id: preset.animationId,
      },
    },
  ];
}

export function createFadeRoofMessage(fade: boolean, animated: boolean): GodotMessage<'FADE_ROOF'> {
  return {
    type: 'FADE_ROOF',
    data: {
      vehicle_id: VEHICLE_ID,
      fade,
      animated,
      duration: 0.75,
    },
  };
}

export function createGetMarkersMessage(): GodotMessage<'GET_VEHICLE_MARKERS'> {
  return {
    type: 'GET_VEHICLE_MARKERS',
    data: {
      vehicle_id: VEHICLE_ID,
    },
  };
}

export function hasVehicleVisualStateChanged(previous: VehicleViewState, next: VehicleViewState): boolean {
  const ignoredKeys = new Set<keyof VehicleViewState>([
    'cameraMode',
    'theme',
    'seatClimateModes',
    'steeringWheelClimateMode',
    'vehicleConnected',
    'tirePressureVisible',
    'mediaPlaying',
  ]);
  for (const key of Object.keys(next) as Array<keyof VehicleViewState>) {
    if (ignoredKeys.has(key)) {
      continue;
    }
    if (previous[key] !== next[key]) {
      return true;
    }
  }
  return false;
}

function createGodotStatePayload(state: VehicleViewState) {
  const chargeState: Record<string, unknown> = {
    charge_port_door_open: state.chargePortOpen || state.cableAttached || state.charging,
    charge_port_flow_state: state.charging ? 1 : 0,
  };

  if (state.charging) {
    chargeState.chargeport_flow_state = 1;
    chargeState.charge_port_color = '00FF00';
  } else if (state.cableAttached) {
    chargeState.charge_port_color = '000000';
  }

  return {
    vehicle_state: {
      df: state.driverFrontDoorOpen,
      dr: state.driverRearDoorOpen,
      pf: state.passengerFrontDoorOpen,
      pr: state.passengerRearDoorOpen,
      ft: state.frunkOpen,
      rt: state.trunkOpen,
      tn: 0,
    },
    drive_state: {
      speed: 0,
      shift_state: 'P',
    },
    climate_state: {
      is_climate_on: state.climateOn,
      is_preconditioning: false,
      is_front_defroster_on: state.frontDefrostOn,
      is_rear_defroster_on: state.rearDefrostOn,
    },
    charge_state: chargeState,
    mobile_app_state: {
      is_loading: false,
      show_terrain: false,
      wheel_turn_deg: 0,
      window_animation_state: {
        LFWindowAnimation: state.leftFrontWindowOpen,
        RFWindowAnimation: state.rightFrontWindowOpen,
        LRWindowAnimation: state.leftRearWindowOpen,
        RRWindowAnimation: state.rightRearWindowOpen,
      },
    },
    car_wrap_state: {
      skin: '',
    },
  };
}
