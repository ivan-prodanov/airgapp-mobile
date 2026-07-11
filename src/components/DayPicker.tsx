import { Pressable, StyleSheet, Text, View } from 'react-native';

import { DAY_CHIP_LABELS } from '@/state/schedules';

// The "M T W T F S S" day-of-week selector (Monday-first). Selected days fill with a dark rounded square,
// like the Tesla schedule popups.
export function DayPicker({ days, onToggle }: { days: number[]; onToggle: (day: number) => void }) {
  return (
    <View style={styles.row}>
      {DAY_CHIP_LABELS.map((label, i) => {
        const on = days.includes(i);
        return (
          <Pressable
            key={i}
            hitSlop={4}
            onPress={() => onToggle(i)}
            style={[styles.chip, on && styles.chipOn]}
          >
            <Text style={styles.label}>{label}</Text>
          </Pressable>
        );
      })}
    </View>
  );
}

const styles = StyleSheet.create({
  row: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
  },
  chip: {
    width: 44,
    height: 44,
    borderRadius: 12,
    alignItems: 'center',
    justifyContent: 'center',
  },
  chipOn: {
    backgroundColor: '#3A3A3C',
  },
  label: {
    fontSize: 18,
    fontWeight: '600',
    color: 'white',
  },
});
