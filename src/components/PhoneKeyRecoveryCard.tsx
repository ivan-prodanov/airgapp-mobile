// PhoneKeyRecoveryCard — Home's "your phone key is broken, here is the fix" card.
//
// Mirrors the official app's degraded Phone Key row (icon + title + subtitle +
// action) so it reads as native, but the BODY is ours: Tesla can only say "Set
// Up Phone Key" because it cannot see the whitelist through a dead BLE link. We
// read it over the Pi, so we name the ACTUAL remedy — usually "forget the device
// in Settings > Bluetooth", which needs no key card and no unlocked car.
//
// The action is EXPAND, not a deep link: there is no working iOS URL for the
// Bluetooth pane (App-Prefs:/prefs:root=Bluetooth are zero-hit in the official
// binary and Apple removed them), and a button that silently no-ops is worse
// than instructions the user can actually follow.

import { useState } from 'react';
import { Pressable, StyleSheet, Text, View } from 'react-native';
import { SymbolView } from 'expo-symbols';

import { bondWedgeBody, type RecoveryRemedy } from '@/ble/bondWedge';
import { recoveryTitle, recoverySubtitle } from '@/ble/recoveryPresentation';

interface Props {
  remedy: RecoveryRemedy;
  // The car's display name — Tesla propagates it into the BLE GAP name, so it
  // is exactly the string iOS shows in Settings > Bluetooth (e.g. "🔑 CHUŠKOPEK")
  // and the user can match it without guessing.
  vehicleName: string | null;
  // True when the menus are still shown below us (a Pi is configured). Drives
  // the softer treatment: with a working Pi this is an advisory, not a wall.
  compact: boolean;
}

export function PhoneKeyRecoveryCard({ remedy, vehicleName, compact }: Props) {
  const [expanded, setExpanded] = useState(!compact);
  if (remedy === 'none') return null;

  const body =
    remedy === 're-enroll-with-card'
      ? `Your phone key is no longer on ${vehicleName ?? 'the car'}'s key list.\n\n` +
        'Tap your key card on the center console, then confirm on this phone to ' +
        'add it back.'
      : bondWedgeBody(vehicleName);

  return (
    <View style={[styles.card, compact ? styles.cardCompact : null]}>
      <Pressable style={styles.row} onPress={() => setExpanded((e) => !e)}>
        <View style={styles.icon}>
          <SymbolView
            name={remedy === 're-enroll-with-card' ? 'key.radiowaves.forward.fill' : 'antenna.radiowaves.left.and.right.slash'}
            tintColor="#ffb340"
            size={26}
          />
        </View>
        <View style={styles.text}>
          <Text style={styles.title}>{recoveryTitle(remedy)}</Text>
          <Text style={styles.subtitle}>{recoverySubtitle(remedy)}</Text>
        </View>
        <SymbolView
          name={expanded ? 'chevron.up' : 'chevron.down'}
          tintColor="rgba(255,255,255,0.5)"
          size={16}
          weight="semibold"
        />
      </Pressable>

      {expanded ? <Text style={styles.body}>{body}</Text> : null}

      {compact ? (
        // Only shown alongside a live menu: reassure the user that the rows
        // below still work, so they don't think the app is broken.
        <Text style={styles.footnote}>
          Everything below still works over your Pi — this only affects walk-up
          unlocking and direct Bluetooth.
        </Text>
      ) : null}
    </View>
  );
}

const styles = StyleSheet.create({
  card: {
    borderRadius: 14,
    backgroundColor: 'rgba(255,179,64,0.10)',
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: 'rgba(255,179,64,0.35)',
    paddingHorizontal: 16,
    paddingVertical: 6,
    marginBottom: 8,
  },
  cardCompact: {
    marginBottom: 16,
  },
  row: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 18,
    paddingVertical: 14,
  },
  icon: {
    width: 28,
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
    color: 'rgba(255,255,255,0.55)',
    marginTop: 2,
  },
  body: {
    fontSize: 15,
    lineHeight: 21,
    color: 'rgba(255,255,255,0.75)',
    paddingBottom: 14,
  },
  footnote: {
    fontSize: 13,
    lineHeight: 18,
    color: 'rgba(255,255,255,0.45)',
    paddingBottom: 14,
  },
});
