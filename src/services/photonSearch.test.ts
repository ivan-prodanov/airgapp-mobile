import { test } from 'node:test';
import assert from 'node:assert/strict';

import { photonFeatureToPlace, photonSearch, photonUrl, type PhotonFeature } from './photonSearch';

const REGION = { latitude: 42.6977, longitude: 23.3219, latitudeDelta: 0.2, longitudeDelta: 0.2 };

test('GeoJSON is [lon, lat] — flipping it would put every result in the wrong hemisphere', () => {
  const f: PhotonFeature = {
    geometry: { type: 'Point', coordinates: [23.3219, 42.6977] }, // lon, lat
    properties: { name: 'Sofia', country: 'Bulgaria', osm_key: 'place', osm_value: 'city' },
  };
  const p = photonFeatureToPlace(f, 0);
  assert.equal(p?.coordinate?.latitude, 42.6977);
  assert.equal(p?.coordinate?.longitude, 23.3219);
});

test('a place feature maps to kind "city" and carries a country subtitle', () => {
  const p = photonFeatureToPlace(
    {
      geometry: { coordinates: [23.3219, 42.6977] },
      properties: { name: 'Sofia', country: 'Bulgaria', osm_key: 'place', osm_value: 'city' },
    },
    0,
  );
  assert.equal(p?.kind, 'city');
  assert.equal(p?.title, 'Sofia');
  assert.equal(p?.subtitle, 'Bulgaria');
  assert.equal(p?.source, 'photon');
  assert.equal(p?.id, 'photon:0:Sofia');
});

test('a charging station maps to kind "charger"', () => {
  const p = photonFeatureToPlace(
    {
      geometry: { coordinates: [23.3, 42.7] },
      properties: { name: 'Supercharger', osm_key: 'amenity', osm_value: 'charging_station' },
    },
    1,
  );
  assert.equal(p?.kind, 'charger');
});

test('the subtitle never repeats the title', () => {
  const p = photonFeatureToPlace(
    { geometry: { coordinates: [23.3, 42.7] }, properties: { name: 'Sofia', city: 'Sofia', country: 'Bulgaria' } },
    0,
  );
  assert.equal(p?.subtitle, 'Bulgaria');
});

test('a feature with no usable point is dropped rather than given a bogus coordinate', () => {
  assert.equal(photonFeatureToPlace({ properties: { name: 'X' } }, 0), null);
  assert.equal(photonFeatureToPlace({ geometry: { coordinates: [1] }, properties: { name: 'X' } }, 0), null);
  assert.equal(
    photonFeatureToPlace({ geometry: { coordinates: ['a', 'b'] as unknown as number[] } }, 0),
    null,
  );
});

test('the query biases on the region centre', () => {
  const url = photonUrl('sofia', REGION);
  assert.ok(url.startsWith('https://photon.komoot.io/api/?'));
  assert.ok(url.includes('q=sofia'));
  assert.ok(url.includes('lat=42.6977'));
  assert.ok(url.includes('lon=23.3219'));
});

test('photonSearch maps a full response and drops unusable features', async () => {
  const fake = async () => ({
    ok: true,
    status: 200,
    json: async () => ({
      features: [
        { geometry: { coordinates: [23.3219, 42.6977] }, properties: { name: 'Sofia', country: 'Bulgaria' } },
        { properties: { name: 'no geometry' } },
      ],
    }),
  });
  const out = await photonSearch('sofia', REGION, fake);
  assert.equal(out.length, 1);
  assert.equal(out[0].title, 'Sofia');
});

test('a non-OK response REJECTS so searchProvider degrades to the gazetteer', async () => {
  // Returning [] here would read as "searched fine, no matches" and suppress local results.
  const fake = async () => ({ ok: false, status: 503, json: async () => ({}) });
  await assert.rejects(() => photonSearch('sofia', REGION, fake), /photon 503/);
});
