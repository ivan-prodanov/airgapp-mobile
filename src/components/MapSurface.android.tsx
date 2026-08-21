// The Android map surface — MapLibre GL + OpenFreeMap vector tiles.
//
// WHY NOT react-native-maps HERE: on Android it renders through Google Maps, which HARD-KILLS the
// process without an API key —
//   FATAL EXCEPTION: androidmapsapi-ula-1
//   java.lang.IllegalStateException: API key not found.
// Google's Maps SDK for Android is $0 for unlimited loads, but it still requires a GCP billing
// account on file, which this project deliberately does not have. MapLibre is MIT, and
// OpenFreeMap serves OSM vector tiles with no key, no account and no quota.
//
// This file presents the react-native-maps surface `location.tsx` already speaks — a default
// MapView export, `Marker`, `PROVIDER_DEFAULT`, and the five imperative ref methods — so the
// screen itself stays platform-agnostic. MapSurface.tsx (iOS) is a pure pass-through, and
// TypeScript resolves THAT file for both platforms, so the types stay the real react-native-maps
// ones and this implementation must remain structurally compatible with them.
//
// The coordinate maths lives in mapRegion.ts, node-tested: MapLibre speaks [longitude, latitude]
// and [west, south, east, north] while the rest of the app says {latitude, longitude}, and a flip
// does not throw — it just puts the car in the ocean.
import {
  Camera,
  Map,
  Marker as MLMarker,
  UserLocation,
  type CameraRef,
  type MapRef,
} from '@maplibre/maplibre-react-native';
import { forwardRef, useCallback, useImperativeHandle, useRef } from 'react';
import { StyleSheet, View } from 'react-native';

/**
 * react-native-maps' `mapPadding` maps onto MapLibre's `contentInset`, NOT onto `<Camera padding>`.
 *
 * That distinction is the whole of this bug. `<Camera padding>` applies to the declarative camera
 * state only, so a `flyTo`/`fitBounds` issued through the ref ignored it — which is why only the
 * one call that passed `edgePadding` explicitly (the charger fit) framed correctly, and every other
 * operation, including the initial car view, centred behind the bottom sheet. `contentInset` is
 * added to EVERY camera stop by the Android binding, whose own comment says it does this "to mimic
 * MLN iOS behavior" (CameraStop.kt) — which is exactly the parity we want, because on iOS
 * react-native-maps' mapPadding insets the map's logical viewport for every camera move.
 *
 * UNITS: dp, not pixels. The binding multiplies by display density itself, in both
 * MLRNMapView.contentInset and CameraStop's own padding. An earlier attempt here converted dp→px
 * first, which tripled every inset on this 3x screen; the charger fit only looked right because
 * over-padding happened to push the marker into view.
 */
function inset(p?: { top?: number; right?: number; bottom?: number; left?: number }) {
  if (!p) return undefined;
  return {
    top: Math.round(p.top ?? 0),
    right: Math.round(p.right ?? 0),
    bottom: Math.round(p.bottom ?? 0),
    left: Math.round(p.left ?? 0),
  };
}

import {
  boundsForCoordinates,
  boundsToRegion,
  normalizeMapLibrePoi,
  regionToBounds,
  type RegionLike,
} from './mapRegion';

export type { MapType, Region } from 'react-native-maps';

// OpenFreeMap styles — free, keyless, no account, community-run OSM vector tiles.
//
// Vector rather than raster matters twice over: POI labels arrive as queryable features (which is
// what makes the Apple-parity "tap a place label" behaviour possible at all), and the palette can
// be swapped without refetching imagery.
//
// `dark` has a near-black background (rgb(12,12,12)) that sits against the app's #161718 chrome,
// matching what iOS gets from its DARK_MAP_STYLE override.
const STYLE_DARK = 'https://tiles.openfreemap.org/styles/dark';
const STYLE_LIGHT = 'https://tiles.openfreemap.org/styles/liberty';

