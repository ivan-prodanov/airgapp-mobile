import { useEffect, useRef } from 'react';
import { StyleSheet, Text, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { SymbolView } from 'expo-symbols';
import * as Haptics from 'expo-haptics';

import {
  clampSpeedLimitMph,
  speedLimitDisplayKmh,
  SPEED_LIMIT_MAX_MPH,
  SPEED_LIMIT_MIN_MPH,
} from '@/state/fleet';
import { HoldRepeatButton } from './HoldRepeatButton';
import { SlideUpSheet } from './SlideUpSheet';

const DIM = 'rgba(255,255,255,0.25)';

// "Adjust Speed Limit" bottom sheet (Speed Limit Mode's "…"). Slides up over a dimmed screen; tapping
// above the panel closes it. The value is stored in MPH (the car's unit) and shown in km/h; the </>
// buttons step one MPH at a time and repeat while held, so the km/h reading moves in ~1.6 jumps — the
// honest consequence of MPH being the source of truth (two km/h values would otherwise collide on one MPH).
export function SpeedLimitSheet({
  visible,
  mph,
  onChange,
  onClose,
}: {
  visible: boolean;
  mph: number;
  onChange: (mph: number) => void;
  onClose: () => void;
}) {
  const insets = useSafeAreaInsets();
  // Mirror the value in a ref so a held button advances from the live value, not the press-in snapshot.
  const mphRef = useRef(mph);
  useEffect(() => {
    mphRef.current = mph;
  }, [mph]);

  const step = (dir: -1 | 1) => {
    const next = clampSpeedLimitMph(mphRef.current + dir);
    if (next === mphRef.current) return; // at a bound
    mphRef.current = next;
    Haptics.selectionAsync().catch(() => {});
    onChange(next);
  };

  const atMin = mph <= SPEED_LIMIT_MIN_MPH;
  const atMax = mph >= SPEED_LIMIT_MAX_MPH;

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
            <Text style={styles.value}>{speedLimitDisplayKmh(mph)}</Text>
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
