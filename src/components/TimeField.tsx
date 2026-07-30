import DateTimePicker, { type DateTimePickerEvent } from '@react-native-community/datetimepicker';
import { StyleSheet, View } from 'react-native';

// The NATIVE iOS compact time picker — exactly what the Tesla app uses: a chip
// that turns blue and pops a small floating wheel when tapped, minutes in
// 15-minute steps, no Cancel/Done. iOS draws the chip and the popover.
//
// iOS rounds the compact chip more than the rest of our controls (its default
// corner is ~7 vs the app's design-system 5). It ignores a borderRadius set on
// the picker itself, so the chip is CLIPPED to radius 5 by an overflow:hidden
// wrapper hugging it — the standard way to control the native chip's corner. The
// popover is a separate iOS layer, so clipping the wrapper never touches it.
const pad2 = (n: number) => n.toString().padStart(2, '0');
const fmt = (d: Date) => `${pad2(d.getHours())}:${pad2(d.getMinutes())}`;

function toDate(value: string): Date {
  const [h, m] = value.split(':').map((n) => parseInt(n, 10));
  const d = new Date();
  d.setHours(Number.isFinite(h) ? h : 0, Number.isFinite(m) ? m : 0, 0, 0);
  return d;
}

export function TimeField({
  value,
  onChange,
  disabled,
}: {
  value: string;
  onChange: (time: string) => void;
  disabled?: boolean;
}) {
  return (
    <View style={[styles.clip, disabled && styles.disabled]}>
      <DateTimePicker
        value={toDate(value)}
        mode="time"
        display="compact"
        minuteInterval={15}
        themeVariant="dark"
        accentColor="#3368FF"
        disabled={disabled}
        onChange={(_e: DateTimePickerEvent, d?: Date) => {
          if (d) onChange(fmt(d));
        }}
      />
    </View>
  );
}

const styles = StyleSheet.create({
  clip: {
    // Hug the chip and clip its corners to the design-system radius 5.
    alignSelf: 'flex-end',
    borderRadius: 5,
    overflow: 'hidden',
  },
  disabled: {
    opacity: 0.4,
  },
});
