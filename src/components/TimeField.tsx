import DateTimePicker, { type DateTimePickerEvent } from '@react-native-community/datetimepicker';
import { useRef, useState } from 'react';
import {
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
  const [anchor, setAnchor] = useState<LayoutRectangle | null>(null);
  const chipRef = useRef<View>(null);

  const openPicker = () =>
    chipRef.current?.measureInWindow((x, y, w, h) => {
      setAnchor({ x, y, width: w, height: h });
      setOpen(true);
    });

  const left = anchor
    ? Math.min(Math.max(anchor.x + anchor.width - CARD_W, 8), screenW - CARD_W - 8)
    : 8;
  const top = anchor ? anchor.y + anchor.height + 6 : 120;

  return (
    <>
      <Pressable
        ref={chipRef}
        onPress={openPicker}
        disabled={disabled}
        style={[styles.chip, disabled && styles.disabled]}
      >
        {/* iOS's compact picker doesn't swap the fill when active — it lays a
            translucent light highlight ON TOP of the same fill (the "effect on
            top"). Replicating that gives the lighter pressed look + blue text. */}
        {open ? <View style={styles.chipHighlight} pointerEvents="none" /> : null}
        <Text style={[styles.chipText, open && styles.chipTextOpen]}>{value}</Text>
      </Pressable>

      <Modal visible={open} transparent animationType="fade" onRequestClose={() => setOpen(false)}>
        <Pressable style={styles.backdrop} onPress={() => setOpen(false)} />
        <View style={[styles.card, { top, left }]}>
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
        </View>
      </Modal>
    </>
  );
}

const styles = StyleSheet.create({
  chip: {
    minWidth: 92,
    paddingVertical: 9,
    paddingHorizontal: 18,
    borderRadius: 12,
    // Tesla's `pillBackgroundDarkMode` token — the chip keeps this fill in both
    // states; only the value text tints blue when the wheel is open.
    backgroundColor: '#2D2F34',
    alignItems: 'center',
    justifyContent: 'center',
    alignSelf: 'flex-end',
  },
  // The active-state highlight iOS composites over the fill when the wheel opens.
  chipHighlight: {
    position: 'absolute',
    top: 0,
    left: 0,
    right: 0,
    bottom: 0,
    borderRadius: 12,
    backgroundColor: 'rgba(235,235,245,0.18)',
  },
  disabled: {
    opacity: 0.4,
  },
  chipText: {
    fontSize: 18,
    fontWeight: '600',
    color: 'white',
    fontVariant: ['tabular-nums'],
  },
  // Tesla tints the value blue while the wheel is open.
  chipTextOpen: {
    color: '#3368FF',
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
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 8 },
    shadowOpacity: 0.5,
    shadowRadius: 16,
  },
  wheel: {
    height: 200,
  },
});
