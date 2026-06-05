import { useState } from 'react';
import { Pressable, StyleSheet, Text, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { SymbolView, type SFSymbol } from 'expo-symbols';

import type { VehicleActions } from '../state/useVehicleState';
import type { VehicleViewState } from '../types/vehicleTypes';

interface Props {
  state: VehicleViewState;
  actions: VehicleActions;
}

const MIN_TEMP = 15;
const MAX_TEMP = 28;

// Climate controls sheet — RN build of the Tesla climate screen (Pic 2). Kept short so the whole
// top-down car sits above it. Visible rows match the reference; more rows to come with full refs.
export function ClimateScreen({ state, actions }: Props) {
  const [temp, setTemp] = useState(19.5);
  const adjust = (delta: number) =>
    setTemp((current) => Math.min(MAX_TEMP, Math.max(MIN_TEMP, Math.round((current + delta) * 2) / 2)));

  return (
    <SafeAreaView edges={['bottom']} style={styles.panel}>
      <View style={styles.handle} />

      <View style={styles.tempRow}>
        <Quick
          symbol="power"
          label={state.climateOn ? 'On' : 'Off'}
          active={state.climateOn}
          onPress={() => actions.toggle('climateOn')}
        />

        <View style={styles.tempControl}>
          <Pressable hitSlop={16} onPress={() => adjust(-0.5)}>
            <SymbolView name="chevron.left" tintColor="rgba(255,255,255,0.55)" size={22} />
          </Pressable>
          <Text style={styles.temp}>{temp.toFixed(1)}°</Text>
          <Pressable hitSlop={16} onPress={() => adjust(0.5)}>
            <SymbolView name="chevron.right" tintColor="rgba(255,255,255,0.55)" size={22} />
          </Pressable>
        </View>

        <Quick symbol="fanblades" label="Vent" active={false} onPress={() => {}} />
      </View>

      <Row
        symbol="windshield.front.and.heat.waves"
        label="Defrost Car"
        active={state.frontDefrostOn}
        onPress={() => actions.toggle('frontDefrostOn')}
      />
      <Row symbol="microbe" label="Bioweapon Defense Mode" active={false} onPress={() => {}} />
    </SafeAreaView>
  );
}

function Quick({
  symbol,
  label,
  active,
  onPress,
}: {
  symbol: SFSymbol;
  label: string;
  active: boolean;
  onPress: () => void;
}) {
  return (
    <Pressable style={styles.quick} onPress={onPress}>
      <SymbolView name={symbol} tintColor={active ? '#4ea1ff' : 'rgba(255,255,255,0.9)'} size={26} />
      <Text style={[styles.quickLabel, active && styles.quickLabelActive]}>{label}</Text>
    </Pressable>
  );
}

function Row({
  symbol,
  label,
  active,
  onPress,
}: {
  symbol: SFSymbol;
  label: string;
  active: boolean;
  onPress: () => void;
}) {
  return (
    <Pressable style={[styles.row, active && styles.rowActive]} onPress={onPress}>
      <SymbolView name={symbol} tintColor={active ? 'black' : 'rgba(255,255,255,0.9)'} size={24} />
      <Text style={[styles.rowText, active && styles.rowTextActive]}>{label}</Text>
    </Pressable>
  );
}

const styles = StyleSheet.create({
  panel: {
    paddingHorizontal: 16,
    paddingTop: 8,
    gap: 12,
    backgroundColor: 'rgba(0,0,0,0.55)',
    borderTopLeftRadius: 22,
    borderTopRightRadius: 22,
  },
  handle: {
    alignSelf: 'center',
    width: 36,
    height: 5,
    borderRadius: 3,
    backgroundColor: 'rgba(255,255,255,0.3)',
    marginBottom: 4,
  },
  tempRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: 8,
  },
  quick: {
    alignItems: 'center',
    width: 64,
    gap: 6,
  },
  quickLabel: {
    fontSize: 13,
    color: 'rgba(255,255,255,0.6)',
  },
  quickLabelActive: {
    color: '#4ea1ff',
  },
  tempControl: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 20,
  },
  temp: {
    fontSize: 44,
    fontWeight: '300',
    color: 'white',
    minWidth: 120,
    textAlign: 'center',
  },
  row: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 14,
    paddingVertical: 15,
    paddingHorizontal: 16,
    borderRadius: 14,
    backgroundColor: 'rgba(255,255,255,0.06)',
  },
  rowActive: {
    backgroundColor: 'white',
  },
  rowText: {
    fontSize: 16,
    color: 'white',
  },
  rowTextActive: {
    color: 'black',
    fontWeight: '600',
  },
});
