import { useEffect, useMemo, useRef, useState } from 'react';
import { Linking, Platform, Pressable, StyleSheet, Text, useWindowDimensions, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { SymbolView, type SFSymbol } from 'expo-symbols';
import * as Haptics from 'expo-haptics';
import * as Location from 'expo-location';
import { useLocalSearchParams, useRouter } from 'expo-router';
import MapView, { Marker, Polyline, PROVIDER_DEFAULT, type MapType, type Region } from 'react-native-maps';

import {
  LocationSheet,
  SHEET_MINIMAL_FRAC,
  SHEET_TALL_FRAC,
  type ChargerFilter,
  type ChargerSort,
  type LocationSheetHandle,
  type LocationTab,
} from '@/components/LocationSheet';
import { useFleet, useVehicle } from '@/state/VehicleProvider';
import { controlHaptic } from '@/state/controlHaptic';
import { useToast } from '@/components/ToastHost';
import {
  distanceMeters,
  formatKm,
  formatTimeAgo,
  getMockLastUpdated,
  offsetCoordinate,
  type LatLng,
} from '@/state/mockLocation';
import {
  boundsForRegion,
  chargerBadge,
  chargerPriority,
  isTeslaSupercharger,
  chargerCoord,
  type Charger,
  type ChargerBadge,
  type StationAvailability,
  type ViewportRegion,
} from '@/services/tomtom';
import { hasChargerInBounds, nearestChargerTo, osmChargersInBounds } from '@/services/chargerSource';
import { fetchAvailabilityInBounds, fetchAvailabilityNear, matchAvailability } from '@/services/chargeprice';
import { useNavigateSearch } from '@/hooks/useNavigateSearch';
import { useTrip } from '@/state/useTrip';
import { carStop, straightLineLegs, tripTotals, uid, type TripStop } from '@/state/trip';
import { useTripRoute } from '@/state/useTripRoute';
import { TripSheet, TRIP_SHEET_FRAC, type TripSheetHandle, type TripRowAction } from '@/components/TripSheet';
import { TripRowMenu } from '@/components/TripRowMenu';
import { PlacePreviewSheet, type DroppedPin } from '@/components/PlacePreviewSheet';
import { EdgeSwipeBack } from '@/components/EdgeSwipeBack';
import type { Place } from '@/services/place';
import { sharedLocationStore } from '@/state/sharedLocationStore';
import SharedIntake from '../../modules/shared-intake';
import { loadTripSnapshotFrom } from '@/state/tripSnapshot';
import { appStorage } from '@/state/appStorage';

// Fallback when location permission is denied / unavailable, so the map still renders (Sofia centre).
const FALLBACK_COORD: LatLng = { latitude: 42.6977, longitude: 23.3219 };
// Tighter zoom to match the Tesla app's default (a few blocks around the car), not a whole district.
const DEFAULT_DELTA = { latitudeDelta: 0.0035, longitudeDelta: 0.0035 };
// Only fetch live availability when zoomed in past ~neighbourhood level (numbers aren't readable when
// zoomed out for browsing); above this the pins just show their "N?" (unknown) badge.
const AVAIL_MAX_DELTA = 0.06;
// The bundled OSM extract has no result cap (unlike TomTom's old 100/fetch), so a zoomed-out viewport can
// contain thousands of stations. Rendering that many native markers / list rows lags hard, so we cap both:
// the MAP keeps the highest-power stations (major/fast chargers, spread across the view); the LIST keeps the
// nearest. Zoomed in, the in-view count falls below these and everything shows.
const MAP_MAX_PINS = 150;
const LIST_MAX = 60;

// Two chargers at one physical site (e.g. an AC + a DC unit) otherwise snapshot to the SAME screen pixel.
// On iOS MapKit a stacked custom marker's zIndex controls PAINT order but not UIKit hit-test order — so the
// top pin draws over the one beneath yet the tap lands on the pin underneath. We nudge genuinely co-located
// pins apart by a FIXED REAL-WORLD distance. Crucially this is zoom-INDEPENDENT: marker coordinates never
// change with zoom, so pins stay geo-anchored (MapKit slides them smoothly with the map, no jump-on-settle)
// and separate/merge naturally as you zoom, like PlugShare. (A screen-constant px offset would balloon in
// metres when zoomed out and fling pins into the sea.) Isolated pins always sit on their true coordinate.
const COLLIDE_BUCKET_DEG = 0.00002; // ~2 m of latitude → same bucket = "same spot"
const FAN_OFFSET_M = 8; // metres to spread a co-located group (fixed real-world distance)
// Selected pins scale up by this. iOS Apple Maps IGNORES react-native-maps' `anchor` prop (only centerOffset
// is applied natively), so a custom marker defaults to CENTER-on-coordinate — which leaves the tail tip half
// a pin BELOW the real spot (a fixed pixel error that becomes huge ground distance when zoomed out → "in the
// sea"). We instead lift the view by half its height via centerOffset so its BOTTOM (the tip) is the anchor.
const PIN_SELECTED_SCALE = 1.75;
const TESLA_SCALE = 1.5; // Tesla Superchargers render bigger than ordinary pins
const PIN_HEIGHT = 34; // bubble 26 + tail 8 (px, unselected); the tail's -1 margin is folded into centerOffset
const pinCenterOffsetY = (scale: number) => -(PIN_HEIGHT * scale - 1) / 2;

// Minimal dark map style for Android (Google Maps). iOS (Apple Maps) uses userInterfaceStyle="dark".
const DARK_MAP_STYLE = [
  { elementType: 'geometry', stylers: [{ color: '#212121' }] },
  { elementType: 'labels.text.fill', stylers: [{ color: '#9e9e9e' }] },
  { elementType: 'labels.text.stroke', stylers: [{ color: '#212121' }] },
  { featureType: 'road', elementType: 'geometry', stylers: [{ color: '#2c2c2c' }] },
  { featureType: 'water', elementType: 'geometry', stylers: [{ color: '#000000' }] },
  { featureType: 'poi', elementType: 'labels.text.fill', stylers: [{ color: '#757575' }] },
];

// Turn an MKPOICategory identifier (e.g. "MKPOICategoryGasStation") into a human label ("Gas Station").
function cleanCategory(raw?: string): string | undefined {
  if (!raw) return undefined;
  const bare = raw.replace(/^MKPOICategory/, '');
  return bare.replace(/([a-z])([A-Z])/g, '$1 $2') || undefined;
}

// Turn a dropped/shared pin into a Place for trip persistence.
function pinToPlace(pin: DroppedPin): Place {
  return {
    id: `pin:${pin.coordinate.latitude.toFixed(5)},${pin.coordinate.longitude.toFixed(5)}`,
    title: pin.name,
    subtitle: pin.subtitle,
    coordinate: pin.coordinate,
    kind: 'poi',
    source: 'apple',
  };
}

// Car-location view. Native map (Apple Maps on iOS, Google on Android) with the car pinned to the
// user's live GPS plus a stable per-car offset (mock until BLE). Top controls mirror the Tesla app;
// the draggable bottom sheet holds Navigate + Recents/Charging.
export default function LocationView() {
  const router = useRouter();
  const toast = useToast();
  // Deep-link: the Charging screen's "Find Chargers" opens `/location?tab=charging` straight on the Charging tab.
  const { tab: tabParam } = useLocalSearchParams<{ tab?: string }>();
  const fleet = useFleet();
  const { height } = useWindowDimensions();
  const mapRef = useRef<MapView | null>(null);

  // Pad the map's centring by the minimal-detent panel height so the car (and any animateToRegion)
  // lands in the visible space ABOVE the panel, not behind it — the map itself stays full-screen.
  const mapPadding = useMemo(
    () => ({ top: 0, right: 0, bottom: Math.round(height * SHEET_MINIMAL_FRAC), left: 0 }),
    [height],
  );

  const [userCoord, setUserCoord] = useState<LatLng | null>(null);
  const [mapType, setMapType] = useState<MapType>('standard');
  const [tab, setTab] = useState<LocationTab>(tabParam === 'charging' ? 'charging' : 'location');
  // The native map fires onMapReady once it's laid out and ready for camera ops. The Charging-tab
  // framing (getCamera + fitToCoordinates) is a no-op before this, so when deep-linked straight onto
  // the Charging tab (Charging → "Find Chargers") the [tab] effect used to run too early and the map
  // never zoomed to the nearest charger. Gating the effect on this defers framing until the map is ready.
  const [mapReady, setMapReady] = useState(false);
  // `fetched` = the cached bbox pool from the last TomTom fetch; `region` = the current settled viewport.
  const [fetched, setFetched] = useState<Charger[]>([]);
  const [region, setRegion] = useState<ViewportRegion>({ ...FALLBACK_COORD, ...DEFAULT_DELTA });
  const [sort, setSort] = useState<ChargerSort>('distance');
  const [filter, setFilter] = useState<ChargerFilter>({ dc: true, ac: true, availableOnly: false });
  // Live availability keyed by charger id (Chargeprice results, proximity-matched). In-memory only.
  const [availability, setAvailability] = useState<Record<string, StationAvailability>>({});
  // The charger whose detail is shown in the panel (null = the list). Tapping a pin or row selects it.
  const [selectedCharger, setSelectedCharger] = useState<Charger | null>(null);
  const sheetRef = useRef<LocationSheetHandle>(null);
  const refetchTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  // Programmatic camera moves (charger tap, fit-to-coordinates) also fire onRegionChangeComplete on iOS,
  // which would trigger a redundant TomTom search of an area we already loaded. Before such a move we set
  // this "quiet until" timestamp; the region handler skips its refetch while inside the window. User
  // gestures (which we DO want to refetch) fall outside the window.
  const quietRefetchUntil = useRef(0);
  const suppressRefetch = (ms = 900) => {
    quietRefetchUntil.current = Date.now() + ms;
  };

  // The active car's live view state — carLocation is non-null ONLY for the live car once its GPS
  // has been read (telemetry applies only to the active-is-live vehicle). So: real coords when we
  // have them, otherwise the per-car mock offset (demo cars, or the live car before its first read).
  const [vehState] = useVehicle();
  const liveCoord: LatLng | null = useMemo(() => {
    const loc = vehState.carLocation;
    if (loc && Number.isFinite(loc.lat) && Number.isFinite(loc.lon)) {
      return { latitude: loc.lat, longitude: loc.lon };
    }
    return null;
  }, [vehState.carLocation]);
  // Real car GPS when we have it; otherwise the user's own location (no fake
  // offset). The car pin sits on the user until the live fix lands, then moves.
  const carCoord = useMemo(
    () => liveCoord ?? userCoord ?? FALLBACK_COORD,
    [liveCoord, userCoord],
  );

  // Navigate search (recents tab): live Apple/local results + persisted recents.
  const nav = useNavigateSearch(region);

  // Trip planning: selecting a place builds an in-memory trip shown in the TripSheet.
  const trip = useTrip();
  const [screen, setScreen] = useState<'search' | 'trip'>('search');
  const [tripEditing, setTripEditing] = useState(false); // hide the Send-to-Car/Cancel bar while editing the trip
  const tripSheetRef = useRef<TripSheetHandle>(null);
  // Live "now" clock for the itinerary. The car isn't moving, so departure is always "now" and each stop's ETA
  // is now + cumulative travel time — recomputed as real time passes (ticks) so the times stay current, and it
  // starts from the actual current time on every launch (not epoch 0).
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    const id = setInterval(() => setNow(Date.now()), 30_000);
    return () => clearInterval(id);
  }, []);
  // The car's real location name (reverse-geocoded), shown on the car row instead of "Car location". Refreshed
  // only when the rounded (~100m) car position changes, to avoid geocoder rate-limits.
  const carKey = `${carCoord.latitude.toFixed(3)},${carCoord.longitude.toFixed(3)}`;
  const [carName, setCarName] = useState('Car location');
  useEffect(() => {
    let cancelled = false;
    void Location.reverseGeocodeAsync(carCoord)
      .then(([a]) => {
        // Prefer the area/locality (town → district → county → region) over `name`/`street`, which come back as
        // a postal code or street number (e.g. "814 01").
        if (!cancelled && a) setCarName(a.city || a.district || a.subregion || a.region || 'Car location');
      })
      .catch(() => {});
    return () => {
      cancelled = true;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [carKey]);
  // Mirror the car's current stop so the Share popup can start a "New Trip" ([car, sharedPlace]) even before the
  // app is next opened.
  useEffect(() => {
    void SharedIntake.setSavedCar(
      JSON.stringify({ id: 'car', kind: 'car', title: carName, lat: carCoord.latitude, lng: carCoord.longitude }),
    );
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [carKey, carName]);
  // When set, the next place picked in search is inserted at this index instead of appended (Insert Stop).
  const [pendingInsert, setPendingInsert] = useState<number | null>(null);
  // Long-press context menu target (trip stop index + the row's screen Y).
  const [rowMenu, setRowMenu] = useState<{ index: number; anchorY: number } | null>(null);
  // A point long-pressed on the map (our own pin, reverse-geocoded) OR a tapped Apple map feature (Apple's
  // own marker, enriched via onPoiClick). Its preview panel takes over the sheet.
  const [droppedPin, setDroppedPin] = useState<DroppedPin | null>(null);
  // An intent handed off from the share popup (resolved location + the chosen action). Consumed once on mount
  // and on every subsequent publish; applied as Navigate (start/extend trip) or Add to Trip.
  const [sharedIntent, setSharedIntent] = useState(() => sharedLocationStore.consume());
  useEffect(() => sharedLocationStore.subscribe(() => setSharedIntent(sharedLocationStore.consume())), []);
  useEffect(() => {
    if (!sharedIntent) return;
    const { location, action } = sharedIntent;
    const place: Place = {
      id: `pin:${location.coordinate.latitude.toFixed(5)},${location.coordinate.longitude.toFixed(5)}`,
      title: location.name ?? 'Shared Location',
      subtitle: '',
      coordinate: location.coordinate,
      kind: 'poi',
      source: 'apple',
    };
    setSelectedCharger(null);
    setTab('location');
    if (action === 'addToTrip') {
      // The popup already appended the shared stop at its chosen position, so `reorderedStops` IS the full trip
      // — adopt it as-is. (Fallback to a plain append if no arrangement was sent.)
      const reordered = sharedIntent.reorderedStops;
      if (reordered && reordered.length) {
        const stops: TripStop[] = reordered.map((r) => ({
          id: r.id,
          kind: r.kind as TripStop['kind'],
          title: r.title,
          subtitle: r.subtitle,
          coordinate: { latitude: r.lat, longitude: r.lng },
        }));
        // The extension seeds "New Trip" as [car, shared] from the mirrored car, but on a fresh install the car
        // hasn't been mirrored yet, so the arrangement can arrive car-less. Enforce the stops[0]===car invariant.
        if (stops[0]?.kind !== 'car') stops.unshift(carStop(carCoord));
        trip.replaceStops(stops);
        setScreen('trip');
      } else {
        void trip.addToSaved(place).then(() => setScreen('trip'));
      }
    } else {
      startNewTrip(place); // New Trip: a fresh trip to the shared place, replacing any existing one
    }
    setSharedIntent(null);
  }, [sharedIntent]);
  // On mount, restore the saved "last trip" into the Trip view so an existing trip is shown whenever you open
  // Location (it persists until explicitly cancelled). Skipped when a shared intent is incoming (that effect owns
  // the screen/trip) OR when deep-linked to the Charging tab (we want the charger search, not the trip view).
  useEffect(() => {
    if (sharedIntent || tabParam === 'charging') return;
    void loadTripSnapshotFrom(appStorage).then((snap) => {
      if (snap) {
        trip.replaceStops(snap.stops);
        setScreen('trip');
      }
    });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);
  // Charging deep-link: expand the sheet so the charger list is visible on arrival (the [tab] effect already
  // frames the map + fetches stations). Deferred a frame so the sheet's imperative handle is ready.
  useEffect(() => {
    if (tabParam !== 'charging') return;
    const id = requestAnimationFrame(() => sheetRef.current?.expand());
    return () => cancelAnimationFrame(id);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);
  // Mirror the saved trip through the App Group so the Share popup can draw the route + list its stops (the trip
  // lives in AsyncStorage, which the extension can't read). The displayed trip is the active one, or — when none
  // is in session but a snapshot exists — the persisted "last trip".
  useEffect(() => {
    let cancelled = false;
    void (async () => {
      const active = trip.trip;
      const display = active ?? (trip.savedExists ? await loadTripSnapshotFrom(appStorage) : null);
      if (cancelled) return;
      const stops = display?.stops ?? [];
      const name = stops[stops.length - 1]?.title ?? null;
      const stopsJson = JSON.stringify(
        stops.map((s) => ({ id: s.id, title: s.title, subtitle: s.subtitle, lat: s.coordinate.latitude, lng: s.coordinate.longitude, kind: s.kind })),
      );
      void SharedIntake.setSavedTrip(trip.savedExists, name, stopsJson);
    })();
    return () => {
      cancelled = true;
    };
  }, [trip.savedExists, trip.trip]);
  // Dismiss the preview card AND clear Apple's native feature selection (the "enlarged" highlight), so the
  // card and the map stay in sync — otherwise a tapped POI stays enlarged after the card closes. (The stray
  // onPress a feature tap would otherwise fire is suppressed natively, so no debounce is needed here.)
  const dismissDroppedPin = () => {
    setDroppedPin(null);
    mapRef.current?.deselectFeatures?.();
  };

  // Select a place → record a recent, then start a trip (none yet), insert at a pending position, or append.
  const onSelectPlace = (place: Place) => {
    nav.select(place);
    if (trip.trip) {
      if (pendingInsert != null) trip.insertStop(place, pendingInsert);
      else trip.addStop(place);
      setPendingInsert(null);
      setScreen('trip');
    } else {
      trip.start(carCoord, place);
      setScreen('trip');
      tripSheetRef.current?.expand();
    }
  };

  // Long-press an empty spot → drop our own pin, reverse-geocode it, and show its preview panel. (Tapping a
  // built-in Apple map feature goes through `onPoiClick` instead, where Apple supplies the name/address.) The
  // coordinate shows immediately; the name/address fills in when the lookup returns (guarded so a newer pin
  // isn't clobbered by an older lookup).
  const dropPin = async (coordinate: LatLng) => {
    Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Medium);
    setSelectedCharger(null); // opening a pin preview supersedes any open charger detail (don't restore it on close)
    setTab('location'); // tapping the map exits charging mode → chargers clear off the map behind the preview
    const coords = `${coordinate.latitude.toFixed(4)}, ${coordinate.longitude.toFixed(4)}`;
    setDroppedPin({ coordinate, name: 'Dropped Pin', subtitle: coords, fromPoi: false });
    try {
      const [addr] = await Location.reverseGeocodeAsync(coordinate);
      if (!addr) return;
      const name = addr.name ?? addr.street ?? 'Dropped Pin';
      const subtitle =
        [addr.street ?? addr.name, addr.city ?? addr.subregion, addr.region]
          .filter((s): s is string => !!s && s !== name)
          .join(', ') || coords;
      setDroppedPin((cur) =>
        cur && cur.coordinate.latitude === coordinate.latitude && cur.coordinate.longitude === coordinate.longitude
          ? { coordinate, name, subtitle, fromPoi: false }
          : cur,
      );
    } catch {
      // Keep the coordinate fallback if reverse-geocoding fails.
    }
  };

  // Add-to-Trip / Navigate from the dropped-pin preview: turn the pin into a Place and reuse onSelectPlace
  // (starts a trip when there's none, else appends/inserts a stop).
  // Start a FRESH trip to a place (replaces any existing trip), unlike onSelectPlace which appends to an active
  // trip. Used by the dropped-pin "New Trip" and the shared "Send to Car" (navigate) action.
  const startNewTrip = (place: Place) => {
    nav.select(place);
    trip.start(carCoord, place);
    setScreen('trip');
    tripSheetRef.current?.expand();
  };
  const onNewTripFromPin = () => {
    if (!droppedPin) return;
    const place = pinToPlace(droppedPin);
    dismissDroppedPin(); // clears the card + Apple's feature highlight before the trip view takes over
    startNewTrip(place);
  };

  // Row actions from the swipe/long-press menu: Duplicate (append a copy), Insert (pick a stop after this one),
  // Delete.
  const onTripRowAction = (index: number, action: TripRowAction) => {
    if (!trip.trip) return;
    const stop = trip.trip.stops[index];
    if (action === 'delete') onRemoveStop(stop.id);
    else if (action === 'insert') {
      setPendingInsert(index + 1);
      setScreen('search');
    } else if (action === 'duplicate') {
      // Append a copy of the stop at the end. The car row duplicates as a NORMAL place (not a car) at its real
      // location name, so the trip keeps a single car origin.
      const dup: TripStop = {
        id: `dup:${uid()}`, // fresh unique id — never keyed on the throttled `now`, so rapid re-duplicates don't collide
        kind: stop.kind === 'car' ? 'place' : stop.kind,
        title: stop.kind === 'car' ? carName : stop.title,
        subtitle: stop.subtitle,
        coordinate: stop.coordinate,
      };
      trip.replaceStops([...trip.trip.stops, dup]);
    }
  };
  const openRowMenu = (index: number, anchorY: number) => {
    Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Medium).catch(() => {});
    setRowMenu({ index, anchorY });
  };
  // Bottom edge-padding for a map fit: reserve down to wherever the given sheet currently rests (mapPadding
  // already reserves the minimal detent, so subtract it). Honors shrunk/middle/trip and caps at middle when the
  // sheet is fully extended (reserveFrac). Falls back to fallbackFrac if the sheet ref isn't mounted yet.
  const fitBottomPad = (sheetHandle: LocationSheetHandle | null, fallbackFrac: number) => {
    const frac = sheetHandle?.reserveFrac?.() ?? fallbackFrac;
    return Math.round(height * (frac - SHEET_MINIMAL_FRAC));
  };
  // Add Charger → open the Charging tab (charger detail's action reads "Add to Trip"), reset any stale
  // detail/insert. If no charger is already on screen, frame the whole trip + the nearest charger so at least
  // one is reachable — same as the first Charging-tab open (which always reframes and adds the nearest charger
  // only when none already sits in the framed area).
  const onAddChargerToTrip = () => {
    if (!trip.trip) return;
    const stops = trip.trip.stops.map((s) => s.coordinate);
    onCloseDetail(); // clear a cached charger detail so the Charging tab shows the list fresh
    setPendingInsert(null); // Add Charger appends unless an Insert Stop set a position (handled on select)
    setTab('charging');
    setScreen('search');
    // Always reframe to the whole trip. If no charger falls within the trip's own bounding box, ALSO include
    // the nearest one — that point pulls the fit outward so at least one charger lands on screen (the "zoom
    // out to the nearest charger" case). If the trip area already contains chargers, framing the trip shows
    // them, no extra point needed.
    const coords: LatLng[] = [...stops];
    const tripBounds = {
      north: Math.max(...stops.map((s) => s.latitude)),
      south: Math.min(...stops.map((s) => s.latitude)),
      east: Math.max(...stops.map((s) => s.longitude)),
      west: Math.min(...stops.map((s) => s.longitude)),
    };
    if (!hasChargerInBounds(tripBounds)) {
      const center = { latitude: (tripBounds.north + tripBounds.south) / 2, longitude: (tripBounds.east + tripBounds.west) / 2 };
      const nearest = nearestChargerTo(center);
      if (nearest) coords.push(nearest);
    }
    mapRef.current?.fitToCoordinates(coords, {
      edgePadding: { top: 80, right: 40, bottom: fitBottomPad(sheetRef.current, SHEET_TALL_FRAC), left: 40 },
      animated: true,
    });
  };

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
    trip.clearSaved(); // discard session AND the saved snapshot, so a later "Add to Trip" starts fresh
    setScreen('search');
  };

  // Send the trip to the car. Was a no-op stub ("local mock") until 2026-07-26.
  //
  // Single destination -> navigateTo, which carries a human LABEL the car displays.
  // Multiple stops -> the multi-waypoint request, whose coordinate encoding is
  // "lat,lon;lat,lon" (confirmed 2026-07-26; the car advertises the capability as
  // WAYPOINTS_REQUEST_ACCEPTS_COORDINATES). That message has no label and no trip
  // order, so the label is only available on the single-stop path — hence the split
  // rather than always using waypoints.
  const onSendTripToCar = () => {
    const stops = trip.trip?.stops ?? [];
    // stops[0] is always the car itself (invariant enforced above), so the real
    // destinations are everything after it — the car knows where it is.
    const destinations = stops.slice(1);
    if (destinations.length === 0) return;
    controlHaptic();
    if (destinations.length === 1) {
      const only = destinations[0];
      fleet.sendNavigation(only.coordinate.latitude, only.coordinate.longitude, only.title);
      toast.show(`Sent ${only.title} to the car`);
      return;
    }
    fleet.sendWaypoints(
      destinations.map((d) => ({ lat: d.coordinate.latitude, lon: d.coordinate.longitude })),
    );
    const last = destinations[destinations.length - 1];
    toast.show(`Sent ${destinations.length} stops to the car · ${last.title} last`);
  };

  // Real Apple route for the active trip (null while loading / offline → straight-line fallback). Shared by
  // the TripSheet itinerary, the pinned Send-to-Car footer, and the map polyline.
  const tripRoute = useTripRoute(trip.trip?.stops);
  const tripLegs = tripRoute?.legs ?? (trip.trip ? straightLineLegs(trip.trip.stops) : []);
  const tripTotalsVal = tripRoute
    ? { distanceM: tripRoute.totalDistanceM, durationS: tripRoute.totalDurationS }
    : tripTotals(tripLegs);

  // Frame the whole trip (route if we have it, else the stops) above the trip sheet — same rule as the
  // Charging tab: mapPadding already reserves the lowest gear, so pad the bottom by the gap up to the trip
  // sheet's (taller) detent.
  useEffect(() => {
    if (screen !== 'trip' || !trip.trip) return;
    const coords = tripRoute?.polyline?.length ? tripRoute.polyline : trip.trip.stops.map((s) => s.coordinate);
    mapRef.current?.fitToCoordinates(coords, {
      edgePadding: { top: 80, right: 40, bottom: fitBottomPad(tripSheetRef.current, TRIP_SHEET_FRAC), left: 40 },
      animated: true,
    });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [screen, trip.trip, tripRoute]);

  // Pool filtered by AC/DC + availability. The map pins and the list both derive from this so they stay
  // consistent (tap a row → its pin exists on the map).
  const filteredPool = useMemo(() => {
    let pool = fetched;
    if (filter.dc !== filter.ac) {
      pool = pool.filter((c) => (filter.dc ? c.currentType === 'DC' : c.currentType === 'AC'));
    }
    if (filter.availableOnly) pool = pool.filter((c) => c.availableConnectors > 0);
    return pool;
  }, [fetched, filter]);

  // Stations currently in view, sorted by the Sort control (id tiebreak → stable render order, so
  // same-coordinate pins never flip which is on top). These are rendered as individual pins (no clusters).
  const visibleChargers = useMemo(() => {
    const b = boundsForRegion(region);
    const byId = (a: Charger, c: Charger) => (a.id < c.id ? -1 : a.id > c.id ? 1 : 0);
    const inView = filteredPool.filter(
      (c) => c.latitude <= b.north && c.latitude >= b.south && c.longitude <= b.east && c.longitude >= b.west,
    );
    if (sort === 'power') inView.sort((a, c) => c.maxPowerKW - a.maxPowerKW || byId(a, c));
    else inView.sort((a, c) => a.distanceM - c.distanceM || byId(a, c));
    return inView;
  }, [filteredPool, region, sort]);

  // The sheet's list is a non-virtualised ScrollView, so cap it to the nearest LIST_MAX (per the sort) —
  // nobody scrolls thousands of rows, and it keeps the sheet snappy when zoomed out over a large area.
  const listChargers = useMemo(() => visibleChargers.slice(0, LIST_MAX), [visibleChargers]);

  // Marker paint order = z-order, by priority (Tesla > DC > AC, power tiebreak): lowest first (underneath),
  // highest last (on top). The selected charger is moved to the very end so it draws biggest-and-on-top.
  // (id tiebreak keeps same-priority pins from flipping.) Then de-collide: pins sharing a ~2 m bucket are
  // fanned onto a tiny circle so each keeps its OWN hit region on iOS MapKit.
  const markerChargers = useMemo(() => {
    const sorted = [...visibleChargers].sort(
      (a, c) => chargerPriority(a) - chargerPriority(c) || (a.id < c.id ? -1 : a.id > c.id ? 1 : 0),
    );
    if (selectedCharger) {
      const idx = sorted.findIndex((c) => c.id === selectedCharger.id);
      if (idx >= 0) sorted.push(sorted.splice(idx, 1)[0]);
    }
    // Cap to the highest-power stations (they sort last) plus the selected (also at the end), so a zoomed-out
    // view draws the major/fast chargers spread across the map rather than thousands of pins.
    const arr = sorted.length > MAP_MAX_PINS ? sorted.slice(sorted.length - MAP_MAX_PINS) : sorted;

    const bucketKey = (c: Charger) =>
      `${Math.round(c.latitude / COLLIDE_BUCKET_DEG)}:${Math.round(c.longitude / COLLIDE_BUCKET_DEG)}`;

    // Group by rounded coordinate; order within a group follows arr's deterministic (power, id) sort.
    const groups = new Map<string, Charger[]>();
    for (const c of arr) {
      const k = bucketKey(c);
      const g = groups.get(k);
      if (g) g.push(c);
      else groups.set(k, [c]);
    }

    return arr.map((c) => {
      const group = groups.get(bucketKey(c))!;
      if (group.length < 2) return { charger: c, displayCoord: chargerCoord(c), fanned: false };
      const i = group.indexOf(c);
      const bearingDeg = 45 + (360 / group.length) * i; // even fan, offset 45° off the vertical tail axis
      // Fixed real-world offset → zoom-independent, so the pin never moves relative to the ground on zoom.
      return {
        charger: c,
        displayCoord: offsetCoordinate(chargerCoord(c), { bearingDeg, distanceM: FAN_OFFSET_M }),
        fanned: true,
      };
    });
  }, [visibleChargers, selectedCharger]);

  // Live availability (Chargeprice) is enriched onto the OSM pins in fetchViewport — one BULK bbox call per
  // settle, only when zoomed in past AVAIL_MAX_DELTA (numbers aren't readable zoomed out) — and per-tap in
  // onSelectCharger. Results are proximity-matched to the OSM pin and keyed by charger id; pins with no
  // match keep their "N?" badge. In the Balkans most stations report no live figure today, so this is
  // best-effort enrichment. See [[ev-charger-data-providers]].

  const lastUpdatedLabel = useMemo(() => formatTimeAgo(getMockLastUpdated()), []);

  const fetchLocation = async () => {
    try {
      const { status } = await Location.requestForegroundPermissionsAsync();
      if (status !== 'granted') return;
      const pos = await Location.getCurrentPositionAsync({ accuracy: Location.Accuracy.Balanced });
      setUserCoord({ latitude: pos.coords.latitude, longitude: pos.coords.longitude });
    } catch {
      // Keep the fallback coordinate; the map still renders.
    }
  };

  // Initial fix on mount.
  useEffect(() => {
    fetchLocation();
  }, []);

  const initialRegion: Region = { ...carCoord, ...DEFAULT_DELTA };
  const recenter = (coord: LatLng) => {
    mapRef.current?.animateToRegion({ ...coord, ...DEFAULT_DELTA }, 400);
  };
  // Recentre on the car when a GPS fix arrives/refreshes — but NOT while a pin preview (long-press/POI) is
  // showing, or the late GPS fix would yank the map off the previewed location back to the car. (A shared
  // intent no longer drops a preview pin — it routes straight to the Trip view, which frames itself.)
  const droppedPinRef = useRef(droppedPin);
  droppedPinRef.current = droppedPin;
  useEffect(() => {
    if (droppedPinRef.current) return;
    recenter(carCoord); // real car GPS if known, else the user's location
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [userCoord, liveCoord]);

  // Discovery = the bundled OSM extract (local bbox filter, no network, no quota). Padded slightly beyond
  // the edge so pins near the border exist. Live availability is fetched separately (Chargeprice, below).
  const FETCH_PAD = 1.25;
  const fetchViewport = async (r: ViewportRegion): Promise<Charger[]> => {
    const padded: ViewportRegion = {
      latitude: r.latitude,
      longitude: r.longitude,
      latitudeDelta: r.latitudeDelta * FETCH_PAD,
      longitudeDelta: r.longitudeDelta * FETCH_PAD,
    };
    const bounds = boundsForRegion(padded);
    const { chargers } = osmChargersInBounds(bounds, carCoord);
    setFetched(chargers);
    // One bulk availability call for the whole viewport (zoomed in only), proximity-matched onto the pins.
    if (r.latitudeDelta <= AVAIL_MAX_DELTA) {
      fetchAvailabilityInBounds(bounds).then((stations) => {
        if (stations.length === 0) return;
        const matched = matchAvailability(chargers, stations);
        if (Object.keys(matched).length) setAvailability((prev) => ({ ...prev, ...matched }));
      });
    }
    return chargers;
  };

  // Entering the Charging tab: fit the two points — the current map centre and the car — so both are on
  // screen at once. fitToCoordinates zooms out/in to frame them; the padding just keeps them off the top bar
  // and the sheet. The settle refetches the framed viewport, so pins load across the between-area.
  useEffect(() => {
    if (tab !== 'charging' || !mapReady) return; // wait for the map — see mapReady; deep-link fires this on mount
    fetchViewport(region);
    if (trip.trip) return; // adding a charger to a trip: onAddChargerToTrip frames the whole trip instead
    (async () => {
      // Read the ACTUAL current map centre. On a fresh open, `region` state hasn't been set yet (it only
      // updates on a settle), so getCamera() is what makes framing work without nudging the map first.
      let mapCenter: LatLng = { latitude: region.latitude, longitude: region.longitude };
      try {
        const cam = await mapRef.current?.getCamera();
        if (cam?.center) mapCenter = cam.center;
      } catch {
        // keep the region-based fallback
      }
      // If there are NO chargers in the box between the current view and the car, the framed area would be
      // empty — so ALSO include the nearest charger as a third point (added, not swapped, so the current view
      // and the car still fit too), guaranteeing at least one charger is on screen.
      const points: LatLng[] = [mapCenter, carCoord];
      const between = {
        north: Math.max(mapCenter.latitude, carCoord.latitude),
        south: Math.min(mapCenter.latitude, carCoord.latitude),
        east: Math.max(mapCenter.longitude, carCoord.longitude),
        west: Math.min(mapCenter.longitude, carCoord.longitude),
      };
      if (!hasChargerInBounds(between)) {
        const nearest = nearestChargerTo(mapCenter);
        if (nearest) points.push(nearest);
      }
      mapRef.current?.fitToCoordinates(points, {
        // mapPadding already reserves the LOWEST sheet detent; add the gap up to the MIDDLE detent (where the
        // sheet opens) so the lower point clears it. Top/sides keep the pins off the bar and screen edges.
        edgePadding: { top: 80, right: 40, bottom: fitBottomPad(sheetRef.current, SHEET_TALL_FRAC), left: 40 },
        animated: true,
      });
    })();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [tab, mapReady]);

  // On settle: update the viewport and (debounced) refetch its stations. Cheap enough at personal scale,
  // and it guarantees the pins/list always reflect the area you're actually looking at. We always update
  // `region` (keeps the list + fan geometry fresh) but skip the TomTom refetch for programmatic moves that
  // land on an already-loaded area (charger tap, fit) — see suppressRefetch — so only user pans/zooms fetch.
  const onRegionChangeComplete = (r: Region) => {
    setRegion(r); // ALWAYS track the map centre (also used to frame the charging view) — not just on charging
    if (tab !== 'charging') return; // …but only fetch/refetch stations on the charging tab
    if (Date.now() < quietRefetchUntil.current) return;
    if (refetchTimer.current) clearTimeout(refetchTimer.current);
    refetchTimer.current = setTimeout(() => fetchViewport(r), 350);
  };


  // Hand off to the native maps app for turn-by-turn to any coordinate — Apple Maps on iOS (omitting
  // saddr = "from current location"), Google Maps nav intent on Android, web fallback otherwise.
  const openDirections = (dest: LatLng) => {
    const { latitude: lat, longitude: lng } = dest;
    const primary = Platform.select({
      ios: `maps://?daddr=${lat},${lng}&dirflg=d`,
      android: `google.navigation:q=${lat},${lng}`,
      default: `https://maps.google.com/?daddr=${lat},${lng}`,
    }) as string;
    Linking.openURL(primary).catch(() => {
      Linking.openURL(`https://maps.apple.com/?daddr=${lat},${lng}&dirflg=d`).catch(() => {});
    });
  };
  // Button 1: directions to the car.
  const onNavigate = () => {
    Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Medium).catch(() => {});
    openDirections(carCoord);
  };
  // Tapping a charger row or map pin: open its detail in the panel, centre the map on it, and pull fresh
  // availability. (The Navigate button in the detail does the actual maps hand-off.)
  const onSelectCharger = (c: Charger) => {
    Haptics.selectionAsync().catch(() => {});
    setSelectedCharger(c);
    sheetRef.current?.expand();
    // Centring on the tapped charger stays within the loaded pool — don't refetch on this camera move.
    suppressRefetch();
    mapRef.current?.animateCamera({ center: chargerCoord(c) }, { duration: 350 });
    // Pull live availability for just this station (works at any zoom, even if the bulk fetch didn't cover
    // it), proximity-matched back onto this pin's id.
    fetchAvailabilityNear(chargerCoord(c)).then((stations) => {
      const matched = matchAvailability([c], stations);
      if (matched[c.id]) setAvailability((prev) => ({ ...prev, ...matched }));
    });
  };
  // Map-pin tap: iOS may route an overlapping tap to the wrong (frontmost-by-its-rules) pin, so resolve to
  // the HIGHEST-PRIORITY charger (Tesla > DC > AC) within ~a pin's width of the tapped one before selecting.
  // (List rows call onSelectCharger directly — an explicit pick is never redirected.)
  const onPressPin = (tapped: Charger) => {
    const metersPerPx = (region.latitudeDelta * 111_320) / Math.max(1, height);
    const radiusM = 55 * metersPerPx;
    let best = tapped;
    for (const cand of visibleChargers) {
      if (distanceMeters(tapped, cand) <= radiusM && chargerPriority(cand) > chargerPriority(best)) best = cand;
    }
    onSelectCharger(best);
  };
  const onCloseDetail = () => setSelectedCharger(null);
  const onNavigateToCharger = (c: Charger) => {
    Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Medium).catch(() => {});
    if (trip.trip) {
      if (pendingInsert != null) trip.insertCharger(c, pendingInsert);
      else trip.addCharger(c);
      setPendingInsert(null);
      onCloseDetail();
      setTab('location');
      setScreen('trip');
      return;
    }
    onSelectPlace({
      id: `charger:${c.id}`,
      title: c.name,
      subtitle: c.region || c.place,
      coordinate: { latitude: c.latitude, longitude: c.longitude },
      kind: 'charger',
      source: 'charger',
    });
  };
  // Button 2: drop the panel to its minimal detent and recentre the car in the freed space above it
  // (the map is padded by the minimal panel height, so the car lands centred there, not behind it).
  const onGoToVehicle = () => {
    Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light).catch(() => {});
    fetchLocation();
    sheetRef.current?.collapse();
    recenter(carCoord);
  };
  // Button 3: toggle satellite/standard map.
  const onToggleSatellite = () => {
    Haptics.selectionAsync().catch(() => {});
    setMapType((t) => (t === 'standard' ? 'hybrid' : 'standard'));
  };
  // Button 4: open the sheet to the Charging tab.
  const onChargingTab = () => {
    Haptics.selectionAsync().catch(() => {});
    setTab('charging');
    sheetRef.current?.expand();
  };

  return (
    <View style={styles.root}>
      <MapView
        ref={mapRef}
        style={StyleSheet.absoluteFill}
        provider={PROVIDER_DEFAULT}
        initialRegion={initialRegion}
        onMapReady={() => setMapReady(true)}
        mapType={mapType}
        mapPadding={mapPadding}
        userInterfaceStyle="dark"
        customMapStyle={mapType === 'standard' ? DARK_MAP_STYLE : undefined}
        onRegionChangeComplete={onRegionChangeComplete}
        onLongPress={(e) => dropPin(e.nativeEvent.coordinate)}
        // Single-tap a built-in Apple place label (POI/city/landmark) → preview it (patched native
        // selectableMapFeatures → onPoiClick). Extra place data rides in `placeId` as JSON: category + colour
        // arrive synchronously, address/phone/website a beat later (a second onPoiClick from MKMapItemRequest).
        onPoiClick={(e) => {
          setSelectedCharger(null); // a POI preview supersedes any open charger detail (don't restore it on close)
          setTab('location'); // tapping a label exits charging mode → chargers clear off the map behind the preview
          const { name, coordinate, placeId } = e.nativeEvent;
          let extra: { category?: string; color?: string; address?: string; phone?: string; url?: string } = {};
          try {
            extra = JSON.parse(placeId || '{}');
          } catch {
            /* keep defaults */
          }
          const category = cleanCategory(extra.category);
          setDroppedPin((cur) => {
            const same = !!cur && cur.coordinate.latitude === coordinate.latitude && cur.coordinate.longitude === coordinate.longitude;
            if (extra.address && !same) return cur; // async enrichment for a pin no longer shown → ignore
            return {
              coordinate,
              name: name || 'Place',
              subtitle: extra.address ?? category ?? '',
              fromPoi: true,
              category,
              address: extra.address,
              phone: extra.phone,
              url: extra.url,
              color: extra.color,
            };
          });
        }}
        // Empty-map tap dismisses a FEATURE (POI) preview. A custom long-press pin dismisses via its X button
        // only — on a custom pin nothing is pre-selected, so an empty-map onPress is indistinguishable from the
        // leading onPress of a POI tap (whose feature selection resolves a beat later), and dismissing here
        // would flicker the sheet on custom→POI. Feature→feature never reaches here: the native view suppresses
        // onPress whenever a feature is already selected, so switching between POIs is always clean.
        onPress={() => {
          if (droppedPin?.fromPoi) dismissDroppedPin();
        }}
        showsUserLocation
        showsCompass={false}
        showsMyLocationButton={false}
        toolbarEnabled={false}
      >
        {droppedPin && !droppedPin.fromPoi ? (
          // Long-press pin uses Apple's own native marker (no custom child), matching the Maps app.
          <Marker coordinate={droppedPin.coordinate} />
        ) : null}

        <Marker coordinate={carCoord} anchor={{ x: 0.5, y: 0.5 }} flat>
          <SymbolView
            name="location.north.fill"
            tintColor="#9A9AA0"
            size={36}
            style={styles.carPin}
          />
        </Marker>

        {tab === 'charging' &&
          markerChargers.map(({ charger: c, displayCoord, fanned }) => {
            const badge = chargerBadge(c);
            const isSelected = c.id === selectedCharger?.id;
            const tesla = isTeslaSupercharger(c);
            const scale = isSelected ? PIN_SELECTED_SCALE : tesla ? TESLA_SCALE : 1;
            return (
              <Marker
                // Key folds in badge + selected + tesla + fanned so the pin re-snapshots when it's
                // (de)selected or its fan state flips (tracksViewChanges is off for perf).
                key={`${c.id}:${badge.text}:${badge.color}:${isSelected}:${tesla}:${fanned}`}
                coordinate={displayCoord}
                // centerOffset (NOT anchor — iOS ignores it): lift the pin so its bottom tip is the anchor.
                centerOffset={{ x: 0, y: pinCenterOffsetY(scale) }}
                tracksViewChanges={false}
                zIndex={isSelected ? 100_000_000 : Math.round(chargerPriority(c))}
                onPress={() => onPressPin(c)}
              >
                <ChargerPin badge={badge} scale={scale} />
              </Marker>
            );
          })}

        {/* Keep the route + stop pins on the map for the whole active trip — including while Add Stop /
            Add Charger switch the sheet — so the navigation isn't hidden. */}
        {trip.trip && tripRoute?.polyline?.length ? (
          <Polyline coordinates={tripRoute.polyline} strokeColor="#3E6AE1" strokeWidth={5} />
        ) : null}

        {trip.trip
          ? trip.trip.stops.slice(1).map((s) => (
              <Marker key={s.id} coordinate={s.coordinate} anchor={{ x: 0.5, y: 1 }} tracksViewChanges={false}>
                <SymbolView
                  name={s.kind === 'charger' ? 'bolt.circle.fill' : 'mappin.circle.fill'}
                  tintColor={s.kind === 'charger' ? '#E5484D' : '#3E6AE1'}
                  size={30}
                />
              </Marker>
            ))
          : null}
      </MapView>

      <SafeAreaView edges={['top']} style={styles.topBar} pointerEvents="box-none">
        <View style={styles.topRow} pointerEvents="box-none">
          <Pressable style={styles.iconButton} onPress={() => router.back()} hitSlop={6}>
            <SymbolView name="chevron.left" tintColor="white" size={20} weight="semibold" />
          </Pressable>

          <View style={styles.agoPill}>
            <SymbolView name="arrow.clockwise" tintColor="rgba(255,255,255,0.85)" size={15} weight="semibold" />
            <Text style={styles.agoText}>{lastUpdatedLabel}</Text>
          </View>

          <View style={styles.rightStack}>
            <RoundButton icon="arrow.turn.up.right" onPress={onNavigate} />
            <RoundButton icon="location.fill" onPress={onGoToVehicle} />
            <RoundButton icon="globe.americas.fill" onPress={onToggleSatellite} active={mapType === 'hybrid'} />
            <RoundButton icon="bolt.fill" onPress={onChargingTab} active={tab === 'charging'} />
          </View>
        </View>
      </SafeAreaView>

      {droppedPin ? (
        <PlacePreviewSheet pin={droppedPin} onClose={dismissDroppedPin} />
      ) : screen === 'trip' && trip.trip ? (
        <TripSheet
          ref={tripSheetRef}
          trip={trip.trip}
          legs={tripLegs}
          now={now}
          carName={carName}
          onAddStop={() => {
            setPendingInsert(null);
            setScreen('search');
          }}
          onAddCharger={onAddChargerToTrip}
          onReorder={trip.reorder}
          onRowAction={onTripRowAction}
          onLongPressRow={openRowMenu}
          onEditingChange={setTripEditing}
          onRevertEdit={trip.replaceStops}
        />
      ) : (
        <LocationSheet
          ref={sheetRef}
          tab={tab}
          onTabChange={setTab}
          chargers={listChargers}
          availability={availability}
          sort={sort}
          onSortChange={setSort}
          filter={filter}
          onFilterChange={setFilter}
          selectedCharger={selectedCharger}
          onSelectCharger={onSelectCharger}
          onCloseDetail={onCloseDetail}
          onNavigateCharger={onNavigateToCharger}
          query={nav.query}
          onChangeQuery={nav.setQuery}
          results={nav.results}
          recentGroups={nav.recentGroups}
          carCoord={carCoord}
          onSelectPlace={onSelectPlace}
          onBackToTrip={
            trip.trip
              ? () => {
                  setPendingInsert(null);
                  setTab('location'); // leaving Add Charger → exit charging mode so the pins clear off the map
                  setScreen('trip');
                }
              : undefined
          }
        />
      )}

      {/* Pinned action bar for the charger detail — floats at the screen bottom over the sheet, so it's
          reachable at every detent (the sheet always covers the screen bottom). Hidden behind the pin preview. */}
      {!droppedPin && tab === 'charging' && selectedCharger ? (
        <SafeAreaView edges={['bottom']} style={styles.navigateBar} pointerEvents="box-none">
          <View style={styles.navigateRow}>
            <Pressable style={styles.navigateButton} onPress={() => onNavigateToCharger(selectedCharger)}>
              <SymbolView name="arrow.turn.up.right" tintColor="white" size={17} weight="semibold" />
              <Text style={styles.navigateText}>{trip.trip ? 'Add to Trip' : 'Navigate'}</Text>
            </Pressable>
          </View>
        </SafeAreaView>
      ) : null}

      {/* Pinned action bar for the long-press/POI dropped-pin preview: Navigate always starts/extends a trip
          via the existing onSelectPlace plumbing; Add to Trip appends to the active OR last-saved trip
          (trip.addToSaved), disabled when neither exists. (A shared intent no longer routes through here —
          it applies its action and lands directly on the Trip view; see the sharedIntent effect above.) */}
      {droppedPin ? (
        <SafeAreaView edges={['bottom']} style={styles.navigateBar} pointerEvents="box-none">
          <View style={styles.navigateRow}>
            <Pressable style={styles.navigateButton} onPress={onNewTripFromPin}>
              <Text style={styles.navigateText}>New Trip</Text>
            </Pressable>
            {/* Add to Trip is HIDDEN (not disabled) when there's no trip — New Trip then fills the row. */}
            {trip.savedExists ? (
              <Pressable
                style={styles.navigateButtonSecondary}
                onPress={async () => {
                  if (!droppedPin) return;
                  await trip.addToSaved(pinToPlace(droppedPin));
                  dismissDroppedPin();
                  setScreen('trip');
                }}
              >
                <Text style={styles.navigateText}>Add to Trip</Text>
              </Pressable>
            ) : null}
          </View>
        </SafeAreaView>
      ) : null}

      {/* Pinned trip actions — Send to Car / Cancel float at the screen bottom so they stay visible while the
          Trip sheet rests at the middle detent (Send to Car is a local mock — never a network/Tesla call).
          Hidden behind the pin preview. */}
      {!droppedPin && !tripEditing && screen === 'trip' && trip.trip ? (
        <SafeAreaView edges={['bottom']} style={styles.tripBar} pointerEvents="box-none">
          <Pressable style={styles.tripSendButton} onPress={onSendTripToCar}>
            <Text style={styles.tripSendText}>
              Send to Car · {formatDuration(tripTotalsVal.durationS)} · {formatKm(tripTotalsVal.distanceM / 1000)}
            </Text>
          </Pressable>
          <Pressable hitSlop={8} style={styles.tripCancelButton} onPress={onTripCancel}>
            <Text style={styles.tripCancelText}>Cancel</Text>
          </Pressable>
        </SafeAreaView>
      ) : null}

      {rowMenu && trip.trip ? (
        <TripRowMenu
          visible
          anchorY={rowMenu.anchorY}
          title={trip.trip.stops[rowMenu.index]?.title ?? ''}
          allowDelete={rowMenu.index !== 0 && trip.trip.stops.length > 2}
          onAction={(a) => onTripRowAction(rowMenu.index, a)}
          onClose={() => setRowMenu(null)}
        />
      ) : null}

      {/* Standard iOS left-edge swipe-back (the native full-screen gesture is disabled in _layout — since iOS
          26 it responds to the whole screen, which would fight map/sheet drags). */}
      <EdgeSwipeBack onBack={() => router.back()} />
    </View>
  );
}

// "3h 45m" / "45m" from a seconds duration.
function formatDuration(totalS: number): string {
  const m = Math.round(totalS / 60);
  const h = Math.floor(m / 60);
  return h > 0 ? `${h}h ${m % 60}m` : `${m}m`;
}

// Map pin for a charging station: a bubble with a bolt and the availability text, on a little downward
// tail. Colour = DC red-by-power / AC grey; text = available slots (or "N?"/"?" when unknown) — both from
// `badge`. The `selected` pin scales up ~1.5× (and is drawn on top, via zIndex) like the Tesla app.
function ChargerPin({ badge, scale = 1 }: { badge: ChargerBadge; scale?: number }) {
  const s = scale;
  return (
    <View style={styles.pinWrap}>
      <View
        style={[
          styles.pinBubble,
          {
            backgroundColor: badge.color,
            height: 26 * s,
            borderRadius: 13 * s,
            paddingHorizontal: 7 * s,
            gap: 2 * s,
          },
        ]}
      >
        <SymbolView name="bolt.fill" tintColor="white" size={11 * s} />
        <Text style={[styles.pinCount, { fontSize: 13 * s }]}>{badge.text}</Text>
      </View>
      <View
        style={[
          styles.pinTail,
          { borderLeftWidth: 6 * s, borderRightWidth: 6 * s, borderTopWidth: 8 * s, borderTopColor: badge.color },
        ]}
      />
    </View>
  );
}

function RoundButton({
  icon,
  onPress,
  active,
}: {
  icon: SFSymbol;
  onPress: () => void;
  active?: boolean;
}) {
  return (
    <Pressable
      onPress={onPress}
      hitSlop={4}
      style={({ pressed }) => [styles.iconButton, active && styles.iconButtonActive, { opacity: pressed ? 0.6 : 1 }]}
    >
      <SymbolView name={icon} tintColor="white" size={19} weight="medium" />
    </Pressable>
  );
}

const styles = StyleSheet.create({
  root: {
    flex: 1,
    backgroundColor: '#161616',
  },
  carPin: {
    width: 36,
    height: 36,
    // Subtle lift off the map so the grey pin reads against grey roads.
    ...Platform.select({
      ios: { shadowColor: '#000', shadowOffset: { width: 0, height: 1 }, shadowOpacity: 0.5, shadowRadius: 2 },
      default: {},
    }),
  },
  topBar: {
    position: 'absolute',
    top: 0,
    left: 0,
    right: 0,
    paddingHorizontal: 14,
  },
  topRow: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    marginTop: 4,
  },
  iconButton: {
    width: 38,
    height: 38,
    borderRadius: 11,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: 'rgba(20,20,20,0.82)',
  },
  iconButtonActive: {
    backgroundColor: '#3E6AE1',
  },
  agoPill: {
    flex: 1,
    flexDirection: 'row',
    alignItems: 'center',
    alignSelf: 'flex-start',
    justifyContent: 'center',
    gap: 7,
    height: 38,
    marginHorizontal: 10,
    paddingHorizontal: 16,
    borderRadius: 11,
    backgroundColor: 'rgba(20,20,20,0.82)',
  },
  agoText: {
    fontSize: 16,
    fontWeight: '600',
    color: 'white',
  },
  rightStack: {
    gap: 10,
  },
  navigateBar: {
    position: 'absolute',
    left: 0,
    right: 0,
    bottom: 0,
    paddingHorizontal: 16,
    paddingTop: 8,
    backgroundColor: '#161616',
  },
  tripBar: {
    position: 'absolute',
    left: 0,
    right: 0,
    bottom: 0,
    paddingHorizontal: 16,
    paddingTop: 10,
    backgroundColor: '#161616',
  },
  tripSendButton: {
    height: 52,
    borderRadius: 12,
    backgroundColor: '#3E6AE1',
    alignItems: 'center',
    justifyContent: 'center',
  },
  tripSendText: { fontSize: 17, fontWeight: '700', color: 'white' },
  tripCancelButton: { alignItems: 'center', paddingVertical: 8, marginTop: 2 },
  tripCancelText: { fontSize: 16, color: 'rgba(255,255,255,0.7)' },
  navigateRow: {
    flexDirection: 'row',
    gap: 10,
    marginBottom: 6,
  },
  navigateButton: {
    flex: 1,
    height: 52,
    borderRadius: 14,
    flexDirection: 'row',
    gap: 8,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: '#3E6AE1',
  },
  navigateText: {
    fontSize: 17,
    fontWeight: '700',
    color: 'white',
  },
  navigateButtonSecondary: {
    flex: 1,
    height: 52,
    borderRadius: 14,
    flexDirection: 'row',
    gap: 8,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: 'rgba(255,255,255,0.12)',
  },
  navigateButtonDisabled: {
    opacity: 0.4,
  },
  navigateTextDisabled: {
    color: 'rgba(255,255,255,0.5)',
  },
  pinWrap: {
    alignItems: 'center',
  },
  pinBubble: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 2,
    paddingHorizontal: 7,
    height: 26,
    borderRadius: 13,
    backgroundColor: '#E5484D',
  },
  pinCount: {
    color: 'white',
    fontSize: 13,
    fontWeight: '700',
  },
  pinTail: {
    width: 0,
    height: 0,
    marginTop: -1,
    borderLeftWidth: 6,
    borderRightWidth: 6,
    borderTopWidth: 8,
    borderLeftColor: 'transparent',
    borderRightColor: 'transparent',
    borderTopColor: '#E5484D',
  },
});
