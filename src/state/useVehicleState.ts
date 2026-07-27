import type {
  CabinOverheatMode,
  CabinOverheatTemp,
  CameraMode,
  SeatClimateModeName,
  SeatPosition,
  SteeringWheelClimateModeName,
  VehicleStateKey,
  VehicleViewState,
} from '../types/vehicleTypes';
import {
  patchState,
  setCabinOverheatModeState,
  setCabinOverheatTempState,
  setCameraModeState,
  setChargeLimitState,
  setChargingAmpsState,
  setScreenCameraModeState,
  setSeatClimateState,
  setSteeringWheelClimateState,
  setTargetTempState,
  stepSeatClimateState,
  stepSteeringWheelClimateState,
  toggleState,
} from './fleet';

export interface VehicleActions {
  setCameraMode: (cameraMode: CameraMode) => void;
  setTirePressureVisible: (visible: boolean) => void;
  setScreenCameraMode: (cameraMode: CameraMode) => void;
  toggle: (key: VehicleStateKey) => void;
  patch: (patch: Partial<VehicleViewState>) => void;
  // Tapping the seat/wheel icon steps the level down (3→2→1→off); the menu sets the mode outright.
  stepSeatClimate: (seat: SeatPosition) => void;
  setSeatClimate: (seat: SeatPosition, mode: SeatClimateModeName) => void;
  stepSteeringWheelClimate: () => void;
  setSteeringWheelClimate: (mode: SteeringWheelClimateModeName) => void;
  // Setpoints. Each clamps to the car's domain, so callers may pass a raw computed value
  // (state.targetTempC + delta, a slider's pageX-derived percent) without pre-clamping.
  setTargetTemp: (tempC: number) => void;
  setCabinOverheatMode: (mode: CabinOverheatMode) => void;
  setCabinOverheatTemp: (temp: CabinOverheatTemp) => void;
  setChargeLimit: (percent: number) => void;
  setChargingAmps: (amps: number) => void;
}

// Builds the VehicleActions object from a single "apply an update to the active car's state"
// callback. The fleet hook provides `apply`; the action implementations live in fleet.ts so they
// stay pure and unit-tested.
export function buildVehicleActions(
  apply: (update: (state: VehicleViewState) => VehicleViewState) => void,
): VehicleActions {
  return {
    setCameraMode: (cameraMode) => apply((s) => setCameraModeState(s, cameraMode)),
    setTirePressureVisible: (visible) => apply((s) => ({ ...s, tirePressureVisible: visible })),
    setScreenCameraMode: (cameraMode) => apply((s) => setScreenCameraModeState(s, cameraMode)),
    toggle: (key) => apply((s) => toggleState(s, key)),
    patch: (partial) => apply((s) => patchState(s, partial)),
    stepSeatClimate: (seat) => apply((s) => stepSeatClimateState(s, seat)),
    setSeatClimate: (seat, mode) => apply((s) => setSeatClimateState(s, seat, mode)),
    stepSteeringWheelClimate: () => apply(stepSteeringWheelClimateState),
    setSteeringWheelClimate: (mode) => apply((s) => setSteeringWheelClimateState(s, mode)),
    setTargetTemp: (tempC) => apply((s) => setTargetTempState(s, tempC)),
    setCabinOverheatMode: (mode) => apply((s) => setCabinOverheatModeState(s, mode)),
    setCabinOverheatTemp: (temp) => apply((s) => setCabinOverheatTempState(s, temp)),
    setChargeLimit: (percent) => apply((s) => setChargeLimitState(s, percent)),
    setChargingAmps: (amps) => apply((s) => setChargingAmpsState(s, amps)),
  };
}
