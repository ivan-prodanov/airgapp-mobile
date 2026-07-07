import { forwardRef, type ReactNode } from 'react';
import { Pressable, StyleSheet, Text, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { SymbolView, type SFSymbol } from 'expo-symbols';
import ReorderableList, { useReorderableDrag, type ReorderableListReorderEvent } from 'react-native-reorderable-list';
import Swipeable from 'react-native-gesture-handler/ReanimatedSwipeable';

import { BottomSheet, type BottomSheetHandle } from './BottomSheet';
import { computeItinerary, DEFAULT_ITINERARY_OPTS, type ItineraryRow, type Leg, type Trip } from '@/state/trip';

// Trip sheet rests at a taller ~half-screen detent (top near the middle of the screen). Exported so the map's
// fit-to-trip can pad by this height.
export const TRIP_SHEET_FRAC = 0.5;
export type TripSheetHandle = BottomSheetHandle;

export type TripRowAction = 'copy' | 'share' | 'insert' | 'delete';

interface Props {
  trip: Trip;
  legs: Leg[];
  now: number;
  onAddStop: () => void;
  onAddCharger: () => void;
  onReorder: (from: number, to: number) => void;
  onRowAction: (index: number, action: TripRowAction) => void;
  onLongPressRow: (index: number, anchorY: number) => void; // opens the hand-rolled menu
}

const FOOTER_CLEARANCE = 132;
const ICON: Record<ItineraryRow['stop']['kind'], SFSymbol> = { car: 'car.fill', charger: 'bolt.fill', place: 'mappin' };

function hhmm(at: number): string {
  const d = new Date(at);
  return `${d.getHours()}:${String(d.getMinutes()).padStart(2, '0')}`;
}

export const TripSheet = forwardRef<TripSheetHandle, Props>(function TripSheet(
  { trip, legs, now, onAddStop, onAddCharger, onReorder, onRowAction, onLongPressRow },
  ref,
) {
  const insetBottom = useSafeAreaInsets().bottom;
  const rows = computeItinerary(trip.stops, legs, { ...DEFAULT_ITINERARY_OPTS, departAt: now });

  return (
    <BottomSheet ref={ref} lowestDetent="middle" middleFrac={TRIP_SHEET_FRAC}>
      {({ dragHandlers }) => (
        <View style={styles.content}>
          <View {...dragHandlers} style={styles.header}>
            <Text style={styles.title}>Trip</Text>
            <View style={styles.headerActions}>
              <HeaderButton icon="plus" label="Add Stop" onPress={onAddStop} />
              <HeaderButton icon="bolt.fill" label="Add Charger" tint="#E5484D" onPress={onAddCharger} />
            </View>
          </View>

          {/* The car row is the (non-reorderable) list header, so it can never be dragged or displaced. Only
              the remaining stops are reorderable; their list index maps to trip index + 1. */}
          <ReorderableList
            data={rows.slice(1)}
            keyExtractor={(row) => row.stop.id}
            onReorder={({ from, to }: ReorderableListReorderEvent) => onReorder(from + 1, to + 1)}
            ListHeaderComponent={<CarRow row={rows[0]} onLongPress={onLongPressRow} onRowAction={onRowAction} />}
            contentContainerStyle={{ paddingBottom: insetBottom + FOOTER_CLEARANCE }}
            showsVerticalScrollIndicator={false}
            renderItem={({ item, index }) => (
              <TripRow row={item} index={index + 1} onLongPress={onLongPressRow} onRowAction={onRowAction} />
            )}
          />
        </View>
      )}
    </BottomSheet>
  );
});

// The car row (list header): swipe → Share/Insert (no Delete), long-press → menu (no Delete), never draggable.
function CarRow({
  row,
  onLongPress,
  onRowAction,
}: {
  row: ItineraryRow;
  onLongPress: (index: number, anchorY: number) => void;
  onRowAction: (index: number, action: TripRowAction) => void;
}) {
  return (
    <Swipeable
      friction={2}
      rightThreshold={44}
      renderRightActions={() => <SwipeActions actions={['share', 'insert']} index={0} onRowAction={onRowAction} />}
    >
      <Pressable onLongPress={(e) => onLongPress(0, e.nativeEvent.pageY)} delayLongPress={280}>
        <RowContent row={row} isCar />
      </Pressable>
    </Swipeable>
  );
}

// A reorderable (non-car) stop: swipe → Share/Insert/Delete, long-press → menu, drag by the ≡ handle.
function TripRow({
  row,
  index,
  onLongPress,
  onRowAction,
}: {
  row: ItineraryRow;
  index: number;
  onLongPress: (index: number, anchorY: number) => void;
  onRowAction: (index: number, action: TripRowAction) => void;
}) {
  const drag = useReorderableDrag();
  return (
    <Swipeable
      friction={2}
      rightThreshold={44}
      renderRightActions={() => <SwipeActions actions={['share', 'insert', 'delete']} index={index} onRowAction={onRowAction} />}
    >
      <Pressable onLongPress={(e) => onLongPress(index, e.nativeEvent.pageY)} delayLongPress={280}>
        <RowContent
          row={row}
          isCar={false}
          trailing={
            <Pressable hitSlop={10} onPressIn={drag} onLongPress={drag} delayLongPress={120}>
              <SymbolView name="line.3.horizontal" tintColor="rgba(255,255,255,0.4)" size={20} />
            </Pressable>
          }
        />
      </Pressable>
    </Swipeable>
  );
}

function RowContent({ row, isCar, trailing }: { row: ItineraryRow; isCar: boolean; trailing?: ReactNode }) {
  const { stop } = row;
  return (
    <View style={styles.row}>
      <SymbolView
        name={ICON[stop.kind]}
        tintColor={stop.kind === 'charger' ? '#E5484D' : isCar ? '#3E6AE1' : 'rgba(255,255,255,0.75)'}
        size={18}
      />
      <View style={styles.rowText}>
        <Text style={styles.rowTitle} numberOfLines={1}>
          {stop.title}
        </Text>
        <Text style={styles.rowMeta} numberOfLines={1}>
          {isCar
            ? `${Math.round(row.pct)}% · Set Departure Energy`
            : [`${Math.round(row.pct)}%`, row.chargeMinutes ? `⚡ ${row.chargeMinutes} min` : null, hhmm(row.at)]
                .filter(Boolean)
                .join(' · ')}
        </Text>
      </View>
      {trailing}
    </View>
  );
}

const SWIPE_BTN: Record<'share' | 'insert' | 'delete', { icon: SFSymbol; bg: string }> = {
  share: { icon: 'square.and.arrow.up', bg: '#3E6AE1' },
  insert: { icon: 'plus', bg: '#5A5A5E' },
  delete: { icon: 'trash.fill', bg: '#E5484D' },
};

function SwipeActions({
  actions,
  index,
  onRowAction,
}: {
  actions: ('share' | 'insert' | 'delete')[];
  index: number;
  onRowAction: (index: number, action: TripRowAction) => void;
}) {
  return (
    <View style={styles.actions}>
      {actions.map((a) => (
        <Pressable key={a} style={[styles.swipeBtn, { backgroundColor: SWIPE_BTN[a].bg }]} onPress={() => onRowAction(index, a)}>
          <SymbolView name={SWIPE_BTN[a].icon} tintColor="white" size={20} />
        </Pressable>
      ))}
    </View>
  );
}

function HeaderButton({ icon, label, tint = 'white', onPress }: { icon: SFSymbol; label: string; tint?: string; onPress: () => void }) {
  return (
    <Pressable style={({ pressed }) => [styles.headerBtn, { opacity: pressed ? 0.6 : 1 }]} onPress={onPress}>
      <SymbolView name={icon} tintColor={tint} size={15} weight="semibold" />
      <Text style={styles.headerBtnText}>{label}</Text>
    </Pressable>
  );
}

const styles = StyleSheet.create({
  content: { flex: 1 },
  header: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', paddingHorizontal: 20, marginTop: 2, marginBottom: 12 },
  title: { fontSize: 22, fontWeight: '700', color: 'white' },
  headerActions: { flexDirection: 'row', gap: 8 },
  headerBtn: { flexDirection: 'row', alignItems: 'center', gap: 5, height: 32, paddingHorizontal: 12, borderRadius: 9, backgroundColor: 'rgba(255,255,255,0.1)' },
  headerBtnText: { fontSize: 13, fontWeight: '600', color: 'white' },
  row: { flexDirection: 'row', alignItems: 'center', gap: 12, paddingHorizontal: 20, height: 60, backgroundColor: '#161616' },
  rowText: { flex: 1 },
  rowTitle: { fontSize: 17, fontWeight: '700', color: 'white' },
  rowMeta: { fontSize: 14, color: 'rgba(255,255,255,0.5)', marginTop: 3 },
  actions: { flexDirection: 'row' },
  swipeBtn: { width: 64, height: 60, alignItems: 'center', justifyContent: 'center' },
});
