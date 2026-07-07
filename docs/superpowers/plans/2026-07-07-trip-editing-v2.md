# Trip Editing v2 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Rebuild the trip screen into one directly-editable itinerary with industry-grade interactions — drag-reorder (car pinned), swipe actions, a native-styled long-press context menu (Copy/Share/Insert/Delete) — and make "Add Charger" reuse the real Charging tab. Replaces the Phase-3 `EditTripSheet`/`AddChargerSheet`.

**Architecture:** All-RN rows (Architecture A). Enable RNGH once at the app root; drag = `react-native-reorderable-list`, swipe = `ReanimatedSwipeable`, long-press = a hand-rolled RN modal menu. Share = RN core; Copy = `expo-clipboard`. The RNGH-based drag is the first gate (if it fires, RNGH works); one native rebuild folds in `expo-clipboard`.

**Tech Stack:** RN 0.85 New Arch, react-native-gesture-handler 2.31, reanimated 4.3, `react-native-reorderable-list@^0.18`, `expo-clipboard` (SDK-56 pinned), expo-haptics.

## Global Constraints

- **Enable RNGH** by adding ONE `GestureHandlerRootView` at the app root. Existing PanResponder gestures keep working. **NO `expo prebuild`.**
- **RNGH gate:** if drag-reorder doesn't fire on device (Task 2), STOP and switch to the PanResponder + `react-native-swipe-list-view` fallback (out of scope for this plan — replan).
- **One rebuild**, only for `expo-clipboard` (Task 6) — pin its version to the SDK-56 release to avoid the dyld version-skew gotcha ([[native-module-add-no-prebuild]]). Everything else ships via `bash scripts/godot-ios/deploy-js.sh`.
- **Car is `stops[0]`** — no drag handle, no swipe, no menu; drop index clamped ≥ 1.
- **Tests:** pure logic via `node --import tsx --test`; register new `*.test.ts` in `package.json`.
- **Device:** CoreDevice `F3867E6E-E95F-5B2A-9C4E-06D1D72475A1`, bundle `local.airgapp.mobile`.

## File Structure

```
Pure (node:test):
  src/state/trip.ts / trip.test.ts     MODIFY  add insertStop(trip, place, index)

App:
  src/app/_layout.tsx                  MODIFY  wrap in GestureHandlerRootView
  src/components/TripSheet.tsx         REWRITE editable itinerary (reorderable-list + swipe + long-press menu)
  src/components/TripRowMenu.tsx       CREATE  hand-rolled context menu (Modal + scrim), shared by long-press
  src/app/location.tsx                 MODIFY  screen collapse, pendingInsert, row action handlers, Add Charger→Charging
  src/components/LocationSheet.tsx      MODIFY  charger-detail action label/behavior configurable (Navigate | Add to Trip)
  src/components/EditTripSheet.tsx     DELETE
  src/components/AddChargerSheet.tsx   DELETE
  package.json                         MODIFY  add react-native-reorderable-list, expo-clipboard
```

**Type/name contract:**
- `insertStop(trip: Trip, place: Place, index: number): Trip` (Task 1).
- `TripRowAction = 'copy' | 'share' | 'insert' | 'delete'`; `TripRowMenu` props `{ visible, anchorY, title, onAction(a: TripRowAction), onClose }` (Task 4).
- `location.tsx` state `pendingInsert: number | null` (null = append).

---

### Task 1: `insertStop` pure op

**Files:** Modify `src/state/trip.ts`, `src/state/trip.test.ts`.

- [ ] **Step 1: Add the failing test** — append to `src/state/trip.test.ts`:

```ts
test('insertStop inserts at index, clamped to [1, length] (never before the car)', () => {
  let t = startTrip(carStop(CAR), place('A', 43, 23));
  t = addStop(t, place('B', 44, 24)); // [car, A, B]
  t = insertStop(t, place('X', 45, 25), 1); // before A
  assert.deepEqual(t.stops.map((s) => s.title), ['Car location', 'X', 'A', 'B']);
  t = insertStop(t, place('Y', 46, 26), 0); // clamp → index 1 (never before car)
  assert.equal(t.stops[0].title, 'Car location');
  assert.equal(t.stops[1].title, 'Y');
  const end = insertStop(t, place('Z', 47, 27), 999); // clamp → append
  assert.equal(end.stops[end.stops.length - 1].title, 'Z');
});
```

