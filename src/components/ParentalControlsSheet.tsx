import { useEffect, useState } from 'react';
import { StyleSheet, Text, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { SymbolView } from 'expo-symbols';
import * as Haptics from 'expo-haptics';

import { TeslaFonts } from '@/constants/fonts';
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
// stepper (MPH in state, km/h on screen) when checked. Debounced 1.2s (Tesla's `debounceMS`).
//
// Styling copied from Tesla's VehicleParentalControlsSettingsScreen (@5053180):
//   header = TextCategory.BodyLabel (14 / Universal Sans Medium), centred, paddingBottom = Gutter/2 (5)
//   divider = 1px `dividerColor` #2D2E2F at opacity 0.5, marginVertical = 1.5·Gutter (15), full-width
//   row     = RowWithButton, style override { paddingHorizontal: 2·Gutter (20), paddingVertical: Gutter (10) }
//   title = BodyLabel (14); subtitle = CaptionLabel (12/16) at opacity 0.6; checkbox→text gap = Gutter (10)
//   stepper = Stepper, backgroundTransparentSecondary (white 8%), Specifications.borderRadius (5)
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
  // SpeedLimitSheet). Shared cap with Speed Limit Mode — ONE value on the car — so read/write speedLimitMph.
  const propKmh = speedLimitDisplayKmh(state.speedLimitMph);
  const [kmh, setKmh] = useState(propKmh);
  useEffect(() => {
    setKmh(propKmh);
  }, [propKmh]);
  const debouncedSetMph = useDebouncedCallback(
    (mph: number) => actions.patch({ speedLimitMph: mph }),
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
    <SlideUpSheet visible={visible} onDismiss={onClose} panelStyle={styles.panel}>
      <View style={[styles.content, { paddingBottom: insets.bottom + 4 }]}>
        <Text style={styles.header}>Customize Parental Controls</Text>
        <View style={styles.divider} />

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
                hitSlop={12}
                style={styles.stepBtn}
              >
                <SymbolView
                  name="chevron.left"
                  tintColor={kmh <= SPEED_LIMIT_MIN_KMH ? DIM : 'white'}
                  size={16}
                  weight="regular"
                />
              </HoldRepeatButton>
              <Text style={styles.stepValue}>{kmh} km/h</Text>
              <HoldRepeatButton
                onStep={() => step(1)}
                disabled={kmh >= SPEED_LIMIT_MAX_KMH}
                hitSlop={12}
                style={styles.stepBtn}
              >
                <SymbolView
                  name="chevron.right"
                  tintColor={kmh >= SPEED_LIMIT_MAX_KMH ? DIM : 'white'}
                  size={16}
                  weight="regular"
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
    <View style={styles.row}>
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
  // Match Tesla's barely-rounded sheet (Specifications.borderRadius = 5), not the shared 20.
  panel: {
    borderTopLeftRadius: 5,
    borderTopRightRadius: 5,
  },
  content: {
    // Rows self-pad horizontally so the divider can run full-width (Tesla's container has no side padding).
    paddingTop: 16,
  },
  // TextCategory.BodyLabel, centred, paddingBottom = Gutter/2.
  header: {
    fontFamily: TeslaFonts.medium,
    fontSize: 14,
    lineHeight: 20,
    letterSpacing: 0.1,
    color: 'white',
    alignSelf: 'center',
    paddingBottom: 5,
  },
  // 1px #2D2E2F @ 0.5, full-width, marginVertical = 1.5·Gutter.
  divider: {
    height: 1,
    backgroundColor: '#2D2E2F',
    opacity: 0.5,
    marginVertical: 15,
  },
  // RowWithButton style override: paddingHorizontal 2·Gutter, paddingVertical Gutter. No minHeight, so the
  // rows are compact (title + subtitle) instead of the 70pt settings-row height.
  row: {
    paddingHorizontal: 20,
    paddingVertical: 10,
  },
  optionRow: {
    flexDirection: 'row',
    // Tesla's iconTextContainer centres the checkbox against the whole title+subtitle block (was flex-start,
    // which pinned it to the top line).
    alignItems: 'center',
    // Checkbox→text gap: textContainerWithIcon marginLeft (Gutter) + the title/subtitle's own marginLeft
    // (Gutter) — the text sits ~2 Gutters off the box, not one.
    gap: 18,
  },
  optionText: {
    flex: 1,
  },
  // title = BodyLabel (14 / Medium).
  optionTitle: {
    fontFamily: TeslaFonts.medium,
    fontSize: 14,
    lineHeight: 20,
    letterSpacing: 0.1,
    color: 'white',
  },
  // subtitle = CaptionLabel (12/16 / Medium) at opacity 0.6, marginTop 2.
  optionSub: {
    fontFamily: TeslaFonts.medium,
    fontSize: 12,
    lineHeight: 16,
    letterSpacing: 0.1,
    color: 'rgba(255,255,255,0.6)',
    marginTop: 2,
  },
  // Stepper box: white-8% fill, borderRadius 5, aligned under the title (marginLeft = checkbox + gap).
  stepper: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    backgroundColor: 'rgba(255,255,255,0.08)',
    borderRadius: 5,
    height: 44,
    paddingHorizontal: 6,
    marginTop: 10,
    // Align the box's left edge under the title (checkbox width + gap).
    marginLeft: 38,
  },
  stepBtn: {
    width: 40,
    height: 40,
    alignItems: 'center',
    justifyContent: 'center',
  },
  // Stepper default value = BodyLabel; nudged to 16 to read as the box's focal number.
  stepValue: {
    fontFamily: TeslaFonts.medium,
    fontSize: 16,
    color: 'white',
  },
});
