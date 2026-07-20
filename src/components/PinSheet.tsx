import { useEffect, useRef, useState } from 'react';
import { Animated, Pressable, StyleSheet, Text, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { SymbolView } from 'expo-symbols';
import * as Haptics from 'expo-haptics';

import { appendPinDigit, deletePinDigit, maskPin, PIN_LENGTH } from '@/state/pinMask';
import { SlideUpSheet } from './SlideUpSheet';

// Layout below is the Tesla app's own PinInput StyleSheet resolved at Gutter = 10 (v4.58.0 bundle):
//   container { paddingHorizontal: 3*G }  pinSection { alignItems:'center' }
//   placeholderText { height: 2*G, marginTop: 4*G, marginBottom: 1*G }
//   pad { flexDirection:'row', flexWrap:'wrap', width:'70%' }  button { width:'33%', height: 8*G }
//   submitButton { width:'100%', height: 50, paddingHorizontal: 2*G }
// Type ramp: the entered PIN is TextCategory.H3 (20/24, letterSpacing 0.5, Medium) and the placeholder is
// TextCategory.BodyLabel (14/20, letterSpacing 0.1) in the Light appearance.
const GUTTER = 10;
// The keypad's own order, verbatim: '' is the empty bottom-left cell.
const KEYS = ['1', '2', '3', '4', '5', '6', '7', '8', '9', '', '0', 'del'] as const;

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
  const [pin, setPin] = useState('');
  // Mirrors the app's second piece of state: false right after a digit (that digit shows), true after a
  // delete or a submit (everything masked).
  const [maskAll, setMaskAll] = useState(false);
  const shake = useRef(new Animated.Value(0)).current;

  useEffect(() => {
    if (visible) {
      setPin('');
      setMaskAll(false);
    }
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
    if (k === 'del') {
      if (!pin.length) return;
      Haptics.selectionAsync().catch(() => {});
      setPin(deletePinDigit(pin));
      setMaskAll(true);
      return;
    }
    if (pin.length >= PIN_LENGTH) return;
    Haptics.selectionAsync().catch(() => {});
    setPin(appendPinDigit(pin, k));
    setMaskAll(false);
  };

  const submit = () => {
    if (pin.length !== PIN_LENGTH) return;
    setMaskAll(true);
    if (onSubmit(pin)) {
      Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Medium).catch(() => {});
      return;
    }
    Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Heavy).catch(() => {});
    runShake();
    setPin('');
  };

  const canSubmit = pin.length === PIN_LENGTH;
  const translateX = shake.interpolate({ inputRange: [-1, 1], outputRange: [-12, 12] });

  return (
    <SlideUpSheet visible={visible} onDismiss={onCancel}>
      <View style={[styles.container, { paddingBottom: insets.bottom + 16 }]}>
        <Text style={styles.title}>{title}</Text>
        <View style={styles.divider} />

        <View style={styles.pinSection}>
          <Animated.View style={{ transform: [{ translateX }] }}>
            {pin.length === 0 ? (
              <Text style={styles.placeholder}>
                {mode === 'set' ? 'Set your 4-digit PIN' : 'Enter your 4-digit PIN'}
              </Text>
            ) : (
              <Text style={styles.entered}>{maskPin(pin, maskAll)}</Text>
            )}
          </Animated.View>

          <View style={styles.pad}>
            {KEYS.map((k, i) =>
              k === '' ? (
                <View key={i} style={styles.key} />
              ) : (
                <Pressable key={i} style={styles.key} onPress={() => tapKey(k)}>
                  {k === 'del' ? (
                    <SymbolView name="delete.left" tintColor="white" size={26} weight="regular" />
                  ) : (
                    <Text style={styles.keyText}>{k}</Text>
                  )}
                </Pressable>
              ),
            )}
          </View>
        </View>

        <Pressable
          style={[styles.submit, !canSubmit && styles.submitDisabled]}
          disabled={!canSubmit}
          onPress={submit}
        >
          <Text style={[styles.submitText, !canSubmit && styles.submitTextDisabled]}>Submit</Text>
        </Pressable>
      </View>
    </SlideUpSheet>
  );
}

const styles = StyleSheet.create({
  container: {
    width: '100%',
    paddingHorizontal: 3 * GUTTER,
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
    marginHorizontal: -3 * GUTTER,
  },
  pinSection: {
    alignItems: 'center',
  },
  // BodyLabel / Light.
  placeholder: {
    height: 2 * GUTTER,
    marginTop: 4 * GUTTER,
    marginBottom: GUTTER,
    fontSize: 14,
    lineHeight: 20,
    letterSpacing: 0.1,
    fontWeight: '500',
    color: 'rgba(255,255,255,0.5)',
  },
  // H3 / Default — same box as the placeholder so the keypad never shifts.
  entered: {
    height: 2 * GUTTER,
    marginTop: 4 * GUTTER,
    marginBottom: GUTTER,
    fontSize: 20,
    lineHeight: 24,
    letterSpacing: 0.5,
    fontWeight: '500',
    color: 'white',
    textAlign: 'center',
  },
  pad: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    width: '70%',
  },
  key: {
    width: '33.333%',
    height: 8 * GUTTER,
    alignItems: 'center',
    justifyContent: 'center',
  },
  keyText: {
    fontSize: 20,
    lineHeight: 24,
    letterSpacing: 0.5,
    fontWeight: '500',
    color: 'white',
  },
  submit: {
    width: '100%',
    height: 50,
    borderRadius: 14,
    backgroundColor: '#3E6AE1',
    alignItems: 'center',
    justifyContent: 'center',
    marginTop: 8,
  },
  submitDisabled: {
    backgroundColor: '#1E2A4A',
  },
  submitText: {
    fontSize: 18,
    fontWeight: '700',
    color: 'white',
  },
  submitTextDisabled: {
    color: 'rgba(255,255,255,0.4)',
  },
});
