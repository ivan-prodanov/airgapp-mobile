import { Pressable, StyleSheet, Text, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { SymbolView, type SFSymbol } from 'expo-symbols';

import type { VehicleActions } from '../state/useVehicleState';
import type { VehicleViewState } from '../types/vehicleTypes';

interface Props {
  state: VehicleViewState;
  actions: VehicleActions;
}

// Controls screen bottom bar (Tesla "Controls"): Flash / Honk / Start / Vent. Kept thin so the whole
// top-down car sits centred above it. Frunk/trunk "Open" labels + lock overlay come next.
export function ControlsScreen(_props: Props) {
  return (
    <SafeAreaView edges={['bottom']} style={styles.bar}>
      <Action symbol="headlight.low.beam" label="Flash" />
      <Action symbol="horn.fill" label="Honk" />
      <Action symbol="key.radiowaves.forward.fill" label="Start" />
      <Action symbol="wind" label="Vent" />
    </SafeAreaView>
  );
}

function Action({ symbol, label }: { symbol: SFSymbol; label: string }) {
  return (
    <Pressable style={styles.action}>
      <SymbolView name={symbol} tintColor="rgba(255,255,255,0.85)" size={26} />
      <Text style={styles.label}>{label}</Text>
    </Pressable>
  );
}

const styles = StyleSheet.create({
  bar: {
    flexDirection: 'row',
    justifyContent: 'space-around',
    alignItems: 'flex-start',
    paddingTop: 14,
    paddingHorizontal: 8,
  },
  action: {
    alignItems: 'center',
    gap: 6,
    width: 72,
  },
  label: {
    fontSize: 13,
    color: 'rgba(255,255,255,0.6)',
  },
});
