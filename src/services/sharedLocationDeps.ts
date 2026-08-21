// The dependencies parseSharedLocation needs to turn shared text into a place: follow a link, and
// geocode an address when the link itself carries no coordinates.
//
// Extracted from useSharedLocationIntake so the Android share sheet (src/share/ShareSheet.tsx) and
// the in-app intake drain resolve a shared place THE SAME WAY. Two copies of this would diverge on
// exactly the case that is hardest to notice — a link shape one path handles and the other does
// not — and the symptom would be "sharing works from the app but not from the share sheet".
//
// The geocoder is `onlineSearch`, which already picks Apple MKLocalSearch on iOS and Photon
// everywhere else. The version this replaced called the Apple module directly and returned null
// whenever it was absent, so on Android address-only shares could not be geocoded AT ALL — a share
// that carried a name but no coordinates simply failed.
import * as Location from 'expo-location';

import { onlineSearch } from './onlineSearch';
import type { ParseDeps } from './sharedLocation';
import type { LatLng } from '@/state/mockLocation';

/**
 * Cap an awaited promise so a hung network call resolves to `fallback` instead of wedging the
 * caller — for the intake drain that would leave its busy-guard stuck true and silently drop every
 * later share; for the share sheet it would be a spinner that never ends.
 */
export function withTimeout<T>(p: Promise<T>, ms: number, fallback: T): Promise<T> {
  return Promise.race([p, new Promise<T>((resolve) => setTimeout(() => resolve(fallback), ms))]);
}

/** Fallback map bias when the device has no last-known position. Sofia. */
const DEFAULT_CENTER = { latitude: 42.7, longitude: 23.32 };

export const sharedLocationDeps: ParseDeps = {
  resolveUrl: async (url) => {
    try {
      // The CONSENT/SOCS cookies skip Google's EU consent interstitial so a goo.gl link resolves
      // straight to the real maps page. Harmless to other hosts.
      const fetchPromise = fetch(url, {
        redirect: 'follow',
        headers: {
          'User-Agent': 'Mozilla/5.0 (iPhone; CPU iPhone OS 17_0 like Mac OS X)',
          Cookie: 'CONSENT=YES+cb; SOCS=CAISNQgDEitib3E',
        },
      }).then(async (res) => ({ finalUrl: res.url, body: await res.text() }));
      return await withTimeout(fetchPromise, 8000, null);
    } catch {
      return null;
    }
  },

  geocode: async (address) => {
    // Bias the search toward the user (or a sensible default). Region MUST be all-numeric — the
    // Apple module casts it to [String: Double], so title/subtitle strings would make the cast throw.
    let center = DEFAULT_CENTER;
    try {
      const last = await Location.getLastKnownPositionAsync();
      if (last) center = { latitude: last.coords.latitude, longitude: last.coords.longitude };
    } catch {
      /* keep default bias */
    }
    const region = {
      latitude: center.latitude,
      longitude: center.longitude,
      latitudeDelta: 30,
      longitudeDelta: 30,
    };
    const trySearch = async (q: string): Promise<LatLng | null> => {
      try {
        // Both implementations REJECT on failure; the caller treats null as "could not geocode".
        const results = await withTimeout(onlineSearch(q, region), 8000, []);
        const hit = results.find((r) => r.coordinate);
        return hit?.coordinate ?? null;
      } catch {
        return null;
      }
    };
    // Full string, then just the leading place name — both geocoders handle a short place name
    // better than a long comma-separated blob.
    const full = address.trim();
    const short = full.split(',')[0].trim();
    return (await trySearch(full)) ?? (short && short !== full ? await trySearch(short) : null);
  },
};
