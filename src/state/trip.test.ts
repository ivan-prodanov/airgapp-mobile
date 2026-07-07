import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  carStop, startTrip, addStop, addCharger, removeStop, reorderStops, insertStop,
  straightLineLegs, computeItinerary, tripTotals, type TripStop, type Leg,
} from './trip';
import type { Place } from '@/services/place';
import type { Charger } from '@/services/tomtom';

const CAR = { latitude: 42.7, longitude: 23.3 };
const place = (id: string, lat: number, lng: number): Place => ({
  id, title: id, subtitle: `${id} addr`, coordinate: { latitude: lat, longitude: lng }, kind: 'poi', source: 'apple',
});
const charger = (id: string): Charger => ({
  id, name: `Charger ${id}`, place: 'P', region: 'R', latitude: 42.8, longitude: 23.4,
  currentType: 'DC', maxPowerKW: 150, totalConnectors: 4, availableConnectors: 4, connectors: [], distanceM: 0,
});

test('startTrip puts the car first, then the place', () => {
  const t = startTrip(carStop(CAR), place('Vidin', 43.99, 22.88));
  assert.deepEqual(t.stops.map((s) => s.kind), ['car', 'place']);
  assert.equal(t.stops[0].title, 'Car location');
  assert.equal(t.stops[1].title, 'Vidin');
});

test('addStop / addCharger append', () => {
  let t = startTrip(carStop(CAR), place('A', 43, 23));
  t = addCharger(t, charger('c1'));
  t = addStop(t, place('B', 44, 24));
  assert.deepEqual(t.stops.map((s) => s.kind), ['car', 'place', 'charger', 'place']);
});

test('removeStop never removes the car', () => {
  let t = startTrip(carStop(CAR), place('A', 43, 23));
  t = removeStop(t, t.stops[0].id); // try to remove car → no-op
  assert.equal(t.stops.length, 2);
  t = removeStop(t, t.stops[1].id); // remove the place
  assert.deepEqual(t.stops.map((s) => s.kind), ['car']);
});

test('reorderStops keeps the car pinned at index 0', () => {
  let t = startTrip(carStop(CAR), place('A', 43, 23));
  t = addStop(t, place('B', 44, 24));
  t = reorderStops(t, 2, 1); // move B before A
  assert.deepEqual(t.stops.map((s) => s.title), ['Car location', 'B', 'A']);
  const same = reorderStops(t, 0, 1); // trying to move the car → unchanged
  assert.deepEqual(same.stops.map((s) => s.title), ['Car location', 'B', 'A']);
});

test('straightLineLegs returns one leg per consecutive pair with positive distance', () => {
  const stops: TripStop[] = [carStop(CAR), { id: 'x', kind: 'place', title: 'X', coordinate: { latitude: 43.7, longitude: 23.3 } }];
  const legs = straightLineLegs(stops);
  assert.equal(legs.length, 1);
  assert.ok(legs[0].distanceM > 100_000 && legs[0].distanceM < 120_000); // ~111 km/deg lat
  assert.ok(legs[0].durationS > 0);
});

test('computeItinerary drains per km, restores at chargers, advances time', () => {
  const stops: TripStop[] = [
    carStop(CAR),
    { id: 'c', kind: 'charger', title: 'C', coordinate: CAR },
    { id: 'd', kind: 'place', title: 'D', coordinate: CAR },
  ];
  const legs: Leg[] = [{ distanceM: 100_000, durationS: 3600 }, { distanceM: 50_000, durationS: 1800 }];
  const rows = computeItinerary(stops, legs, {
    departAt: 0, startPct: 90, drainPctPerKm: 0.2, chargerRestorePct: 80, chargeMinutes: 8,
  });
  assert.equal(rows.length, 3);
  assert.equal(rows[0].pct, 90);              // car
  assert.equal(rows[1].pct, 70);              // 90 - 0.2*100 (arrival at charger)
  assert.equal(rows[1].chargeMinutes, 8);
  assert.equal(rows[1].at, 3_600_000);        // 1h
  assert.equal(rows[2].pct, 70);              // restored to 80 then -0.2*50
  assert.equal(rows[2].at, 3_600_000 + 8 * 60_000 + 1_800_000); // +8min charge +30min drive
});

test('tripTotals sums legs', () => {
  assert.deepEqual(tripTotals([{ distanceM: 10, durationS: 1 }, { distanceM: 5, durationS: 2 }]), { distanceM: 15, durationS: 3 });
});

test('insertStop inserts at index, clamped to [1, length] (never before the car)', () => {
  let t = startTrip(carStop(CAR), place('A', 43, 23));
  t = addStop(t, place('B', 44, 24)); // [car, A, B]
  t = insertStop(t, place('X', 45, 25), 1); // before A
  assert.deepEqual(t.stops.map((s) => s.title), ['Car location', 'X', 'A', 'B']);
  t = insertStop(t, place('Y', 46, 26), 0); // clamp → index 1 (never before car)
  assert.equal(t.stops[0].title, 'Car location');
  assert.equal(t.stops[1].title, 'Y');
  const end = insertStop(t, place('Z', 47, 27), 999); // clamp → append
  assert.equal(end.stops[end.stops.length - 1].title, 'Z');
});
