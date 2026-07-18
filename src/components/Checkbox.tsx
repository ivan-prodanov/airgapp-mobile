import { Pressable, StyleSheet } from 'react-native';
import { SymbolView } from 'expo-symbols';

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
      {value ? <SymbolView name="checkmark" tintColor="white" size={16} weight="bold" /> : null}
    </Pressable>
  );
}

const styles = StyleSheet.create({
  box: {
    width: 26,
    height: 26,
    borderRadius: 6,
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
