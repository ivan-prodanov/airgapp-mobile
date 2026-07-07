import { forwardRef, useImperativeHandle, useMemo, useRef, useState, type ReactNode } from 'react';
import {
  Animated,
  Linking,
  PanResponder,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  useWindowDimensions,
  View,
  type GestureResponderHandlers,
} from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { SymbolView, type SFSymbol } from 'expo-symbols';

import { busyTimesFor, formatKm, MOCK_RECENTS, type RecentDestination } from '@/state/mockLocation';
import {
  chargerBadge,
  formatOpeningHours,
  type Charger,
  type ChargerBadge,
  type ConnectorGroup,
  type StationAvailability,
} from '@/services/tomtom';

export type LocationTab = 'recents' | 'charging';
export type ChargerSort = 'distance' | 'availability' | 'price';
export interface ChargerFilter {
  dc: boolean;
  ac: boolean;
  availableOnly: boolean;
}

// Visible fraction of the screen at each detent (measured off the Tesla app's three states). Exported
// so the map can pad its centring/fitting by these panel heights.
export const SHEET_MINIMAL_FRAC = 0.25;
export const SHEET_MIDDLE_FRAC = 0.34;
const SHEET_FULL_FRAC = 0.92;

export interface LocationSheetHandle {
  expand: () => void; // open at least to the middle detent (never shrinks)
  collapse: () => void; // drop to the minimal detent
}

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
}

// Rubber-band overscroll past the snap bounds — the SAME mechanism the Climate sheet uses (Gorhom's
// overDragResistanceFactor formula ported onto RN's Animated native driver), so the feel is glassy where
// @gorhom/bottom-sheet on this app's reanimated-4 stack jittered.
const OVERDRAG_RESIST = 2.5;
const overDrag = (y: number, expanded: number, collapsed: number) => {
  if (y < expanded) return expanded - Math.sqrt(1 + (expanded - y)) * OVERDRAG_RESIST;
  if (y > collapsed) return collapsed + Math.sqrt(1 + (y - collapsed)) * OVERDRAG_RESIST;
  return y;
};

// Tesla Location bottom sheet: a bottom-anchored panel dragged by itself between three detents (minimal /
// middle / near-full), exactly like the Climate sheet. Recents tab = search + recent destinations; Charging
// tab = the "Nearby Chargers" view with Filter / Sort / AC-DC controls and the station list.
export const LocationSheet = forwardRef<LocationSheetHandle, Props>(function LocationSheet(
  { tab, onTabChange, chargers, availability, sort, onSortChange, filter, onFilterChange, selectedCharger, onSelectCharger, onCloseDetail, onNavigateCharger },
  ref,
) {
  const { height } = useWindowDimensions();
  const insetBottom = useSafeAreaInsets().bottom;
  const SHEET_H = Math.round(height * SHEET_FULL_FRAC);
  const snaps = useMemo(() => {
    const full = 0;
    const middle = Math.round(SHEET_H - height * SHEET_MIDDLE_FRAC);
    const minimal = Math.round(SHEET_H - height * SHEET_MINIMAL_FRAC);
    return { full, middle, minimal, points: [full, middle, minimal] };
  }, [SHEET_H, height]);
  const snapsRef = useRef(snaps);
  snapsRef.current = snaps;

  const translateY = useRef(new Animated.Value(snaps.middle)).current;
  const restingY = useRef(snaps.middle);

  const settle = (target: number, velocityY = 0) => {
    restingY.current = target;
    Animated.spring(translateY, {
      toValue: target,
      velocity: velocityY * 500,
      stiffness: 1000,
      damping: 500,
      mass: 3,
      overshootClamping: true,
      restDisplacementThreshold: 0.5,
      restSpeedThreshold: 0.5,
      useNativeDriver: true,
    }).start();
  };

  useImperativeHandle(
    ref,
    () => ({
      expand: () => settle(Math.min(restingY.current, snapsRef.current.middle)),
      collapse: () => settle(snapsRef.current.minimal),
    }),
    [],
  );

  const pan = useRef(
    PanResponder.create({
      onMoveShouldSetPanResponderCapture: (_e, g) => Math.abs(g.dy) > 8 && Math.abs(g.dy) > Math.abs(g.dx),
      onPanResponderMove: (_e, g) => {
        const s = snapsRef.current;
        translateY.setValue(overDrag(restingY.current + g.dy, s.full, s.minimal));
      },
      onPanResponderRelease: (_e, g) => {
        const s = snapsRef.current;
        const projected = restingY.current + g.dy + g.vy * 200;
        const target = s.points.reduce(
          (best, p) => (Math.abs(p - projected) < Math.abs(best - projected) ? p : best),
          s.points[0],
        );
        settle(target, g.vy);
      },
    }),
  ).current;

  return (
    <Animated.View style={[styles.sheet, { height: SHEET_H, transform: [{ translateY }] }]}>
      {/* Only this top strip drags the sheet (PanResponder), so the body below can scroll freely. */}
      <View style={styles.handleWrap} {...pan.panHandlers}>
        <View style={styles.handle} />
      </View>

      {tab === 'recents' ? (
        <RecentsView onTabChange={onTabChange} insetBottom={insetBottom} dragHandlers={pan.panHandlers} />
      ) : (
        <ChargingView
          chargers={chargers}
          availability={availability}
          sort={sort}
          onSortChange={onSortChange}
          filter={filter}
          onFilterChange={onFilterChange}
          selectedCharger={selectedCharger}
          onSelectCharger={onSelectCharger}
          onCloseDetail={onCloseDetail}
          onNavigateCharger={onNavigateCharger}
          onClose={() => onTabChange('recents')}
          dragHandlers={pan.panHandlers}
        />
      )}
    </Animated.View>
  );
});

