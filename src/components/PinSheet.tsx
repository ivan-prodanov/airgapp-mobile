import { useEffect, useRef, useState } from 'react';
import { Animated, Modal, Pressable, StyleSheet, Text, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { SymbolView } from 'expo-symbols';
import * as Haptics from 'expo-haptics';

const PIN_LENGTH = 4;
// 3×4 keypad; '' is the empty bottom-left cell, 'back' is the backspace key (matches the Tesla layout).
const KEYS = ['1', '2', '3', '4', '5', '6', '7', '8', '9', '', '0', 'back'] as const;

// Bottom-sheet 4-digit PIN pad used by the Security & Drivers screen. Slides up over a dimmed screen;
// tapping above the panel cancels (operation aborted). `mode` picks the prompt copy: 'set' when the user
// is choosing a new PIN, 'enter' when they must re-enter the one saved earlier. `onSubmit` returns whether
// the PIN was accepted — a rejected PIN shakes + clears so the user can retry without the sheet closing.
export function PinSheet({
  visible,
  title,
  mode,
  onSubmit,
  onCancel,
}: {
  visible: boolean;
  title: string;
  mode: 'set' | 'enter';
  onSubmit: (pin: string) => boolean;
  onCancel: () => void;
}) {
  const insets = useSafeAreaInsets();
  const [digits, setDigits] = useState('');
  const shake = useRef(new Animated.Value(0)).current;

  // Fresh entry every time the sheet opens.
  useEffect(() => {
    if (visible) setDigits('');
  }, [visible]);

  const runShake = () => {
    shake.setValue(0);
    Animated.sequence([
      Animated.timing(shake, { toValue: 1, duration: 60, useNativeDriver: true }),
      Animated.timing(shake, { toValue: -1, duration: 60, useNativeDriver: true }),
      Animated.timing(shake, { toValue: 0.6, duration: 60, useNativeDriver: true }),
      Animated.timing(shake, { toValue: 0, duration: 60, useNativeDriver: true }),
    ]).start();
  };

  const tapKey = (k: string) => {
    if (k === 'back') {
      if (!digits.length) return;
      Haptics.selectionAsync().catch(() => {});
      setDigits((d) => d.slice(0, -1));
      return;
    }
    if (digits.length >= PIN_LENGTH) return; // can't tap more than 4 digits
    Haptics.selectionAsync().catch(() => {});
    setDigits((d) => d + k);
  };

  const submit = () => {
    if (digits.length !== PIN_LENGTH) return;
    const ok = onSubmit(digits);
    if (ok) {
      Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Medium).catch(() => {});
    } else {
      Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Heavy).catch(() => {});
      runShake();
      setDigits('');
    }
  };

  const canSubmit = digits.length === PIN_LENGTH;
  const translateX = shake.interpolate({ inputRange: [-1, 1], outputRange: [-12, 12] });
  // Right-aligned reveal: leading dots for the empty slots, then the digits typed so far ("•••1").
  const filled = '•'.repeat(PIN_LENGTH - digits.length) + digits;

  return (
    <Modal visible={visible} transparent animationType="slide" onRequestClose={onCancel}>
      <Pressable style={styles.backdrop} onPress={onCancel} />
      <View style={[styles.sheet, { paddingBottom: insets.bottom + 16 }]}>
        <Text style={styles.title}>{title}</Text>
        <View style={styles.divider} />

        <Animated.View style={[styles.display, { transform: [{ translateX }] }]}>
          {digits.length === 0 ? (
            <Text style={styles.prompt}>
              {mode === 'set' ? 'Set your 4-digit PIN' : 'Enter your 4-digit PIN'}
            </Text>
          ) : (
            <Text style={styles.dots}>{filled}</Text>
          )}
        </Animated.View>

        <View style={styles.pad}>
          {KEYS.map((k, i) =>
            k === '' ? (
              <View key={i} style={styles.key} />
            ) : (
              <Pressable key={i} style={styles.key} hitSlop={4} onPress={() => tapKey(k)}>
                {k === 'back' ? (
                  <SymbolView name="delete.left" tintColor="white" size={28} weight="regular" />
                ) : (
                  <Text style={styles.keyText}>{k}</Text>
                )}
              </Pressable>
            ),
          )}
        </View>

        <Pressable
          style={[styles.submit, !canSubmit && styles.submitDisabled]}
          disabled={!canSubmit}
          onPress={submit}
        >
          <Text style={[styles.submitText, !canSubmit && styles.submitTextDisabled]}>Submit</Text>
        </Pressable>
      </View>
    </Modal>
  );
}

const styles = StyleSheet.create({
  backdrop: {
    flex: 1,
    backgroundColor: 'rgba(0,0,0,0.55)',
  },
  sheet: {
    backgroundColor: '#141414',
    borderTopLeftRadius: 20,
    borderTopRightRadius: 20,
    paddingHorizontal: 24,
    paddingTop: 20,
  },
  title: {
    fontSize: 20,
    fontWeight: '700',
    color: 'white',
    textAlign: 'center',
    marginBottom: 18,
  },
  divider: {
    height: StyleSheet.hairlineWidth,
    backgroundColor: 'rgba(255,255,255,0.12)',
    marginHorizontal: -24,
  },
  display: {
    height: 64,
    alignItems: 'center',
    justifyContent: 'center',
  },
  prompt: {
    fontSize: 17,
    fontWeight: '500',
    color: 'rgba(255,255,255,0.5)',
  },
  dots: {
    fontSize: 34,
    fontWeight: '600',
    color: 'white',
    letterSpacing: 10,
    // letterSpacing pads the right edge too; nudge left so the group reads centered.
    marginLeft: 10,
  },
  pad: {
    flexDirection: 'row',
    flexWrap: 'wrap',
  },
  key: {
    width: '33.333%',
    height: 68,
    alignItems: 'center',
    justifyContent: 'center',
  },
  keyText: {
    fontSize: 30,
    fontWeight: '400',
    color: 'white',
  },
  submit: {
    height: 58,
    borderRadius: 14,
    backgroundColor: '#3E6AE1',
    alignItems: 'center',
    justifyContent: 'center',
    marginTop: 14,
  },
  submitDisabled: {
    backgroundColor: '#1E2A4A',
  },
  submitText: {
    fontSize: 19,
    fontWeight: '700',
    color: 'white',
  },
  submitTextDisabled: {
    color: 'rgba(255,255,255,0.4)',
  },
});
