import type { SharedLocation } from '@/services/sharedLocation';

// Module-level hand-off from the intake hook to the Location screen. `set` publishes a pending shared
// location and notifies subscribers; the screen `consume`s it exactly once (get + clear).
let pending: SharedLocation | null = null;
const subs = new Set<() => void>();

export const sharedLocationStore = {
  set(loc: SharedLocation): void {
    pending = loc;
    subs.forEach((f) => f());
  },
  consume(): SharedLocation | null {
    const p = pending;
    pending = null;
    return p;
  },
  subscribe(cb: () => void): () => void {
    subs.add(cb);
    return () => {
      subs.delete(cb);
    };
  },
};
