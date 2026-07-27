import { useEffect, useState } from 'react';
import { Animated, PixelRatio, StyleSheet, Text, View } from 'react-native';

import { anchorToPoint, markerAnchorPx } from './markerLayout';
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

// How far outboard of the wheel anchor the label sits, in points. The official
// app puts these out at the screen margins rather than on the tyre itself, which
// keeps them off the car and readable against the dark background.
const OUTBOARD = 76;

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
              side === 'left'
                ? { right: undefined, left: Math.max(12, point.left - OUTBOARD) }
                : { left: undefined, right: 12 },
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

const LABEL_H = 24;

const styles = StyleSheet.create({
  label: {
    position: 'absolute',
    height: LABEL_H,
    justifyContent: 'center',
  },
  text: {
    fontSize: 17,
    color: 'white',
  },
  // A warned tyre is the whole reason to look at this screen, so it is coloured
  // rather than merely listed. Tesla's amber, the same one the car uses.
  warned: {
    color: '#F5A623',
  },
});
