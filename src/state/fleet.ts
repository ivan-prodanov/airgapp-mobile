import {
  climateCapabilitiesFor,
  initialVehicleState,
  type CabinOverheatMode,
  type ClimateKeeperMode,
  type CabinOverheatTemp,
  type CameraMode,
  type CarModel,
  type SeatClimateCapability,
  type SeatClimateMode,
  type SeatClimateModeName,
  type SeatPosition,
  type SteeringWheelClimate,
  type SteeringWheelClimateModeName,
  type VehicleStateKey,
  type VehicleViewState,
} from '../types/vehicleTypes';

export interface Vehicle {
  id: string;
  name: string;
  // The enrolled car's VIN, bound at runtime from PiConfig (P3.T1). Present on
  // exactly ONE vehicle — the real car. Demo cars added via addVehicle have
  // none, which is what makes "is this the live car?" answerable at all.
  vin?: string;
  state: VehicleViewState;
  // Stable mock GPS offset from the user's live position (random bearing, fixed ~100 m). Generated
  // once at creation so the Location pin doesn't re-randomize on every render. Removed when BLE lands.
}

export interface FleetState {
  vehicles: Vehicle[];
  activeId: string;
}

const MODEL_BASE_NAME: Record<CarModel, string> = {
  modelS: 'Model S',
  model3: 'Model 3',
  modelX: 'Model X',
  modelY: 'Model Y',
  modelSLegacy: 'Model S (older)',
  model3Legacy: 'Model 3 (older)',
  modelXLegacy: 'Model X (older)',
  modelYLegacy: 'Model Y (older)',
  modelX6Seat: 'Model X (6-seat)',
  modelX7Seat: 'Model X (7-seat)',
};

export function createInitialFleet(): FleetState {
  return {
    vehicles: [
      { id: 'veh_1', name: 'Red Velvet', state: { ...initialVehicleState } },
    ],
    activeId: 'veh_1',
  };
}

// bindVehicleVin marks one vehicle as the enrolled car. Idempotent, and it
// CLEARS the vin from every other vehicle so the "live" car can never be
// ambiguous — two vins would silently share one gateway (see useCarLink's
// single-gateway invariant).
export function bindVehicleVin(fleet: FleetState, id: string, vin: string): FleetState {
  if (fleet.vehicles.every((v) => (v.id === id ? v.vin === vin : v.vin === undefined))) return fleet;
  return {
    ...fleet,
    vehicles: fleet.vehicles.map((v) =>
      v.id === id ? { ...v, vin } : v.vin === undefined ? v : { ...v, vin: undefined },
    ),
  };
}

export function activeIndex(fleet: FleetState): number {
  const index = fleet.vehicles.findIndex((v) => v.id === fleet.activeId);
  return index === -1 ? 0 : index;
}

export function activeVehicle(fleet: FleetState): Vehicle {
  return fleet.vehicles[activeIndex(fleet)];
}

function nextId(fleet: FleetState): string {
  const max = fleet.vehicles.reduce((acc, v) => {
    const n = Number(v.id.replace(/^veh_/, ''));
    return Number.isFinite(n) && n > acc ? n : acc;
  }, 0);
  return `veh_${max + 1}`;
}

function uniqueName(base: string, existing: string[]): string {
  if (!existing.includes(base)) {
    return base;
  }
  let n = 2;
  while (existing.includes(`${base} (${n})`)) {
    n += 1;
  }
  return `${base} (${n})`;
}

function defaultStateForModel(model: CarModel, inheritFrom: VehicleViewState): VehicleViewState {
  return {
    ...initialVehicleState,
    carModel: model,
    theme: inheritFrom.theme,
    lightingMode: inheritFrom.lightingMode,
  };
}

export function addVehicle(fleet: FleetState, model: CarModel): FleetState {
  const id = nextId(fleet);
  const name = uniqueName(MODEL_BASE_NAME[model], fleet.vehicles.map((v) => v.name));
  const inheritFrom = activeVehicle(fleet).state;
  const vehicle: Vehicle = {
    id,
    name,
    state: defaultStateForModel(model, inheritFrom),
  };
  return { vehicles: [...fleet.vehicles, vehicle], activeId: id };
}

export function removeVehicle(fleet: FleetState, id: string): FleetState {
  if (fleet.vehicles.length <= 1) {
    return fleet;
  }
  const index = fleet.vehicles.findIndex((v) => v.id === id);
  if (index === -1) {
    return fleet;
  }
  const vehicles = fleet.vehicles.filter((v) => v.id !== id);
  let activeId = fleet.activeId;
  if (id === fleet.activeId) {
    const neighbor = vehicles[index - 1] ?? vehicles[index] ?? vehicles[0];
    activeId = neighbor.id;
  }
  return { vehicles, activeId };
}

