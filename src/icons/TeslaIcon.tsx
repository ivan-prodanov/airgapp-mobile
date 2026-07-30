import React from 'react';
import type { StyleProp, ViewStyle } from 'react-native';
import Svg, { Path, SvgXml } from 'react-native-svg';

import ICONS from './teslaIcons.json';
import VEHICLE from './teslaVehicleGlyphs.json';

type IconName = keyof typeof ICONS;
type VehicleName = keyof typeof VEHICLE;
export type TeslaIconName = IconName | VehicleName;

const icons = ICONS as Record<string, { v: string; p: string[] }>;
const vehicles = VEHICLE as Record<string, string>;

// One component that renders either the 718 design-system glyphs (path data) or the 8 native
// model-fascia vehicle glyphs (inline SVG). Replaces expo-symbols' SymbolView across the app:
// `tintColor` → `color`, `weight` is dropped (the -filled glyphs bake weight in), `style` forwards.
export function TeslaIcon({
  name,
  size = 24,
  color = 'currentColor',
  style,
}: {
  name: TeslaIconName;
  size?: number;
  color?: string;
  style?: StyleProp<ViewStyle>;
}) {
  // 718 design-system glyphs: viewBox + path list (fillRule evenodd)
  const g = icons[name as string];
  if (g) {
    return (
      <Svg width={size} height={size} viewBox={g.v} style={style}>
        {g.p.map((d, i) => (
          <Path key={i} d={d} fill={color} fillRule="evenodd" clipRule="evenodd" />
        ))}
      </Svg>
    );
  }
  // native fascia vehicle glyphs (model-resolved: vehicle-bayberry, vehicle-model-3y, ...)
  const xml = vehicles[name as string];
  if (xml) {
    return <SvgXml xml={xml} width={size} height={size} color={color} style={style} />;
  }
  if (__DEV__) console.warn(`TeslaIcon: unknown "${String(name)}"`);
  return null;
}

// Map a car's fascia -> vehicle glyph name (mirrors the app's getVehicleIconName).
// fascia comes from the vehicle's FasciaType; charge=true appends the charge-port bolt.
export function vehicleGlyphName(
  fascia: 'bayberry' | 'model_3y' | 'model_s' | 'model_x',
  charge = false,
): VehicleName {
  const base = 'vehicle-' + fascia.replace('_', '-');
  return (charge ? base + '-charge' : base) as VehicleName;
}

export default TeslaIcon;