// --- Recents ------------------------------------------------------------------------------------

function RecentsView({
  onTabChange,
  insetBottom,
  dragHandlers,
}: {
  onTabChange: (tab: LocationTab) => void;
  insetBottom: number;
  dragHandlers: GestureResponderHandlers;
}) {
  return (
    <View style={styles.tabContent}>
      {/* Header is draggable (moves the sheet); the list below scrolls. */}
      <View {...dragHandlers}>
        <View style={styles.searchField}>
          <SymbolView name="magnifyingglass" tintColor="rgba(255,255,255,0.5)" size={18} />
          <Text style={styles.searchPlaceholder}>Navigate</Text>
        </View>

        <View style={styles.tabs}>
          <Pressable style={styles.tab} onPress={() => onTabChange('recents')}>
            <Text style={[styles.tabLabel, styles.tabActive]}>Recents</Text>
          </Pressable>
          <View style={styles.tabDivider} />
          <Pressable style={styles.tab} onPress={() => onTabChange('charging')}>
            <Text style={[styles.tabLabel, styles.tabInactive]}>Charging</Text>
          </Pressable>
        </View>
      </View>

      <ScrollView
        style={styles.scrollList}
        contentContainerStyle={[styles.list, { paddingBottom: insetBottom + 24 }]}
        showsVerticalScrollIndicator={false}
      >
        {MOCK_RECENTS.map((group) => (
          <View key={group.title}>
            <View style={styles.groupHeader}>
              <Text style={styles.groupTitle}>{group.title}</Text>
              <View style={styles.groupLine} />
            </View>
            {group.items.map((item) => (
              <RecentRow key={item.id} item={item} />
            ))}
          </View>
        ))}
      </ScrollView>
    </View>
  );
}

function RecentRow({ item }: { item: RecentDestination }) {
  return (
    <Pressable style={({ pressed }) => [styles.row, { opacity: pressed ? 0.6 : 1 }]}>
      <View style={styles.rowText}>
        <Text style={styles.rowName} numberOfLines={1}>
          {item.name}
        </Text>
        <Text style={styles.rowAddress} numberOfLines={1}>
          {item.address}
        </Text>
      </View>
      <View style={styles.distancePill}>
        <SymbolView name="mappin" tintColor="rgba(255,255,255,0.55)" size={18} />
        <Text style={styles.distanceText}>{formatKm(item.distanceKm)}</Text>
      </View>
    </Pressable>
  );
}

// --- Charging -----------------------------------------------------------------------------------

type ChargingSubMode = 'list' | 'sort' | 'filter';

