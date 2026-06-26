import { DarkTheme, DefaultTheme, Stack, ThemeProvider } from 'expo-router';
import { useColorScheme } from 'react-native';

import { AnimatedSplashOverlay } from '@/components/animated-icon';
import { VehicleProvider } from '@/state/VehicleProvider';

// Home is the root screen; Explore is pushed on top (reached from the Home header, dismissed with its
// own back button). The native tab bar was removed — see the messages-icon → Explore wiring in
// HomeScreen and the back button in explore.tsx.
export default function RootLayout() {
  const colorScheme = useColorScheme();
  return (
    <ThemeProvider value={colorScheme === 'dark' ? DarkTheme : DefaultTheme}>
      <VehicleProvider>
        <AnimatedSplashOverlay />
        <Stack screenOptions={{ headerShown: false }}>
          <Stack.Screen name="index" />
          <Stack.Screen name="explore" options={{ animation: 'slide_from_right' }} />
        </Stack>
      </VehicleProvider>
    </ThemeProvider>
  );
}
