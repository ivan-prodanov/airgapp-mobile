import type { CarModel } from '@/types/vehicleTypes';

import { vehicleGlyphName, type TeslaIconName } from './TeslaIcon';

// The Controls row / vehicle icon changes with the car's fascia (map: "Controls icon — model-resolved").
// The bundle ships four fascia buckets: Juniper Model Y (bayberry), pre-refresh 3/Y (model_3y),
// Model S, Model X. Highland Model 3 (Poppyseed) and Cybertruck ship raster-only and are not in the
// vector bundle, so Model 3 falls back to the pre-refresh 3/Y silhouette.
export function vehicleGlyphFor(model: CarModel, charge = false): TeslaIconName {
  const fascia =
    model === 'modelY'
      ? 'bayberry'
      : model === 'modelS' || model === 'modelSLegacy'
        ? 'model_s'
        : model === 'modelX' ||
            model === 'modelXLegacy' ||
            model === 'modelX6Seat' ||
            model === 'modelX7Seat'
          ? 'model_x'
          : // model3, model3Legacy, modelYLegacy → the pre-refresh 3/Y silhouette
            'model_3y';
  return vehicleGlyphName(fascia, charge);
}
