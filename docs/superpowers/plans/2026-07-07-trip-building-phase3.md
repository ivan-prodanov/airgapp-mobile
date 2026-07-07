# Trip Building — Phase 3 (Edit Trip) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add the Edit Trip screen — remove stops, **Add Stop** (append a searched place), **Add Charger** (pick a charger between the trip's points), and **drag-reorder** stops (car pinned first) — finishing the trip feature.

**Architecture:** `location.tsx`'s screen machine gains `editTrip` + `addCharger`. A new `EditTripSheet` lists the stops with ✕/drag handles + Add-Stop/Add-Charger rows; a new `AddChargerSheet` lists chargers over the bounding box of all trip stops. Drag-reorder is hand-rolled with `PanResponder` (no dependency). All pure trip ops already exist (`useTrip.removeStop/reorder/addStop/addCharger`). **JS-only — no native rebuild.**

**Tech Stack:** React Native `PanResponder`, TypeScript, the existing `BottomSheet` + `useTrip` + charger DB. **Deploy with `deploy-js.sh`.**

## Global Constraints

- **JS-only — no rebuild.** `NO expo prebuild`. Add NO dependencies.
- **The car is always `stops[0]`** — non-removable, non-reorderable (enforced by `useTrip`/`trip.ts`). Removing every non-car stop **discards the trip** → back to search.
- **Trip stays in-memory / session.** Cancel discards it.
- **Tests:** the trip ops are already node-tested (Phase 1); Phase 3 is UI, verified on device.
- **Device:** CoreDevice `F3867E6E-E95F-5B2A-9C4E-06D1D72475A1`, bundle `local.airgapp.mobile`.

## File Structure

```
  src/components/EditTripSheet.tsx     CREATE  Edit Trip list (rows + ✕ + drag handle + Add Stop/Charger rows)
  src/components/AddChargerSheet.tsx   CREATE  charger picker over the trip-stops bbox
  src/app/location.tsx                 MODIFY  screen machine (editTrip/addCharger), append-on-select, footers, wiring
```

**Type/name contract:**
- `EditTripSheet` props: `{ trip: Trip; onRemove(id: string): void; onReorder(from: number, to: number): void; onAddStop(): void; onAddCharger(): void }` (Task 1; drag wired in Task 3).
- `AddChargerSheet` props: `{ chargers: Charger[]; onSelect(c: Charger): void; onClose(): void }` (Task 2).
- `Trip`, `TripStop` from `@/state/trip`; `Charger`, `LatLngBounds` from `@/services/tomtom`.

---

### Task 1: EditTripSheet + screen machine (remove / Add Stop / Done / Cancel)

**Files:** Create `src/components/EditTripSheet.tsx`; Modify `src/app/location.tsx`.

**Interfaces:** Consumes `useTrip` mutators + `BottomSheet`. Produces the `editTrip` screen. (Add Charger button routes to the `addCharger` screen built in Task 2; drag handles are inert until Task 3.)

- [ ] **Step 1: Create `src/components/EditTripSheet.tsx`**

```tsx
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
  onReorder: (from: number, to: number) => void; // wired to drag in Phase 3 Task 3
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
```

- [ ] **Step 2: Extend the screen machine in `location.tsx`.** Change the `screen` state type + the `onSelectPlace` handler so selecting a place while a trip exists **appends** instead of starting fresh:

```tsx
  const [screen, setScreen] = useState<'search' | 'trip' | 'editTrip' | 'addCharger'>('search');
```
```tsx
  // Select a place → record a recent, then either start a trip (none yet) or append to the one being edited.
  const onSelectPlace = (place: Place) => {
    nav.select(place);
    if (trip.trip) {
      trip.addStop(place);
      setScreen('editTrip');
    } else {
      trip.start(carCoord, place);
      setDepartAt(Date.now());
      setScreen('trip');
    }
  };
```

- [ ] **Step 3: Add the edit-trip handlers** (near `onSelectPlace`):

```tsx
  // Removing every non-car stop discards the trip (car alone isn't a trip).
  const onRemoveStop = (id: string) => {
    if (!trip.trip) return;
    const remaining = trip.trip.stops.filter((s, i) => i === 0 || s.id !== id);
    if (remaining.length <= 1) {
      trip.clear();
      setScreen('search');
    } else {
      trip.removeStop(id);
    }
  };
  const onTripCancel = () => {
    trip.clear();
    setScreen('search');
  };
```

- [ ] **Step 4: Wire the Edit Trip button** — change the Phase-1 `onEditTrip={() => {}}` on `<TripSheet>` to `onEditTrip={() => setScreen('editTrip')}`.

- [ ] **Step 5: Render `EditTripSheet` in the sheet switch.** Import it and add a branch. Change the sheet conditional so it reads:

