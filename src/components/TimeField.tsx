import DateTimePicker, { type DateTimePickerEvent } from '@react-native-community/datetimepicker';
import { useEffect, useState } from 'react';
import { Modal, Pressable, StyleSheet, Text, View } from 'react-native';

// A rounded pill (our app's style) that opens the native iOS time wheel in a bottom sheet. The compact
// inline picker can't have its corner radius changed (UIKit draws it), so we draw our own pill and use the
// native `spinner` wheel for the actual editing — rounded look + real native picker.
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
  const [open, setOpen] = useState(false);
  const [temp, setTemp] = useState(() => toDate(value));

  // Seed the wheel from the current value each time the sheet opens.
  useEffect(() => {
    if (open) setTemp(toDate(value));
  }, [open, value]);

  return (
    <>
      <Pressable
        style={[styles.pill, disabled && styles.pillDisabled]}
        disabled={disabled}
        onPress={() => setOpen(true)}
      >
        <Text style={styles.pillText}>{value}</Text>
      </Pressable>

      <Modal visible={open} transparent animationType="slide" onRequestClose={() => setOpen(false)}>
        <Pressable style={styles.backdrop} onPress={() => setOpen(false)} />
        <View style={styles.sheet}>
          <View style={styles.sheetHeader}>
            <Pressable hitSlop={10} onPress={() => setOpen(false)}>
              <Text style={styles.cancel}>Cancel</Text>
            </Pressable>
            <Pressable
              hitSlop={10}
              onPress={() => {
                onChange(fmt(temp));
                setOpen(false);
              }}
            >
              <Text style={styles.done}>Done</Text>
            </Pressable>
          </View>
          <DateTimePicker
            value={temp}
            mode="time"
            display="spinner"
            themeVariant="dark"
            textColor="white"
            onChange={(_e: DateTimePickerEvent, d?: Date) => {
              if (d) setTemp(d);
            }}
          />
        </View>
      </Modal>
    </>
  );
}

const styles = StyleSheet.create({
  pill: {
    minWidth: 92,
    paddingVertical: 10,
    paddingHorizontal: 18,
    borderRadius: 16,
    backgroundColor: '#3A3A3C',
    alignItems: 'center',
    justifyContent: 'center',
  },
  pillDisabled: {
    opacity: 0.4,
  },
  pillText: {
    fontSize: 22,
    fontWeight: '600',
    color: 'white',
    fontVariant: ['tabular-nums'],
  },
  backdrop: {
    flex: 1,
    backgroundColor: 'rgba(0,0,0,0.5)',
  },
  sheet: {
    backgroundColor: '#1C1C1E',
    borderTopLeftRadius: 20,
    borderTopRightRadius: 20,
    paddingBottom: 30,
  },
  sheetHeader: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    paddingHorizontal: 20,
    paddingVertical: 14,
    borderBottomWidth: StyleSheet.hairlineWidth,
    borderBottomColor: 'rgba(255,255,255,0.1)',
  },
  cancel: {
    fontSize: 17,
    color: 'rgba(255,255,255,0.6)',
  },
  done: {
    fontSize: 17,
    fontWeight: '700',
    color: '#3E6AE1',
  },
});