// KNOWN GAP: OpenFreeMap serves no satellite imagery, so the map-type toggle's satellite/hybrid
// modes fall back to the dark vector style rather than silently showing the wrong thing. Closing
// it needs a second, separately-vetted tile source.
function styleFor(mapType?: string): string {
  // iOS applies DARK_MAP_STYLE for 'standard' and Apple's imagery for 'hybrid'. We match the
  // former and, lacking imagery, keep the dark vector style for the latter rather than showing
  // something that pretends to be satellite.
  return mapType === 'mutedStandard' || mapType === 'light' ? STYLE_LIGHT : STYLE_DARK;
}

/** POI label layers in the Liberty style. A tap on anything else is a background tap. */
const POI_LAYERS = ['poi', 'poi_z16', 'poi_z15', 'poi_z14', 'place_label'];

interface MarkerProps {
  coordinate: { latitude: number; longitude: number };
  /** react-native-maps takes a fractional {x, y}; MapLibre takes a named anchor. */
  anchor?: { x: number; y: number };
  flat?: boolean;
  children?: React.ReactNode;
  identifier?: string;
}

/** {x: 0.5, y: 0.5} is react-native-maps' "centre on the point"; everything else keeps the default. */
function toMapLibreAnchor(a?: { x: number; y: number }) {
  return a && a.x === 0.5 && a.y === 0.5 ? ('center' as const) : undefined;
}

/**
 * MapLibre requires every Marker to carry an `id` and REFUSES to let it change — mutating it
 * throws "`id` cannot be changed" and takes the app down. react-native-maps has no such concept,
 * and our markers move constantly (the car marker follows telemetry), so the id must NOT be
 * derived from the coordinate. Each mounted Marker gets one stable id for its lifetime instead.
 */
let markerSeq = 0;

/** react-native-maps' `<Marker coordinate=…>` mapped onto MapLibre's `<Marker lngLat=…>`. */
export function Marker({ coordinate, anchor, children, identifier }: MarkerProps) {
  const autoId = useRef<string>(undefined);
  if (autoId.current === undefined) autoId.current = `marker-${markerSeq++}`;
  return (
    <MLMarker
      id={identifier ?? autoId.current}
      lngLat={[coordinate.longitude, coordinate.latitude]}
      anchor={toMapLibreAnchor(anchor)}>
      <View>{children ?? <View style={styles.defaultPin} />}</View>
    </MLMarker>
  );
}

export const PROVIDER_DEFAULT = undefined;

interface SurfaceProps {
  children?: React.ReactNode;
  style?: unknown;
  initialRegion?: RegionLike;
  mapPadding?: { top?: number; right?: number; bottom?: number; left?: number };
  mapType?: string;
  showsUserLocation?: boolean;
  onMapReady?: () => void;
  onRegionChangeComplete?: (r: RegionLike) => void;
  onPress?: () => void;
  onLongPress?: (e: {
    nativeEvent: { coordinate: { latitude: number; longitude: number } };
  }) => void;
  onPoiClick?: (e: {
    nativeEvent: {
      name: string;
      coordinate: { latitude: number; longitude: number };
      placeId?: string;
    };
  }) => void;
}

