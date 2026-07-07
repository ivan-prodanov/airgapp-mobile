import { forwardRef } from 'react';
import { Pressable, ScrollView, StyleSheet, Text, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { SymbolView, type SFSymbol } from 'expo-symbols';

import { BottomSheet, type BottomSheetHandle } from './BottomSheet';
import { TRIP_SHEET_FRAC } from './TripSheet';
import type { Trip, TripStop } from '@/state/trip';

export type EditTripSheetHandle = BottomSheetHandle;

interface Props {
  trip: Trip;
  onRemove: (id: string) => void;
  onReorder: (from: number, to: number) => void; // wired to drag in Task 3
  onAddStop: () => void;
  onAddCharger: () => void;
}

// Clearance so the last row isn't hidden under the pinned Done/Cancel overlay.
const FOOTER_CLEARANCE = 132;

export const EditTripSheet = forwardRef<EditTripSheetHandle, Props>(function EditTripSheet(
  { trip, onRemove, onAddStop, onAddCharger },
  ref,
) {
  const insetBottom = useSafeAreaInsets().bottom;

  return (
    <BottomSheet ref={ref} lowestDetent="middle" middleFrac={TRIP_SHEET_FRAC}>
      {({ dragHandlers }) => (
        <View style={styles.content}>
          <View {...dragHandlers} style={styles.header}>
            <Text style={styles.title}>Edit Trip</Text>
          </View>

          <ScrollView
            style={styles.scroll}
            contentContainerStyle={{ paddingBottom: insetBottom + FOOTER_CLEARANCE }}
            showsVerticalScrollIndicator={false}
          >
            {trip.stops.map((stop, i) => (
              <StopRow key={stop.id} stop={stop} isCar={i === 0} onRemove={() => onRemove(stop.id)} />
            ))}
            <AddRow icon="mappin" tint="rgba(255,255,255,0.7)" label="Add Stop" onPress={onAddStop} />
            <AddRow icon="bolt.fill" tint="#E5484D" label="Add Charger" onPress={onAddCharger} />
          </ScrollView>
        </View>
      )}
    </BottomSheet>
  );
});

function StopRow({ stop, isCar, onRemove }: { stop: TripStop; isCar: boolean; onRemove: () => void }) {
  return (
    <View style={styles.rowWrap}>
      <SymbolView
        name={isCar ? 'car.fill' : stop.kind === 'charger' ? 'bolt.fill' : 'mappin'}
        tintColor={stop.kind === 'charger' ? '#E5484D' : isCar ? '#3E6AE1' : 'rgba(255,255,255,0.75)'}
        size={18}
      />
      <View style={styles.pill}>
        <Text style={styles.pillText} numberOfLines={1}>
          {stop.title}
        </Text>
      </View>
      {isCar ? (
        <View style={styles.trailingSpacer} />
      ) : (
        <>
          <Pressable hitSlop={8} onPress={onRemove}>
            <SymbolView name="xmark" tintColor="rgba(255,255,255,0.5)" size={18} weight="medium" />
          </Pressable>
          <SymbolView name="line.3.horizontal" tintColor="rgba(255,255,255,0.35)" size={20} />
        </>
      )}
    </View>
  );
}

function AddRow({ icon, tint, label, onPress }: { icon: SFSymbol; tint: string; label: string; onPress: () => void }) {
  return (
    <Pressable style={({ pressed }) => [styles.rowWrap, { opacity: pressed ? 0.6 : 1 }]} onPress={onPress}>
      <SymbolView name={icon} tintColor={tint} size={18} />
      <View style={styles.addLabelWrap}>
        <SymbolView name="plus" tintColor="rgba(255,255,255,0.6)" size={16} weight="semibold" />
        <Text style={styles.addLabel}>{label}</Text>
      </View>
    </Pressable>
  );
}

const styles = StyleSheet.create({
  content: { flex: 1 },
  header: { paddingHorizontal: 20, marginTop: 2, marginBottom: 14 },
  title: { fontSize: 22, fontWeight: '700', color: 'white' },
  scroll: { flex: 1 },
  rowWrap: { flexDirection: 'row', alignItems: 'center', gap: 12, paddingHorizontal: 20, height: 60 },
  pill: {
    flex: 1,
    height: 46,
    borderRadius: 10,
    backgroundColor: 'rgba(255,255,255,0.08)',
    justifyContent: 'center',
    paddingHorizontal: 14,
  },
  pillText: { fontSize: 16, color: 'white' },
  trailingSpacer: { width: 20 },
  addLabelWrap: { flex: 1, flexDirection: 'row', alignItems: 'center', gap: 8, height: 46, paddingHorizontal: 4 },
  addLabel: { fontSize: 16, color: 'rgba(255,255,255,0.6)' },
});
