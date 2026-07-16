import { Pressable, StyleSheet, Text, View } from 'react-native';

import { TEXT_COLOR_LIGHT_DARK } from '@/ble/batteryDisplay';
import { TeslaFonts } from '@/constants/fonts';
import { BusyIcon } from './BusyIcon';

// The Home status line, painted to the official app's recovered geometry.
// Source: docs/superpowers/research/tesla-status-assets-FINDINGS.md §C2/§E
// (`VehicleStatusText` #117231). Display rules live in the pure, node-tested
// src/ble/vehicleStatusText.ts — this only renders the result.
//
// The spinner is a structural SIBLING of the text, not part of any one state's
// branch (findings §A) — so it legitimately spins next to "Last seen 2 hours
// ago". Do not re-couple it to a single status string.

export function VehicleStatusText({
  text,
  spinner,
  onPress,
}: {
  // null renders nothing at all (findings §A: empty text = zero nodes).
  text: string | null;
  spinner: boolean;
  // Tapping the status line wakes the car (findings §C1: the whole row is a
  // TouchableOpacity -> vehicleWakeUp(vin, TAP_STATUS_TEXT)).
  onPress?: () => void;
}) {
  if (text === null) return null;

  const body = (
    <View style={styles.container}>
      {spinner ? (
        <View style={styles.spinner}>
          <BusyIcon />
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
  // findings §C2: statusTextContainer = row / center / marginTop 5. (Round 2
  // said 10 — it missed a Mul by 0.5; the real value is 0.5 x Gutter.)
  container: {
    flexDirection: 'row',
    alignItems: 'center',
    marginTop: 5,
  },
  // findings §C2: the spinner wrapper's only style is marginRight Gutter*0.5.
  spinner: {
    marginRight: 5,
  },
  // findings §2a, the resolved iOS style VERBATIM:
  //   { fontFamily:'UniversalSansText-Medium', fontSize:14, lineHeight:20,
  //     letterSpacing:0.1 }   <- note: NO fontWeight (see constants/fonts.ts)
  // plus color = theme.textColorLight = #8A8B8B on the dark header (the muting
  // is baked into the token — no extra opacity on top).
  text: {
    fontFamily: TeslaFonts.medium,
    fontSize: 14,
    lineHeight: 20,
    letterSpacing: 0.1,
    color: TEXT_COLOR_LIGHT_DARK,
  },
});
