import { useEffect, useRef } from 'react';
import { AppState, Linking } from 'react-native';
import { useRouter } from 'expo-router';

import SharedIntake from '../../modules/shared-intake';
import { parseSharedLocation, type SharedLocation } from '@/services/sharedLocation';
// Shared with the Android share sheet, so both paths resolve a shared place identically.
import { sharedLocationDeps as deps } from '@/services/sharedLocationDeps';
import { sharedLocationStore } from '@/state/sharedLocationStore';

interface Intent {
  location?: { lat: number; lng: number; name?: string; address?: string; source: SharedLocation['source'] };
  raw: string;
}

// Drains the App Group intents the Share popup queued, resolves the location (native-first, JS fallback), and
// publishes {location} to the Location screen. Runs on cold launch, every foreground, and url events.
export function useSharedLocationIntake(): void {
  const busy = useRef(false);
  const router = useRouter();

  useEffect(() => {
    const process = async () => {
      if (busy.current) return;
      busy.current = true;
      try {
        // Drain: a new share can be written WHILE we're processing the previous one, firing no fresh trigger —
        // so consume again until empty. This is what makes rapid successive shares reliable.
        // The legacy single-slot store is an iOS Share Extension concept; there is
        // nothing to drain where the native module is absent.
        const legacy = SharedIntake;
        while (legacy) {
          const json = await legacy.consumeSharedIntent();
          if (!json) break;
          let intent: Intent;
          try {
            intent = JSON.parse(json) as Intent;
          } catch {
            continue;
          }

          let loc: SharedLocation | null = null;
          if (intent.location) {
            const { lat, lng, name, address, source } = intent.location;
            loc = { coordinate: { latitude: lat, longitude: lng }, name, address, source };
          } else if (intent.raw) {
            loc = await parseSharedLocation(intent.raw, deps); // degraded fallback
          }
          if (loc) {
            sharedLocationStore.set({ location: loc });
            router.navigate('/location');
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
