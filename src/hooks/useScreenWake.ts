import { useEffect } from 'react';

import { useCarLinkStatus } from '@/state/VehicleProvider';

// Pre-warm the car's main computer when a command screen (Charging / Security / Climate / Controls) is entered,
// so an Infotainment toggle doesn't stall waiting for it to wake. This mirrors the Tesla app's
// SCREEN_REQUIRES_WAKE: it wakes on navigating INTO a live-vehicle feature screen, and NOT on app open / Home /
// Status (verified in the decompiled app). The underlying carLink.wake() is silent, throttled, and a no-op when
// the car is already awake or demo/unlinked — so calling this on mount is cheap and safe.
export function useScreenWake(): void {
  const { wake } = useCarLinkStatus();
  useEffect(() => {
    wake();
  }, [wake]);
}
