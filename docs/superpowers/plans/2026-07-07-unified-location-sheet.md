# Unified Location Sheet Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Merge the Location sheet's Recents/Charging panels into one sheet with persistent top tabs (`Location | Charging`), a ‹ Trip back button (when a trip is active), and a simplified Charging control row — dropping the `addingCharger` flag and the standalone Filter button.

**Architecture:** `LocationSheet` renders one shared frame: a persistent header (optional ‹ Trip + always-visible tabs) over a tab-switched body (Location = search + results/recents; Charging = Sort/DC/AC + list). Charger detail + Sort sub-sheet remain as overlays. `location.tsx` renames the tab value, wires `onBackToTrip`, and derives the charger action label from trip existence.

**Tech Stack:** React Native, TypeScript. **JS-only — no new deps, no rebuild.**

## Global Constraints

- **JS-only.** `deploy-js.sh`. No new dependencies, no `expo prebuild`.
- **Tab value renamed** `'recents'` → `'location'` (type + all usages).
- **Tabs always visible** (both tabs, both states, including on search-focus). Search-focus still grows the sheet to full but no longer hides the tabs.
- **Drop** the standalone Filter button + its "Available only" sub-sheet, and the "Nearby Chargers" title.
- **‹ Trip** renders only when `onBackToTrip` is provided (i.e. a trip is active).
- Charger action label = `trip ? 'Add to Trip' : 'Navigate'` (no `addingCharger` flag).
- **Device:** CoreDevice `F3867E6E-E95F-5B2A-9C4E-06D1D72475A1`, bundle `local.airgapp.mobile`.

## File Structure

```
  src/components/LocationSheet.tsx   MODIFY  unified header + tabs + tab-switched body; drop Filter/title; add onBackToTrip
  src/app/location.tsx               MODIFY  tab rename; onBackToTrip; drop addingCharger; charger label; simplify handlers
```

**Type/name contract:**
- `LocationTab = 'location' | 'charging'` (Task 1).
- `LocationSheet` gains prop `onBackToTrip?: () => void` and `navigateLabel: string` (Task 1); consumed in Task 2.

---

### Task 1: Restructure LocationSheet (unified tabs + ‹ Trip)

**Files:** Modify `src/components/LocationSheet.tsx`.

**Interfaces:** Reuses the existing `SearchField`, `PlaceRow`, `ChargerRow`, `ChargerDetail`, `SubSheet`, `RadioRow`, `BoltButton`, `AvailabilityBadge`, `SORT_OPTIONS` and `styles` unchanged. Produces the new top-level component + `Header` / `LocationBody` / `ChargingBody`.

- [ ] **Step 1: Rename the tab type** — change:

```ts
export type LocationTab = 'location' | 'charging';
```

- [ ] **Step 2: Add the two new props** to `interface Props` (after `onSelectPlace`):

```ts
  // Charger-detail primary action label ("Navigate" normally, "Add to Trip" while a trip is active).
  navigateLabel: string;
  // When provided (a trip is active), render a ‹ Trip button that returns to the trip panel.
  onBackToTrip?: () => void;
```

- [ ] **Step 3: Replace the top-level component body** (the `forwardRef` render, from `const insetBottom =` through the closing `});` of `LocationSheet`) with the unified frame:

