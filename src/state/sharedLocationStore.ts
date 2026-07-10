import type { SharedLocation } from '@/services/sharedLocation';

export type SharedAction = 'navigate' | 'addToTrip';
// The saved trip in the (possibly reordered) order the user arranged in the Share popup.
export interface ReorderedStop { id: string; title: string; subtitle?: string; lat: number; lng: number; kind: string }
export interface SharedIntent { location: SharedLocation; action: SharedAction; reorderedStops?: ReorderedStop[] }

// Module-level hand-off from the intake hook to the Location screen. `set` publishes a pending shared intent
// (resolved location + the action the user chose in the share popup) and notifies subscribers; the screen
// `consume`s it exactly once (get + clear).
let pending: SharedIntent | null = null;
const subs = new Set<() => void>();

export const sharedLocationStore = {
  set(intent: SharedIntent): void {
    pending = intent;
    subs.forEach((f) => f());
  },
  consume(): SharedIntent | null {
    const p = pending;
    pending = null;
    return p;
  },
  subscribe(cb: () => void): () => void {
    subs.add(cb);
    return () => { subs.delete(cb); };
  },
};
