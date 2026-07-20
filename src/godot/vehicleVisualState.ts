// hasVehicleVisualStateChanged — "does this state edit need an UPDATE_PRODUCT?"
//
// Lives apart from vehicleStateAdapter.ts (which imports react-native for PixelRatio) purely so it
// stays a pure, node-testable module like the rest of src/godot's logic files.
//
// It is a DENYLIST: it walks every key of VehicleViewState and reports a change unless the key is
// named below. That default is deliberate — a new *renderer* field is wired up for free — but it
// means every new NON-renderer field must be added here, or it ships a redundant Godot round-trip
// on each edit (createGodotStatePayload never reads it, so the payload would be byte-identical).
// vehicleVisualState.test.ts guards this.

import type { VehicleViewState } from '../types/vehicleTypes';

const IGNORED_KEYS = new Set<keyof VehicleViewState>([
  'cameraMode',
  'theme',
  // carModel switches the whole product, so the bridge re-issues SHOW_PRODUCT for it directly
  // rather than an UPDATE_PRODUCT (which can't change the rendered model).
  'carModel',
  // lights + lighting are driven by their own messages (SET_VEHICLE_LIGHTS / SET_ENV_PARAMS),
  // not the product payload.
  'headlightsOn',
  'brakeLightsOn',
  'lightingMode',
  'seatClimateModes',
  'steeringWheelClimate',
  'vehicleConnected',
  'tirePressureVisible',
  'mediaPlaying',
  // The car's GPS position drives the map pin only, never the 3D product payload.
  'carLocation',
  // Climate/charging setpoints + comfort toggles: sheet state, never rendered on the car. Without
  // these, a held temp chevron or a slider drag would fire an UPDATE_PRODUCT per sample.
  'targetTempC',
  'cabinOverheatMode',
  'cabinOverheatTemp',
  'bioweaponOn',
  'campModeOn',
  'petModeOn',
  'chargeLimitPercent',
  'chargingAmps',
  // Security & Drivers: PINs + protected-feature settings are pure sheet state, never on the 3D car.
  'valetPin',
  'parentalPin',
  'speedLimitPin',
  'pinToDrivePin',
  'speedLimitKph',
  'parentalLimitSpeed',
  'parentalLimitSpeedKph',
  'parentalReduceAccel',
  'parentalRequireSafety',
  'parentalCurfewNotify',
]);

export function hasVehicleVisualStateChanged(previous: VehicleViewState, next: VehicleViewState): boolean {
  for (const key of Object.keys(next) as Array<keyof VehicleViewState>) {
    if (IGNORED_KEYS.has(key)) {
      continue;
    }
    // Object.is, not !==: it treats null (the no-data value for batteryLevel /
    // temps) as equal to itself, and would also tame any stray NaN — plain !==
    // reports NaN !== NaN (and would misfire) as a phantom change.
    if (!Object.is(previous[key], next[key])) {
      return true;
    }
  }
  return false;
}
