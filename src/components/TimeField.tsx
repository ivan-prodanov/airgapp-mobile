import DateTimePicker, { type DateTimePickerEvent } from '@react-native-community/datetimepicker';
import { useEffect, useRef, useState } from 'react';
import {
  Animated,
  Easing,
  Modal,
  Pressable,
  StyleSheet,
  Text,
  useWindowDimensions,
  View,
  type LayoutRectangle,
} from 'react-native';

// Tesla's time field is a CUSTOM chip, not the native compact picker. On iOS 26
// the native `display="compact"` chip is an uncontrollable capsule (pill) — RN
// ignores width/height/borderRadius on it, which is why every attempt to square
// it did nothing. So, like Tesla, we draw our own rounded-rect chip and open a
// native wheel when it is tapped: the chip is fully ours to style, the wheel is
// still the OS component.
const pad2 = (n: number) => n.toString().padStart(2, '0');
const fmt = (d: Date) => `${pad2(d.getHours())}:${pad2(d.getMinutes())}`;

function toDate(value: string): Date {
  const [h, m] = value.split(':').map((n) => parseInt(n, 10));
  const d = new Date();
  d.setHours(Number.isFinite(h) ? h : 0, Number.isFinite(m) ? m : 0, 0, 0);
  return d;
}

const CARD_W = 240;
const CARD_H = 200; // card wraps the 200pt wheel with no padding

export function TimeField({
  value,
  onChange,
  disabled,
}: {
  value: string;
  onChange: (time: string) => void;
  disabled?: boolean;
}) {
  const { width: screenW } = useWindowDimensions();
  const [open, setOpen] = useState(false);
  // `render` keeps the Modal mounted through the close animation; `anim` drives
  // the expand (0 → 1) / minimize (1 → 0), replacing the Modal's plain fade with
  // a scale+fade that grows from near the chip — closer to the native popover.
  const [render, setRender] = useState(false);
  const anim = useRef(new Animated.Value(0)).current;
  const [anchor, setAnchor] = useState<LayoutRectangle | null>(null);
  const chipRef = useRef<View>(null);

  useEffect(() => {
    if (open) {
      setRender(true);
      Animated.timing(anim, {
        toValue: 1,
        duration: 250,
        easing: Easing.out(Easing.cubic),
        useNativeDriver: true,
      }).start();
    } else {
      Animated.timing(anim, {
        toValue: 0,
        duration: 250,
        easing: Easing.in(Easing.cubic),
        useNativeDriver: true,
      }).start(({ finished }) => {
        if (finished) setRender(false);
      });
    }
  }, [open, anim]);

  const openPicker = () =>
    chipRef.current?.measureInWindow((x, y, w, h) => {
      setAnchor({ x, y, width: w, height: h });
      setOpen(true);
    });

  // Which side of the screen is the chip on? A chip on the LEFT (charging Start/End)
  // opens a popover that LEFT-aligns to it and grows from its top-LEFT corner; one on
  // the RIGHT (precondition) right-aligns and grows from its top-RIGHT — always out of
  // the chip and toward the centre, where there's room. This is the custom equivalent
  // of iOS's native compact-picker popover, which anchors to the control and opens
  // toward available space rather than hardcoding a side.
  const alignLeft = anchor ? anchor.x + anchor.width / 2 < screenW / 2 : false;
  const left = anchor
    ? Math.min(
        Math.max(alignLeft ? anchor.x : anchor.x + anchor.width - CARD_W, 8),
        screenW - CARD_W - 8,
      )
    : 8;
  const top = anchor ? anchor.y + anchor.height + 6 : 120;
  // Pivot the grow/shrink at the chip's near corner (top-left for a left chip,
  // top-right for a right chip).
  const pivotX = alignLeft ? -CARD_W / 2 : CARD_W / 2;

  return (
    <>
      <Pressable
        ref={chipRef}
        onPress={openPicker}
        disabled={disabled}
        style={[styles.chip, disabled && styles.disabled]}
      >
        {/* When open, Tesla's chip DARKENS (a pressed-in look), not lightens —
            a translucent black scrim composited on top of the fill + blue text. */}
        {open ? <View style={styles.chipHighlight} pointerEvents="none" /> : null}
        <Text style={[styles.chipText, open && styles.chipTextOpen]}>{value}</Text>
      </Pressable>

      <Modal visible={render} transparent animationType="none" onRequestClose={() => setOpen(false)}>
        <Pressable style={styles.backdrop} onPress={() => setOpen(false)} />
        <Animated.View
          style={[
            styles.card,
            {
              top,
              left,
              opacity: anim.interpolate({ inputRange: [0, 1], outputRange: [0, 1], extrapolate: 'clamp' }),
              // Grow OUT of the chip: scale from small → full, pivoting at the
              // card's top-right corner (which sits just under the chip) rather
              // than its centre. The translate sandwich moves that corner to the
              // origin, scales, then moves it back — so the corner stays put and
              // the popover expands/minimizes from it, like the native one.
              transform: [
                { translateX: pivotX },
                { translateY: -CARD_H / 2 },
                { scale: anim.interpolate({ inputRange: [0, 1], outputRange: [0.35, 1] }) },
                { translateX: -pivotX },
                { translateY: CARD_H / 2 },
              ],
            },
          ]}
        >
          <DateTimePicker
            value={toDate(value)}
            mode="time"
            display="spinner"
            minuteInterval={15}
            themeVariant="dark"
            textColor="white"
            style={styles.wheel}
            onChange={(_e: DateTimePickerEvent, d?: Date) => {
              if (d) onChange(fmt(d));
            }}
          />
        </Animated.View>
      </Modal>
    </>
  );
}

