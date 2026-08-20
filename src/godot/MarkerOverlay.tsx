import { useEffect, useRef, useState } from 'react';
import { Animated, PixelRatio, Pressable, StyleSheet, Text } from 'react-native';
import { SymbolView, type SFSymbol } from 'expo-symbols';

import { controlHaptic } from '../state/controlHaptic';
import { useCarLinkStatus } from '../state/VehicleProvider';
import { useGodotBridge } from './bridgeContext';
import { anchorToPoint, MARKER_CALIBRATION, overlayAnchorsPx, type OverlayKey } from './markerLayout';
import { TeslaFonts } from '@/constants/fonts';
import { AppIcon, type IconRef } from '@/icons/AppIcon';
import { BusyIcon } from '@/components/BusyIcon';
import { frunkLabelDark } from './markerPaint';
import { useContentFade } from './useContentFade';
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
  const carLink = useCarLinkStatus();
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
          pending={carLink.pending.has('frunkOpen') || carLink.pendingCommands.has('openFrunk')}
          dark={frunkLabelDark(state)}
          // actuateFrunk, NOT toggle. reconcile.ts has no frunk diff rule any
          // more, so a bare state toggle here flips the label and sends the car
          // NOTHING — which is exactly what it did after that rule was removed
          // and this call site was missed.
          onPress={() => actions.actuateFrunk()}
        />
      ) : null}
      {anchors.trunk ? (
        <TextButton
          anchorPx={anchors.trunk}
          pixelRatio={pixelRatio}
          marker="trunk"
          label={state.trunkOpen ? 'Close' : 'Open'}
          pending={carLink.pending.has('trunkOpen')}
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
          pending={carLink.pending.has('locked')}
          onPress={() => actions.toggle('locked')}
        />
      ) : null}
      {anchors.chargePort ? (
        <IconButton
          anchorPx={anchors.chargePort}
          pixelRatio={pixelRatio}
          marker="chargePort"
          glyph="charging-bolt"
          size={26}
          tint={state.chargePortOpen ? 'rgba(255,255,255,0.92)' : 'rgba(255,255,255,0.55)'}
          pending={carLink.pending.has('chargePortOpen')}
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
  pending,
}: {
  anchorPx: MarkerPoint;
  pixelRatio: number;
  marker: OverlayKey;
  label: string;
  onPress: () => void;
  dark?: boolean;
  // While the closure command is in flight, the marker's text becomes a spinner.
  pending?: boolean;
}) {
  const point = anchorToPoint(anchorPx, pixelRatio, MARKER_CALIBRATION[marker]);
  return (
    <Pressable
      style={[
        styles.button,
        { left: point.left - BOX.text.w / 2, top: point.top - BOX.text.h / 2, width: BOX.text.w, height: BOX.text.h },
      ]}
      hitSlop={10}
      disabled={pending}
      onPress={() => {
        controlHaptic();
        onPress();
      }}>
      {pending ? (
        <BusyIcon size={18} />
      ) : (
        <Text style={[styles.label, dark ? styles.labelDark : null]}>{label}</Text>
      )}
    </Pressable>
  );
}

function IconButton({
  anchorPx,
  pixelRatio,
  marker,
  symbol,
  glyph,
  size,
  tint,
  onPress,
  pending,
}: {
  anchorPx: MarkerPoint;
  pixelRatio: number;
  marker: OverlayKey;
  // Either an SF Symbol (lock) or a Tesla vector glyph (charge port). glyph wins.
  symbol?: SFSymbol;
  glyph?: IconRef;
  size: number;
  tint: string;
  onPress: () => void;
  // While the command is in flight, the marker's glyph becomes a spinner.
  pending?: boolean;
}) {
  const point = anchorToPoint(anchorPx, pixelRatio, MARKER_CALIBRATION[marker]);
  return (
    <Pressable
      style={[
        styles.button,
        { left: point.left - BOX.icon.w / 2, top: point.top - BOX.icon.h / 2, width: BOX.icon.w, height: BOX.icon.h },
      ]}
      hitSlop={10}
      disabled={pending}
      onPress={() => {
        controlHaptic();
        onPress();
      }}>
      {pending ? (
        <BusyIcon size={size * 0.7} />
      ) : glyph ? (
        <AppIcon icon={glyph} color={tint} size={size} />
      ) : symbol ? (
        <SymbolView name={symbol} tintColor={tint} size={size} />
      ) : null}
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
  // R12 §2 recovered the shared Button's default at last, and the user's read was
  // right with the wrong lever:
  //   Button GHOST default = { fontFamily:'UniversalSansText-Medium', fontSize:14,
  //                            lineHeight:20, letterSpacing:0.1 }  — NO fontWeight
  //   the marker's own textStyle then overrides color + fontSize -> 18.
  // ⇒ resolved: { fontFamily:'UniversalSansText-Medium', fontSize:18,
  //               lineHeight:20, letterSpacing:0.1, color:<gray|dark> }
  //
  // Our `fontWeight: '600'` was APPROXIMATING the Medium cut against RN's default
  // face — which is why dropping it fell back to regular 400 and read wrong. The
  // weight was never the lever: Medium is its own single-face family (R5 §1b), so
  // fontWeight cannot select a cut; only the PostScript name can. A 600/SemiBold
  // cut doesn't even exist — Universal Sans ships five (Thin/Light/Regular/
  // Medium/Bold). So: name the family, drop the weight.
  label: {
    fontFamily: TeslaFonts.medium,
    fontSize: 18,
    lineHeight: 20,
    letterSpacing: 0.1,
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
