import { useEffect, useRef } from 'react';
import { StyleSheet, Text, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { SymbolView } from 'expo-symbols';
import * as Haptics from 'expo-haptics';

import { clampSpeedLimit, SPEED_LIMIT_MAX, SPEED_LIMIT_MIN } from '@/state/fleet';
import { HoldRepeatButton } from './HoldRepeatButton';
import { SlideUpSheet } from './SlideUpSheet';

const DIM = 'rgba(255,255,255,0.25)';

// "Adjust Speed Limit" bottom sheet (Speed Limit Mode's "…"). Slides up over a dimmed screen; tapping
// above the panel closes it. The value edits live (each step patches state) between 80 and 193 km/h, and
// the </> buttons repeat while held.
export function SpeedLimitSheet({
  visible,
  value,
  onChange,
  onClose,
}: {
  visible: boolean;
  value: number;
  onChange: (kph: number) => void;
  onClose: () => void;
}) {
  const insets = useSafeAreaInsets();
  // Mirror the value in a ref so a held button advances from the live value, not the press-in snapshot.
  const valueRef = useRef(value);
  useEffect(() => {
    valueRef.current = value;
  }, [value]);

  const step = (dir: -1 | 1) => {
    const next = clampSpeedLimit(valueRef.current + dir);
    if (next === valueRef.current) return; // at a bound
    valueRef.current = next;
    Haptics.selectionAsync().catch(() => {});
    onChange(next);
  };

  const atMin = value <= SPEED_LIMIT_MIN;
  const atMax = value >= SPEED_LIMIT_MAX;

  return (
    <SlideUpSheet visible={visible} onDismiss={onClose}>
      <View style={[styles.content, { paddingBottom: insets.bottom + 28 }]}>
        <Text style={styles.title}>Adjust Speed Limit</Text>
        <View style={styles.divider} />

        <View style={styles.row}>
          <HoldRepeatButton onStep={() => step(-1)} disabled={atMin} hitSlop={12} style={styles.stepBtn}>
            <SymbolView name="chevron.left" tintColor={atMin ? DIM : 'white'} size={30} weight="medium" />
          </HoldRepeatButton>

          <View style={styles.valueCol}>
            <Text style={styles.value}>{value}</Text>
            <Text style={styles.unit}>km/h</Text>
          </View>

          <HoldRepeatButton onStep={() => step(1)} disabled={atMax} hitSlop={12} style={styles.stepBtn}>
            <SymbolView name="chevron.right" tintColor={atMax ? DIM : 'white'} size={30} weight="medium" />
          </HoldRepeatButton>
        </View>
      </View>
    </SlideUpSheet>
  );
}

const styles = StyleSheet.create({
  content: {
    paddingHorizontal: 24,
    paddingTop: 20,
  },
  title: {
    fontSize: 20,
    fontWeight: '700',
    color: 'white',
    textAlign: 'center',
    marginBottom: 18,
  },
  divider: {
    height: StyleSheet.hairlineWidth,
    backgroundColor: 'rgba(255,255,255,0.12)',
    marginHorizontal: -24,
  },
  row: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingTop: 24,
  },
  stepBtn: {
    width: 56,
    height: 56,
    alignItems: 'center',
    justifyContent: 'center',
  },
  valueCol: {
    alignItems: 'center',
  },
  value: {
    fontSize: 52,
    fontWeight: '300',
    color: 'white',
  },
  unit: {
    fontSize: 15,
    fontWeight: '600',
    color: 'rgba(255,255,255,0.5)',
    marginTop: 2,
  },
});
