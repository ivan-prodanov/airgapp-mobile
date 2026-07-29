import type {
  CabinOverheatMode,
  ClimateKeeperMode,
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
  setBioweaponState,
  setClimateKeeperState,
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
  /**
   * Frunk actuate. NOT `toggle('frunkOpen')`.
   *
   * Always sends the command (the car's actuator toggles, and aftermarket
   * auto-close add-ons ride the same one), but only ever moves the optimistic
   * value to OPEN. Closed arrives from the stream or the poll.
   */
  actuateFrunk: () => void;
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
  setClimateKeeper: (mode: ClimateKeeperMode) => void;
  setBioweapon: (on: boolean) => void;
  setCabinOverheatTemp: (temp: CabinOverheatTemp) => void;
  setChargeLimit: (percent: number) => void;
  setChargingAmps: (amps: number) => void;
}

// Builds the VehicleActions object from a single "apply an update to the active car's state"
// callback. The fleet hook provides `apply`; the action implementations live in fleet.ts so they
// stay pure and unit-tested.
//
// The frunk double-tap fix does NOT live here. An earlier attempt guarded
// toggles whose command was still in flight; that only covered the ~1-2s the
// command takes, while the lid takes ~5s to open, so a tap at t=3s still
// produced an optimistic CLOSED the grace then defended. It also suppressed the
// re-actuate that an aftermarket auto-close needs. Replaced by asymmetric
// optimism in `actuateFrunkState` + an explicit dispatch — see fleet.ts.
export function buildVehicleActions(
  apply: (update: (state: VehicleViewState) => VehicleViewState) => void,
): Omit<VehicleActions, 'actuateFrunk'> {
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
    setClimateKeeper: (mode) => apply((s) => setClimateKeeperState(s, mode)),
    setBioweapon: (on) => apply((s) => setBioweaponState(s, on)),
    setCabinOverheatTemp: (temp) => apply((s) => setCabinOverheatTempState(s, temp)),
    setChargeLimit: (percent) => apply((s) => setChargeLimitState(s, percent)),
    setChargingAmps: (amps) => apply((s) => setChargingAmpsState(s, amps)),
  };
}
