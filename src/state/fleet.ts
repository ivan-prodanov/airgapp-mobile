import { createMockLocationOffset, type MockLocationOffset } from './mockLocation';
import {
  climateCapabilitiesFor,
  initialVehicleState,
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
  state: VehicleViewState;
  // Stable mock GPS offset from the user's live position (random bearing, fixed ~100 m). Generated
  // once at creation so the Location pin doesn't re-randomize on every render. Removed when BLE lands.
  mockLocationOffset: MockLocationOffset;
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
      { id: 'veh_1', name: 'Red Velvet', state: { ...initialVehicleState }, mockLocationOffset: createMockLocationOffset() },
    ],
    activeId: 'veh_1',
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
    mockLocationOffset: createMockLocationOffset(),
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
