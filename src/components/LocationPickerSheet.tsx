import { Modal, Pressable, StyleSheet, Text, View } from 'react-native';
import { SymbolView } from 'expo-symbols';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

export interface LocationOption {
  key: string;
  label: string;
  // Shown greyed-out and non-selectable (e.g. Home/Work the car hasn't set).
  disabled?: boolean;
}

// Dropdown under the header (tapping "at <location> ⌄"): pick which location the
// schedules are for. Rows are DATA-DRIVEN (bugs 7 & 8): "Current Location" (the
// live car position) plus one row per OTHER place that has schedules.
//
// The header (title + "at <location>") stays VISIBLE on top of the sheet, with the
// chevron flipped to ▲ — tapping it closes the sheet again, exactly as the Tesla
// app does. Because this is a Modal (its own layer over the screen's real header),
// the header is re-rendered here at the top of the card rather than left behind
// the backdrop where it would be dimmed and untappable.
export function LocationPickerSheet({
  visible,
  options,
  selectedKey,
  headerLabel,
  onSelect,
  onClose,
}: {
  visible: boolean;
  options: LocationOption[];
  selectedKey: string;
  // What the header line shows ("at <headerLabel>"): the resolved place name.
  headerLabel: string;
  onSelect: (key: string) => void;
  onClose: () => void;
}) {
  const insets = useSafeAreaInsets();

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
            <Text style={styles.label} numberOfLines={1}>
              {o.label}
            </Text>
            <View style={[styles.radio, selectedKey === o.key && styles.radioOn]}>
              {selectedKey === o.key ? <View style={styles.radioDot} /> : null}
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
    flexShrink: 1,
    marginRight: 12,
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
