import { StyleSheet, View } from 'react-native';

import {
  BATTERY_BORDER_RADIUS,
  BATTERY_BORDER_WIDTH,
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
// Source: docs/superpowers/research/tesla-status-assets-FINDINGS.md §C3/§D.
// This is NOT an icon or an SVG in the official app either — on the standard
// theme they DRAW it with plain Views (a bordered box + an absolutely
// positioned fill), so we do the same rather than substituting an SF Symbol.
// Every number comes from their `MiniBatteryView` #117269 prop defaults.
//
// Two knowing omissions (findings §C3/§H):
//  - The "reserve/unusable" wedge (a blue #0f52ba layer drawn when total charge
//    exceeds usable charge) — our telemetry has one SoC, not the usable/total
//    split, so there is nothing to draw.
//  - The terminal nub is their `battery_nipple` icon-font glyph and the RE
//    recovered its name but not its vector path (§H.5), so this approximates it
//    with a small rounded bar in the outline colour.
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
  row: {
    flexDirection: 'row',
    alignItems: 'center',
  },
  body: {
    width: BATTERY_WIDTH,
    height: BATTERY_HEIGHT,
    position: 'relative',
    flexDirection: 'row',
    alignItems: 'center',
    borderWidth: BATTERY_BORDER_WIDTH,
    borderRadius: BATTERY_BORDER_RADIUS,
    borderColor: BatteryColors.pillDark,
  },
  fill: {
    position: 'absolute',
    left: 0,
    borderRadius: BATTERY_FILL_RADIUS,
    zIndex: 1,
    height: BATTERY_HEIGHT - BATTERY_BORDER_WIDTH * 2,
  },
  nubBox: {
    width: BATTERY_NUB_WIDTH,
    height: BATTERY_HEIGHT,
    alignItems: 'center',
    justifyContent: 'center',
  },
  nub: {
    width: 2,
    height: 6,
    borderRadius: 1,
    backgroundColor: BatteryColors.pillDark,
  },
});
