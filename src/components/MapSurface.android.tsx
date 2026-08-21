// Android map placeholder — STOPGAP until Phase 5 lands MapLibre.
//
// react-native-maps draws through Google Maps on Android, which kills the process outright
// when no API key is present:
//
//   FATAL EXCEPTION: androidmapsapi-ula-1
//   java.lang.IllegalStateException: API key not found.
//
// Google's Maps SDK for Android is $0 for unlimited map loads, but it still requires a GCP
// billing account on file, which this project deliberately does not have. Phase 5 replaces
// this file with MapLibre GL + OpenFreeMap vector tiles — keyless, accountless, MIT.
//
// Until then this renders an inert panel so the surrounding screens (Location, Find Chargers,
// the place-preview sheet, the charger list) stay usable instead of taking the app down. Every
// imperative method callers use is a no-op, and `getCamera` returns a plausible camera rather
// than undefined so `await`ing callers do not throw.
import { forwardRef, useEffect, useImperativeHandle, useRef } from 'react';
import { StyleSheet, Text, View } from 'react-native';

export type { MapType, Region } from 'react-native-maps';

/** Marker is a no-op here — markers are drawn by the map, and there is no map yet. */
export function Marker(_props: Record<string, unknown>) {
  return null;
}

export const PROVIDER_DEFAULT = undefined;

interface StubRegion {
  latitude: number;
  longitude: number;
  latitudeDelta: number;
  longitudeDelta: number;
}

interface StubProps {
  children?: React.ReactNode;
  style?: unknown;
  initialRegion?: StubRegion;
  onMapReady?: () => void;
  onRegionChangeComplete?: (r: StubRegion) => void;
}

const MapSurfaceStub = forwardRef<unknown, StubProps>(
  ({ children, style, initialRegion, onMapReady, onRegionChangeComplete }, ref) => {
    const region = useRef(initialRegion);
    region.current = initialRegion ?? region.current;

    // Behave like a map that mounted successfully at initialRegion. This matters beyond
    // cosmetics: location.tsx gates its charger fetch on `mapReady` (`if (tab !== 'charging'
    // || !mapReady) return`), so a stub that never signals ready silently disables charger
    // discovery — which reads as "No chargers in this area" rather than "no map".
    useEffect(() => {
      onMapReady?.();
      if (region.current) onRegionChangeComplete?.(region.current);
      // Mount-once: a real map fires onMapReady exactly once.
      // eslint-disable-next-line react-hooks/exhaustive-deps
    }, []);

    useImperativeHandle(ref, () => ({
      // The full imperative surface location.tsx uses. All inert; none may throw.
      deselectFeatures: () => {},
      animateCamera: () => {},
      animateToRegion: () => {},
      fitToCoordinates: () => {},
      getCamera: async () => ({
        center: region.current
          ? { latitude: region.current.latitude, longitude: region.current.longitude }
          : { latitude: 0, longitude: 0 },
        zoom: 12,
        heading: 0,
        pitch: 0,
      }),
    }));

    return (
      <View style={[styles.fill, style as object]} pointerEvents="box-none">
        <View style={styles.center} pointerEvents="none">
          <Text style={styles.title}>Map unavailable on Android</Text>
          <Text style={styles.body}>MapLibre + OpenFreeMap lands in Phase 5.</Text>
        </View>
        {/* Children are Markers, which render null — kept mounted so their effects still run. */}
        {children}
      </View>
    );
  },
);
MapSurfaceStub.displayName = 'MapSurfaceStub';

const styles = StyleSheet.create({
  fill: { flex: 1, backgroundColor: '#1E2022' },
  center: {
    position: 'absolute',
    top: 0,
    left: 0,
    right: 0,
    bottom: 0,
    alignItems: 'center',
    justifyContent: 'center',
    padding: 24,
  },
  title: { color: 'rgba(255,255,255,0.55)', fontSize: 15, marginBottom: 6 },
  body: { color: 'rgba(255,255,255,0.3)', fontSize: 13, textAlign: 'center' },
});

export default MapSurfaceStub;