function ChargingView({
  chargers,
  availability,
  sort,
  onSortChange,
  filter,
  onFilterChange,
  selectedCharger,
  onSelectCharger,
  onCloseDetail,
  onNavigateCharger,
  onClose,
  dragHandlers,
}: {
  chargers: Charger[];
  availability: Record<string, StationAvailability>;
  sort: ChargerSort;
  onSortChange: (s: ChargerSort) => void;
  filter: ChargerFilter;
  onFilterChange: (f: ChargerFilter) => void;
  selectedCharger: Charger | null;
  onSelectCharger: (c: Charger) => void;
  onCloseDetail: () => void;
  onNavigateCharger: (c: Charger) => void;
  onClose: () => void;
  dragHandlers: GestureResponderHandlers;
}) {
  const [sub, setSub] = useState<ChargingSubMode>('list');
  const insetBottom = useSafeAreaInsets().bottom;

  // A selected charger takes over the panel with its detail view (overrides the list/sort/filter subs).
  if (selectedCharger) {
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

  if (sub === 'sort') {
    return (
      <SubSheet title="Sort By" onClose={() => setSub('list')}>
        {SORT_OPTIONS.map((opt) => (
          <RadioRow
            key={opt.key}
            label={opt.label}
            selected={sort === opt.key}
            onPress={() => {
              onSortChange(opt.key);
              setSub('list');
            }}
          />
        ))}
      </SubSheet>
    );
  }

  if (sub === 'filter') {
    return (
      <SubSheet title="Filter" onClose={() => setSub('list')}>
        <ToggleRow label="DC fast charging" on={filter.dc} onPress={() => onFilterChange({ ...filter, dc: !filter.dc })} />
        <ToggleRow label="AC charging" on={filter.ac} onPress={() => onFilterChange({ ...filter, ac: !filter.ac })} />
        <ToggleRow
          label="Available only"
          on={filter.availableOnly}
          onPress={() => onFilterChange({ ...filter, availableOnly: !filter.availableOnly })}
        />
      </SubSheet>
    );
  }

  return (
    <View style={styles.tabContent}>
      {/* Header + controls are draggable (move the sheet); the list below scrolls. */}
      <View {...dragHandlers}>
        <View style={styles.chargingHeader}>
          <Text style={styles.chargingTitle}>Nearby Chargers</Text>
          <Pressable hitSlop={10} onPress={onClose}>
            <SymbolView name="xmark" tintColor="rgba(255,255,255,0.7)" size={20} weight="medium" />
          </Pressable>
        </View>

        <View style={styles.controlsRow}>
          <Pressable style={styles.filterButton} onPress={() => setSub('filter')}>
            <SymbolView name="slider.horizontal.3" tintColor="white" size={18} />
          </Pressable>
          <Pressable style={styles.sortButton} onPress={() => setSub('sort')}>
            <Text style={styles.sortLabel}>Sort By</Text>
            <SymbolView name="chevron.down" tintColor="rgba(255,255,255,0.6)" size={13} weight="semibold" />
          </Pressable>
          <BoltButton bolts={3} active={filter.dc} onPress={() => onFilterChange({ ...filter, dc: !filter.dc })} />
          <BoltButton bolts={1} active={filter.ac} onPress={() => onFilterChange({ ...filter, ac: !filter.ac })} />
        </View>
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
    </View>
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
      <View style={styles.chargingHeader}>
        <Text style={styles.chargingTitle}>{title}</Text>
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

function ToggleRow({ label, on, onPress }: { label: string; on: boolean; onPress: () => void }) {
  return (
    <Pressable style={styles.optionRow} onPress={onPress}>
      <Text style={styles.optionLabel}>{label}</Text>
      <SymbolView
        name={on ? 'checkmark.circle.fill' : 'circle'}
        tintColor={on ? '#3E6AE1' : 'rgba(255,255,255,0.35)'}
        size={22}
      />
    </Pressable>
  );
}

const styles = StyleSheet.create({
  sheet: {
    position: 'absolute',
    left: 0,
    right: 0,
    bottom: 0,
    backgroundColor: '#161616',
    borderTopLeftRadius: 16,
    borderTopRightRadius: 16,
    shadowColor: '#000',
    shadowOffset: { width: 0, height: -8 },
    shadowOpacity: 0.5,
    shadowRadius: 16,
  },
  // The only drag target — a full-width strip at the top, so grabbing the handle resizes the sheet while
  // the scrollable body below stays free to scroll.
  handleWrap: {
    alignItems: 'center',
    paddingTop: 8,
    paddingBottom: 12,
  },
  handle: {
    width: 38,
    height: 5,
    borderRadius: 3,
    backgroundColor: 'rgba(255,255,255,0.28)',
  },
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
  searchPlaceholder: { fontSize: 17, color: 'rgba(255,255,255,0.5)' },
  tabs: { flexDirection: 'row', alignItems: 'center', marginTop: 22, marginBottom: 6 },
  tab: { flex: 1, alignItems: 'center' },
  tabDivider: { width: StyleSheet.hairlineWidth, height: 18, backgroundColor: 'rgba(255,255,255,0.18)' },
  tabLabel: { fontSize: 17 },
  tabActive: { color: 'white', fontWeight: '700' },
  tabInactive: { color: 'rgba(255,255,255,0.4)', fontWeight: '600' },

  // Charging header (Nearby Chargers / Sort By / Filter) + close.
  chargingHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: 20,
    marginTop: 4,
    marginBottom: 18,
  },
  chargingTitle: { fontSize: 26, fontWeight: '700', color: 'white' },

  controlsRow: { flexDirection: 'row', alignItems: 'center', gap: 10, paddingHorizontal: 16, marginBottom: 4 },
  filterButton: {
    width: 46,
    height: 40,
    borderRadius: 10,
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: 'rgba(255,255,255,0.25)',
    alignItems: 'center',
    justifyContent: 'center',
  },
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
