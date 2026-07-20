// bondWedgeStore.ts — process-wide home for the bond-wedge verdict.
//
// WHY A SINGLETON, not a field on the transport. The wedge is a property of the
// PHONE'S OS BOND TABLE, not of any one transport instance: it outlives every
// connect attempt, every selector rebuild, and the transport teardown we do on
// background. Keeping the detector inside DirectBleTransport meant a rebuilt
// transport started a fresh detector — the 2026-07-20 logs show `consecutive`
// restarting at 1 on each rebuild, so the run-of-4 heuristic could never trip
// even though the car had been refusing us for minutes.
//
// Deliberately NOT React state: the producer (the BLE transport) has no hook
// context. Consumers subscribe via useSyncExternalStore in useCarLink.

import { createBondWedgeDetector, type BondWedgeState } from './bondWedge';

const detector = createBondWedgeDetector();

let snapshot: BondWedgeState = detector.state();
const listeners = new Set<() => void>();

function publish(next: BondWedgeState): void {
  // Only churn identity when something consumers can SEE changed. The failure
  // counter ticks on every attempt; re-rendering Home for that would be noise.
  if (snapshot.wedged === next.wedged && snapshot.kind === next.kind) return;
  snapshot = next;
  listeners.forEach((l) => l());
}

export const bondWedgeStore = {
  noteConnectFailure(err: unknown): BondWedgeState {
    const next = detector.noteConnectFailure(err);
    publish(next);
    return next;
  },
  noteConnectSuccess(): void {
    detector.noteConnectSuccess();
    publish(detector.state());
  },
  subscribe(listener: () => void): () => void {
    listeners.add(listener);
    return () => listeners.delete(listener);
  },
  // Must return a STABLE reference while nothing changed — useSyncExternalStore
  // re-renders in a loop otherwise.
  getSnapshot(): BondWedgeState {
    return snapshot;
  },
};
