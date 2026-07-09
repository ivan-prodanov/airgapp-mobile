import { forwardRef, useState, type ReactNode } from 'react';
import { Pressable, ScrollView, StyleSheet, Text, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { SymbolView, type SFSymbol } from 'expo-symbols';
import ReorderableList, { useReorderableDrag, type ReorderableListReorderEvent } from 'react-native-reorderable-list';
import Swipeable from 'react-native-gesture-handler/ReanimatedSwipeable';
import { runOnJS } from 'react-native-reanimated';

import { BottomSheet, type BottomSheetHandle } from './BottomSheet';
import { computeItinerary, type ItineraryRow, type Leg, type Trip } from '@/state/trip';

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

// Two modes, so the reorder gesture and the sheet's drag never overlap (the iOS "Edit mode" pattern):
//  • Normal → a plain ScrollView (like the Location sheet): swipe-up expands the sheet, the list scrolls,
//    rows tap / swipe / long-press. NO reorderable list mounted, so nothing steals the sheet's drag.
//  • Edit → the reorderable list with ≡ handles, and the sheet pinned to full so there's no resize gesture
//    to fight the reorder. "Done" returns to normal.
export const TripSheet = forwardRef<TripSheetHandle, Props>(function TripSheet(
  { trip, legs, now, onAddStop, onAddCharger, onReorder, onRowAction, onLongPressRow },
  ref,
) {
  const insetBottom = useSafeAreaInsets().bottom;
  const [editing, setEditing] = useState(false);
  const rows = computeItinerary(trip.stops, legs, now);
  const padBottom = insetBottom + FOOTER_CLEARANCE;

  return (
    <BottomSheet ref={ref} lowestDetent="middle" middleFrac={TRIP_SHEET_FRAC} locked={editing}>
      {({ dragHandlers, expandFull, contentPanHandlers, scrollProps, setContentBusy }) => (
        <View style={styles.content}>
          <View {...dragHandlers} style={styles.header}>
            <Text style={styles.title}>Trip</Text>
            <View style={styles.headerActions}>
              {editing ? (
                <Pressable hitSlop={8} onPress={() => setEditing(false)}>
                  <Text style={styles.editText}>Done</Text>
                </Pressable>
              ) : (
                <>
                  <HeaderButton icon="plus" label="Add Stop" onPress={onAddStop} />
                  <HeaderButton icon="bolt.fill" label="Add Charger" tint="#E5484D" onPress={onAddCharger} />
                  {/* Enter reorder mode + pin the sheet to full so the reorder gesture owns the panel. */}
                  <Pressable
                    hitSlop={8}
                    onPress={() => {
                      setEditing(true);
                      expandFull();
                    }}
                  >
                    <Text style={styles.editText}>Edit</Text>
                  </Pressable>
                </>
              )}
            </View>
          </View>

          {editing ? (
            // Edit mode: the car row is the (non-reorderable) list header; only stops reorder (list index →
            // trip index + 1). The content pan + busy latch stay wired, but at full there's no resize to steal.
            <View style={styles.listWrap} {...contentPanHandlers}>
              <ReorderableList
                data={rows.slice(1)}
                keyExtractor={(row) => row.stop.id}
                onReorder={({ from, to }: ReorderableListReorderEvent) => onReorder(from + 1, to + 1)}
                // The library fires these on the UI thread as worklets — flip the busy latch via runOnJS so a
                // reorder yields the content pan. Passing a plain closure crashes at drag start.
                onDragStart={() => {
                  'worklet';
                  runOnJS(setContentBusy)(true);
                }}
                onDragEnd={() => {
                  'worklet';
                  runOnJS(setContentBusy)(false);
                }}
                scrollEnabled={scrollProps.scrollEnabled}
                ListHeaderComponent={<EditCarRow row={rows[0]} onRowAction={onRowAction} />}
                contentContainerStyle={{ paddingBottom: padBottom }}
                showsVerticalScrollIndicator={false}
                renderItem={({ item, index }) => <DragRow row={item} index={index + 1} onRowAction={onRowAction} />}
              />
            </View>
          ) : (
            // Normal mode: a plain scroll list. Same structure as the (working) Location sheet, so the sheet's
            // content pan resizes/scrolls without a reorderable gesture competing for the vertical drag.
            <View style={styles.listWrap} {...contentPanHandlers}>
              <ScrollView {...scrollProps} contentContainerStyle={{ paddingBottom: padBottom }} showsVerticalScrollIndicator={false}>
                {rows.map((row, i) => (
                  <PlainRow key={row.stop.id} row={row} index={i} isCar={i === 0} isLast={i === rows.length - 1} onLongPress={onLongPressRow} />
                ))}
              </ScrollView>
            </View>
          )}
        </View>
      )}
    </BottomSheet>
  );
});

// Normal-mode row: tap + long-press → context menu (Copy/Share/Insert/Delete). Deliberately NO Swipeable:
// its RNGH pan sets activeOffsetX but no failOffsetY, so it holds vertical touches and intermittently blocks
// the sheet's PanResponder resize. Plain rows (like the Location sheet) keep body-drag resize/scroll solid;
// swipe-to-reveal lives in Edit mode instead.
function PlainRow({
  row,
  index,
  isCar,
  isLast,
  onLongPress,
}: {
  row: ItineraryRow;
  index: number;
  isCar: boolean;
  isLast: boolean;
  onLongPress: (index: number, anchorY: number) => void;
}) {
  return (
    <Pressable onLongPress={(e) => onLongPress(index, e.nativeEvent.pageY)} delayLongPress={280}>
      <RowContent row={row} isCar={isCar} lineTop={index > 0} lineBottom={!isLast} />
    </Pressable>
  );
}

// Edit-mode reorderable stop: swipe → Share/Insert/Delete, drag by the ≡ handle. No long-press (redundant here).
function DragRow({
  row,
  index,
  onRowAction,
}: {
  row: ItineraryRow;
  index: number;
  onRowAction: (index: number, action: TripRowAction) => void;
}) {
  const drag = useReorderableDrag();
  return (
    <Swipeable
      friction={2}
      rightThreshold={44}
      renderRightActions={() => <SwipeActions actions={['share', 'insert', 'delete']} index={index} onRowAction={onRowAction} />}
    >
      <RowContent
        row={row}
        isCar={false}
        trailing={
          <Pressable hitSlop={10} onPressIn={drag} onLongPress={drag} delayLongPress={120}>
            <SymbolView name="line.3.horizontal" tintColor="rgba(255,255,255,0.4)" size={20} />
          </Pressable>
        }
      />
    </Swipeable>
  );
}

// Edit-mode car row (list header): swipe → Share/Insert, never draggable, no long-press.
function EditCarRow({ row, onRowAction }: { row: ItineraryRow; onRowAction: (index: number, action: TripRowAction) => void }) {
  return (
    <Swipeable
      friction={2}
      rightThreshold={44}
      renderRightActions={() => <SwipeActions actions={['share', 'insert']} index={0} onRowAction={onRowAction} />}
    >
      <RowContent row={row} isCar />
    </Swipeable>
  );
}

function RowContent({
  row,
  isCar,
  trailing,
  lineTop,
  lineBottom,
}: {
  row: ItineraryRow;
  isCar: boolean;
  trailing?: ReactNode;
  lineTop?: boolean; // draw the timeline spine up to the previous stop
  lineBottom?: boolean; // draw the timeline spine down to the next stop
}) {
  const { stop } = row;
  return (
    <View style={styles.row}>
      {/* Icon column doubles as a route "timeline": a vertical spine connects each stop's node to the next.
          The node sits on an opaque dot so the spine reads as connecting between icons, not through them. */}
      <View style={styles.iconCol}>
        {lineTop ? <View style={[styles.spine, styles.spineTop]} /> : null}
        {lineBottom ? <View style={[styles.spine, styles.spineBottom]} /> : null}
        <View style={styles.iconDot}>
          <SymbolView
            name={ICON[stop.kind]}
            tintColor={stop.kind === 'charger' ? '#E5484D' : isCar ? '#3E6AE1' : 'rgba(255,255,255,0.75)'}
            size={18}
          />
        </View>
      </View>
      <View style={styles.rowText}>
        <Text style={styles.rowTitle} numberOfLines={1}>
          {stop.title}
        </Text>
        <Text style={styles.rowMeta} numberOfLines={1}>
          {isCar ? 'Departure' : hhmm(row.at)}
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
  listWrap: { flex: 1 },
  // Fixed height so the header (and the whole list) doesn't jump when the taller Add-Stop/Add-Charger pills
  // are swapped for the shorter Done/Edit text between normal and edit mode.
  header: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', height: 40, paddingHorizontal: 20, marginTop: 2, marginBottom: 12 },
  title: { fontSize: 22, fontWeight: '700', color: 'white' },
  headerActions: { flexDirection: 'row', alignItems: 'center', gap: 10 },
  headerBtn: { flexDirection: 'row', alignItems: 'center', gap: 5, height: 32, paddingHorizontal: 12, borderRadius: 9, backgroundColor: 'rgba(255,255,255,0.1)' },
  headerBtnText: { fontSize: 13, fontWeight: '600', color: 'white' },
  editText: { fontSize: 15, fontWeight: '600', color: '#3E6AE1' },
  row: { flexDirection: 'row', alignItems: 'center', gap: 12, paddingHorizontal: 20, height: 60, backgroundColor: '#161616' },
  // Route "timeline" spine in the icon column (normal mode). The dot masks the spine behind each node.
  iconCol: { width: 24, alignSelf: 'stretch', alignItems: 'center', justifyContent: 'center' },
  spine: { position: 'absolute', left: 11, width: 2, backgroundColor: 'rgba(255,255,255,0.18)' },
  spineTop: { top: 0, height: 30 },
  spineBottom: { top: 30, bottom: 0 },
  iconDot: { width: 24, height: 24, borderRadius: 12, alignItems: 'center', justifyContent: 'center', backgroundColor: '#161616' },
  rowText: { flex: 1 },
  rowTitle: { fontSize: 17, fontWeight: '700', color: 'white' },
  rowMeta: { fontSize: 14, color: 'rgba(255,255,255,0.5)', marginTop: 3 },
  actions: { flexDirection: 'row' },
  swipeBtn: { width: 64, height: 60, alignItems: 'center', justifyContent: 'center' },
});
