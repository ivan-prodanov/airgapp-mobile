import { useEffect, useRef, useState } from 'react';
import { Animated, PixelRatio, Pressable, StyleSheet, Text } from 'react-native';
import { SymbolView, type SFSymbol } from 'expo-symbols';

import { controlHaptic } from '../state/controlHaptic';
import { useGodotBridge } from './bridgeContext';
import { anchorToPoint, MARKER_CALIBRATION, overlayAnchorsPx, type OverlayKey } from './markerLayout';
import { isLightExteriorColor } from './markerPaint';
import { useContentFade } from './useContentFade';
import type { VehicleActions } from '../state/useVehicleState';
import type { MarkerPoint, VehicleMarkers } from '../types/markerTypes';
import { vehicleConfigs } from '../types/vehicleTypes';
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
  const shown = useRef(false);
  const pixelRatio = PixelRatio.get();

  // The screen's content fade — see useContentFade. ControlsScreen runs the same
  // hook for the bottom buttons, so both start on the same markers event and the
  // screen resolves as one object, the way their single shared value does.
  const fade = useContentFade();

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

  // ⚠️ Once shown, STAY shown. The renderer flips marker-visibility to false the
  // moment the camera starts moving away, and unmounting on that made the
  // markers VANISH on the way out instead of fading (the user's "the markers
  // don't fade out"). The pushed card owns our lifetime — it fades us over 479ms
  // and unmounts us when that finishes — so `visible` only ever needs to gate
  // the FIRST appearance.
  if (!shown.current && visible && markers) shown.current = true;
  if (!shown.current || !markers) {
    return null;
  }

  const anchors = overlayAnchorsPx(markers);

  return (
    <Animated.View style={[StyleSheet.absoluteFill, { opacity: fade }]} pointerEvents="box-none">
      {anchors.frunk ? (
        <TextButton
          anchorPx={anchors.frunk}
          pixelRatio={pixelRatio}
          marker="frunk"
          label={state.frunkOpen ? 'Close' : 'Open'}
          dark={isLightExteriorColor(vehicleConfigs[state.carModel]?.vehicle_config.exterior_color)}
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
    </Animated.View>
  );
}

function TextButton({
  anchorPx,
  pixelRatio,
  marker,
  label,
  onPress,
  // findings §2c: the frunk label — and ONLY the frunk label — flips to
  // rgba(0,0,0,0.7) on a light-painted car. Trunk and lock are hardcoded gray.
  dark = false,
}: {
  anchorPx: MarkerPoint;
  pixelRatio: number;
  marker: OverlayKey;
  label: string;
  onPress: () => void;
  dark?: boolean;
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
      <Text style={[styles.label, dark ? styles.labelDark : null]}>{label}</Text>
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

// findings §2b: Colors.transparentWhite70 / Colors.transparentBlack70.
const TEXT_COLOR_GRAY = 'rgba(255,255,255,0.7)';
const TEXT_COLOR_DARK = 'rgba(0,0,0,0.7)';

const styles = StyleSheet.create({
  button: {
    position: 'absolute',
    alignItems: 'center',
    justifyContent: 'center',
  },
  // findings §2b, VERBATIM:
  //   styles.textButton    = { height: 30, minHeight: 0, paddingVertical: 0 }
  //   styles.textColorGray = { color: 'rgba(255,255,255,0.7)', fontSize: 18 }
  //   styles.textColorDark = { color: 'rgba(0,0,0,0.7)',       fontSize: 18 }
  //   styles.disabledStyle = { opacity: 0.4 }
  // fontSize 18 and alpha 0.7 are theirs (we had 19 / 0.92), and the textShadow
  // we used to draw was our own invention — dropped.
  //
  // ⚠️ fontWeight '600' is DEVICE-VERIFIED, NOT RECOVERED. That literal carries
  // no fontWeight because — as §2b itself notes — "weight/family come from the
  // shared Button component's defaults", which the RE did NOT recover. Deleting
  // the weight therefore did NOT inherit Tesla's default; it fell back to RN's
  // regular 400, and the user reported the label was no longer bold enough while
  // the previous '600' matched. So 600 stays until someone dumps their Button's
  // default textStyle (asked for in brief #11 §3). Do not "correct" this to the
  // §2b literal — the literal is silent on weight, it does not say 400.
  label: {
    fontSize: 18,
    fontWeight: '600',
    color: TEXT_COLOR_GRAY,
  },
  // findings §2c: ONLY the frunk label adapts to the paint. The lock glyph and
  // the trunk label are hardcoded to textColorGray.
  labelDark: {
    color: TEXT_COLOR_DARK,
  },
  disabled: {
    opacity: 0.4,
  },
});
