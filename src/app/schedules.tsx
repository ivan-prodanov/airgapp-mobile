import { useCallback, useEffect, useMemo, useState } from 'react';
import { Pressable, RefreshControl, ScrollView, StyleSheet, Text, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { SymbolView, type SFSymbol } from 'expo-symbols';
import * as Haptics from 'expo-haptics';
import * as Location from 'expo-location';
import { useRouter } from 'expo-router';

import { EdgeSwipeBack } from '@/components/EdgeSwipeBack';
import { LocationPickerSheet, type ScheduleLocationKey } from '@/components/LocationPickerSheet';
import { ScheduleSheet } from '@/components/ScheduleSheet';
import { Toggle } from '@/components/Toggle';
import { type LatLng } from '@/state/mockLocation';
import {
  type AnySchedule,
  carSchedulesToState,
  newCharging,
  newPrecondition,
  scheduleSubtitle,
  scheduleTitle,
} from '@/state/schedules';
import { useSchedules } from '@/state/useSchedules';
import { useFleet } from '@/state/VehicleProvider';
import { TeslaFonts } from '@/constants/fonts';

// Sofia city centre — the same fallback the Location screen uses when GPS isn't available yet.
const FALLBACK_COORD: LatLng = { latitude: 42.6977, longitude: 23.3219 };

// iOS reverseGeocode sometimes returns a postal code ("814 01") in `street`/`name`. Prefer the first
// candidate that reads like a real place name (has a letter), so the header shows the street/area, not a code.
const isPostalish = (s?: string | null) => !!s && /^[\d\s-]+$/.test(s.trim());
function pickPlaceLabel(addr: Location.LocationGeocodedAddress): string {
  const candidates = [addr.street, addr.name, addr.city, addr.district, addr.subregion, addr.region];
  return candidates.find((c) => c && !isPostalish(c)) || 'Current location';
}

type Editing = { draft: AnySchedule; mode: 'create' | 'edit' };

// Set Schedules screen (route). Precondition + Charging schedules per vehicle (Light Show is shown but
// disabled — it can't run over BLE). The header's location dropdown scopes which place these are "at";
// Current Location is the car's position (real GPS if known, else the user's), reverse-geocoded to a street name.
export default function SchedulesScreen() {
  const router = useRouter();
  const fleet = useFleet();
  const { schedules, setAll, savePrecondition, saveCharging, remove, setEnabled } = useSchedules();

  const [editing, setEditing] = useState<Editing | null>(null);
  const [pickerOpen, setPickerOpen] = useState(false);
  const [locationKey, setLocationKey] = useState<ScheduleLocationKey>('current');
  const [currentLabel, setCurrentLabel] = useState('Current location');

  // The active car's real GPS (null until read / for demo cars) — no fake offset.
  const carCoord: LatLng | null = useMemo(() => {
    const active = fleet.vehicles.find((v) => v.id === fleet.activeId) ?? fleet.vehicles[0];
    const loc = active.state.carLocation;
    return loc && Number.isFinite(loc.lat) && Number.isFinite(loc.lon)
      ? { latitude: loc.lat, longitude: loc.lon }
      : null;
  }, [fleet.vehicles, fleet.activeId]);

  // Resolve the car position (real GPS if known, else the user's) to a street/boulevard name for the header.
  useEffect(() => {
    let cancelled = false;
    void (async () => {
      try {
        let user = FALLBACK_COORD;
        const { status } = await Location.requestForegroundPermissionsAsync();
        if (status === 'granted') {
          const pos = await Location.getCurrentPositionAsync({ accuracy: Location.Accuracy.Balanced });
          user = { latitude: pos.coords.latitude, longitude: pos.coords.longitude };
        }
        const [addr] = await Location.reverseGeocodeAsync(carCoord ?? user);
        if (!cancelled && addr) {
          setCurrentLabel(pickPlaceLabel(addr));
        }
      } catch {
        // keep the default label
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [carCoord]);

  const locLabel = locationKey === 'current' ? currentLabel : locationKey === 'home' ? 'Home' : 'Work';

  const openCreate = (draft: AnySchedule) => {
    Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Medium).catch(() => {});
    setEditing({ draft, mode: 'create' });
  };
  const openEdit = (draft: AnySchedule) => setEditing({ draft, mode: 'edit' });

  // THE CAR IS THE SOURCE OF TRUTH. The Tesla app shows the schedules the car
  // actually holds, not a local list — so ours must too, or the two drift (delete
  // on the car, our list still shows it). syncFromCar reads the car's schedules
  // and REPLACES our list with them. Run on open and after every change; a live
  // car only (a demo car keeps its local list untouched).
  const syncFromCar = useCallback(async () => {
    if (!fleet.readSchedules) return;
    const r = await fleet.readSchedules();
    if (!r.ok) return; // asleep/unreachable — keep what we have rather than blanking it
    setAll(carSchedulesToState(r.charge, r.precond));
  }, [fleet, setAll]);

  useEffect(() => {
    void syncFromCar();
  }, [syncFromCar]);
  // Pull-to-refresh, same gesture as Home. The spinner is the feedback (this list
  // has no header BusyIcon), so unlike Home we do drive `refreshing` from the read.
  const [refreshing, setRefreshing] = useState(false);
  const onRefresh = async () => {
    Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Medium).catch(() => {});
    setRefreshing(true);
    try {
      await syncFromCar();
    } finally {
      setRefreshing(false);
    }
  };
  // After a write, the car takes a moment; re-sync so the list reflects what the
  // car ended up with (adopts the car's real ids, drops anything it rejected).
  const resyncSoon = () => setTimeout(() => void syncFromCar(), 2500);

  const carCoordLL = carCoord ? { latitude: carCoord.latitude, longitude: carCoord.longitude } : null;

  const onSave = (s: AnySchedule) => {
    if (s.kind === 'precondition') savePrecondition(s);
    else saveCharging(s);
    // Push to the car. One-shot: no-op for a demo car or with no known car
    // position (the modern schedules are location-keyed). The local store is the
    // source of truth either way.
    fleet.sendSchedule(s, carCoordLL);
    resyncSoon();
    setEditing(null);
  };
  const onDelete = () => {
    if (editing) {
      remove(editing.draft.kind, editing.draft.id);
      fleet.removeScheduleFromCar(editing.draft.kind, editing.draft.carId);
      resyncSoon();
    }
    setEditing(null);
  };
  const onToggleRow = (s: AnySchedule) => {
    Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Rigid).catch(() => {});
    setEnabled(s.kind, s.id, !s.enabled);
    // Re-add with the flipped `enabled`; the car keys on carId, so this updates
    // the same schedule rather than creating a second one.
    fleet.sendSchedule({ ...s, enabled: !s.enabled }, carCoordLL);
    resyncSoon();
  };

  return (
    <View style={styles.root}>
      <SafeAreaView edges={['top']} style={styles.safe}>
        <View style={styles.header}>
          <Pressable style={styles.back} hitSlop={10} onPress={() => router.back()}>
            <SymbolView name="chevron.left" tintColor="white" size={22} weight="medium" />
          </Pressable>
          <View style={styles.headerTitles}>
            <Text style={styles.title}>Set Schedules</Text>
            <Pressable style={styles.locRow} hitSlop={8} onPress={() => setPickerOpen(true)}>
              <Text style={styles.subtitle}>at {locLabel} </Text>
              <SymbolView name="chevron.down" tintColor="rgba(255,255,255,0.5)" size={12} weight="semibold" />
            </Pressable>
          </View>
        </View>

        <ScrollView
          contentContainerStyle={styles.scroll}
          showsVerticalScrollIndicator={false}
          refreshControl={
            <RefreshControl
              refreshing={refreshing}
              onRefresh={onRefresh}
              tintColor="rgba(255,255,255,0.6)"
            />
          }
        >
          <Section
            title="Precondition"
            subtitle="Set climate and preheat battery"
            onAdd={() => openCreate(newPrecondition())}
          >
            {schedules.precondition.map((s) => (
              <ScheduleRow
                key={s.id}
                schedule={s}
                onToggle={() => onToggleRow(s)}
                onPress={() => openEdit(s)}
              />
            ))}
          </Section>

          <Section
            title="Charging"
            subtitle="Set a charging schedule"
            onAdd={() => openCreate(newCharging())}
          >
            {schedules.charging.map((s) => (
              <ScheduleRow
                key={s.id}
                schedule={s}
                onToggle={() => onToggleRow(s)}
                onPress={() => openEdit(s)}
              />
            ))}
          </Section>

          {/* Light Show can't run over BLE — shown for parity with the Tesla app but disabled. */}
          <Section title="Light Show" subtitle="Set Light Show schedule" disabled />
        </ScrollView>
      </SafeAreaView>

      <ScheduleSheet
        visible={!!editing}
        draft={editing?.draft ?? null}
        mode={editing?.mode ?? 'create'}
        onSave={onSave}
        onDelete={onDelete}
        onCancel={() => setEditing(null)}
      />
      <LocationPickerSheet
        visible={pickerOpen}
        selected={locationKey}
        currentLabel={currentLabel}
        onSelect={setLocationKey}
        onClose={() => setPickerOpen(false)}
      />
      <EdgeSwipeBack onBack={() => router.back()} />
    </View>
  );
}

function Section({
  title,
  subtitle,
  onAdd,
  disabled,
  children,
}: {
  title: string;
  subtitle: string;
  onAdd?: () => void;
  disabled?: boolean;
  children?: React.ReactNode;
}) {
  return (
    <View style={styles.section}>
      {/* The whole header row is tappable — same as tapping the "+". */}
      <Pressable
        style={[styles.sectionHead, disabled && styles.disabled]}
        onPress={onAdd}
        disabled={disabled || !onAdd}
      >
        <View style={styles.sectionText}>
          <Text style={styles.sectionTitle}>{title}</Text>
          <Text style={styles.sectionSub}>{subtitle}</Text>
        </View>
        <SymbolView name="plus" tintColor="white" size={24} weight="regular" />
      </Pressable>
      {children}
    </View>
  );
}

function ScheduleRow({
  schedule,
  onToggle,
  onPress,
}: {
  schedule: AnySchedule;
  onToggle: () => void;
  onPress: () => void;
}) {
  return (
    <Pressable style={styles.card} onPress={onPress}>
      <View style={styles.cardText}>
        <Text style={styles.cardTitle}>{scheduleTitle(schedule)}</Text>
        <Text style={styles.cardSub}>{scheduleSubtitle(schedule)}</Text>
      </View>
      <Toggle value={schedule.enabled} onToggle={onToggle} />
    </Pressable>
  );
}

const styles = StyleSheet.create({
  root: {
    flex: 1,
    backgroundColor: '#161618',
  },
  safe: {
    flex: 1,
  },
  header: {
    paddingTop: 8,
    paddingBottom: 18,
    justifyContent: 'center',
    alignItems: 'center',
    paddingHorizontal: 12,
  },
  back: {
    position: 'absolute',
    left: 6,
    top: 0,
    width: 44,
    height: 44,
    borderRadius: 14,
    alignItems: 'center',
    justifyContent: 'center',
  },
  headerTitles: {
    alignItems: 'center',
    gap: 2,
  },
  title: {
    // TopNavigation title on the scheduling screen is TextCategory.H3
    // (@1321194) = 20/24/0 (getFontStyle). Was 21.
    fontSize: 20,
    lineHeight: 24,
    fontWeight: '700',
    color: 'white',
  },
  locRow: {
    flexDirection: 'row',
    alignItems: 'center',
  },
  subtitle: {
    // The nav subtitle is BodyLabel (@1797606) = 14/20/0.1, not 16.
    fontSize: 14,
    lineHeight: 20,
    letterSpacing: 0.1,
    color: 'rgba(255,255,255,0.55)',
  },
  scroll: {
    paddingBottom: 60,
  },
  section: {
    paddingHorizontal: 20,
    borderTopWidth: StyleSheet.hairlineWidth,
    // Tesla's exact dark-theme dividerColor (#2D2E2F), not an approximation.
    borderTopColor: '#2D2E2F',
  },
  sectionHead: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingVertical: 24,
  },
  sectionText: {
    flex: 1,
    gap: 4,
  },
  // Recovered from ScheduleV3PreconditionView -> ScheduleItemRow (@1318713): the
  // section title and subtitle are BOTH TextCategory.BodyLabel (UniversalSans
  // Medium 14/20/+0.1), NOT a big display title. They differ only by
  // TextAppearance — the title is Default (bright textColor #F3F3F3), the
  // subtitle is Light (dim textColorLight #8A8B8B). Our 22/700 system-bold title
  // was invented; theirs is the same restrained label size as the subtitle,
  // carried by colour, in their own typeface.
  sectionTitle: {
    fontFamily: TeslaFonts.medium,
    // Measured off Ivan's side-by-side: the title runs ~1.2x the subtitle width,
    // so it is a step UP the ladder, not the same BodyLabel — display 16/24
    // Medium. (My first pass read ScheduleItemRow, which is the schedule ROW; the
    // section header is a separate, larger component.) Subtitle stays 14/20.
    fontSize: 16,
    lineHeight: 24,
    color: '#F3F3F3',
  },
  sectionSub: {
    fontFamily: TeslaFonts.medium,
    fontSize: 14,
    lineHeight: 20,
    letterSpacing: 0.1,
    color: '#8A8B8B',
  },
  disabled: {
    opacity: 0.35,
  },
  card: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: '#1B1B1D',
    borderRadius: 12,
    paddingHorizontal: 18,
    paddingVertical: 16,
    marginBottom: 16,
  },
  cardText: {
    flex: 1,
    gap: 3,
  },
  cardTitle: {
    fontSize: 19,
    fontWeight: '700',
    color: 'white',
  },
  cardSub: {
    fontSize: 14,
    color: 'rgba(255,255,255,0.5)',
  },
});
