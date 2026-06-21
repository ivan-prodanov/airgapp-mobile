import { createContext, useContext, type ReactNode } from 'react';

import { useVehicleState, type VehicleActions } from './useVehicleState';
import type { VehicleViewState } from '../types/vehicleTypes';

type VehicleContextValue = [VehicleViewState, VehicleActions];

const VehicleContext = createContext<VehicleContextValue | null>(null);

// One shared vehicle state for the whole app. The Home tab renders the car from it; the Explore tab
// drives it (awake/asleep + demo toggles). Lives above the tab navigator so both tabs stay in sync.
export function VehicleProvider({ children }: { children: ReactNode }) {
  const value = useVehicleState();
  return <VehicleContext.Provider value={value}>{children}</VehicleContext.Provider>;
}

export function useVehicle(): VehicleContextValue {
  const ctx = useContext(VehicleContext);
  if (!ctx) {
    throw new Error('useVehicle must be used inside <VehicleProvider>');
  }
  return ctx;
}