export function setActiveVehicle(fleet: FleetState, id: string): FleetState {
  return fleet.vehicles.some((v) => v.id === id) ? { ...fleet, activeId: id } : fleet;
}

export function nextVehicleId(fleet: FleetState): string {
  const i = activeIndex(fleet);
  return fleet.vehicles[Math.min(i + 1, fleet.vehicles.length - 1)].id;
}

export function prevVehicleId(fleet: FleetState): string {
  const i = activeIndex(fleet);
  return fleet.vehicles[Math.max(i - 1, 0)].id;
}

export function updateActiveVehicleState(
  fleet: FleetState,
  update: (state: VehicleViewState) => VehicleViewState,
): FleetState {
  const index = activeIndex(fleet);
  const vehicles = fleet.vehicles.slice();
  vehicles[index] = { ...vehicles[index], state: update(vehicles[index].state) };
  return { ...fleet, vehicles };
}

// Update the ENROLLED car's state — always vehicles[0], the real car by the
// app's single-enrolled-car assumption (see bindVehicleVin). Used ONLY for the
// launch-time cache rehydrate, which must seed the enrolled car with its own
// persisted telemetry regardless of which car is on screen or whether the live
// link is up yet — bypassing the "active-is-live" gate that live telemetry uses
// (that gate exists to stop live reads bleeding into a demo car; a rehydrate of
// the car's OWN last-known values is not that).
export function updateEnrolledVehicleState(
  fleet: FleetState,
  update: (state: VehicleViewState) => VehicleViewState,
): FleetState {
  if (!fleet.vehicles[0]) return fleet;
  const vehicles = fleet.vehicles.slice();
  vehicles[0] = { ...vehicles[0], state: update(vehicles[0].state) };
  return { ...fleet, vehicles };
}

// --- Active-vehicle state updaters (moved from the old useVehicleState; pure + reused by the hook) ---

export function patchState(state: VehicleViewState, partial: Partial<VehicleViewState>): VehicleViewState {
  return { ...state, ...partial };
}

export function toggleState(state: VehicleViewState, key: VehicleStateKey): VehicleViewState {
  const value = state[key];
  if (typeof value !== 'boolean') {
    return state;
  }
  return { ...state, [key]: !value };
}

// Frunk actuation is NOT a toggle of the view state, and that asymmetry is the
// fix for the double-tap defect.
//
// Recovered from the official app (sendFrunkCommand @3986012):
//
//     hasPoweredFrunk ? send(Front, !isOpen)   // a real directional close
//                     : send(Front, true)      // ALWAYS open. No close exists.
//
// A standard Model Y has no powered frunk, so their app cannot express "close"
// and therefore never guesses at one. The second tap re-sends the actuate and
// the UI waits for the car. `checkFrunkTrunkCommand` @1186905 confirms the same
// shape on the resolution side: an optimistic OPEN clears once the closure
// reports not-closed, a CLOSE once it reports closed, correlated by commandId.
//
// So: opening is safe to assume (the car always pops it), closing is not — the
// lid may be mid-travel, the car may ignore the repeat, or an aftermarket
// auto-close may or may not catch it. Returning the SAME OBJECT when already
// open matters: no state change means no reconciler emit and nothing for the
// intent grace to defend.
export function actuateFrunkState(state: VehicleViewState): VehicleViewState {
  return state.frunkOpen ? state : { ...state, frunkOpen: true };
}

/**
 * The keys the frunk actuate CLAIMS optimistically — which is not the same as
 * "the keys its command affects".
 *
 * `dispatch`'s affectedKeys does two jobs: it marks the control busy, and it
 * stamps the intent-grace window that suppresses contradicting reads. The
 * second job is only ever correct for a value we actually asserted.
 *
 * On a re-actuate we assert nothing (see actuateFrunkState), so claiming
 * `frunkOpen` there would suppress precisely the read we are waiting for: the
 * car reports CLOSED, our value still says OPEN, and filterPatchUnderIntent
 * strips it as a contradiction for up to 30s. That is the original defect with
 * the directions reversed, and it is what this function exists to prevent.
 *
 * The cost is that the re-actuate tap shows no busy affordance, because the two
 * jobs share one parameter. Correctness first; the affordance is worth
 * separating later.
 */