```tsx
export const LocationSheet = forwardRef<LocationSheetHandle, Props>(function LocationSheet(
  { tab, onTabChange, chargers, availability, sort, onSortChange, filter, onFilterChange, selectedCharger, onSelectCharger, onCloseDetail, onNavigateCharger, query, onChangeQuery, results, recentGroups, carCoord, onSelectPlace, navigateLabel, onBackToTrip },
  ref,
) {
  const insetBottom = useSafeAreaInsets().bottom;
  const [searchFocused, setSearchFocused] = useState(false);
  const [sortOpen, setSortOpen] = useState(false);
  const inputRef = useRef<TextInput | null>(null);

  return (
    <BottomSheet ref={ref}>
      {({ dragHandlers, expandFull, collapseToMiddle }) => {
        const openSearch = () => {
          setSearchFocused(true);
          expandFull();
        };
        const closeSearch = () => {
          setSearchFocused(false);
          collapseToMiddle();
        };

        // Sort options overlay (Charging).
        if (sortOpen) {
          return (
            <SubSheet title="Sort By" onClose={() => setSortOpen(false)}>
              {SORT_OPTIONS.map((opt) => (
                <RadioRow
                  key={opt.key}
                  label={opt.label}
                  selected={sort === opt.key}
                  onPress={() => {
                    onSortChange(opt.key);
                    setSortOpen(false);
                  }}
                />
              ))}
            </SubSheet>
          );
        }

        // Charger detail overlay (Charging + a selected charger).
        if (tab === 'charging' && selectedCharger) {
          return (
            <ChargerDetail
              charger={selectedCharger}
              availability={availability}
              onClose={onCloseDetail}
              onNavigate={onNavigateCharger}
              navigateLabel={navigateLabel}
              dragHandlers={dragHandlers}
              insetBottom={insetBottom}
            />
          );
        }

        return (
          <View style={styles.tabContent}>
            <Header dragHandlers={dragHandlers} tab={tab} onTabChange={onTabChange} onBackToTrip={onBackToTrip} />
            {tab === 'location' ? (
              <LocationBody
                insetBottom={insetBottom}
                inputRef={inputRef}
                focused={searchFocused}
                onFocus={openSearch}
                onExit={closeSearch}
                query={query}
                onChangeQuery={onChangeQuery}
                results={results}
                recentGroups={recentGroups}
                carCoord={carCoord}
                onSelectPlace={onSelectPlace}
              />
            ) : (
              <ChargingBody
                insetBottom={insetBottom}
                chargers={chargers}
                filter={filter}
                onFilterChange={onFilterChange}
                onOpenSort={() => setSortOpen(true)}
                onSelectCharger={onSelectCharger}
              />
            )}
          </View>
        );
      }}
    </BottomSheet>
  );
});

// Persistent header: an optional ‹ Trip back button + the always-visible Location | Charging tabs. Draggable.
function Header({
  dragHandlers,
  tab,
  onTabChange,
  onBackToTrip,
}: {
  dragHandlers: GestureResponderHandlers;
  tab: LocationTab;
  onTabChange: (t: LocationTab) => void;
  onBackToTrip?: () => void;
}) {
  return (
    <View {...dragHandlers} style={styles.headerBar}>
      {onBackToTrip ? (
        <Pressable style={styles.backToTrip} hitSlop={8} onPress={onBackToTrip}>
          <SymbolView name="chevron.left" tintColor="#3E6AE1" size={16} weight="semibold" />
          <Text style={styles.backToTripText}>Trip</Text>
        </Pressable>
      ) : null}
      <View style={styles.tabs}>
        <Pressable style={styles.tab} onPress={() => onTabChange('location')}>
          <Text style={[styles.tabLabel, tab === 'location' ? styles.tabActive : styles.tabInactive]}>Location</Text>
        </Pressable>
        <View style={styles.tabDivider} />
        <Pressable style={styles.tab} onPress={() => onTabChange('charging')}>
          <Text style={[styles.tabLabel, tab === 'charging' ? styles.tabActive : styles.tabInactive]}>Charging</Text>
        </Pressable>
      </View>
    </View>
  );
}
```

- [ ] **Step 4: Replace `RecentsView` with `LocationBody`** (search field + results/recents, no tabs — the tabs are now in `Header`). Replace the entire `RecentsView` function with:

