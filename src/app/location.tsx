import { useEffect, useMemo, useRef, useState } from 'react';
import { Linking, Platform, Pressable, StyleSheet, Text, useWindowDimensions, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { SymbolView, type SFSymbol } from 'expo-symbols';
import * as Haptics from 'expo-haptics';
import * as Location from 'expo-location';
import { useLocalSearchParams, useRouter } from 'expo-router';
import MapView, { Marker, PROVIDER_DEFAULT, type MapType, type Region } from 'react-native-maps';

import {
  LocationSheet,
  SHEET_MINIMAL_FRAC,
  SHEET_TALL_FRAC,
  type ChargerFilter,
  type ChargerSort,
  type LocationSheetHandle,
  type LocationTab,
} from '@/components/LocationSheet';
import { useVehicle, useCarLinkStatus } from '@/state/VehicleProvider';
import { relativeAge } from '@/ble/vehicleStatusText';
import { BusyIcon } from '@/components/BusyIcon';
import { controlHaptic } from '@/state/controlHaptic';
import {
  distanceMeters,
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
import { PlacePreviewSheet, type DroppedPin } from '@/components/PlacePreviewSheet';
import { SendToCarButton } from '@/components/SendToCarButton';
import { EdgeSwipeBack } from '@/components/EdgeSwipeBack';
import type { Place } from '@/services/place';
import { sharedLocationStore } from '@/state/sharedLocationStore';
import { useSendToCar } from '@/hooks/useSendToCar';

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

// Car-location view. Native map (Apple Maps on iOS, Google on Android) with the car pinned to the
// user's live GPS plus a stable per-car offset (mock until BLE). Top controls mirror the Tesla app;
// the draggable bottom sheet holds Navigate + Recents/Charging.
export default function LocationView() {
  const router = useRouter();
  // Deep-link: the Charging screen's "Find Chargers" opens `/location?tab=charging` straight on the Charging tab.
  const { tab: tabParam } = useLocalSearchParams<{ tab?: string }>();
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
  const carLink = useCarLinkStatus();
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

  // A point long-pressed on the map (our own pin, reverse-geocoded) OR a tapped Apple map feature (Apple's
  // own marker, enriched via onPoiClick). Its preview panel takes over the sheet.
  const [droppedPin, setDroppedPin] = useState<DroppedPin | null>(null);
  // Charging deep-link: expand the sheet so the charger list is visible on arrival (the [tab] effect already
  // frames the map + fetches stations). Deferred a frame so the sheet's imperative handle is ready.
  useEffect(() => {
    if (tabParam !== 'charging') return;
    const id = requestAnimationFrame(() => sheetRef.current?.expand());
    return () => cancelAnimationFrame(id);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);
  // Dismiss the preview card AND clear Apple's native feature selection (the "enlarged" highlight), so the
  // card and the map stay in sync — otherwise a tapped POI stays enlarged after the card closes. (The stray
  // onPress a feature tap would otherwise fire is suppressed natively, so no debounce is needed here.)
  const dismissDroppedPin = () => {
    setDroppedPin(null);
    mapRef.current?.deselectFeatures?.();
  };

  // Select a place → record it as a recent and show it as a pin, so the Send to
  // Car bar has a target. Selecting is no longer a commitment to anything.
  const onSelectPlace = (place: Place) => {
    nav.select(place);
    if (!place.coordinate) return; // unresolved Apple completion — nothing to show or send
    setDroppedPin({
      coordinate: place.coordinate,
      name: place.title,
      subtitle: place.subtitle ?? '',
      fromPoi: false,
    });
    mapRef.current?.animateCamera({ center: place.coordinate }, { duration: 350 });
  };

  // Frame the shared place once the map can actually accept a camera move. `animateCamera` is a no-op
  // before `onMapReady` (see mapReady above), so on a cold-launch share the pin would land while the map is
  // still on the car with the marker off-screen. Gating on the same `mapReady` the Charging fit uses moves
  // the camera immediately when warm, or on first readiness when cold.
  const [pendingShareFrame, setPendingShareFrame] = useState<LatLng | null>(null);
  useEffect(() => {
    if (!mapReady || !pendingShareFrame) return;
    mapRef.current?.animateCamera({ center: pendingShareFrame }, { duration: 350 });
    setPendingShareFrame(null);
  }, [mapReady, pendingShareFrame]);

  // A shared place is sent the moment it arrives — the choice was already made by
  // sharing into airgapp. The screen still opens so the toast has somewhere to
  // land and you can see the pin that was sent.
  const sendToCar = useSendToCar();
  useEffect(() => {
    const consume = () => {
      const intent = sharedLocationStore.consume();
      if (!intent) return;
      const { coordinate, name, address } = intent.location;
      setSelectedCharger(null); // showing a shared place supersedes any open charger detail (don't restore it on close)
      setTab('location'); // a share exits charging mode → chargers clear off the map behind the preview
      setDroppedPin({
        coordinate,
        name: name ?? 'Shared Location',
        subtitle: address || `${coordinate.latitude.toFixed(4)}, ${coordinate.longitude.toFixed(4)}`,
        fromPoi: false,
      });
      setPendingShareFrame(coordinate);
      sendToCar({ name, address, coordinate });
    };
    consume();
    return sharedLocationStore.subscribe(consume);
  }, [sendToCar]);

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
      // ⚠️ DEVICE-VERIFIED: `addr.name` / `addr.street` are NOT reliably a street here — on this phone
      // reverse-geocoding returns a POSTAL CODE ('814 01') or a bare house number in them. Neither may
      // become the pin's `name`, because that is exactly what destinationTitle prefers and therefore what
      // the CAR displays: "814 01" in the route list tells you nothing. So take a street segment only when
      // it actually contains a letter, and always compose it with the locality — the composed line is both
      // the pin's on-screen title and the label we hand the car. (This is the knowledge the deleted
      // `carName` effect carried: fall back through city → district → subregion → region.)
      const hasLetter = (s: string | null | undefined): s is string => !!s && /[^\d\s.,\-]/.test(s);
      const street = [addr.street, addr.name].find(hasLetter);
      const locality = [addr.city, addr.district, addr.subregion, addr.region].find(hasLetter);
      const name =
        [street, locality, addr.region]
          .filter((s): s is string => !!s)
          .filter((s, i, all) => all.indexOf(s) === i)
          .join(', ') || coords;
      // The coordinate moves to the detail row: the composed address is now the title, so repeating it
      // underneath would just be the same line twice.
      setDroppedPin((cur) =>
        cur && cur.coordinate.latitude === coordinate.latitude && cur.coordinate.longitude === coordinate.longitude
          ? { coordinate, name, subtitle: coords, fromPoi: false }
          : cur,
      );
    } catch {
      // Keep the coordinate fallback if reverse-geocoding fails.
    }
  };

  // Bottom edge-padding for a map fit: reserve down to wherever the given sheet currently rests (mapPadding
  // already reserves the minimal detent, so subtract it). Honors the sheet's current detent and caps at middle
  // when it is fully extended (reserveFrac). Falls back to fallbackFrac if the sheet ref isn't mounted yet.
  const fitBottomPad = (sheetHandle: LocationSheetHandle | null, fallbackFrac: number) => {
    const frac = sheetHandle?.reserveFrac?.() ?? fallbackFrac;
    return Math.round(height * (frac - SHEET_MINIMAL_FRAC));
  };
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

  // The pill's age. Was `formatTimeAgo(getMockLastUpdated())` — a fixed ~62 days
  // in the past so it would READ like the real app ("2 months ago") without
  // being connected to anything.
  //
  // Now the real thing: `carLocationAt`, stamped in the same branch that
  // produces `carLocation` and cached beside it, so a cold start shows the true
  // age instead of a blank or a lie.
  //
  // Formatter is `relativeAge` — the RECOVERED one (a port of moment's fromNow
  // with the official app's thresholds), the same function behind the home
  // header's "Last seen 2 hours ago". mockLocation had a second, hand-rolled
  // formatter with different thresholds and floor() instead of round(), so the
  // two screens could disagree about the same instant. One formatter now.
  // The tick holds the TIME, not a counter. Home uses a counter and reads
  // Date.now() during render, which is an impure render — fine in practice but a
  // lint error, and one I should not add a second instance of. Keeping the clock
  // in state makes the render a pure function of its inputs.
  const [nowMs, setNowMs] = useState(() => Date.now());
  useEffect(() => {
    // Ticks the label between reads, as Home does for its status line.
    const id = setInterval(() => setNowMs(Date.now()), 5_000);
    return () => clearInterval(id);
  }, []);
  const lastUpdatedLabel =
    vehState.carLocationAt != null ? relativeAge(nowMs - vehState.carLocationAt, true) : null;

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
  // Recentre on the car when a GPS fix arrives/refreshes — but NOT while a pin preview (long-press/POI/search
  // result/shared location) is showing, or the late GPS fix would yank the map off the previewed location back
  // to the car.
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
  // availability. (Sending the charger to the car is the SendToCarButton's job, below.)
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
  // Kept as the charger row/pin tap target. Sending is the SendToCarButton's job,
  // so this only opens the detail and frames the map on it.
  const onNavigateToCharger = (c: Charger) => {
    onSelectCharger(c);
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
      </MapView>

      <SafeAreaView edges={['top']} style={styles.topBar} pointerEvents="box-none">
        <View style={styles.topRow} pointerEvents="box-none">
          <Pressable style={styles.iconButton} onPress={() => router.back()} hitSlop={6}>
            <SymbolView name="chevron.left" tintColor="white" size={20} weight="semibold" />
          </Pressable>

          {/* OURS, NOT THEIRS — deliberately. VehicleLocationScreen
              @5059373-5062126 has no refresh control and no timestamp; every
              string it uses is a marker label, an empty state or an error, and
              the whole vehicle_location_screen_* family has no last-updated key.
              Their age lives once, in the home header's "Last seen {{age}}".
              Ivan's call to keep it and make it work rather than match them.

              So it must actually DO something: the glyph used to be decorative
              beside a hardcoded "2 months ago". It now wakes and re-reads the
              car — carLink.refresh(), the same path as pull-to-refresh and the
              status tap — and shows the header's BusyIcon while in flight, so
              the spinner means "fetching" rather than being a second idle icon.

              Hidden entirely when we have never had a fix: a pill reading "just
              now" beside an empty map would be worse than no pill. */}
          {lastUpdatedLabel ? (
            <Pressable
              style={styles.agoPill}
              onPress={() => {
                controlHaptic();
                carLink.refresh();
              }}
              // A demo/unlinked car has nothing to re-read; refresh() is a no-op
              // there, so the control goes rather than sitting there inert.
              disabled={!carLink.linked || carLink.wakeInFlight}
            >
              {carLink.wakeInFlight ? (
                <BusyIcon size={15} />
              ) : (
                <SymbolView
                  name="arrow.clockwise"
                  tintColor="rgba(255,255,255,0.85)"
                  size={15}
                  weight="semibold"
                />
              )}
              <Text style={styles.agoText}>{lastUpdatedLabel}</Text>
            </Pressable>
          ) : (
            <View style={styles.agoSpacer} />
          )}

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
        />
      )}

      {/* The one action on a place: send it to the car. Floats at the screen bottom over the sheet, so it's
          reachable at every detent (the sheet always covers the screen bottom). The pin preview wins over the
          charger detail — opening a pin already clears the selected charger. */}
      {droppedPin ? (
        <SendToCarButton
          target={{
            name: droppedPin.name,
            address: droppedPin.address ?? droppedPin.subtitle,
            coordinate: droppedPin.coordinate,
          }}
          onSent={dismissDroppedPin}
        />
      ) : tab === 'charging' && selectedCharger ? (
        <SendToCarButton
          target={{
            name: selectedCharger.name,
            address: selectedCharger.region || selectedCharger.place,
            coordinate: chargerCoord(selectedCharger),
          }}
        />
      ) : null}

      {/* Standard iOS left-edge swipe-back (the native full-screen gesture is disabled in _layout — since iOS
          26 it responds to the whole screen, which would fight map/sheet drags). */}
      <EdgeSwipeBack onBack={() => router.back()} />
    </View>
  );
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
  // Keeps the back button and the right stack where they are when the pill is
  // absent; without it they would slide together on a car we have never located.
  agoSpacer: {
    flex: 1,
  },
  rightStack: {
    gap: 10,
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
