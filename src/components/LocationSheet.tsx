import { forwardRef, useRef, useState, type ReactNode, type RefObject } from 'react';
import {
  Linking,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  View,
  type GestureResponderHandlers,
} from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { SymbolView, type SFSymbol } from 'expo-symbols';

import { BottomSheet, type BottomSheetHandle } from './BottomSheet';

import { busyTimesFor, distanceMeters, formatKm, type LatLng } from '@/state/mockLocation';
import type { Place } from '@/services/place';
import type { RecentGroup } from '@/services/recents';
import {
  chargerBadge,
  formatOpeningHours,
  type Charger,
  type ChargerBadge,
  type ConnectorGroup,
  type StationAvailability,
} from '@/services/tomtom';

export type LocationTab = 'location' | 'charging';
export type ChargerSort = 'distance' | 'availability' | 'price';
export interface ChargerFilter {
  dc: boolean;
  ac: boolean;
  availableOnly: boolean;
}

// The sheet chrome (detents, drag, handle) lives in BottomSheet now; re-export the detent fractions the map
// uses for padding, and alias the handle type.
export { SHEET_MIDDLE_FRAC, SHEET_MINIMAL_FRAC } from './BottomSheet';
export type LocationSheetHandle = BottomSheetHandle;

interface Props {
  tab: LocationTab;
  onTabChange: (tab: LocationTab) => void;
  chargers: Charger[];
  availability: Record<string, StationAvailability>;
  sort: ChargerSort;
  onSortChange: (sort: ChargerSort) => void;
  filter: ChargerFilter;
  onFilterChange: (filter: ChargerFilter) => void;
  // Charger detail: a selected charger shows the detail view instead of the list; the map's Navigate
  // button (rendered by the screen) drives the actual maps hand-off.
  selectedCharger: Charger | null;
  onSelectCharger: (charger: Charger) => void;
  onCloseDetail: () => void;
  onNavigateCharger: (charger: Charger) => void; // maps hand-off (detail distance pill)
  // Navigate search (Location tab): live query + Apple/local results + persisted recents + car pos for distance.
  query: string;
  onChangeQuery: (text: string) => void;
  results: Place[];
  recentGroups: RecentGroup[];
  carCoord: LatLng;
  onSelectPlace: (place: Place) => void;
  // When provided (a trip is active), render a ‹ Trip button that returns to the trip panel.
  onBackToTrip?: () => void;
}

