import { Pressable, StyleSheet } from 'react-native';
import { AppIcon } from '../icons/AppIcon';

// Rounded-square checkbox used by the Customize Parental Controls panel: Tesla-blue fill + white check
// when on, hollow outline when off.
export function Checkbox({
  value,
  onToggle,
  disabled,
}: {
  value: boolean;
  onToggle: () => void;
  disabled?: boolean;
}) {
  return (
    <Pressable
      hitSlop={8}
      disabled={disabled}
      onPress={onToggle}
      style={[styles.box, value ? styles.on : styles.off, disabled && styles.disabled]}
    >
      {value ? <AppIcon icon="check" color="white" size={13} /> : null}
    </Pressable>
  );
}

const styles = StyleSheet.create({
  box: {
    // Tesla's is smaller and barely rounded (ours was 26 / r6).
    width: 20,
    height: 20,
    borderRadius: 4,
    alignItems: 'center',
    justifyContent: 'center',
  },
  on: {
    backgroundColor: '#3E6AE1',
  },
  off: {
    borderWidth: 2,
    borderColor: 'rgba(255,255,255,0.3)',
  },
  disabled: {
    opacity: 0.4,
  },
});