Add `insertStop` to the import list at the top of the test file.

- [ ] **Step 2: Run it, verify it fails** — `node --import tsx --test src/state/trip.test.ts` → FAIL (`insertStop` not exported).

- [ ] **Step 3: Add `insertStop` to `src/state/trip.ts`** (after `addStop`):

```ts
// Insert a place stop at `index`, clamped to [1, stops.length] so it never lands before the car.
export function insertStop(trip: Trip, place: Place, index: number): Trip {
  const at = Math.max(1, Math.min(index, trip.stops.length));
  const stops = [...trip.stops];
  stops.splice(at, 0, placeToStop(place));
  return { stops };
}
```

- [ ] **Step 4: Run it, verify it passes** — `node --import tsx --test src/state/trip.test.ts` → PASS.

- [ ] **Step 5: Commit**

```bash
git add src/state/trip.ts src/state/trip.test.ts
git commit -m "feat(trip): insertStop pure op (clamped ≥ 1)"
```

---

### Task 2: Enable RNGH + reorderable TripSheet (RNGH GATE)

**Files:** Modify `src/app/_layout.tsx`, `src/components/TripSheet.tsx`, `src/app/location.tsx`; Delete `src/components/EditTripSheet.tsx`; `package.json`.

**Interfaces:** `TripSheet` props `{ trip, legs, now, carCoord, onAddStop, onAddCharger, onReorder(from,to), onRowAction(index, action) }`. (Swipe/menu land in Tasks 3–4; this task wires drag + the header + delete-only row action via a temporary button so the screen is usable and the gate is real.)

- [ ] **Step 1: Install the drag library**

Run: `pnpm add react-native-reorderable-list`
Then confirm its exported API (v0.18): `node -e "console.log(Object.keys(require('react-native-reorderable-list')))"` — expect `ReorderableList` (default), `useReorderableDrag`, `ReorderableListReorderEvent`. (No native code → no pod install.)

- [ ] **Step 2: Add `GestureHandlerRootView` at the root** — `src/app/_layout.tsx`:

```tsx
import { GestureHandlerRootView } from 'react-native-gesture-handler';
```
Wrap the existing tree:
```tsx
  return (
    <GestureHandlerRootView style={{ flex: 1 }}>
      <ThemeProvider value={colorScheme === 'dark' ? DarkTheme : DefaultTheme}>
        {/* …existing VehicleProvider / Stack… */}
      </ThemeProvider>
    </GestureHandlerRootView>
  );
```

- [ ] **Step 3: Rewrite `src/components/TripSheet.tsx`** — header with Add Stop / Add Charger, and a reorderable itinerary. Full file:

