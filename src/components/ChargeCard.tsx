import { Pressable, StyleSheet, Text, View } from 'react-native';
import { SymbolView, type SFSymbol } from 'expo-symbols';

import { TeslaFonts } from '@/constants/fonts';
import { controlHaptic } from '@/state/controlHaptic';
import { ChargeLimitSlider } from './ChargeLimitSlider';

// ChargeCard — the home-screen charging panel.
//
// Recovered, see docs/superpowers/research/tesla-charge-row-FINDINGS.md. It is
// `DynamicRowTypes.Charging`, a SIBLING of `MediaControl` in the same row list
// below favourites:
//
//     ChargingAlerts   30 * Gutter = 300
//     Charging         30 * Gutter = 300      <- this
//     MediaControl     14 * Gutter = 140      <- the media card, two 70pt panels
//
// The 140 is a useful cross-check: it independently confirms the media card's
// two-panel structure from a second place in their code.
//
// Chain: dynamic-row switch -> VehicleChargeRow (container) -> ChargeRow
// (presentational). The conditional logic is `chargeRowStateSelector`, which
// returns {chargeLimit, defaultChargeToMax, range, scheduledChargingText,
// dischargeLimit, dischargeLimitSocRange} off getSelectedVehicleIsPluggedIn /
// ChargePortOpen / isChargingSelector / getIsChargeStopped /
// getDisplayStartButtonSelector / sliderMax / sliderSnapPoints.
//
// DELIBERATELY OMITTED, not stubbed (Ivan's call): powershare / V2H
// (dischargeLimit, StopRestartPowershareButton), Semi, supercharger session and
// billing, ReportIssueButton. None of it applies to this car and none of it is
// reachable over BLE, so a placeholder would be a lie about a capability.
const GUTTER = 10;
const PANEL_H = 30 * GUTTER; // 300 — their `Charging` row height
const PANEL_RADIUS = 0.5 * GUTTER;
const PANEL_BG = '#222324';
const TEXT = '#F3F3F3';
const TEXT_LIGHT = '#8A8B8B';
const TEXT_WARNING = '#DAA300';
const CHARGING_GREEN = '#00E286'; // Colors.batteryCharging

// Their slider is `sliderMax` + `sliderSnapPoints`. The car supplies the real
// bounds (charge_limit_soc_min/max/std); these are the fallbacks for a car that
// has not reported them yet, NOT hardcoded truth.
const LIMIT_MIN = 50;
const LIMIT_MAX = 100;

export interface ChargeCardProps {
  batteryLevel: number | null;
  rangeMiles: number | null;
  chargeLimitPercent: number;
  chargingState: string | null;
  charging: boolean;
  chargePortOpen: boolean;
  cableAttached: boolean;
  minutesToChargeLimit: number | null;
  chargerPowerKw: number | null;
  chargeRateMph: number | null;
  chargingAmps: number;
  ampMin: number;
  ampMax: number;
  useMiles: boolean;
  onSetChargeLimit: (percent: number) => void;
  onSetAmps: (amps: number) => void;
  /** Lets Home freeze its ScrollView while the slider drag owns the touch. */
  onSlidingChange?: (sliding: boolean) => void;
  onStartStopCharging: (start: boolean) => void;
  onToggleChargePort: (open: boolean) => void;
}

// The car's ChargingState oneof name -> the headline. Their panel distinguishes
// these; `charging` (a boolean) collapses them, which is why the raw name is
// plumbed through telemetry alongside it.
function headline(chargingState: string | null, cableAttached: boolean): string {
  switch ((chargingState ?? '').toLowerCase()) {
    case 'charging':
      return 'Charging';
    case 'complete':
      return 'Charge Complete';
    case 'stopped':
      return 'Charging Stopped';
    case 'starting':
      return 'Starting to Charge';
    case 'nopower':
      return 'No Power';
    case 'calibrating':
      return 'Calibrating';
    case 'disconnected':
      return cableAttached ? 'Cable Connected' : 'Not Charging';
    default:
      return cableAttached ? 'Cable Connected' : 'Not Charging';
  }
}

// "1 hr 24 min" / "24 min". Null when the car does not report it, which is
// normal unplugged — the line is omitted rather than showing 0.
function remainingText(minutes: number | null): string | null {
  if (minutes == null || minutes <= 0) return null;
  const h = Math.floor(minutes / 60);
  const m = Math.round(minutes % 60);
  if (h === 0) return `${m} min remaining`;
  if (m === 0) return `${h} hr remaining`;
  return `${h} hr ${m} min remaining`;
}