// Tesla Location bottom sheet: one frame with a persistent header (optional ‹ Trip + always-visible
// Location | Charging tabs) over a tab-switched body. Sort options + charger detail are overlays.
export const LocationSheet = forwardRef<LocationSheetHandle, Props>(function LocationSheet(
  { tab, onTabChange, chargers, availability, sort, onSortChange, filter, onFilterChange, selectedCharger, onSelectCharger, onCloseDetail, onNavigateCharger, query, onChangeQuery, results, recentGroups, carCoord, onSelectPlace, onBackToTrip },
  ref,
) {
  const insetBottom = useSafeAreaInsets().bottom;
  const [searchFocused, setSearchFocused] = useState(false);
  const [sortOpen, setSortOpen] = useState(false);
  const inputRef = useRef<TextInput | null>(null);

  return (
    <BottomSheet ref={ref}>
      {({ dragHandlers, expandFull, collapseToMiddle }) => {
        // Focusing the Navigate field grows the sheet to full; the tabs stay visible.
        const openSearch = () => {
          setSearchFocused(true);
          expandFull();
        };
        const closeSearch = () => {
          setSearchFocused(false);
          collapseToMiddle();
        };

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

        if (tab === 'charging' && selectedCharger) {
          return (
            <ChargerDetail
              charger={selectedCharger}
              availability={availability}
              onClose={onCloseDetail}
              onNavigate={onNavigateCharger}
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

// --- Location tab body (search + results/recents) ----------------------------------------------

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
      onChangeQuery(''); // clear, stay focused
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
      <SearchField
        inputRef={inputRef}
        focused={focused}
        query={query}
        onChangeQuery={onChangeQuery}
        onFocus={onFocus}
        onClear={clear}
      />

      <ScrollView
        style={styles.scrollList}
        contentContainerStyle={[styles.list, { paddingBottom: insetBottom + 24 }]}
        showsVerticalScrollIndicator={false}
        keyboardShouldPersistTaps="handled"
      >
        {typing
          ? results.map((place) => (
              <PlaceRow key={place.id} place={place} carCoord={carCoord} onPress={() => select(place)} />
            ))
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

// The Navigate field: magnifier + a TextInput with a floating "Navigate" label (shown once there is text),
// and an ✕ (clear text, or exit search when already empty) while focused.
function SearchField({
  inputRef,
  focused,
  query,
  onChangeQuery,
  onFocus,
  onClear,
}: {
  inputRef: RefObject<TextInput | null>;
  focused: boolean;
  query: string;
  onChangeQuery: (text: string) => void;
  onFocus: () => void;
  onClear: () => void;
}) {
  return (
    <View style={styles.searchField}>
      <SymbolView name="magnifyingglass" tintColor="rgba(255,255,255,0.5)" size={18} />
      <View style={styles.searchInputWrap}>
        {query.length > 0 ? <Text style={styles.searchFloatLabel}>Navigate</Text> : null}
        <TextInput
          ref={inputRef}
          style={styles.searchInput}
          value={query}
          onChangeText={onChangeQuery}
          onFocus={onFocus}
          placeholder="Navigate"
          placeholderTextColor="rgba(255,255,255,0.5)"
          returnKeyType="search"
          autoCorrect={false}
          autoCapitalize="none"
          clearButtonMode="never"
        />
      </View>
      {focused ? (
        <Pressable hitSlop={10} onPress={onClear}>
          <SymbolView name="xmark" tintColor="rgba(255,255,255,0.6)" size={18} weight="medium" />
        </Pressable>
      ) : null}
    </View>
  );
}

// One row for both autocomplete results and recents: bold title, gray subtitle (1 line), distance pill.
function PlaceRow({ place, carCoord, onPress }: { place: Place; carCoord: LatLng; onPress: () => void }) {
  const km = place.coordinate ? formatKm(distanceMeters(carCoord, place.coordinate) / 1000) : '';
  return (
    <Pressable style={({ pressed }) => [styles.row, { opacity: pressed ? 0.6 : 1 }]} onPress={onPress}>
      <View style={styles.rowText}>
        <Text style={styles.rowName} numberOfLines={1}>
          {place.title}
        </Text>
        {place.subtitle ? (
          <Text style={styles.rowAddress} numberOfLines={1}>
            {place.subtitle}
          </Text>
        ) : null}
      </View>
      {km ? (
        <View style={styles.distancePill}>
          <SymbolView name="mappin" tintColor="rgba(255,255,255,0.55)" size={18} />
          <Text style={styles.distanceText}>{km}</Text>
        </View>
      ) : null}
    </Pressable>
  );
}

// --- Charging tab body (Sort By · DC · AC controls + list) --------------------------------------

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

function ChargerRow({ charger, badge, onPress }: { charger: Charger; badge: ChargerBadge; onPress: () => void }) {
  const price = charger.pricePerKWh != null ? `€${charger.pricePerKWh.toFixed(2)}/kWh` : null;
  return (
    <Pressable style={({ pressed }) => [styles.row, { opacity: pressed ? 0.6 : 1 }]} onPress={onPress}>
      <View style={styles.rowText}>
        <Text style={styles.rowName} numberOfLines={1}>
          {charger.name}
        </Text>
        <Text style={styles.rowAddress} numberOfLines={1}>
          {charger.place} · {charger.region}
        </Text>
        <Text style={styles.chargerMeta} numberOfLines={1}>
          {[price, `${charger.maxPowerKW} kW`, charger.currentType].filter(Boolean).join(' · ')}
        </Text>
      </View>
      <View style={styles.distancePill}>
        <AvailabilityBadge badge={badge} />
        <Text style={styles.distanceText}>{formatKm(charger.distanceM / 1000)}</Text>
      </View>
    </Pressable>
  );
}

// Badge mirroring the map pins: colour = DC red-by-power / AC grey; text = available slots ("N?"/"?" when
// unknown).
function AvailabilityBadge({ badge }: { badge: ChargerBadge }) {
  return (
    <View style={[styles.availBadge, { backgroundColor: badge.color }]}>
      <SymbolView name="bolt.fill" tintColor="white" size={11} />
      <Text style={styles.availText}>{badge.text}</Text>
    </View>
  );
}

function BoltButton({ bolts, active, onPress }: { bolts: number; active: boolean; onPress: () => void }) {
  return (
    <Pressable style={[styles.boltButton, active && styles.boltButtonActive]} onPress={onPress}>
      {Array.from({ length: bolts }).map((_, i) => (
        <SymbolView key={i} name="bolt.fill" tintColor={active ? 'white' : 'rgba(255,255,255,0.5)'} size={15} />
      ))}
    </Pressable>
  );
}

// --- Charger detail -----------------------------------------------------------------------------

function ChargerDetail({
  charger,
  availability,
  onClose,
  onNavigate,
  dragHandlers,
  insetBottom,
}: {
  charger: Charger;
  availability: Record<string, StationAvailability>;
  onClose: () => void;
  onNavigate: (c: Charger) => void;
  dragHandlers: GestureResponderHandlers;
  insetBottom: number;
}) {
  const info = availability[charger.id];
  const availText = info
    ? `${info.available} of ${info.total} stalls available now`
    : charger.totalConnectors > 0
      ? `${charger.totalConnectors} ${charger.totalConnectors === 1 ? 'stall' : 'stalls'}`
      : 'Availability unknown';
  const hours = formatOpeningHours(charger.openingHours);

  return (
    <View style={styles.tabContent}>
      {/* Header is draggable (moves the sheet). */}
      <View {...dragHandlers} style={styles.detailHeader}>
        <View style={styles.detailTopRow}>
          <View style={styles.detailNetwork}>
            <SymbolView name="bolt.fill" tintColor="#E5484D" size={15} />
            <Text style={styles.detailNetworkText} numberOfLines={1}>
              {charger.name}
            </Text>
          </View>
          <Pressable hitSlop={10} onPress={onClose}>
            <SymbolView name="xmark" tintColor="rgba(255,255,255,0.7)" size={20} weight="medium" />
          </Pressable>
        </View>
        <Text style={styles.detailTitle} numberOfLines={1}>
          {charger.region}
        </Text>
        <Text style={styles.detailPlace} numberOfLines={1}>
          {charger.place}
        </Text>
      </View>

      <ScrollView
        style={styles.scrollList}
        contentContainerStyle={{ paddingTop: 18, paddingBottom: insetBottom + 96 }}
        showsVerticalScrollIndicator={false}
      >
        <View style={styles.detailBlock}>
          <Text style={styles.detailAvail}>{availText}</Text>
          <Text style={styles.detailPower}>{charger.maxPowerKW} kW max</Text>
        </View>

        {charger.connectors.length > 0 ? (
          <>
            <View style={styles.detailDivider} />
            <View style={styles.detailBlock}>
              <Text style={styles.detailSectionTitle}>Connectors</Text>
              <View style={styles.connectorList}>
                {charger.connectors.map((g, i) => (
                  <ConnectorRow key={i} group={g} />
                ))}
              </View>
            </View>
          </>
        ) : null}

        <View style={styles.detailDivider} />

        <View style={styles.detailBlock}>
          <Text style={styles.detailSectionTitle}>Busy Times</Text>
          <BusyTimesChart weights={busyTimesFor(charger.id)} />
        </View>

        {charger.pricePerKWh != null ? (
          <>
            <View style={styles.detailDivider} />
            <View style={[styles.detailBlock, styles.feesRow]}>
              <Text style={styles.detailSectionTitle}>Charging Fees</Text>
              <Text style={styles.feesValue}>€{charger.pricePerKWh.toFixed(2)}/kWh</Text>
            </View>
          </>
        ) : null}

        {hours || charger.phone || charger.website ? (
          <>
            <View style={styles.detailDivider} />
            <View style={styles.detailBlock}>
              {hours ? <InfoRow icon="clock" text={hours} /> : null}
              {charger.phone ? (
                <InfoRow icon="phone.fill" text={charger.phone} onPress={() => Linking.openURL(`tel:${charger.phone}`)} />
              ) : null}
              {charger.website ? (
                <InfoRow
                  icon="safari"
                  text="Website"
                  onPress={() => {
                    if (charger.website) Linking.openURL(charger.website);
                  }}
                />
              ) : null}
            </View>
          </>
        ) : null}

        <View style={styles.detailDivider} />

        <View style={[styles.detailBlock, styles.addressRow]}>
          <View style={styles.addressText}>
            <Text style={styles.addressPlace}>{charger.place}</Text>
            <Text style={styles.addressSub}>{charger.region}</Text>
          </View>
          {/* Tapping the distance pill navigates to the station. */}
          <Pressable
            style={({ pressed }) => [styles.distancePill, { opacity: pressed ? 0.6 : 1 }]}
            onPress={() => onNavigate(charger)}
          >
            <SymbolView name="arrow.turn.up.right" tintColor="rgba(255,255,255,0.7)" size={17} />
            <Text style={styles.distanceText}>{formatKm(charger.distanceM / 1000)}</Text>
          </Pressable>
        </View>
      </ScrollView>
    </View>
  );
}

// Mock popular-times histogram: 24 bars starting at 4a (…→3a), current hour highlighted white.
function BusyTimesChart({ weights }: { weights: number[] }) {
  const order = Array.from({ length: 24 }, (_, i) => (i + 4) % 24);
  const nowHour = new Date().getHours();
  return (
    <View>
      <View style={styles.busyBars}>
        {order.map((hour) => (
          <View
            key={hour}
            style={[
              styles.busyBar,
              { height: 6 + weights[hour] * 54, backgroundColor: hour === nowHour ? 'white' : 'rgba(255,255,255,0.16)' },
            ]}
          />
        ))}
      </View>
      <View style={styles.busyLabels}>
        {['4a', '8a', '12p', '4p', '8p', '12a', '4a'].map((l, i) => (
          <Text key={i} style={styles.busyLabel}>
            {l}
          </Text>
        ))}
      </View>
    </View>
  );
}

function ConnectorRow({ group }: { group: ConnectorGroup }) {
  return (
    <View style={styles.connectorRow}>
      <View style={styles.connectorLeft}>
        <SymbolView name="bolt.fill" tintColor={group.currentType === 'DC' ? '#E5484D' : '#8A8A8E'} size={13} />
        <Text style={styles.connectorLabel}>
          {group.count}× {group.label}
        </Text>
      </View>
      <Text style={styles.connectorSpec}>
        {group.powerKW} kW · {group.currentType}
      </Text>
    </View>
  );
}

// An info row: icon + label, tappable (with chevron) for Call / Website, static for Hours.
function InfoRow({ icon, text, onPress }: { icon: SFSymbol; text: string; onPress?: () => void }) {
  const inner = (
    <>
      <SymbolView name={icon} tintColor="rgba(255,255,255,0.7)" size={19} />
      <Text style={styles.infoText} numberOfLines={1}>
        {text}
      </Text>
      {onPress ? <SymbolView name="chevron.right" tintColor="rgba(255,255,255,0.4)" size={15} /> : null}
    </>
  );
  return onPress ? (
    <Pressable style={({ pressed }) => [styles.infoRow, { opacity: pressed ? 0.6 : 1 }]} onPress={onPress}>
      {inner}
    </Pressable>
  ) : (
    <View style={styles.infoRow}>{inner}</View>
  );
}

// --- Sort / Filter sub-sheets -------------------------------------------------------------------

const SORT_OPTIONS: { key: ChargerSort; label: string }[] = [
  { key: 'distance', label: 'Distance' },
  { key: 'availability', label: 'Availability' },
  { key: 'price', label: 'Price' },
];

function SubSheet({ title, onClose, children }: { title: string; onClose: () => void; children: ReactNode }) {
  return (
    <View>
      <View style={styles.subSheetHeader}>
        <Text style={styles.subSheetTitle}>{title}</Text>
        <Pressable hitSlop={10} onPress={onClose}>
          <SymbolView name="xmark" tintColor="rgba(255,255,255,0.7)" size={20} weight="medium" />
        </Pressable>
      </View>
      <View style={styles.subList}>{children}</View>
    </View>
  );
}

function RadioRow({ label, selected, onPress }: { label: string; selected: boolean; onPress: () => void }) {
  return (
    <Pressable style={styles.optionRow} onPress={onPress}>
      <Text style={styles.optionLabel}>{label}</Text>
      <SymbolView
        name={selected ? 'largecircle.fill.circle' : 'circle'}
        tintColor={selected ? '#3E6AE1' : 'rgba(255,255,255,0.35)'}
        size={22}
      />
    </Pressable>
  );
}

const styles = StyleSheet.create({
  // Fills the sheet below the handle; its header is fixed and its list (scrollList) scrolls.
  tabContent: {
    flex: 1,
  },
  scrollList: {
    flex: 1,
  },
  searchField: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
    marginHorizontal: 16,
    paddingHorizontal: 14,
    height: 44,
    borderRadius: 12,
    backgroundColor: 'rgba(255,255,255,0.08)',
  },
  searchInputWrap: { flex: 1, justifyContent: 'center' },
  searchFloatLabel: { fontSize: 11, color: 'rgba(255,255,255,0.45)', marginBottom: -2 },
  searchInput: { fontSize: 17, color: 'white', padding: 0 },
  headerBar: { flexDirection: 'row', alignItems: 'center', marginTop: 2, marginBottom: 10, minHeight: 30 },
  backToTrip: { flexDirection: 'row', alignItems: 'center', gap: 2, position: 'absolute', left: 12, zIndex: 1 },
  backToTripText: { fontSize: 16, color: '#3E6AE1', fontWeight: '600' },
  tabs: { flex: 1, flexDirection: 'row', alignItems: 'center' },
  tab: { flex: 1, alignItems: 'center' },
  tabDivider: { width: StyleSheet.hairlineWidth, height: 18, backgroundColor: 'rgba(255,255,255,0.18)' },
  tabLabel: { fontSize: 17 },
  tabActive: { color: 'white', fontWeight: '700' },
  tabInactive: { color: 'rgba(255,255,255,0.4)', fontWeight: '600' },

  subSheetHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: 20,
    marginTop: 4,
    marginBottom: 18,
  },
  subSheetTitle: { fontSize: 26, fontWeight: '700', color: 'white' },

  controlsRow: { flexDirection: 'row', alignItems: 'center', gap: 10, paddingHorizontal: 16, marginBottom: 4, marginTop: 2 },
  sortButton: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    height: 40,
    paddingHorizontal: 16,
    borderRadius: 10,
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: 'rgba(255,255,255,0.25)',
  },
  sortLabel: { fontSize: 15, fontWeight: '600', color: 'white' },
  boltButton: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 1,
    minWidth: 56,
    height: 40,
    paddingHorizontal: 12,
    borderRadius: 10,
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: 'rgba(255,255,255,0.25)',
  },
  boltButtonActive: { backgroundColor: 'rgba(255,255,255,0.16)', borderColor: 'transparent' },

  list: { paddingTop: 12 },
  groupHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
    paddingHorizontal: 20,
    marginTop: 8,
    marginBottom: 12,
  },
  groupTitle: { fontSize: 13, fontWeight: '600', color: 'rgba(255,255,255,0.4)' },
  groupLine: { flex: 1, height: StyleSheet.hairlineWidth, backgroundColor: 'rgba(255,255,255,0.14)' },
  row: { flexDirection: 'row', alignItems: 'center', gap: 12, paddingHorizontal: 20, paddingVertical: 12 },
  rowText: { flex: 1, gap: 3 },
  rowName: { fontSize: 17, fontWeight: '700', color: 'white' },
  rowAddress: { fontSize: 14, color: 'rgba(255,255,255,0.45)' },
  chargerMeta: { fontSize: 13, color: 'rgba(255,255,255,0.4)' },
  emptyText: { textAlign: 'center', color: 'rgba(255,255,255,0.4)', fontSize: 15, paddingVertical: 40 },

  distancePill: {
    minWidth: 64,
    height: 56,
    borderRadius: 12,
    paddingHorizontal: 8,
    backgroundColor: 'rgba(255,255,255,0.08)',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 4,
  },
  distanceText: { fontSize: 13, fontWeight: '600', color: 'rgba(255,255,255,0.7)' },
  availBadge: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 2,
    paddingHorizontal: 7,
    paddingVertical: 2,
    borderRadius: 999,
    backgroundColor: '#E5484D',
  },
  availText: { fontSize: 12, fontWeight: '700', color: 'white' },

  subList: { paddingHorizontal: 4 },
  optionRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: 16,
    paddingVertical: 18,
  },
  optionLabel: { fontSize: 18, color: 'white' },

  // --- Charger detail ---
  detailHeader: { paddingHorizontal: 20, paddingBottom: 2 },
  detailTopRow: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', marginBottom: 8 },
  detailNetwork: { flexDirection: 'row', alignItems: 'center', gap: 7, flex: 1, marginRight: 12 },
  detailNetworkText: { fontSize: 15, fontWeight: '600', color: 'rgba(255,255,255,0.85)' },
  detailTitle: { fontSize: 27, fontWeight: '700', color: 'white' },
  detailPlace: { fontSize: 16, color: 'rgba(255,255,255,0.45)', marginTop: 2 },
  detailBlock: { paddingHorizontal: 20 },
  detailAvail: { fontSize: 17, fontWeight: '700', color: 'white' },
  detailPower: { fontSize: 15, color: 'rgba(255,255,255,0.45)', marginTop: 3 },
  detailDivider: {
    height: StyleSheet.hairlineWidth,
    backgroundColor: 'rgba(255,255,255,0.12)',
    marginVertical: 18,
    marginHorizontal: 20,
  },
  detailSectionTitle: { fontSize: 17, fontWeight: '700', color: 'white' },
  busyBars: { flexDirection: 'row', alignItems: 'flex-end', height: 64, gap: 3, marginTop: 16 },
  busyBar: { flex: 1, borderRadius: 2 },
  busyLabels: { flexDirection: 'row', justifyContent: 'space-between', marginTop: 8 },
  busyLabel: { fontSize: 13, color: 'rgba(255,255,255,0.4)' },
  feesRow: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' },
  feesValue: { fontSize: 15, color: 'rgba(255,255,255,0.55)' },
  connectorList: { marginTop: 14, gap: 12 },
  connectorRow: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' },
  connectorLeft: { flexDirection: 'row', alignItems: 'center', gap: 8 },
  connectorLabel: { fontSize: 16, fontWeight: '500', color: 'white' },
  connectorSpec: { fontSize: 15, color: 'rgba(255,255,255,0.55)' },
  infoRow: { flexDirection: 'row', alignItems: 'center', gap: 14, paddingVertical: 12 },
  infoText: { flex: 1, fontSize: 16, color: 'white' },
  addressRow: { flexDirection: 'row', alignItems: 'center', gap: 12 },
  addressText: { flex: 1 },
  addressPlace: { fontSize: 16, color: 'rgba(255,255,255,0.85)' },
  addressSub: { fontSize: 14, color: 'rgba(255,255,255,0.45)', marginTop: 2 },
});
