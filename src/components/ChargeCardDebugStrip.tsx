import { Pressable, ScrollView, StyleSheet, Text, View } from 'react-native';

import { TeslaFonts } from '@/constants/fonts';
import { controlHaptic } from '@/state/controlHaptic';
import type { ChargeCardProps } from './ChargeCard';

// ⚠️ TEMPORARY — DELETE THIS FILE AND ITS CALL SITE.
//
// Ivan has no charger nearby, so the charge panel cannot be seen in any of its
// real states. This strip fakes them for a look, and is meant to be reverted:
// everything lives in this one file plus ~6 lines in HomeScreen, committed
// alone, so removal is `git revert <sha>` and nothing else.
//
// ── Why an OVERRIDE and not fake vehicle state ────────────────────────────
// Two reasons, and the first is a safety one:
//
//  1. The panel's controls go through `actions.patch`, and the reconciler maps
//     chargePortOpen -> openChargePort / closeChargePort. Writing a fake
//     `chargePortOpen: true` into vehicle state would emit a REAL command and
//     physically open the charge port on the real car. An override never
//     reaches diffToCommands, so it cannot.
//  2. ChargeState is polled. Anything written into vehicle state would be
//     overwritten by the next read, so the fake would flicker away on its own.
//
// The panel's OWN buttons stay fully live while a preset is showing — Ivan's
// call, explicitly: tapping Start or the port button really does command the
// car. Only the DISPLAYED values are faked.

// The states worth looking at. `charging` and `chargingState` are kept
// consistent with each other on purpose — the panel derives its headline colour
// from both, and an incoherent pair would show a combination the car can never
// produce, which would be a misleading thing to design against.
export type ChargePreset = {
  label: string;
  patch: Partial<ChargeCardProps>;
};

export const CHARGE_PRESETS: ChargePreset[] = [
  {
    label: 'Plugged',
    patch: {
      chargePortOpen: true,
      cableAttached: true,
      charging: false,
      chargingState: 'Disconnected',
      minutesToChargeLimit: null,
      chargerPowerKw: null,
      chargeRateMph: null,
    },
  },
  {
    label: 'Starting',
    patch: {
      chargePortOpen: true,
      cableAttached: true,
      charging: false,
      chargingState: 'Starting',
      minutesToChargeLimit: null,
      chargerPowerKw: null,
      chargeRateMph: null,
    },
  },
  {
    label: 'Charging AC',
    patch: {
      chargePortOpen: true,
      cableAttached: true,
      charging: true,
      chargingState: 'Charging',
      batteryLevel: 62,
      rangeMiles: 190,
      minutesToChargeLimit: 84,
      chargerPowerKw: 7.4,
      chargeRateMph: 22,
    },
  },
  {
    label: 'Supercharge',
    patch: {
      chargePortOpen: true,
      cableAttached: true,
      charging: true,
      chargingState: 'Charging',
      batteryLevel: 41,
      rangeMiles: 128,
      minutesToChargeLimit: 18,
      chargerPowerKw: 149,
      chargeRateMph: 402,
    },
  },
  {
    label: 'Complete',
    patch: {
      chargePortOpen: true,
      cableAttached: true,
      charging: false,
      chargingState: 'Complete',
      batteryLevel: 80,
      minutesToChargeLimit: null,
      chargerPowerKw: null,
      chargeRateMph: null,
    },
  },
  {
    label: 'Stopped',
    patch: {
      chargePortOpen: true,
      cableAttached: true,
      charging: false,
      chargingState: 'Stopped',
      minutesToChargeLimit: null,
      chargerPowerKw: null,
      chargeRateMph: null,
    },
  },
  {
    label: 'No Power',
    patch: {
      chargePortOpen: true,
      cableAttached: true,
      charging: false,
      chargingState: 'NoPower',
      minutesToChargeLimit: null,
      chargerPowerKw: null,
      chargeRateMph: null,
    },
  },
  {
    label: 'Unplugged',
    patch: {
      chargePortOpen: false,
      cableAttached: false,
      charging: false,
      chargingState: 'Disconnected',
      minutesToChargeLimit: null,
      chargerPowerKw: null,
      chargeRateMph: null,
    },
  },
];

export function ChargeCardDebugStrip({
  activeLabel,
  onPick,
}: {
  activeLabel: string | null;
  onPick: (preset: ChargePreset | null) => void;
}) {
  return (
    <View style={styles.wrap}>
      <Text style={styles.caption}>
        FAKE charge states — temporary. The panel&apos;s own buttons are still LIVE.
      </Text>
      <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={styles.row}>
        <Chip label="Live" active={activeLabel === null} onPress={() => onPick(null)} />
        {CHARGE_PRESETS.map((p) => (
          <Chip key={p.label} label={p.label} active={activeLabel === p.label} onPress={() => onPick(p)} />
        ))}
      </ScrollView>
    </View>
  );
}

function Chip({ label, active, onPress }: { label: string; active: boolean; onPress: () => void }) {
  return (
    <Pressable
      onPress={() => {
        controlHaptic();
        onPress();
      }}
      style={({ pressed }) => [styles.chip, active && styles.chipActive, { opacity: pressed ? 0.6 : 1 }]}
    >
      <Text style={[styles.chipText, active && styles.chipTextActive]}>{label}</Text>
    </Pressable>
  );
}

const styles = StyleSheet.create({
  wrap: {
    marginBottom: 8,
  },
  caption: {
    fontFamily: TeslaFonts.medium,
    fontSize: 10,
    lineHeight: 14,
    letterSpacing: 0.1,
    color: '#DAA300',
    marginBottom: 6,
  },
  row: {
    gap: 6,
    paddingRight: 12,
  },
  chip: {
    paddingHorizontal: 12,
    paddingVertical: 7,
    borderRadius: 14,
    backgroundColor: 'rgba(255,255,255,0.08)',
  },
  chipActive: {
    backgroundColor: '#3E6BE2',
  },
  chipText: {
    fontFamily: TeslaFonts.medium,
    fontSize: 12,
    lineHeight: 16,
    letterSpacing: 0.1,
    color: '#8A8B8B',
  },
  chipTextActive: {
    color: '#F3F3F3',
  },
});