export function ChargeCard({
  batteryLevel,
  rangeMiles,
  chargeLimitPercent,
  chargingState,
  charging,
  chargePortOpen,
  cableAttached,
  minutesToChargeLimit,
  chargerPowerKw,
  chargeRateMph,
  useMiles,
  chargingAmps,
  ampMin,
  ampMax,
  onSetChargeLimit,
  onSetAmps,
  onSlidingChange,
  onStartStopCharging,
  onToggleChargePort,
}: ChargeCardProps) {

  const remaining = remainingText(minutesToChargeLimit);
  const range =
    rangeMiles == null ? null : `${Math.round(useMiles ? rangeMiles : rangeMiles * 1.609344)} ${useMiles ? 'mi' : 'km'}`;
  // Rate line: kW is what the car reports while actually delivering current, so
  // it is shown only while charging — a stale "11 kW" on a finished charge would
  // read as still going.
  const rate =
    charging && chargerPowerKw != null && chargerPowerKw > 0
      ? `${chargerPowerKw.toFixed(chargerPowerKw < 10 ? 1 : 0)} kW`
      : null;
  const addedRate =
    charging && chargeRateMph != null && chargeRateMph > 0
      ? `${Math.round(useMiles ? chargeRateMph : chargeRateMph * 1.609344)} ${useMiles ? 'mph' : 'km/h'}`
      : null;

  return (
    <View style={styles.card}>
      {/* headerContainer { flexDirection: 'row' } + headerMain { flex: 1 } */}
      <View style={styles.header}>
        <Text
          style={[
            styles.headline,
            charging ? { color: CHARGING_GREEN } : null,
            (chargingState ?? '').toLowerCase() === 'stopped' || (chargingState ?? '').toLowerCase() === 'nopower'
              ? { color: TEXT_WARNING }
              : null,
          ]}
          numberOfLines={1}
        >
          {headline(chargingState, cableAttached)}
        </Text>
        <Text style={styles.headlineRight} numberOfLines={1}>
          {batteryLevel == null ? '--' : `${Math.round(batteryLevel)}%`}
          {range ? `  ·  ${range}` : ''}
        </Text>
      </View>

      {/* Charge limit reads as its own line, like app/charging.tsx's
          "Charge limit: 80%", rather than a caption under the track. */}
      <View style={styles.limitRow}>
        <Text style={styles.limitLabel}>Charge limit: {Math.round(chargeLimitPercent)}%</Text>
      </View>

      {/* `statusText` sits directly under the header and ABOVE the slider — my
          first cut had it after the slider, which is what Ivan flagged as "not
          on the right position". Omitted entirely when the car reports nothing,
          so the layout does not keep a blank line. */}
      {remaining || rate || addedRate ? (
        <Text style={styles.statusText} numberOfLines={1}>
          {[remaining, rate, addedRate].filter(Boolean).join('  ·  ')}
        </Text>
      ) : null}

      {/* sliderContainer + targetSlider { overflow:'visible', width:'100%' }.
          Their slider takes usablePercentageCharged AND nominalPercentageCharged
          as SEPARATE fills, `target` as the thumb, plus snapPercentageLocations
          and a defaultChargeToMaxMarker. We have one SoC, so one fill — the
          nominal/usable split needs fields we do not read yet. */}
      <View style={styles.sliderContainer}>
        {/* The SAME control as app/charging.tsx — normal/changing states, the
            detent breaks that appear only while changing, and the growing thumb.
            Ivan: use ours and polish it, not a second one. */}
        <ChargeLimitSlider
          batteryPercent={batteryLevel}
          limitPercent={chargeLimitPercent}
          min={LIMIT_MIN}
          max={LIMIT_MAX}
          onChange={onSetChargeLimit}
          onSlidingChange={onSlidingChange}
        />
      </View>

      {/* Amperage. Ivan: "some of the states should have a way to change the
          amperage." Shown only with a cable in — the car rejects it otherwise,
          and a stepper that cannot work is worse than no stepper. */}
      {cableAttached ? (
        <View style={styles.ampRow}>
          <Text style={styles.ampLabel}>Amps</Text>
          <View style={styles.ampStepper}>
            <StepButton symbol="minus" disabled={chargingAmps <= ampMin} onPress={() => onSetAmps(chargingAmps - 1)} />
            <Text style={styles.ampValue}>{chargingAmps} A</Text>
            <StepButton symbol="plus" disabled={chargingAmps >= ampMax} onPress={() => onSetAmps(chargingAmps + 1)} />
          </View>
        </View>
      ) : null}

      {/* controlsDivider { height: 1, width: '100%' } then
          controlButtonContainer { flexDirection:'row', justifyContent:'space-evenly' }.
          My first cut had a short vertical rule BETWEEN the buttons; theirs is a
          full-width horizontal rule ABOVE them. */}
      <View style={styles.controlsDivider} />
      <View style={styles.controls}>
        <ChargeButton
          symbol={charging ? 'stop.fill' : 'bolt.fill'}
          label={charging ? 'Stop' : 'Start'}
          disabled={!cableAttached}
          onPress={() => onStartStopCharging(!charging)}
        />
        <ChargeButton
          symbol={chargePortOpen ? 'xmark' : 'chevron.up'}
          label={chargePortOpen ? 'Close Port' : 'Open Port'}
          disabled={chargePortOpen && cableAttached}
          onPress={() => onToggleChargePort(!chargePortOpen)}
        />
      </View>
    </View>
  );
}

