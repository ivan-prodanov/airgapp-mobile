import { Pressable, ScrollView, StyleSheet, Text, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { SymbolView, type SFSymbol } from 'expo-symbols';

import { ThemedText } from '@/components/themed-text';
import { BottomTabInset, Spacing } from '@/constants/theme';
import { useTheme } from '@/hooks/use-theme';
import { useVehicle } from '@/state/VehicleProvider';
import type { VehicleStateKey } from '@/types/vehicleTypes';

const ACCENT = '#3E6AE1'; // Tesla blue for the active state

type Theme = ReturnType<typeof useTheme>;

// Explore tab = demo control panel. The car is a stub (no BLE yet), so this drives its state by hand
// so every mode can be showcased. Everything here mutates the shared vehicle state, so changes show
// up live on the Home tab.
export default function ExploreScreen() {
  const insets = useSafeAreaInsets();
  const theme = useTheme();
  const [state, actions] = useVehicle();

  return (
    <ScrollView
      style={[styles.scroll, { backgroundColor: theme.background }]}
      contentContainerStyle={{
        paddingTop: insets.top + Spacing.four,
        paddingBottom: insets.bottom + BottomTabInset + Spacing.four,
        paddingHorizontal: Spacing.four,
        gap: Spacing.five,
      }}>
      <View style={styles.header}>
        <ThemedText type="title">Demo Controls</ThemedText>
        <ThemedText type="small" themeColor="textSecondary">
          The car is a stub until BLE lands — drive its state here. Changes apply live on the Home
          screen.
        </ThemedText>
      </View>

      <View style={styles.section}>
        <ThemedText type="subtitle">Vehicle state</ThemedText>
        <View style={styles.segment}>
          <SegButton
            label="Awake"
            sublabel="Parked · online"
            icon="sun.max.fill"
            active={state.awake}
            onPress={() => actions.patch({ awake: true })}
            theme={theme}
          />
          <SegButton
            label="Asleep"
            sublabel="Last seen · dimmed"
            icon="moon.zzz.fill"
            active={!state.awake}
            onPress={() => actions.patch({ awake: false })}
            theme={theme}
          />
        </View>
      </View>

      <View style={styles.section}>
        <ThemedText type="subtitle">Quick toggles</ThemedText>
        <ToggleRow
          icon={state.locked ? 'lock.fill' : 'lock.open.fill'}
          label="Locked"
          stateKey="locked"
          value={state.locked}
          onToggle={actions.toggle}
          theme={theme}
        />
        <ToggleRow
          icon="bolt.fill"
          label="Charging"
          stateKey="charging"
          value={state.charging}
          onToggle={actions.toggle}
          theme={theme}
        />
        <ToggleRow
          icon="fanblades.fill"
          label="Climate on"
          stateKey="climateOn"
          value={state.climateOn}
          onToggle={actions.toggle}
          theme={theme}
        />
        <ToggleRow
          icon="play.fill"
          label="Media playing"
          stateKey="mediaPlaying"
          value={state.mediaPlaying}
          onToggle={actions.toggle}
          theme={theme}
        />
        <ToggleRow
          icon="car.side.front.open.fill"
          label="Frunk open"
          stateKey="frunkOpen"
          value={state.frunkOpen}
          onToggle={actions.toggle}
          theme={theme}
        />
      </View>
    </ScrollView>
  );
}

function SegButton({
  label,
  sublabel,
  icon,
  active,
  onPress,
  theme,
}: {
  label: string;
  sublabel: string;
  icon: SFSymbol;
  active: boolean;
  onPress: () => void;
  theme: Theme;
}) {
  return (
    <Pressable
      onPress={onPress}
      style={({ pressed }) => [
        styles.seg,
        { backgroundColor: active ? ACCENT : theme.backgroundElement, opacity: pressed ? 0.85 : 1 },
      ]}>
      <SymbolView name={icon} tintColor={active ? 'white' : theme.textSecondary} size={28} />
      <Text style={[styles.segLabel, { color: active ? 'white' : theme.text }]}>{label}</Text>
      <Text style={[styles.segSub, { color: active ? 'rgba(255,255,255,0.8)' : theme.textSecondary }]}>
        {sublabel}
      </Text>
    </Pressable>
  );
}

function ToggleRow({
  icon,
  label,
  stateKey,
  value,
  onToggle,
  theme,
}: {
  icon: SFSymbol;
  label: string;
  stateKey: VehicleStateKey;
  value: boolean;
  onToggle: (key: VehicleStateKey) => void;
  theme: Theme;
}) {
  return (
    <Pressable
      onPress={() => onToggle(stateKey)}
      style={({ pressed }) => [
        styles.row,
        { backgroundColor: theme.backgroundElement, opacity: pressed ? 0.85 : 1 },
      ]}>
      <SymbolView name={icon} tintColor={value ? ACCENT : theme.textSecondary} size={22} />
      <Text style={[styles.rowLabel, { color: theme.text }]}>{label}</Text>
      <View style={[styles.pill, { backgroundColor: value ? ACCENT : theme.backgroundSelected }]}>
        <Text style={[styles.pillText, { color: value ? 'white' : theme.textSecondary }]}>
          {value ? 'ON' : 'OFF'}
        </Text>
      </View>
    </Pressable>
  );
}

const styles = StyleSheet.create({
  scroll: {
    flex: 1,
  },
  header: {
    gap: Spacing.two,
  },
  section: {
    gap: Spacing.three,
  },
  segment: {
    flexDirection: 'row',
    gap: Spacing.three,
  },
  seg: {
    flex: 1,
    borderRadius: 18,
    paddingVertical: Spacing.four,
    paddingHorizontal: Spacing.three,
    gap: Spacing.two,
    alignItems: 'flex-start',
  },
  segLabel: {
    fontSize: 20,
    fontWeight: '700',
  },
  segSub: {
    fontSize: 13,
  },
  row: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: Spacing.three,
    borderRadius: 14,
    paddingVertical: Spacing.three,
    paddingHorizontal: Spacing.three,
  },
  rowLabel: {
    flex: 1,
    fontSize: 17,
    fontWeight: '600',
  },
  pill: {
    minWidth: 48,
    borderRadius: 999,
    paddingVertical: 5,
    paddingHorizontal: 12,
    alignItems: 'center',
  },
  pillText: {
    fontSize: 13,
    fontWeight: '700',
  },
});
