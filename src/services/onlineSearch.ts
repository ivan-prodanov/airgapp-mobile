// Which online geocoder backs Navigate search, per platform. The decision itself lives in
// onlineSearchPick.ts (pure, node-tested); this module only binds it to the real implementations
// and the runtime platform.
//
// Both implementations REJECT on failure, and searchProvider.runSearch catches that and degrades
// to the offline gazetteer — so the fallback path is identical on both platforms.
import { Platform } from 'react-native';

import { appleSearch } from './appleSearch';
import { photonSearch } from './photonSearch';
import { pickOnlineSearch, type OnlineSearchFn } from './onlineSearchPick';

export type { OnlineSearchFn };

export const onlineSearch: OnlineSearchFn = pickOnlineSearch(Platform.OS, {
  apple: appleSearch,
  photon: photonSearch,
});