```tsx
      {screen === 'trip' && trip.trip ? (
        <TripSheet ref={tripSheetRef} trip={trip.trip} legs={tripLegs} now={departAt} onEditTrip={() => setScreen('editTrip')} />
      ) : screen === 'editTrip' && trip.trip ? (
        <EditTripSheet
          trip={trip.trip}
          onRemove={onRemoveStop}
          onReorder={trip.reorder}
          onAddStop={() => setScreen('search')}
          onAddCharger={() => setScreen('addCharger')}
        />
      ) : (
        <LocationSheet
          ref={sheetRef}
          /* …all existing LocationSheet props unchanged… */
        />
      )}
```

Add the import at the top:
```ts
import { EditTripSheet } from '@/components/EditTripSheet';
```

- [ ] **Step 6: Add the Edit-Trip pinned footer** (Done + Cancel). Next to the Phase-1 trip footer overlay, add a sibling for `editTrip`:

```tsx
      {screen === 'editTrip' && trip.trip ? (
        <SafeAreaView edges={['bottom']} style={styles.tripBar} pointerEvents="box-none">
          <Pressable style={styles.tripSendButton} onPress={() => setScreen('trip')}>
            <Text style={styles.tripSendText}>Done</Text>
          </Pressable>
          <Pressable hitSlop={8} style={styles.tripCancelButton} onPress={onTripCancel}>
            <Text style={styles.tripCancelText}>Cancel</Text>
          </Pressable>
        </SafeAreaView>
      ) : null}
```

Also update the Phase-1 trip footer's Cancel to reuse `onTripCancel` (replace its inline `onPress` body with `onPress={onTripCancel}`) — same behavior, no duplication.

- [ ] **Step 7: Typecheck + tests**

Run: `npx tsc --noEmit -p tsconfig.json && npm test`
Expected: tsc clean; all tests PASS.

- [ ] **Step 8: Commit**

```bash
git add src/components/EditTripSheet.tsx src/app/location.tsx
git commit -m "feat(trip): Edit Trip screen — remove stops + Add Stop/Charger + Done/Cancel"
```

---

### Task 2: Add Charger (bbox charger picker)

**Files:** Create `src/components/AddChargerSheet.tsx`; Modify `src/app/location.tsx`.

**Interfaces:** Consumes `osmChargersInBounds` (`@/services/chargerSource`), `BottomSheet`, `formatKm`. Produces the `addCharger` screen.

- [ ] **Step 1: Create `src/components/AddChargerSheet.tsx`**

```tsx
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
```

- [ ] **Step 2: Compute trip-bbox chargers in `location.tsx`.** Add near the trip route memo:

```tsx
  // Chargers within the bounding box of all trip stops (padded) — for the Add Charger picker.
  const tripChargers = useMemo(() => {
    if (!trip.trip) return [];
    const lats = trip.trip.stops.map((s) => s.coordinate.latitude);
    const lngs = trip.trip.stops.map((s) => s.coordinate.longitude);
    const pad = 0.05;
    const bounds = {
      north: Math.max(...lats) + pad,
      south: Math.min(...lats) - pad,
      east: Math.max(...lngs) + pad,
      west: Math.min(...lngs) - pad,
    };
    return osmChargersInBounds(bounds, carCoord).chargers;
  }, [trip.trip, carCoord]);
```

(`osmChargersInBounds` is already imported in `location.tsx`.)

- [ ] **Step 3: Render the `addCharger` screen** — add a branch before the `LocationSheet` fallback in the sheet switch:

```tsx
      ) : screen === 'addCharger' && trip.trip ? (
        <AddChargerSheet
          chargers={tripChargers}
          onSelect={(c) => {
            trip.addCharger(c);
            setScreen('editTrip');
          }}
          onClose={() => setScreen('editTrip')}
        />
      ) : (
```

Add the import:
```ts
import { AddChargerSheet } from '@/components/AddChargerSheet';
```

- [ ] **Step 4: Typecheck**

Run: `npx tsc --noEmit -p tsconfig.json`
Expected: no errors.

- [ ] **Step 5: Commit**

```bash
git add src/components/AddChargerSheet.tsx src/app/location.tsx
git commit -m "feat(trip): Add Charger — pick a charger within the trip's bounding box"
```

---

### Task 3: Drag-reorder in EditTripSheet

**Files:** Modify `src/components/EditTripSheet.tsx`.

**Interfaces:** Uses the `onReorder(from, to)` prop (already passed from Task 1). Hand-rolled `PanResponder` on each non-car row's drag handle; car stays pinned at index 0.

- [ ] **Step 1: Replace the list + `StopRow` in `EditTripSheet.tsx` with a drag-reorderable version.** Add imports at the top (merge with existing):

```tsx
import { forwardRef, useRef, useState } from 'react';
import { Animated, PanResponder, Pressable, ScrollView, StyleSheet, Text, View } from 'react-native';
```