export function frunkActuateClaimedKeys(state: VehicleViewState): VehicleStateKey[] {
  return state.frunkOpen ? [] : ['frunkOpen'];
}

export function setCameraModeState(state: VehicleViewState, cameraMode: CameraMode): VehicleViewState {
  return { ...state, cameraMode };
}

export function setScreenCameraModeState(state: VehicleViewState, cameraMode: CameraMode): VehicleViewState {
  return {
    ...state,
    cameraMode,
    tirePressureVisible: cameraMode === 'TOP_DOWN' ? state.tirePressureVisible : false,
  };
}

// --- Climate controls: the official app's TWO interactions ---------------------------------------
// 1. Tapping the seat/wheel ICON steps the *level* DOWN within the current mode (e.g. 3→2→1→off);
//    from off it jumps to the current mode's max level (heat by default). See step*ClimateState.
// 2. The Heat/Cool/Auto popup MENU switches *mode*, snapping to that mode's max level. See set*.

function seatCapsFor(state: VehicleViewState, seat: SeatPosition): SeatClimateCapability {
  return climateCapabilitiesFor(state.carModel).seats[seat];
}

// Icon tap: ramp the level down, falling to off after level 1 (auto has no level, so it falls to off).
function steppedSeat(current: SeatClimateMode, caps: SeatClimateCapability): SeatClimateMode {
  if (current.mode === 'off') {
    return caps.heatLevels > 0 ? { mode: 'heat', level: caps.heatLevels } : current;
  }
  if (current.mode === 'heat' || current.mode === 'cool') {
    return current.level > 1
      ? { mode: current.mode, level: (current.level - 1) as 1 | 2 | 3 }
      : { mode: 'off', level: 0 };
  }
  return { mode: 'off', level: 0 };
}

// Menu choice: enter `mode` at its max level (heat/cool) or as plain auto.
function chosenSeat(mode: SeatClimateModeName, caps: SeatClimateCapability): SeatClimateMode {
  switch (mode) {
    case 'heat':
      return { mode: 'heat', level: (caps.heatLevels || 1) as 1 | 2 | 3 };
    case 'cool':
      return { mode: 'cool', level: (caps.coolLevels || 1) as 1 | 2 | 3 };
    case 'auto':
      return { mode: 'auto', level: 0 };
    default:
      return { mode: 'off', level: 0 };
  }
}

function withSeat(state: VehicleViewState, seat: SeatPosition, next: SeatClimateMode): VehicleViewState {
  return { ...state, seatClimateModes: { ...state.seatClimateModes, [seat]: next } };
}

export function stepSeatClimateState(state: VehicleViewState, seat: SeatPosition): VehicleViewState {
  return withSeat(state, seat, steppedSeat(state.seatClimateModes[seat], seatCapsFor(state, seat)));
}

export function setSeatClimateState(
  state: VehicleViewState,
  seat: SeatPosition,
  mode: SeatClimateModeName,
): VehicleViewState {
  return withSeat(state, seat, chosenSeat(mode, seatCapsFor(state, seat)));
}

// Steering wheel: same shape, but capped at level 2 and with no cooling.
function steppedWheel(current: SteeringWheelClimate, heatLevels: 0 | 1 | 2): SteeringWheelClimate {
  if (current.mode === 'off') {
    return heatLevels > 0 ? { mode: 'heat', level: heatLevels } : current;
  }
  if (current.mode === 'heat') {
    return current.level > 1 ? { mode: 'heat', level: (current.level - 1) as 1 } : { mode: 'off', level: 0 };
  }
  return { mode: 'off', level: 0 };
}

export function stepSteeringWheelClimateState(state: VehicleViewState): VehicleViewState {
  const caps = climateCapabilitiesFor(state.carModel).steeringWheel;
  return { ...state, steeringWheelClimate: steppedWheel(state.steeringWheelClimate, caps.heatLevels) };
}

export function setSteeringWheelClimateState(
  state: VehicleViewState,
  mode: SteeringWheelClimateModeName,
): VehicleViewState {
  const caps = climateCapabilitiesFor(state.carModel).steeringWheel;
  const next: SteeringWheelClimate =
    mode === 'heat'
      ? { mode: 'heat', level: (caps.heatLevels || 1) as 1 | 2 }
      : mode === 'auto'
        ? { mode: 'auto', level: 0 }
        : { mode: 'off', level: 0 };
  return { ...state, steeringWheelClimate: next };
}

