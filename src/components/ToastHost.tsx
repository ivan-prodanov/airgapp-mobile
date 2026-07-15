// ToastHost.tsx — the app-global bottom toast (Tesla-app "failed operation"
// style). A single transient card, safe-area-aware, absolutely overlaid above
// all app content. `useToast().show(msg, tone)` replaces whatever is showing,
// re-animates it in, and auto-dismisses after AUTO_DISMISS_MS; tapping it
// dismisses early.
//
// RN-only (Animated + safe-area). Mounted in _layout.tsx INSIDE ThemeProvider
// and AROUND VehicleProvider so useCarLink (inside the fleet) can surface
// failures. useToast() is guarded to a no-op when no provider is mounted, so
// headless/tests never break.

import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useRef,
  useState,
  type ReactNode,
} from 'react';
import { Animated, Pressable, StyleSheet, Text, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { useTheme } from '@/hooks/use-theme';

export type ToastTone = 'error' | 'info';

interface ToastApi {
  show: (msg: string, tone?: ToastTone) => void;
}

// A monotonic id lets a repeat message (same text) still re-trigger the
// animation + dismiss timer; null message = nothing showing.
interface ToastState {
  id: number;
  msg: string;
  tone: ToastTone;
}

const AUTO_DISMISS_MS = 4000;

const noop: ToastApi = { show: () => {} };
const ToastContext = createContext<ToastApi>(noop);

// Resilient: returns a no-op when no provider is mounted (headless/tests),
// present in-app because ToastProvider wraps the whole tree.
export function useToast(): ToastApi {
  return useContext(ToastContext);
}

export function ToastProvider({ children }: { children: ReactNode }) {
  const [toast, setToast] = useState<ToastState | null>(null);
  const idRef = useRef(0);

  const show = useCallback((msg: string, tone: ToastTone = 'error') => {
    idRef.current += 1;
    setToast({ id: idRef.current, msg, tone });
  }, []);

  const dismiss = useCallback(() => setToast(null), []);

  return (
    <ToastContext.Provider value={{ show }}>
      {children}
      {toast ? <ToastCard toast={toast} onDismiss={dismiss} /> : null}
    </ToastContext.Provider>
  );
}

function ToastCard({ toast, onDismiss }: { toast: ToastState; onDismiss: () => void }) {
  const theme = useTheme();
  const insets = useSafeAreaInsets();
  const translateY = useRef(new Animated.Value(24)).current;
  const opacity = useRef(new Animated.Value(0)).current;

  const animateOut = useCallback(
    (done: () => void) => {
      Animated.parallel([
        Animated.timing(translateY, { toValue: 24, duration: 180, useNativeDriver: true }),
        Animated.timing(opacity, { toValue: 0, duration: 180, useNativeDriver: true }),
      ]).start(done);
    },
    [translateY, opacity],
  );

  // Re-animate in on every new toast (id change) and (re)arm the auto-dismiss.
  useEffect(() => {
    translateY.setValue(24);
    opacity.setValue(0);
    Animated.parallel([
      Animated.spring(translateY, { toValue: 0, useNativeDriver: true, bounciness: 4, speed: 16 }),
      Animated.timing(opacity, { toValue: 1, duration: 180, useNativeDriver: true }),
    ]).start();
    const timer = setTimeout(() => animateOut(onDismiss), AUTO_DISMISS_MS);
    return () => clearTimeout(timer);
  }, [toast.id, translateY, opacity, animateOut, onDismiss]);

  const accent = toast.tone === 'error' ? theme.error : theme.textSecondary;

  return (
    <View style={[styles.host, { bottom: insets.bottom + 16 }]} pointerEvents="box-none">
      <Animated.View style={{ opacity, transform: [{ translateY }], width: '100%' }}>
        <Pressable
          onPress={() => animateOut(onDismiss)}
          style={[styles.card, { backgroundColor: theme.backgroundElement }]}>
          <View style={[styles.accent, { backgroundColor: accent }]} />
          <Text style={[styles.text, { color: theme.text }]} numberOfLines={3}>
            {toast.msg}
          </Text>
        </Pressable>
      </Animated.View>
    </View>
  );
}

const styles = StyleSheet.create({
  host: {
    position: 'absolute',
    left: 16,
    right: 16,
    alignItems: 'center',
  },
  card: {
    flexDirection: 'row',
    alignItems: 'center',
    width: '100%',
    borderRadius: 14,
    paddingVertical: 14,
    paddingHorizontal: 16,
    gap: 12,
    // Subtle elevation, matching the app's sheets/cards.
    shadowColor: '#000',
    shadowOpacity: 0.3,
    shadowRadius: 12,
    shadowOffset: { width: 0, height: 6 },
    elevation: 8,
  },
  accent: {
    width: 3,
    alignSelf: 'stretch',
    borderRadius: 2,
  },
  text: {
    flex: 1,
    fontSize: 15,
    fontWeight: '500',
    lineHeight: 20,
  },
});
