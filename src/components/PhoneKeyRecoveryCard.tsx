// PhoneKeyRecoveryCard — the degraded "Phone Key" row the official app shows on
// Home when the phone key is unusable.
//
// TWO STATES, both rendered IN THIS ROW — no sheet, no modal:
//
//   idle     "Enable passive entry and remote controls"          [Set Up]
//   instruct "Remove '🔑 CHUŠKOPEK' in Settings > Bluetooth …"    [Retry]
//
// Tapping Set Up swaps the subtitle and the button in place. An earlier version
// opened a bottom sheet with a multi-paragraph explainer; the official app never
// leaves the row, and the wall of text read as an error dialog for what is a
// one-line instruction.
//
// The row disappears on its own the moment a BLE connect succeeds (the only
// thing that clears a wedge), so "Retry" does not need to report success — the
// card going away IS the success signal.
//
// Typography matches the rest of the app: the bundled Universal Sans cuts, same
// faces as the battery % and status line. Per constants/fonts.ts, set fontFamily
// and NEVER fontWeight — the weight is baked into the cut, and passing one risks
// a synthesized face.

import { useState } from 'react';
import { Pressable, StyleSheet, Text, View } from 'react-native';

import { bondWedgeInstruction, type RecoveryRemedy } from '@/ble/bondWedge';
import { TeslaFonts } from '@/constants/fonts';
import { AppIcon } from '../icons/AppIcon';

interface Props {
  remedy: RecoveryRemedy;
  // The car's BLUETOOTH name as iOS reports it (e.g. "🔑 CHUŠKOPEK") — NOT the
  // vehicle display name. The user matches this against Settings > Bluetooth by
  // eye, so it has to be the string that list actually shows.
  bleName: string | null;
  onRetry: () => void;
}

export function PhoneKeyRecoveryCard({ remedy, bleName, onRetry }: Props) {
  const [instruct, setInstruct] = useState(false);
  if (remedy === 'none') return null;

  const subtitle = !instruct
    ? 'Enable passive entry and remote controls'
    : remedy === 're-enroll-with-card'
      ? 'Tap your key card on the center console and try again'
      : bondWedgeInstruction(bleName);

  return (
    <View style={styles.card}>
      <View style={styles.icon}>
        <AppIcon icon="smartphone" color="rgba(255,255,255,0.85)" size={28} />
      </View>
      <View style={styles.text}>
        {/* Always "Phone Key" — the official row's title never changes; the
            branch shows up in the subtitle and the button. */}
        <Text style={styles.title}>Phone Key</Text>
        <Text style={styles.subtitle}>{subtitle}</Text>
      </View>
      <Pressable
        style={styles.button}
        hitSlop={6}
        onPress={() => {
          if (!instruct) {
            setInstruct(true);
            return;
          }
          onRetry();
        }}
      >
        <Text style={styles.buttonLabel}>{instruct ? 'Retry' : 'Set Up'}</Text>
      </Pressable>
    </View>
  );
}

const styles = StyleSheet.create({
  // Neutral surface, matching the app's other raised rows — NOT an alert colour.
  card: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 18,
    borderRadius: 14,
    backgroundColor: 'rgba(255,255,255,0.07)',
    paddingHorizontal: 18,
    paddingVertical: 18,
    marginBottom: 14,
  },
  icon: {
    width: 28,
    alignItems: 'center',
  },
  text: {
    flex: 1,
  },
  title: {
    fontFamily: TeslaFonts.bold,
    fontSize: 20,
    color: 'white',
  },
  subtitle: {
    fontFamily: TeslaFonts.medium,
    fontSize: 14,
    lineHeight: 20,
    color: 'rgba(255,255,255,0.45)',
    marginTop: 2,
  },
  button: {
    borderRadius: 8,
    backgroundColor: 'rgba(255,255,255,0.12)',
    paddingHorizontal: 18,
    paddingVertical: 12,
  },
  buttonLabel: {
    fontFamily: TeslaFonts.bold,
    fontSize: 15,
    color: 'white',
  },
});
