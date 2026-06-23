import type { CameraMode, SeatPosition, VehicleStateKey, VehicleViewState } from '../types/vehicleTypes';
import {
  cycleSeatClimateState,
  cycleSteeringWheelClimateState,
  patchState,
  setCameraModeState,
  setScreenCameraModeState,
  toggleState,
} from './fleet';

export interface VehicleActions {
  setCameraMode: (cameraMode: CameraMode) => void;
  setScreenCameraMode: (cameraMode: CameraMode) => void;
  toggle: (key: VehicleStateKey) => void;
  patch: (patch: Partial<VehicleViewState>) => void;
  cycleSteeringWheelClimate: () => void;
  cycleSeatClimate: (seat: SeatPosition) => void;
}

// Builds the VehicleActions object from a single "apply an update to the active car's state"
// callback. The fleet hook provides `apply`; the action implementations live in fleet.ts so they
// stay pure and unit-tested.
export function buildVehicleActions(
  apply: (update: (state: VehicleViewState) => VehicleViewState) => void,
): VehicleActions {
  return {
    setCameraMode: (cameraMode) => apply((s) => setCameraModeState(s, cameraMode)),
    setScreenCameraMode: (cameraMode) => apply((s) => setScreenCameraModeState(s, cameraMode)),
    toggle: (key) => apply((s) => toggleState(s, key)),
    patch: (partial) => apply((s) => patchState(s, partial)),
    cycleSteeringWheelClimate: () => apply(cycleSteeringWheelClimateState),
    cycleSeatClimate: (seat) => apply((s) => cycleSeatClimateState(s, seat)),
  };
}
