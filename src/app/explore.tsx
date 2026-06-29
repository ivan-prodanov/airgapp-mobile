import type { ReactNode } from 'react';
import { Pressable, ScrollView, StyleSheet, Text, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { SymbolView, type SFSymbol } from 'expo-symbols';
import { useRouter } from 'expo-router';

import { ThemedText } from '@/components/themed-text';
import { Spacing } from '@/constants/theme';
import { useTheme } from '@/hooks/use-theme';
import { useFleet, useVehicle } from '@/state/VehicleProvider';
import type { CameraMode, CarModel, LightingMode, ThemeMode, VehicleStateKey } from '@/types/vehicleTypes';

const ACCENT = '#3E6AE1'; // Tesla blue for the active state

type Theme = ReturnType<typeof useTheme>;

// Camera presets the app drives (CLOSURE_OPEN is internal, not a demo option). Mirrors the Godot dev
// harness camera buttons (parked / plugged / climate / top_down).
const CAMERA_OPTIONS: { value: CameraMode; label: string }[] = [
  { value: 'PARKED', label: 'Parked' },
  { value: 'CHARGING', label: 'Charging' },
  { value: 'CLIMATE', label: 'Climate' },
  { value: 'TOP_DOWN', label: 'Top-down' },
];

const THEME_OPTIONS: { value: ThemeMode; label: string }[] = [
  { value: 'dark', label: 'Dark' },
  { value: 'light', label: 'Light' },
];

// Models you can add to the fleet. Adding appends a fresh car of that model and makes it active.
// Current line-up + their pre-facelift "(old)" trims — the older ones carry reduced climate options
// (no ventilation/auto, limited wheel heat), so adding both lets you verify every conditional control.
const ADD_MODEL_OPTIONS: { value: CarModel; label: string }[] = [
  { value: 'modelS', label: 'Add S' },
  { value: 'model3', label: 'Add 3' },
  { value: 'modelX', label: 'Add X' },
  { value: 'modelY', label: 'Add Y' },
  { value: 'modelSLegacy', label: 'Old S' },
  { value: 'model3Legacy', label: 'Old 3' },
  { value: 'modelXLegacy', label: 'Old X' },
  { value: 'modelYLegacy', label: 'Old Y' },
  { value: 'modelX6Seat', label: 'X 6-seat' },
  { value: 'modelX7Seat', label: 'X 7-seat' },
];

const LIGHTING_OPTIONS: { value: LightingMode; label: string }[] = [
  { value: 'mobile', label: 'Mobile' },
  { value: 'ambient_fill', label: 'Ambient fill' },
];

const WINDOW_KEYS: VehicleStateKey[] = [
  'leftFrontWindowOpen',
  'rightFrontWindowOpen',
  'leftRearWindowOpen',
  'rightRearWindowOpen',
];

// Explore tab = demo control panel mirroring the Godot dev harness. The car is a stub (no BLE yet),
// so this drives its state by hand so every mode can be showcased. Everything here mutates the
// shared vehicle state, so changes show up live on the Home tab.
export default function ExploreScreen() {
  const insets = useSafeAreaInsets();
  const theme = useTheme();
  const router = useRouter();
  const [state, actions] = useVehicle();
  const fleet = useFleet();
  const goBack = () => (router.canGoBack() ? router.back() : router.replace('/'));

  const anyWindowOpen = WINDOW_KEYS.some((key) => state[key] === true);
  const ventAll = () => {
    const open = !anyWindowOpen;
    actions.patch({
      leftFrontWindowOpen: open,
      rightFrontWindowOpen: open,
      leftRearWindowOpen: open,
      rightRearWindowOpen: open,
    });
  };

  return (
    <ScrollView
      style={[styles.scroll, { backgroundColor: theme.background }]}
      contentContainerStyle={{
        paddingTop: insets.top + Spacing.three,
        paddingBottom: insets.bottom + Spacing.four,
        paddingHorizontal: Spacing.four,
        gap: Spacing.five,
      }}>
      <Pressable
        onPress={goBack}
        hitSlop={8}
        style={({ pressed }) => [styles.backButton, { opacity: pressed ? 0.6 : 1 }]}>
        <SymbolView name="chevron.left" tintColor={ACCENT} size={20} weight="semibold" />
        <Text style={[styles.backLabel, { color: ACCENT }]}>Home</Text>
      </Pressable>

      <View style={styles.header}>
        <ThemedText type="title">Demo Controls</ThemedText>
        <ThemedText type="small" themeColor="textSecondary">
          The car is a stub until BLE lands — drive its state here. Changes apply live on the Home
          screen.
        </ThemedText>
      </View>

      <Section title="Your Vehicles">
        {fleet.vehicles.map((vehicle) => {
          const isActive = vehicle.id === fleet.activeId;
          return (
            <View
              key={vehicle.id}
              style={[styles.row, { backgroundColor: theme.backgroundElement }]}>
              <Pressable style={styles.vehicleSelect} onPress={() => fleet.setActiveVehicle(vehicle.id)}>
                <SymbolView
                  name={isActive ? 'largecircle.fill.circle' : 'circle'}
                  tintColor={isActive ? ACCENT : theme.textSecondary}
                  size={22}
                />
                <Text style={[styles.rowLabel, { color: theme.text }]}>{vehicle.name}</Text>
              </Pressable>
              <Pressable
                hitSlop={8}
                disabled={fleet.vehicles.length === 1}
                onPress={() => fleet.removeVehicle(vehicle.id)}>
                <SymbolView
                  name="trash"
                  tintColor={fleet.vehicles.length === 1 ? theme.backgroundSelected : '#E5484D'}
                  size={20}
                />
              </Pressable>
            </View>
          );
        })}
        <View style={styles.addRow}>
          {ADD_MODEL_OPTIONS.map((opt) => (
            <Pressable
              key={opt.value}
              onPress={() => fleet.addVehicle(opt.value)}
              style={({ pressed }) => [
                styles.addButton,
                { backgroundColor: theme.backgroundElement, opacity: pressed ? 0.85 : 1 },
              ]}>
              <SymbolView name="plus" tintColor={ACCENT} size={16} />
              <Text style={[styles.addButtonLabel, { color: theme.text }]}>{opt.label}</Text>
            </Pressable>
          ))}
        </View>
      </Section>

      <Section title="Vehicle state">
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
      </Section>

      <Section title="Camera view">
        <Segmented
          options={CAMERA_OPTIONS}
          value={state.cameraMode}
          onChange={actions.setScreenCameraMode}
          theme={theme}
        />
      </Section>

      <Section title="Closures">
        <ToggleRow icon="car.side.front.open.fill" label="Frunk" stateKey="frunkOpen" value={state.frunkOpen} onToggle={actions.toggle} theme={theme} />
        <ToggleRow icon="car.side.rear.open.fill" label="Trunk" stateKey="trunkOpen" value={state.trunkOpen} onToggle={actions.toggle} theme={theme} />
        <ToggleRow icon="car.top.door.front.left.open.fill" label="Driver door" stateKey="driverFrontDoorOpen" value={state.driverFrontDoorOpen} onToggle={actions.toggle} theme={theme} />
        <ToggleRow icon="car.top.door.front.right.open.fill" label="Passenger door" stateKey="passengerFrontDoorOpen" value={state.passengerFrontDoorOpen} onToggle={actions.toggle} theme={theme} />
        <ToggleRow icon="car.top.door.rear.left.open.fill" label="Rear left door" stateKey="driverRearDoorOpen" value={state.driverRearDoorOpen} onToggle={actions.toggle} theme={theme} />
        <ToggleRow icon="car.top.door.rear.right.open.fill" label="Rear right door" stateKey="passengerRearDoorOpen" value={state.passengerRearDoorOpen} onToggle={actions.toggle} theme={theme} />
      </Section>

      <Section
        title="Windows"
        action={<TextAction label={anyWindowOpen ? 'Close all' : 'Vent all'} onPress={ventAll} />}>
        <ToggleRow icon="car.window.left" label="Front left" stateKey="leftFrontWindowOpen" value={state.leftFrontWindowOpen} onToggle={actions.toggle} theme={theme} />
        <ToggleRow icon="car.window.right" label="Front right" stateKey="rightFrontWindowOpen" value={state.rightFrontWindowOpen} onToggle={actions.toggle} theme={theme} />
        <ToggleRow icon="car.window.left" label="Rear left" stateKey="leftRearWindowOpen" value={state.leftRearWindowOpen} onToggle={actions.toggle} theme={theme} />
        <ToggleRow icon="car.window.right" label="Rear right" stateKey="rightRearWindowOpen" value={state.rightRearWindowOpen} onToggle={actions.toggle} theme={theme} />
      </Section>

      <Section title="Climate">
        <ToggleRow icon="fanblades.fill" label="A/C" stateKey="climateOn" value={state.climateOn} onToggle={actions.toggle} theme={theme} />
        <ToggleRow icon="windshield.front.and.heat.waves" label="Front defrost" stateKey="frontDefrostOn" value={state.frontDefrostOn} onToggle={actions.toggle} theme={theme} />
        <ToggleRow icon="windshield.rear.and.heat.waves" label="Rear defrost" stateKey="rearDefrostOn" value={state.rearDefrostOn} onToggle={actions.toggle} theme={theme} />
      </Section>

      <Section title="Charging">
        <ToggleRow icon="ev.charger.fill" label="Charge port" stateKey="chargePortOpen" value={state.chargePortOpen} onToggle={actions.toggle} theme={theme} />
        <ToggleRow icon="powerplug.fill" label="Cable connected" stateKey="cableAttached" value={state.cableAttached} onToggle={actions.toggle} theme={theme} />
        <ToggleRow icon="bolt.fill" label="Charging" stateKey="charging" value={state.charging} onToggle={actions.toggle} theme={theme} />
      </Section>

      <Section title="Lights & drive">
        <ToggleRow icon="headlight.low.beam.fill" label="Headlights" stateKey="headlightsOn" value={state.headlightsOn} onToggle={actions.toggle} theme={theme} />
        <ToggleRow icon="light.beacon.max.fill" label="Brake lights" stateKey="brakeLightsOn" value={state.brakeLightsOn} onToggle={actions.toggle} theme={theme} />
        <ToggleRow icon="steeringwheel" label="Drive mode (wheel spin)" stateKey="driving" value={state.driving} onToggle={actions.toggle} theme={theme} />
      </Section>

      <Section title="App state">
        <ToggleRow icon={state.locked ? 'lock.fill' : 'lock.open.fill'} label="Locked" stateKey="locked" value={state.locked} onToggle={actions.toggle} theme={theme} />
        <ToggleRow icon="play.fill" label="Media playing" stateKey="mediaPlaying" value={state.mediaPlaying} onToggle={actions.toggle} theme={theme} />
      </Section>

      <Section title="Appearance">
        <Segmented
          options={THEME_OPTIONS}
          value={state.theme}
          onChange={(value) => actions.patch({ theme: value })}
          theme={theme}
        />
        <Segmented
          options={LIGHTING_OPTIONS}
          value={state.lightingMode}
          onChange={(value) => actions.patch({ lightingMode: value })}
          theme={theme}
        />
      </Section>
    </ScrollView>
  );
}

function Section({ title, action, children }: { title: string; action?: ReactNode; children: ReactNode }) {
  return (
    <View style={styles.section}>
      <View style={styles.sectionHeader}>
        <ThemedText type="subtitle">{title}</ThemedText>
        {action}
      </View>
      {children}
    </View>
  );
}

function TextAction({ label, onPress }: { label: string; onPress: () => void }) {
  return (
    <Pressable onPress={onPress} hitSlop={8} style={({ pressed }) => ({ opacity: pressed ? 0.6 : 1 })}>
      <Text style={[styles.textAction, { color: ACCENT }]}>{label}</Text>
    </Pressable>
  );
}

function Segmented<T extends string>({
  options,
  value,
  onChange,
  theme,
}: {
  options: { value: T; label: string }[];
  value: T;
  onChange: (value: T) => void;
  theme: Theme;
}) {
  return (
    <View style={[styles.segmented, { backgroundColor: theme.backgroundElement }]}>
      {options.map((opt) => {
        const selected = opt.value === value;
        return (
          <Pressable
            key={opt.value}
            onPress={() => onChange(opt.value)}
            style={({ pressed }) => [
              styles.segmentItem,
              { backgroundColor: selected ? ACCENT : 'transparent', opacity: pressed ? 0.85 : 1 },
            ]}>
            <Text style={[styles.segmentItemLabel, { color: selected ? 'white' : theme.textSecondary }]}>
              {opt.label}
            </Text>
          </Pressable>
        );
      })}
    </View>
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
  backButton: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 2,
    marginLeft: -4,
  },
  backLabel: {
    fontSize: 17,
    fontWeight: '600',
  },
  section: {
    gap: Spacing.three,
  },
  sectionHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
  },
  textAction: {
    fontSize: 15,
    fontWeight: '600',
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
  segmented: {
    flexDirection: 'row',
    borderRadius: 12,
    padding: 4,
    gap: 4,
  },
  segmentItem: {
    flex: 1,
    paddingVertical: 11,
    alignItems: 'center',
    borderRadius: 9,
  },
  segmentItemLabel: {
    fontSize: 15,
    fontWeight: '600',
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
  vehicleSelect: {
    flex: 1,
    flexDirection: 'row',
    alignItems: 'center',
    gap: Spacing.three,
  },
  addRow: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: Spacing.two,
  },
  addButton: {
    // flexBasis ~22% packs 4 per row; the 8 model buttons wrap to two rows (current / older).
    flexGrow: 1,
    flexBasis: '22%',
    flexDirection: 'row',
    justifyContent: 'center',
    alignItems: 'center',
    gap: 4,
    borderRadius: 12,
    paddingVertical: Spacing.three,
  },
  addButtonLabel: {
    fontSize: 15,
    fontWeight: '700',
  },
});
