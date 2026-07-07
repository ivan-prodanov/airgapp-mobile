# Native iOS Sheet for the Location Screen — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Replace the hand-rolled `BottomSheet` on the location screen with a real native iOS `UISheetPresentationController` (via `@lodev09/react-native-true-sheet`) so iOS coordinates detents-vs-scroll natively and the trip reorderable list scrolls, expands, and reorders without gesture conflict.

**Architecture:** Spike first (one native rebuild) to prove RNGH drag-reorder + native scroll-to-expand co-exist inside the native sheet; gate on it. If green, migrate the location screen to a single persistent `<TrueSheet>` whose children switch by mode (Location/Charging = `ScrollView`; Trip = reorderable `FlatList`), moving the pinned footers into the sheet's native `footer`, and deleting `BottomSheet.tsx`. If red, fall back to Option A (RNGH-unify, separate plan).

**Tech Stack:** Expo SDK 56, React Native 0.85.3 (New Arch/Fabric, Hermes), `@lodev09/react-native-true-sheet@3.11.3`, `react-native-reorderable-list@0.18.0`, `react-native-gesture-handler@2.31.2`, `react-native-reanimated@4.3.1`, expo-router, iOS (physical iPhone Air, iOS 26).

## Global Constraints

- NEVER run `expo prebuild` — `ios/` is hand-maintained (embeds Godot). Add native modules manually: `expo install` → (Info.plist if needed) → `pod install` → `xcodebuild` Release. Pattern reference: `modules/expo-apple-search`.
- New Architecture (Fabric) is ON and cannot be disabled. Any native UI lib must support Fabric on RN 0.85.
- `pod install` must run with `LANG=en_US.UTF-8`.
- Native rebuild command (renews the weekly free provisioning profile too):
  `xcodebuild -workspace ios/airgapp.xcworkspace -scheme airgapp -configuration Release -sdk iphoneos -destination 'generic/platform=iOS' -allowProvisioningUpdates build`
- JS-only redeploy (no rebuild): `bash scripts/godot-ios/deploy-js.sh`.
- Pin `@lodev09/react-native-true-sheet` to exactly `3.11.3`.
- `dimmed={false}` — the map MUST stay interactive at the resting detent.
- "Send to Car" stays a **local mock** — never a network/Tesla call.
- Gesture/native behavior is verified **on-device** (there is no unit-test harness for RNGH + native sheet). Pure logic (`src/state/trip.ts`) keeps its 64 node tests green: `npm test`.
- Reorderable-list props `onDragStart`/`onDragEnd` MUST be worklets (already handled; being removed in this plan).

---

## File Structure

- `package.json` — add the pinned dependency.
- `src/app/spike-sheet.tsx` — **throwaway** expo-router route for the Task 1 spike; deleted in Task 6.
- `src/components/SheetHost.tsx` — **new** thin wrapper over `TrueSheet` exposing `detents`, `dimmed=false`, dark styling, a `footer` slot, `children`, and an imperative ref (`present`/`resize`/`dismiss`). The single sheet primitive for the location screen. Replaces `BottomSheet.tsx`.
- `src/components/TripSheet.tsx` — unwrap from `BottomSheet`; export plain content (`TripSheetContent`) + a `TripFooter`. Drop the `onDragStart`/`onDragEnd` latch.
- `src/components/LocationSheet.tsx` — unwrap from `BottomSheet`; export plain content (`LocationSheetContent`); replace `expandFull`/`collapseToMiddle`/`dragHandlers`/`contentPanHandlers`/`scrollProps` with sheet-ref resize + plain views.
- `src/app/location.tsx` — render one `<SheetHost>` hosting Trip or Location content by mode; move the two pinned `SafeAreaView` footers into the sheet `footer`.
- `src/components/BottomSheet.tsx` — **deleted** in Task 6 (after confirming no other consumers).

---

## Task 1: Spike — install true-sheet, build, device-verify the crux (GATE)

**Files:**
- Modify: `package.json` (add dependency)
- Create: `src/app/spike-sheet.tsx` (throwaway)

**Interfaces:**
- Produces: confirmation (go/no-go) that inside `<TrueSheet>` the reorderable list scrolls + expands the sheet, reorders via ≡, over an interactive map, with a pinned footer.

- [ ] **Step 1: Install the native module (pinned)**

```bash
cd /Users/ivan/Work/airgapp/mobile
npx expo install @lodev09/react-native-true-sheet@3.11.3
```
Expected: `package.json` gains `"@lodev09/react-native-true-sheet": "3.11.3"`. If `expo install` resolves a different version, force it: `npm install --save-exact @lodev09/react-native-true-sheet@3.11.3`.

