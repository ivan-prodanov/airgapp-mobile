// PhoneKeyRecoveryCard — the degraded "Phone Key" row the official app shows on
// Home when the phone key is unusable.
//
// Copies their treatment deliberately: a NEUTRAL card (same grey as the rest of
// the surface), icon + title + subtitle on the left, a "Set Up" pill on the
// right. No warning colour, no border, no expanded prose. The official app does
// not shout — the row's mere presence is the signal, and the actual instructions
// live one tap deeper, behind Set Up. An earlier version of this file used an
// amber alert card, which read as an error state the rest of the app never uses.
//
// What we keep from ours: the SHEET behind Set Up names the real remedy. Tesla
// can only say "Set Up Phone Key" because it cannot see the whitelist through a
// dead BLE link; we read it over the Pi, so we can say "forget the device" (no
// key card, no unlocked car) versus "tap your key card" — which are opposite
// actions. Same subtle surface, better routing.

import { useState } from 'react';
import { Pressable, StyleSheet, Text, View } from 'react-native';
import { SymbolView } from 'expo-symbols';

import { bondWedgeBody, type RecoveryRemedy } from '@/ble/bondWedge';
import { recoveryTitle } from '@/ble/recoveryPresentation';
import { SlideUpSheet } from './SlideUpSheet';

interface Props {
  remedy: RecoveryRemedy;
  // The car's display name — Tesla propagates it into the BLE GAP name, so it is
  // exactly the string iOS shows in Settings > Bluetooth (e.g. "🔑 CHUŠKOPEK")
  // and the user can match it by eye instead of guessing.
  vehicleName: string | null;
  // True when the menu rows are still shown below us (a Pi is configured), so
  // the sheet can reassure the user that those rows genuinely still work.
  piWorking: boolean;
}

export function PhoneKeyRecoveryCard({ remedy, vehicleName, piWorking }: Props) {
  const [open, setOpen] = useState(false);
  if (remedy === 'none') return null;

  const body =
    remedy === 're-enroll-with-card'
      ? `Your phone key is no longer on ${vehicleName ?? 'the car'}'s key list.\n\n` +
        'Tap your key card on the center console, then confirm on this phone to add it back.'
      : bondWedgeBody(vehicleName);

  return (
    <>
      <View style={styles.card}>
        <View style={styles.icon}>
          <SymbolView name="iphone" tintColor="rgba(255,255,255,0.85)" size={28} />
        </View>
        <View style={styles.text}>
          {/* Their exact wording — the row is always "Phone Key" regardless of
              which remedy applies; the branch happens inside Set Up. */}
          <Text style={styles.title}>Phone Key</Text>
          <Text style={styles.subtitle}>Enable passive entry and remote controls</Text>
        </View>
        <Pressable style={styles.button} onPress={() => setOpen(true)} hitSlop={6}>
          <Text style={styles.buttonLabel}>Set Up</Text>
        </Pressable>
      </View>

      <SlideUpSheet visible={open} onDismiss={() => setOpen(false)} panelStyle={styles.panel}>
        <Text style={styles.sheetTitle}>{recoveryTitle(remedy)}</Text>
        <Text style={styles.sheetBody}>{body}</Text>
        {piWorking ? (
          <Text style={styles.sheetNote}>
            Everything else still works over your Pi — this only affects walk-up unlocking
            and direct Bluetooth.
          </Text>
        ) : null}
        <Pressable style={styles.done} onPress={() => setOpen(false)}>
          <Text style={styles.doneLabel}>Done</Text>
        </Pressable>
      </SlideUpSheet>
    </>
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
    fontSize: 20,
    fontWeight: '600',
    color: 'white',
  },
  subtitle: {
    fontSize: 14,
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
    fontSize: 15,
    fontWeight: '600',
    color: 'white',
  },
  panel: {
    paddingHorizontal: 24,
    paddingTop: 24,
    paddingBottom: 34,
    gap: 14,
  },
  sheetTitle: {
    fontSize: 22,
    fontWeight: '700',
    color: 'white',
  },
  sheetBody: {
    fontSize: 15,
    lineHeight: 21,
    color: 'rgba(255,255,255,0.75)',
  },
  sheetNote: {
    fontSize: 13,
    lineHeight: 18,
    color: 'rgba(255,255,255,0.45)',
  },
  done: {
    marginTop: 6,
    borderRadius: 10,
    backgroundColor: 'rgba(255,255,255,0.12)',
    paddingVertical: 14,
    alignItems: 'center',
  },
  doneLabel: {
    fontSize: 16,
    fontWeight: '600',
    color: 'white',
  },
});
