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
  transport = null,
  live = false,
  subtext = null,
}: {
  // null renders nothing at all (findings §A: empty text = zero nodes).
  text: string | null;
  spinner: boolean;
  // Tapping the status line wakes the car (findings §C1: the whole row is a
  // TouchableOpacity -> vehicleWakeUp(vin, TAP_STATUS_TEXT)).
  onPress?: () => void;
  // Dev-only cue for which transport served the last read (blue = direct BLE,
  // amber = Pi forwarder). Deliberately tiny/muted — a glanceable diagnostic,
  // not a user-facing feature. null (not connected) shows nothing.
  transport?: 'ble' | 'pi' | null;
  // Whether a live PUSH channel is active (BLE native notify, or the Pi WS
  // stream) vs poll-only. BRIGHT dot = live pushes; DIM dot = 20s polling only.
  live?: boolean;
  // Optional second line, rendered BLUE beneath the status — the slot the official
  // app uses for its Autopilot label ("Samodzielna jazda"). Ours says "Driving",
  // which we can actually prove from the gear; Autopilot state is not on the BLE
  // protos at all (RESPONSE-17).
  subtext?: string | null;
}) {
  if (text === null) return null;

  const row = (
    <View style={styles.container}>
      {spinner ? (
        <View style={styles.spinner}>
          <BusyIcon />
        </View>
      ) : null}
      <Text style={styles.text}>{text}</Text>
      {transport ? (
        <View
          style={[
            styles.txpDot,
            transport === 'pi' ? styles.txpPi : styles.txpBle,
            live ? styles.txpLive : styles.txpPoll,
          ]}
        />
      ) : null}
    </View>
  );

  const body = subtext ? (
    <View>
      {row}
      <Text style={styles.subtext}>{subtext}</Text>
    </View>
  ) : (
    row
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
  // The blue second line. Same type ramp as the status text so the two read as one
  // block, in Tesla's brand blue (#3E6AE1) — matching the official app's Autopilot
  // label, which occupies this exact slot.
  subtext: {
    fontFamily: TeslaFonts.medium,
    fontSize: 14,
    lineHeight: 20,
    letterSpacing: 0.1,
    color: '#3E6AE1',
  },
  // Transport cue: 5px dot sitting just after the status text. Brightness
  // (opacity) encodes live-push vs poll-only; hue encodes the transport.
  txpDot: {
    width: 5,
    height: 5,
    borderRadius: 2.5,
    marginLeft: 6,
  },
  txpBle: { backgroundColor: '#5B8DB0' }, // direct BLE
  txpPi: { backgroundColor: '#B0895B' }, // Pi forwarder
  txpLive: { opacity: 0.95 }, // live push channel (BLE notify / Pi WS stream)
  txpPoll: { opacity: 0.4 }, // poll-only (20s)
});
