import { useEffect, useRef } from 'react';

import SharedIntake from '../../modules/shared-intake';
import { onPassiveEntryConnectionState, passiveEntryConnectionState } from '../../modules/expo-passive-entry';
import { logi } from '@/services/logbus';

// Publishes "does this phone hold a live BLE link to the car" into the App Group,
// so the Share Extension can pick a transport.
//
// The extension is a separate process and cannot see the link, so it has to be
// told. The link state is the right thing to tell it: a link that is UP is proof
// of proximity, and it is also exactly the condition that makes grabbing the BLE
// radio for a share a bad idea — the app is already using it for passive entry.
//
// Written on CHANGE only. The value carries its own timestamp and the reader
// treats anything older than fifteen minutes as unknown, so there is no need to
// rewrite an unchanged value at 1 Hz — see CarPresence.swift for the staleness
// rule and, more importantly, for why unknown means "in range" rather than "out
// of range".

export function useCarPresencePublish(): void {
  const last = useRef<boolean | null>(null);

  useEffect(() => {
    const publish = (state: string | undefined) => {
      const linkUp = state === 'connected';
      if (last.current === linkUp) return;
      last.current = linkUp;
      logi('presence', 'published', { linkUp });
      // Never throw into the app: this is advisory, and the reader already
      // handles a missing value correctly.
      void SharedIntake?.writeCarPresence(linkUp).catch(() => {});
    };

    // Publish once at mount so a fresh launch does not leave a stale value
    // sitting in the container. Both helpers already no-op when the native
    // module is absent (an old binary under a JS-only deploy), returning
    // 'absent' — which is not 'connected', so we correctly publish linkUp=false.
    publish(passiveEntryConnectionState().state);

    // Returns a plain unsubscribe function, not an EventSubscription.
    return onPassiveEntryConnectionState((e) => publish(e.state));
  }, []);
}
