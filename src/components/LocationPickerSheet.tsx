import { Modal, Pressable, StyleSheet, Text, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

export type ScheduleLocationKey = 'current' | 'home' | 'work';

// Dropdown under the header (tapping "at <location> ⌄"): pick which location the schedules are for.
// Current Location = the live car position; Home = a preset; Work is a disabled placeholder for now.
export function LocationPickerSheet({
  visible,
  selected,
  currentLabel,
  onSelect,
  onClose,
}: {
  visible: boolean;
  selected: ScheduleLocationKey;
  currentLabel: string;
  onSelect: (key: ScheduleLocationKey) => void;
  onClose: () => void;
}) {
  const insets = useSafeAreaInsets();
  const options: { key: ScheduleLocationKey; label: string; disabled?: boolean }[] = [
    { key: 'current', label: currentLabel },
    { key: 'home', label: 'Home' },
    { key: 'work', label: 'Work', disabled: true },
  ];

  return (
    <Modal visible={visible} transparent animationType="fade" onRequestClose={onClose}>
      <Pressable style={styles.backdrop} onPress={onClose} />
      <View style={[styles.card, { paddingTop: insets.top + 88 }]}>
        {options.map((o, i) => (
          <Pressable
            key={o.key}
            disabled={o.disabled}
            onPress={() => {
              onSelect(o.key);
              onClose();
            }}
            style={[styles.row, i > 0 && styles.rowBorder, o.disabled && styles.rowDisabled]}
          >
            <Text style={styles.label}>{o.label}</Text>
            <View style={[styles.radio, selected === o.key && styles.radioOn]}>
              {selected === o.key ? <View style={styles.radioDot} /> : null}
            </View>
          </Pressable>
        ))}
        <View style={styles.handle} />
      </View>
    </Modal>
  );
}

const styles = StyleSheet.create({
  backdrop: {
    flex: 1,
    backgroundColor: 'rgba(0,0,0,0.5)',
  },
  card: {
    position: 'absolute',
    top: 0,
    left: 0,
    right: 0,
    backgroundColor: '#121212',
    borderBottomLeftRadius: 16,
    borderBottomRightRadius: 16,
    paddingHorizontal: 24,
    paddingBottom: 14,
  },
  row: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingVertical: 22,
  },
  rowBorder: {
    borderTopWidth: StyleSheet.hairlineWidth,
    borderTopColor: 'rgba(255,255,255,0.12)',
  },
  rowDisabled: {
    opacity: 0.4,
  },
  label: {
    fontSize: 20,
    fontWeight: '600',
    color: 'white',
  },
  radio: {
    width: 24,
    height: 24,
    borderRadius: 12,
    borderWidth: 2,
    borderColor: 'rgba(255,255,255,0.3)',
    alignItems: 'center',
    justifyContent: 'center',
  },
  radioOn: {
    borderColor: '#3E6AE1',
  },
  radioDot: {
    width: 14,
    height: 14,
    borderRadius: 7,
    backgroundColor: '#3E6AE1',
  },
  handle: {
    alignSelf: 'center',
    width: 68,
    height: 5,
    borderRadius: 2.5,
    backgroundColor: 'rgba(255,255,255,0.25)',
    marginTop: 6,
  },
});
