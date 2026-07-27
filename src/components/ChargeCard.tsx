import { useMemo, useState } from 'react';
import { PanResponder, Pressable, StyleSheet, Text, View } from 'react-native';
import { SymbolView, type SFSymbol } from 'expo-symbols';

import { TeslaFonts } from '@/constants/fonts';
import { controlHaptic } from '@/state/controlHaptic';

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
  useMiles: boolean;
  onSetChargeLimit: (percent: number) => void;
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
  onSetChargeLimit,
  onStartStopCharging,
  onToggleChargePort,
}: ChargeCardProps) {
  // Local slider position so the thumb tracks the finger. It is NOT the source
  // of truth — the car is — so it drops back to the car's value the moment the
  // car reports a new limit.
  //
  // Re-synced with React's documented "adjust state when a prop changes"
  // pattern (compare against the previous value DURING render) rather than an
  // effect. An effect would commit a render with the stale thumb and then a
  // second one to correct it, which on a slider is a visible snap-back.
  const [dragPercent, setDragPercent] = useState<number | null>(null);
  const [trackWidth, setTrackWidth] = useState(0);
  const [prevLimit, setPrevLimit] = useState(chargeLimitPercent);
  if (chargeLimitPercent !== prevLimit) {
    setPrevLimit(chargeLimitPercent);
    setDragPercent(null);
  }
  const shown = dragPercent ?? chargeLimitPercent;

  // PanResponder, not react-native-gesture-handler: RNGH is INERT inside the
  // native tab container this screen lives in — a known trap in this project,
  // and the reason every other drag here is a PanResponder too.
  //
  // Rebuilt when the measured width changes, since the x -> percent mapping
  // depends on it; useMemo rather than a ref so nothing reads `.current` during
  // render.
  const pan = useMemo(() => {
    const fromX = (x: number): number => {
      const w = trackWidth || 1;
      return LIMIT_MIN + (Math.max(0, Math.min(w, x)) / w) * (LIMIT_MAX - LIMIT_MIN);
    };
    const commit = (pct: number) => {
      const clamped = Math.max(LIMIT_MIN, Math.min(LIMIT_MAX, Math.round(pct)));
      setDragPercent(clamped);
      onSetChargeLimit(clamped);
    };
    return PanResponder.create({
      onStartShouldSetPanResponder: () => true,
      onMoveShouldSetPanResponder: () => true,
      onPanResponderGrant: (e) => {
        controlHaptic();
        setDragPercent(Math.round(fromX(e.nativeEvent.locationX)));
      },
      onPanResponderMove: (e) => setDragPercent(Math.round(fromX(e.nativeEvent.locationX))),
      onPanResponderRelease: (e) => commit(fromX(e.nativeEvent.locationX)),
      onPanResponderTerminate: () => setDragPercent(null),
    });
  }, [trackWidth, onSetChargeLimit]);

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
      {/* Headline + the live numbers. Colour follows the state: their palette
          uses batteryCharging (#00E286) while current flows, textColorWarning
          for a stopped/no-power charge, and plain text otherwise. */}
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

      {/* Charge-limit slider. Their `sliderSnapPoints` land on whole percent;
          the fill shows the CURRENT charge and the thumb the LIMIT, which is why
          the two are drawn from different values rather than one. */}
      <View style={styles.sliderBlock}>
        <View
          style={styles.track}
          onLayout={(e) => setTrackWidth(e.nativeEvent.layout.width)}
          {...pan.panHandlers}
        >
          <View
            style={[
              styles.trackFill,
              {
                width: `${Math.max(0, Math.min(100, ((batteryLevel ?? 0) - LIMIT_MIN) / (LIMIT_MAX - LIMIT_MIN) * 100))}%`,
                backgroundColor: charging ? CHARGING_GREEN : TEXT_LIGHT,
              },
            ]}
          />
          <View
            style={[
              styles.thumb,
              { left: `${((shown - LIMIT_MIN) / (LIMIT_MAX - LIMIT_MIN)) * 100}%` },
            ]}
          />
        </View>
        <View style={styles.sliderLabels}>
          <Text style={styles.sliderCaption}>Charge Limit</Text>
          <Text style={styles.sliderValue}>{Math.round(shown)}%</Text>
        </View>
      </View>

      {/* Their `scheduledChargingText` slot. We have no scheduled-charging read,
          so this line carries the live facts instead — time remaining and rate —
          and disappears entirely when the car reports none. No placeholder. */}
      {remaining || rate || addedRate ? (
        <Text style={styles.detail} numberOfLines={1}>
          {[remaining, rate, addedRate].filter(Boolean).join('  ·  ')}
        </Text>
      ) : null}

      {/* ControlButtons — their StartStopChargingButton + OpenCloseChargePortButton. */}
      <View style={styles.controls}>
        <ChargeButton
          symbol={charging ? 'stop.fill' : 'bolt.fill'}
          label={charging ? 'Stop' : 'Start'}
          // The car only takes start/stop with a cable in. Disabled rather than
          // hidden, so the row does not reflow when you plug in.
          disabled={!cableAttached}
          onPress={() => onStartStopCharging(!charging)}
        />
        <View style={styles.controlDivider} />
        <ChargeButton
          symbol={chargePortOpen ? 'xmark' : 'chevron.up'}
          label={chargePortOpen ? 'Close Port' : 'Open Port'}
          // Closing the port with the cable still latched is refused by the car.
          disabled={chargePortOpen && cableAttached}
          onPress={() => onToggleChargePort(!chargePortOpen)}
        />
      </View>
    </View>
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
  sliderBlock: {
    marginVertical: 4,
  },
  track: {
    height: 28,
    justifyContent: 'center',
  },
  trackFill: {
    position: 'absolute',
    left: 0,
    height: 6,
    borderRadius: 3,
  },
  thumb: {
    position: 'absolute',
    width: 14,
    height: 28,
    marginLeft: -7,
    borderRadius: 4,
    backgroundColor: TEXT,
  },
  sliderLabels: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    marginTop: 6,
  },
  sliderCaption: {
    fontFamily: TeslaFonts.medium,
    fontSize: 12,
    lineHeight: 16,
    letterSpacing: 0.1,
    color: TEXT_LIGHT,
  },
  sliderValue: {
    fontFamily: TeslaFonts.medium,
    fontSize: 12,
    lineHeight: 16,
    letterSpacing: 0.1,
    color: TEXT,
  },
  // CaptionLabel — 12/16/0.1 in textColorLight, same as the tyre subtitle.
  detail: {
    fontFamily: TeslaFonts.medium,
    fontSize: 12,
    lineHeight: 16,
    letterSpacing: 0.1,
    color: TEXT_LIGHT,
  },
  controls: {
    flexDirection: 'row',
    alignItems: 'center',
  },
  controlButton: {
    flex: 1,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 8,
    height: 44,
  },
  controlDivider: {
    width: 1,
    height: 24,
    backgroundColor: 'rgba(255,255,255,0.15)',
  },
  controlLabel: {
    fontFamily: TeslaFonts.medium,
    fontSize: 14,
    lineHeight: 20,
    letterSpacing: 0.1,
    color: TEXT,
  },
});
