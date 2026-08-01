import {
  Image,
  StyleSheet,
  View,
  type ImageSourcePropType,
  type ImageStyle,
  type StyleProp,
  type ViewStyle,
} from 'react-native';

import { TeslaIcon, type TeslaIconName } from './TeslaIcon';

// A single icon reference the whole app renders through <AppIcon>. Most icons are a bare vector-glyph
// name (back-compat: a plain string is a valid IconRef, so vector call sites never changed). The map's
// "png" set and the one composite need the richer forms:
//   - { png, tint }  raster glyph; tint=false keeps its baked color (sentry_on is red), else color tints it
//   - { stack }      overlaid vector glyphs (Parental Controls = person over a speed gauge)
//   - { glyph }      explicit vector form (rarely needed; the bare string is the usual way)
export type IconRef =
  | TeslaIconName
  | { glyph: TeslaIconName }
  | { stack: TeslaIconName[] }
  | { png: ImageSourcePropType; tint?: boolean };

export function AppIcon({
  icon,
  size = 24,
  color,
  style,
}: {
  icon: IconRef;
  size?: number;
  color?: string;
  style?: StyleProp<ViewStyle>;
}) {
  if (typeof icon === 'string') {
    return <TeslaIcon name={icon} size={size} color={color} style={style} />;
  }
  if ('glyph' in icon) {
    return <TeslaIcon name={icon.glyph} size={size} color={color} style={style} />;
  }
  if ('png' in icon) {
    // Gray template PNGs tint to `color`; a baked-color PNG (sentry_on) passes tint:false to keep it.
    const tintColor = icon.tint === false ? undefined : color;
    return (
      <Image
        source={icon.png}
        resizeMode="contain"
        style={[
          { width: size, height: size },
          tintColor ? { tintColor } : null,
          style as StyleProp<ImageStyle>,
        ]}
      />
    );
  }
  // stack: overlay the glyphs, later entries on top, all at full size.
  return (
    <View style={[{ width: size, height: size }, style]}>
      {icon.stack.map((name, i) => (
        <TeslaIcon key={i} name={name} size={size} color={color} style={StyleSheet.absoluteFill} />
      ))}
    </View>
  );
}

export default AppIcon;
