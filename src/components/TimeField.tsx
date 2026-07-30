import DateTimePicker, { type DateTimePickerEvent } from '@react-native-community/datetimepicker';

// The NATIVE iOS compact time picker — which is exactly what the Tesla app uses:
// a chip that turns blue and pops a small floating wheel when tapped, minutes in
// 15-minute steps, no Cancel/Done. Don't reinvent it; iOS draws the chip and the
// popover.
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
      style={disabled ? { opacity: 0.4 } : undefined}
      onChange={(_e: DateTimePickerEvent, d?: Date) => {
        if (d) onChange(fmt(d));
      }}
    />
  );
}