function StepButton({ symbol, disabled, onPress }: { symbol: SFSymbol; disabled: boolean; onPress: () => void }) {
  return (
    <Pressable
      hitSlop={10}
      disabled={disabled}
      onPress={() => {
        controlHaptic();
        onPress();
      }}
      style={({ pressed }) => [styles.stepButton, { opacity: disabled ? 0.3 : pressed ? 0.5 : 1 }]}
    >
      <SymbolView name={symbol} tintColor={TEXT} size={14} />
    </Pressable>
  );
}

function ChargeButton({
  symbol,
  label,
  disabled,
  onPress,
}: {
  symbol: SFSymbol;
  label: string;
  disabled: boolean;
  onPress: () => void;
}) {
  return (
    <Pressable
      style={({ pressed }) => [styles.controlButton, { opacity: disabled ? 0.35 : pressed ? 0.5 : 1 }]}
      disabled={disabled}
      onPress={() => {
        controlHaptic();
        onPress();
      }}
    >
      <SymbolView name={symbol} tintColor={TEXT} size={20} />
      <Text style={styles.controlLabel} numberOfLines={1}>
        {label}
      </Text>
    </Pressable>
  );
}

const styles = StyleSheet.create({
  card: {
    height: PANEL_H,
    backgroundColor: PANEL_BG,
    borderRadius: PANEL_RADIUS,
    marginBottom: 8,
    paddingHorizontal: 18,
    paddingVertical: 18,
    justifyContent: 'space-between',
  },
  header: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
  },
  // TextCategory.BodyLabel, the same 14/20/0.1 the rest of the recovered UI uses.
  headline: {
    fontFamily: TeslaFonts.medium,
    fontSize: 14,
    lineHeight: 20,
    letterSpacing: 0.1,
    color: TEXT,
    flexShrink: 1,
  },
  headlineRight: {
    fontFamily: TeslaFonts.medium,
    fontSize: 14,
    lineHeight: 20,
    letterSpacing: 0.1,
    color: TEXT_LIGHT,
    marginLeft: 12,
  },
  sliderContainer: {
    alignSelf: 'stretch',
    marginVertical: 2,
  },




  statusText: {
    fontFamily: TeslaFonts.medium,
    fontSize: 12,
    lineHeight: 16,
    letterSpacing: 0.1,
    color: TEXT_LIGHT,
  },
  // controlsDivider { backgroundColor, height: 1, width: '100%' }
  controlsDivider: {
    height: 1,
    width: '100%',
    backgroundColor: 'rgba(255,255,255,0.12)',
  },
  // controlButtonContainer — space-evenly, not a divider between two halves.
  controls: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-evenly',
    width: '100%',
  },
  limitRow: {
    flexDirection: 'row',
  },
  limitLabel: {
    fontFamily: TeslaFonts.medium,
    fontSize: 14,
    lineHeight: 20,
    letterSpacing: 0.1,
    color: TEXT,
  },
  ampLabel: {
    fontFamily: TeslaFonts.medium,
    fontSize: 12,
    lineHeight: 16,
    letterSpacing: 0.1,
    color: TEXT_LIGHT,
  },
  ampRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
  },
  ampStepper: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 14,
  },
  ampValue: {
    fontFamily: TeslaFonts.medium,
    fontSize: 14,
    lineHeight: 20,
    letterSpacing: 0.1,
    color: TEXT,
    minWidth: 44,
    textAlign: 'center',
  },
  stepButton: {
    width: 26,
    height: 26,
    borderRadius: 13,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: 'rgba(255,255,255,0.10)',
  },
  controlButton: {
    flex: 1,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 8,
    height: 44,
  },
  controlLabel: {
    fontFamily: TeslaFonts.medium,
    fontSize: 14,
    lineHeight: 20,
    letterSpacing: 0.1,
    color: TEXT,
  },
});
