// The map seam. iOS keeps react-native-maps (Apple Maps) exactly as before — this file is a
// pure pass-through, so nothing about the iOS render changes.
//
// The seam exists because react-native-maps on Android renders through Google Maps, which
// HARD-CRASHES the process without a billing-backed API key:
//
//   FATAL EXCEPTION: androidmapsapi-ula-1
//   java.lang.IllegalStateException: API key not found.
//
// Not a red box, not a grey tile — a native process kill, taking Location and Find Chargers
// down with it. MapSurface.android.tsx therefore renders a placeholder instead, and Phase 5
// replaces that file with MapLibre + OpenFreeMap (keyless, no billing account, MIT).
//
// Platform resolution is Metro's `.android.tsx` extension. TypeScript resolves THIS file for
// both platforms, so the types below stay the real react-native-maps ones and the Android
// stub has to remain structurally compatible with them.
import MapView, { Marker, PROVIDER_DEFAULT } from 'react-native-maps';

export type { MapType, Region } from 'react-native-maps';
export { Marker, PROVIDER_DEFAULT };
export default MapView;
