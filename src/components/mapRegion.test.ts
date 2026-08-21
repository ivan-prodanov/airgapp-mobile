import { test } from 'node:test';
import assert from 'node:assert/strict';

import {
  regionToBounds,
  boundsToRegion,
  boundsForCoordinates,
  normalizeApplePoi,
  normalizeMapLibrePoi,
} from './mapRegion';

const SOFIA = { latitude: 42.6977, longitude: 23.3219, latitudeDelta: 0.1, longitudeDelta: 0.2 };

test('deltas are FULL spans — each edge is half a delta from the centre', () => {
  // Treating them as half-spans would silently double every fitted viewport.
  const [w, s, e, n] = regionToBounds(SOFIA);
  assert.equal(w, 23.3219 - 0.1);
  assert.equal(e, 23.3219 + 0.1);
  assert.equal(s, 42.6977 - 0.05);
  assert.equal(n, 42.6977 + 0.05);
});

test('bounds are ordered [west, south, east, north], not lat-first', () => {
  const b = regionToBounds(SOFIA);
  assert.ok(b[0] < b[2], 'west must be less than east');
  assert.ok(b[1] < b[3], 'south must be less than north');
  // Longitudes are ~23, latitudes ~42 — a lat/lng flip would swap those magnitudes.
  assert.ok(b[0] > 23 && b[0] < 24, 'index 0 must be a longitude');
  assert.ok(b[1] > 42 && b[1] < 43, 'index 1 must be a latitude');
});

test('boundsToRegion round-trips regionToBounds', () => {
  const back = boundsToRegion(regionToBounds(SOFIA));
  assert.ok(Math.abs(back.latitude - SOFIA.latitude) < 1e-9);
  assert.ok(Math.abs(back.longitude - SOFIA.longitude) < 1e-9);
  assert.ok(Math.abs(back.latitudeDelta - SOFIA.latitudeDelta) < 1e-9);
  assert.ok(Math.abs(back.longitudeDelta - SOFIA.longitudeDelta) < 1e-9);
});

test('boundsForCoordinates spans every point', () => {
  const b = boundsForCoordinates([
    { latitude: 42.0, longitude: 23.0 },
    { latitude: 43.0, longitude: 24.0 },
    { latitude: 42.5, longitude: 22.5 },
  ]);
  assert.deepEqual(b, [22.5, 42.0, 24.0, 43.0]);
});

test('a single point is padded — a zero-area box would fit at maximum zoom', () => {
  const b = boundsForCoordinates([{ latitude: 42.0, longitude: 23.0 }])!;
  assert.ok(b[2] > b[0] && b[3] > b[1], 'padded box must have area');
});

test('no coordinates yields null rather than a bogus box', () => {
  assert.equal(boundsForCoordinates([]), null);
});

test('Apple and MapLibre POI taps normalise to the same shape', () => {
  const apple = normalizeApplePoi({
    nativeEvent: { name: 'Cafe', coordinate: { latitude: 42.7, longitude: 23.3 } },
  });
  const maplibre = normalizeMapLibrePoi({
    properties: { name: 'Cafe' },
    geometry: { type: 'Point', coordinates: [23.3, 42.7] }, // GeoJSON is [lon, lat]
  });
  assert.deepEqual(apple, { name: 'Cafe', latitude: 42.7, longitude: 23.3 });
  assert.deepEqual(maplibre, apple);
});

test('an unnamed MapLibre feature falls back through name:latin then a generic label', () => {
  assert.equal(
    normalizeMapLibrePoi({
      properties: { 'name:latin': 'Sofia' },
      geometry: { coordinates: [23.3, 42.7] },
    })?.name,
    'Sofia',
  );
  assert.equal(
    normalizeMapLibrePoi({ properties: {}, geometry: { coordinates: [23.3, 42.7] } })?.name,
    'Place',
  );
});

test('a feature with no usable point is dropped, not given a bogus coordinate', () => {
  assert.equal(normalizeMapLibrePoi({ properties: { name: 'X' } }), null);
  assert.equal(normalizeMapLibrePoi({ geometry: { coordinates: [1] } }), null);
});
