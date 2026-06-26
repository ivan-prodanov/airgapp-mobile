import { Pressable, StyleSheet, Text } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { SymbolView, type SFSymbol } from 'expo-symbols';

import { MarkerOverlay } from '../godot/MarkerOverlay';
import type { VehicleActions } from '../state/useVehicleState';
import type { VehicleViewState } from '../types/vehicleTypes';

interface Props {
  state: VehicleViewState;
  actions: VehicleActions;
}

// Vertical trim for the Flash/Honk/Start/Vent bar on top of its natural safe-area bottom position:
// positive lifts it up, negative drops it down. (It was previously dropped to clear a temporary
// Home/Explore tab bar; that bar is gone, so it's back to the natural position.) Calibrated on device.
const BOTTOM_BAR_LIFT = 10;

// Controls screen: the closure marker overlay (frunk/trunk Open · center lock · charge port) drawn
// over the top-down car, plus the bottom action bar (Flash / Honk / Start / Vent).
export function ControlsScreen({ state, actions }: Props) {
  return (
    <>
      <MarkerOverlay state={state} actions={actions} />
      <SafeAreaView edges={['bottom']} style={styles.bar}>
        <Action symbol="headlight.low.beam" label="Flash" />
        <Action symbol="horn.fill" label="Honk" />
        <Action symbol="key.radiowaves.forward.fill" label="Start" />
        <Action symbol="car.window.left" label="Vent" />
      </SafeAreaView>
    </>
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
    marginBottom: BOTTOM_BAR_LIFT,
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
