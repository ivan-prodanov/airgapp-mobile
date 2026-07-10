import { useRef, useState } from 'react';
import { PanResponder, Pressable, ScrollView, StyleSheet, Text, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { SymbolView, type SFSymbol } from 'expo-symbols';
import * as Haptics from 'expo-haptics';
import { useRouter } from 'expo-router';

import { EdgeSwipeBack } from '@/components/EdgeSwipeBack';
import { useVehicle } from '@/state/VehicleProvider';

// Charge-limit slider domain (Tesla: daily 50% up to trip 100%).
const LIMIT_MIN = 50;
const LIMIT_MAX = 100;
// Detent "stoppers" on the track — the thumb snaps + ticks (haptic) at each, like the Tesla app.
const DETENTS = [50, 60, 70, 80, 90, 100];
// Magnetic pull: within this many % of a stopper the value sticks to it.
const SNAP = 2;
// Charging current stepper domain, per spec: 5 A … 16 A.
const AMP_MIN = 5;
const AMP_MAX = 16;

const DIM = 'rgba(255,255,255,0.22)';
// Detent "click" shared by the charge-limit stoppers and the current stepper, so both feel the same.
const detentTick = () => Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Rigid).catch(() => {});

// Charging screen — RN build of the Tesla Charging page. Full opaque page (no car behind, matching the app):
// charge-limit slider + current stepper + charge-port control, then quick links. Payment/stats/badges/history
// rows are intentionally omitted (no billing in an air-gapped build).
export default function ChargingScreen() {
  const router = useRouter();
  const [state, actions] = useVehicle();

  const [chargeLimit, setChargeLimit] = useState(80);
  const [amps, setAmps] = useState(AMP_MAX);
  // While dragging the slider, freeze the page ScrollView so the drag adjusts the value instead of scrolling.
  const [sliding, setSliding] = useState(false);
  // Green fill = the CURRENT battery level; the draggable thumb = the charge limit (they're independent, like
  // the Tesla app — the fill is where the battery is now, the handle is where charging will stop).
  const batteryFrac = Math.max(0, Math.min(1, state.batteryLevel / LIMIT_MAX));
  const limitFrac = chargeLimit / LIMIT_MAX;

  // Custom slider (no slider dep). Drive it from the touch's ABSOLUTE pageX minus the track's measured
  // window-left — NOT the target-relative locationX. locationX is reported relative to whatever view sits under
  // the finger, so once the thumb slid under the finger the value oscillated ("flipping left/right"). pageX is
  // target-independent, and the thumb/fill are pointerEvents="none" so they never become the touch target.
  const trackRef = useRef<View>(null);
  const trackW = useRef(0);
  const trackLeft = useRef(0);
  const lastValue = useRef(80); // for detecting detent crossings between successive drag samples
  const measureTrack = () => {
    trackRef.current?.measureInWindow((x, _y, w) => {
      if (w > 0) {
        trackLeft.current = x;
        trackW.current = w;
      }
    });
  };
  const applyLimitFromPageX = (pageX: number) => {
    const w = trackW.current;
    if (w <= 0) return;
    const frac = Math.max(0, Math.min(1, (pageX - trackLeft.current) / w)); // 0..1 across the 0–100% track
    // Track spans 0–100%, but the charge limit can't be set below 50%.
    let value = Math.max(LIMIT_MIN, Math.min(LIMIT_MAX, Math.round(frac * LIMIT_MAX)));
    // Magnetic detents: within SNAP% of a stopper, stick to it (you feel it pull to 50/60/70/80/90/100).
    for (const d of DETENTS) {
      if (Math.abs(value - d) <= SNAP) {
        value = d;
        break;
      }
    }
    const prev = lastValue.current;
    if (value === prev) return;
    // Strong tick whenever the drag lands on / crosses a stopper.
    if (DETENTS.some((d) => (prev < d && value >= d) || (prev > d && value <= d))) {
      detentTick();
    }
    lastValue.current = value;
    setChargeLimit(value);
  };
  const limitPan = useRef(
    PanResponder.create({
      onStartShouldSetPanResponder: () => true,
      onMoveShouldSetPanResponder: () => true,
      // Never yield the touch back to the ScrollView once the slider owns it.
      onPanResponderTerminationRequest: () => false,
      onPanResponderGrant: (e) => {
        measureTrack();
        setSliding(true);
        applyLimitFromPageX(e.nativeEvent.pageX);
      },
      onPanResponderMove: (e) => applyLimitFromPageX(e.nativeEvent.pageX),
      onPanResponderRelease: () => setSliding(false),
      onPanResponderTerminate: () => setSliding(false),
    }),
  ).current;

  const decAmps = () => {
    if (amps <= AMP_MIN) return;
    detentTick();
    setAmps((a) => Math.max(AMP_MIN, a - 1));
  };
  const incAmps = () => {
    if (amps >= AMP_MAX) return;
    detentTick();
    setAmps((a) => Math.min(AMP_MAX, a + 1));
  };

  // Charge port: closed → "Open"; open & idle → "Close"; open & charging → "Unlock" (releases the latch).
  // Mirrors the `charging` control action's port logic.
  const portOpen = state.chargePortOpen;
  const portLabel = portOpen
    ? state.charging
      ? 'Unlock Charge Port'
      : 'Close Charge Port'
    : 'Open Charge Port';
  const togglePort = () => {
    Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Medium).catch(() => {});
    actions.patch(portOpen ? { chargePortOpen: false, charging: false } : { chargePortOpen: true });
  };

  return (
    <View style={styles.root}>
      <SafeAreaView edges={['top']} style={styles.safe}>
        <View style={styles.header}>
          <Pressable style={styles.back} hitSlop={10} onPress={() => router.back()}>
            <SymbolView name="chevron.left" tintColor="white" size={22} weight="medium" />
          </Pressable>
          <View style={styles.headerTitles}>
            <Text style={styles.title}>Charging</Text>
            <Text style={styles.subtitle}>{Math.round(state.batteryLevel)}%</Text>
          </View>
        </View>

        <ScrollView
          contentContainerStyle={styles.scroll}
          showsVerticalScrollIndicator={false}
          scrollEnabled={!sliding}
        >
          <View style={styles.card}>
            <Text style={styles.limitLabel}>Charge limit: {chargeLimit}%</Text>

            <View style={styles.sliderRow} {...limitPan.panHandlers}>
              <View ref={trackRef} style={styles.track} onLayout={measureTrack}>
                {/* Green fill = current battery level (not the limit). */}
                <View pointerEvents="none" style={[styles.fill, { width: `${batteryFrac * 100}%` }]} />
                {/* Detent stoppers at 50/60/70/80/90 (100 is the track's end). */}
                {DETENTS.filter((d) => d < LIMIT_MAX).map((d) => (
                  <View key={d} pointerEvents="none" style={[styles.tick, { left: `${d}%` }]} />
                ))}
                {/* White thumb = charge limit. */}
                <View pointerEvents="none" style={[styles.thumb, { left: `${limitFrac * 100}%` }]} />
              </View>
            </View>

            <View style={styles.amps}>
              <Pressable hitSlop={14} onPress={decAmps} disabled={amps <= AMP_MIN}>
                <SymbolView
                  name="chevron.left"
                  tintColor={amps <= AMP_MIN ? DIM : 'white'}
                  size={22}
                  weight="medium"
                />
              </Pressable>
              <Text style={styles.ampsText}>{amps} A</Text>
              <Pressable hitSlop={14} onPress={incAmps} disabled={amps >= AMP_MAX}>
                <SymbolView
                  name="chevron.right"
                  tintColor={amps >= AMP_MAX ? DIM : 'white'}
                  size={22}
                  weight="medium"
                />
              </Pressable>
            </View>

            <View style={styles.divider} />

            <Pressable style={styles.portBtn} onPress={togglePort}>
              <Text style={styles.portText}>{portLabel}</Text>
            </Pressable>
          </View>

          <View style={styles.list}>
            <LinkRow
              symbol="bolt.fill"
              title="Find Chargers"
              onPress={() => router.push({ pathname: '/location', params: { tab: 'charging' } })}
            />
            <LinkRow symbol="alarm.fill" title="Schedule Charging" onPress={() => {}} />
          </View>
        </ScrollView>
      </SafeAreaView>
      <EdgeSwipeBack onBack={() => router.back()} />
    </View>
  );
}

