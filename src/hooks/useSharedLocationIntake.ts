import { useEffect, useRef } from 'react';
import { Alert, AppState, Linking } from 'react-native';
import { useRouter } from 'expo-router';
import * as Location from 'expo-location';

import SharedIntake from '../../modules/shared-intake';
import AppleSearch, { type AppleResult } from '../../modules/expo-apple-search';
import { parseSharedLocation, type ParseDeps } from '@/services/sharedLocation';
import { sharedLocationStore } from '@/state/sharedLocationStore';
import type { LatLng } from '@/state/mockLocation';

// Cap any awaited promise so a hung network call resolves to `fallback` instead of wedging intake (which
// would leave the busy-guard stuck true and silently drop every later share).
function withTimeout<T>(p: Promise<T>, ms: number, fallback: T): Promise<T> {
  return Promise.race([p, new Promise<T>((resolve) => setTimeout(() => resolve(fallback), ms))]);
}

// Real dependencies for the parser: resolve short links over the network, geocode address-only shares.
const deps: ParseDeps = {
  resolveUrl: async (url) => {
    try {
      // The CONSENT/SOCS cookies skip Google's EU consent interstitial so a goo.gl link resolves straight to
      // the real maps page (which usually carries coordinates), not consent.google.com. Harmless to other hosts.
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
    // Google shares carry only a place NAME (Google resolves coords client-side in JS, so a server fetch never
    // sees them). Resolve the name with MKLocalSearch — the real Apple Maps search — which is far more reliable
    // than CLGeocoder (expo-location.geocodeAsync), which rate-limits and misses many named places.
    let center = { latitude: 42.7, longitude: 23.32 }; // default bias
    try {
      const last = await Location.getLastKnownPositionAsync();
      if (last) center = { latitude: last.coords.latitude, longitude: last.coords.longitude };
    } catch {
      /* keep default bias */
    }
    // NOTE: only numeric fields — the native side casts the region to [String: Double]; passing title/subtitle
    // strings makes that cast throw (which silently killed every search).
    const region = { latitude: center.latitude, longitude: center.longitude, latitudeDelta: 30, longitudeDelta: 30 };
    const trySearch = async (q: string): Promise<LatLng | null> => {
      try {
        const results = await withTimeout(AppleSearch.search(q, region), 8000, [] as AppleResult[]);
        void SharedIntake.appendLog(`[APP] search "${q}" => ${results.length}${results[0] ? ` first=${results[0].latitude},${results[0].longitude}` : ''}`);
        const hit = results[0];
        return hit ? { latitude: hit.latitude, longitude: hit.longitude } : null;
      } catch (e) {
        void SharedIntake.appendLog(`[APP] search "${q}" THREW ${String(e)}`);
        return null;
      }
    };
    // Try the full string, then just the leading place name (before the first comma), which MKLocalSearch
    // handles better than a long "name, postal, region" blob.
    const full = address.trim();
    const short = full.split(',')[0].trim();
    return (await trySearch(full)) ?? (short && short !== full ? await trySearch(short) : null);
  },
};

export function useSharedLocationIntake(): void {
  const router = useRouter();
  const busy = useRef(false);

  useEffect(() => {
    const process = async (trigger: string) => {
      if (busy.current) {
        void SharedIntake.appendLog(`[APP ${Date.now() / 1000}] ${trigger} SKIPPED (busy)`);
        void SharedIntake.dumpLog();
        return;
      }
      busy.current = true;
      try {
        void SharedIntake.appendLog(`[APP ${Date.now() / 1000}] ${trigger} start`);
        // Drain: a new share can be written (by the extension) WHILE we're parsing the previous one — and
        // that write fires no fresh foreground trigger. So after each share, consume again until empty.
        for (;;) {
          const raw = await SharedIntake.consumePendingShare();
          await SharedIntake.appendLog(`[APP] consume => ${raw ? 'RAW:' + raw : 'NULL'}`);
          if (!raw) break;
          let loc = null;
          try {
            loc = await parseSharedLocation(raw, deps);
          } catch (e) {
            await SharedIntake.appendLog(`[APP] parse THREW ${String(e)}`);
          }
          await SharedIntake.appendLog(`[APP] parse => ${loc ? `${loc.coordinate.latitude},${loc.coordinate.longitude}` : 'null'}`);
          if (loc) {
            sharedLocationStore.set(loc);
            router.navigate('/location');
          } else {
            let diag = `raw:\n${raw}`;
            const url = raw.match(/https?:\/\/[^\s]+/)?.[0];
            if (url) {
              const r = await deps.resolveUrl(url);
              diag += `\n\nfinalUrl:\n${r?.finalUrl ?? 'null'}`;
              await SharedIntake.appendLog(`[APP] could-not-read finalUrl=${r?.finalUrl ?? 'null'}`);
            }
            Alert.alert('airgapp — could not read', diag);
          }
        }
      } finally {
        busy.current = false;
        void SharedIntake.dumpLog();
      }
    };

    // Cold launch (app opened by the share) + every foreground + the airgapp://shared wake event.
    void process('cold');
    const sub = AppState.addEventListener('change', (s) => {
      if (s === 'active') void process('appstate-active');
    });
    const linkSub = Linking.addEventListener('url', () => void process('link'));
    return () => {
      sub.remove();
      linkSub.remove();
    };
  }, [router]);
}
