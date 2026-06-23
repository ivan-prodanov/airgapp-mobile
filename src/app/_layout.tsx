import { DarkTheme, DefaultTheme, ThemeProvider } from 'expo-router';
import { useColorScheme } from 'react-native';

import { AnimatedSplashOverlay } from '@/components/animated-icon';
import AppTabs from '@/components/app-tabs';
import { VehicleProvider } from '@/state/VehicleProvider';

export default function TabLayout() {
  const colorScheme = useColorScheme();
  return (
    <ThemeProvider value={colorScheme === 'dark' ? DarkTheme : DefaultTheme}>
      <VehicleProvider>
        <AnimatedSplashOverlay />
        <AppTabs />
      </VehicleProvider>
    </ThemeProvider>
  );
}