```tsx
import { forwardRef } from 'react';
import { Pressable, StyleSheet, Text, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { SymbolView, type SFSymbol } from 'expo-symbols';
import ReorderableList, { useReorderableDrag, type ReorderableListReorderEvent } from 'react-native-reorderable-list';

import { BottomSheet, type BottomSheetHandle } from './BottomSheet';
import { computeItinerary, DEFAULT_ITINERARY_OPTS, type ItineraryRow, type Leg, type Trip } from '@/state/trip';

export const TRIP_SHEET_FRAC = 0.5; // taller ~half-screen detent (top near screen middle)
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
  onLongPressRow: (index: number, anchorY: number) => void; // opens the hand-rolled menu (Task 4)
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

          <ReorderableList
            data={rows}
            keyExtractor={(row) => row.stop.id}
            onReorder={({ from, to }: ReorderableListReorderEvent) => onReorder(from, Math.max(1, to))}
            contentContainerStyle={{ paddingBottom: insetBottom + FOOTER_CLEARANCE }}
            showsVerticalScrollIndicator={false}
            renderItem={({ item, index }) => (
              <TripRow
                row={item}
                index={index}
                isCar={index === 0}
                onRowAction={onRowAction}
                onLongPress={onLongPressRow}
              />
            )}
          />
        </View>
      )}
    </BottomSheet>
  );
});

function TripRow({
  row,
  index,
  isCar,
  onRowAction,
  onLongPress,
}: {
  row: ItineraryRow;
  index: number;
  isCar: boolean;
  onRowAction: (index: number, action: TripRowAction) => void;
  onLongPress: (index: number, anchorY: number) => void;
}) {
  const drag = useReorderableDrag();
  const { stop } = row;
  return (
    <Pressable
      style={styles.row}
      disabled={isCar}
      onLongPress={(e) => onLongPress(index, e.nativeEvent.pageY)}
      delayLongPress={280}
    >
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
      {isCar ? null : (
        <Pressable hitSlop={10} onLongPress={drag} delayLongPress={120} onPressIn={drag}>
          <SymbolView name="line.3.horizontal" tintColor="rgba(255,255,255,0.4)" size={20} />
        </Pressable>
      )}
    </Pressable>
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
});
```

> **API note:** confirm `react-native-reorderable-list@0.18` exact exports/props from Step 1 (`ReorderableList` default export, `renderItem`/`data`/`onReorder`/`keyExtractor`, `useReorderableDrag`). Adjust prop names if the installed version differs; the shape above matches its documented API.

- [ ] **Step 4: Delete `EditTripSheet` and collapse the screen machine in `location.tsx`.**
  - `rm src/components/EditTripSheet.tsx`; remove its import.
  - Change `screen` state to `'search' | 'trip'` (drop `editTrip`/`addCharger`).
  - Add `const [pendingInsert, setPendingInsert] = useState<number | null>(null);`
  - `onSelectPlace`: insert-or-append based on `pendingInsert`:

```tsx
  const onSelectPlace = (place: Place) => {
    nav.select(place);
    if (trip.trip) {
      if (pendingInsert != null) trip.insertStop(place, pendingInsert);
      else trip.addStop(place);
      setPendingInsert(null);
      setScreen('trip');
    } else {
      trip.start(carCoord, place);
      setDepartAt(Date.now());
      setScreen('trip');
      tripSheetRef.current?.expand();
    }
  };
```
  - Add `insertStop` to `useTrip` (Step 5).
  - Render the new `TripSheet` with the new props; the row-action handler for this task handles only `'delete'`, `'insert'` (menu comes in Task 4):

```tsx
      {screen === 'trip' && trip.trip ? (
        <TripSheet
          ref={tripSheetRef}
          trip={trip.trip}
          legs={tripLegs}
          now={departAt}
          onAddStop={() => { setPendingInsert(null); setScreen('search'); }}
          onAddCharger={() => onAddChargerToTrip()}
          onReorder={trip.reorder}
          onRowAction={onTripRowAction}
          onLongPressRow={(index, anchorY) => openRowMenu(index, anchorY)}
        />
      ) : ( /* …LocationSheet… */ )}
```
  - Handlers (near `onRemoveStop`):

```tsx
  const onTripRowAction = (index: number, action: import('@/components/TripSheet').TripRowAction) => {
    if (!trip.trip) return;
    const stop = trip.trip.stops[index];
    if (action === 'delete') onRemoveStop(stop.id);
    else if (action === 'insert') { setPendingInsert(index + 1); setScreen('search'); }
    // 'copy' / 'share' handled in Tasks 3/4/6
  };
```
  - Add temporary stubs so the file compiles this task: `const openRowMenu = (_i: number, _y: number) => {};` and `const onAddChargerToTrip = () => {};` (both filled in Tasks 4 and 5).

- [ ] **Step 5: Add `insertStop` to `useTrip`** — in `src/state/useTrip.ts`:

```ts
  const insertStop = useCallback((place: Place, index: number) => setTrip((t) => (t ? insertStopOp(t, place, index) : t)), []);
```
Import `insertStop as insertStopOp` from `./trip` and add `insertStop` to the returned object.

