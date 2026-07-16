import { StyleSheet, View } from 'react-native';

import {
  BATTERY_BORDER_RADIUS,
  BATTERY_BORDER_WIDTH,
  BATTERY_FILL_HEIGHT,
  BATTERY_FILL_RADIUS,
  BATTERY_HEIGHT,
  BATTERY_NUB_WIDTH,
  BATTERY_WIDTH,
  BatteryColors,
  batteryFillColor,
  batteryFillWidth,
} from '@/ble/batteryDisplay';

// The Home battery glyph.
//
// Source: docs/superpowers/research/tesla-status-polish-FINDINGS.md §1 — the
// verbatim StyleSheet + inline render styles, dual-verified on the iOS bundle.
// The official app draws this with plain Views too (no icon/SVG on the standard
// theme), so we mirror their tree node-for-node.
//
// Round 4 corrected two things this component had wrong:
//   - The body is FILLED: backgroundColor === borderColor === pillBackgroundColor.
//     It is a solid rounded rect, not a stroke around a transparent interior.
//   - The fill is INSET by borderWidth*2+2 = 4 (height 12, not the flush 14), and
//     is centred in the body because it sets no `top` and the row centres it.
//
// The nub is their `battery_nipple` — really an SVG <Path>, not a font glyph:
//   d="M1 5a2 2 0 0 1 2 2v2a2 2 0 0 1-2 2V5Z"  (art 3x16, drawn into a 4x16 box,
//   scale 1, centred). That is a flat-left / round-right "D": 2 wide, 6 tall,
//   vertically centred, radius 2 on the right. We have no react-native-svg in
//   this app, so it's reproduced with a View — the shape is simple enough that
//   this is exact rather than an approximation.
const NUB_ART_WIDTH = 3;
const NUB_X = (BATTERY_NUB_WIDTH - NUB_ART_WIDTH) / 2 + 1; // centre the 3-wide art, then the path's x=1
const NUB_WIDTH = 2; // the path spans x 1->3
const NUB_HEIGHT = 6; // y 5->11
const NUB_RADIUS = 2;

export function MiniBatteryView({ pct, charging }: { pct: number; charging: boolean }) {
  return (
    <View style={styles.row}>
      <View style={styles.body}>
        <View
          style={[
            styles.fill,
            { width: batteryFillWidth(pct), backgroundColor: batteryFillColor(pct, charging) },
          ]}
        />
      </View>
      <View style={styles.nubBox}>
        <View style={styles.nub} />
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  // findings §1a batteryContainer: { alignItems: 'center', flexDirection: 'row' }
  row: {
    flexDirection: 'row',
    alignItems: 'center',
  },
  // findings §1a container + §1b's inline merge.
  body: {
    width: BATTERY_WIDTH,
    height: BATTERY_HEIGHT,
    position: 'relative',
    flexDirection: 'row',
    alignItems: 'center',
    borderWidth: BATTERY_BORDER_WIDTH,
    borderRadius: BATTERY_BORDER_RADIUS,
    backgroundColor: BatteryColors.pillDark,
    borderColor: BatteryColors.pillDark,
  },
  // findings §1a batteryLevel: { borderRadius: 1, left: 1, position: 'absolute',
  // zIndex: 1 }. No `top` — the row's alignItems:'center' centres the 12px bar
  // in the 14px inner box, which is what produces the visible margin.
  fill: {
    position: 'absolute',
    left: 1,
    borderRadius: BATTERY_FILL_RADIUS,
    zIndex: 1,
    height: BATTERY_FILL_HEIGHT,
  },
  // findings §1d: children[1] of the row — a 4x16 slot abutting the body, no gap.
  nubBox: {
    width: BATTERY_NUB_WIDTH,
    height: BATTERY_HEIGHT,
    justifyContent: 'center',
  },
  nub: {
    marginLeft: NUB_X,
    width: NUB_WIDTH,
    height: NUB_HEIGHT,
    borderTopRightRadius: NUB_RADIUS,
    borderBottomRightRadius: NUB_RADIUS,
    backgroundColor: BatteryColors.pillDark,
  },
});
