import { forwardRef } from 'react';
import { Pressable, ScrollView, StyleSheet, Text, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { SymbolView } from 'expo-symbols';

import { BottomSheet, type BottomSheetHandle } from './BottomSheet';
import { TRIP_SHEET_FRAC } from './TripSheet';
import { formatKm } from '@/state/mockLocation';
import { chargerBadge, type Charger } from '@/services/tomtom';

export type AddChargerSheetHandle = BottomSheetHandle;

interface Props {
  chargers: Charger[];
  onSelect: (c: Charger) => void;
  onClose: () => void;
}

export const AddChargerSheet = forwardRef<AddChargerSheetHandle, Props>(function AddChargerSheet(
  { chargers, onSelect, onClose },
  ref,
) {
  const insetBottom = useSafeAreaInsets().bottom;
  return (
    <BottomSheet ref={ref} lowestDetent="middle" middleFrac={TRIP_SHEET_FRAC}>
      {({ dragHandlers }) => (
        <View style={styles.content}>
          <View {...dragHandlers} style={styles.header}>
            <Text style={styles.title}>Add Charger</Text>
            <Pressable hitSlop={10} onPress={onClose}>
              <SymbolView name="xmark" tintColor="rgba(255,255,255,0.7)" size={20} weight="medium" />
            </Pressable>
          </View>

          {chargers.length === 0 ? (
            <Text style={styles.empty}>No chargers along this trip</Text>
          ) : (
            <ScrollView
              style={styles.scroll}
              contentContainerStyle={{ paddingBottom: insetBottom + 24 }}
              showsVerticalScrollIndicator={false}
            >
              {chargers.map((c) => {
                const badge = chargerBadge(c);
                return (
                  <Pressable
                    key={c.id}
                    style={({ pressed }) => [styles.row, { opacity: pressed ? 0.6 : 1 }]}
                    onPress={() => onSelect(c)}
                  >
                    <View style={styles.rowText}>
                      <Text style={styles.rowName} numberOfLines={1}>
                        {c.name}
                      </Text>
                      <Text style={styles.rowSub} numberOfLines={1}>
                        {[c.place, c.region].filter(Boolean).join(' · ')}
                      </Text>
                    </View>
                    <View style={[styles.badge, { backgroundColor: badge.color }]}>
                      <SymbolView name="bolt.fill" tintColor="white" size={11} />
                      <Text style={styles.badgeText}>{c.maxPowerKW} kW</Text>
                    </View>
                    <Text style={styles.km}>{formatKm(c.distanceM / 1000)}</Text>
                  </Pressable>
                );
              })}
            </ScrollView>
          )}
        </View>
      )}
    </BottomSheet>
  );
});

const styles = StyleSheet.create({
  content: { flex: 1 },
  header: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', paddingHorizontal: 20, marginTop: 2, marginBottom: 12 },
  title: { fontSize: 22, fontWeight: '700', color: 'white' },
  scroll: { flex: 1 },
  empty: { textAlign: 'center', color: 'rgba(255,255,255,0.4)', fontSize: 15, paddingVertical: 40 },
  row: { flexDirection: 'row', alignItems: 'center', gap: 10, paddingHorizontal: 20, paddingVertical: 12 },
  rowText: { flex: 1, gap: 3 },
  rowName: { fontSize: 16, fontWeight: '700', color: 'white' },
  rowSub: { fontSize: 13, color: 'rgba(255,255,255,0.45)' },
  badge: { flexDirection: 'row', alignItems: 'center', gap: 3, paddingHorizontal: 8, paddingVertical: 3, borderRadius: 999 },
  badgeText: { fontSize: 12, fontWeight: '700', color: 'white' },
  km: { fontSize: 13, fontWeight: '600', color: 'rgba(255,255,255,0.6)', minWidth: 52, textAlign: 'right' },
});
