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
//
// `isCommandInFlight` guards TOGGLES ONLY, and it is the fix for the frunk
// double-tap (P0, reported on-car 2026-07-27).
//
// `toggleState` derives the new value from `state[key]` — which, after a tap
// whose command has not landed, is an UNCONFIRMED optimistic guess. Frunk
// actuate is a TOGGLE: both taps send the same openFrunk, so the car may ignore
// the second outright while the lid is mid-travel. The app then holds a value
// the car never agreed to, and filterPatchUnderIntent DEFENDS it — the car's
// correcting read is a CONTRADICTION, and confirm-and-release only releases on
// agreement. Hence up to 30 seconds of confidently-wrong UI.
//
// Note what that rules out. Confirm-and-release shipped 2026-07-18, nine days
// BEFORE the report, so the roadmap's first suggested direction was already in
// place and cannot help here by construction. Shortening GRACE_MS would only
// shorten the wrong state. The value must not be produced in the first place.
//
// Only `toggle` is guarded, because only `toggle` derives from the current
// value. `patch`/`setTargetTemp`/`setChargeLimit` carry an ABSOLUTE value the
// user picked, so a second one is a legitimate new intent, not a compounding
// guess — and coalesce.ts already collapses those bursts.
//
// The guard lasts as long as the COMMAND (~1-2s over BLE, cleared on every
// terminal path in runDispatch), not the 30s grace. It is the same rule the
// official app expresses by disabling a control while its own command is busy:
// `disabled = useCommandTypeBusyStatus(...).busy`.
export function buildVehicleActions(
  apply: (update: (state: VehicleViewState) => VehicleViewState) => void,
  isCommandInFlight: (key: VehicleStateKey) => boolean = () => false,
): VehicleActions {
  return {
    setCameraMode: (cameraMode) => apply((s) => setCameraModeState(s, cameraMode)),
    setTirePressureVisible: (visible) => apply((s) => ({ ...s, tirePressureVisible: visible })),
    setScreenCameraMode: (cameraMode) => apply((s) => setScreenCameraModeState(s, cameraMode)),
    toggle: (key) => {
      // Dropped, not queued: for a toggle there is nothing meaningful to queue.
      // The user's second tap asks for "the other state", but which state that
      // is depends on an answer the car has not given yet.
      if (isCommandInFlight(key)) return;
      apply((s) => toggleState(s, key));
    },
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