- [ ] **Step 6: Typecheck + tests + deploy**

Run: `npx tsc --noEmit -p tsconfig.json && npm test`
Expected: clean; all pass.
Then: `bash scripts/godot-ios/deploy-js.sh`

- [ ] **Step 7: RNGH GATE — verify on device**
  - Build a trip → the trip sheet shows **Trip** + **Add Stop** / **Add Charger** in the header, itinerary rows below, pinned Send-to-Car/Cancel footer (Phase 1).
  - **Drag a row's `≡` handle → it reorders; the car stays at top.** ← if this works, RNGH fires and the whole approach is green. If drag does nothing, STOP — RNGH is inert; fall back per the Global Constraints.
  - Long-press a row → nothing yet (menu = Task 4). Add Stop → search → appended. Add Charger → nothing yet (Task 5).

- [ ] **Step 8: Commit**

```bash
git add -A
git commit -m "feat(trip): editable TripSheet v2 — RNGH reorderable itinerary + Add Stop/Charger header"
```

---

### Task 3: Swipe actions (Share / Insert / Delete)

**Files:** Modify `src/components/TripSheet.tsx`.

- [ ] **Step 1: Wrap each non-car row in `ReanimatedSwipeable`.** Import at top:

```tsx
import Swipeable from 'react-native-gesture-handler/ReanimatedSwipeable';
```

Wrap `TripRow`'s content (car rows render without a Swipeable). Right actions = **Share**, **Insert**, **Delete** (Delete widest/red; full-swipe past `rightThreshold` triggers Delete). Pass `onRowAction` through:

```tsx
  if (isCar) return <RowBody … />;
  return (
    <Swipeable
      friction={2}
      rightThreshold={44}
      renderRightActions={() => (
        <View style={styles.actions}>
          <SwipeBtn icon="square.and.arrow.up" bg="#3E6AE1" onPress={() => onRowAction(index, 'share')} />
          <SwipeBtn icon="plus" bg="#5A5A5E" onPress={() => onRowAction(index, 'insert')} />
          <SwipeBtn icon="trash.fill" bg="#E5484D" onPress={() => onRowAction(index, 'delete')} />
        </View>
      )}
    >
      <RowBody … />
    </Swipeable>
  );
```

Add `SwipeBtn` (a 64-wide pressable with an SF symbol) and `actions`/`swipeBtn` styles. Extract the visual row into a `RowBody` sub-component to share between the car and swipeable paths.

- [ ] **Step 2: Wire Share + Insert + Delete in `location.tsx`** — extend `onTripRowAction`:

```tsx
    else if (action === 'share') {
      const c = stop.coordinate;
      const mapsUrl = c ? `https://maps.apple.com/?ll=${c.latitude},${c.longitude}&q=${encodeURIComponent(stop.title)}` : '';
      import('react-native').then(({ Share }) => Share.share({ message: [stop.title, stop.subtitle, mapsUrl].filter(Boolean).join('\n') }).catch(() => {}));
    }
```
(Prefer a top-level `import { Share } from 'react-native';` and call `Share.share(...)` directly rather than the dynamic import — add `Share` to the existing `react-native` import in `location.tsx`.)

- [ ] **Step 3: Typecheck + deploy + verify**

Run: `npx tsc --noEmit -p tsconfig.json` → clean. `bash scripts/godot-ios/deploy-js.sh`.
On device: swipe a non-car row left → **Share / Insert / Delete** reveal; tapping Share opens the share sheet; Insert opens search and inserts at that position; Delete removes (full-swipe deletes). Car row doesn't swipe.

- [ ] **Step 4: Commit**

```bash
git add src/components/TripSheet.tsx src/app/location.tsx
git commit -m "feat(trip): swipe row actions (Share/Insert/Delete) via ReanimatedSwipeable"
```

---

### Task 4: Long-press context menu (hand-rolled)

**Files:** Create `src/components/TripRowMenu.tsx`; Modify `src/app/location.tsx`.

- [ ] **Step 1: Create `src/components/TripRowMenu.tsx`** — a `Modal` with a dark scrim and a menu card anchored near the pressed row:

```tsx
import { Modal, Pressable, StyleSheet, Text, View } from 'react-native';
import { SymbolView, type SFSymbol } from 'expo-symbols';
import type { TripRowAction } from './TripSheet';

