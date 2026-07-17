import { PixelRatio } from 'react-native';

import { CAMERA_ANIM, cameraPresets } from './cameraPresets';
import type { FrameData, GodotMessage } from '../types/rendererMessages';
import { modelYProductConfig, vehicleConfigs, type CameraMode, type CarModel, type LightingMode, type ThemeMode, type VehicleViewState } from '../types/vehicleTypes';

export const VEHICLE_ID = modelYProductConfig.id;

export function vehicleIdForModel(model: CarModel): string {
  return vehicleConfigs[model].id;
}

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

export function createShowProductMessage(state: VehicleViewState): GodotMessage<'SHOW_PRODUCT'> {
  return {
    type: 'SHOW_PRODUCT',
    data: {
      ...vehicleConfigs[state.carModel],
      ...createGodotStatePayload(state),
    },
  };
}

export function createUpdateProductMessage(state: VehicleViewState): GodotMessage<'UPDATE_PRODUCT'> {
  return {
    type: 'UPDATE_PRODUCT',
    data: {
      ...vehicleConfigs[state.carModel],
      ...createGodotStatePayload(state),
    },
  };
}

export function createMoveCameraMessages(mode: CameraMode, animated: boolean, lightingMode: LightingMode = 'mobile'): GodotMessage[] {
  const preset = cameraPresets[mode];
  // 'ambient_fill' floors the env/ambient energies for a flatter, brighter scene (harness lighting
  // cycle). 'mobile' uses the per-view preset values unchanged.
  const envEnergy = lightingMode === 'ambient_fill' ? Math.max(preset.environment.env_energy, 4.5) : preset.environment.env_energy;
  const ambEnergy = lightingMode === 'ambient_fill' ? Math.max(preset.environment.amb_energy, 7.0) : preset.environment.amb_energy;
  return [
    {
      type: 'SET_ENV_PARAMS',
      data: {
        rotation: preset.environment.rotation,
        env_energy: envEnergy,
        amb_energy: ambEnergy,
        animated,
        duration: CAMERA_ANIM.duration,
        transition_type: CAMERA_ANIM.transition_type,
        ease_type: CAMERA_ANIM.ease_type,
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
        duration: CAMERA_ANIM.duration,
        transition_type: CAMERA_ANIM.transition_type,
        ease_type: CAMERA_ANIM.ease_type,
        animation_id: preset.animationId,
      },
    },
  ];
}

export function createFadeRoofMessage(fade: boolean, animated: boolean, vehicleId: string = VEHICLE_ID): GodotMessage<'FADE_ROOF'> {
  return {
    type: 'FADE_ROOF',
    data: {
      vehicle_id: vehicleId,
      fade,
      animated,
      duration: 0.75,
    },
  };
}

// Straight-down views (climate/top) must switch the climate FX quads (airflow + defrost) to their
// depth-test-disabled "above" shader; otherwise the flat quads z-fight the interior floor and flicker
// (very visible on iOS's lower-precision depth buffer). VehicleManager.on_show_fx_above reads `show`.
export function createShowFxAboveMessage(show: boolean, vehicleId: string = VEHICLE_ID): GodotMessage<'SHOW_FX_ABOVE'> {
  return {
    type: 'SHOW_FX_ABOVE',
    data: {
      vehicle_id: vehicleId,
      show,
    },
  };
}

// Persistent manual lights — handled by VehicleManager.on_set_vehicle_lights (added via
// fix_godot_project.py). Carries the active vehicle id (vehicle_for_data rejects a mismatch).
export function createVehicleLightsMessage(state: VehicleViewState, vehicleId: string): GodotMessage<'SET_VEHICLE_LIGHTS'> {
  return {
    type: 'SET_VEHICLE_LIGHTS',
    data: {
      vehicle_id: vehicleId,
      headlights: state.headlightsOn,
      brake_lights: state.brakeLightsOn,
    },
  };
}

export function createGetMarkersMessage(vehicleId: string = VEHICLE_ID): GodotMessage<'GET_VEHICLE_MARKERS'> {
  return {
    type: 'GET_VEHICLE_MARKERS',
    data: {
      vehicle_id: vehicleId,
    },
  };
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
      // Drive mode spins the wheels: VehicleManager reads drive_state.speed for the spin rate and
      // treats any non-P shift_state as "driving". 18 matches the harness' _toggle_drive_mode.
      speed: state.driving ? 18 : 0,
      shift_state: state.driving ? 'D' : 'P',
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
