import { requireOptionalNativeModule } from 'expo';

import type { AppleCompletion, AppleRegion, AppleResult, AppleRoute } from './AppleSearch.types';

declare class AppleSearchModule {
  // MKLocalSearchCompleter typeahead — suggestions only (no coordinates).
  complete(query: string, region: AppleRegion): Promise<AppleCompletion[]>;
  // MKLocalSearch — full results WITH coordinates.
  search(query: string, region: AppleRegion): Promise<AppleResult[]>;
  // MKDirections — polyline + per-leg distance/duration + totals for consecutive coords.
  route(coords: { latitude: number; longitude: number }[]): Promise<AppleRoute>;
}

// Optional: MapKit is Apple-only, so this is null on Android. Callers must handle null —
// src/services/appleSearch.ts throws a catchable error that searchProvider degrades from,
// falling back to the offline gazetteer (and, on Android, to Photon).
export default requireOptionalNativeModule<AppleSearchModule>('AppleSearch');
