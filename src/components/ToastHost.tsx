// ToastHost.tsx — the app-global bottom toast (Tesla-app "failed operation"
// style): a two-line card — BOLD title + muted body — on a surface slightly
// lighter than the background, full-width minus side margins, sitting at the
// very bottom above the home indicator. No accent bar, no icon (matches the
// official app, verified side-by-side). A single transient card, safe-area-
// aware, absolutely overlaid above all app content. `useToast().show(text)`
// replaces whatever is showing, re-animates it in, and auto-dismisses after
// AUTO_DISMISS_MS; tapping it dismisses early.
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

import { Spacing } from '@/constants/theme';
import { useTheme } from '@/hooks/use-theme';

// ToastText is the card's content: a bold title and an optional muted body.
// commandMessages.commandFailureText produces exactly this shape.
export interface ToastText {
  title: string;
  body?: string;
}

interface ToastApi {
  // Accepts a bare string (title-only card) or the two-line {title, body}.
  show: (text: ToastText | string) => void;
}

// A monotonic id lets a repeat message (same text) still re-trigger the
// animation + dismiss timer; null = nothing showing.
interface ToastState extends ToastText {
  id: number;
}

// The official app's failure card auto-dismisses after ERROR_CARD_TIMEOUT =
// 7000 ms (findings §3.4, hasm:1516214–1516228). Ours matches it.
const AUTO_DISMISS_MS = 7000;

// Gap between the card and the safe-area bottom edge — the official app sits
// the card at the VERY bottom, just clear of the home indicator.
const BOTTOM_GAP = Spacing.two;

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

  const show = useCallback((text: ToastText | string) => {
    idRef.current += 1;
    const next = typeof text === 'string' ? { title: text } : text;
    setToast({ id: idRef.current, ...next });
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

  return (
    <View style={[styles.host, { bottom: insets.bottom + BOTTOM_GAP }]} pointerEvents="box-none">
      <Animated.View style={{ opacity, transform: [{ translateY }], width: '100%' }}>
        <Pressable
          onPress={() => animateOut(onDismiss)}
          style={[styles.card, { backgroundColor: theme.backgroundElement }]}>
          <Text style={[styles.title, { color: theme.text }]} numberOfLines={2}>
            {toast.title}
          </Text>
          {toast.body ? (
            <Text style={[styles.body, { color: theme.textSecondary }]} numberOfLines={3}>
              {toast.body}
            </Text>
          ) : null}
        </Pressable>
      </Animated.View>
    </View>
  );
}

const styles = StyleSheet.create({
  host: {
    position: 'absolute',
    left: Spacing.three,
    right: Spacing.three,
    alignItems: 'center',
  },
  card: {
    width: '100%',
    borderRadius: 14,
    paddingVertical: Spacing.three,
    paddingHorizontal: Spacing.three,
    // Subtle elevation, matching the app's sheets/cards.
    shadowColor: '#000',
    shadowOpacity: 0.3,
    shadowRadius: 12,
    shadowOffset: { width: 0, height: 6 },
    elevation: 8,
  },
  title: {
    fontSize: 17,
    fontWeight: '600',
    lineHeight: 22,
  },
  body: {
    fontSize: 15,
    fontWeight: '400',
    lineHeight: 20,
    marginTop: Spacing.half,
  },
});
