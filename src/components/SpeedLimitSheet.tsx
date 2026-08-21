import { useEffect, useState } from 'react';
import { StyleSheet, Text, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import * as Haptics from 'expo-haptics';

import { TeslaFonts } from '@/constants/fonts';
import {
  speedLimitDisplayKmh,
  speedLimitKmhToStoredMph,
  SPEED_LIMIT_DEBOUNCE_MS,
  SPEED_LIMIT_MAX_KMH,
  SPEED_LIMIT_MIN_KMH,
} from '@/state/fleet';
import { HoldRepeatButton } from './HoldRepeatButton';
import { SlideUpSheet } from './SlideUpSheet';
import { useDebouncedCallback } from './useDebouncedCallback';
import { AppIcon } from '../icons/AppIcon';

const DIM = 'rgba(255,255,255,0.25)';

// "Adjust Speed Limit" bottom sheet (Speed Limit Mode's "…"). Slides up over a dimmed screen; tapping
// above the panel closes it. Stored in MPH (the car's unit) but stepped in km/h by 1 — matching the Tesla
// app's stepper — so the reading moves 116→115→114, not the jumpy 116→114 you'd get stepping MPH. The
// number updates on every press; the car command is debounced 1.2s (Tesla's `debounceMS`), so a burst of
// presses sends ONE command with the final value instead of one per press.
//
// Layout copied from Tesla's `Stepper` (isLargeStepper): title = TextCategory.BodyLabel (14 / Medium),
// value = TextCategory.H2 but overridden to `speedLimitNumber` = { fontSize: 30, letterSpacing: 2 } in the
// Universal Sans Display face, unit on its own line below. The row is three columns — a 25%-wide arrow
// button on each side and the value in the middle 50% — NOT chevrons pushed to the screen edges.
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
  // Local km/h for immediate display; the debounced onChange is the only thing that reaches the car. Re-sync
  // from the prop when it changes from outside (a failed command's revert, or telemetry) — not our own send.
  const propKmh = speedLimitDisplayKmh(mph);
  const [kmh, setKmh] = useState(propKmh);
  useEffect(() => {
    setKmh(propKmh);
  }, [propKmh]);
  const debouncedChange = useDebouncedCallback(onChange, SPEED_LIMIT_DEBOUNCE_MS);

  const step = (dir: -1 | 1) => {
    setKmh((k) => {
      const next = k + dir;
      if (next < SPEED_LIMIT_MIN_KMH || next > SPEED_LIMIT_MAX_KMH) return k; // at a bound
      Haptics.selectionAsync().catch(() => {});
      debouncedChange(speedLimitKmhToStoredMph(next));
      return next;
    });
  };

  const atMin = kmh <= SPEED_LIMIT_MIN_KMH;
  const atMax = kmh >= SPEED_LIMIT_MAX_KMH;

  return (
    // Tesla's sheet is barely rounded (Specifications.borderRadius = 5), not the 20 the shared sheet
    // defaults to — override just this panel rather than restyle every sheet.
    <SlideUpSheet visible={visible} onDismiss={onClose} panelStyle={styles.panel}>
      <View style={[styles.content, { paddingBottom: insets.bottom + 11 }]}>
        {/* Just the title text above the value — Tesla has NO header bar and NO separator. */}
        <Text style={styles.title}>Adjust Speed Limit</Text>

        <View style={styles.row}>
          {/* 25%-wide button, glyph centred — keeps the chevron off the screen edge. Tesla's arrow is a
              small thin glyph, so the SF chevron is sized to that, not to the 36px icon box. */}
          <HoldRepeatButton onStep={() => step(-1)} disabled={atMin} hitSlop={16} style={styles.stepBtn}>
            <AppIcon icon="chevron-270" color={atMin ? DIM : 'white'} size={20} />
          </HoldRepeatButton>

          <View style={styles.valueCol}>
            <Text style={styles.value}>{kmh}</Text>
            <Text style={styles.unit}>km/h</Text>
          </View>

          <HoldRepeatButton onStep={() => step(1)} disabled={atMax} hitSlop={16} style={styles.stepBtn}>
            <AppIcon icon="chevron-90" color={atMax ? DIM : 'white'} size={20} />
          </HoldRepeatButton>
        </View>
      </View>
    </SlideUpSheet>
  );
}

const styles = StyleSheet.create({
  // Tesla's bottom sheet is barely rounded — Specifications.borderRadius = 5 (ours defaulted to 20).
  panel: {
    borderTopLeftRadius: 5,
    borderTopRightRadius: 5,
  },
  content: {
    alignItems: 'center',
    paddingHorizontal: 24,
    // Panel height is unchanged from before — top+bottom padding still sum to the same total. We just
    // shifted the split (was 15 top / +20 bottom) so the group sits a little lower without growing the sheet.
    paddingTop: 24,
  },
  // TextCategory.BodyLabel: 14 / Universal Sans Medium / ls 0.1 — Tesla's stepper title, NOT a big header.
  title: {
    fontFamily: TeslaFonts.medium,
    fontSize: 14,
    lineHeight: 20,
    letterSpacing: 0.1,
    color: 'white',
    textAlign: 'center',
  },
  row: {
    flexDirection: 'row',
    alignItems: 'center',
    alignSelf: 'stretch',
    // Gap to the title comes from `value.paddingTop` (15) below — Tesla's speedLimitNumber padding.
  },
  // Each arrow owns 25% of the width; the value the middle 50%.
  stepBtn: {
    width: '25%',
    alignItems: 'center',
    justifyContent: 'center',
  },
  valueCol: {
    width: '50%',
    alignItems: 'center',
  },
  // speedLimitNumber @5051727: fontSize 30, letterSpacing 2 (H2 category = Universal Sans Display, weight
  // 500 — we only bundle the Text face, so Medium is the closest cut).
  value: {
    fontFamily: TeslaFonts.medium,
    fontSize: 30,
    letterSpacing: 2,
    color: 'white',
    paddingTop: 15,
    paddingBottom: 5,
  },
  unit: {
    fontFamily: TeslaFonts.medium,
    fontSize: 13,
    // Tesla's unit is CaptionLabel in the sheet's `textColor` (same token as the arrows) — a light grey,
    // not the darker rgba(0.5) (~#8A8A8A) we had.
    color: '#BFBFBF',
  },
});
