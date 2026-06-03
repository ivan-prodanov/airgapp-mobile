import type { ReactNode } from 'react';
import { Pressable, StyleSheet, Text } from 'react-native';

interface ShellButtonProps {
  active?: boolean;
  disabled?: boolean;
  onPress?: () => void;
  children: ReactNode;
}

// RN port of web-shell ShellButton (button + onClick → Pressable + onPress).
export function ShellButton({ active = false, disabled = false, onPress, children }: ShellButtonProps) {
  return (
    <Pressable
      onPress={onPress}
      disabled={disabled}
      style={({ pressed }) => [
        styles.button,
        active ? styles.active : styles.idle,
        pressed && styles.pressed,
        disabled && styles.disabled,
      ]}
    >
      <Text style={[styles.text, active && styles.textActive]}>{children}</Text>
    </Pressable>
  );
}

const styles = StyleSheet.create({
  button: {
    borderRadius: 14,
    borderWidth: 1,
    paddingHorizontal: 12,
    paddingVertical: 10,
    alignItems: 'center',
    justifyContent: 'center',
  },
  active: {
    borderColor: 'white',
    backgroundColor: 'white',
  },
  idle: {
    borderColor: 'rgba(255,255,255,0.10)',
    backgroundColor: 'rgba(255,255,255,0.06)',
  },
  pressed: {
    opacity: 0.7,
  },
  disabled: {
    opacity: 0.4,
  },
  text: {
    fontSize: 13,
    fontWeight: '500',
    color: 'white',
  },
  textActive: {
    color: '#0b0b0c',
  },
});
