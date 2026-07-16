import { useEffect, useRef, useState } from 'react';
import { Animated, Pressable, StyleSheet, Text } from 'react-native';

import { batteryLabel, batteryTextColor } from '@/ble/batteryDisplay';
import { MiniBatteryView } from './MiniBatteryView';

// The battery row: glyph + "75%" / "312 km". Sits on its OWN row directly under
// the car name, ABOVE the status line (findings §C1) — not inline beside it.
//
// Source: docs/superpowers/research/tesla-status-assets-FINDINGS.md §C3/§C4.
const STALE_OPACITY = 0.5;
const RESTORE_MS = 500;

export function ChargeStatus({
  batteryLevel,
  rangeKm,
  charging,
  // Data older than 2 minutes — dims the whole row (findings §C3).
  stale,
}: {
  batteryLevel: number;
  rangeKm: number | null;
  charging: boolean;
  stale: boolean;
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
        onPress={() => setMode((m) => (m === 'percent' ? 'distance' : 'percent'))}
      >
        <Text style={[styles.text, { color: batteryTextColor(charging) }]}>
          {batteryLabel(mode, batteryLevel, rangeKm, 'km')}
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
  // findings §C4: batteryText overrides the BodyLabel category — 16px bold.
  text: {
    fontSize: 16,
    fontWeight: 'bold',
    marginHorizontal: 5,
  },
});
