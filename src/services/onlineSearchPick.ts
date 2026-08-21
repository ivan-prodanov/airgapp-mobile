// Pure half of the online-geocoder choice. No react-native / expo imports, so it stays
// node-testable — the same isolation rule src/ble follows.
import type { Place, SearchRegion } from './place';

export type OnlineSearchFn = (q: string, region: SearchRegion) => Promise<Place[]>;

/**
 * iOS uses Apple MKLocalSearch; every other platform uses Photon.
 *
 * The default matters: Apple is iOS-only, and falling back to "no online search" instead of
 * Photon would silently narrow Navigate to the bundled gazetteer — results would just be
 * thinner, with nothing to indicate why.
 */
export function pickOnlineSearch(
  os: string,
  impls: { apple: OnlineSearchFn; photon: OnlineSearchFn },
): OnlineSearchFn {
  return os === 'ios' ? impls.apple : impls.photon;
}
