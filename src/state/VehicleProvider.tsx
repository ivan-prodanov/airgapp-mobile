import { createContext, useContext, type ReactNode } from 'react';

import { useFleetState, type Fleet } from './useFleetState';
import type { VehicleActions } from './useVehicleState';
import type { VehicleViewState } from '../types/vehicleTypes';

type VehicleContextValue = [VehicleViewState, VehicleActions];

const VehicleContext = createContext<VehicleContextValue | null>(null);
const ActiveIdContext = createContext<string | null>(null);
const FleetContext = createContext<Fleet | null>(null);

// One shared fleet for the whole app. `useVehicle()` returns the ACTIVE car's [state, actions] so
// existing screens are unchanged; `useFleet()` exposes the list + add/remove/select; the Godot
// canvas reads `useActiveVehicleId()` to detect identity switches (vs. field edits).
export function VehicleProvider({ children }: { children: ReactNode }) {
  const { active, activeId, fleet } = useFleetState();
  return (
    <FleetContext.Provider value={fleet}>
      <ActiveIdContext.Provider value={activeId}>
        <VehicleContext.Provider value={active}>{children}</VehicleContext.Provider>
      </ActiveIdContext.Provider>
    </FleetContext.Provider>
  );
}

export function useVehicle(): VehicleContextValue {
  const ctx = useContext(VehicleContext);
  if (!ctx) {
    throw new Error('useVehicle must be used inside <VehicleProvider>');
  }
  return ctx;
}

export function useActiveVehicleId(): string {
  const ctx = useContext(ActiveIdContext);
  if (ctx === null) {
    throw new Error('useActiveVehicleId must be used inside <VehicleProvider>');
  }
  return ctx;
}

export function useFleet(): Fleet {
  const ctx = useContext(FleetContext);
  if (!ctx) {
    throw new Error('useFleet must be used inside <VehicleProvider>');
  }
  return ctx;
}