```tsx
function LocationBody({
  insetBottom,
  inputRef,
  focused,
  onFocus,
  onExit,
  query,
  onChangeQuery,
  results,
  recentGroups,
  carCoord,
  onSelectPlace,
}: {
  insetBottom: number;
  inputRef: RefObject<TextInput | null>;
  focused: boolean;
  onFocus: () => void;
  onExit: () => void;
  query: string;
  onChangeQuery: (text: string) => void;
  results: Place[];
  recentGroups: RecentGroup[];
  carCoord: LatLng;
  onSelectPlace: (place: Place) => void;
}) {
  const typing = focused && query.trim().length > 0;
  const clear = () => {
    if (query.length > 0) {
      onChangeQuery('');
    } else {
      inputRef.current?.blur();
      onExit();
    }
  };
  const select = (place: Place) => {
    onSelectPlace(place);
    inputRef.current?.blur();
    onExit();
  };

  return (
    <>
      <SearchField inputRef={inputRef} focused={focused} query={query} onChangeQuery={onChangeQuery} onFocus={onFocus} onClear={clear} />
      <ScrollView
        style={styles.scrollList}
        contentContainerStyle={[styles.list, { paddingBottom: insetBottom + 24 }]}
        showsVerticalScrollIndicator={false}
        keyboardShouldPersistTaps="handled"
      >
        {typing
          ? results.map((place) => <PlaceRow key={place.id} place={place} carCoord={carCoord} onPress={() => select(place)} />)
          : recentGroups.map((group) => (
              <View key={group.title}>
                <View style={styles.groupHeader}>
                  <Text style={styles.groupTitle}>{group.title}</Text>
                  <View style={styles.groupLine} />
                </View>
                {group.items.map((place) => (
                  <PlaceRow key={place.id} place={place} carCoord={carCoord} onPress={() => select(place)} />
                ))}
              </View>
            ))}
      </ScrollView>
    </>
  );
}
```

