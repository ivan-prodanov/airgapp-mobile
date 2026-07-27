import { useCallback, useEffect, useRef } from 'react';
import { AppState } from 'react-native';

import SharedIntake from '../../modules/shared-intake';
import { useCarLinkStatus } from '@/state/VehicleProvider';
import { destinationTitle } from '@/services/destinationTitle';
import { logi, logw } from '@/services/logbus';
import {
  markRejected,
  markSent,
  parseOutbox,
  recordFailure,
  serializeOutbox,
  type OutboxItem,
} from '@/state/shareOutbox';
import { planDrain, transitionFor, type SendResult } from '@/state/outboxDrain';

// useOutboxDrain — sends the places the Share Extension queued, and removes them
// only once the car has confirmed.
//
// Replaces the old consumeSharedIntent path, whose two failures were structural:
// it read a single App Group slot each share overwrote, and it CLEARED that slot
// before anything was sent. A second share destroyed the first; any send failure
// destroyed the place.
//
// Runs on mount and on every foreground. It is deliberately NOT tied to any
// screen — a queued destination should go to the car because the app is running,
// not because the user happened to open the map.

// One drain at a time. A share arriving mid-drain is picked up by the next pass
// rather than racing this one — the file is the source of truth and two
// concurrent read-modify-writes would lose an item, which is the bug this
// replaces.
export function useOutboxDrain(): void {
  const carLink = useCarLinkStatus();
  const busy = useRef(false);
  const sendWithOutcome = carLink.sendWithOutcome;
  const linked = carLink.linked;

  const drain = useCallback(async () => {
    if (busy.current) return;
    busy.current = true;
    try {
      const raw = await SharedIntake.readOutbox();
      let items = parseOutbox(raw);
      if (items.length === 0) return;

      const plan = planDrain(items, Date.now());
      for (const expired of plan.expired) {
        // Reported, not silently skipped: a place that aged out should be
        // visible as expired rather than appearing to have been delivered.
        logw('outbox', 'expired', { id: expired.id, ageMs: Date.now() - expired.ts });
      }
      if (plan.toSend.length === 0) {
        // Still persist the cleaning pass — delivered and expired entries go.
        const cleaned = serializeOutbox(plan.cleaned);
        if (cleaned !== raw) await SharedIntake.writeOutbox(cleaned);
        return;
      }

      // No live car: leave everything pending and try again next foreground.
      // This is NOT a refusal and must never mark anything.
      if (!linked) {
        logi('outbox', 'deferred — no linked car', { pending: plan.toSend.length });
        return;
      }

      for (const item of plan.toSend) {
        const label = destinationTitle({
          name: item.location.name,
          address: item.location.address,
          coordinate: { latitude: item.location.lat, longitude: item.location.lng },
        });
        const outcome = await sendWithOutcome({
          type: 'navigateTo',
          lat: item.location.lat,
          lon: item.location.lng,
          label,
        });

        const result: SendResult =
          outcome === null
            ? { kind: 'failed', error: 'no live car' }
            : outcome.ok
              ? // ok:true with a carStatus we could not read is NOT an acceptance —
                // see outboxDrain's note. Retry rather than claim delivery.
                outcome.carStatus?.ok === true
                ? { kind: 'accepted' }
                : outcome.carStatus?.ok === false
                  ? { kind: 'refused', reason: outcome.carStatus.reason ?? 'the car refused it' }
                  : { kind: 'unverified' }
              : outcome.kind === 'fault'
                ? { kind: 'refused', reason: outcome.message }
                : { kind: 'failed', error: outcome.message };

        switch (transitionFor(result)) {
          case 'sent':
            items = markSent(items, item.id);
            logi('outbox', 'sent', { id: item.id, label });
            break;
          case 'rejected':
            items = markRejected(items, item.id, result.kind === 'refused' ? result.reason : 'refused');
            logw('outbox', 'refused by the car', { id: item.id, label });
            break;
          case 'retry':
            items = recordFailure(
              items,
              item.id,
              result.kind === 'failed' ? result.error : 'the car returned no verdict',
            );
            logw('outbox', 'not confirmed — staying queued', { id: item.id, label });
            break;
        }
      }

      // Persist once, after the whole pass. Writing per item would multiply the
      // window in which another process's append can be lost.
      await SharedIntake.writeOutbox(serializeOutbox(planDrain(items, Date.now()).cleaned));
    } catch (err) {
      // Never throw into the app. An unreadable outbox is a deferred send, not a
      // crash — and the file is still there for the next pass.
      logw('outbox', 'drain failed', { err: err instanceof Error ? err.message : String(err) });
    } finally {
      busy.current = false;
    }
  }, [linked, sendWithOutcome]);

  useEffect(() => {
    void drain();
    const sub = AppState.addEventListener('change', (s) => {
      if (s === 'active') void drain();
    });
    return () => sub.remove();
  }, [drain]);
}
