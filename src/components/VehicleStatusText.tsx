import { ActivityIndicator, Pressable, StyleSheet, Text, View } from 'react-native';

// The Home status line, painted to the official app's recovered geometry.
// Source: docs/superpowers/research/tesla-status-visual-FINDINGS.md §1–§3
// (`VehicleStatusText` #117231). Display rules live in the pure, node-tested
// src/ble/vehicleStatusText.ts — this only renders the result.
//
// Deliberate deviations, both forced (findings §8):
//  - The spinner is RN's ActivityIndicator, not Tesla's 18px mini_spinner.png
//    rotating at 900ms/turn — we don't have their asset. Sized to their 18.
//  - `theme.textColorLight` (their status colour) is a theme accessor whose hex
//    the RE could not resolve, so we keep our existing muted white.

// Findings §2: the status label is TextCategory.BodyLabel — 14/20/'500'/0.1.
const TEXT_COLOR = 'rgba(255,255,255,0.45)';
const SPINNER_SIZE = 18;

export function VehicleStatusText({
  text,
  spinner,
  onPress,
}: {
  // null renders nothing at all (findings §1.2: zero nodes, not an empty Text).
  text: string | null;
  spinner: boolean;
  // Tapping the status line wakes the car (findings §6: onStatusPress #117253
  // -> vehicleWakeUp(vin, TAP_STATUS_TEXT)). Omitted when there's no real link.
  onPress?: () => void;
}) {
  if (text === null) return null;

  const body = (
    <View style={styles.container}>
      {spinner ? (
        <View style={styles.spinner}>
          <ActivityIndicator size="small" color={TEXT_COLOR} />
        </View>
      ) : null}
      <Text style={styles.text}>{text}</Text>
    </View>
  );

  if (!onPress) return body;
  return (
    <Pressable onPress={onPress} hitSlop={8}>
      {body}
    </Pressable>
  );
}

const styles = StyleSheet.create({
  // findings §2: statusTextContainer = row / align-center.
  container: {
    flexDirection: 'row',
    alignItems: 'center',
  },
  // findings §2: the spinner wrapper's only style is marginRight: Gutter*0.5.
  spinner: {
    marginRight: 5,
    width: SPINNER_SIZE,
    height: SPINNER_SIZE,
    alignItems: 'center',
    justifyContent: 'center',
  },
  text: {
    fontSize: 14,
    lineHeight: 20,
    fontWeight: '500',
    letterSpacing: 0.1,
    color: TEXT_COLOR,
  },
});
