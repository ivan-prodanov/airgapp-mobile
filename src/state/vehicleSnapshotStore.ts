import { useSyncExternalStore } from 'react';

// A tiny module-level store mapping a car's config hash → the file:// URI of its
// rendered Godot snapshot PNG. Shared by every thumbnail (Cars list rows + the
// Home vehicle-summary image) so a given config is requested once and reused.

let snapshots: Record<string, string> = {};
const listeners = new Set<() => void>();

export function setSnapshot(hash: string, uri: string): void {
  if (snapshots[hash] === uri) return;
  snapshots = { ...snapshots, [hash]: uri };
  for (const l of listeners) l();
}

export function getSnapshot(hash: string): string | undefined {
  return snapshots[hash];
}

export function subscribeSnapshots(cb: () => void): () => void {
  listeners.add(cb);
  return () => listeners.delete(cb);
}

// Test-only.
export function __resetSnapshots(): void {
  snapshots = {};
}

// Subscribe a component to the snapshot URI for one hash (null hash → null).
export function useVehicleSnapshot(hash: string | null): string | null {
  return useSyncExternalStore(subscribeSnapshots, () => (hash ? snapshots[hash] ?? null : null));
}
