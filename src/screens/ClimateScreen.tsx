import { useState } from 'react';
import { Pressable, StyleSheet, Text, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';

import type { VehicleActions } from '../state/useVehicleState';
import type { VehicleViewState } from '../types/vehicleTypes';

interface Props {
  state: VehicleViewState;
  actions: VehicleActions;
}

const MIN_TEMP = 15;
const MAX_TEMP = 28;

// Short bottom controls for the climate view (RN approximation of the Tesla climate sheet). Kept
// deliberately short so the whole top-down car fills the space above it.
export function ClimateScreen({ state, actions }: Props) {
  const [temp, setTemp] = useState(19.5);
  const adjust = (delta: number) =>
    setTemp((current) => Math.min(MAX_TEMP, Math.max(MIN_TEMP, Math.round((current + delta) * 2) / 2)));

  return (
    <SafeAreaView edges={['bottom']} style={styles.panel}>
      <View style={styles.handle} />

      <View style={styles.tempRow}>
        <IconButton
          glyph="⏻"
          label={state.climateOn ? 'On' : 'Off'}
          active={state.climateOn}
          onPress={() => actions.toggle('climateOn')}
        />

        <View style={styles.tempControl}>
          <Pressable hitSlop={16} onPress={() => adjust(-0.5)}>
            <Text style={styles.stepper}>‹</Text>
          </Pressable>
          <Text style={styles.temp}>{temp.toFixed(1)}°</Text>
          <Pressable hitSlop={16} onPress={() => adjust(0.5)}>
            <Text style={styles.stepper}>›</Text>
          </Pressable>
        </View>

        <IconButton glyph="▤" label="Vent" active={false} onPress={() => {}} />
      </View>

      <RowButton
        label="Defrost Car"
        active={state.frontDefrostOn}
        onPress={() => actions.toggle('frontDefrostOn')}
      />
      <RowButton
        label="Rear Defrost"
        active={state.rearDefrostOn}
        onPress={() => actions.toggle('rearDefrostOn')}
      />
    </SafeAreaView>
  );
}

function IconButton({
  glyph,
  label,
  active,
  onPress,
}: {
  glyph: string;
  label: string;
  active: boolean;
  onPress: () => void;
}) {
  return (
    <Pressable style={styles.iconButton} onPress={onPress}>
      <Text style={[styles.icon, active && styles.iconActive]}>{glyph}</Text>
      <Text style={styles.iconLabel}>{label}</Text>
    </Pressable>
  );
}

function RowButton({ label, active, onPress }: { label: string; active: boolean; onPress: () => void }) {
  return (
    <Pressable style={[styles.row, active && styles.rowActive]} onPress={onPress}>
      <Text style={[styles.rowText, active && styles.rowTextActive]}>{label}</Text>
    </Pressable>
  );
}

const styles = StyleSheet.create({
  panel: {
    paddingHorizontal: 16,
    paddingTop: 8,
    gap: 10,
    backgroundColor: 'rgba(0,0,0,0.55)',
    borderTopLeftRadius: 20,
    borderTopRightRadius: 20,
  },
  handle: {
    alignSelf: 'center',
    width: 36,
    height: 4,
    borderRadius: 2,
    backgroundColor: 'rgba(255,255,255,0.3)',
    marginBottom: 6,
  },
  tempRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
  },
  iconButton: {
    alignItems: 'center',
    width: 64,
    gap: 4,
  },
  icon: {
    fontSize: 24,
    color: 'rgba(255,255,255,0.85)',
  },
  iconActive: {
    color: '#3b82f6',
  },
  iconLabel: {
    fontSize: 12,
    color: 'rgba(255,255,255,0.6)',
  },
  tempControl: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 18,
  },
  stepper: {
    fontSize: 30,
    color: 'rgba(255,255,255,0.7)',
    paddingHorizontal: 6,
  },
  temp: {
    fontSize: 40,
    fontWeight: '300',
    color: 'white',
    minWidth: 110,
    textAlign: 'center',
  },
  row: {
    paddingVertical: 16,
    paddingHorizontal: 16,
    borderRadius: 12,
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: 'rgba(255,255,255,0.12)',
  },
  rowActive: {
    backgroundColor: 'white',
    borderColor: 'white',
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
