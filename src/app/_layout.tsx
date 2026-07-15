// Hermes polyfills — MUST be the very first imports so they load before any
// BLE code (crypto.getRandomValues for @noble/*, WHATWG URL for
// teslaHostGuard's `new URL`) is ever touched. See docs/superpowers/plans/
// 2026-07-12-ble-backend-integration.md.
import 'react-native-get-random-values';
import 'react-native-url-polyfill/auto';

import { DarkTheme, DefaultTheme, Stack, ThemeProvider } from 'expo-router';
import { useColorScheme } from 'react-native';
import { GestureHandlerRootView } from 'react-native-gesture-handler';

import { AnimatedSplashOverlay } from '@/components/animated-icon';
import { useSharedLocationIntake } from '@/hooks/useSharedLocationIntake';
import { VehicleProvider } from '@/state/VehicleProvider';

// Home is the root screen; Explore is pushed on top (reached from the Home header, dismissed with its
// own back button). The native tab bar was removed — see the messages-icon → Explore wiring in
// HomeScreen and the back button in explore.tsx. All panels (Home swipe, Climate & Location sheets) use
// the core PanResponder system, so no GestureHandlerRootView is needed.
export default function RootLayout() {
  const colorScheme = useColorScheme();
  useSharedLocationIntake();
  return (
    <GestureHandlerRootView style={{ flex: 1 }}>
      <ThemeProvider value={colorScheme === 'dark' ? DarkTheme : DefaultTheme}>
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
      </ThemeProvider>
    </GestureHandlerRootView>
  );
}
