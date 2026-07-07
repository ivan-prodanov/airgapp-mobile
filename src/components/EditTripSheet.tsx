import { forwardRef, useRef, useState } from 'react';
import { Animated, PanResponder, Pressable, ScrollView, StyleSheet, Text, View } from 'react-native';
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
const ROW_HEIGHT = 60;

export const EditTripSheet = forwardRef<EditTripSheetHandle, Props>(function EditTripSheet(
  { trip, onRemove, onReorder, onAddStop, onAddCharger },
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
            <ReorderableStops trip={trip} onRemove={onRemove} onReorder={onReorder} />
            <AddRow icon="mappin" tint="rgba(255,255,255,0.7)" label="Add Stop" onPress={onAddStop} />
            <AddRow icon="bolt.fill" tint="#E5484D" label="Add Charger" onPress={onAddCharger} />
          </ScrollView>
        </View>
      )}
    </BottomSheet>
  );
});

// A drag-reorderable stop list. The car (index 0) is fixed. The active row follows the finger; the rows it
// crosses shift by ROW_HEIGHT; on release the new index is committed via onReorder. Small list → re-render
// per move is fine.
function ReorderableStops({
  trip,
  onRemove,
  onReorder,
}: {
  trip: Trip;
  onRemove: (id: string) => void;
  onReorder: (from: number, to: number) => void;
}) {
  const [drag, setDrag] = useState<{ index: number; dy: number } | null>(null);

  const targetIndex = (d: { index: number; dy: number }) =>
    Math.max(1, Math.min(trip.stops.length - 1, d.index + Math.round(d.dy / ROW_HEIGHT)));

  // Static offset for a non-active row while another row is being dragged over it.
  const offsetFor = (i: number): number => {
    if (!drag || i === drag.index) return 0;
    const to = targetIndex(drag);
    if (drag.index < to && i > drag.index && i <= to) return -ROW_HEIGHT;
    if (drag.index > to && i >= to && i < drag.index) return ROW_HEIGHT;
    return 0;
  };

  return (
    <View>
      {trip.stops.map((stop, i) => (
        <StopRow
          key={stop.id}
          stop={stop}
          isCar={i === 0}
          active={drag?.index === i}
          offset={offsetFor(i)}
          onRemove={() => onRemove(stop.id)}
          onDragStart={() => setDrag({ index: i, dy: 0 })}
          onDragMove={(dy) => setDrag((d) => (d ? { ...d, dy } : d))}
          onDragEnd={(dy) => {
            const to = targetIndex({ index: i, dy });
            setDrag(null);
            if (to !== i) onReorder(i, to);
          }}
        />
      ))}
    </View>
  );
}

function StopRow({
  stop,
  isCar,
  active,
  offset,
  onRemove,
  onDragStart,
  onDragMove,
  onDragEnd,
}: {
  stop: TripStop;
  isCar: boolean;
  active: boolean;
  offset: number;
  onRemove: () => void;
  onDragStart: () => void;
  onDragMove: (dy: number) => void;
  onDragEnd: (dy: number) => void;
}) {
  // Latest callbacks via ref so the (stable) PanResponder never goes stale.
  const cb = useRef({ onDragStart, onDragMove, onDragEnd });
  cb.current = { onDragStart, onDragMove, onDragEnd };
  const pan = useRef(
    PanResponder.create({
      onStartShouldSetPanResponder: () => true,
      onMoveShouldSetPanResponder: () => true,
      onPanResponderGrant: () => cb.current.onDragStart(),
      onPanResponderMove: (_e, g) => cb.current.onDragMove(g.dy),
      onPanResponderRelease: (_e, g) => cb.current.onDragEnd(g.dy),
      onPanResponderTerminate: (_e, g) => cb.current.onDragEnd(g.dy),
    }),
  ).current;

  return (
    <Animated.View style={[styles.rowWrap, { transform: [{ translateY: active ? 0 : offset }] }, active && styles.rowActive]}>
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
          <View {...pan.panHandlers} hitSlop={10}>
            <SymbolView name="line.3.horizontal" tintColor="rgba(255,255,255,0.4)" size={20} />
          </View>
        </>
      )}
    </Animated.View>
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
  rowWrap: { flexDirection: 'row', alignItems: 'center', gap: 12, paddingHorizontal: 20, height: ROW_HEIGHT },
  rowActive: { backgroundColor: 'rgba(255,255,255,0.06)', borderRadius: 12, zIndex: 10 },
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
