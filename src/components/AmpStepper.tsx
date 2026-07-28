import { useEffect, useRef, useState } from 'react';
import { Pressable, StyleSheet, Text, View } from 'react-native';
import { SymbolView } from 'expo-symbols';
import * as Haptics from 'expo-haptics';

// AmpStepper — the charging-current control, lifted out of app/charging.tsx so
// the home charge panel uses the SAME one. Same reasoning as ChargeLimitSlider:
// ours, polished, not a second control that drifts.
//
// Two behaviours added to match the real app:
//
//  1. HOLD TO REPEAT. A tap steps once; holding accelerates after a delay.
//  2. AT THE BOUND THE CHEVRON DISAPPEARS — it is not dimmed. Their own crops
//     show `‹ 16 A` with no right chevron at all, because 16 is the max. A
//     disabled-but-present arrow invites a press that does nothing.
//
// The value stays centred either way: the chevron's slot keeps its width when
// the glyph goes, so the number does not jump sideways at the bounds.

// Their detent haptic is Light (recovered from the slider's throttleHaptic), and
// this is the same class of feedback, so it matches rather than using the app's
// firmer Rigid press tick.
const stepTick = () => Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light).catch(() => {});

// Hold-to-repeat timing. The first repeat waits, so a normal tap is never
// mistaken for a hold; after that it accelerates to a steady rate.
const REPEAT_DELAY_MS = 450;
const REPEAT_RATE_MS = 90;

const CHEVRON_SLOT = 30;

export interface AmpStepperProps {
  amps: number;
  min: number;
  max: number;
  /** Live, on every step. DISPLAY only — must not send a command. */
  onChange: (amps: number) => void;
  /**
   * On release. The only thing that talks to the car.
   *
   * Same split as the charge slider, and for the same reason: holding to run
   * 5 A -> 16 A would otherwise dispatch eleven sealed BLE commands down the
   * link the unlock path uses.
   */
  onCommit: (amps: number) => void;
}

export function AmpStepper({ amps, min, max, onChange, onCommit }: AmpStepperProps) {
  // Local while interacting, so the number tracks the press and the car hears
  // one command at the end.
  const [live, setLive] = useState<number | null>(null);
  const shown = live ?? amps;
  const shownRef = useRef(shown);
  shownRef.current = shown;

  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const clear = () => {
    if (timer.current) {
      clearTimeout(timer.current);
      timer.current = null;
    }
  };
  useEffect(() => clear, []);

  const step = (dir: 1 | -1) => {
    const next = shownRef.current + dir;
    if (next < min || next > max) {
      clear();
      return false;
    }
    stepTick();
    shownRef.current = next;
    setLive(next);
    onChange(next);
    return true;
  };

  const press = (dir: 1 | -1) => {
    if (!step(dir)) return;
    const run = (delay: number) => {
      timer.current = setTimeout(() => {
        if (step(dir)) run(REPEAT_RATE_MS);
      }, delay);
    };
    run(REPEAT_DELAY_MS);
  };

  const release = () => {
    clear();
    const settled = shownRef.current;
    setLive(null);
    if (settled !== amps) onCommit(settled);
  };

  return (
    <View style={styles.bar}>
      <Chevron dir="left" hidden={shown <= min} onPressIn={() => press(-1)} onRelease={release} />
      <Text style={styles.value}>{shown} A</Text>
      <Chevron dir="right" hidden={shown >= max} onPressIn={() => press(1)} onRelease={release} />
    </View>
  );
}

function Chevron({
  dir,
  hidden,
  onPressIn,
  onRelease,
}: {
  dir: 'left' | 'right';
  hidden: boolean;
  onPressIn: () => void;
  onRelease: () => void;
}) {
  // The SLOT survives even when the glyph does not, so hiding a chevron at the
  // bound does not shift the value off-centre.
  if (hidden) return <View style={styles.slot} />;
  return (
    <Pressable
      hitSlop={14}
      style={styles.slot}
      onPressIn={onPressIn}
      onPressOut={onRelease}
      // A press that is cancelled (finger dragged off) must still settle, or the
      // repeat would keep running with nothing to stop it.
      onTouchCancel={onRelease}
    >
      <SymbolView name={dir === 'left' ? 'chevron.left' : 'chevron.right'} tintColor="white" size={22} weight="medium" />
    </Pressable>
  );
}

const styles = StyleSheet.create({
  // Measured off the reference (~3.06 px/pt on that crop): the bar is ~136px
  // tall and its corner is ~24px, i.e. 44pt and 8pt. Ours was 56 and 12, which
  // is most of the "takes less space".
  bar: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: 'rgba(255,255,255,0.08)',
    borderRadius: 8,
    paddingHorizontal: 20,
    height: 44,
  },
  slot: {
    width: CHEVRON_SLOT,
    alignItems: 'center',
    justifyContent: 'center',
  },
  value: {
    flex: 1,
    textAlign: 'center',
    fontSize: 17,
    fontWeight: '600',
    color: 'white',
  },
});
