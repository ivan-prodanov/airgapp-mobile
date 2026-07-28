import { useSyncExternalStore } from 'react';
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
//
// The chips live on the DEMO page and the panel lives on HOME — two different
// screens — so the selection sits in a module-level store rather than either
// screen's local state. useSyncExternalStore keeps both in step without a
// provider, which matters because a provider would be a permanent change to
// support a temporary feature.

// The states worth looking at. `charging` and `chargingState` are kept
// consistent with each other on purpose — the panel derives its headline colour
// from both, and an incoherent pair would show a combination the car can never
// produce, which would be a misleading thing to design against.
export type ChargePreset = {
  label: string;
  patch: Partial<ChargeCardProps>;
};

// Ivan: "all have 0kwh added during last charging session - is that expected?"
// No — it was a hole in these presets, not in the panel. None of them set
// energyAddedKwh, so every chip fell through to the real car's cached value.
// charge_energy_added resets when a session begins and accumulates through it,
// retaining the last session's total once disconnected, so it genuinely differs
// per state and the presets now say so.
export const CHARGE_PRESETS: ChargePreset[] = [
  {
    label: 'Plugged',
    patch: {
      // last session, cable just re-seated
      energyAddedKwh: 41,
      fastCharging: false,
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
      // session resets to 0 as it begins
      energyAddedKwh: 0,
      fastCharging: false,
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
      chargerActualCurrentA: 16,
      chargerVoltageV: 230,
      chargerPilotCurrentA: 32,
      // accumulating mid-session
      energyAddedKwh: 12,
      fastCharging: false,
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
      chargerActualCurrentA: 320,
      chargerVoltageV: 400,
      chargerPilotCurrentA: 500,
      // DC — also the only preset that hides the amps
      energyAddedKwh: 34,
      fastCharging: true,
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
      // the full session, the figure in their screenshot
      energyAddedKwh: 58,
      fastCharging: false,
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
      // partial, stopped early
      energyAddedKwh: 9,
      fastCharging: false,
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
      // plugged but nothing delivered
      energyAddedKwh: 0,
      fastCharging: false,
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
      // retained from the last completed session
      energyAddedKwh: 58,
      fastCharging: false,
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

// ── The shared selection ───────────────────────────────────────────────────
let currentPreset: ChargePreset | null = null;
const listeners = new Set<() => void>();

export function setChargePreset(preset: ChargePreset | null): void {
  currentPreset = preset;
  for (const l of listeners) l();
}

export function useChargePreset(): ChargePreset | null {
  return useSyncExternalStore(
    (cb) => {
      listeners.add(cb);
      return () => listeners.delete(cb);
    },
    () => currentPreset,
    () => currentPreset,
  );
}

export function ChargeCardDebugStrip() {
  const active = useChargePreset();
  const activeLabel = active?.label ?? null;
  const onPick = setChargePreset;
  return (
    <View style={styles.wrap}>
      <Text style={styles.caption}>
        Forces the Home charge panel into a state. It shows even with the car asleep. The panel&apos;s
        own buttons stay LIVE and really do command the car.
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
