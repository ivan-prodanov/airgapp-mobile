import { forwardRef } from 'react';
import { ScrollView, StyleSheet, Text, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { Pressable } from 'react-native';
import { SymbolView, type SFSymbol } from 'expo-symbols';

import { BottomSheet, type BottomSheetHandle } from './BottomSheet';
import { computeItinerary, DEFAULT_ITINERARY_OPTS, type ItineraryRow, type Leg, type Trip } from '@/state/trip';

export type TripSheetHandle = BottomSheetHandle;

interface Props {
  trip: Trip;
  legs: Leg[]; // route legs (Phase 1: straight-line; Phase 2: real Apple route) — owned by the screen
  now: number; // departure clock (epoch ms); passed in so the component stays deterministic
  onEditTrip: () => void;
}

// Trip sheet rests at a taller ~half-screen detent (top near the middle of the screen), locked there so its
// pinned action buttons stay in view.
const TRIP_SHEET_FRAC = 0.5;
// Room left at the bottom of the itinerary so its last row clears the pinned Send-to-Car / Cancel overlay.
const FOOTER_CLEARANCE = 132;

const ICON: Record<ItineraryRow['stop']['kind'], SFSymbol> = {
  car: 'car.fill',
  charger: 'bolt.fill',
  place: 'mappin',
};

function hhmm(at: number): string {
  const d = new Date(at);
  return `${d.getHours()}:${String(d.getMinutes()).padStart(2, '0')}`;
}

export const TripSheet = forwardRef<TripSheetHandle, Props>(function TripSheet({ trip, legs, now, onEditTrip }, ref) {
  const insetBottom = useSafeAreaInsets().bottom;
  const rows = computeItinerary(trip.stops, legs, { ...DEFAULT_ITINERARY_OPTS, departAt: now });

  return (
    <BottomSheet ref={ref} lowestDetent="middle" middleFrac={TRIP_SHEET_FRAC}>
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
            contentContainerStyle={{ paddingTop: 8, paddingBottom: insetBottom + FOOTER_CLEARANCE }}
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
                      : [`${Math.round(row.pct)}%`, row.chargeMinutes ? `⚡ ${row.chargeMinutes} min` : null, hhmm(row.at)]
                          .filter(Boolean)
                          .join(' · ')}
                  </Text>
                </View>
              </View>
            ))}
          </ScrollView>
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
});