function LinkRow({ symbol, title, onPress }: { symbol: SFSymbol; title: string; onPress: () => void }) {
  return (
    <Pressable style={styles.linkRow} onPress={onPress}>
      <View style={styles.badge}>
        <SymbolView name={symbol} tintColor="white" size={20} />
      </View>
      <Text style={styles.linkTitle}>{title}</Text>
      <SymbolView name="chevron.right" tintColor="rgba(255,255,255,0.4)" size={16} weight="semibold" />
    </Pressable>
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
  headerTitles: {
    alignItems: 'center',
  },
  title: {
    fontSize: 21,
    fontWeight: '700',
    color: 'white',
  },
  subtitle: {
    fontSize: 15,
    fontWeight: '500',
    color: 'rgba(255,255,255,0.5)',
    marginTop: 1,
  },
  scroll: {
    padding: 16,
    paddingBottom: 60,
    gap: 20,
  },
  card: {
    backgroundColor: '#1F1F22',
    borderRadius: 18,
    padding: 18,
  },
  limitLabel: {
    fontSize: 19,
    fontWeight: '700',
    color: 'white',
    marginBottom: 4,
  },
  sliderRow: {
    paddingVertical: 20,
  },
  track: {
    width: '100%',
    height: 5,
    borderRadius: 3,
    backgroundColor: 'rgba(255,255,255,0.18)',
  },
  fill: {
    position: 'absolute',
    left: 0,
    top: 0,
    bottom: 0,
    borderRadius: 3,
    backgroundColor: '#34C759',
  },
  // Detent "stopper" — a thin vertical line drawn across the track (protrudes slightly so it reads as a "|"
  // mark, not a gap in the bar).
  tick: {
    position: 'absolute',
    top: -3,
    bottom: -3,
    width: 2,
    marginLeft: -1,
    borderRadius: 1,
    backgroundColor: 'rgba(255,255,255,0.55)',
  },
  thumb: {
    position: 'absolute',
    top: -9.5,
    marginLeft: -12,
    width: 24,
    height: 24,
    borderRadius: 12,
    backgroundColor: 'white',
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 1 },
    shadowOpacity: 0.35,
    shadowRadius: 3,
  },
  amps: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: 'rgba(255,255,255,0.08)',
    borderRadius: 12,
    paddingHorizontal: 20,
    height: 56,
  },
  ampsText: {
    flex: 1,
    textAlign: 'center',
    fontSize: 18,
    fontWeight: '600',
    color: 'white',
  },
  divider: {
    height: StyleSheet.hairlineWidth,
    backgroundColor: 'rgba(255,255,255,0.12)',
    marginTop: 18,
  },
  portBtn: {
    alignItems: 'center',
    paddingTop: 18,
    paddingBottom: 2,
  },
  portText: {
    fontSize: 17,
    fontWeight: '500',
    color: 'rgba(255,255,255,0.55)',
  },
  list: {
    gap: 4,
  },
  linkRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 16,
    paddingVertical: 14,
  },
  badge: {
    width: 36,
    height: 36,
    borderRadius: 18,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: 'rgba(255,255,255,0.12)',
  },
  linkTitle: {
    flex: 1,
    fontSize: 19,
    fontWeight: '600',
    color: 'white',
  },
});
