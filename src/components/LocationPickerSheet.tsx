import { Modal, Pressable, StyleSheet, Text, View } from 'react-native';
import { SymbolView } from 'expo-symbols';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

export type ScheduleLocationKey = 'current' | 'home' | 'work';

// Dropdown under the header (tapping "at <location> ⌄"): pick which location the schedules are for.
// Current Location = the live car position; Home = a preset; Work is a disabled placeholder for now.
//
// The header (title + "at <location>") stays VISIBLE on top of the sheet, with the
// chevron flipped to ▲ — tapping it closes the sheet again, exactly as the Tesla
// app does. Because this is a Modal (its own layer over the screen's real header),
// the header is re-rendered here at the top of the card rather than left behind
// the backdrop where it would be dimmed and untappable.
export function LocationPickerSheet({
  visible,
  selected,
  headerLabel,
  onSelect,
  onClose,
}: {
  visible: boolean;
  selected: ScheduleLocationKey;
  // What the header line shows ("at <headerLabel>"): the resolved address, "Home" or "Work".
  headerLabel: string;
  onSelect: (key: ScheduleLocationKey) => void;
  onClose: () => void;
}) {
  const insets = useSafeAreaInsets();
  // Tesla labels the live option literally "Current Location" — the resolved
  // address only appears in the header line, not as the option label.
  const options: { key: ScheduleLocationKey; label: string; disabled?: boolean }[] = [
    { key: 'current', label: 'Current Location' },
    { key: 'home', label: 'Home' },
    { key: 'work', label: 'Work', disabled: true },
  ];

  return (
    <Modal visible={visible} transparent animationType="fade" onRequestClose={onClose}>
      <Pressable style={styles.backdrop} onPress={onClose} />
      <View style={[styles.card, { paddingTop: insets.top + 8 }]}>
        {/* The header, kept on the sheet — tap the ▲ (or anywhere on it) to close. */}
        <View style={styles.headerBlock}>
          <Text style={styles.headerTitle}>Set Schedules</Text>
          <Pressable style={styles.headerLoc} hitSlop={8} onPress={onClose}>
            <Text style={styles.headerSub}>at {headerLabel} </Text>
            <SymbolView name="chevron.up" tintColor="rgba(255,255,255,0.5)" size={12} weight="semibold" />
          </Pressable>
        </View>

        {options.map((o) => (
          <Pressable
            key={o.key}
            disabled={o.disabled}
            onPress={() => {
              onSelect(o.key);
              onClose();
            }}
            style={[styles.row, styles.rowBorder, o.disabled && styles.rowDisabled]}
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
  // Mirrors the screen header (title H3 20/24, subtitle BodyLabel 14/20), centred.
  headerBlock: {
    alignItems: 'center',
    gap: 2,
    paddingTop: 8,
    paddingBottom: 20,
  },
  headerTitle: {
    fontSize: 20,
    lineHeight: 24,
    fontWeight: '700',
    color: 'white',
  },
  headerLoc: {
    flexDirection: 'row',
    alignItems: 'center',
  },
  headerSub: {
    fontSize: 14,
    lineHeight: 20,
    letterSpacing: 0.1,
    color: 'rgba(255,255,255,0.55)',
  },
  row: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingVertical: 22,
  },
  rowBorder: {
    borderTopWidth: StyleSheet.hairlineWidth,
    borderTopColor: '#2D2E2F',
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
