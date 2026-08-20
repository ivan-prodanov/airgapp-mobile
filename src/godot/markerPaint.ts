// Tesla's "is the car light-coloured?" logic — it drives the frunk label's text
// colour on Controls, and nothing else.
//
// Source: docs/superpowers/research/tesla-transitions-markers-FINDINGS.md §2c,
// read verbatim from the iOS bundle and re-derived twice.
//
// The user was right that this exists ("the text is not white if the car is
// white"), and it is FOUR tiers deep:
//
//   1. `frunk_color` — an HSB triple Godot SAMPLES from a 41x41-px box of the
//      actually-rendered viewport around the frunk marker, returned raw in the
//      VEHICLE_MARKERS_RESPONSE (it's the one key exempt from the device-pixel
//      -> DP conversion). If present, isLightHSB() decides. This is the tier the
//      real app usually takes.
//   2. `getBlendColor(config)` (wires in paint_color_override) -> isLightHSB.
//   3. Cybertruck -> false.
//   4. `isLightColorFor(exteriorColor)` — the paint-enum table below.
//
// WE IMPLEMENT TIERS 3-4 ONLY. Our renderer doesn't sample the frunk pixel box,
// so we can't do tier 1; findings §2c says the enum table "reproduces it for
// stock paints", and it is also the ONLY path the real app takes whenever the
// marker fallback is used (those dicts carry no frunk_color). Flagged as a known
// divergence for a repainted/wrapped car.

import { configForState } from './vehicleConfigForState';
import type { VehicleViewState } from '../types/vehicleTypes';

// isLightHSB — fn #30231 (iOS 1240024), VERBATIM. Kept for when/if we can sample
// the render (tier 1) or resolve a blend colour (tier 2).
export function isLightHSB(h: number, s: number, b: number): boolean {
  if (b > 0.55) return true; // bright -> light
  if (b < 0.38) return false; // dark -> dark
  if (s < 0.3) return true; // desaturated -> light
  return h < 180; // warm hue light, cool hue dark
}

// isLightColorFor — fn #12652 (iOS 500287-500440). Their enum is the protobuf
// oneof case `CarServer.ExteriorColor.TypeCase`; we carry the name as a string,
// so match case-insensitively on the enum name.
//
// NOTE the default: null / undefined / UNKNOWN / TYPE_NOT_SET all return TRUE
// (light). A paint that isn't in either list returns undefined in their code,
// which is falsy => treated as dark.
const LIGHT_PAINTS = new Set(['unknown', 'pearlwhite', 'white', 'pearl', 'silkroadsilver']);

const DARK_PAINTS = new Set([
  'redmulticoat',
  'solidblack',
  'silvermetallic',
  'midnightsilver',
  'deepblue',
  'defaultcolor',
  'black',
  'silver',
  'grey',
  'blue',
  'green',
  'brown',
  'sigred',
  'red',
  'steelgrey',
  'metallicblack',
  'titaniumcopper',
  'signatureblue',
  'midnightcherryred',
  'quicksilver',
  'ultrared',
  'stealthgrey',
  'lunarsilver',
  'glacierblue',
  'diamondblack',
  'frostblue',
  'marineblue',
  'garnetred',
]);

export function isLightExteriorColor(exteriorColor: string | null | undefined): boolean {
  // Their TYPE_NOT_SET(0) / UNKNOWN(3) / null / undefined branch -> true.
  if (!exteriorColor) return true;
  const key = exteriorColor.toLowerCase().replace(/[\s_-]/g, '');
  if (LIGHT_PAINTS.has(key)) return true;
  if (DARK_PAINTS.has(key)) return false;
  // Not in either list: their table returns undefined -> falsy -> dark.
  return false;
}

// frunkLabelDark — should the frunk "Open/Close" label render dark (for contrast
// on a light-painted car)? It MUST read the car's EFFECTIVE colour — the same one
// Godot renders, i.e. configForState(state), which overlays the per-car
// `exteriorColor` pick onto the model's base config. Reading the raw model base
// (vehicleConfigs[carModel]) instead was a bug: the label tracked the model's
// DEFAULT paint, not the colour actually selected, so e.g. Model X (base
// PearlWhite) was always dark and every other model (dark base) was always white,
// regardless of the chosen colour.
export function frunkLabelDark(state: VehicleViewState): boolean {
  return isLightExteriorColor(configForState(state).vehicle_config.exterior_color);
}
