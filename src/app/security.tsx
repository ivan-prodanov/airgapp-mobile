import { Fragment } from 'react';
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
// below PIN to Drive in the real app are intentionally dropped. Styled to match the Charging page: a single
// elevated card holding the rows, circular icon badges, and the grey rounded back-button pill.
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
          <View style={styles.card}>
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
              last
            />
          </View>
        </ScrollView>
      </SafeAreaView>
      <EdgeSwipeBack onBack={() => router.back()} />
    </View>
  );
}

function Row({
  symbol,
  title,
  subtitle,
  disabled,
  last,
  onPress,
  trailing,
}: {
  symbol: SFSymbol;
  title: string;
  subtitle: string;
  disabled?: boolean;
  // Suppress the hairline under the final row so it doesn't draw against the card's bottom edge.
  last?: boolean;
  onPress?: () => void;
  trailing: React.ReactNode;
}) {
  return (
    <Fragment>
      <Pressable
        style={[styles.row, disabled && styles.rowDisabled]}
        onPress={onPress}
        disabled={disabled || !onPress}
      >
        <View style={styles.badge}>
          <SymbolView name={symbol} tintColor="white" size={20} />
        </View>
        <View style={styles.textCol}>
          <Text style={styles.rowTitle}>{title}</Text>
          <Text style={styles.rowSub}>{subtitle}</Text>
        </View>
        {trailing}
      </Pressable>
      {last ? null : <View style={styles.divider} />}
    </Fragment>
  );
}

function NavRow(props: { symbol: SFSymbol; title: string; subtitle: string; onPress?: () => void; disabled?: boolean }) {
  return (
    <Row
      {...props}
      trailing={<SymbolView name="chevron.right" tintColor="rgba(255,255,255,0.35)" size={16} weight="semibold" />}
    />
  );
}

function ToggleRow({
  symbol,
  title,
  subtitle,
  value,
  onToggle,
  more,
  last,
}: {
  symbol: SFSymbol;
  title: string;
  subtitle: string;
  value: boolean;
  onToggle: () => void;
  more?: boolean;
  last?: boolean;
}) {
  return (
    <Row
      symbol={symbol}
      title={title}
      subtitle={subtitle}
      last={last}
      trailing={
        <View style={styles.trailing}>
          {more ? (
            <Pressable hitSlop={10} style={styles.more} onPress={() => {}}>
              <SymbolView name="ellipsis" tintColor="rgba(255,255,255,0.5)" size={20} weight="semibold" />
            </Pressable>
          ) : null}
          <Toggle value={value} onToggle={onToggle} />
        </View>
      }
    />
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
    backgroundColor: 'rgba(60,60,60,0.5)',
  },
  title: {
    fontSize: 21,
    fontWeight: '700',
    color: 'white',
  },
  scroll: {
    padding: 16,
    paddingBottom: 60,
    gap: 20,
  },
  card: {
    backgroundColor: '#1F1F22',
    borderRadius: 18,
    paddingHorizontal: 18,
  },
  row: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 16,
    paddingVertical: 16,
  },
  rowDisabled: {
    opacity: 0.35,
  },
  badge: {
    width: 36,
    height: 36,
    borderRadius: 18,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: 'rgba(255,255,255,0.12)',
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
  trailing: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 4,
  },
  more: {
    paddingHorizontal: 6,
  },
  divider: {
    height: StyleSheet.hairlineWidth,
    backgroundColor: 'rgba(255,255,255,0.12)',
  },
});
