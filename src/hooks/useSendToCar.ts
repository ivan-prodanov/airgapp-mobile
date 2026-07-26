import { useCallback } from 'react';

import { useToast } from '@/components/ToastHost';
import { commandActionLabel, commandFailureText } from '@/ble/commandMessages';
import { useCarLinkStatus, useFleet } from '@/state/VehicleProvider';
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
  // THE SAME liveness rule the dispatch itself uses — `carLinkStatus.linked` IS
  // useFleetState's `activeIsLive` ("the car in front of me is the enrolled,
  // linked one"), narrowed there once so no consumer has to restate it.
  const { linked } = useCarLinkStatus();
  const toast = useToast();
  return useCallback(
    (target: SendTarget) => {
      const title = destinationTitle(target);
      // fleet.sendNavigation is a NO-OP for a demo (non-live) car — it returns
      // before dispatching, so nothing ever fails and nothing ever succeeds.
      // Combined with silent-on-success that made a send to a demo car
      // indistinguishable from a real one: a haptic and then nothing, forever.
      // Silence is only honest once the command is actually in flight; a send
      // that never left the app has to say so. No haptic here — the tactile
      // "done" belongs to the path that really sent something.
      if (!linked) {
        toast.show(commandFailureText(commandActionLabel('navigateTo'), {
          ok: false,
          kind: 'unreachable',
          message: `[navigateTo] not sent: no live car (${title})`,
        }));
        return;
      }
      controlHaptic();
      fleet.sendNavigation(target.coordinate.latitude, target.coordinate.longitude, title);
    },
    [fleet, linked, toast],
  );
}
