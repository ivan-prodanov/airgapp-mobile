// Hermes polyfills — MUST be the very first imports so they load before any
// BLE code (crypto.getRandomValues for @noble/*, WHATWG URL for
// teslaHostGuard's `new URL`) is ever touched. See docs/superpowers/plans/
// 2026-07-12-ble-backend-integration.md.
import 'react-native-get-random-values';
import 'react-native-url-polyfill/auto';

import { DarkTheme, DefaultTheme, Stack, ThemeProvider } from 'expo-router';
import { useColorScheme } from 'react-native';
import { useFonts } from 'expo-font';
import { GestureHandlerRootView } from 'react-native-gesture-handler';

import { AnimatedSplashOverlay } from '@/components/animated-icon';
import { ToastProvider } from '@/components/ToastHost';
import { TESLA_FONT_MAP } from '@/constants/fonts';
import { useSharedLocationIntake } from '@/hooks/useSharedLocationIntake';
import { VehicleProvider } from '@/state/VehicleProvider';

// Home is the root screen; Explore is pushed on top (reached from the Home header, dismissed with its
// own back button). The native tab bar was removed — see the messages-icon → Explore wiring in
// HomeScreen and the back button in explore.tsx. All panels (Home swipe, Climate & Location sheets) use
// the core PanResponder system, so no GestureHandlerRootView is needed.
export default function RootLayout() {
  const colorScheme = useColorScheme();
  // Tesla's real typeface (see constants/fonts.ts).
  //
  // ⚠️ MUST be gated. This used to render regardless, on my assumption that "the
  // header restyles when the faces land". It does NOT: expo-font loads
  // asynchronously, and a <Text> that has already mounted keeps whatever font it
  // resolved at mount. React re-rendering it changes nothing either — with
  // identical props RN sends no update to the native view, so the fallback (SF)
  // sticks until the text's CONTENT actually changes.
  //
  // The symptom that exposed it: the battery % only turned bold when the user
  // TAPPED it — the tap swaps "48%" -> "312 km", which re-creates the native
  // text node and finally resolves the real face. The status line looked correct
  // only by luck: it re-renders every 5s on the age ticker.
  //
  // So every Text must mount AFTER the faces are registered. The cost is a frame
  // or two on a cold start — the files are local to the bundle.
  const [fontsLoaded] = useFonts(TESLA_FONT_MAP);
  useSharedLocationIntake();
  if (!fontsLoaded) return null;
  return (
    <GestureHandlerRootView style={{ flex: 1 }}>
      <ThemeProvider value={colorScheme === 'dark' ? DarkTheme : DefaultTheme}>
        <ToastProvider>
        <VehicleProvider>
          <AnimatedSplashOverlay />
          <Stack screenOptions={{ headerShown: false }}>
            <Stack.Screen name="index" />
            <Stack.Screen name="explore" options={{ animation: 'slide_from_right' }} />
            {/* gestureEnabled:false disables the iOS-26 native full-screen swipe-back (it responds to the whole
                screen, colliding with the Charging slider); each screen renders an EdgeSwipeBack strip for the
                standard edge-only gesture instead. */}
            <Stack.Screen
              name="location"
              options={{ animation: 'slide_from_right', gestureEnabled: false }}
            />
            <Stack.Screen
              name="charging"
              options={{ animation: 'slide_from_right', gestureEnabled: false }}
            />
            <Stack.Screen
              name="security"
              options={{ animation: 'slide_from_right', gestureEnabled: false }}
            />
            <Stack.Screen
              name="schedules"
              options={{ animation: 'slide_from_right', gestureEnabled: false }}
            />
            <Stack.Screen
              name="carlink"
              options={{ animation: 'slide_from_right', gestureEnabled: false }}
            />
          </Stack>
        </VehicleProvider>
        </ToastProvider>
      </ThemeProvider>
    </GestureHandlerRootView>
  );
}
