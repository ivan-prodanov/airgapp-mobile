import type { ReactNode } from 'react';
import { Pressable, ScrollView, StyleSheet, Text, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { SymbolView, type SFSymbol } from 'expo-symbols';

import type { VehicleActions } from '../state/useVehicleState';
import type { VehicleViewState } from '../types/vehicleTypes';

interface ScreenProps {
  state: VehicleViewState;
  actions: VehicleActions;
}

// Tesla-app home. Header + status over the parked car (dimmed when asleep), a quick-action icon row,
// a media bar (when awake + playing), and the navigation list. Car renders behind via VehicleCanvas.
export function HomeScreen({ state, actions }: ScreenProps) {
  return (
    <View style={styles.root} pointerEvents="box-none">
      <SafeAreaView edges={['top']} style={styles.top} pointerEvents="box-none">
        <View style={styles.header}>
          <Pressable style={styles.nameWrap} onPress={() => actions.toggle('awake')}>
            <Text style={styles.name}>Red Velvet</Text>
            <SymbolView name="chevron.down" tintColor="white" size={16} weight="semibold" />
          </Pressable>
          <View style={styles.headerIcons}>
            <SymbolView name="ellipsis.message" tintColor="white" size={22} />
            <SymbolView name="line.3.horizontal" tintColor="white" size={24} />
          </View>
        </View>
        <View style={styles.status}>
          <View style={styles.battery}>
            <View style={styles.batteryFill} />
          </View>
          <Text style={styles.statusPct}>48%</Text>
          <Text style={styles.statusText}>{state.awake ? 'Parked' : 'Last seen 3 days ago'}</Text>
        </View>
      </SafeAreaView>

      {/* car gap — the 3D car shows through here */}
      <View style={styles.carGap} pointerEvents="none" />

      <View style={styles.bottom} pointerEvents="box-none">
        <View style={styles.iconRow}>
          <QuickIcon
            symbol={state.locked ? 'lock.fill' : 'lock.open.fill'}
            active={!state.locked}
            onPress={() => actions.toggle('locked')}
          />
          <QuickIcon symbol="fanblades.fill" active={state.climateOn} onPress={() => actions.setCameraMode('CLIMATE')} />
          <QuickIcon symbol="bolt.fill" active={state.charging} onPress={() => actions.setCameraMode('CHARGING')} />
          <QuickIcon symbol="car.side.front.open.fill" active={state.frunkOpen} onPress={() => actions.toggle('frunkOpen')} />
          <QuickIcon symbol="wind" active={false} onPress={() => {}} />
        </View>

        {state.awake && state.mediaPlaying ? (
          <View style={styles.mediaBar}>
            <View style={styles.mediaGroup}>
              <SymbolView name="backward.end.fill" tintColor="white" size={22} />
              <SymbolView name="play.fill" tintColor="white" size={26} />
              <SymbolView name="forward.end.fill" tintColor="white" size={22} />
            </View>
            <View style={styles.mediaDivider} />
            <View style={styles.mediaGroup}>
              <SymbolView name="chevron.left" tintColor="rgba(255,255,255,0.5)" size={20} />
              <SymbolView name="speaker.wave.2.fill" tintColor="white" size={22} />
              <SymbolView name="chevron.right" tintColor="rgba(255,255,255,0.5)" size={20} />
            </View>
          </View>
        ) : null}

        <ScrollView style={styles.list} contentContainerStyle={styles.listContent} showsVerticalScrollIndicator={false}>
          <NavRow symbol="car.fill" title="Controls" onPress={() => actions.setCameraMode('TOP_DOWN')} />
          <NavRow
            symbol="fanblades.fill"
            title="Climate"
            subtitle={state.climateOn ? 'Active · Interior 21°C' : undefined}
            onPress={() => actions.setCameraMode('CLIMATE')}
          />
          <NavRow symbol="location.fill" title="Location" subtitle="Nearby" onPress={() => {}} />
          <NavRow symbol="steeringwheel" title="Summon" onPress={() => {}} />
          <NavRow symbol="bolt.fill" title="Charging" onPress={() => actions.setCameraMode('CHARGING')} />
          <NavRow symbol="alarm.fill" title="Set Schedules" onPress={() => {}} />
          <NavRow symbol="lock.shield.fill" title="Security & Drivers" onPress={() => {}} />
        </ScrollView>
      </View>
    </View>
  );
}

function QuickIcon({ symbol, active, onPress }: { symbol: SFSymbol; active: boolean; onPress: () => void }) {
  return (
    <Pressable style={styles.quickIcon} onPress={onPress} hitSlop={8}>
      <SymbolView name={symbol} tintColor={active ? 'white' : 'rgba(255,255,255,0.45)'} size={28} />
    </Pressable>
  );
}

function NavRow({
  symbol,
  title,
  subtitle,
  onPress,
}: {
  symbol: SFSymbol;
  title: string;
  subtitle?: string;
  onPress: () => void;
}): ReactNode {
  return (
    <Pressable style={styles.navRow} onPress={onPress}>
      <SymbolView name={symbol} tintColor="white" size={26} style={styles.navIcon} />
      <View style={styles.navText}>
        <Text style={styles.navTitle}>{title}</Text>
        {subtitle ? <Text style={styles.navSubtitle}>{subtitle}</Text> : null}
      </View>
      <SymbolView name="chevron.right" tintColor="rgba(255,255,255,0.4)" size={16} />
    </Pressable>
  );
}

const styles = StyleSheet.create({
  root: {
    position: 'absolute',
    top: 0,
    left: 0,
    right: 0,
    bottom: 0,
  },
  top: {
    paddingHorizontal: 20,
  },
  header: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    marginTop: 4,
  },
  nameWrap: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
  },
  name: {
    fontSize: 28,
    fontWeight: '700',
    color: 'white',
  },
  headerIcons: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 20,
  },
  status: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    marginTop: 6,
  },
  battery: {
    width: 26,
    height: 13,
    borderRadius: 3,
    borderWidth: 1.5,
    borderColor: 'rgba(255,255,255,0.5)',
    padding: 1.5,
  },
  batteryFill: {
    width: '48%',
    height: '100%',
    borderRadius: 1,
    backgroundColor: 'rgba(255,255,255,0.6)',
  },
  statusPct: {
    fontSize: 15,
    fontWeight: '600',
    color: 'rgba(255,255,255,0.85)',
  },
  statusText: {
    fontSize: 15,
    color: 'rgba(255,255,255,0.45)',
  },
  carGap: {
    flex: 1,
  },
  bottom: {
    paddingHorizontal: 16,
  },
  iconRow: {
    flexDirection: 'row',
    justifyContent: 'space-around',
    alignItems: 'center',
    paddingVertical: 14,
  },
  quickIcon: {
    width: 48,
    alignItems: 'center',
  },
  mediaBar: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: 'rgba(255,255,255,0.06)',
    borderRadius: 14,
    paddingVertical: 14,
    marginBottom: 8,
  },
  mediaGroup: {
    flex: 1,
    flexDirection: 'row',
    justifyContent: 'space-around',
    alignItems: 'center',
  },
  mediaDivider: {
    width: StyleSheet.hairlineWidth,
    height: 28,
    backgroundColor: 'rgba(255,255,255,0.15)',
  },
  list: {
    maxHeight: '52%',
  },
  listContent: {
    paddingBottom: 12,
  },
  navRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 18,
    paddingVertical: 18,
  },
  navIcon: {
    width: 28,
  },
  navText: {
    flex: 1,
  },
  navTitle: {
    fontSize: 20,
    fontWeight: '600',
    color: 'white',
  },
  navSubtitle: {
    fontSize: 14,
    color: 'rgba(255,255,255,0.45)',
    marginTop: 2,
  },
});