const ITEMS: { action: TripRowAction; label: string; icon: SFSymbol; destructive?: boolean }[] = [
  { action: 'copy', label: 'Copy', icon: 'doc.on.doc' },
  { action: 'share', label: 'Share', icon: 'square.and.arrow.up' },
  { action: 'insert', label: 'Insert Stop', icon: 'plus' },
  { action: 'delete', label: 'Delete', icon: 'trash', destructive: true },
];

export function TripRowMenu({
  visible,
  anchorY,
  title,
  onAction,
  onClose,
}: {
  visible: boolean;
  anchorY: number;
  title: string;
  onAction: (a: TripRowAction) => void;
  onClose: () => void;
}) {
  return (
    <Modal visible={visible} transparent animationType="fade" onRequestClose={onClose}>
      <Pressable style={styles.scrim} onPress={onClose}>
        <View style={[styles.card, { top: Math.max(80, Math.min(anchorY, 560)) }]}>
          <Text style={styles.header} numberOfLines={1}>{title}</Text>
          {ITEMS.map((it) => (
            <Pressable
              key={it.action}
              style={({ pressed }) => [styles.item, { backgroundColor: pressed ? 'rgba(255,255,255,0.08)' : 'transparent' }]}
              onPress={() => { onAction(it.action); onClose(); }}
            >
              <Text style={[styles.itemText, it.destructive && styles.destructive]}>{it.label}</Text>
              <SymbolView name={it.icon} tintColor={it.destructive ? '#E5484D' : 'white'} size={18} />
            </Pressable>
          ))}
        </View>
      </Pressable>
    </Modal>
  );
}

const styles = StyleSheet.create({
  scrim: { flex: 1, backgroundColor: 'rgba(0,0,0,0.45)' },
  card: { position: 'absolute', right: 20, width: 240, borderRadius: 14, backgroundColor: '#2A2A2C', paddingVertical: 6, overflow: 'hidden' },
  header: { fontSize: 12, color: 'rgba(255,255,255,0.5)', paddingHorizontal: 14, paddingVertical: 8 },
  item: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', paddingHorizontal: 14, paddingVertical: 13 },
  itemText: { fontSize: 16, color: 'white' },
  destructive: { color: '#E5484D' },
});
```

- [ ] **Step 2: Wire it in `location.tsx`** — replace the `openRowMenu` stub with real state + render + haptic:

```tsx
  const [rowMenu, setRowMenu] = useState<{ index: number; anchorY: number } | null>(null);
  const openRowMenu = (index: number, anchorY: number) => {
    Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Medium).catch(() => {});
    setRowMenu({ index, anchorY });
  };
```
Render (after the trip footer overlay):
```tsx
      {rowMenu && trip.trip ? (
        <TripRowMenu
          visible
          anchorY={rowMenu.anchorY}
          title={trip.trip.stops[rowMenu.index]?.title ?? ''}
          onAction={(a) => onTripRowAction(rowMenu.index, a)}
          onClose={() => setRowMenu(null)}
        />
      ) : null}
