import { test } from 'node:test';
import assert from 'node:assert/strict';
import { decodeGeohash } from './sharedLocation';

const near = (a: number, b: number, eps = 1e-3) => assert.ok(Math.abs(a - b) < eps, `${a} !~= ${b}`);

test('decodeGeohash: canonical ezs42', () => {
  const { latitude, longitude } = decodeGeohash('ezs42');
  near(latitude, 42.605, 1e-2);
  near(longitude, -5.603, 1e-2);
});

test('decodeGeohash: Waze 10-char dr5ru7vtv2 → Times Square', () => {
  const { latitude, longitude } = decodeGeohash('dr5ru7vtv2');
  near(latitude, 40.7588938, 1e-4);
  near(longitude, -73.985136, 1e-4);
});
