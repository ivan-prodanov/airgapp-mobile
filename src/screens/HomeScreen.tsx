import { useEffect, useRef, useState, type ReactNode } from 'react';
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
import { useRouter } from 'expo-router';
import type { GestureResponderHandlers } from 'react-native';

import { useCarLinkStatus, useFleet, usePreferences } from '@/state/VehicleProvider';
import { CONTROL_ACTIONS, CONTROL_AFFECTED_KEYS } from '@/state/controlActions';
import { controlHaptic } from '@/state/controlHaptic';
import { CustomizeControlsSheet } from '@/components/CustomizeControlsSheet';
import { SpinningSymbol } from '@/components/SpinningSymbol';
import { VehicleStatusText } from '@/components/VehicleStatusText';
import { BusyIcon } from '@/components/BusyIcon';
import { ChargeStatus } from '@/components/ChargeStatus';
import { vehicleStatusText } from '@/ble/vehicleStatusText';
import { CarHeadingArrow } from '@/components/CarHeadingArrow';
import type { VehicleActions } from '../state/useVehicleState';
import type { VehicleViewState } from '../types/vehicleTypes';

// The favorites-row glyph size — the SF Symbol's size and the fixed box the
// pending spinner swaps into.
const ICON_SIZE = 28;

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
  const router = useRouter();
  const { favorites } = usePreferences();
  const carLink = useCarLinkStatus();
  // Re-render every 5s while linked so the asleep/offline age ("Asleep 5
  // minutes", "Last seen 2 hours ago") ticks up between the 20s polls (the poll
  // itself re-renders on each successful read). No-op when unlinked, so demo
  // cars pay nothing.
  const [, setNow] = useState(0);
  useEffect(() => {
    if (!carLink.linked) return;
    const id = setInterval(() => setNow((n) => n + 1), 5_000);
    return () => clearInterval(id);
  }, [carLink.linked]);
  // Geographic bearing to the active car (mock = its stable offset bearing; real coords arrive via BLE).
  // Drives the compass arrow on the Location row.
  const activeVehicle = fleet.vehicles.find((v) => v.id === fleet.activeId) ?? fleet.vehicles[0];
  const bearingToCar = activeVehicle.mockLocationOffset.bearingDeg;
  const [customizing, setCustomizing] = useState(false);
  const openCustomize = () => {
    Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Medium).catch(() => {});
    setCustomizing(true);
  };
  // A user-requested wake is in flight (pull-to-refresh). This drives the header
  // spinner — NOT RefreshControl, which the official app keeps permanently
  // `refreshing={false}` so the pull shows only their BusyIcon (findings §3).
  const [wakeInFlight, setWakeInFlight] = useState(false);

  // One derived status for the whole header: the text/spinner for the status
  // line AND the `stale` flag that dims the battery row (findings §C3).
  const status = vehicleStatusText({
    linked: carLink.linked,
    lastVehicleDataAt: carLink.lastVehicleDataAt,
    awake: state.awake,
    wakeInFlight,
    now: Date.now(),
  });

  const carBand = height * 0.43; // spacer above the menu = header + car; keeps the rest position
  const EXPAND = height * 0.21; // scroll distance from rest to fully-open (over the car)

  const scrollY = useRef(new Animated.Value(0)).current;

  const scrimOpacity = scrollY.interpolate({
    inputRange: [0, EXPAND],
    outputRange: [0, 0.95],
    extrapolate: 'clamp',
  });

  // Fade the fixed top row (name / battery / icons) out as the menu rises, so the scrolling rows don't
  // collide with it — like the official app. Anchored to the ACTUAL max scroll offset (content height −
  // viewport height) rather than EXPAND multiples, so the header stays solid until the very last stretch
  // of travel and finishes hiding right at the top — "as late as possible", independent of device.
  const [contentH, setContentH] = useState(0);
  const [viewportH, setViewportH] = useState(0);
  const maxScroll = Math.max(0, contentH - viewportH);
  const scrollCeil = maxScroll > EXPAND ? maxScroll : EXPAND * 1.22; // measured top of travel; fallback pre-layout
  const fadeStart = Math.max(1, scrollCeil - EXPAND * 0.55); // begin fading in the final ~0.55·EXPAND
  const fadeEnd = fadeStart + EXPAND * 0.2; // quick fade: fully hidden well before the top, then stays hidden
  const headerOpacity = scrollY.interpolate({
    inputRange: [0, fadeStart, fadeEnd],
    outputRange: [1, 1, 0],
    extrapolate: 'clamp',
  });
  // Drop the header's touch handling past the fade midpoint (opacity < ~0.5) so taps in that zone
  // scroll the menu behind it instead of hitting the near-invisible name/icons. Threshold-crossing
  // guard avoids a setState on every scroll frame.
  const [headerInteractive, setHeaderInteractive] = useState(true);
  useEffect(() => {
    const offThreshold = (fadeStart + fadeEnd) / 2;
    const id = scrollY.addListener(({ value }) => {
      const interactive = value < offThreshold;
      setHeaderInteractive((prev) => (prev === interactive ? prev : interactive));
    });
    return () => scrollY.removeListener(id);
  }, [scrollY, fadeStart, fadeEnd]);

  const onRefresh = () => {
    // Little Taptic tap when the pull crosses the refresh threshold, like the real app / Mail / etc.
    Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Medium).catch(() => {});
    setWakeInFlight(true);
    setTimeout(() => {
      setWakeInFlight(false);
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
        onLayout={(e) => setViewportH(e.nativeEvent.layout.height)}
        onContentSizeChange={(_w, h) => setContentH(h)}
        // No snapToOffsets / decelerationRate="fast": the drawer snap made a scroll started on the car
        // spring back to 0 unless the drag crossed the midpoint, so the menu felt sticky/slow vs. the
        // free scroll on Climate/Location. Plain momentum scroll (default deceleration) matches them;
        // the scrim still fades over [0, EXPAND] at any offset, so the open-over-car look is preserved.
        onScroll={Animated.event([{ nativeEvent: { contentOffset: { y: scrollY } } }], { useNativeDriver: true })}
        refreshControl={
          <RefreshControl
            // Always false, as the official app does (findings §3): the pull
            // fires the wake and the header BusyIcon is the only feedback, so
            // we don't stack RN's control spinner on top of theirs.
            refreshing={false}
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
          <Pressable onLongPress={openCustomize} delayLongPress={300} style={styles.iconRow}>
            {favorites.map((id) => {
              const action = CONTROL_ACTIONS[id];
              // In-flight while any of this control's real command keys are
              // pending. Empty for demo/unlinked cars (pending never populates).
              const pending = CONTROL_AFFECTED_KEYS[id].some((key) => carLink.pending.has(key));
              return (
                <QuickIcon
                  key={id}
                  symbol={action.symbol(state)}
                  active={action.isActive(state)}
                  spin={action.spinning?.(state) ?? false}
                  pending={pending}
                  onPress={() => {
                    controlHaptic();
                    action.run(state, actions);
                  }}
                  onLongPress={openCustomize}
                />
              );
            })}
          </Pressable>

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
            status={state.climateOn ? 'Active' : undefined}
            subtitle={`Interior ${Math.round(state.interiorTempC)}°C`}
            onPress={() => actions.setCameraMode('CLIMATE')}
          />
          <NavRow
            symbol="location.fill"
            title="Location"
            subtitle="Nearby"
            onPress={() => router.push('/location')}
            leading={<CarHeadingArrow bearingToCar={bearingToCar} size={26} color="white" />}
          />
          <NavRow symbol="steeringwheel" title="Summon" disabled />
          <NavRow symbol="bolt.fill" title="Charging" onPress={() => router.push('/charging')} />
          <NavRow symbol="alarm.fill" title="Set Schedules" onPress={() => router.push('/schedules')} />
          <NavRow symbol="lock.shield.fill" title="Security & Drivers" subtitle="Ivan P" onPress={() => router.push('/security')} />
          <NavRow symbol="wrench.and.screwdriver.fill" title="Service" disabled />
          <NavRow symbol="camera.fill" title="Dashcam Viewer" disabled />
          <NavRow symbol="camera.viewfinder" title="Photobooth" disabled />
        </View>
      </Animated.ScrollView>

      <CustomizeControlsSheet visible={customizing} onClose={() => setCustomizing(false)} />

      {/* fixed header on top — fades out (and stops taking touches) as the menu scrolls up over it */}
      <SafeAreaView edges={['top']} style={styles.top} pointerEvents="box-none">
        <Animated.View
          style={{ opacity: headerOpacity }}
          pointerEvents={headerInteractive ? 'box-none' : 'none'}>
        {/* Header tree per findings §C1: NAME -> BATTERY (own row) -> STATUS TEXT
            (own full-width row). Name+battery share the left column; the icons
            sit opposite them; the status line spans the width underneath. */}
        <View style={styles.header}>
          <View style={styles.headerLeft}>
            <Pressable style={styles.nameWrap} onPress={() => actions.toggle('awake')}>
              <Text style={styles.name}>{fleet.activeName}</Text>
              <SymbolView name="chevron.down" tintColor="white" size={16} weight="semibold" />
            </Pressable>
            <ChargeStatus
              batteryLevel={state.batteryLevel}
              rangeKm={state.rangeKm}
              charging={state.charging}
              stale={status.stale}
            />
          </View>
          <View style={styles.headerIcons}>
            <Pressable hitSlop={10} onPress={() => router.push('/explore')}>
              <SymbolView name="ellipsis.message" tintColor="white" size={22} />
            </Pressable>
            <SymbolView name="line.3.horizontal" tintColor="white" size={24} />
          </View>
        </View>
        <VehicleStatusText text={status.text} spinner={status.spinner} />
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
        </Animated.View>
      </SafeAreaView>
    </View>
  );
}

function QuickIcon({
  symbol,
  active,
  spin,
  pending,
  onPress,
  onLongPress,
}: {
  symbol: SFSymbol;
  active: boolean;
  spin?: boolean;
  // A real command for this control is in flight (dispatched, unconfirmed).
  // REPLACES the icon with a small circular spinner until the car
  // confirms/fails — what the official app does (it does not pulse the icon).
  pending?: boolean;
  onPress: () => void;
  onLongPress?: () => void;
}) {
  const tint = active ? 'white' : 'rgba(255,255,255,0.45)';

  return (
    <Pressable style={styles.quickIcon} onPress={onPress} onLongPress={onLongPress} delayLongPress={300} hitSlop={8}>
      {/* Fixed ICON_SIZE box so swapping icon↔spinner never shifts the row. */}
      <View style={styles.quickIconGlyph}>
        {pending ? (
          // The SAME spinner as the header — the official app's own
          // mini_spinner.png at BusyIcon's default size (20; the header is the
          // one place that overrides it to 18). Findings §D.
          <BusyIcon size={20} />
        ) : (
          <SpinningSymbol name={symbol} tintColor={tint} size={ICON_SIZE} spin={spin} />
        )}
      </View>
    </Pressable>
  );
}

function NavRow({
  symbol,
  title,
  status,
  subtitle,
  onPress,
  leading,
  disabled,
}: {
  symbol: SFSymbol;
  title: string;
  // Bold/bright leading word (e.g. Climate "Active"), like the official app; rendered before subtitle.
  status?: string;
  subtitle?: string;
  onPress?: () => void;
  // Optional custom leading icon; defaults to the SF Symbol. The Location row passes its compass arrow.
  leading?: ReactNode;
  // Greyed-out + non-interactive (feature not wired yet).
  disabled?: boolean;
}) {
  return (
    <Pressable style={[styles.navRow, disabled && styles.navRowDisabled]} onPress={onPress} disabled={disabled}>
      {leading ? (
        <View style={styles.navIcon}>{leading}</View>
      ) : (
        <SymbolView name={symbol} tintColor="white" size={26} style={styles.navIcon} />
      )}
      <View style={styles.navText}>
        <Text style={styles.navTitle}>{title}</Text>
        {status || subtitle ? (
          <Text style={styles.navSubtitle} numberOfLines={1}>
            {status ? <Text style={styles.navStatus}>{status}</Text> : null}
            {status && subtitle ? ' · ' : null}
            {subtitle}
          </Text>
        ) : null}
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
  // findings §C2 headerFirstRow: row / align flex-start / space-between. Top
  // alignment matters now that the left side is a two-line column.
  header: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    justifyContent: 'space-between',
    marginTop: 4,
  },
  // findings §C2 headerLeftContainer: a COLUMN holding the name + battery row.
  headerLeft: {
    flex: 1,
    maxWidth: 250,
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
  // Fixed square the icon OR the pending spinner renders into, so the swap is
  // footprint-identical (no layout shift when a command starts/settles).
  quickIconGlyph: {
    width: ICON_SIZE,
    height: ICON_SIZE,
    alignItems: 'center',
    justifyContent: 'center',
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
  navRowDisabled: {
    opacity: 0.35,
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
  navStatus: {
    fontWeight: '700',
    color: 'rgba(255,255,255,0.9)',
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