const styles = StyleSheet.create({
  chip: {
    // Sized to iOS's native compact picker (what Tesla uses): tight padding,
    // ~34pt tall — ours was chunkier (pV9/pH18/minWidth92).
    paddingVertical: 6,
    paddingHorizontal: 12,
    borderRadius: 8,
    // Tesla's `pillBackgroundDarkMode` token — the chip keeps this fill in both
    // states; only the value text tints blue when the wheel is open.
    backgroundColor: '#2D2F34',
    alignItems: 'center',
    justifyContent: 'center',
    alignSelf: 'flex-end',
  },
  // The darkening scrim composited over the fill while the wheel is open —
    // Tesla's chip presses IN (darker), not out (lighter).
  chipHighlight: {
    position: 'absolute',
    top: 0,
    left: 0,
    right: 0,
    bottom: 0,
    borderRadius: 8,
    backgroundColor: 'rgba(0,0,0,0.28)',
  },
  disabled: {
    opacity: 0.4,
  },
  chipText: {
    // Native picker value text: 17pt, regular weight (ours was 18/600 — bigger,
    // heavier than Tesla).
    fontSize: 17,
    fontWeight: '400',
    color: 'white',
    fontVariant: ['tabular-nums'],
  },
  // Open: the value tints the iOS system blue (#0A84FF, dark mode) — the native
  // picker's active tint, NOT Tesla's brand #3368FF which I'd wrongly hardcoded.
  chipTextOpen: {
    color: '#0A84FF',
  },
  backdrop: {
    flex: 1,
    backgroundColor: 'transparent',
  },
  card: {
    position: 'absolute',
    width: CARD_W,
    backgroundColor: '#2C2C2E',
    borderRadius: 14,
    overflow: 'hidden',
    // Center the wheels instead of stretching the picker to the card width —
    // a stretched .time spinner hugs the trailing edge (right-aligned). Letting
    // it size to its intrinsic content and centering matches Tesla's native pop.
    alignItems: 'center',
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 8 },
    shadowOpacity: 0.5,
    shadowRadius: 16,
  },
  wheel: {
    height: 200,
  },
});