// --- Setpoints: climate temperature, charge limit, charging current ------------------------------
// The clamp domains live here (not in the screens) because they are properties of the CAR, not of a
// view: the BLE command layer must clamp to exactly the same bounds before it dispatches a setpoint.
// The screens import them only for display/disabled state.

// Temperature dial domain (matches the real app): LO, 15.5, 16.0 … 27.5, HI in 0.5° steps.
// 15.0 is the LO sentinel, 28.0 is HI; everything in between shows the number.
export const LO_TEMP = 15;
export const HI_TEMP = 28;
// Charge-limit slider domain (Tesla: daily 50% up to trip 100%).
export const LIMIT_MIN = 50;
export const LIMIT_MAX = 100;
// Charging current stepper domain, per spec: 5 A … 16 A.
export const AMP_MIN = 5;
export const AMP_MAX = 16;
// Speed-limit domain. Stored in MPH — the unit the car's command takes (DrivingSetSpeedLimitAction
// .limitMph) — but the DOMAIN and the stepper are in km/h, matching the Tesla app, whose Adjust Speed
// Limit stepper is configured `{ step: 1, unit: isMetric ? 'kilometer-per-hour' : 'mile-per-hour' }`,
// i.e. it steps the DISPLAYED unit by 1 and converts at dispatch. So the UI moves 116→115→114, not the
// jumpy 116→114 you get from stepping mph and re-deriving km/h.
//
// The stored mph is the EXACT (unrounded) conversion of the chosen km/h, so km/h round-trips precisely
// (round(mphToKmh(kmhToMph(k))) === k) and successive 1-km/h steps never collapse or skip. The car only
// resolves whole mph, so the BLE builder rounds at dispatch (two adjacent km/h can land on one mph limit —
// unavoidable at the car's granularity, and invisible in the UI).
export const SPEED_LIMIT_MIN_KMH = 80;
export const SPEED_LIMIT_MAX_KMH = 193;
// The speed steppers show their number immediately but only send the car command this long after the last
// change — verbatim from the Tesla app's Adjust-Speed-Limit control (`debounceMS: 1200`).
export const SPEED_LIMIT_DEBOUNCE_MS = 1200;

const clamp = (v: number, min: number, max: number) => Math.min(max, Math.max(min, v));

const MI_PER_KM = 0.621371;
export const kmhToMph = (kmh: number): number => kmh * MI_PER_KM;
export const mphToKmh = (mph: number): number => mph / MI_PER_KM;
// The whole-km/h value shown for a stored mph value — the unit the steppers move in.
export const speedLimitDisplayKmh = (mph: number): number => Math.round(mphToKmh(mph));

// Clamp a km/h value into the domain and return the EXACT mph to store for it.
export const clampSpeedLimitKmh = (kmh: number): number =>
  clamp(Math.round(kmh), SPEED_LIMIT_MIN_KMH, SPEED_LIMIT_MAX_KMH);
export const speedLimitKmhToStoredMph = (kmh: number): number => kmhToMph(clampSpeedLimitKmh(kmh));

export function setTargetTempState(state: VehicleViewState, tempC: number): VehicleViewState {
  // Round to the nearest half-degree BEFORE clamping so the dial can only ever land on a real detent.
  return { ...state, targetTempC: clamp(Math.round(tempC * 2) / 2, LO_TEMP, HI_TEMP) };
}

// Camp/Pet as the car models them: ONE value. Setting either implicitly clears
// the other, which is not a policy we invented — it is what the vehicle does,
// and what Tesla's own screen warns about before it happens.
export function setClimateKeeperState(
  state: VehicleViewState,
  mode: ClimateKeeperMode,
): VehicleViewState {
  return state.climateKeeper === mode ? state : { ...state, climateKeeper: mode };
}

export function setCabinOverheatModeState(
  state: VehicleViewState,
  cabinOverheatMode: CabinOverheatMode,
): VehicleViewState {
  return { ...state, cabinOverheatMode };
}

export function setCabinOverheatTempState(
  state: VehicleViewState,
  cabinOverheatTemp: CabinOverheatTemp,
): VehicleViewState {
  return { ...state, cabinOverheatTemp };
}

export function setChargeLimitState(state: VehicleViewState, percent: number): VehicleViewState {
  return { ...state, chargeLimitPercent: clamp(Math.round(percent), LIMIT_MIN, LIMIT_MAX) };
}

export function setChargingAmpsState(state: VehicleViewState, amps: number): VehicleViewState {
  return { ...state, chargingAmps: clamp(Math.round(amps), AMP_MIN, AMP_MAX) };
}
