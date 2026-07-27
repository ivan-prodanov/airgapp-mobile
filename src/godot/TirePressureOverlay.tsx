import { useEffect, useState } from 'react';
import { Animated, PixelRatio, StyleSheet, Text, View } from 'react-native';

import { anchorToPoint, markerAnchorPx } from './markerLayout';
import { TeslaFonts } from '../constants/fonts';
import { useGodotBridge } from './bridgeContext';
import { useContentFade } from './useContentFade';
import type { MarkerName, VehicleMarkers } from '../types/markerTypes';
import type { TirePressures, VehicleViewState } from '../types/vehicleTypes';

interface Props {
  state: VehicleViewState;
}

// TirePressureOverlay — the four TPMS readings, one beside each wheel.
//
// Positions come from the renderer's OWN wheel anchors (wheel_1_1 … wheel_2_2),
// not from constants calibrated against a screenshot. The car model, camera pose
// and screen size all move those anchors, and the official app's numbers clearly
// track the wheels rather than sitting at fixed screen offsets — so projecting is
// both simpler and correct across the fleet's four body types.
//
// Values are BAR. The proto says so twice and the car supplies its own
// recommended cold pressure, so nothing is converted and nothing is hardcoded
// per model.
const WHEELS: { key: keyof TirePressures & ('fl' | 'fr' | 'rl' | 'rr'); marker: MarkerName; side: 'left' | 'right' }[] = [
  { key: 'fl', marker: 'wheel_1_1', side: 'left' },
  { key: 'fr', marker: 'wheel_1_2', side: 'right' },
  { key: 'rl', marker: 'wheel_2_1', side: 'left' },
  { key: 'rr', marker: 'wheel_2_2', side: 'right' },
];

// The official app pins these to the SCREEN MARGINS, not to an offset from the
// wheel — left labels start at the left edge, right labels end at the right edge,
// regardless of how wide the car renders. Only the VERTICAL position tracks the
// wheel anchors. Ivan's side-by-side made that obvious: ours sat ~78pt in from
// the edge where Tesla's sit at ~14.
const EDGE_MARGIN = 16;

export function TirePressureOverlay({ state }: Props) {
  const bridge = useGodotBridge();
  const [markers, setMarkers] = useState<VehicleMarkers | null>(null);
  const pixelRatio = PixelRatio.get();
  // Same content clock as the markers, so the numbers arrive with the rest of
  // the screen rather than as a second, later pop.
  const fade = useContentFade();

  useEffect(() => {
    const off = bridge.onMarkers(setMarkers);
    bridge.requestMarkers();
    return off;
  }, [bridge]);

  const tires = state.tirePressures;
  // No "once shown, stay shown" ref here, unlike MarkerOverlay. That exists
  // because the renderer flips MARKER-VISIBILITY off the instant the camera
  // starts moving, which made the markers vanish instead of fading. We do not
  // subscribe to that signal: our gate is an explicit user toggle, and `markers`
  // persists in state once received. So the plain condition is both correct and
  // free of a ref read during render.
  if (!state.tirePressureVisible || !markers) return null;

  return (
    <Animated.View style={[StyleSheet.absoluteFill, { opacity: fade }]} pointerEvents="none">
      {WHEELS.map(({ key, marker, side }) => {
        const anchorPx = markerAnchorPx(markers, marker);
        if (!anchorPx) return null;
        const point = anchorToPoint(anchorPx, pixelRatio, { dx: 0, dy: 0 });
        const value = tires?.[key] ?? null;
        // A wheel whose sensor has not reported shows an em dash, never 0.0.
        // This is the one screen where a confident wrong number could send
        // someone to a garage — or worse, stop them going.
        const label = value === null ? '—' : `${value.toFixed(1)} bar`;
        const warned = tires ? tires.hardWarning[key] || tires.softWarning[key] : false;
        return (
          <View
            key={key}
            style={[
              styles.label,
              side === 'left' ? { left: EDGE_MARGIN } : { right: EDGE_MARGIN },
              { top: point.top - LABEL_H / 2 },
            ]}
          >
            <Text style={[styles.text, warned && styles.warned]} numberOfLines={1}>
              {label}
            </Text>
          </View>
        );
      })}
    </Animated.View>
  );
}

const LABEL_H = 20; // = lineHeight, so `top` centres the text on the wheel

const styles = StyleSheet.create({
  label: {
    position: 'absolute',
    height: LABEL_H,
    justifyContent: 'center',
  },
  // The SAME resolved spec the closure markers use (MarkerOverlay.label), which
  // R12 §2 recovered from the shared Button default: Universal Sans MEDIUM at 18.
  // Not eyeballed off a screenshot — reusing the style that was already matched
  // against the real app, so both sets of on-car labels stay consistent.
  //
  // fontWeight is deliberately absent: Medium is its own single-face family, so
  // weight cannot select a cut and setting it falls back to regular.
  text: {
    fontFamily: TeslaFonts.medium,
    fontSize: 18,
    lineHeight: 20,
    letterSpacing: 0.1,
    color: 'white',
  },
  // A warned tyre is the whole reason to look at this screen, so it is coloured
  // rather than merely listed. Tesla's amber, the same one the car uses.
  warned: {
    color: '#F5A623',
  },
});
