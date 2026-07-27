import { useEffect, useRef, useState } from 'react';
import { Animated, PanResponder, StyleSheet, View } from 'react-native';
import * as Haptics from 'expo-haptics';

// ChargeLimitSlider — the charge-limit control, lifted out of app/charging.tsx
// so the home charge panel uses the SAME one rather than a second slider that
// drifts. Behaviour and geometry are ours, not recovered from Tesla's bundle
// (Ivan: "I meant OUR charging page").
//
// ── The two states ────────────────────────────────────────────────────────
// NORMAL   — untouched, or touched but not yet moved off its starting value.
// CHANGING — touched AND moved.
//
// What differs, and it is only these two things:
//   • the detent breaks at 50/60/70/80/90 are INVISIBLE in normal state and
//     appear only while changing;
//   • the thumb grows.
//
// "Tapped but not moved" deliberately counts as NORMAL. A tap that lands on the
// current value should not flash the breaks on and straight back off.
//
// The breaks are BREAKS — gaps punched in the bar in the surface colour behind
// it — not bright tick marks drawn on top. That is why `surfaceColor` is a
// required prop: the slider cannot know what it is sitting on, and guessing
// would draw a light line on a dark card, which is what the old version did.

// 100 is the track's end, so it needs no drawn break.
const DETENTS = [50, 60, 70, 80, 90, 100];
// How close to a detent the magnet starts acting, in percent.
const SNAP = 2;
// How hard it pulls, as a multiplier on the distance from the detent. 1 = no
// magnet, 0 = a hard snap that swallows everything inside SNAP (what we had).
// 0.5 halves the remaining distance, so within ±2 the reachable values thin out
// but do not vanish: raw 58.0-58.9 lands on 59, and 57 is untouched.
const MAGNET_PULL = 0.5;

// Measured off Ivan's two reference crops rather than guessed. Both crops are
// the same scale — the track spans ~1020px for a ~340pt card, so ~3.0 px/pt:
//
//   normal thumb   ~48px  -> 16pt      changing thumb ~62px -> 21pt
//   track height   ~14px  ->  5pt      break width    ~7px  ->  2pt
//
// The old 24/30 was roughly 1.5x too big, which is what made it read as "much
// bigger than Tesla" and why growing it looked wrong rather than subtle.
// Re-measured off the 1:1 crops (both 1260px, near-identical card widths, so
// these compare directly): their thumb is ~56px to our ~60px.
const THUMB_NORMAL = 15;
const THUMB_CHANGING = 20;
// Theirs is not pure white — it reads as a light grey against the card, which is
// the most visible remaining difference at 1:1.
const THUMB_COLOR = '#E8E8E8';
const TRACK_H = 5;
const BREAK_W = 3;

// ── Colours ───────────────────────────────────────────────────────────────
// Measured off the reference by Ivan, and they replace TWO wrong guesses of
// mine. First I invented Apple's #34C759 over rgba(255,255,255,0.18). Then I
// "recovered" Colors.chargeSliderUnfinishedTrack / chargeSliderMaxTrack from the
// bundle and built a three-zone track out of them — but those constants belong
// to a DIFFERENT slider. Finding a plausible constant is not the same as finding
// the right one.
//
// The real thing is ONE flat track:
const GREEN = '#00d780';
const TRACK = '#2c2e32';
// And the breakers are LIGHTER than the track — thin vertical bars drawn ON it,
// standing proud top and bottom. Not gaps punched through in the surface colour,
// which is what made them invisible: I had them darker than their background.
//
// ⚠️ This one value is ESTIMATED off the zoomed crop, not measured from a
// constant — it reads as a mid grey against the #2c2e32 track. Say if it is off.
// Darkened after comparing side by side: theirs sit only a little above the
// #2c2e32 track, mine were clearly lighter and read as bright ticks again.
const BREAK_COLOR = '#4A4C50';

const detentTick = () => Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Rigid).catch(() => {});

