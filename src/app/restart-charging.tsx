import { useEffect, useRef } from 'react';
import { useRouter } from 'expo-router';

import { useCarLinkStatus } from '@/state/VehicleProvider';

// airgapp://restart-charging — a deep link that runs Restart Charging and lands on the
// Charging screen, where the card shows the progress.
//
// Two reasons it exists: (1) it is how the restart is exercised from a Mac with the phone
// on USB (`devicectl device process launch --payload-url airgapp://restart-charging`) so
// the on-car checks leave a log-ring trace without anyone tapping the phone; (2) it is a
// Shortcuts/Siri target for free — "restart charging" from the couch without opening the
// app first. restartCharging() itself refuses to overlap a running restart and no-ops on
// a demo/unlinked car, so a repeated link is harmless.
export default function RestartChargingLink() {
  const router = useRouter();
  const { restartCharging } = useCarLinkStatus();
  const fired = useRef(false);
  useEffect(() => {
    if (fired.current) return;
    fired.current = true;
    restartCharging();
    router.replace('/charging');
  }, [restartCharging, router]);
  return null;
}
