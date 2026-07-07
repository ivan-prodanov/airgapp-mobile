import { requireNativeModule } from 'expo';

import type { AppleCompletion, AppleRegion, AppleResult, AppleRoute } from './AppleSearch.types';

declare class AppleSearchModule {
  // MKLocalSearchCompleter typeahead — suggestions only (no coordinates).
  complete(query: string, region: AppleRegion): Promise<AppleCompletion[]>;
  // MKLocalSearch — full results WITH coordinates.
  search(query: string, region: AppleRegion): Promise<AppleResult[]>;
  // MKDirections — polyline + per-leg distance/duration + totals for consecutive coords.
  route(coords: { latitude: number; longitude: number }[]): Promise<AppleRoute>;
}

export default requireNativeModule<AppleSearchModule>('AppleSearch');
