import {
  initialVehicleState,
  modelYProductConfig,
  type CameraMode,
  type CarModel,
  type SeatClimateMode,
  type SeatPosition,
  type SteeringWheelClimateMode,
  type VehicleStateKey,
  type VehicleViewState,
} from '../types/vehicleTypes';

export interface Vehicle {
  id: string;
  name: string;
  state: VehicleViewState;
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
};

export function createInitialFleet(): FleetState {
  return {
    vehicles: [{ id: 'veh_1', name: 'Red Velvet', state: { ...initialVehicleState } }],
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
  const vehicle: Vehicle = { id, name, state: defaultStateForModel(model, inheritFrom) };
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

export function cycleSteeringWheelClimateState(state: VehicleViewState): VehicleViewState {
  const caps = modelYProductConfig.climate_capabilities.steeringWheel;
  const sequence: SteeringWheelClimateMode[] = ['off'];
  if (caps.heating) {
    sequence.push('heat');
  }
  if (caps.auto) {
    sequence.push('auto');
  }
  return { ...state, steeringWheelClimateMode: nextInSequence(sequence, state.steeringWheelClimateMode) };
}

export function cycleSeatClimateState(state: VehicleViewState, seat: SeatPosition): VehicleViewState {
  const caps = modelYProductConfig.climate_capabilities.seats[seat];
  const sequence = seatClimateSequence(caps.heatLevels, caps.coolLevels, caps.auto);
  return {
    ...state,
    seatClimateModes: {
      ...state.seatClimateModes,
      [seat]: nextSeatMode(sequence, state.seatClimateModes[seat]),
    },
  };
}

function nextInSequence<T>(sequence: T[], current: T): T {
  const index = sequence.indexOf(current);
  return sequence[(index + 1) % sequence.length] ?? sequence[0];
}

function seatClimateSequence(heatLevels: 0 | 1 | 2 | 3, coolLevels: 0 | 1 | 2 | 3, auto: boolean): SeatClimateMode[] {
  const sequence: SeatClimateMode[] = [{ mode: 'off', level: 0 }];
  for (let level = 1; level <= heatLevels; level += 1) {
    sequence.push({ mode: 'heat', level: level as 1 | 2 | 3 });
  }
  if (auto) {
    sequence.push({ mode: 'auto', level: 0 });
  }
  for (let level = 1; level <= coolLevels; level += 1) {
    sequence.push({ mode: 'cool', level: level as 1 | 2 | 3 });
  }
  return sequence;
}

function nextSeatMode(sequence: SeatClimateMode[], current: SeatClimateMode): SeatClimateMode {
  const index = sequence.findIndex((item) => item.mode === current.mode && item.level === current.level);
  return sequence[(index + 1) % sequence.length] ?? sequence[0];
}
