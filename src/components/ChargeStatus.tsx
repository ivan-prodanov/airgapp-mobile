import { useEffect, useRef, useState } from 'react';
import { Animated, Pressable, StyleSheet, Text } from 'react-native';

import { batteryLabel, batteryTextColor } from '@/ble/batteryDisplay';
import { TeslaFonts } from '@/constants/fonts';
import { MiniBatteryView } from './MiniBatteryView';

// The battery row: glyph + "75%" / "312 km". Sits on its OWN row directly under
// the car name, ABOVE the status line (findings §C1) — not inline beside it.
//
// Source: docs/superpowers/research/tesla-status-assets-FINDINGS.md §C3/§C4.
const STALE_OPACITY = 0.5;
const RESTORE_MS = 500;

export function ChargeStatus({
  batteryLevel,
  rangeMiles,
  charging,
  // Data older than 2 minutes — dims the whole row (findings §C3).
  stale,
  // Tapping the % also refreshes, like a pull-down. (The official app's tap
  // sends `energyDisplayFormat` to the car, which counts as a userInitiatedCommand
  // and so lights the same wake/spinner path — see findings §C4/§A.)
  onRefresh,
}: {
  batteryLevel: number;
  rangeMiles: number | null;
  charging: boolean;
  stale: boolean;
  onRefresh?: () => void;
}) {
  // findings §C4: tapping the % text toggles % <-> distance. In the official app
  // the tap ALSO sends `energyDisplayFormat` to the car so the choice persists
  // vehicle-side, gated on a phone-key pairing and a minimum car API version
  // whose numeric value the RE could not recover (§H.3). We flip locally only —
  // which is exactly their fallback when that gating fails.
  const [mode, setMode] = useState<'percent' | 'distance'>('percent');

  // findings §C3: stale dims to 0.5 instantly, and restores over 500ms.
  const opacity = useRef(new Animated.Value(1)).current;
  useEffect(() => {
    if (stale) {
      opacity.setValue(STALE_OPACITY);
      return;
    }
    Animated.timing(opacity, {
      toValue: 1,
      duration: RESTORE_MS,
      useNativeDriver: true,
    }).start();
  }, [stale, opacity]);

  return (
    <Animated.View style={[styles.container, { opacity }]}>
      <MiniBatteryView pct={batteryLevel} charging={charging} />
      <Pressable
        hitSlop={8}
        onPress={() => {
          setMode((m) => (m === 'percent' ? 'distance' : 'percent'));
          onRefresh?.();
        }}
      >
        <Text style={[styles.text, { color: batteryTextColor(charging) }]}>
          {batteryLabel(mode, batteryLevel, rangeMiles, 'km')}
        </Text>
      </Pressable>
    </Animated.View>
  );
}

const styles = StyleSheet.create({
  // findings §C2: batteryViewContainer = row / center / marginTop 5.
  container: {
    flexDirection: 'row',
    alignItems: 'center',
    marginTop: 5,
  },
  // findings (Round 5) §1a/§1b — BOTH of Round 4's answers here were wrong:
  //
  //  - marginHorizontal is 5 (0.5 x Gutter), not 10. There are TWO `batteryText`
  //    entries in two modules; R4 quoted the MiniBatteryStatus one
  //    (Specifications.iconMargin = 10), but the % text uses the HEADER module's.
  //    Round 3's original 5 was right. The real nub->"7" gap is 5.0pt.
  //
  //  - The face is MEDIUM, not Bold. Their `fontWeight:'bold'` is a NO-OP on
  //    iOS: the category supplies fontFamily 'UniversalSansText-Medium', and the
  //    foundry's name table puts Medium in its own single-face family — so the
  //    Bold cut (which lives in a DIFFERENT family) is unreachable and iOS does
  //    not synthesize faux-bold. Shipping a real Bold-700 made our % heavier
  //    than the official Medium-500. So: same face as the 14px status line,
  //    differing only in size.
  text: {
    // Bold, not Medium — see constants/fonts.ts. Their literal says
    // `fontWeight: 'bold'`; R5 §1b reasoned it can't resolve and their % is
    // therefore Medium, but that reasoning is INFERRED (unmeasured), and on
    // device this read lighter than the status line. Shipping the cut their
    // literal asks for.
    fontFamily: TeslaFonts.bold,
    fontSize: 16,
    marginHorizontal: 5,
  },
});