Add a fixed row height constant near `FOOTER_CLEARANCE`:

```tsx
const ROW_HEIGHT = 60;
```

Replace the `{trip.stops.map(...)}` block inside the `ScrollView` with a reorderable list component:

```tsx
            <ReorderableStops trip={trip} onRemove={onRemove} onReorder={onReorder} />
```

- [ ] **Step 2: Add the `ReorderableStops` + drag-aware `StopRow`** (replace the old `StopRow` function):

```tsx
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
          index={i}
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
  index,
  active,
  offset,
  onRemove,
  onDragStart,
  onDragMove,
  onDragEnd,
}: {
  stop: TripStop;
  isCar: boolean;
  index: number;
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

  const translateY = active ? undefined : offset;
  return (
    <Animated.View
      style={[
        styles.rowWrap,
        { transform: [{ translateY: translateY ?? 0 }] },
        active && styles.rowActive,
      ]}
    >
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
```

Add a `rowActive` style to the `StyleSheet` and make `rowWrap` overflow-friendly:

```tsx
  rowActive: { backgroundColor: 'rgba(255,255,255,0.06)', borderRadius: 12, zIndex: 10 },
```

> The active row uses `offset`/`dy` via re-render (state) rather than a live-following `Animated.Value` — for a 2–6 stop trip this is smooth enough and far simpler. If it feels laggy on device, that's the place to switch the active row to an `Animated.Value` driven in `onPanResponderMove`.

- [ ] **Step 3: Typecheck**

Run: `npx tsc --noEmit -p tsconfig.json`
Expected: no errors.

- [ ] **Step 4: Commit**

```bash
git add src/components/EditTripSheet.tsx
git commit -m "feat(trip): drag-reorder stops in Edit Trip (car pinned first)"
```

---

### Task 4: Deploy + verify

**Files:** none.

- [ ] **Step 1: JS deploy**

Run: `bash scripts/godot-ios/deploy-js.sh`
Expected: `✓ done`.

- [ ] **Step 2: On-device check** (eyes on the phone):
  1. Build a trip → **Edit Trip** → the stop list appears (Car location fixed at top, no ✕/handle on it).
  2. **✕** on a stop removes it; removing the last non-car stop drops back to search.
  3. **Add Stop** → search → pick a place → returns to Edit Trip with it appended.
  4. **Add Charger** → charger list (within the trip's area) → pick one → returns to Edit Trip with a charger stop.
  5. **Drag the ☰ handle** on a stop → it reorders; the **car never moves** from the top.
  6. **Done** → back to the trip view (route + itinerary reflect the edits); **Cancel** → discards the trip.

- [ ] **Step 3: Commit** (only if a tweak was needed).

---

## Self-Review

**Spec coverage (Phase 3 slice):**
- Edit Trip screen (reorder/remove + Add Stop + Add Charger + Done/Cancel) → Task 1 (`EditTripSheet` + footer) + Task 3 (drag). ✓
- Reorder except the car (pinned first via `=` handle) → Task 3 (`ReorderableStops`, `targetIndex` clamped ≥ 1; car row has no handle). ✓
- Add Stop → search, appended to the current trip → Task 1 Step 2 (`onSelectPlace` branch) + Step 5 (`onAddStop → 'search'`). ✓
- Add Charger → chargers between all selected points (bbox) → Task 2. ✓
- Removing all non-car stops discards the trip → Task 1 Step 3 (`onRemoveStop`). ✓
- Trip ops (add/remove/reorder) already pure + tested (Phase 1). ✓

**Placeholder scan:** none. Task 1's `onReorder` prop is passed through and becomes live in Task 3 (documented), not a dangling stub. Add-Charger bbox padding is a concrete `0.05°`.

**Type/name consistency:** `EditTripSheet` props `{ trip, onRemove, onReorder, onAddStop, onAddCharger }` (Task 1) match the `location.tsx` wiring (Task 1 Step 5) and the drag usage of `onReorder` (Task 3). `AddChargerSheet` props `{ chargers, onSelect, onClose }` (Task 2) match its render (Task 2 Step 3). `trip.reorder`/`trip.addCharger`/`trip.removeStop`/`trip.addStop` are the `useTrip` mutators (Phase 1). `TRIP_SHEET_FRAC` imported from `TripSheet` (Phase 2 export). `osmChargersInBounds(bounds, car)` returns `{ chargers }` (existing). ✓

---

## Execution Handoff

Phase 3 plan complete — all JS-only (`deploy-js.sh`, no rebuild). Task 1 = Edit Trip screen + screen machine; Task 2 = Add Charger picker; Task 3 = hand-rolled drag-reorder; Task 4 = deploy + on-device check. This finishes the trip-building feature (the map navigation line is already real from Phase 2; turn-by-turn stays out of scope).