const MapSurface = forwardRef<unknown, SurfaceProps>(function MapSurface(
  {
    children,
    style,
    initialRegion,
    mapPadding,
    mapType,
    showsUserLocation,
    onMapReady,
    onRegionChangeComplete,
    onPress,
    onLongPress,
    onPoiClick,
  },
  ref,
) {
  const mapRef = useRef<MapRef>(null);
  const cameraRef = useRef<CameraRef>(null);
  // Last settled view, so getCamera() can answer without a native round trip.
  const lastRegion = useRef<RegionLike | undefined>(initialRegion);

  useImperativeHandle(ref, () => ({
    // location.tsx calls this to clear a selected map feature. MapLibre has no persistent feature
    // selection — a tap is just a query — so there is nothing to clear.
    deselectFeatures: () => {},

    animateCamera: (
      cam: { center: { latitude: number; longitude: number } },
      opts?: { duration?: number },
    ) => {
      cameraRef.current?.flyTo({
        center: [cam.center.longitude, cam.center.latitude],
        duration: opts?.duration ?? 350,
      });
    },

    animateToRegion: (r: RegionLike, duration = 400) => {
      cameraRef.current?.fitBounds(regionToBounds(r), { duration });
    },

    fitToCoordinates: (
      points: { latitude: number; longitude: number }[],
      opts?: {
        edgePadding?: { top: number; right: number; bottom: number; left: number };
        animated?: boolean;
      },
    ) => {
      const bounds = boundsForCoordinates(points);
      if (!bounds) return;
      const p = opts?.edgePadding;
      cameraRef.current?.fitBounds(bounds, {
        // Additional to contentInset, which the binding adds on top — the same layering
        // react-native-maps has between mapPadding and edgePadding on iOS.
        padding: inset(p),
        duration: opts?.animated === false ? 0 : 400,
      });
    },

    // Shaped like react-native-maps' Camera so `cam?.center` reads identically on both platforms.
    getCamera: async () => {
      const r = lastRegion.current;
      return {
        center: r
          ? { latitude: r.latitude, longitude: r.longitude }
          : { latitude: 0, longitude: 0 },
        zoom: (await mapRef.current?.getZoom()) ?? 12,
        heading: 0,
        pitch: 0,
      };
    },
  }));

  const handlePress = useCallback(
    async (e: { nativeEvent: { lngLat: [number, number]; point: [number, number] } }) => {
      // Apple resolves a label tap into its own onPoiClick. MapLibre carries no such notion, so we
      // ask what is rendered under the touch point and synthesise the same event — which is what
      // keeps location.tsx's POI handling platform-agnostic.
      //
      // Vector tiles are what make this possible at all: a raster basemap has no queryable labels,
      // which is why the style URL above must stay a vector one.
      const features =
        (await mapRef.current?.queryRenderedFeatures(e.nativeEvent.point, {
          layers: POI_LAYERS,
        })) ?? [];
      for (const f of features) {
        const poi = normalizeMapLibrePoi(f);
        if (poi) {
          onPoiClick?.({
            nativeEvent: {
              name: poi.name,
              coordinate: { latitude: poi.latitude, longitude: poi.longitude },
              // location.tsx JSON.parses this for category/address extras. Apple supplies them;
              // OSM vector tiles do not carry the same fields, so send an empty object rather
              // than something that would parse into wrong values.
              placeId: '{}',
            },
          });
          return;
        }
      }
      onPress?.();
    },
    [onPoiClick, onPress],
  );

  return (
    <Map
      ref={mapRef}
      style={[StyleSheet.absoluteFill, style as object]}
      mapStyle={styleFor(mapType)}
      // The iOS `mapPadding` equivalent — see the note on `inset` above. Applies to the initial
      // view and to every imperative camera move, so the car, a shared place, a tapped charger and
      // a multi-point fit all land in the space ABOVE the bottom sheet rather than behind it.
      contentInset={inset(mapPadding)}

      // The app draws its own chrome; MapLibre's built-in ornaments would double up.
      logo={false}
      attribution={false}
      compass={false}
      onDidFinishLoadingMap={() => onMapReady?.()}
      onRegionDidChange={(e) => {
        const region = boundsToRegion(e.nativeEvent.bounds);
        lastRegion.current = region;
        onRegionChangeComplete?.(region);
      }}
      onPress={handlePress}
      onLongPress={(e) =>
        onLongPress?.({
          nativeEvent: {
            coordinate: {
              latitude: e.nativeEvent.lngLat[1],
              longitude: e.nativeEvent.lngLat[0],
            },
          },
        })
      }
    >
      <Camera
        ref={cameraRef}
        // EITHER center OR bounds — InitialViewState is a union and passing both yields a
        // nonsense view (observed: the map opened on the whole Mediterranean instead of the
        // car). Bounds carries the zoom implicitly, which is what a Region means.
        initialViewState={initialRegion ? { bounds: regionToBounds(initialRegion) } : undefined}
        // NO `padding` prop here on purpose: the map's contentInset is already added to every
        // camera stop, and setting both would double the reserved space.
      />
      {showsUserLocation ? <UserLocation /> : null}
      {children}
    </Map>
  );
});

const styles = StyleSheet.create({
  defaultPin: {
    width: 14,
    height: 14,
    borderRadius: 7,
    backgroundColor: '#3B82F6',
    borderWidth: 2,
    borderColor: '#FFFFFF',
  },
});

export default MapSurface;
