import { useCallback } from 'react';

import { useFleet } from '@/state/VehicleProvider';
import { controlHaptic } from '@/state/controlHaptic';
import { destinationTitle, type TitleInput } from '@/services/destinationTitle';

export type SendTarget = TitleInput;

// One place a destination leaves the app for the car. Every screen that can show
// a place routes through this, so the title rules and the haptic are identical
// everywhere.
//
// Fire-and-forget by design: no wake (verified on-car — sends land on a sleeping
// car) and no route-state check (the active-route fields are unreadable while the
// car is locked, which is whenever you would use this).
//
// DELIBERATELY SILENT ON SUCCESS. The haptic is the immediate feedback; there is
// no "Sent X to the car" toast. Task 2 made navigation fail on the car's OWN
// actionStatus rather than on the transport ACK, so a rejection now surfaces
// through the shared failure toast with the car's reason — and a success toast
// fired at tap time would be claiming an outcome we do not yet know, then being
// contradicted a moment later. Silence on success, the truth on failure.
export function useSendToCar(): (target: SendTarget) => void {
  const fleet = useFleet();
  return useCallback(
    (target: SendTarget) => {
      const title = destinationTitle(target);
      controlHaptic();
      fleet.sendNavigation(target.coordinate.latitude, target.coordinate.longitude, title);
    },
    [fleet],
  );
}
