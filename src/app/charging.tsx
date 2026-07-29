import { useEffect, useRef, useState } from 'react';
import { Pressable, ScrollView, StyleSheet, Text, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import * as Haptics from 'expo-haptics';
import { SymbolView, type SFSymbol } from 'expo-symbols';
import { useRouter } from 'expo-router';

import { EdgeSwipeBack } from '@/components/EdgeSwipeBack';
import { AMP_MAX, AMP_MIN } from '@/state/fleet';
import { useVehicle } from '@/state/VehicleProvider';
import { ChargeCard, CHARGE_CARD_SCREEN_INSET } from '@/components/ChargeCard';


// Charging screen — RN build of the Tesla Charging page. Full opaque page (no car
// behind, matching the app), then quick links. Payment/stats/badges/history rows
// are intentionally omitted (no billing in an air-gapped build).
//
// THE PANEL IS THE HOME PANEL. Ivan: "on the tesla app the Charging tab, isnt
// that panel there the same as the one on the home screen?" It is —
// VehicleChargingHomeScreen @8780606 renders `<VehicleChargeRow />` with NO
// props at all, key 'vehicle_charge_row', the very same component the home
// screen's dynamic row list renders. One component, two mount points.
//
// We had a SECOND implementation here: its own limit label, its own divider, its
// own single port button. Sharing ChargeLimitSlider and AmpStepper hid how far
// the two had drifted — the controls matched while the panel around them did
// not. None of the recovered behaviour reached this screen: no charging-state
// text, no live kW/current/voltage row, no Start/Stop button, no Unlock Charge
// Port, no amp-hiding on DC, and none of the recovered spacing.
export default function ChargingScreen() {
  const router = useRouter();
  const [state, actions] = useVehicle();

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
  // The port button's label used to be decided here — open/close/unlock keyed on
  // `charging`. ChargeCard now owns it, and keys the Unlock variant on the CABLE
  // rather than on charging, which is what ControlButtons actually does: the
  // plugged-in branch renders UnlockChargePortButton whether or not current is
  // flowing.

  return (
    <View style={styles.root}>
      <SafeAreaView edges={['top']} style={styles.safe}>
        <View style={styles.header}>
          <Pressable
            style={styles.back}
            hitSlop={10}
            onPress={() => {
              // Their HeaderButton fires lightHaptic() before navigating; ours had none.
              Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light).catch(() => {});
              router.back();
            }}
          >
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
          {/* The SAME panel as Home. Not styled here: the card brings its own
              recovered geometry, and this screen only positions it. */}
          <View style={styles.chargeCardWrap}>
            <ChargeCard
              batteryLevel={state.batteryLevel}
              rangeMiles={state.rangeMiles}
              chargeLimitPercent={state.chargeLimitPercent}
              chargingState={state.chargingState}
              charging={state.charging}
              chargePortOpen={state.chargePortOpen}
              cableAttached={state.cableAttached}
              minutesToChargeLimit={state.minutesToChargeLimit}
              chargerPowerKw={state.chargerPowerKw}
              chargeRateMph={state.chargeRateMph}
              energyAddedKwh={state.energyAddedKwh}
              fastCharging={state.fastCharging}
              chargerActualCurrentA={state.chargerActualCurrentA}
              chargerVoltageV={state.chargerVoltageV}
              chargerPilotCurrentA={state.chargerPilotCurrentA}
              chargingAmps={state.chargingAmps}
              ampMin={AMP_MIN}
              ampMax={AMP_MAX}
              useMiles={false}
              onSlidingChange={setSliding}
              // Same four callbacks as Home, through actions.patch for the same
              // reason: the reconciler already maps each of these keys to its
              // command, so they inherit the optimistic mirror, the rollback and
              // the grace window instead of needing a second code path.
              onSetChargeLimit={(pct) => actions.patch({ chargeLimitPercent: pct })}
              onSetAmps={(a) => actions.patch({ chargingAmps: a })}
              onStartStopCharging={(start) => actions.patch({ charging: start })}
              onToggleChargePort={(open) => actions.patch({ chargePortOpen: open })}
            />
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
  // The design system's `HeaderButton` / `headerView` (@1871461, @1871606), same
  // as Home, Climate and Controls now use:
  //
  //   { minWidth: 36, minHeight: 36, alignItems: 'center',
  //     justifyContent: 'center', zIndex: 100,
  //     borderRadius: Specifications.borderRadius = 5,
  //     backgroundColor: hideBackgroundView ? transparent
  //                                         : theme.secondaryBackgroundColor }
  //
  // NO PLATE here. Across the whole bundle `hideBackgroundView` is `true` at ten
  // sites, computed at exactly one (climate), and `false` at exactly one —
  // `TransparentHeaderBackButton`. That split is the rule: a button FLOATING over
  // content gets the plate for contrast, one sitting in a SOLID bar does not.
  // This screen is a solid #161618 header, so it is the Controls case.
  //
  // 44 / radius 14 / rgba(60,60,60,0.5) were all ours.
  back: {
    position: 'absolute',
    left: 6,
    minWidth: 36,
    minHeight: 36,
    borderRadius: 5,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: 'transparent',
    zIndex: 100,
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
  // This screen's ScrollView pads 16; the card belongs at
  // CHARGE_CARD_SCREEN_INSET from the screen edge, so it pulls back out. Stated
  // here, not inside ChargeCard — the card must not know either screen exists.
  chargeCardWrap: {
    marginHorizontal: CHARGE_CARD_SCREEN_INSET - 16,
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