- [ ] **Step 5: Replace `ChargingView` with `ChargingBody`** (controls `Sort By · DC · AC` + list; no "Nearby Chargers" title, no Filter button, no detail/sub logic — those moved to the top level). Replace the entire `ChargingView` function (keep `ChargingSubMode` deletion — it's unused now) with:

```tsx
function ChargingBody({
  insetBottom,
  chargers,
  filter,
  onFilterChange,
  onOpenSort,
  onSelectCharger,
}: {
  insetBottom: number;
  chargers: Charger[];
  filter: ChargerFilter;
  onFilterChange: (f: ChargerFilter) => void;
  onOpenSort: () => void;
  onSelectCharger: (c: Charger) => void;
}) {
  return (
    <>
      <View style={styles.controlsRow}>
        <Pressable style={styles.sortButton} onPress={onOpenSort}>
          <Text style={styles.sortLabel}>Sort By</Text>
          <SymbolView name="chevron.down" tintColor="rgba(255,255,255,0.6)" size={13} weight="semibold" />
        </Pressable>
        <BoltButton bolts={3} active={filter.dc} onPress={() => onFilterChange({ ...filter, dc: !filter.dc })} />
        <BoltButton bolts={1} active={filter.ac} onPress={() => onFilterChange({ ...filter, ac: !filter.ac })} />
      </View>

      {chargers.length === 0 ? (
        <Text style={styles.emptyText}>No chargers in this area</Text>
      ) : (
        <ScrollView
          style={styles.scrollList}
          contentContainerStyle={[styles.list, { paddingBottom: insetBottom + 24 }]}
          showsVerticalScrollIndicator={false}
        >
          {chargers.map((c) => (
            <ChargerRow key={c.id} charger={c} badge={chargerBadge(c)} onPress={() => onSelectCharger(c)} />
          ))}
        </ScrollView>
      )}
    </>
  );
}
```

Also **delete** the now-unused `type ChargingSubMode` line, the `ToggleRow` component and the `SORT_OPTIONS`-adjacent Filter `SubSheet` (only the Sort `SubSheet` is used, at the top level now). Leave `SubSheet`, `RadioRow`, `SORT_OPTIONS`, `BoltButton`, `ChargerRow`, `ChargerDetail` intact.

- [ ] **Step 6: Give `ChargerDetail` a `navigateLabel` prop.** In the `ChargerDetail` function signature add `navigateLabel: string` and use it for the action button text. Find the detail's navigate control (the `Pressable` that calls `onNavigate(charger)`) and render `{navigateLabel}` as its label (it currently shows the distance pill — add the label text next to / in place of it per the existing layout; the button already exists). Also add `navigateLabel: string;` to `ChargerDetail`'s prop type.

- [ ] **Step 7: Add the header styles** — in the `StyleSheet.create({...})` add:

```ts
  headerBar: { flexDirection: 'row', alignItems: 'center', marginTop: 4 },
  backToTrip: { flexDirection: 'row', alignItems: 'center', gap: 2, position: 'absolute', left: 12, zIndex: 1 },
  backToTripText: { fontSize: 16, color: '#3E6AE1', fontWeight: '600' },
```

Adjust the existing `tabs` style so it centers under the header regardless of the back button: change `tabs` to include `flex: 1` (it already lays out the two tabs with `flex: 1` children). Keep `tab`, `tabDivider`, `tabLabel`, `tabActive`, `tabInactive`. (The old `chargingHeader`, `chargingTitle`, `filterButton` styles become unused — leave or remove; removing is tidier.)

- [ ] **Step 8: Typecheck**

Run: `npx tsc --noEmit -p tsconfig.json`
Expected: errors ONLY in `location.tsx` (missing `navigateLabel`, `'recents'` value, removed props) — those are Task 2. `LocationSheet.tsx` itself should be error-free.

- [ ] **Step 9: Commit**

```bash
git add src/components/LocationSheet.tsx
git commit -m "feat(location): unified sheet — persistent Location|Charging tabs + ‹ Trip, drop Filter/title"
```

---

### Task 2: Wire `location.tsx`

**Files:** Modify `src/app/location.tsx`.

- [ ] **Step 1: Rename the tab value.** Change the initial state and the charging-tab handler:

```tsx
  const [tab, setTab] = useState<LocationTab>('location');
```
and in `onChargingTab` keep `setTab('charging')` (unchanged). Search the file for any other `'recents'` literal and change to `'location'` (e.g. the charger-detail close path).

- [ ] **Step 2: Remove the `addingCharger` machinery.** Delete the `const [addingCharger, setAddingCharger] = useState(false);` line and the `onTabChangeFromLocation` function. Simplify `onAddChargerToTrip`:

```tsx
  const onAddChargerToTrip = () => {
    if (!trip.trip) return;
    mapRef.current?.fitToCoordinates(trip.trip.stops.map((s) => s.coordinate), {
      edgePadding: { top: 80, right: 40, bottom: Math.round(height * (SHEET_MIDDLE_FRAC - SHEET_MINIMAL_FRAC)), left: 40 },
      animated: true,
    });
    setTab('charging');
    setScreen('search');
  };
```

- [ ] **Step 2b: Simplify `onNavigateToCharger`** — branch purely on trip existence:

```tsx
  const onNavigateToCharger = (c: Charger) => {
    Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Medium).catch(() => {});
    if (trip.trip) {
      trip.addCharger(c);
      onCloseDetail();
      setTab('location');
      setScreen('trip');
      return;
    }
    onSelectPlace({ id: `charger:${c.id}`, title: c.name, subtitle: c.region || c.place, coordinate: { latitude: c.latitude, longitude: c.longitude }, kind: 'charger', source: 'charger' });
  };
```

- [ ] **Step 3: Pass the new props to `<LocationSheet>`.** Change `onTabChange={onTabChangeFromLocation}` back to `onTabChange={setTab}`, and add:

```tsx
          navigateLabel={trip.trip ? 'Add to Trip' : 'Navigate'}
          onBackToTrip={trip.trip ? () => setScreen('trip') : undefined}
```

- [ ] **Step 4: Simplify the pinned charging action bar** (it no longer needs the `addingCharger` branch — the label comes from the sheet detail now; keep the two-button `Add Stop` / `Navigate` bar as it was pre-`addingCharger`). Replace the `{addingCharger ? … : …}` block with the plain two buttons, and relabel the primary to match:

```tsx
          <View style={styles.navigateRow}>
            <Pressable style={styles.navigateButton} onPress={onAddStop}>
              <Text style={styles.navigateText}>Add Stop</Text>
            </Pressable>
            <Pressable style={styles.navigateButton} onPress={() => onNavigateToCharger(selectedCharger)}>
              <Text style={styles.navigateText}>{trip.trip ? 'Add to Trip' : 'Navigate'}</Text>
            </Pressable>
          </View>
```

- [ ] **Step 5: Typecheck + tests**

Run: `npx tsc --noEmit -p tsconfig.json && npm test`
Expected: clean; all tests pass.

- [ ] **Step 6: Commit**

```bash
git add src/app/location.tsx
git commit -m "feat(location): wire unified sheet — Location tab, ‹ Trip, Add-to-Trip label; drop addingCharger"
```

---

### Task 3: Deploy + verify

- [ ] **Step 1: JS deploy** — `bash scripts/godot-ios/deploy-js.sh` → `✓ done`.

- [ ] **Step 2: On-device check:**
  1. Open Location → **Location | Charging** tabs on top, always visible; **Location** shows the search box + recents.
  2. Tap the search box → sheet grows, keyboard up, **tabs stay visible**; typing shows results; ✕ clears/exits.
  3. Tap **Charging** → **Sort By · DC · AC** + charger list (no "Nearby Chargers" title, no Filter button). Sort By opens the sort options; DC/AC toggle.
  4. Tap a charger → detail; its action reads **Navigate** (no trip) / **Add to Trip** (trip active).
  5. Build a trip → **Add Stop** opens Location tab, **Add Charger** opens Charging tab; **switch tabs freely**; **‹ Trip** returns to the trip without adding.
  6. Add-to-Trip appends a charger and returns to the trip.

- [ ] **Step 3: Commit** (only if a tweak was needed).

---

## Self-Review

**Spec coverage:** persistent `Location | Charging` tabs → Task 1 `Header`. Location = search + results/recents → `LocationBody`. Charging = Sort/DC/AC + list, no title/Filter → `ChargingBody`. Charger detail + Add-to-Trip/Navigate label → Task 1 Step 6 + Task 2. Search-focus keeps tabs → Task 1 (tabs in `Header`, `LocationBody` no longer renders tabs). ‹ Trip → Task 1 `Header` + Task 2 `onBackToTrip`. Drop `addingCharger` → Task 2. Rename `'recents'`→`'location'` → Tasks 1–2. Free tab-switching while adding → inherent (both tabs in one sheet). ✓

**Placeholder scan:** none — full component code given; reused sub-components named explicitly. Step 6 references the existing `ChargerDetail` navigate control by its existing `onNavigate` call (concrete anchor), adding a `navigateLabel` prop.

**Type consistency:** `LocationTab = 'location' | 'charging'` used in `Header`, `LocationSheet`, and `location.tsx` (`useState<LocationTab>('location')`, `setTab('charging')`). `navigateLabel: string` + `onBackToTrip?: () => void` defined on `Props` (Task 1) and passed in Task 2. `LocationBody`/`ChargingBody`/`Header` prop shapes match their call sites. Reused `SearchField`/`PlaceRow`/`ChargerRow`/`ChargerDetail`/`SubSheet`/`RadioRow`/`BoltButton`/`SORT_OPTIONS` keep their existing signatures (only `ChargerDetail` gains `navigateLabel`). ✓

---

## Execution Handoff

Plan complete — JS-only (`deploy-js.sh`, no rebuild). Task 1 is the `LocationSheet` restructure (typecheck), Task 2 the `location.tsx` wiring (typecheck + tests), Task 3 the deploy + on-device check. Note: the earlier **Copy/`expo-clipboard` rebuild** is still pending and folds into a single `xcodebuild` after this lands.