```
Import `TripRowMenu`. (`Haptics` is already imported.)

- [ ] **Step 3: Typecheck + deploy + verify**

`npx tsc --noEmit -p tsconfig.json` → clean; `bash scripts/godot-ios/deploy-js.sh`.
On device: long-press a non-car row → the menu appears with a haptic; Share/Insert/Delete work (Copy is a no-op until Task 6). Tapping the scrim dismisses.

- [ ] **Step 4: Commit**

```bash
git add src/components/TripRowMenu.tsx src/app/location.tsx
git commit -m "feat(trip): hand-rolled long-press context menu (Share/Insert/Delete)"
```

---

### Task 5: Add Charger = the Charging tab

**Files:** Modify `src/app/location.tsx`, `src/components/LocationSheet.tsx`; Delete `src/components/AddChargerSheet.tsx`.

- [ ] **Step 1: Make the charger-detail action configurable in `LocationSheet.tsx`.** Add a prop `navigateLabel?: string` (default `'Navigate'`) threaded to `ChargerDetail`, and use it for the action button's text (the button already calls `onNavigate`). This lets the same detail show **"Add to Trip"** in trip mode.

- [ ] **Step 2: Add an "adding charger to trip" mode in `location.tsx`.** Replace the `onAddChargerToTrip` stub:

```tsx
  const [addingCharger, setAddingCharger] = useState(false);
  const onAddChargerToTrip = () => {
    if (!trip.trip) return;
    // Frame the trip so the charging viewport covers it, then show the Charging tab.
    mapRef.current?.fitToCoordinates(trip.trip.stops.map((s) => s.coordinate), {
      edgePadding: { top: 80, right: 40, bottom: Math.round(height * (SHEET_MIDDLE_FRAC - SHEET_MINIMAL_FRAC)), left: 40 },
      animated: true,
    });
    setAddingCharger(true);
    setTab('charging');
    setScreen('search');
  };
```
When a charger's detail action is tapped while `addingCharger`, add it to the trip instead of navigating. Change `onNavigateToCharger`:

```tsx
  const onNavigateToCharger = (c: Charger) => {
    Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Medium).catch(() => {});
    if (addingCharger && trip.trip) {
      trip.addCharger(c);
      setAddingCharger(false);
      onCloseDetail();
      setTab('recents');
      setScreen('trip');
    } else {
      onSelectPlace({ id: `charger:${c.id}`, title: c.name, subtitle: c.region || c.place, coordinate: { latitude: c.latitude, longitude: c.longitude }, kind: 'charger', source: 'charger' });
    }
  };
```
Pass `navigateLabel={addingCharger ? 'Add to Trip' : 'Navigate'}` to `<LocationSheet>`. Also make the Charging tab's close (X) return to the trip when `addingCharger` (in the `onTabChange`/`onClose` path: if `addingCharger`, `setAddingCharger(false); setScreen('trip')`).

- [ ] **Step 3: Delete the bespoke picker** — `rm src/components/AddChargerSheet.tsx`; remove its import and the `tripChargers` memo + the old `addCharger` render branch from `location.tsx` (superseded by the Charging tab reuse).

- [ ] **Step 4: Typecheck + deploy + verify**

`npx tsc --noEmit -p tsconfig.json` → clean; `bash scripts/godot-ios/deploy-js.sh`.
On device: from a trip → **Add Charger** → map fits the trip, the **Charging tab** opens (pins + Nearby list + filters); open a charger → its action reads **"Add to Trip"** → tap → returns to the trip with the charger appended. The X returns to the trip.

- [ ] **Step 5: Commit**

```bash
git add -A
git commit -m "feat(trip): Add Charger reuses the Charging tab (Add to Trip); remove bespoke picker"
```

---

### Task 6: Copy (expo-clipboard) + native rebuild

**Files:** Modify `src/app/location.tsx`, `package.json` (+ Podfile.lock).

- [ ] **Step 1: Add `expo-clipboard` pinned to SDK 56.** Check the SDK-56 version, then pin it (do NOT let `expo install` bump it past ExpoModulesCore 56.0.14):

Run:
```bash
ls -1d node_modules/.pnpm/expo-clipboard@* 2>/dev/null || echo "not yet"
pnpm add expo-clipboard@~56.0.0
```
Then verify the resolved version is a 56.0.x that pairs with ExpoModulesCore 56.0.14 (mirror the expo-location pinning in [[native-module-add-no-prebuild]]); adjust the pin if needed.

- [ ] **Step 2: `pod install`**

Run: `cd ios && LANG=en_US.UTF-8 pod install`
Expected: `ExpoClipboard` installed; `grep -n ExpoClipboard Podfile.lock` shows it.

- [ ] **Step 3: Wire Copy in `location.tsx`** — add the `'copy'` branch to `onTripRowAction`:

```tsx
    else if (action === 'copy') {
      const text = [stop.title, stop.subtitle].filter(Boolean).join(', ');
      import('expo-clipboard').then((Clipboard) => Clipboard.setStringAsync(text)).catch(() => {});
      Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light).catch(() => {});
    }
