import { useCallback, useMemo, useState } from 'react';

import type { CarModel, VehicleViewState } from '../types/vehicleTypes';
import {
  activeIndex,
  activeVehicle,
  addVehicle,
  createInitialFleet,
  nextVehicleId,
  prevVehicleId,
  removeVehicle,
  setActiveVehicle,
  updateActiveVehicleState,
  type FleetState,
  type Vehicle,
} from './fleet';
import { buildVehicleActions, type VehicleActions } from './useVehicleState';

export interface Fleet {
  vehicles: Vehicle[];
  activeId: string;
  activeIndex: number;
  activeName: string;
  addVehicle: (model: CarModel) => void;
  removeVehicle: (id: string) => void;
  setActiveVehicle: (id: string) => void;
  nextVehicle: () => void;
  prevVehicle: () => void;
}

export function useFleetState(): {
  active: [VehicleViewState, VehicleActions];
  activeId: string;
  fleet: Fleet;
} {
  const [fleet, setFleet] = useState<FleetState>(createInitialFleet);

  const applyActive = useCallback(
    (update: (state: VehicleViewState) => VehicleViewState) =>
      setFleet((current) => updateActiveVehicleState(current, update)),
    [],
  );
  const actions = useMemo(() => buildVehicleActions(applyActive), [applyActive]);

  const current = activeVehicle(fleet);

  const fleetApi: Fleet = {
    vehicles: fleet.vehicles,
    activeId: fleet.activeId,
    activeIndex: activeIndex(fleet),
    activeName: current.name,
    addVehicle: (model) => setFleet((f) => addVehicle(f, model)),
    removeVehicle: (id) => setFleet((f) => removeVehicle(f, id)),
    setActiveVehicle: (id) => setFleet((f) => setActiveVehicle(f, id)),
    nextVehicle: () => setFleet((f) => setActiveVehicle(f, nextVehicleId(f))),
    prevVehicle: () => setFleet((f) => setActiveVehicle(f, prevVehicleId(f))),
  };

  return { active: [current.state, actions], activeId: fleet.activeId, fleet: fleetApi };
}
