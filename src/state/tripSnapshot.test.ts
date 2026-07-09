import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createMemoryBackend } from './persistence';
import { saveTripSnapshotTo, loadTripSnapshotFrom, TRIP_SNAPSHOT_KEY } from './tripSnapshot';
import { startTrip, carStop } from './trip';

test('save then load round-trips a trip snapshot', async () => {
  const s = createMemoryBackend();
  const t = startTrip(carStop({ latitude: 1, longitude: 1 }), { id: 'p1', title: 'Dest', subtitle: '', coordinate: { latitude: 2, longitude: 2 }, kind: 'poi', source: 'apple' });
  await saveTripSnapshotTo(s, t);
  const loaded = await loadTripSnapshotFrom(s);
  assert.equal(loaded?.stops.length, t.stops.length);
  assert.equal(loaded?.stops[1].title, 'Dest');
});

test('load returns null when nothing saved', async () => {
  const s = createMemoryBackend();
  assert.equal(await loadTripSnapshotFrom(s), null);
  assert.equal(TRIP_SNAPSHOT_KEY, 'trip:last');
});