export interface ChargeLimitSliderProps {
  /** The car's current charge, drawn as the green fill. Independent of the limit. */
  batteryPercent: number | null;
  /** The limit, drawn as the thumb. */
  limitPercent: number;
  min: number;
  max: number;
  onChange: (percent: number) => void;
  /** Lets a parent freeze its ScrollView while the drag owns the touch. */
  onSlidingChange?: (sliding: boolean) => void;
}

export function ChargeLimitSlider({
  batteryPercent,
  limitPercent,
  min,
  max,
  onChange,
  onSlidingChange,
}: ChargeLimitSliderProps) {
  const [changing, setChanging] = useState(false);
  // The thumb follows the FINGER continuously while dragging, even though the
  // committed value is a whole percent. That is the "several movements between
  // each 1%" Ivan describes on Tesla: their thumb is a Reanimated shared value
  // in pixels, so it glides while the number steps. Ours used to jump a whole
  // percent at a time, which reads as coarse however fine the value maths is.
  const [dragFrac, setDragFrac] = useState<number | null>(null);

  // Handlers are built ONCE, so everything they touch goes through a ref —
  // otherwise the PanResponder captures the first render's callbacks. Kept
  // fresh in an effect rather than during render; they are only read from drag
  // handlers, which by definition run after mount.
  const onChangeRef = useRef(onChange);
  const onSlidingRef = useRef(onSlidingChange);
  useEffect(() => {
    onChangeRef.current = onChange;
    onSlidingRef.current = onSlidingChange;
  }, [onChange, onSlidingChange]);

  // Absolute pageX minus the track's measured window-left, NOT the
  // target-relative locationX: locationX is reported against whatever view is
  // under the finger, so once the thumb slid under it the value oscillated.
  const trackRef = useRef<View>(null);
  const trackW = useRef(0);
  const trackLeft = useRef(0);
  const lastValue = useRef(limitPercent);
  // The value the touch STARTED on. `changing` turns on only once the drag
  // leaves it — that is the whole normal/changing distinction.
  const grantValue = useRef(limitPercent);

  const bounds = useRef({ min, max });
  useEffect(() => {
    bounds.current = { min, max };
  }, [min, max]);

  const measureTrack = () => {
    trackRef.current?.measureInWindow((x, _y, w) => {
      if (w > 0) {
        trackLeft.current = x;
        trackW.current = w;
      }
    });
  };

  const applyFromPageX = (pageX: number) => {
    const w = trackW.current;
    if (w <= 0) return;
    const { min: lo, max: hi } = bounds.current;
    const frac = Math.max(0, Math.min(1, (pageX - trackLeft.current) / w));
    // Continuous first, rounded LAST. The old code rounded to an integer and
    // then hard-clamped anything within SNAP of a detent onto it, which made
    // 58 and 59 unreachable — from 57 the next value you could get was 60.
    //
    // Tesla's magnet does not remove percentages, it warps travel toward the
    // detent: near 60 the thumb accelerates, but 59 is still addressable. So
    // this compresses the raw value toward the detent instead of snapping it,
    // and only then rounds.
    const raw = Math.max(lo, Math.min(hi, frac * hi));
    let warped = raw;
    for (const d of DETENTS) {
      const delta = raw - d;
      if (Math.abs(delta) <= SNAP) {
        warped = d + delta * MAGNET_PULL;
        break;
      }
    }
    const value = Math.max(lo, Math.min(hi, Math.round(warped)));
    // Warped, not raw — so the thumb visibly accelerates into a detent, which is
    // what makes the magnet FELT rather than merely computed.
    setDragFrac(Math.max(lo, Math.min(hi, warped)) / hi);
    const prev = lastValue.current;
    if (value === prev) return;
    if (DETENTS.some((d) => (prev < d && value >= d) || (prev > d && value <= d))) detentTick();
    lastValue.current = value;
    // Moved off where the touch landed ⇒ CHANGING.
    if (value !== grantValue.current) setChanging(true);
    onChangeRef.current(value);
  };

  const pan = useRef(
    PanResponder.create({
      onStartShouldSetPanResponder: () => true,
      onMoveShouldSetPanResponder: () => true,
      // Never hand the touch back to a parent ScrollView once the drag owns it.
      onPanResponderTerminationRequest: () => false,
      onPanResponderGrant: (e) => {
        measureTrack();
        grantValue.current = lastValue.current;
        onSlidingRef.current?.(true);
        applyFromPageX(e.nativeEvent.pageX);
      },
      onPanResponderMove: (e) => applyFromPageX(e.nativeEvent.pageX),
      onPanResponderRelease: () => {
        setChanging(false);
        setDragFrac(null);
        onSlidingRef.current?.(false);
      },
      onPanResponderTerminate: () => {
        setChanging(false);
        setDragFrac(null);
        onSlidingRef.current?.(false);
      },
    }),
  ).current;

  // Keep the drag's idea of the value in step when the CAR changes it.
  useEffect(() => {
    lastValue.current = limitPercent;
  }, [limitPercent]);

  // Both state changes animate, so the breaks fade rather than pop and the
  // thumb grows rather than jumps.
  const anim = useRef(new Animated.Value(0)).current;
  useEffect(() => {
    Animated.timing(anim, {
      toValue: changing ? 1 : 0,
      duration: 140,
      useNativeDriver: false,
    }).start();
  }, [changing, anim]);

  const thumbSize = anim.interpolate({ inputRange: [0, 1], outputRange: [THUMB_NORMAL, THUMB_CHANGING] });
  const breakOpacity = anim;

  const batteryFrac = Math.max(0, Math.min(1, (batteryPercent ?? 0) / max));
  const limitFrac = dragFrac ?? Math.max(0, Math.min(1, limitPercent / max));

  return (
    <View style={styles.row} {...pan.panHandlers}>
      <View ref={trackRef} style={styles.track} onLayout={measureTrack}>
        <View pointerEvents="none" style={[styles.fill, { width: `${batteryFrac * 100}%` }]} />
        {/* Breaks, drawn in the SURFACE colour so the bar reads as interrupted
            rather than marked. Hidden entirely in normal state. */}
        {DETENTS.filter((d) => d < max).map((d) => (
          <Animated.View
            key={d}
            pointerEvents="none"
            style={[styles.break, { left: `${d}%`, opacity: breakOpacity }]}
          />
        ))}
        <Animated.View
          pointerEvents="none"
          style={[
            styles.thumb,
            {
              left: `${limitFrac * 100}%`,
              width: thumbSize,
              height: thumbSize,
              borderRadius: Animated.divide(thumbSize, 2),
              marginLeft: Animated.multiply(thumbSize, -0.5),
              marginTop: Animated.multiply(thumbSize, -0.5),
            },
          ]}
        />
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  row: {
    paddingVertical: 20,
  },
  track: {
    width: '100%',
    height: TRACK_H,
    borderRadius: 3,
    backgroundColor: TRACK,
    justifyContent: 'center',
  },
  fill: {
    position: 'absolute',
    left: 0,
    top: 0,
    bottom: 0,
    borderRadius: 3,
    backgroundColor: GREEN,
  },
  // A gap punched through the bar. Slightly taller than the track so the ends
  // read as a clean cut rather than a smudge.
  // A thin light bar standing proud of the track top and bottom — 5pt track,
  // ~9pt bar — matching the zoomed crop, where the breakers clearly overhang.
  break: {
    position: 'absolute',
    // Sized by breaker-to-thumb RATIO, which survives a scale difference between
    // crops: theirs is 26/56 = 0.46, ours was 30/60 = 0.50. Against a 20pt thumb
    // that is ~9pt of bar, i.e. 2pt proud of the 5pt track each side.
    top: -2,
    bottom: -2,
    width: BREAK_W,
    marginLeft: -BREAK_W / 2,
    borderRadius: 1,
    backgroundColor: BREAK_COLOR,
  },
  thumb: {
    position: 'absolute',
    top: '50%',
    backgroundColor: THUMB_COLOR,
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 1 },
    shadowOpacity: 0.35,
    shadowRadius: 3,
  },
});
