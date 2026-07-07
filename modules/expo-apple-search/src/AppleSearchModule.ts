import { requireNativeModule } from 'expo';

import type { AppleCompletion, AppleRegion, AppleResult } from './AppleSearch.types';

declare class AppleSearchModule {
  // MKLocalSearchCompleter typeahead — suggestions only (no coordinates).
  complete(query: string, region: AppleRegion): Promise<AppleCompletion[]>;
  // MKLocalSearch — full results WITH coordinates.
  search(query: string, region: AppleRegion): Promise<AppleResult[]>;
}

export default requireNativeModule<AppleSearchModule>('AppleSearch');
