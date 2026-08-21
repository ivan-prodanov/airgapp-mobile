import React from 'react';
import type { StyleProp, ViewStyle } from 'react-native';
import Svg, { Path, SvgXml } from 'react-native-svg';

import ICONS from './teslaIcons.json';
import EXTRA from './extraGlyphs.json';
import VEHICLE from './teslaVehicleGlyphs.json';

type IconName = keyof typeof ICONS;
type ExtraName = keyof typeof EXTRA;
type VehicleName = keyof typeof VEHICLE;
export type TeslaIconName = IconName | ExtraName | VehicleName;

// EXTRA holds the handful of glyphs the extracted Tesla design set genuinely lacks
// (currently just `backspace`, for the PIN keypad — SF's `delete.left`). Same
// {viewBox, paths} shape as ICONS so the render path below is identical; kept in a
// separate file so nobody mistakes hand-authored paths for extracted Tesla ones.
const icons = { ...ICONS, ...EXTRA } as Record<string, { v: string; p: string[] }>;
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
