import { load, type AppStorage } from './persistence';
import type { Trip } from './trip';

export const TRIP_SNAPSHOT_KEY = 'trip:last';

// Storage-injected so the logic is node-testable with a memory backend. useTrip.ts binds the real appStorage.
export async function loadTripSnapshotFrom(storage: AppStorage): Promise<Trip | null> {
  return load<Trip | null>(storage, TRIP_SNAPSHOT_KEY, null);
}
export async function saveTripSnapshotTo(storage: AppStorage, trip: Trip | null): Promise<void> {
  await storage.setItem(TRIP_SNAPSHOT_KEY, JSON.stringify(trip));
}
