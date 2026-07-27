// outboxDrain — decide what to do with the outbox on each pass.
//
// Pure: takes the parsed queue and a clock, returns the work. The caller owns the
// App Group I/O and the actual sending, which is what keeps this node-testable —
// the interesting logic here is the ORDER and the STATE TRANSITIONS, and those
// are exactly what a cross-process queue gets wrong when nobody tests them.
//
// The invariant it enforces, from shareOutbox.ts:
//
//   APPEND BEFORE ATTEMPTING. REMOVE ONLY ON A CAR-CONFIRMED ACCEPT.
//
// So a drain pass never removes anything. It reports what to send and what to
// show; removal happens later, only after the car has confirmed, via
// forgetDelivered.

import {
  forgetDelivered,
  isStale,
  nextToSend,
  type OutboxItem,
} from './shareOutbox';

export interface DrainPlan {
  // Items to attempt now, oldest first. Sending is the caller's job.
  toSend: OutboxItem[];
  // Items the user should be told about: the car refused these, with its reason.
  // Surfaced rather than dropped — a share that silently vanished is the failure
  // the whole queue exists to prevent.
  toSurface: OutboxItem[];
  // Items past their useful life. Reported separately from `toSend` so a caller
  // can say "this expired" instead of silently doing nothing.
  expired: OutboxItem[];
  // The queue with delivered and expired entries removed, ready to persist.
  cleaned: OutboxItem[];
}

export function planDrain(items: readonly OutboxItem[], now: number): DrainPlan {
  return {
    toSend: nextToSend(items, now),
    toSurface: items.filter((i) => i.status === 'rejected'),
    expired: items.filter((i) => i.status === 'pending' && isStale(i, now)),
    cleaned: forgetDelivered(items, now),
  };
}

// classifySendResult turns one send attempt into the transition it implies.
//
// The distinction that matters, and the one this project got wrong until the
// actionStatus work: a TRANSPORT ACK is not an acceptance. The car acknowledging
// a frame says it arrived, not that it took the destination. Only the car's own
// verdict may mark an item sent.
export type SendResult =
  // The car confirmed it (Response.actionStatus said OK).
  | { kind: 'accepted' }
  // The car refused it on its merits, with its own words. Terminal.
  | { kind: 'refused'; reason: string }
  // Anything else: unreachable, timed out, no session, no car linked. Retryable —
  // these are the conditions that clear on their own when you next reach the car.
  | { kind: 'failed'; error: string }
  // The send appeared to succeed but the car returned no verdict at all. NOT an
  // acceptance: without FLAG_ENCRYPT_RESPONSE_BIT the car answers status-only and
  // an accepted send is byte-identical to a refused one. Treated as retryable, so
  // the worst case is a duplicate rather than a silently dropped place.
  | { kind: 'unverified' };

export function transitionFor(result: SendResult): 'sent' | 'rejected' | 'retry' {
  switch (result.kind) {
    case 'accepted':
      return 'sent';
    case 'refused':
      return 'rejected';
    case 'failed':
    case 'unverified':
      return 'retry';
  }
}
