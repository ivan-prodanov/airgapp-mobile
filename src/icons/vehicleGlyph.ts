import type { CarModel } from '@/types/vehicleTypes';

import type { TeslaIconName } from './TeslaIcon';

// The Controls-row car icon is model-resolved (ICON-MAP "Controls icon" table). The bundle splits it
// across two sets: standard models use a clean RN vector `vehicle-<model>-filled` (reg), and only the
// Juniper Model Y has no RN equivalent, so it uses the native glyph `vehicle-bayberry` (veh). The
// charge-port-bolt variant exists ONLY in the veh set, as `vehicle-<model>-charge` (no `-filled`).
//
// Our CarModel union never resolves to Cybertruck/Semi (the map lists `vehicle-cybertruck-filled` /
// `vehicle-semi-filled` for completeness), so the reachable buckets are just these four.
type Fascia = 'bayberry' | 'model_3y' | 'model_s' | 'model_x';

function fasciaFor(model: CarModel): Fascia {
  if (model === 'modelY') return 'bayberry'; // Juniper — native veh glyph only
  if (model === 'modelS' || model === 'modelSLegacy') return 'model_s';
  if (
    model === 'modelX' ||
    model === 'modelXLegacy' ||
    model === 'modelX6Seat' ||
    model === 'modelX7Seat'
  ) {
    return 'model_x';
  }
  return 'model_3y'; // model3, model3Legacy, modelYLegacy → pre-refresh 3/Y silhouette
}

export function vehicleGlyphFor(model: CarModel, charge = false): TeslaIconName {
  const slug = fasciaFor(model).replace('_', '-'); // model_3y → model-3y
  // Charge variant is native-only for every fascia: vehicle-<model>-charge.
  if (charge) return `vehicle-${slug}-charge` as TeslaIconName;
  // Base: Juniper MY = native veh glyph; every other model = the reg `-filled` vector.
  return (slug === 'bayberry' ? 'vehicle-bayberry' : `vehicle-${slug}-filled`) as TeslaIconName;
}
