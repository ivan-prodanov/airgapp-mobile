import { useEffect, useState } from 'react';
import { PixelRatio, Pressable, StyleSheet, Text } from 'react-native';
import { SymbolView, type SFSymbol } from 'expo-symbols';

import { controlHaptic } from '../state/controlHaptic';
import { useGodotBridge } from './bridgeContext';
import { anchorToPoint, MARKER_CALIBRATION, overlayAnchorsPx, type OverlayKey } from './markerLayout';
import type { VehicleActions } from '../state/useVehicleState';
import type { MarkerPoint, VehicleMarkers } from '../types/markerTypes';
import type { VehicleViewState } from '../types/vehicleTypes';

interface Props {
  state: VehicleViewState;
  actions: VehicleActions;
}

// Half-extents used to center each button box on its anchor point (left = point − w/2).
const BOX = {
  text: { w: 104, h: 34 },
  icon: { w: 52, h: 52 },
} as const;

// Closure overlay buttons drawn over the top-down car (Controls view), each pinned to its Godot
// marker. Frunk/trunk show Open/Close text and animate the real 3D closures via the existing toggle →
// UPDATE_PRODUCT path; the center lock is a UI toggle (no marker → derived cabin center); the charge
// button opens the charge-port door. Hidden until markers arrive and the camera settles (no flicker).
export function MarkerOverlay({ state, actions }: Props) {
  const bridge = useGodotBridge();
  const [markers, setMarkers] = useState<VehicleMarkers | null>(null);
  const [visible, setVisible] = useState(false);
  const pixelRatio = PixelRatio.get();

  useEffect(() => {
    const offMarkers = bridge.onMarkers(setMarkers);
    const offVisibility = bridge.onMarkerVisibility(setVisible);
    // Mount happens on entering Controls; the camera move already re-requests markers when it
    // settles, but ask once more in case we arrived with the camera already at rest.
    bridge.requestMarkers();
    return () => {
      offMarkers();
      offVisibility();
    };
  }, [bridge]);

  if (!visible || !markers) {
    return null;
  }

  const anchors = overlayAnchorsPx(markers);

  return (
    <>
      {anchors.frunk ? (
        <TextButton
          anchorPx={anchors.frunk}
          pixelRatio={pixelRatio}
          marker="frunk"
          label={state.frunkOpen ? 'Close' : 'Open'}
          onPress={() => actions.toggle('frunkOpen')}
        />
      ) : null}
      {anchors.trunk ? (
        <TextButton
          anchorPx={anchors.trunk}
          pixelRatio={pixelRatio}
          marker="trunk"
          label={state.trunkOpen ? 'Close' : 'Open'}
          onPress={() => actions.toggle('trunkOpen')}
        />
      ) : null}
      {anchors.lock ? (
        <IconButton
          anchorPx={anchors.lock}
          pixelRatio={pixelRatio}
          marker="lock"
          symbol={state.locked ? 'lock.fill' : 'lock.open.fill'}
          size={34}
          tint="rgba(255,255,255,0.92)"
          onPress={() => actions.toggle('locked')}
        />
      ) : null}
      {anchors.chargePort ? (
        <IconButton
          anchorPx={anchors.chargePort}
          pixelRatio={pixelRatio}
          marker="chargePort"
          symbol="bolt.fill"
          size={26}
          tint={state.chargePortOpen ? 'rgba(255,255,255,0.92)' : 'rgba(255,255,255,0.55)'}
          onPress={() => actions.toggle('chargePortOpen')}
        />
      ) : null}
    </>
  );
}

function TextButton({
  anchorPx,
  pixelRatio,
  marker,
  label,
  onPress,
}: {
  anchorPx: MarkerPoint;
  pixelRatio: number;
  marker: OverlayKey;
  label: string;
  onPress: () => void;
}) {
  const point = anchorToPoint(anchorPx, pixelRatio, MARKER_CALIBRATION[marker]);
  return (
    <Pressable
      style={[
        styles.button,
        { left: point.left - BOX.text.w / 2, top: point.top - BOX.text.h / 2, width: BOX.text.w, height: BOX.text.h },
      ]}
      hitSlop={10}
      onPress={() => {
        controlHaptic();
        onPress();
      }}>
      <Text style={styles.label}>{label}</Text>
    </Pressable>
  );
}

function IconButton({
  anchorPx,
  pixelRatio,
  marker,
  symbol,
  size,
  tint,
  onPress,
}: {
  anchorPx: MarkerPoint;
  pixelRatio: number;
  marker: OverlayKey;
  symbol: SFSymbol;
  size: number;
  tint: string;
  onPress: () => void;
}) {
  const point = anchorToPoint(anchorPx, pixelRatio, MARKER_CALIBRATION[marker]);
  return (
    <Pressable
      style={[
        styles.button,
        { left: point.left - BOX.icon.w / 2, top: point.top - BOX.icon.h / 2, width: BOX.icon.w, height: BOX.icon.h },
      ]}
      hitSlop={10}
      onPress={() => {
        controlHaptic();
        onPress();
      }}>
      <SymbolView name={symbol} tintColor={tint} size={size} />
    </Pressable>
  );
}

const styles = StyleSheet.create({
  button: {
    position: 'absolute',
    alignItems: 'center',
    justifyContent: 'center',
  },
  label: {
    fontSize: 19,
    fontWeight: '600',
    color: 'rgba(255,255,255,0.92)',
    textShadowColor: 'rgba(0,0,0,0.55)',
    textShadowOffset: { width: 0, height: 1 },
    textShadowRadius: 4,
  },
});
