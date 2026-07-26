import { test } from 'node:test';
import assert from 'node:assert/strict';
import { decodeGeohash, extractFromUrl } from './sharedLocation';
import { destinationTitle } from './destinationTitle';

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

test('extractFromUrl never throws on a stray % in the URL', () => {
  const r = extractFromUrl('https://maps.apple.com/?ll=41.890221,12.492317&q=Deal%20-%2050%25%20off%20SAVE%');
  near(r!.coordinate!.latitude, 41.890221);
});

test('extractFromUrl never throws on a stray % in a google /place name', () => {
  const r = extractFromUrl('https://www.google.com/maps/place/foo%/@48.8582602,2.2944991,17z/data=!3d48.8582602!4d2.2944991');
  near(r!.coordinate!.latitude, 48.8582602);
});

import { parseSharedLocation } from './sharedLocation';

const noDeps = { resolveUrl: async () => null, geocode: async () => null };

test('parse: extracts URL from "Label\\nURL" text', async () => {
  const loc = await parseSharedLocation('Colosseum\nhttps://maps.apple.com/?ll=41.89,12.49&q=Colosseum', noDeps);
  near(loc!.coordinate.latitude, 41.89); assert.equal(loc!.source, 'apple');
});

test('parse: resolves a google short link via deps.resolveUrl', async () => {
  const deps = {
    resolveUrl: async (_u: string) => ({ finalUrl: 'https://www.google.com/maps/place/X/@1,2,17z/data=!8m2!3d48.8!4d2.29', body: '' }),
    geocode: async () => null,
  };
  const loc = await parseSharedLocation('https://maps.app.goo.gl/abc123', deps);
  assert.equal(loc!.source, 'google');
  near(loc!.coordinate.latitude, 48.8);
});

test('parse: short link coords only in the HTML body', async () => {
  const deps = {
    resolveUrl: async () => ({ finalUrl: 'https://consent.google.com/x', body: 'blah @50.1,4.2 blah !3d50.1!4d4.2' }),
    geocode: async () => null,
  };
  const loc = await parseSharedLocation('https://maps.app.goo.gl/abc', deps);
  near(loc!.coordinate.latitude, 50.1);
});

test('parse: address-only apple → geocode fallback', async () => {
  const deps = { resolveUrl: async () => null, geocode: async (a: string) => (a ? { latitude: 9, longitude: 8 } : null) };
  const loc = await parseSharedLocation('https://maps.apple.com/place?address=1000%20Fifth%20Ave', deps);
  near(loc!.coordinate.latitude, 9);
});

test('parse: address-only apple → geocode fallback carries the address forward, not just the coordinate', async () => {
  // Regression for the review finding: a share that resolves to an address but no place name (the
  // resolver's own geocodeFallback path) must reach the car as the street address, not a bare
  // "lat, lng" — destinationTitle only gets there if SharedLocation actually carries `address`.
  const deps = { resolveUrl: async () => null, geocode: async (a: string) => (a ? { latitude: 9, longitude: 8 } : null) };
  const loc = await parseSharedLocation('https://maps.apple.com/place?address=1000%20Fifth%20Ave', deps);
  assert.equal(loc!.name, undefined);
  assert.equal(loc!.address, '1000 Fifth Ave');
  assert.equal(destinationTitle(loc!), '1000 Fifth Ave');
});

test('parse: garbage → null', async () => {
  assert.equal(await parseSharedLocation('hello world', noDeps), null);
});

import { isShortLink } from './sharedLocation';

test('isShortLink recognizes Apple maps.apple/p short link', () => {
  assert.equal(isShortLink('https://maps.apple/p/6zSLmCMDQ0HYAr'), true);
  assert.equal(isShortLink('https://maps.apple.com/place?coordinate=1,2'), false); // resolved target, not a short link
});

test('parse resolves Apple maps.apple/p short link → coordinate=', async () => {
  const deps = {
    resolveUrl: async () => ({
      finalUrl: 'https://maps.apple.com/place?address=X&auid=1&coordinate=39.918409,25.366319&lsp=7618&name=814%2001&map=explore',
      body: '',
    }),
    geocode: async () => null,
  };
  const loc = await parseSharedLocation('https://maps.apple/p/6zSLmCMDQ0HYAr', deps);
  assert.equal(loc?.source, 'apple');
  near(loc!.coordinate.latitude, 39.918409);
  near(loc!.coordinate.longitude, 25.366319);
});

test('extractFromUrl: unwraps google consent continue param → place name as address', () => {
  const r = extractFromUrl('https://consent.google.com/ml?continue=https://maps.google.com/maps?q%3DKeros%2BBay%2BView,%2BKeros,%2BGreece%26ftid%3D0x1:0x2&m=1&gl=BG');
  assert.equal(r?.source, 'google');
  assert.equal(r?.coordinate, undefined);
  assert.equal(r?.address, 'Keros Bay View, Keros, Greece');
});

test('parse: google goo.gl → consent wall → geocode the place name', async () => {
  const deps = {
    resolveUrl: async () => ({
      finalUrl: 'https://consent.google.com/ml?continue=https://maps.google.com/maps?q%3DKeros%2BBay%2BView,%2BKeros,%2BGreece%26ftid%3D0x1:0x2&m=1',
      body: '<!DOCTYPE html>consent',
    }),
    geocode: async (a: string) => (a.includes('Keros') ? { latitude: 39.9, longitude: 25.3 } : null),
  };
  const loc = await parseSharedLocation('https://maps.app.goo.gl/3GYn4xAcU9wruSpr6?g_st=x', deps);
  assert.equal(loc?.source, 'google');
  near(loc!.coordinate.latitude, 39.9);
});