- [ ] **Step 2: Confirm exact prop/type names against the installed package**

Read the installed types and confirm the verbatim names used throughout this plan before writing code:
```bash
sed -n '1,200p' node_modules/@lodev09/react-native-true-sheet/lib/typescript/**/TrueSheet.types.d.ts 2>/dev/null \
  || grep -rn "detents\|dimmed\|dimmedDetentIndex\|scrollable\|scrollableOptions\|scrollingExpandsSheet\|footer\|grabber\|cornerRadius\|backgroundColor" node_modules/@lodev09/react-native-true-sheet/lib/typescript | head -40
```
Expected: props `detents`, `dimmed`, `dimmedDetentIndex`, `scrollable`, `scrollableOptions` (`{ scrollingExpandsSheet?: boolean }`), `footer`, `grabber`, `cornerRadius`, `backgroundColor`; methods `present(index?, animated?)`, `resize(index)`, `dismiss(animated?)`; events `onDidPresent`, `onDetentChange`, `onDidDismiss`. If any name differs, use the installed name and note the delta at the top of `SheetHost.tsx` in Task 2.

- [ ] **Step 3: Pod install (Fabric codegen for the new component)**

```bash
cd /Users/ivan/Work/airgapp/mobile/ios && LANG=en_US.UTF-8 pod install && cd ..
```
Expected: Pods resolves `TrueSheet` / `lodev09-react-native-true-sheet`; no errors. (No Info.plist changes are required for true-sheet.)

- [ ] **Step 4: Create the throwaway spike route**

Create `src/app/spike-sheet.tsx` — a full-screen map with a `TrueSheet` containing a reorderable list of 12 rows (so content overflows the 0.5 detent), one swipeable row, a ≡ drag handle, and a pinned footer. Reuses the app's real gesture libs so the test is faithful.

```tsx
import { useEffect, useRef, useState } from 'react';
import { Pressable, StyleSheet, Text, View } from 'react-native';
import MapView from 'react-native-maps';
import { TrueSheet } from '@lodev09/react-native-true-sheet';
import { SymbolView } from 'expo-symbols';
import ReorderableList, { useReorderableDrag, type ReorderableListReorderEvent } from 'react-native-reorderable-list';
import Swipeable from 'react-native-gesture-handler/ReanimatedSwipeable';

type Row = { id: string; title: string };
const INITIAL: Row[] = Array.from({ length: 12 }, (_, i) => ({ id: String(i + 1), title: `Stop ${i + 1}` }));

function SpikeRow({ row }: { row: Row }) {
  const drag = useReorderableDrag();
  return (
    <Swipeable
      friction={2}
      rightThreshold={44}
      renderRightActions={() => (
        <View style={styles.action}>
          <SymbolView name="trash.fill" tintColor="white" size={20} />
        </View>
      )}
    >
      <View style={styles.row}>
        <Text style={styles.rowText}>{row.title}</Text>
        <Pressable hitSlop={10} onPressIn={drag}>
          <SymbolView name="line.3.horizontal" tintColor="rgba(255,255,255,0.5)" size={20} />
        </Pressable>
      </View>
    </Swipeable>
  );
}

export default function SpikeSheet() {
  const sheet = useRef<TrueSheet>(null);
  const [rows, setRows] = useState(INITIAL);
  useEffect(() => {
    sheet.current?.present(0);
  }, []);
  return (
    <View style={styles.fill}>
      <MapView style={styles.fill} initialRegion={{ latitude: 42.7, longitude: 23.3, latitudeDelta: 0.2, longitudeDelta: 0.2 }} />
      <TrueSheet
        ref={sheet}
        detents={[0.5, 0.92]}
        dimmed={false}
        scrollable
        backgroundColor="#161616"
        cornerRadius={16}
        footer={
          <View style={styles.footer}>
            <Text style={styles.footerText}>Send to Car (mock)</Text>
          </View>
        }
      >
        <ReorderableList
          data={rows}
          keyExtractor={(r) => r.id}
          onReorder={({ from, to }: ReorderableListReorderEvent) =>
            setRows((cur) => {
              const next = [...cur];
              const [m] = next.splice(from, 1);
              next.splice(to, 0, m);
              return next;
            })
          }
          renderItem={({ item }) => <SpikeRow row={item} />}
        />
      </TrueSheet>
    </View>
  );
}

const styles = StyleSheet.create({
  fill: { flex: 1 },
  row: { height: 60, paddingHorizontal: 20, backgroundColor: '#161616', flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' },
  rowText: { color: 'white', fontSize: 17, fontWeight: '600' },
  action: { width: 64, height: 60, backgroundColor: '#E5484D', alignItems: 'center', justifyContent: 'center' },
  footer: { padding: 16, backgroundColor: '#1E1E1E' },
  footerText: { color: 'white', fontSize: 16, fontWeight: '700', textAlign: 'center' },
});
```

