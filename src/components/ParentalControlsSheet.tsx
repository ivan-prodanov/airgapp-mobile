import { useEffect, useState } from 'react';
import { StyleSheet, Text, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { SymbolView } from 'expo-symbols';
import * as Haptics from 'expo-haptics';

import {
  speedLimitDisplayKmh,
  speedLimitKmhToStoredMph,
  SPEED_LIMIT_DEBOUNCE_MS,
  SPEED_LIMIT_MAX_KMH,
  SPEED_LIMIT_MIN_KMH,
} from '@/state/fleet';
import type { VehicleActions } from '@/state/useVehicleState';
import type { VehicleViewState } from '@/types/vehicleTypes';
import { Checkbox } from './Checkbox';
import { HoldRepeatButton } from './HoldRepeatButton';
import { SlideUpSheet } from './SlideUpSheet';
import { useDebouncedCallback } from './useDebouncedCallback';

const DIM = 'rgba(255,255,255,0.25)';

// "Customize Parental Controls" bottom sheet (Parental Controls' "…"). Slides up over a dimmed screen;
// tapping above closes it. Each row toggles its own state key; the Limit Speed row reveals a held-repeat
// stepper (MPH in state, km/h on screen — same convention as Speed Limit Mode) when checked. The number
// updates on every press; the ParentalControlsSetSpeedLimit command is debounced 1.2s (Tesla's `debounceMS`).
export function ParentalControlsSheet({
  visible,
  state,
  actions,
  onClose,
}: {
  visible: boolean;
  state: VehicleViewState;
  actions: VehicleActions;
  onClose: () => void;
}) {
  const insets = useSafeAreaInsets();
  // Local km/h for immediate display; the debounced patch is the only thing that reaches the car (see
  // SpeedLimitSheet for the same pattern).
  const propKmh = speedLimitDisplayKmh(state.parentalLimitSpeedMph);
  const [kmh, setKmh] = useState(propKmh);
  useEffect(() => {
    setKmh(propKmh);
  }, [propKmh]);
  const debouncedSetMph = useDebouncedCallback(
    (mph: number) => actions.patch({ parentalLimitSpeedMph: mph }),
    SPEED_LIMIT_DEBOUNCE_MS,
  );

  const step = (dir: -1 | 1) => {
    setKmh((k) => {
      const next = k + dir;
      if (next < SPEED_LIMIT_MIN_KMH || next > SPEED_LIMIT_MAX_KMH) return k;
      Haptics.selectionAsync().catch(() => {});
      debouncedSetMph(speedLimitKmhToStoredMph(next));
      return next;
    });
  };

  return (
    <SlideUpSheet visible={visible} onDismiss={onClose}>
      <View style={[styles.content, { paddingBottom: insets.bottom + 20 }]}>
        <Text style={styles.title}>Customize Parental Controls</Text>
        <View style={styles.divider} />

        <View style={styles.body}>
          <Option
            title="Limit Speed"
            checked={state.parentalLimitSpeed}
            onToggle={() => actions.toggle('parentalLimitSpeed')}
          >
            {state.parentalLimitSpeed ? (
              <View style={styles.stepper}>
                <HoldRepeatButton
                  onStep={() => step(-1)}
                  disabled={kmh <= SPEED_LIMIT_MIN_KMH}
                  hitSlop={10}
                  style={styles.stepBtn}
                >
                  <SymbolView
                    name="chevron.left"
                    tintColor={kmh <= SPEED_LIMIT_MIN_KMH ? DIM : 'white'}
                    size={22}
                    weight="medium"
                  />
                </HoldRepeatButton>
                <Text style={styles.stepValue}>{kmh} km/h</Text>
                <HoldRepeatButton
                  onStep={() => step(1)}
                  disabled={kmh >= SPEED_LIMIT_MAX_KMH}
                  hitSlop={10}
                  style={styles.stepBtn}
                >
                  <SymbolView
                    name="chevron.right"
                    tintColor={kmh >= SPEED_LIMIT_MAX_KMH ? DIM : 'white'}
                    size={22}
                    weight="medium"
                  />
                </HoldRepeatButton>
              </View>
            ) : null}
          </Option>

          <Option
            title="Reduce Acceleration"
            subtitle="Acceleration set to Chill"
            checked={state.parentalReduceAccel}
            onToggle={() => actions.toggle('parentalReduceAccel')}
          />
          <Option
            title="Require Safety Features"
            subtitle="Safety features such as Speed Limit Warning, Forward Collision Warning and Automatic Emergency Braking cannot be modified"
            checked={state.parentalRequireSafety}
            onToggle={() => actions.toggle('parentalRequireSafety')}
          />
          <Option
            title="Send Curfew Notifications"
            subtitle="Receive a mobile app notification when car is driven between 23:00 - 04:00"
            checked={state.parentalCurfewNotify}
            onToggle={() => actions.toggle('parentalCurfewNotify')}
          />
        </View>
      </View>
    </SlideUpSheet>
  );
}

function Option({
  title,
  subtitle,
  checked,
  onToggle,
  children,
}: {
  title: string;
  subtitle?: string;
  checked: boolean;
  onToggle: () => void;
  children?: React.ReactNode;
}) {
  return (
    <View style={styles.option}>
      <View style={styles.optionRow}>
        <Checkbox value={checked} onToggle={onToggle} />
        <View style={styles.optionText}>
          <Text style={styles.optionTitle}>{title}</Text>
          {subtitle ? <Text style={styles.optionSub}>{subtitle}</Text> : null}
        </View>
      </View>
      {children}
    </View>
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
  body: {
    paddingTop: 18,
    gap: 22,
  },
  option: {
    gap: 12,
  },
  optionRow: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    gap: 14,
  },
  optionText: {
    flex: 1,
    gap: 3,
  },
  optionTitle: {
    fontSize: 18,
    fontWeight: '700',
    color: 'white',
  },
  optionSub: {
    fontSize: 14,
    lineHeight: 19,
    color: 'rgba(255,255,255,0.5)',
  },
  stepper: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    backgroundColor: 'rgba(255,255,255,0.08)',
    borderRadius: 12,
    height: 52,
    paddingHorizontal: 14,
  },
  stepBtn: {
    width: 44,
    height: 44,
    alignItems: 'center',
    justifyContent: 'center',
  },
  stepValue: {
    fontSize: 18,
    fontWeight: '600',
    color: 'white',
  },
});
