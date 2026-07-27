import { useEffect, useRef, useState } from 'react';
import { Pressable, ScrollView, StyleSheet, Text, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { SymbolView, type SFSymbol } from 'expo-symbols';
import * as Haptics from 'expo-haptics';
import { useRouter } from 'expo-router';

import { EdgeSwipeBack } from '@/components/EdgeSwipeBack';
import { AMP_MAX, AMP_MIN, LIMIT_MAX, LIMIT_MIN } from '@/state/fleet';
import { useVehicle } from '@/state/VehicleProvider';
import { ChargeLimitSlider } from '@/components/ChargeLimitSlider';

const DIM = 'rgba(255,255,255,0.22)';
// Detent "click" shared by the charge-limit stoppers and the current stepper, so both feel the same.
const detentTick = () => Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Rigid).catch(() => {});

// Charging screen — RN build of the Tesla Charging page. Full opaque page (no car behind, matching the app):
// charge-limit slider + current stepper + charge-port control, then quick links. Payment/stats/badges/history
// rows are intentionally omitted (no billing in an air-gapped build).
export default function ChargingScreen() {
  const router = useRouter();
  const [state, actions] = useVehicle();

  const chargeLimit = state.chargeLimitPercent;
  const amps = state.chargingAmps;
  // The slider's PanResponder is built ONCE (useRef), so it would capture the first render's
  // `actions` — and `actions` is rebuilt on every state change. Route the drag through a ref so it
  // always calls the current one. Kept fresh in an effect (not during render); the ref is only ever
  // read from a drag handler, which by definition runs after mount.
  const actionsRef = useRef(actions);
  useEffect(() => {
    actionsRef.current = actions;
  }, [actions]);
  // While dragging the slider, freeze the page ScrollView so the drag adjusts the value instead of scrolling.
  const [sliding, setSliding] = useState(false);
  // Green fill = the CURRENT battery level; the draggable thumb = the charge limit (they're independent, like
  // the Tesla app — the fill is where the battery is now, the handle is where charging will stop).


  const decAmps = () => {
    if (amps <= AMP_MIN) return;
    detentTick();
    actions.setChargingAmps(amps - 1);
  };
  const incAmps = () => {
    if (amps >= AMP_MAX) return;
    detentTick();
    actions.setChargingAmps(amps + 1);
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
            <Text style={styles.subtitle}>
              {state.batteryLevel != null ? `${Math.round(state.batteryLevel)}%` : '—'}
            </Text>
          </View>
        </View>

        <ScrollView
          contentContainerStyle={styles.scroll}
          showsVerticalScrollIndicator={false}
          scrollEnabled={!sliding}
        >
          <View style={styles.card}>
            <Text style={styles.limitLabel}>Charge limit: {chargeLimit}%</Text>

            {/* Extracted to ChargeLimitSlider so the home charge panel uses the
                SAME control. `surfaceColor` is the card behind it — the detent
                breaks are punched in that colour. */}
            <ChargeLimitSlider
              batteryPercent={state.batteryLevel}
              limitPercent={chargeLimit}
              min={LIMIT_MIN}
              max={LIMIT_MAX}
                  onChange={(v) => actions.setChargeLimit(v)}
              onSlidingChange={setSliding}
            />

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
            <LinkRow
              symbol="alarm.fill"
              title="Schedule Charging"
              onPress={() => router.push('/schedules')}
            />
          </View>
        </ScrollView>
      </SafeAreaView>
      <EdgeSwipeBack onBack={() => router.back()} />
    </View>
  );
}

function LinkRow({
  symbol,
  title,
  onPress,
  disabled,
}: {
  symbol: SFSymbol;
  title: string;
  onPress: () => void;
  // Greyed-out + non-interactive (feature not wired yet), matching Home's NavRow.
  disabled?: boolean;
}) {
  return (
    <Pressable style={[styles.linkRow, disabled && styles.linkRowDisabled]} onPress={onPress} disabled={disabled}>
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


  // mark, not a gap in the bar).


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
  linkRowDisabled: {
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
  linkTitle: {
    flex: 1,
    fontSize: 19,
    fontWeight: '600',
    color: 'white',
  },
});
