import type {
  CameraMode,
  SeatClimateModeName,
  SeatPosition,
  SteeringWheelClimateModeName,
  VehicleStateKey,
  VehicleViewState,
} from '../types/vehicleTypes';
import {
  patchState,
  setCameraModeState,
  setScreenCameraModeState,
  setSeatClimateState,
  setSteeringWheelClimateState,
  stepSeatClimateState,
  stepSteeringWheelClimateState,
  toggleState,
} from './fleet';

export interface VehicleActions {
  setCameraMode: (cameraMode: CameraMode) => void;
  setScreenCameraMode: (cameraMode: CameraMode) => void;
  toggle: (key: VehicleStateKey) => void;
  patch: (patch: Partial<VehicleViewState>) => void;
  // Tapping the seat/wheel icon steps the level down (3→2→1→off); the menu sets the mode outright.
  stepSeatClimate: (seat: SeatPosition) => void;
  setSeatClimate: (seat: SeatPosition, mode: SeatClimateModeName) => void;
  stepSteeringWheelClimate: () => void;
  setSteeringWheelClimate: (mode: SteeringWheelClimateModeName) => void;
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
    stepSeatClimate: (seat) => apply((s) => stepSeatClimateState(s, seat)),
    setSeatClimate: (seat, mode) => apply((s) => setSeatClimateState(s, seat, mode)),
    stepSteeringWheelClimate: () => apply(stepSteeringWheelClimateState),
    setSteeringWheelClimate: (mode) => apply((s) => setSteeringWheelClimateState(s, mode)),
  };
}
