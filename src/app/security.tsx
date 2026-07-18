import { Pressable, ScrollView, StyleSheet, Text, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { SymbolView, type SFSymbol } from 'expo-symbols';
import { useRouter } from 'expo-router';

import { EdgeSwipeBack } from '@/components/EdgeSwipeBack';
import { Toggle } from '@/components/Toggle';
import { controlHaptic } from '@/state/controlHaptic';
import { useVehicle } from '@/state/VehicleProvider';
import type { VehicleStateKey } from '@/types/vehicleTypes';

// Security & Drivers screen (route). Everything from Dashcam Viewer down to PIN to Drive; the driver/key rows
// below PIN to Drive in the real app are intentionally dropped.
export default function SecurityScreen() {
  const router = useRouter();
  const [state, actions] = useVehicle();

  const toggle = (key: VehicleStateKey) => {
    controlHaptic();
    actions.toggle(key);
  };

  return (
    <View style={styles.root}>
      <SafeAreaView edges={['top']} style={styles.safe}>
        <View style={styles.header}>
          <Pressable style={styles.back} hitSlop={10} onPress={() => router.back()}>
            <SymbolView name="chevron.left" tintColor="white" size={22} weight="medium" />
          </Pressable>
          <Text style={styles.title}>Security &amp; Drivers</Text>
        </View>

        <ScrollView contentContainerStyle={styles.scroll} showsVerticalScrollIndicator={false}>
          <NavRow symbol="camera.fill" title="Dashcam Viewer" subtitle="View saved clips" disabled />
          <ToggleRow
            symbol="record.circle.fill"
            title="Sentry Mode"
            subtitle="Enable to view live camera"
            value={state.sentryEnabled}
            onToggle={() => toggle('sentryEnabled')}
          />
          <ToggleRow
            symbol="key.fill"
            title="Valet Mode"
            subtitle="Limit vehicle access"
            value={state.valetMode}
            onToggle={() => toggle('valetMode')}
          />
          <ToggleRow
            symbol="figure.and.child.holdinghands"
            title="Parental Controls"
            subtitle="Turn on a full suite of safety features including speed limit mode, chill acceleration, and more..."
            value={state.parentalControls}
            onToggle={() => toggle('parentalControls')}
            more
          />
          <ToggleRow
            symbol="speedometer"
            title="Speed Limit Mode"
            subtitle="Limit top speed"
            value={state.speedLimitMode}
            onToggle={() => toggle('speedLimitMode')}
            more
          />
          <ToggleRow
            symbol="checkmark.shield.fill"
            title="PIN to Drive"
            subtitle="Require PIN entry to drive vehicle"
            value={state.pinToDrive}
            onToggle={() => toggle('pinToDrive')}
          />
        </ScrollView>
      </SafeAreaView>
      <EdgeSwipeBack onBack={() => router.back()} />
    </View>
  );
}

function NavRow({
  symbol,
  title,
  subtitle,
  onPress,
  disabled,
}: {
  symbol: SFSymbol;
  title: string;
  subtitle: string;
  onPress?: () => void;
  disabled?: boolean;
}) {
  return (
    <Pressable style={[styles.row, disabled && styles.rowDisabled]} onPress={onPress} disabled={disabled}>
      <View style={styles.iconCol}>
        <SymbolView name={symbol} tintColor="rgba(255,255,255,0.9)" size={26} />
      </View>
      <View style={styles.textCol}>
        <Text style={styles.rowTitle}>{title}</Text>
        <Text style={styles.rowSub}>{subtitle}</Text>
      </View>
      <SymbolView name="chevron.right" tintColor="rgba(255,255,255,0.35)" size={16} weight="semibold" />
    </Pressable>
  );
}

function ToggleRow({
  symbol,
  title,
  subtitle,
  value,
  onToggle,
  more,
}: {
  symbol: SFSymbol;
  title: string;
  subtitle: string;
  value: boolean;
  onToggle: () => void;
  more?: boolean;
}) {
  return (
    <View style={styles.row}>
      <View style={styles.iconCol}>
        <SymbolView name={symbol} tintColor="rgba(255,255,255,0.9)" size={26} />
      </View>
      <View style={styles.textCol}>
        <Text style={styles.rowTitle}>{title}</Text>
        <Text style={styles.rowSub}>{subtitle}</Text>
      </View>
      {more ? (
        <Pressable hitSlop={10} style={styles.more} onPress={() => {}}>
          <SymbolView name="ellipsis" tintColor="rgba(255,255,255,0.5)" size={20} weight="semibold" />
        </Pressable>
      ) : null}
      <Toggle value={value} onToggle={onToggle} />
    </View>
  );
}

const styles = StyleSheet.create({
  root: {
    flex: 1,
    backgroundColor: '#161618',
  },
  safe: {
    flex: 1,
  },
  header: {
    height: 52,
    justifyContent: 'center',
    alignItems: 'center',
    paddingHorizontal: 12,
  },
  back: {
    position: 'absolute',
    left: 6,
    width: 44,
    height: 44,
    borderRadius: 14,
    alignItems: 'center',
    justifyContent: 'center',
  },
  title: {
    fontSize: 21,
    fontWeight: '700',
    color: 'white',
  },
  scroll: {
    paddingHorizontal: 20,
    paddingTop: 8,
    paddingBottom: 60,
  },
  row: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 16,
    paddingVertical: 18,
  },
  rowDisabled: {
    opacity: 0.35,
  },
  iconCol: {
    width: 34,
    alignItems: 'center',
  },
  textCol: {
    flex: 1,
    gap: 3,
  },
  rowTitle: {
    fontSize: 19,
    fontWeight: '600',
    color: 'white',
  },
  rowSub: {
    fontSize: 14,
    lineHeight: 19,
    color: 'rgba(255,255,255,0.5)',
  },
  more: {
    paddingHorizontal: 6,
  },
});
