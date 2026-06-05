import { useRef } from 'react';
import { Animated, PanResponder, Pressable, StyleSheet, Text, useWindowDimensions, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { SymbolView, type SFSymbol } from 'expo-symbols';

import type { VehicleActions } from '../state/useVehicleState';
import type { VehicleViewState } from '../types/vehicleTypes';

interface ScreenProps {
  state: VehicleViewState;
  actions: VehicleActions;
}

const clamp = (v: number, lo: number, hi: number) => Math.min(hi, Math.max(lo, v));

// Tesla-app home. Header + status over the parked car. The menu (favorite-actions bar + rows) sits at
// rest just below the car and is TRANSPARENT (no panel). Swipe it up and it slides over the car while
// a pure-black scrim fades the car out, so the menu ends up on plain black — no seam, layout unchanged.
export function HomeScreen({ state, actions }: ScreenProps) {
  const { height } = useWindowDimensions();
  const EXPAND = height * 0.28; // how far the menu can slide up over the car
  const translateY = useRef(new Animated.Value(0)).current; // 0 = rest, -EXPAND = raised over the car
  const startY = useRef(0);

  const pan = useRef(
    PanResponder.create({
      onMoveShouldSetPanResponder: (_e, g) => Math.abs(g.dy) > 8 && Math.abs(g.dy) > Math.abs(g.dx),
      onPanResponderGrant: () => {
        translateY.stopAnimation((v) => {
          startY.current = v;
        });
      },
      onPanResponderMove: (_e, g) => {
        translateY.setValue(clamp(startY.current + g.dy, -EXPAND, 0));
      },
      onPanResponderRelease: (_e, g) => {
        const current = clamp(startY.current + g.dy, -EXPAND, 0);
        const dest = g.vy < -0.4 || current < -EXPAND / 2 ? -EXPAND : 0;
        Animated.spring(translateY, { toValue: dest, useNativeDriver: false, bounciness: 2, speed: 14 }).start();
      },
    }),
  ).current;

  const scrimOpacity = translateY.interpolate({
    inputRange: [-EXPAND, 0],
    outputRange: [0.92, 0],
    extrapolate: 'clamp',
  });

  return (
    <View style={styles.root} pointerEvents="box-none">
      {/* pure black, fades the car in as the menu rises over it */}
      <Animated.View pointerEvents="none" style={[styles.scrim, { opacity: scrimOpacity }]} />

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

      <View style={styles.carGap} pointerEvents="none" />

      {/* transparent menu; slides up on swipe, no background */}
      <Animated.View style={[styles.sheet, { transform: [{ translateY }] }]} {...pan.panHandlers}>
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
      </Animated.View>
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
}) {
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
  scrim: {
    position: 'absolute',
    top: 0,
    left: 0,
    right: 0,
    bottom: 0,
    backgroundColor: '#000',
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
  sheet: {
    paddingHorizontal: 16,
    paddingBottom: 16,
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
