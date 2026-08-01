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

export default TeslaIcon;
