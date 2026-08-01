import type { ImageSourcePropType } from 'react-native';

import type { CarModel } from '@/types/vehicleTypes';

// Native RASTER glyphs (native-png/) — the Tesla app ships these as bitmaps with no vector in the
// design-system catalog (ICON-MAP.md "png" set). Rendered via <Image> in AppIcon; most are gray
// templates tinted at render time, except sentry_on which is baked RED. Metro bundles these through
// require(), so they deploy JS-only (deploy-js.sh rsyncs the asset tree into the .app).

export const DISCO_LIGHT: ImageSourcePropType = require('./native-png/disco_light.png');
export const FART_PNG: ImageSourcePropType = require('./native-png/fart.png');

export const LOW_POWER = {
  off: require('./native-png/low_power_mode_off.png') as ImageSourcePropType,
  on: require('./native-png/low_power_mode_on.png') as ImageSourcePropType,
  onDisabled: require('./native-png/low_power_mode_on_disabled.png') as ImageSourcePropType,
};

export const SENTRY = {
  on: require('./native-png/sentry_on.png') as ImageSourcePropType, // baked RED — render with tint:false
  off: require('./native-png/sentry_off.png') as ImageSourcePropType, // gray template — tint it
};

// Defrost car — model-resolved (ICON-MAP Defrost table). No S/X-specific asset exists, so they and the
// pre-refresh bodies fall back to the generic defrost_car.
const DEFROST = {
  bayberry: require('./native-png/defrost_bayberry.png') as ImageSourcePropType,
  poppyseed: require('./native-png/defrost_poppyseed.png') as ImageSourcePropType,
  car: require('./native-png/defrost_car.png') as ImageSourcePropType,
};

export function defrostPng(model: CarModel): ImageSourcePropType {
  if (model === 'modelY') return DEFROST.bayberry; // Juniper
  if (model === 'model3') return DEFROST.poppyseed; // Highland
  return DEFROST.car; // pre-refresh 3/Y + S/X (no dedicated asset)
}

// Unlatch door — model + drive-side resolved (ICON-MAP Unlatch table). Drive-side defaults to LHD (no
// RHD state is modelled; the RHD assets are wired for when it is). Only bayberry/poppyseed have a
// fascia-specific asset; everything else uses the generic pre-refresh door.
const UNLATCH = {
  lhd: require('./native-png/unlatch_door_lhd.png') as ImageSourcePropType,
  lhd_bayberry: require('./native-png/unlatch_door_lhd_bayberry.png') as ImageSourcePropType,
  lhd_poppyseed: require('./native-png/unlatch_door_lhd_poppyseed.png') as ImageSourcePropType,
  rhd: require('./native-png/unlatch_door_rhd.png') as ImageSourcePropType,
  rhd_bayberry: require('./native-png/unlatch_door_rhd_bayberry.png') as ImageSourcePropType,
  rhd_poppyseed: require('./native-png/unlatch_door_rhd_poppyseed.png') as ImageSourcePropType,
};

export function unlatchPng(model: CarModel, side: 'lhd' | 'rhd' = 'lhd'): ImageSourcePropType {
  const fascia = model === 'modelY' ? '_bayberry' : model === 'model3' ? '_poppyseed' : '';
  return UNLATCH[`${side}${fascia}` as keyof typeof UNLATCH];
}