- [ ] **Step 5: Build (native) and install**

```bash
cd /Users/ivan/Work/airgapp/mobile
xcodebuild -workspace ios/airgapp.xcworkspace -scheme airgapp -configuration Release -sdk iphoneos -destination 'generic/platform=iOS' -allowProvisioningUpdates build
```
Then install the freshly-built `.app` per the project runbook (`AGENTS.md` iOS deploy section). Expected: build succeeds; app installs. If `devicectl` reports `provisioning profile has expired`, the `xcodebuild` above already re-signed — just install again.

- [ ] **Step 6: On-device verification (the gate)**

Navigate to the `/spike-sheet` route (temporarily point the app's initial route there, or deep-link). Confirm each on the physical device:
- [ ] Sheet presents at 50%; the map is visible and **pannable/tappable** behind it (dimmed=false).
- [ ] Swiping up on the list at 50% **expands the sheet to 92%**, and once expanded the list **scrolls** to reveal Stop 12.
- [ ] Dragging the ≡ handle **reorders** rows.
- [ ] Swiping a row left reveals the trash action.
- [ ] The footer stays pinned at the sheet bottom across detents.

**GATE:** All green → mark done, proceed to Task 2. If scroll-to-expand or reorder cannot be made to work with a documented true-sheet prop (try `scrollableOptions={{ scrollingExpandsSheet: true }}` explicitly, and wrapping the list in a `<View style={{flex:1}}>` for the 2-level scroll detection), **STOP** and switch to the Option A fallback plan (see spec §Fallback). Do not commit the spike route to a shared branch until the gate passes; keep it local.

- [ ] **Step 7: Keep logic tests green + commit the dependency**

```bash
npm test   # expect 64 pass
git add package.json ios/Podfile.lock package-lock.json 2>/dev/null; git add pnpm-lock.yaml 2>/dev/null
git commit -m "feat(sheet): add react-native-true-sheet@3.11.3 (native iOS sheet) + spike"
```
(Commit the spike route too; it is removed in Task 6.)

---

## Task 2: `SheetHost` — the native-sheet primitive

**Files:**
- Create: `src/components/SheetHost.tsx`

**Interfaces:**
- Produces:
  - `SheetHostHandle = { present: (index?: number) => void; resize: (index: number) => void; dismiss: () => void }`
  - `SHEET_DETENTS = [0.25, 0.5, 0.92] as const` and named indices `SHEET_MINIMAL = 0`, `SHEET_MIDDLE = 1`, `SHEET_FULL = 2`.
  - `<SheetHost ref footer?={ReactNode}>{children}</SheetHost>` — renders `<TrueSheet>` with `detents={SHEET_DETENTS}`, `dimmed={false}`, `scrollable`, `backgroundColor="#161616"`, `cornerRadius={16}`, `grabber`, and forwards `footer`.
- Consumes: `TrueSheet` from Task 1's dependency.

- [ ] **Step 1: Write `SheetHost.tsx`**

```tsx
import { forwardRef, useImperativeHandle, useRef, type ReactNode } from 'react';
import { TrueSheet } from '@lodev09/react-native-true-sheet';

// Fractional detents for the location screen: minimal peek / middle / full. TrueSheet supports up to 3.
export const SHEET_DETENTS = [0.25, 0.5, 0.92] as const;
export const SHEET_MINIMAL = 0;
export const SHEET_MIDDLE = 1;
export const SHEET_FULL = 2;

export interface SheetHostHandle {
  present: (index?: number) => void; // present at a detent index (default middle)
  resize: (index: number) => void; // move to a detent index while presented
  dismiss: () => void;
}

interface Props {
  children: ReactNode;
  footer?: ReactNode; // pinned natively at the sheet bottom
}

// Single native iOS bottom sheet (UISheetPresentationController) for the location screen. The map stays
// interactive (dimmed=false); iOS coordinates detents-vs-scroll for the inner ScrollView/FlatList (scrollable).
export const SheetHost = forwardRef<SheetHostHandle, Props>(function SheetHost({ children, footer }, ref) {
  const sheet = useRef<TrueSheet>(null);
  useImperativeHandle(ref, () => ({
    present: (index = SHEET_MIDDLE) => {
      sheet.current?.present(index);
    },
    resize: (index) => {
      sheet.current?.resize(index);
    },
    dismiss: () => {
      sheet.current?.dismiss();
    },
  }), []);

  return (
    <TrueSheet
      ref={sheet}
      detents={[...SHEET_DETENTS]}
      dimmed={false}
      scrollable
      grabber
      backgroundColor="#161616"
      cornerRadius={16}
      footer={footer}
    >
      {children}
    </TrueSheet>
  );
});
```

- [ ] **Step 2: Typecheck**

```bash
npx tsc --noEmit -p tsconfig.json
```
Expected: no errors. (If `grabber`/`footer`/`scrollable` prop names differ from Step 1.2, adjust to the installed names.)

- [ ] **Step 3: Commit**

```bash
git add src/components/SheetHost.tsx
git commit -m "feat(sheet): SheetHost — native TrueSheet primitive (detents, dimmed=false, footer)"
```

---

## Task 3: Unwrap TripSheet into plain content + host it (trip mode)

**Files:**
- Modify: `src/components/TripSheet.tsx`
- Modify: `src/app/location.tsx` (trip-mode render + move Send-to-Car/Cancel into the sheet footer)

**Interfaces:**
- Produces: `TripSheetContent` (props unchanged from the old `TripSheet` minus the sheet wrapper) and `TripFooter` (Send to Car / Cancel). Removes `TripSheetHandle`/`forwardRef`/`TRIP_SHEET_FRAC`.
- Consumes: `SheetHost`, `SheetHostHandle`, `SHEET_MIDDLE` from Task 2.

- [ ] **Step 1: Convert `TripSheet.tsx` to plain content**

Replace the `BottomSheet` wrapper and the render-prop with a plain `View`. Remove the `runOnJS`/`onDragStart`/`onDragEnd` latch (no PanResponder to coordinate with anymore) and the `contentPanHandlers`/`scrollProps`/`setContentBusy` usage. The list header/drag/swipe internals (`CarRow`, `TripRow`, `SwipeActions`, `RowContent`) are unchanged.

New top of file (imports) — drop `BottomSheet`, `runOnJS`:
```tsx
import { type ReactNode } from 'react';
import { Pressable, StyleSheet, Text, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { SymbolView, type SFSymbol } from 'expo-symbols';
import ReorderableList, { useReorderableDrag, type ReorderableListReorderEvent } from 'react-native-reorderable-list';
import Swipeable from 'react-native-gesture-handler/ReanimatedSwipeable';

import { computeItinerary, type ItineraryRow, type Leg, type Trip } from '@/state/trip';

export type TripRowAction = 'copy' | 'share' | 'insert' | 'delete';

interface Props {
  trip: Trip;
  legs: Leg[];
  now: number;
  onAddStop: () => void;
  onAddCharger: () => void;
  onReorder: (from: number, to: number) => void;
  onRowAction: (index: number, action: TripRowAction) => void;
  onLongPressRow: (index: number, anchorY: number) => void;
}

const ICON: Record<ItineraryRow['stop']['kind'], SFSymbol> = { car: 'car.fill', charger: 'bolt.fill', place: 'mappin' };

function hhmm(at: number): string {
  const d = new Date(at);
  return `${d.getHours()}:${String(d.getMinutes()).padStart(2, '0')}`;
}
```

New component body (replaces the old `forwardRef` component; the header + list move out of the render-prop, the list is a direct child so `SheetHost`'s `scrollable` finds the FlatList within 2 levels — keep the header as a sibling above it):
```tsx
export function TripSheetContent({ trip, legs, now, onAddStop, onAddCharger, onReorder, onRowAction, onLongPressRow }: Props) {
  const insetBottom = useSafeAreaInsets().bottom;
  const rows = computeItinerary(trip.stops, legs, now);
  return (
    <View style={styles.content}>
      <View style={styles.header}>
        <Text style={styles.title}>Trip</Text>
        <View style={styles.headerActions}>
          <HeaderButton icon="plus" label="Add Stop" onPress={onAddStop} />
          <HeaderButton icon="bolt.fill" label="Add Charger" tint="#E5484D" onPress={onAddCharger} />
        </View>
      </View>

      <ReorderableList
        data={rows.slice(1)}
        keyExtractor={(row) => row.stop.id}
        onReorder={({ from, to }: ReorderableListReorderEvent) => onReorder(from + 1, to + 1)}
        ListHeaderComponent={<CarRow row={rows[0]} onLongPress={onLongPressRow} onRowAction={onRowAction} />}
        contentContainerStyle={{ paddingBottom: insetBottom + 24 }}
        showsVerticalScrollIndicator={false}
        renderItem={({ item, index }) => (
          <TripRow row={item} index={index + 1} onLongPress={onLongPressRow} onRowAction={onRowAction} />
        )}
      />
    </View>
  );
}
```
Keep `CarRow`, `TripRow`, `RowContent`, `SwipeActions`, `HeaderButton` exactly as they are today (their swipe/long-press/drag internals are unaffected). Delete the old `TRIP_SHEET_FRAC`, `TripSheetHandle`, `FOOTER_CLEARANCE`, `listWrap` style. Update `content`/`header` styles remain.

- [ ] **Step 2: Add `TripFooter` to `TripSheet.tsx`**

The Send-to-Car/Cancel bar moves into the native sheet footer (it can no longer be an RN overlay — a native sheet renders above the RN tree). Add:
```tsx
export function TripFooter({
  totalsLabel,
  onSend,
  onCancel,
}: {
  totalsLabel: string; // e.g. "1h 20m · 95 km"
  onSend: () => void;
  onCancel: () => void;
}) {
  const insetBottom = useSafeAreaInsets().bottom;
  return (
    <View style={[styles.footer, { paddingBottom: insetBottom + 10 }]}>
      <Pressable style={styles.footerSend} onPress={onSend}>
        <Text style={styles.footerSendText}>Send to Car · {totalsLabel}</Text>
      </Pressable>
      <Pressable hitSlop={8} style={styles.footerCancel} onPress={onCancel}>
        <Text style={styles.footerCancelText}>Cancel</Text>
      </Pressable>
    </View>
  );
}
```
Add matching styles (`footer`, `footerSend`, `footerSendText`, `footerCancel`, `footerCancelText`) copied from the old `tripBar`/`tripSendButton`/`tripSendText`/`tripCancelButton`/`tripCancelText` styles in `location.tsx` (move them here since the footer now lives with TripSheet).

- [ ] **Step 3: Render trip content + footer via `SheetHost` in `location.tsx`**

Replace the `screen === 'trip' ? <TripSheet .../> : <LocationSheet .../>` block ([location.tsx:615-660](src/app/location.tsx)) — for this task, host the **trip** branch through `SheetHost`; the Location branch is migrated in Task 4. Introduce one persistent `SheetHost` and switch its children. Change `tripSheetRef` from `TripSheetHandle` to `SheetHostHandle`. Remove the now-obsolete pinned `tripBar` `SafeAreaView` ([location.tsx:676-687](src/app/location.tsx)); its content becomes the `footer`.

Concretely, the trip render becomes:
```tsx
<SheetHost
  ref={tripSheetRef}
  footer={
    trip.trip ? (
      <TripFooter
        totalsLabel={`${formatDuration(tripTotalsVal.durationS)} · ${formatKm(tripTotalsVal.distanceM / 1000)}`}
        onSend={() => {}}
        onCancel={onTripCancel}
      />
    ) : undefined
  }
>
  {trip.trip ? (
    <TripSheetContent
      trip={trip.trip}
      legs={tripLegs}
      now={departAt}
      onAddStop={() => { setPendingInsert(null); setScreen('search'); }}
      onAddCharger={onAddChargerToTrip}
      onReorder={trip.reorder}
      onRowAction={onTripRowAction}
      onLongPressRow={openRowMenu}
    />
  ) : (
    /* Location content — wired in Task 4 */
    <View />
  )}
</SheetHost>
```
Update the import: `import { TripSheetContent, TripFooter, type TripRowAction } from '@/components/TripSheet';` and `import { SheetHost, type SheetHostHandle, SHEET_MIDDLE } from '@/components/SheetHost';`. Present the sheet at `SHEET_MIDDLE` when a trip becomes active (replace the old `tripSheetRef.current?.expand()` call at [location.tsx:167](src/app/location.tsx) with `tripSheetRef.current?.present(SHEET_MIDDLE)`).

- [ ] **Step 4: Typecheck + logic tests**

```bash
npx tsc --noEmit -p tsconfig.json && npm test
```
Expected: no type errors; 64 tests pass.

- [ ] **Step 5: Deploy (JS-only) and device-verify trip mode**

```bash
bash scripts/godot-ios/deploy-js.sh
```
On device, start a trip and confirm: sheet at 50% over an interactive map; swipe-up expands + scrolls to later stops; ≡ reorders; swipe actions + long-press menu work; footer Send/Cancel pinned and functional (Cancel clears the trip). If the long-press `TripRowMenu` (an RN `Modal`) opens correctly over the native sheet, note it; if it renders behind the sheet, record it for Task 6 (may need to become a sheet-hosted overlay or a stacked TrueSheet).

- [ ] **Step 6: Commit**

```bash
git add src/components/TripSheet.tsx src/app/location.tsx
git commit -m "feat(sheet): host Trip content in native SheetHost; footer moves into the sheet"
```

---

## Task 4: Unwrap LocationSheet into plain content + host it (location/charging mode)

**Files:**
- Modify: `src/components/LocationSheet.tsx`
- Modify: `src/app/location.tsx` (location-mode children + charger Navigate bar → footer)

**Interfaces:**
- Produces: `LocationSheetContent` — same props as today's `LocationSheet` **plus** `sheetRef: RefObject<SheetHostHandle>` (used where the old code called `expandFull()`/`collapseToMiddle()`), minus `forwardRef`. Also `ChargerFooter` (the Navigate / Add-to-Trip button).
- Consumes: `SheetHostHandle`, `SHEET_MIDDLE`, `SHEET_FULL` from Task 2.

- [ ] **Step 1: Convert `LocationSheet.tsx` to plain content**

Remove the `BottomSheet` wrapper/render-prop ([LocationSheet.tsx:79-124](src/components/LocationSheet.tsx)). The old render-prop provided `dragHandlers`, `expandFull`, `collapseToMiddle`, `contentPanHandlers`, `scrollProps`:
- `dragHandlers` → **remove** everywhere (native grabber handles dragging). `Header`, `SubSheet`, and `ChargerDetail` drop their `dragHandlers` prop and the `{...dragHandlers}` spread.
- `expandFull()` → `props.sheetRef.current?.resize(SHEET_FULL)`.
- `collapseToMiddle()` → `props.sheetRef.current?.resize(SHEET_MIDDLE)`.
- `contentPanHandlers` → **remove** (delete the wrapping `<View {...contentPanHandlers}>` in `LocationBody`/`ChargingBody`; keep the inner `ScrollView`).
- `scrollProps` → **remove** the `{...scrollProps}` spread on the `ScrollView`s (a plain `ScrollView` under `scrollable` scrolls fine).

New component signature:
```tsx
export function LocationSheetContent({
  tab, onTabChange, chargers, availability, sort, onSortChange, filter, onFilterChange,
  selectedCharger, onSelectCharger, onCloseDetail, onNavigateCharger, query, onChangeQuery,
  results, recentGroups, carCoord, onSelectPlace, onBackToTrip, sheetRef,
}: Props & { sheetRef: React.RefObject<SheetHostHandle> }) {
  const insetBottom = useSafeAreaInsets().bottom;
  const [searchFocused, setSearchFocused] = useState(false);
  const [sortOpen, setSortOpen] = useState(false);
  const inputRef = useRef<TextInput | null>(null);

  const openSearch = () => { setSearchFocused(true); sheetRef.current?.resize(SHEET_FULL); };
  const closeSearch = () => { setSearchFocused(false); sheetRef.current?.resize(SHEET_MIDDLE); };

  if (sortOpen) {
    return (
      <SubSheet title="Sort By" onClose={() => setSortOpen(false)}>
        {SORT_OPTIONS.map((opt) => (
          <RadioRow key={opt.key} label={opt.label} selected={sort === opt.key}
            onPress={() => { onSortChange(opt.key); setSortOpen(false); }} />
        ))}
      </SubSheet>
    );
  }
  if (tab === 'charging' && selectedCharger) {
    return <ChargerDetail charger={selectedCharger} onClose={onCloseDetail} onNavigate={onNavigateCharger} insetBottom={insetBottom} />;
  }
  return (
    <View style={styles.tabContent}>
      <Header tab={tab} onTabChange={onTabChange} onBackToTrip={onBackToTrip} />
      {tab === 'location' ? (
        <LocationBody insetBottom={insetBottom} inputRef={inputRef} focused={searchFocused}
          onOpenSearch={openSearch} onCloseSearch={closeSearch} query={query} onChangeQuery={onChangeQuery}
          results={results} recentGroups={recentGroups} carCoord={carCoord} onSelectPlace={onSelectPlace} />
      ) : (
        <ChargingBody insetBottom={insetBottom} chargers={chargers} availability={availability} sort={sort}
          onOpenSort={() => setSortOpen(true)} filter={filter} onFilterChange={onFilterChange}
          onSelectCharger={onSelectCharger} carCoord={carCoord} />
      )}
    </View>
  );
}
```
Update `Header`, `LocationBody`, `ChargingBody`, `SubSheet`, `ChargerDetail` to drop `dragHandlers`/`contentPanHandlers`/`scrollProps` from their prop types and JSX (mechanical deletions). Delete the now-unused `SheetScrollProps` import and the `scrollList`/wrapper styles that only existed for the pan wrapper (keep `ScrollView` styles).

- [ ] **Step 2: Add `ChargerFooter` (Navigate / Add-to-Trip) to `LocationSheet.tsx`**

The charger detail's action bar (`location.tsx:664-672`) must also move into the sheet footer:
```tsx
export function ChargerFooter({ label, onPress }: { label: string; onPress: () => void }) {
  const insetBottom = useSafeAreaInsets().bottom;
  return (
    <View style={[styles.footer, { paddingBottom: insetBottom + 10 }]}>
      <Pressable style={styles.footerAction} onPress={onPress}>
        <Text style={styles.footerActionText}>{label}</Text>
      </Pressable>
    </View>
  );
}
```
Add `footer`/`footerAction`/`footerActionText` styles (port from `navigateBar`/`navigateButton`/`navigateText` in `location.tsx`).

- [ ] **Step 3: Wire the Location branch + charger footer into the `SheetHost` in `location.tsx`**

Fill in the `SheetHost` children for non-trip mode, and compute the `footer` by mode. Replace the placeholder `<View />` from Task 3 with `LocationSheetContent`, and remove the pinned `navigateBar` `SafeAreaView` ([location.tsx:664-672](src/app/location.tsx)). Merge both branches under one `SheetHost`:
```tsx
<SheetHost
  ref={sheetRef}
  footer={
    screen === 'trip' && trip.trip ? (
      <TripFooter totalsLabel={`${formatDuration(tripTotalsVal.durationS)} · ${formatKm(tripTotalsVal.distanceM / 1000)}`} onSend={() => {}} onCancel={onTripCancel} />
    ) : tab === 'charging' && selectedCharger ? (
      <ChargerFooter label={trip.trip ? 'Add to Trip' : 'Navigate'} onPress={() => onNavigateToCharger(selectedCharger)} />
    ) : undefined
  }
>
  {screen === 'trip' && trip.trip ? (
    <TripSheetContent trip={trip.trip} legs={tripLegs} now={departAt} onAddStop={() => { setPendingInsert(null); setScreen('search'); }} onAddCharger={onAddChargerToTrip} onReorder={trip.reorder} onRowAction={onTripRowAction} onLongPressRow={openRowMenu} />
  ) : (
    <LocationSheetContent
      sheetRef={sheetRef}
      tab={tab} onTabChange={setTab} chargers={listChargers} availability={availability} sort={sort} onSortChange={setSort}
      filter={filter} onFilterChange={setFilter} selectedCharger={selectedCharger} onSelectCharger={onSelectCharger}
      onCloseDetail={onCloseDetail} onNavigateCharger={onNavigateToCharger} query={nav.query} onChangeQuery={nav.setQuery}
      results={nav.results} recentGroups={nav.recentGroups} carCoord={carCoord} onSelectPlace={onSelectPlace}
      onBackToTrip={trip.trip ? () => { setPendingInsert(null); setScreen('trip'); } : undefined}
    />
  )}
</SheetHost>
```
Collapse `tripSheetRef` and `sheetRef` into a single `sheetRef: RefObject<SheetHostHandle>` (there is one sheet now); update the two prior refs and all `.expand()`/`.present()` call sites accordingly. Remove the now-unused `TripSheet`/`LocationSheet` default imports and the `tripBar`/`navigateBar`/`tripSend*`/`tripCancel*`/`navigate*` styles from `location.tsx` (they moved into the components).

- [ ] **Step 4: Typecheck + logic tests**

```bash
npx tsc --noEmit -p tsconfig.json && npm test
```
Expected: no type errors; 64 tests pass.

- [ ] **Step 5: Deploy (JS-only) and device-verify location/charging mode**

```bash
bash scripts/godot-ios/deploy-js.sh
```
On device confirm: Location/Charging tabs; Navigate search focus grows the sheet to full and blur returns to middle; charging list scrolls + expands; charger detail opens with the Navigate/Add-to-Trip footer pinned; ‹ Trip button returns to the trip sheet; map interactive throughout.

- [ ] **Step 6: Commit**

```bash
git add src/components/LocationSheet.tsx src/app/location.tsx
git commit -m "feat(sheet): host Location/Charging content in native SheetHost; charger action → footer"
```

---

## Task 5: Delete `BottomSheet.tsx` and dead code

**Files:**
- Delete: `src/components/BottomSheet.tsx`
- Modify: any remaining importers surfaced by grep

**Interfaces:**
- Consumes: nothing new.

- [ ] **Step 1: Confirm no remaining consumers**

```bash
grep -rn "BottomSheet\|SheetScrollProps\|SHEET_MIDDLE_FRAC\|SHEET_MINIMAL_FRAC\|TRIP_SHEET_FRAC" src/ | grep -v "SheetHost"
```
Expected: no matches outside `SheetHost.tsx`. If any remain (e.g., a stale import of `TRIP_SHEET_FRAC` for map edge-padding in `location.tsx`), replace the padding constant with a literal fraction (e.g. `0.5`) or `SHEET_DETENTS[SHEET_MIDDLE]` and fix the import.

- [ ] **Step 2: Delete the file**

```bash
git rm src/components/BottomSheet.tsx
```

- [ ] **Step 3: Typecheck + tests**

```bash
npx tsc --noEmit -p tsconfig.json && npm test
```
Expected: no type errors; 64 tests pass.

- [ ] **Step 4: Commit**

```bash
git add -A && git commit -m "chore(sheet): remove hand-rolled BottomSheet (superseded by native SheetHost)"
```

---

## Task 6: Remove the spike, full device verification pass

**Files:**
- Delete: `src/app/spike-sheet.tsx`
- Modify: `src/app/location.tsx` only if the long-press menu needs re-hosting

**Interfaces:** none.

- [ ] **Step 1: Remove the throwaway spike route**

```bash
git rm src/app/spike-sheet.tsx
```
Restore the app's normal initial route if it was pointed at the spike in Task 1.

- [ ] **Step 2: Resolve the long-press `TripRowMenu` over the native sheet (only if Task 3.5 flagged it)**

If the `TripRowMenu` `Modal` rendered behind the native sheet, host it as content inside the sheet instead of a top-level `Modal`, or present it as a small stacked `TrueSheet`. Implement whichever the device test showed is needed; if the `Modal` displayed correctly over the native sheet, skip this step.

- [ ] **Step 3: Deploy + full verification checklist (device)**

```bash
bash scripts/godot-ios/deploy-js.sh
```
Confirm end-to-end:
- [ ] Location ↔ Charging ↔ Trip transitions keep one continuous sheet (no dismiss/re-present flash).
- [ ] Trip: swipe-up expand + scroll, ≡ reorder, swipe Share/Insert/Delete, long-press menu, footer Send/Cancel.
- [ ] Charging: list scroll/expand, sort overlay, charger detail + footer, availability badges.
- [ ] Location: search focus→full, recents, select place, ‹ Trip.
- [ ] Map pan/tap works at the resting detent in every mode.
- [ ] Add Stop / Add Charger flows still fit the map and honor insert position (regression from prior work).

- [ ] **Step 4: Final commit**

```bash
git add -A && git commit -m "chore(sheet): remove spike route; native sheet migration complete"
```

---

## Self-Review

**Spec coverage:** library choice + pinned version (Task 1) ✅; no-prebuild install (Task 1) ✅; spike + gate + fallback (Task 1) ✅; one persistent TrueSheet hosting all modes (Tasks 3–4) ✅; unwrap Location/Trip content, delete BottomSheet + plumbing (Tasks 3–5) ✅; remove onDragStart/onDragEnd latch (Task 3) ✅; detents/dimmed/footer/styling (Task 2) ✅; footers moved into native `footer` (Tasks 3–4) ✅; keep-mounted to avoid #686 (single persistent SheetHost, Tasks 3–4) ✅; logic tests green (every task) ✅.

**Placeholder scan:** the only `/* … */` is the deliberate Task-3 placeholder `<View />` explicitly replaced in Task 4. Prop names are pinned to the installed types in Task 1.2. No TBDs.

**Type consistency:** `SheetHostHandle` (`present`/`resize`/`dismiss`), `SHEET_DETENTS`/`SHEET_MINIMAL`/`SHEET_MIDDLE`/`SHEET_FULL`, `TripSheetContent`/`TripFooter`, `LocationSheetContent`/`ChargerFooter` are used consistently across Tasks 2–5. `expand()` → `present(SHEET_MIDDLE)`/`resize(index)` conversions are called out at each call site.

**Contingency:** Tasks 2–6 execute only if Task 1's gate is green; otherwise switch to the Option A fallback (spec §Fallback).
