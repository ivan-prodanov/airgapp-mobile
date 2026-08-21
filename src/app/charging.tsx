import { useEffect, useRef, useState } from 'react';
import { Pressable, ScrollView, StyleSheet, Text, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import * as Haptics from 'expo-haptics';
import { useRouter } from 'expo-router';

import { AppIcon, type IconRef } from '@/icons/AppIcon';
import { EdgeSwipeBack } from '@/components/EdgeSwipeBack';
import { Toggle } from '@/components/Toggle';
import { BusyIcon } from '@/components/BusyIcon';
import { AMP_MAX, AMP_MIN } from '@/state/fleet';
import { controlHaptic } from '@/state/controlHaptic';
import { useCarLinkStatus, useVehicle } from '@/state/VehicleProvider';
import { ChargeCard, CHARGE_CARD_SCREEN_INSET } from '@/components/ChargeCard';
import { TeslaFonts } from '@/constants/fonts';
import type { VehicleStateKey } from '@/types/vehicleTypes';


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
  // Same in-flight signal the Security screen uses: each toggle's command claims
  // its state key (see reconcile.ts), so pending membership swaps the switch for a
  // spinner while the write is unresolved. Shared status context — no 2nd BLE link.
  const carLink = useCarLinkStatus();
  const pendingFor = (key: VehicleStateKey) => carLink.pending.has(key);

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

  // Both settings toggles below flip optimistically through actions.toggle — the
  // reconciler maps each key to its SET command (lowPowerMode / keepAccessoryPower),
  // so they inherit the same optimistic-mirror + rollback path as every other
  // control. Both are ALSO read back from ChargeState (191 / 194) on the charge
  // poll and cached, so a restart shows the car's real value, like sentry.
  const toggle = (key: VehicleStateKey) => {
    controlHaptic();
    actions.toggle(key);
  };

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
            <AppIcon icon="chevron-270" color="white" size={22} />
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
              onUnlockChargePort={actions.unlockChargePort}
            />
          </View>

          <View style={styles.list}>
            <LinkRow
              symbol="charging-toggle"
              title="Find Chargers"
              onPress={() => router.push({ pathname: '/location', params: { tab: 'charging' } })}
            />
            <LinkRow
              symbol="schedule-charge"
              title="Schedule Charging"
              onPress={() => router.push('/schedules')}
            />
          </View>

          {/* Settings group — a full-width separator, then the two energy toggles,
              matching the Tesla Charging page's sectioning below the quick links. */}
          <View style={styles.settings}>
            <Divider />
            <SettingToggleRow
              title="Low Power Mode"
              subtitle="Disables energy consuming features when you are not in the vehicle"
              value={state.lowPowerMode}
              onToggle={() => toggle('lowPowerMode')}
              pending={pendingFor('lowPowerMode')}
            />
            <SettingToggleRow
              title="Keep Accessory Power On"
              subtitle="Power remains active after exit. Vehicle consumes additional energy even without connected devices."
              value={state.keepAccessoryPower}
              onToggle={() => toggle('keepAccessoryPower')}
              pending={pendingFor('keepAccessoryPower')}
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
  symbol: IconRef;
  title: string;
  onPress: () => void;
  // Greyed-out + non-interactive (feature not wired yet), matching Home's NavRow.
  disabled?: boolean;
}) {
  return (
    <Pressable style={[styles.linkRow, disabled && styles.linkRowDisabled]} onPress={onPress} disabled={disabled}>
      <View style={styles.badge}>
        <AppIcon icon={symbol} color="white" size={20} />
      </View>
      <Text style={styles.linkTitle}>{title}</Text>
      <AppIcon icon="chevron-90" color="rgba(255,255,255,0.4)" size={16} />
    </Pressable>
  );
}

// The Tesla design-system <Divider> (component @1431035): height 1 / width 100% in
// the dark-theme dividerColor #2D2E2F at opacity 0.5. Content-width here (the
// screenshot shows it inset by the page gutter), so no negative margin.
function Divider() {
  return <View style={styles.divider} />;
}

// A settings toggle row: no leading icon (unlike the Security page's ToggleRow),
// the title carries an inline info glyph, a two-line caption sits below, and the
// switch is right-aligned. Geometry + typography come from the same design-system
// RowWithSwitch spec the Security screen uses (minHeight 7*Gutter=70, BodyLabel
// title, CaptionLabel subtitle at 0.5 opacity, UniversalSans-Medium).
function SettingToggleRow({
  title,
  subtitle,
  value,
  onToggle,
  pending,
}: {
  title: string;
  subtitle: string;
  value: boolean;
  onToggle: () => void;
  // While this row's command is in flight, the switch is replaced by a spinner in
  // place — the same behaviour as the Security screen's ToggleRow (Sentry mid-write
  // shows the spinner where the switch was).
  pending?: boolean;
}) {
  return (
    <View style={styles.toggleRow}>
      <View style={styles.toggleText}>
        <View style={styles.titleRow}>
          <Text style={styles.rowTitle}>{title}</Text>
          <AppIcon icon="info-small" color="rgba(255,255,255,0.4)" size={15} />
        </View>
        <Text style={styles.rowSub}>{subtitle}</Text>
      </View>
      <View style={styles.toggleSlot} pointerEvents={pending ? 'none' : 'auto'}>
        {pending ? <BusyIcon size={28} /> : <Toggle value={value} onToggle={onToggle} />}
      </View>
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

  // Settings group below the quick links: separator + the two energy toggles.
  settings: {
    // marginTop cancels the scroll's gap:20 above this group so the separator
    // sits a touch closer to the links, then Divider owns the rest of the rhythm.
    marginTop: -4,
  },
  // See <Divider>: dark-theme dividerColor #2D2E2F @0.5, height 1. marginVertical
  // gives the generous breathing room the Tesla page keeps around the separator.
  divider: {
    height: 1,
    backgroundColor: '#2D2E2F',
    opacity: 0.5,
    marginVertical: 12,
  },
  toggleRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
    // Tesla's rowContainer holds minHeight = 7 * Gutter = 70 with content centred
    // (no paddingVertical); a two-line caption grows the row past 70 flush.
    minHeight: 70,
  },
  toggleText: {
    flex: 1,
    gap: 2,
  },
  titleRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
  },
  // RowWithSwitch title = BodyLabel (14/20/ls0.1), subtitle = CaptionLabel
  // (12/16/ls0.1), both UniversalSans-Medium (weight baked into the cut — no
  // fontWeight). Identical to the Security screen's rows.
  rowTitle: {
    fontFamily: TeslaFonts.medium,
    fontSize: 14,
    lineHeight: 20,
    letterSpacing: 0.1,
    color: 'white',
  },
  rowSub: {
    fontFamily: TeslaFonts.medium,
    fontSize: 12,
    lineHeight: 16,
    letterSpacing: 0.1,
    color: 'rgba(255,255,255,0.5)',
  },
  // Footprint of the Toggle (51×31) so the switch stays put regardless of caption
  // height.
  toggleSlot: {
    width: 51,
    height: 31,
    alignItems: 'center',
    justifyContent: 'center',
  },
});
