import { useRef, useState } from 'react';
import {
  Animated,
  Pressable,
  RefreshControl,
  StyleSheet,
  Text,
  useWindowDimensions,
  View,
} from 'react-native';
import { SafeAreaView, useSafeAreaInsets } from 'react-native-safe-area-context';
import { SymbolView, type SFSymbol } from 'expo-symbols';
import * as Haptics from 'expo-haptics';
import type { GestureResponderHandlers } from 'react-native';

import { useFleet } from '@/state/VehicleProvider';
import type { VehicleActions } from '../state/useVehicleState';
import type { VehicleViewState } from '../types/vehicleTypes';

interface ScreenProps {
  state: VehicleViewState;
  actions: VehicleActions;
  // PanResponder handlers from index.tsx, spread onto the car-band view so a horizontal drag there
  // switches vehicles (vertical drags fall through to this menu's ScrollView).
  swipeHandlers?: GestureResponderHandlers;
}

// Tesla-app home. Header over the parked car; the menu (favorite-actions bar + rows) is one
// scroll-driven sheet sitting just below the car. Swipe up: it slides over the car (which fades to
// black via a scrim) and snaps fully open past halfway, revealing the rest of the list. The menu is
// TRANSPARENT (no panel) so it lands on seamless black. Pull down: refresh.
export function HomeScreen({ state, actions, swipeHandlers }: ScreenProps) {
  const { height } = useWindowDimensions();
  const insets = useSafeAreaInsets();
  const fleet = useFleet();
  const carBand = height * 0.43; // spacer above the menu = header + car; keeps the rest position
  const EXPAND = height * 0.21; // scroll distance from rest to fully-open (over the car)

  const scrollY = useRef(new Animated.Value(0)).current;
  const [refreshing, setRefreshing] = useState(false);

  const scrimOpacity = scrollY.interpolate({
    inputRange: [0, EXPAND],
    outputRange: [0, 0.95],
    extrapolate: 'clamp',
  });

  const onRefresh = () => {
    // Little Taptic tap when the pull crosses the refresh threshold, like the real app / Mail / etc.
    Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Medium).catch(() => {});
    setRefreshing(true);
    setTimeout(() => {
      setRefreshing(false);
      actions.patch({ awake: true });
    }, 1400);
  };

  return (
    <View style={styles.root} pointerEvents="box-none">
      {/* pure black — fades the car in as the menu rises over it */}
      <Animated.View pointerEvents="none" style={[styles.scrim, { opacity: scrimOpacity }]} />

      <Animated.ScrollView
        style={styles.scroll}
        showsVerticalScrollIndicator={false}
        scrollEventThrottle={16}
        snapToOffsets={[0, EXPAND]}
        snapToEnd={false}
        decelerationRate="fast"
        onScroll={Animated.event([{ nativeEvent: { contentOffset: { y: scrollY } } }], { useNativeDriver: true })}
        refreshControl={
          <RefreshControl
            refreshing={refreshing}
            onRefresh={onRefresh}
            tintColor="rgba(255,255,255,0.6)"
            // Drop the spinner below the Face ID notch so it lands next to the "Red Velvet" header.
            progressViewOffset={insets.top + 10}
          />
        }
      >
        {/* car shows through here. box-only + the PanResponder handlers: captures horizontal swipes
            to switch vehicles while staying visually transparent (car still shows through) and
            letting vertical drags scroll this menu. */}
        <View style={{ height: carBand }} pointerEvents="box-only" {...swipeHandlers} />

        {/* transparent menu — no background */}
        <View style={styles.menu}>
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
          <NavRow symbol="lock.shield.fill" title="Security & Drivers" subtitle="Ivan P" onPress={() => {}} />
          <NavRow symbol="wrench.and.screwdriver.fill" title="Service" onPress={() => {}} />
          <NavRow symbol="camera.fill" title="Dashcam Viewer" onPress={() => {}} />
          <NavRow symbol="camera.viewfinder" title="Photobooth" onPress={() => {}} />
        </View>
      </Animated.ScrollView>

      {/* fixed header on top */}
      <SafeAreaView edges={['top']} style={styles.top} pointerEvents="box-none">
        <View style={styles.header}>
          <Pressable style={styles.nameWrap} onPress={() => actions.toggle('awake')}>
            <Text style={styles.name}>{fleet.activeName}</Text>
            <SymbolView name="chevron.down" tintColor="white" size={16} weight="semibold" />
          </Pressable>
          <View style={styles.headerIcons}>
            <SymbolView name="ellipsis.message" tintColor="white" size={22} />
            <SymbolView name="line.3.horizontal" tintColor="white" size={24} />
          </View>
        </View>
        <View style={styles.status}>
          <View style={styles.battery}>
            <View style={[styles.batteryFill, { width: `${state.batteryLevel}%` }]} />
          </View>
          <Text style={styles.statusPct}>{state.batteryLevel}%</Text>
          <Text style={styles.statusText}>{state.awake ? 'Parked' : 'Last seen 3 days ago'}</Text>
        </View>
        {fleet.vehicles.length > 1 ? (
          <View style={styles.dots}>
            {fleet.vehicles.map((vehicle, index) => (
              <View
                key={vehicle.id}
                style={[styles.dot, index === fleet.activeIndex ? styles.dotActive : null]}
              />
            ))}
          </View>
        ) : null}
      </SafeAreaView>
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
    // Match the Godot scene's background grey so the swipe fades the car INTO the same grey
    // instead of driving everything to pure black.
    backgroundColor: '#161718',
  },
  scroll: {
    flex: 1,
  },
  menu: {
    paddingHorizontal: 16,
    paddingBottom: 120,
  },
  top: {
    position: 'absolute',
    top: 0,
    left: 0,
    right: 0,
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
  dots: {
    flexDirection: 'row',
    gap: 6,
    marginTop: 10,
  },
  dot: {
    width: 6,
    height: 6,
    borderRadius: 3,
    backgroundColor: 'rgba(255,255,255,0.3)',
  },
  dotActive: {
    backgroundColor: 'white',
  },
});
