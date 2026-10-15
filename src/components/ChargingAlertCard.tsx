import { useEffect, useState } from 'react';
import { Pressable, StyleSheet, Text, View } from 'react-native';

import { AppIcon } from '@/icons/AppIcon';
import { TeslaFonts } from '@/constants/fonts';
import { controlHaptic } from '@/state/controlHaptic';
import type { ChargeRestartStatus } from '@/ble/chargeRestart';
import type { ChargingAlertInfo } from '@/types/vehicleTypes';
import { alertCardText, chargeRestartPhaseText } from './chargingAlertCardText';

// ChargingAlertCard — our take on Tesla's `DynamicRowTypes.ChargingAlerts` row, which sits
// ABOVE the Charging row on Home (VehicleChargingAlertsRow: warning/info glyph, title,
// remedy line, tap → owner's manual). We cannot open the manual air-gapped, so the tap
// target is the thing the row exists for here: Restart Charging — the software re-plug
// (ble/chargeRestart.ts), with its progress on the line below the remedy while it runs.
//
// Text face = the charge panel's (BodyLabel 14/20/0.1, Universal Sans Medium); geometry =
// ChargeCard's card (bg #222324, radius 5, 15pt inset). Same 10pt Gutter.
const GUTTER = 10;
const PANEL_BG = '#222324';
const PAGE_BG = '#000000';
const TEXT = '#F3F3F3';
const TEXT_LIGHT = '#8A8B8B';
const WARNING = '#E8B84A';

export function ChargingAlertCard({
  alerts,
  chargingState,
  restart,
  onRestart,
  onCancel,
}: {
  alerts: readonly ChargingAlertInfo[];
  chargingState: string | null;
  restart: ChargeRestartStatus;
  onRestart: () => void;
  onCancel: () => void;
}) {
  const { title, body, warning } = alertCardText(alerts, chargingState);
  // A 1s clock only while a run is live, so the countdown moves. The interval is the sole
  // writer (no synchronous set in the effect); the first tick corrects the mount-time value.
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    if (!restart.running) return;
    const id = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(id);
  }, [restart.running]);
  const phase = chargeRestartPhaseText(restart, now);
  const verdict =
    !restart.running && restart.result
      ? restart.result.ok
        ? 'Charging again'
        : 'Could not restart — see the message above'
      : null;

  return (
    <View style={styles.card}>
      <View style={styles.row}>
        <AppIcon icon={warning ? 'warning-filled' : 'info-filled'} color={warning ? WARNING : TEXT_LIGHT} size={22} />
        <View style={styles.texts}>
          <Text style={[styles.title, warning && styles.titleWarning]} numberOfLines={2}>
            {title}
          </Text>
          <Text style={styles.body} numberOfLines={3}>
            {body}
          </Text>
          {phase ? (
            <Text style={styles.phase} numberOfLines={1}>
              {phase} · keep the app open
            </Text>
          ) : verdict ? (
            <Text style={styles.phase} numberOfLines={1}>
              {verdict}
            </Text>
          ) : null}
        </View>
      </View>
      <View style={styles.divider} />
      <View style={styles.controls}>
        {restart.running ? <CardButton label="Cancel" onPress={onCancel} /> : <CardButton label="Restart Charging" onPress={onRestart} />}
      </View>
    </View>
  );
}

function CardButton({ label, onPress }: { label: string; onPress: () => void }) {
  return (
    <Pressable
      onPress={() => {
        controlHaptic();
        onPress();
      }}
      style={({ pressed }) => [styles.button, pressed && styles.buttonPressed]}
    >
      <Text style={styles.buttonText}>{label}</Text>
    </Pressable>
  );
}

const styles = StyleSheet.create({
  card: {
    backgroundColor: PANEL_BG,
    borderRadius: 0.5 * GUTTER,
    marginBottom: GUTTER,
    paddingTop: 1.5 * GUTTER,
    opacity: 0.95,
  },
  row: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    marginHorizontal: 1.5 * GUTTER,
    marginBottom: GUTTER,
    gap: GUTTER,
  },
  texts: { flex: 1 },
  title: { fontFamily: TeslaFonts.medium, fontSize: 14, lineHeight: 20, letterSpacing: 0.1, color: TEXT },
  titleWarning: { color: WARNING },
  body: { fontFamily: TeslaFonts.medium, fontSize: 12, lineHeight: 16, letterSpacing: 0.1, color: TEXT_LIGHT, marginTop: 2 },
  phase: { fontFamily: TeslaFonts.medium, fontSize: 12, lineHeight: 16, letterSpacing: 0.1, color: TEXT, marginTop: 0.5 * GUTTER },
  divider: { height: 1, backgroundColor: PAGE_BG },
  controls: { flexDirection: 'row' },
  button: { flex: 1, minHeight: 46, paddingVertical: 13, alignItems: 'center', justifyContent: 'center' },
  buttonPressed: { opacity: 0.6 },
  buttonText: { fontFamily: TeslaFonts.medium, fontSize: 14, lineHeight: 20, letterSpacing: 0.1, color: TEXT_LIGHT, textAlign: 'center' },
});
