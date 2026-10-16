import type { AppStorage } from './persistence';
import { isCarModel, type FleetState, type VehicleConfig } from './fleet';

export const FLEET_STORAGE_KEY = 'fleet.v1';

export interface PersistedVehicle {
  id: string;
  name: string;
  vin?: string;
  config: VehicleConfig;
}
export interface PersistedFleet {
  version: 1;
  order: PersistedVehicle[];
  activeId: string | null;
}

export function toPersisted(fleet: FleetState): PersistedFleet {
  return {
    version: 1,
    activeId: fleet.activeId || null,
    order: fleet.vehicles.map((v) => ({
      id: v.id,
      name: v.name,
      ...(v.vin ? { vin: v.vin } : {}),
      config: {
        carModel: v.state.carModel,
        exteriorColor: v.state.exteriorColor,
        wheelType: v.state.wheelType,
        interiorTrim: v.state.interiorTrim,
        performance: v.state.performance,
      },
    })),
  };
}

export async function loadPersistedFleet(storage: AppStorage): Promise<PersistedFleet | null> {
  try {
    const raw = await storage.getItem(FLEET_STORAGE_KEY);
    if (!raw) return null;
    const parsed = JSON.parse(raw) as Partial<PersistedFleet>;
    if (parsed.version !== 1 || !Array.isArray(parsed.order)) return null;
    const entriesOk = parsed.order.every(
      (v): v is PersistedVehicle =>
        !!v && typeof v === 'object' &&
        typeof (v as PersistedVehicle).id === 'string' &&
        typeof (v as PersistedVehicle).name === 'string' &&
        ((v as PersistedVehicle).vin === undefined || typeof (v as PersistedVehicle).vin === 'string') &&
        !!(v as PersistedVehicle).config && typeof (v as PersistedVehicle).config === 'object' &&
        isCarModel((v as PersistedVehicle).config.carModel),
    );
    if (!entriesOk) return null;
    const activeId = typeof parsed.activeId === 'string' ? parsed.activeId : null;
    return { version: 1, order: parsed.order as PersistedVehicle[], activeId };
  } catch {
    return null; // corrupt payload — treat as no persisted fleet
  }
}

export async function savePersistedFleet(storage: AppStorage, f: PersistedFleet): Promise<void> {
  await storage.setItem(FLEET_STORAGE_KEY, JSON.stringify(f));
}
