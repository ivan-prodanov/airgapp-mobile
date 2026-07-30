import DateTimePicker, { type DateTimePickerEvent } from '@react-native-community/datetimepicker';
import { StyleSheet, View } from 'react-native';

// The NATIVE iOS compact time picker — exactly what the Tesla app uses: a chip
// that turns blue and pops a small floating wheel when tapped, minutes in
// 15-minute steps, no Cancel/Done. iOS draws the chip and the popover.
//
// iOS draws that chip as a PILL (corner ≈ half its height); Tesla's is a rounded
// rectangle (~radius 12). The picker ignores a borderRadius set on it, and a
// loose wrapper clips nothing because the native view has transparent margin
// around the chip. So the wrapper is a FIXED box slightly smaller than the chip,
// with the picker centred inside and overflow hidden — that bites into the pill's
// rounded ends and leaves radius-12 corners. The popover is a separate iOS layer,
// untouched by the clip.
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
    <DateTimePicker
      value={toDate(value)}
      mode="time"
      display="compact"
      minuteInterval={15}
      themeVariant="dark"
      accentColor="#3368FF"
      disabled={disabled}
      // Tesla's OWN iOS style for this exact chip — `iosPreconditionTimePickerModal`
      // (@1864012): { width: 120, height: 50, alignSelf: 'flex-end',
      // marginRight: -8 }. No borderRadius, no clip — the trick is the FIXED
      // 120x50 frame: at the compact chip's natural (small) size iOS 26 draws a
      // capsule, but stretched to 50pt tall its fixed ~13pt corner reads as a
      // rounded rectangle. That is why every radius/overflow attempt did nothing.
      style={[styles.picker, disabled && styles.disabled]}
      onChange={(_e: DateTimePickerEvent, d?: Date) => {
        if (d) onChange(fmt(d));
      }}
    />
  );
}

const styles = StyleSheet.create({
  picker: {
    width: 120,
    height: 50,
    alignSelf: 'flex-end',
    marginRight: -8,
  },
  disabled: {
    opacity: 0.4,
  },
});
