import { createContext, useContext, useMemo, type ReactNode } from 'react';

import { useFleetState, type Fleet } from './useFleetState';
import type { CarLinkStatus } from './useCarLink';
import { usePersistedReducer } from './usePersistedReducer';
import { appStorage } from './appStorage';
import { defaultPreferences, favoritesFor, preferencesReducer } from './preferences';
import type { ControlActionId } from './controlActions';
import type { VehicleActions } from './useVehicleState';
import type { VehicleViewState } from '../types/vehicleTypes';

type VehicleContextValue = [VehicleViewState, VehicleActions];

interface PreferencesApi {
  favorites: ControlActionId[];
  setFavorite: (slotIndex: number, id: ControlActionId) => void;
}

const VehicleContext = createContext<VehicleContextValue | null>(null);
const ActiveIdContext = createContext<string | null>(null);
const FleetContext = createContext<Fleet | null>(null);
const PreferencesContext = createContext<PreferencesApi | null>(null);
const CarLinkStatusContext = createContext<CarLinkStatus | null>(null);

// One shared fleet for the whole app. `useVehicle()` returns the ACTIVE car's [state, actions] so
// existing screens are unchanged; `useFleet()` exposes the list + add/remove/select; the Godot
// canvas reads `useActiveVehicleId()` to detect identity switches (vs. field edits). `usePreferences()`
// exposes app-global UI preferences (the customizable favorites bar), persisted via the persistence
// layer (in-memory by default).
export function VehicleProvider({ children }: { children: ReactNode }) {
  const { active, activeId, fleet, carLinkStatus } = useFleetState();
  // appStorage = AsyncStorage-backed, so the favorites bar survives relaunch.
  // memoryBackend (the old value) was an in-process Map — customizations were
  // lost on every cold start. AsyncStorage is already in the build (useCarLink).
  // v2: the shape is now a per-vehicle map (was a single global list).
  const [prefs, dispatch] = usePersistedReducer(
    appStorage,
    'prefs.v2',
    defaultPreferences,
    preferencesReducer,
  );

  // Favorites are per-vehicle (Tesla keys `quickControlsLayout` by VIN), so the
  // bar reflects the ACTIVE car and edits write to that car's entry.
  const preferences = useMemo<PreferencesApi>(
    () => ({
      favorites: favoritesFor(prefs, activeId),
      setFavorite: (slotIndex, id) => dispatch({ type: 'setFavorite', vehicleId: activeId, slotIndex, id }),
    }),
    [prefs, activeId, dispatch],
  );

  return (
    <FleetContext.Provider value={fleet}>
      <ActiveIdContext.Provider value={activeId}>
        <CarLinkStatusContext.Provider value={carLinkStatus}>
          <PreferencesContext.Provider value={preferences}>
            <VehicleContext.Provider value={active}>{children}</VehicleContext.Provider>
          </PreferencesContext.Provider>
        </CarLinkStatusContext.Provider>
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

export function usePreferences(): PreferencesApi {
  const ctx = useContext(PreferencesContext);
  if (!ctx) {
    throw new Error('usePreferences must be used inside <VehicleProvider>');
  }
  return ctx;
}

// Live connection/transport/freshness for the linked car. Read by Home to pick
// the one-line status ("Connecting" / "Parked" / "Asleep 5 minutes" / "Last
// seen 2 hours ago") the official app shows under the car name.
export function useCarLinkStatus(): CarLinkStatus {
  const ctx = useContext(CarLinkStatusContext);
  if (!ctx) {
    throw new Error('useCarLinkStatus must be used inside <VehicleProvider>');
  }
  return ctx;
}
