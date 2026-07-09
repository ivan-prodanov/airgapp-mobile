import { useEffect, useRef } from 'react';
import { Alert, AppState, Linking } from 'react-native';
import { useRouter } from 'expo-router';
import * as Location from 'expo-location';

import SharedIntake from '../../modules/shared-intake';
import { parseSharedLocation, type ParseDeps } from '@/services/sharedLocation';
import { sharedLocationStore } from '@/state/sharedLocationStore';

// Real dependencies for the parser: resolve short links over the network, geocode address-only shares.
const deps: ParseDeps = {
  resolveUrl: async (url) => {
    try {
      const res = await fetch(url, {
        redirect: 'follow',
        headers: { 'User-Agent': 'Mozilla/5.0 (iPhone; CPU iPhone OS 17_0 like Mac OS X)' },
      });
      return { finalUrl: res.url, body: await res.text() };
    } catch {
      return null;
    }
  },
  geocode: async (address) => {
    try {
      const [hit] = await Location.geocodeAsync(address);
      return hit ? { latitude: hit.latitude, longitude: hit.longitude } : null;
    } catch {
      return null;
    }
  },
};

export function useSharedLocationIntake(): void {
  const router = useRouter();
  const busy = useRef(false);

  useEffect(() => {
    const process = async () => {
      if (busy.current) return;
      busy.current = true;
      try {
        const raw = await SharedIntake.consumePendingShare();
        if (!raw) return;
        const loc = await parseSharedLocation(raw, deps);
        if (loc) {
          sharedLocationStore.set(loc);
          router.navigate('/location');
        } else {
          Alert.alert('airgapp', "Couldn't read a location from that share.");
        }
      } finally {
        busy.current = false;
      }
    };

    // Cold launch (app opened by the share) + every foreground + the airgapp://shared wake event.
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
