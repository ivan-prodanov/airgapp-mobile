// bondWedgeStore.ts — process-wide, RESTART-SURVIVING home for the wedge verdict.
//
// WHY A SINGLETON, not a field on the transport. The wedge is a property of the
// PHONE'S OS BOND TABLE, not of any one transport instance: it outlives every
// connect attempt, every selector rebuild, and the transport teardown we do on
// background. Keeping the detector inside DirectBleTransport meant a rebuilt
// transport started a fresh detector — the 2026-07-20 logs show `consecutive`
// restarting at 1 on each rebuild, so the run-of-4 heuristic could never trip.
//
// WHY IT ALSO PERSISTS (2026-07-20 on-car test). Detection fired correctly
// (iosErrorCode 14 → wedged at consecutive=4), but the state was memory-only:
// relaunching the app presented the car as perfectly healthy while the bond was
// still broken, and the user had to re-trigger a BLE failure to see the card
// again. The OS bond table survives our process, so the verdict must too.
//
// CLEARING IS DELIBERATELY NARROW: only a SUCCESSFUL BLE CONNECT clears it. Not
// a Pi success (the Pi cannot observe the bond at all), not a relaunch, not the
// car being out of range. Anything looser re-hides a problem that is still there.
//
// Persistence is INJECTED rather than imported so this file pulls in no React
// Native modules and stays node-testable, same isolation rule as session.ts.

import { createBondWedgeDetector, type BondWedgeState, type BleFailureKind } from './bondWedge';

export const BOND_WEDGE_STORAGE_KEY = 'ble.bondWedge.v1';

export interface PersistedWedge {
  wedged: boolean;
  kind: BleFailureKind;
  // When it was recorded, for diagnostics only — never used to expire the
  // verdict. A wedge does not heal with time; it heals when the user forgets
  // the device, and the successful connect that follows is what clears it.
  at: number;
  // The car's BLUETOOTH (GAP) name as iOS reports it once connected — e.g.
  // "🔑 CHUŠKOPEK". Remembered across launches BECAUSE we can only learn it while
  // the link works, and we only need it once the link is broken. Without this
  // the recovery copy falls back to the vehicle's display name ("Red Velvet"),
  // which is NOT what Settings > Bluetooth lists, sending the user hunting for
  // an entry that does not exist.
  bleName?: string | null;
}

// What consumers render from: the verdict plus the remembered Bluetooth name.
export interface BondWedgeSnapshot extends BondWedgeState {
  bleName: string | null;
}

const detector = createBondWedgeDetector();

let bleName: string | null = null;
let snapshot: BondWedgeSnapshot = { ...detector.state(), bleName: null };
const listeners = new Set<() => void>();
let persist: ((p: PersistedWedge) => void) | null = null;
let log: ((msg: string, data: Record<string, unknown>) => void) | null = null;

function publish(state: BondWedgeState, cause: string): void {
  const next: BondWedgeSnapshot = { ...state, bleName };
  // Only churn identity when something consumers can SEE changed. The failure
  // counter ticks on every attempt; re-rendering Home for that would be noise.
  if (
    snapshot.wedged === next.wedged &&
    snapshot.kind === next.kind &&
    snapshot.bleName === next.bleName
  ) {
    return;
  }
  const was = snapshot;
  snapshot = next;
  // Every VISIBLE transition is logged with its cause. The on-car test left us
  // unable to prove why the card vanished mid-session; this makes the next
  // occurrence unambiguous instead of a reconstruction.
  log?.('bond-wedge verdict changed', {
    cause,
    from: { wedged: was.wedged, kind: was.kind },
    to: { wedged: next.wedged, kind: next.kind },
    consecutive: next.consecutiveConnectFailures,
  });
  persist?.({ wedged: next.wedged, kind: next.kind, at: Date.now(), bleName });
  listeners.forEach((l) => l());
}

export const bondWedgeStore = {
  // Wire up side effects once, at app start. Kept out of module scope so the
  // store itself imports nothing platform-specific.
  configure(opts: {
    persist?: (p: PersistedWedge) => void;
    log?: (msg: string, data: Record<string, unknown>) => void;
  }): void {
    persist = opts.persist ?? null;
    log = opts.log ?? null;
  },

  // Seed from the previous process. The NAME is restored even when the stored
  // verdict was healthy — it is only learnable while the link works, and only
  // needed once it doesn't, so it must outlive the healthy→wedged transition.
  hydrate(p: PersistedWedge | null): void {
    if (!p) return;
    if (p.bleName) bleName = p.bleName;
    if (!p.wedged) return;
    detector.markWedged(p.kind);
    publish(detector.state(), 'hydrated-from-storage');
  },

  // Record the car's Bluetooth name, learned from a LIVE connection. Only a
  // connected peripheral reports the GAP name; the scan advertises Tesla's
  // derived S…C local name instead, which is not what Settings > Bluetooth
  // shows. Callers should pass the connected device's name, not the scan's.
  noteDeviceName(name: string | null): void {
    if (!name || name === bleName) return;
    bleName = name;
    publish(detector.state(), 'device-name');
  },

  noteConnectFailure(err: unknown): BondWedgeState {
    const next = detector.noteConnectFailure(err);
    publish(next, 'connect-failure');
    return next;
  },
  noteConnectSuccess(): void {
    detector.noteConnectSuccess();
    publish(detector.state(), 'connect-success');
  },
  subscribe(listener: () => void): () => void {
    listeners.add(listener);
    return () => listeners.delete(listener);
  },
  // Must return a STABLE reference while nothing changed — useSyncExternalStore
  // re-renders in a loop otherwise.
  getSnapshot(): BondWedgeSnapshot {
    return snapshot;
  },
};

// parsePersistedWedge — tolerant decode of whatever is in storage. A malformed
// or older-schema blob must degrade to "no opinion", never throw at launch.
export function parsePersistedWedge(raw: string | null): PersistedWedge | null {
  if (!raw) return null;
  try {
    const v = JSON.parse(raw) as Partial<PersistedWedge>;
    if (typeof v?.wedged !== 'boolean') return null;
    return {
      wedged: v.wedged,
      kind: (v.kind ?? 'other') as BleFailureKind,
      at: typeof v.at === 'number' ? v.at : 0,
      bleName: typeof v.bleName === 'string' ? v.bleName : null,
    };
  } catch {
    return null;
  }
}
