import { useEffect, useMemo, useRef, useState } from 'react';
import { Linking, Platform, Pressable, Share, StyleSheet, Text, useWindowDimensions, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { SymbolView, type SFSymbol } from 'expo-symbols';
import * as Haptics from 'expo-haptics';
import * as Location from 'expo-location';
import { useRouter } from 'expo-router';
import MapView, { Marker, Polyline, PROVIDER_DEFAULT, type MapType, type Region } from 'react-native-maps';

import {
  LocationSheet,
  SHEET_MIDDLE_FRAC,
  SHEET_MINIMAL_FRAC,
  type ChargerFilter,
  type ChargerSort,
  type LocationSheetHandle,
  type LocationTab,
} from '@/components/LocationSheet';
import { useFleet } from '@/state/VehicleProvider';
import {
  distanceMeters,
  formatKm,
  formatTimeAgo,
  getMockLastUpdated,
  offsetCoordinate,
  type LatLng,
  type MockLocationOffset,
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
import { straightLineLegs, tripTotals } from '@/state/trip';
import { useTripRoute } from '@/state/useTripRoute';
import { TripSheet, TRIP_SHEET_FRAC, type TripSheetHandle, type TripRowAction } from '@/components/TripSheet';
import { TripRowMenu } from '@/components/TripRowMenu';
import type { Place } from '@/services/place';

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

// Car-location view. Native map (Apple Maps on iOS, Google on Android) with the car pinned to the
// user's live GPS plus a stable per-car offset (mock until BLE). Top controls mirror the Tesla app;
// the draggable bottom sheet holds Navigate + Recents/Charging.
export default function LocationView() {
  const router = useRouter();
  const fleet = useFleet();
  const { height } = useWindowDimensions();
  const mapRef = useRef<MapView | null>(null);

  // Pad the map's centring by the minimal-detent panel height so the car (and any animateToRegion)
  // lands in the visible space ABOVE the panel, not behind it — the map itself stays full-screen.
  const mapPadding = useMemo(
    () => ({ top: 0, right: 0, bottom: Math.round(height * SHEET_MINIMAL_FRAC), left: 0 }),
    [height],
  );

  const offset: MockLocationOffset = useMemo(() => {
    const active = fleet.vehicles.find((v) => v.id === fleet.activeId) ?? fleet.vehicles[0];
    return active.mockLocationOffset;
  }, [fleet.vehicles, fleet.activeId]);

  const [userCoord, setUserCoord] = useState<LatLng | null>(null);
  const [mapType, setMapType] = useState<MapType>('standard');
  const [tab, setTab] = useState<LocationTab>('recents');
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

  const carCoord = useMemo(
    () => offsetCoordinate(userCoord ?? FALLBACK_COORD, offset),
    [userCoord, offset],
  );

  // Navigate search (recents tab): live Apple/local results + persisted recents.
  const nav = useNavigateSearch(region);

  // Trip planning: selecting a place builds an in-memory trip shown in the TripSheet.
  const trip = useTrip();
  const [screen, setScreen] = useState<'search' | 'trip'>('search');
  const tripSheetRef = useRef<TripSheetHandle>(null);
  // Departure clock for the itinerary (set when a trip starts, so times are stable while viewing).
  const [departAt, setDepartAt] = useState(0);
  // When set, the next place picked in search is inserted at this index instead of appended (Insert Stop).
  const [pendingInsert, setPendingInsert] = useState<number | null>(null);
  // Long-press context menu target (trip stop index + the row's screen Y).
  const [rowMenu, setRowMenu] = useState<{ index: number; anchorY: number } | null>(null);
  // True while picking a charger to append to the active trip (reuses the Charging tab).
  const [addingCharger, setAddingCharger] = useState(false);

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
      setDepartAt(Date.now());
      setScreen('trip');
      tripSheetRef.current?.expand();
    }
  };

  // Row actions from the swipe/long-press menu. Copy/Share are wired in later tasks.
  const onTripRowAction = (index: number, action: TripRowAction) => {
    if (!trip.trip) return;
    const stop = trip.trip.stops[index];
    if (action === 'delete') onRemoveStop(stop.id);
    else if (action === 'insert') {
      setPendingInsert(index + 1);
      setScreen('search');
    } else if (action === 'share') {
      const c = stop.coordinate;
      const mapsUrl = c ? `https://maps.apple.com/?ll=${c.latitude},${c.longitude}&q=${encodeURIComponent(stop.title)}` : '';
      Share.share({ message: [stop.title, stop.subtitle, mapsUrl].filter(Boolean).join('\n') }).catch(() => {});
    } else if (action === 'copy') {
      copyStop(stop.title, stop.subtitle);
    }
  };
  const openRowMenu = (index: number, anchorY: number) => {
    Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Medium).catch(() => {});
    setRowMenu({ index, anchorY });
  };
  // Add Charger → frame the trip and open the Charging tab in "add to trip" mode; the charger detail's
  // action becomes "Add to Trip".
  const onAddChargerToTrip = () => {
    if (!trip.trip) return;
    mapRef.current?.fitToCoordinates(trip.trip.stops.map((s) => s.coordinate), {
      edgePadding: { top: 80, right: 40, bottom: Math.round(height * (SHEET_MIDDLE_FRAC - SHEET_MINIMAL_FRAC)), left: 40 },
      animated: true,
    });
    setAddingCharger(true);
    setTab('charging');
    setScreen('search');
  };
  // Closing the Charging tab (X) while adding a charger returns to the trip instead of the recents search.
  const onTabChangeFromLocation = (t: LocationTab) => {
    if (addingCharger && t === 'recents') {
      setAddingCharger(false);
      setScreen('trip');
    } else {
      setTab(t);
    }
  };
  // Filled in Task 6 (expo-clipboard needs the native rebuild); Light haptic gives immediate feedback now.
  const copyStop = (_title: string, _subtitle?: string) => {
    Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light).catch(() => {});
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
    trip.clear();
    setScreen('search');
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
      edgePadding: { top: 80, right: 40, bottom: Math.round(height * (TRIP_SHEET_FRAC - SHEET_MINIMAL_FRAC)), left: 40 },
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
    if (sort === 'availability') inView.sort((a, c) => c.availableConnectors - a.availableConnectors || byId(a, c));
    else if (sort === 'price') inView.sort((a, c) => (a.pricePerKWh ?? Infinity) - (c.pricePerKWh ?? Infinity) || byId(a, c));
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

  // Recentre on the car once we have (or refresh) a fix.
  const initialRegion: Region = { ...carCoord, ...DEFAULT_DELTA };
  const recenter = (coord: LatLng) => {
    mapRef.current?.animateToRegion({ ...coord, ...DEFAULT_DELTA }, 400);
  };
  useEffect(() => {
    if (userCoord) recenter(offsetCoordinate(userCoord, offset));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [userCoord]);

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
    if (tab !== 'charging') return;
    fetchViewport(region);
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
        edgePadding: { top: 80, right: 40, bottom: Math.round(height * (SHEET_MIDDLE_FRAC - SHEET_MINIMAL_FRAC)), left: 40 },
        animated: true,
      });
    })();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [tab]);

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
    if (addingCharger && trip.trip) {
      trip.addCharger(c);
      setAddingCharger(false);
      onCloseDetail();
      setTab('recents');
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
  // Placeholder until there's a trip/route concept to add a waypoint to (native maps deep links can't add
  // a stop to an in-progress route). Kept for the two-button layout; wire up when routing exists.
  const onAddStop = () => {
    Haptics.selectionAsync().catch(() => {});
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
        mapType={mapType}
        mapPadding={mapPadding}
        userInterfaceStyle="dark"
        customMapStyle={mapType === 'standard' ? DARK_MAP_STYLE : undefined}
        onRegionChangeComplete={onRegionChangeComplete}
        showsUserLocation
        showsCompass={false}
        showsMyLocationButton={false}
        toolbarEnabled={false}
      >
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

        {screen === 'trip' && tripRoute?.polyline?.length ? (
          <Polyline coordinates={tripRoute.polyline} strokeColor="#3E6AE1" strokeWidth={5} />
        ) : null}

        {screen === 'trip' && trip.trip
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

      {screen === 'trip' && trip.trip ? (
        <TripSheet
          ref={tripSheetRef}
          trip={trip.trip}
          legs={tripLegs}
          now={departAt}
          onAddStop={() => {
            setPendingInsert(null);
            setScreen('search');
          }}
          onAddCharger={onAddChargerToTrip}
          onReorder={trip.reorder}
          onRowAction={onTripRowAction}
          onLongPressRow={openRowMenu}
        />
      ) : (
        <LocationSheet
          ref={sheetRef}
          tab={tab}
          onTabChange={onTabChangeFromLocation}
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
        />
      )}

      {/* Pinned action bar for the charger detail — floats at the screen bottom over the sheet, so it's
          reachable at every detent (the sheet always covers the screen bottom). */}
      {tab === 'charging' && selectedCharger ? (
        <SafeAreaView edges={['bottom']} style={styles.navigateBar} pointerEvents="box-none">
          <View style={styles.navigateRow}>
            {addingCharger ? (
              <Pressable style={styles.navigateButton} onPress={() => onNavigateToCharger(selectedCharger)}>
                <Text style={styles.navigateText}>Add to Trip</Text>
              </Pressable>
            ) : (
              <>
                <Pressable style={styles.navigateButton} onPress={onAddStop}>
                  <Text style={styles.navigateText}>Add Stop</Text>
                </Pressable>
                <Pressable style={styles.navigateButton} onPress={() => onNavigateToCharger(selectedCharger)}>
                  <Text style={styles.navigateText}>Navigate</Text>
                </Pressable>
              </>
            )}
          </View>
        </SafeAreaView>
      ) : null}

      {/* Pinned trip actions — Send to Car / Cancel float at the screen bottom so they stay visible while the
          Trip sheet rests at the middle detent (Send to Car is a local mock — never a network/Tesla call). */}
      {screen === 'trip' && trip.trip ? (
        <SafeAreaView edges={['bottom']} style={styles.tripBar} pointerEvents="box-none">
          <Pressable style={styles.tripSendButton} onPress={() => {}}>
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
          onAction={(a) => onTripRowAction(rowMenu.index, a)}
          onClose={() => setRowMenu(null)}
        />
      ) : null}
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
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: 'rgba(255,255,255,0.25)',
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: 'rgba(255,255,255,0.05)',
  },
  navigateText: {
    fontSize: 17,
    fontWeight: '600',
    color: 'white',
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
