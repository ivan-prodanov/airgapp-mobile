import { forwardRef } from 'react';
import { Pressable, ScrollView, StyleSheet, Text, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { SymbolView, type SFSymbol } from 'expo-symbols';

import { BottomSheet, type BottomSheetHandle } from './BottomSheet';
import { formatKm } from '@/state/mockLocation';
import {
  computeItinerary,
  straightLineLegs,
  tripTotals,
  DEFAULT_ITINERARY_OPTS,
  type ItineraryRow,
  type Trip,
} from '@/state/trip';

export type TripSheetHandle = BottomSheetHandle;

interface Props {
  trip: Trip;
  now: number; // departure clock (epoch ms); passed in so the component stays deterministic
  onEditTrip: () => void;
  onSendToCar: () => void;
  onCancel: () => void;
}

const ICON: Record<ItineraryRow['stop']['kind'], SFSymbol> = {
  car: 'car.fill',
  charger: 'bolt.fill',
  place: 'mappin',
};

function hhmm(at: number): string {
  const d = new Date(at);
  return `${d.getHours()}:${String(d.getMinutes()).padStart(2, '0')}`;
}
function hoursMins(totalS: number): string {
  const m = Math.round(totalS / 60);
  const h = Math.floor(m / 60);
  return h > 0 ? `${h}h ${m % 60}m` : `${m}m`;
}

export const TripSheet = forwardRef<TripSheetHandle, Props>(function TripSheet(
  { trip, now, onEditTrip, onSendToCar, onCancel },
  ref,
) {
  const insetBottom = useSafeAreaInsets().bottom;
  const legs = straightLineLegs(trip.stops); // Phase 1 mock; Phase 2 → real Apple legs
  const rows = computeItinerary(trip.stops, legs, { ...DEFAULT_ITINERARY_OPTS, departAt: now });
  const totals = tripTotals(legs);

  return (
    <BottomSheet ref={ref}>
      {({ dragHandlers }) => (
        <View style={styles.content}>
          <View {...dragHandlers} style={styles.header}>
            <Pressable style={styles.leaveBtn} onPress={() => {}}>
              <Text style={styles.leaveText}>Leave Now</Text>
              <SymbolView name="chevron.right" tintColor="rgba(255,255,255,0.6)" size={13} weight="semibold" />
            </Pressable>
            <Pressable hitSlop={10} onPress={onEditTrip}>
              <Text style={styles.editText}>Edit Trip</Text>
            </Pressable>
          </View>

          <ScrollView
            style={styles.scroll}
            contentContainerStyle={{ paddingTop: 8, paddingBottom: 12 }}
            showsVerticalScrollIndicator={false}
          >
            {rows.map((row, i) => (
              <View key={row.stop.id} style={styles.row}>
                <View style={styles.railCol}>
                  <SymbolView
                    name={ICON[row.stop.kind]}
                    tintColor={row.stop.kind === 'charger' ? '#E5484D' : row.stop.kind === 'car' ? '#3E6AE1' : 'rgba(255,255,255,0.75)'}
                    size={18}
                  />
                  {i < rows.length - 1 ? <View style={styles.rail} /> : null}
                </View>
                <View style={styles.rowText}>
                  <Text style={styles.rowTitle} numberOfLines={1}>
                    {row.stop.title}
                  </Text>
                  <Text style={styles.rowMeta} numberOfLines={1}>
                    {row.stop.kind === 'car'
                      ? `${Math.round(row.pct)}% · Set Departure Energy`
                      : [
                          `${Math.round(row.pct)}%`,
                          row.chargeMinutes ? `⚡ ${row.chargeMinutes} min` : null,
                          hhmm(row.at),
                        ]
                          .filter(Boolean)
                          .join(' · ')}
                  </Text>
                </View>
              </View>
            ))}
          </ScrollView>

          <View style={[styles.footer, { paddingBottom: insetBottom + 8 }]}>
            <Pressable style={styles.sendBtn} onPress={onSendToCar}>
              <Text style={styles.sendText}>
                Send to Car · {hoursMins(totals.durationS)} · {formatKm(totals.distanceM / 1000)}
              </Text>
            </Pressable>
            <Pressable hitSlop={8} onPress={onCancel} style={styles.cancelBtn}>
              <Text style={styles.cancelText}>Cancel</Text>
            </Pressable>
          </View>
        </View>
      )}
    </BottomSheet>
  );
});

const styles = StyleSheet.create({
  content: { flex: 1 },
  header: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: 20,
    marginTop: 2,
    marginBottom: 12,
  },
  leaveBtn: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    height: 34,
    paddingHorizontal: 14,
    borderRadius: 10,
    backgroundColor: 'rgba(255,255,255,0.08)',
  },
  leaveText: { fontSize: 15, fontWeight: '600', color: 'white' },
  editText: { fontSize: 16, fontWeight: '600', color: '#3E6AE1' },
  scroll: { flex: 1 },
  row: { flexDirection: 'row', gap: 14, paddingHorizontal: 20 },
  railCol: { alignItems: 'center', width: 22 },
  rail: { flex: 1, width: 2, backgroundColor: 'rgba(255,255,255,0.15)', marginVertical: 2 },
  rowText: { flex: 1, paddingBottom: 22 },
  rowTitle: { fontSize: 17, fontWeight: '700', color: 'white' },
  rowMeta: { fontSize: 14, color: 'rgba(255,255,255,0.5)', marginTop: 3 },
  footer: { paddingHorizontal: 16, paddingTop: 8, gap: 10 },
  sendBtn: { height: 52, borderRadius: 12, backgroundColor: '#3E6AE1', alignItems: 'center', justifyContent: 'center' },
  sendText: { fontSize: 17, fontWeight: '700', color: 'white' },
  cancelBtn: { alignItems: 'center', paddingVertical: 6 },
  cancelText: { fontSize: 16, color: 'rgba(255,255,255,0.7)' },
});
