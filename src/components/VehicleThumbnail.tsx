import { Image, type ImageStyle, type StyleProp } from 'react-native';

import { TeslaIcon } from '@/icons/TeslaIcon';
import { vehicleGlyphFor } from '@/icons/vehicleGlyph';
import { configForState } from '@/godot/vehicleConfigForState';
import { configHash } from '@/godot/vehicleConfigHash';
import { useVehicleSnapshot } from '@/state/vehicleSnapshotStore';
import type { VehicleViewState } from '@/types/vehicleTypes';

// A car thumbnail: the rendered Godot snapshot for this car's exact configuration
// once it has arrived, else the model silhouette as a placeholder (identical
// footprint, so no layout shift when the real render swaps in).
export function VehicleThumbnail({
  state,
  imageStyle,
  glyphSize,
  glyphColor = 'rgba(255,255,255,0.9)',
}: {
  state: VehicleViewState;
  imageStyle: StyleProp<ImageStyle>;
  glyphSize: number;
  glyphColor?: string;
}) {
  const uri = useVehicleSnapshot(configHash(configForState(state)));
  if (uri) {
    return <Image source={{ uri }} style={imageStyle} resizeMode="contain" />;
  }
  return <TeslaIcon name={vehicleGlyphFor(state.carModel)} size={glyphSize} color={glyphColor} />;
}
