import { useEffect, useRef } from 'react';
import { Alert, AppState, Linking } from 'react-native';
import { useRouter } from 'expo-router';
import * as Location from 'expo-location';

import SharedIntake from '../../modules/shared-intake';
import AppleSearch, { type AppleResult } from '../../modules/expo-apple-search';
import { parseSharedLocation, type ParseDeps } from '@/services/sharedLocation';
import { sharedLocationStore } from '@/state/sharedLocationStore';
import type { LatLng } from '@/state/mockLocation';

// Cap an awaited promise so a hung network call resolves to `fallback` instead of wedging intake (which would
// leave the busy-guard stuck true and silently drop later shares).
function withTimeout<T>(p: Promise<T>, ms: number, fallback: T): Promise<T> {
  return Promise.race([p, new Promise<T>((resolve) => setTimeout(() => resolve(fallback), ms))]);
}

// Real dependencies for the parser: resolve short links over the network, and resolve name-only shares with
// Apple Maps search (MKLocalSearch — far more reliable than CLGeocoder for named places).
const deps: ParseDeps = {
  resolveUrl: async (url) => {
    try {
      // The CONSENT/SOCS cookies skip Google's EU consent interstitial so a goo.gl link resolves straight to
      // the real maps page. Harmless to other hosts.
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
    // Bias the search toward the user (or a sensible default). Region MUST be all-numeric — the native side
    // casts it to [String: Double], so title/subtitle strings would make the cast throw.
    let center = { latitude: 42.7, longitude: 23.32 };
    try {
      const last = await Location.getLastKnownPositionAsync();
      if (last) center = { latitude: last.coords.latitude, longitude: last.coords.longitude };
    } catch {
      /* keep default bias */
    }
    const region = { latitude: center.latitude, longitude: center.longitude, latitudeDelta: 30, longitudeDelta: 30 };
    const trySearch = async (q: string): Promise<LatLng | null> => {
      try {
        const results = await withTimeout(AppleSearch.search(q, region), 8000, [] as AppleResult[]);
        const hit = results[0];
        return hit ? { latitude: hit.latitude, longitude: hit.longitude } : null;
      } catch {
        return null;
      }
    };
    // Full string, then just the leading place name (MKLocalSearch handles that better than a long blob).
    const full = address.trim();
    const short = full.split(',')[0].trim();
    return (await trySearch(full)) ?? (short && short !== full ? await trySearch(short) : null);
  },
};

// Consumes a location shared into the app (via the Share Extension → App Group), parses it, and routes to the
// Location screen. Runs on cold launch, every foreground, and the airgapp://shared wake event.
export function useSharedLocationIntake(): void {
  const router = useRouter();
  const busy = useRef(false);

  useEffect(() => {
    const process = async () => {
      if (busy.current) return;
      busy.current = true;
      try {
        // Drain: a new share can be written WHILE we're parsing the previous one, firing no fresh trigger —
        // so consume again until empty. This is what makes rapid successive shares reliable.
        for (;;) {
          const raw = await SharedIntake.consumePendingShare();
          if (!raw) break;
          const loc = await parseSharedLocation(raw, deps);
          if (loc) {
            sharedLocationStore.set(loc);
            router.navigate('/location');
          } else {
            Alert.alert('airgapp', "Couldn't read a location from that share.");
          }
        }
      } finally {
        busy.current = false;
      }
    };

    void process();
    const sub = AppState.addEventListener('change', (s) => {
      if (s === 'active') void process();
    });
    const linkSub = Linking.addEventListener('url', () => void process());
    return () => {
      sub.remove();
      linkSub.remove();
    };
  }, [router]);
}
