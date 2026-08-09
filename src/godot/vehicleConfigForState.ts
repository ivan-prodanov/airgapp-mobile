// configForState — the product config to render for the active car.
//
// Split out of vehicleStateAdapter.ts (which imports react-native for PixelRatio)
// so it stays a pure, node-testable module like vehicleVisualState.ts.
//
// It takes the model's base config from vehicleConfigs and merges the per-car
// overrides (chosen in Add Car) into vehicle_config when present. `Vehicle.update()`
// on the Godot side re-applies exterior_color, wheel_type, interior_trim_type,
// red_brake_calipers and spoiler on every SHOW/UPDATE_PRODUCT, so this merge is all
// it takes to configure a specific car — including two same-model cars that differ
// only in color.
//   performance → red brake calipers + the body's rear spoiler (set_has_spoiler just
//   toggles that body's own spoiler node, so enabling it on a body without one is a
//   harmless no-op — no per-model spoiler table needed) + the front FASCIA on the
//   Highland (3) / Juniper (Y) bodies, whose body script swaps a standard/perf fascia
//   mesh off the `fascia_type` string (same body scene either way — verified in
//   ProductManager.get_vehicle_node_path). Other bodies have no such fascia toggle.

import { vehicleConfigs, type CarModel, type VehicleConfig, type VehicleViewState } from '../types/vehicleTypes';

// [performanceFascia, baseFascia] for the models whose current body carries a
// perf/standard front-fascia variant. Only these swap fascia by trim.
const FASCIA_BY_MODEL: Partial<Record<CarModel, [string, string]>> = {
  modelY: ['performanceBayberry', 'baseBayberry'],
  model3: ['performancePoppyseed', 'basePoppyseed'],
};

export function configForState(state: VehicleViewState): VehicleConfig {
  const base = vehicleConfigs[state.carModel];
  // No overrides → return the shared base object unchanged (cheap + referentially
  // stable for anything that memoizes on it).
  if (
    state.exteriorColor == null &&
    state.wheelType == null &&
    state.interiorTrim == null &&
    state.performance == null
  ) {
    return base;
  }
  const fascia = state.performance != null ? FASCIA_BY_MODEL[state.carModel] : undefined;
  return {
    ...base,
    vehicle_config: {
      ...base.vehicle_config,
      ...(state.exteriorColor != null ? { exterior_color: state.exteriorColor } : {}),
      ...(state.wheelType != null ? { wheel_type: state.wheelType } : {}),
      ...(state.interiorTrim != null ? { interior_trim_type: state.interiorTrim } : {}),
      ...(state.performance != null
        ? { red_brake_calipers: state.performance, spoiler_type: state.performance ? 'CarbonFiber' : 'None' }
        : {}),
      ...(fascia ? { fascia_type: state.performance ? fascia[0] : fascia[1] } : {}),
    },
  };
}
