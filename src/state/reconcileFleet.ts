import type { EnrolledCars } from '../ble/types';
import type { FleetState, Vehicle } from './fleet';
import { vehicleFromConfig, vehicleFromCarConfig } from './fleet';
import type { PersistedFleet } from './fleetStore';

export function reconcileFleet(persisted: PersistedFleet | null, enrolled: EnrolledCars): FleetState {
  const enrolledByVin = new Map(enrolled.cars.map((c) => [c.vin, c]));
  const listed = persisted?.order ?? [];
  const vehicles: Vehicle[] = [];
  const seenVins = new Set<string>();

  for (const row of listed) {
    if (row.vin) {
      if (!enrolledByVin.has(row.vin)) continue; // car forgotten since last launch — drop it
      if (seenVins.has(row.vin)) continue;        // duplicate VIN row (corrupt data) — keep only the first
      seenVins.add(row.vin);
    }
    vehicles.push(vehicleFromConfig(row.id, row.name, row.config, row.vin));
  }

  // Append any enrolled car the persisted list did not carry (paired out-of-band, or first boot
  // after upgrade where fleet.v1 does not exist yet). The id counter is seeded from EVERY persisted
  // id, including dropped rows, so an appended car never reuses a forgotten car's id (which would
  // let a stale activeId land on the new car instead of falling back).
  let n = (persisted?.order ?? []).reduce(
    (max, r) => Math.max(max, Number(r.id.replace(/^veh_/, '')) || 0), 0);
  for (const cfg of enrolled.cars) {
    if (seenVins.has(cfg.vin)) continue;
    vehicles.push(vehicleFromCarConfig(`veh_${++n}`, cfg));
  }

  const activeId =
    persisted?.activeId && vehicles.some((v) => v.id === persisted.activeId)
      ? persisted.activeId
      : (vehicles[0]?.id ?? '');
  return { vehicles, activeId };
}
