import { test } from 'node:test';
import assert from 'node:assert/strict';
import { decodeGeohash, extractFromUrl } from './sharedLocation';

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

test('apple legacy ll= is the pin, q= is the label', () => {
  const r = extractFromUrl('https://maps.apple.com/?address=X&auid=1&ll=41.890221,12.492317&lsp=9902&q=Colosseum&t=m');
  assert.equal(r?.source, 'apple');
  near(r!.coordinate!.latitude, 41.890221); near(r!.coordinate!.longitude, 12.492317);
  assert.equal(r?.name, 'Colosseum');
});

test('apple unified /place coordinate=', () => {
  const r = extractFromUrl('https://maps.apple.com/place?coordinate=40.864791,-73.931723&name=My%20Place');
  near(r!.coordinate!.latitude, 40.864791); assert.equal(r?.name, 'My Place');
});

test('apple ignores sll (search hint), not the pin', () => {
  const r = extractFromUrl('https://maps.apple.com/?q=pizza&sll=50.894967,4.341626&z=10');
  assert.equal(r?.coordinate, undefined); // no pin; q is a name
  assert.equal(r?.name, 'pizza');
});

test('apple place-id-only → no coords, no name fabrication', () => {
  const r = extractFromUrl('https://maps.apple.com/place?place-id=I63802885C8189B2B');
  assert.equal(r?.coordinate, undefined);
});

test('google prefers !3d!4d over @camera', () => {
  const r = extractFromUrl('https://www.google.com/maps/place/Eiffel+Tower/@48.85,2.29,17z/data=!3m5!8m2!3d48.8582602!4d2.2944991');
  assert.equal(r?.source, 'google');
  near(r!.coordinate!.latitude, 48.8582602); near(r!.coordinate!.longitude, 2.2944991);
  assert.equal(r?.name, 'Eiffel Tower');
});

test('google @camera fallback', () => {
  const r = extractFromUrl('https://www.google.com/maps/@52.520008,13.404954,15z');
  near(r!.coordinate!.latitude, 52.520008); near(r!.coordinate!.longitude, 13.404954);
});

test('google q=lat,lng', () => {
  const r = extractFromUrl('https://maps.google.com/?q=48.8584,2.2945');
  near(r!.coordinate!.latitude, 48.8584);
});

test('waze ll=', () => {
  const r = extractFromUrl('https://www.waze.com/ul?ll=40.75889500%2C-73.98513100&navigate=yes&zoom=17');
  assert.equal(r?.source, 'waze'); near(r!.coordinate!.latitude, 40.758895);
});

test('waze to=ll. (directions), ignores from=', () => {
  const r = extractFromUrl('https://www.waze.com/live-map/directions?to=ll.40.7589%2C-73.9851&from=ll.40.68%2C-74.04');
  near(r!.coordinate!.latitude, 40.7589); near(r!.coordinate!.longitude, -73.9851);
});

test('waze /ul/h<geohash>', () => {
  const r = extractFromUrl('https://www.waze.com/ul/hdr5ru7vtv2');
  near(r!.coordinate!.latitude, 40.7588938, 1e-4);
});

test('rejects out-of-range and swaps reversed lat/lng', () => {
  const r = extractFromUrl('https://maps.apple.com/?ll=12.492317,41.890221'); // lat=12.49 valid, no swap needed here
  assert.ok(Math.abs(r!.coordinate!.latitude) <= 90 && Math.abs(r!.coordinate!.longitude) <= 180);
});

test('non-map url → null', () => {
  assert.equal(extractFromUrl('https://example.com/foo'), null);
});