```
(Prefer a top-level `import * as Clipboard from 'expo-clipboard';` and `Clipboard.setStringAsync(text)`.)

- [ ] **Step 4: Full Release build** (compiles ExpoClipboard; renews the weekly profile)

Run:
```bash
xcodebuild -workspace ios/airgapp.xcworkspace -scheme airgapp -configuration Release \
  -sdk iphoneos -destination 'generic/platform=iOS' -allowProvisioningUpdates build
```
Expected: `BUILD SUCCEEDED`. No `DEVELOPMENT_TEAM=` overrides.

- [ ] **Step 5: Install + JS refresh**

```bash
APP="$(ls -dt "$HOME"/Library/Developer/Xcode/DerivedData/airgapp-*/Build/Products/Release-iphoneos/airgapp.app 2>/dev/null | head -1)"
xcrun devicectl device install app --device F3867E6E-E95F-5B2A-9C4E-06D1D72475A1 "$APP"
bash scripts/godot-ios/deploy-js.sh
```

- [ ] **Step 6: Verify on device** — long-press or swipe a row → **Copy** → the name/address is on the clipboard (paste into any field to confirm). Everything from Tasks 2–5 still works.

- [ ] **Step 7: Commit**

```bash
git add package.json ios/Podfile.lock src/app/location.tsx
git commit -m "feat(trip): Copy stop to clipboard (expo-clipboard) + native build"
```

---

## Self-Review

**Spec coverage:** RNGH foundation + smoke-test gate → Task 2. Drop Leave Now/Edit Trip; header Add Stop/Add Charger → Task 2. Drag-reorder (car pinned) → Task 2. Swipe (Copy/Share/Insert/Delete, Delete destructive) → Task 3 (+ Copy in Task 6). Long-press hand-rolled menu → Task 4. Add Stop vs Insert position → Task 2 (`pendingInsert`) + `insertStop` (Task 1). Add Charger = Charging tab, "Add to Trip" → Task 5. Copy=clipboard, Share=share sheet → Tasks 3/6. Delete `EditTripSheet`/`AddChargerSheet` → Tasks 2/5. One rebuild (clipboard only) → Task 6. ✓

**Placeholder scan:** temporary stubs (`openRowMenu`, `onAddChargerToTrip`) in Task 2 are explicitly filled in Tasks 4/5 (not dangling). The reorderable-list API is documented + confirmed empirically in Task 2 Step 1. No TBD/TODO.

**Type/name consistency:** `insertStop(trip, place, index)` (Task 1) used by `useTrip.insertStop` (Task 2) + `onSelectPlace`. `TripRowAction` (Task 2, TripSheet) reused by `TripRowMenu` (Task 4) + `onTripRowAction`. `TripSheet` props (`onReorder`, `onRowAction`, `onLongPressRow`, `onAddStop`, `onAddCharger`) match the `location.tsx` wiring. `TRIP_SHEET_FRAC` still exported from `TripSheet` (used by the Phase-2 fit-to-trip). ✓

**Risk note:** the two device-verified assumptions are (a) RNGH fires under the new root view (Task 2 gate) and (b) drag/swipe/long-press coexist per row without gesture deadlock — both are checked on device in Tasks 2–4; if long-press-for-menu fights the handle's long-press-for-drag, move the drag trigger to `onPressIn`-only (already included) or an RNGH `LongPress` gesture.

---

## Execution Handoff

Plan complete. Task 1 pure/testable; Task 2 is the **RNGH gate** (JS-only) — if drag doesn't fire, stop and replan the fallback; Tasks 3–5 JS-only increments; Task 6 the one `xcodebuild` (clipboard). Delete `EditTripSheet` (Task 2) and `AddChargerSheet` (Task 5).
