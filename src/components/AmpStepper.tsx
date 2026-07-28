import { useEffect, useRef, useState } from "react";
import { Pressable, StyleSheet, Text, View } from "react-native";
import { SymbolView } from "expo-symbols";
import * as Haptics from "expo-haptics";

import { TeslaFonts } from "@/constants/fonts";

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
const stepTick = () =>
  Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light).catch(() => {});

// Hold-to-repeat timing. The first repeat waits, so a normal tap is never
// mistaken for a hold; after that it accelerates to a steady rate.
const REPEAT_DELAY_MS = 450;
const REPEAT_RATE_MS = 90;

const CHEVRON_SLOT = 44;
const GUTTER = 10;

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

export function AmpStepper({
  amps,
  min,
  max,
  onChange,
  onCommit,
}: AmpStepperProps) {
  // Local while interacting, so the number tracks the press and the car hears
  // one command at the end.
  const [live, setLive] = useState<number | null>(null);
  const shown = live ?? amps;
  // Synced in an effect, not during render. `step` reads this synchronously
  // while a hold repeats, so it needs a ref — but writing it inline was a
  // render-phase ref mutation (react-hooks/refs). Committing it after render is
  // equivalent here: a press can only arrive after the commit that changed it.
  const shownRef = useRef(shown);
  useEffect(() => {
    shownRef.current = shown;
  }, [shown]);

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
      <Chevron
        dir="left"
        hidden={shown <= min}
        onPressIn={() => press(-1)}
        onRelease={release}
      />
      <View style={styles.valueWrap} pointerEvents="none">
        <Text style={styles.value}>{shown} A</Text>
      </View>
      <Chevron
        dir="right"
        hidden={shown >= max}
        onPressIn={() => press(1)}
        onRelease={release}
      />
    </View>
  );
}

function Chevron({
  dir,
  hidden,
  onPressIn,
  onRelease,
}: {
  dir: "left" | "right";
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
      <SymbolView
        name={dir === "left" ? "chevron.left" : "chevron.right"}
        tintColor="white"
        size={22}
        weight="medium"
      />
    </Pressable>
  );
}

const styles = StyleSheet.create({
  // VehicleChargeAmps' own StyleSheet, read rather than measured:
  //   container                row, alignItems center, justifyContent space-between,
  //                            height 4.5*Gutter, position relative
  //   currentControlsContainer bg Gray.dark, borderRadius Gutter*0.5
  //   currentAdjustmentArrows  alignItems center, justifyContent center, zIndex 100
  //   currentTextContainer     position absolute, left 0, right 0, row, center
  //   currentText              getFontStyle({type:'Medium', fontSize:15})
  //   currentTextInactive      opacity 0.3
  //
  // The two corrections Ivan called: the chevrons are NOT inset — the row is
  // space-between with ZERO horizontal padding, so they sit at the bar's edges
  // (I had paddingHorizontal 20, then 8). And the value is 15 Medium, not 16/600.
  bar: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    position: "relative",
    backgroundColor: "rgba(255,255,255,0.08)",
    borderRadius: 0.5 * GUTTER,
    height: 4.5 * GUTTER,
  },
  slot: {
    width: CHEVRON_SLOT,
    alignItems: "center",
    justifyContent: "center",
    zIndex: 100,
  },
  // currentTextContainer — absolutely centred across the FULL bar, so the value
  // stays dead-centre no matter which chevrons are present. Their design does
  // not need my "keep the slot to stop the number jumping" trick; it cannot jump.
  valueWrap: {
    position: "absolute",
    left: 0,
    right: 0,
    flexDirection: "row",
    justifyContent: "center",
  },
  value: {
    fontFamily: TeslaFonts.medium,
    fontSize: 15,
    color: "white",
  },
});
