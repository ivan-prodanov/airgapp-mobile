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
//
// ── Layout is RECOVERED, not eyeballed ────────────────────────────────────────
// Every number below is a verbatim literal from the official iOS bundle's own
// `TpmsMarkers` (module 8716) and `TpmsPressure` (module 8717) — see
// docs/superpowers/research/tesla-tpms-markers-FINDINGS.md. The first pass at
// this file guessed from a screenshot and got three things wrong at once: the
// margin, the size, and a front/rear asymmetry no amount of squinting would
// have revealed.
//
// Their positioning, verbatim:
//   FL  {left: 5,  top: vertical - 20}      FR  {right: 5, top: vertical - 20}
//   RL  {left: 5,  top: vertical - 10}      RR  {right: 5, top: vertical - 10}
// `top` is the TOP of the label box (lineHeight 20), so the front pair sits a
// full 10pt higher relative to its wheel than the rear pair. That is deliberate
// on their side and it is why our rears matched the reference while our fronts
// did not.
const WHEELS: {
  key: keyof TirePressures & ('fl' | 'fr' | 'rl' | 'rr');
  marker: MarkerName;
  side: 'left' | 'right';
  topOffset: number;
}[] = [
  { key: 'fl', marker: 'wheel_1_1', side: 'left', topOffset: -20 },
  { key: 'fr', marker: 'wheel_1_2', side: 'right', topOffset: -20 },
  { key: 'rl', marker: 'wheel_2_1', side: 'left', topOffset: -10 },
  { key: 'rr', marker: 'wheel_2_2', side: 'right', topOffset: -10 },
];

// Pinned to the SCREEN MARGIN, not offset from the wheel — only the VERTICAL
// position tracks the wheel anchor. `left: 5` / `right: 5`, verbatim.
const EDGE_MARGIN = 5;

// theme.textColor on the DARK theme (the block whose `theme` key is `DARK`).
// Not pure white — a hair below it, which is why plain `'white'` read hotter
// than the reference.
const TPMS_TEXT_COLOR = '#F3F3F3';

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
      {WHEELS.map(({ key, marker, side, topOffset }) => {
        const anchorPx = markerAnchorPx(markers, marker);
        if (!anchorPx) return null;
        const point = anchorToPoint(anchorPx, pixelRatio, { dx: 0, dy: 0 });
        const value = tires?.[key] ?? null;
        // A wheel whose sensor has not reported shows the official app's own
        // placeholder — a double hyphen, never 0.0. This is the one screen where
        // a confident wrong number could send someone to a garage, or worse,
        // stop them going.
        const label = value === null ? '--' : `${value.toFixed(1)} bar`;
        // Hard and soft warnings are DIFFERENT colours in the official app, and
        // hard wins. Collapsing them into one amber (as the first pass did) hides
        // the distinction between "top this up soon" and "stop driving".
        const hard = tires?.hardWarning[key] ?? false;
        const soft = tires?.softWarning[key] ?? false;
        return (
          <View
            key={key}
            style={[
              styles.label,
              side === 'left' ? { left: EDGE_MARGIN } : { right: EDGE_MARGIN },
              { top: point.top + topOffset },
            ]}
          >
            <Text style={[styles.text, hard ? styles.hardWarning : soft ? styles.softWarning : null]}>{label}</Text>
          </View>
        );
      })}
    </Animated.View>
  );
}

const styles = StyleSheet.create({
  // `styles.tpms` in the official bundle, verbatim. No width and no height: the
  // box is content-sized, so `left`/`right` pin it to the margin and `top` is the
  // top of the text itself.
  label: {
    position: 'absolute',
    alignContent: 'center',
    alignItems: 'center',
  },
  // `<Text category="bodyLabel">` ⇒ Typography.BodyLabel, verbatim:
  // {type:'Medium', fontSize:14, lineHeight:20, letterSpacing:0.1}.
  //
  // The first pass used 18 by borrowing MarkerOverlay's style. That was wrong,
  // and instructively so: the 18 does not come from BodyLabel at all, it comes
  // from `styles.textColorGray` — a per-call-site override the frunk/trunk marker
  // BUTTONS apply and the tyre labels do not. Reusing an "already matched" style
  // is only safe when the two call sites resolve the same way; these don't.
  //
  // fontWeight is deliberately absent: Medium is its own single-face family, so
  // weight cannot select a cut and setting it falls back to regular.
  text: {
    fontFamily: TeslaFonts.medium,
    fontSize: 14,
    lineHeight: 20,
    letterSpacing: 0.1,
    color: TPMS_TEXT_COLOR,
  },
  // theme.textColorWarning — "check this soon".
  softWarning: {
    color: '#DAA300',
  },
  // theme.textColorError — the one that means stop. Distinct on purpose.
  hardWarning: {
    color: '#FF3A3A',
  },
});
