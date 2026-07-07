import { test } from 'node:test';
import assert from 'node:assert/strict';

import { parsePowerKW, mapOsmElement, dedupeById, type OsmElement } from './osm';

test('parsePowerKW handles kW, watts, bare numbers, and lists', () => {
  assert.equal(parsePowerKW('50 kW'), 50);
  assert.equal(parsePowerKW('50000'), 50); // bare > 1000 → watts
  assert.equal(parsePowerKW('22'), 22); // bare ≤ 1000 → kW
  assert.equal(parsePowerKW('3.7 kW'), 3.7);
  assert.equal(parsePowerKW('150 kW;350 kW'), 150); // first of a list
  assert.equal(parsePowerKW('7400 W'), 7.4);
  assert.equal(parsePowerKW(undefined), 0);
  assert.equal(parsePowerKW('unknown'), 0);
});

test('mapOsmElement maps a DC CCS node with full tags', () => {
  const el: OsmElement = {
    type: 'node',
    id: 123,
    lat: 42.68,
    lon: 23.32,
    tags: {
      'socket:type2_combo': '2',
      'socket:type2_combo:output': '150 kW',
      operator: 'Eldrive',
      'addr:city': 'Sofia',
      opening_hours: '24/7',
      website: 'https://eldrive.eu',
    },
  };
  const c = mapOsmElement(el, 'Bulgaria');
  assert.ok(c);
  assert.equal(c!.id, 'osm:n123');
  assert.equal(c!.currentType, 'DC');
  assert.equal(c!.maxPowerKW, 150);
  assert.equal(c!.totalConnectors, 2);
  assert.equal(c!.name, 'Eldrive');
  assert.equal(c!.region, 'Sofia, Bulgaria');
  assert.equal(c!.connectors.length, 1);
  assert.equal(c!.connectors[0].label, 'CCS');
  assert.ok(c!.openingHours, '24/7 → synthesised range');
  assert.equal(c!.website, 'https://eldrive.eu');
});

test('mapOsmElement classifies an AC type2 station', () => {
  const el: OsmElement = {
    type: 'way',
    id: 9,
    center: { lat: 42.7, lon: 23.3 },
    tags: { 'socket:type2': '1', 'socket:type2:output': '22 kW', brand: 'Kaufland' },
  };
  const c = mapOsmElement(el)!;
  assert.equal(c.id, 'osm:w9');
  assert.equal(c.currentType, 'AC');
  assert.equal(c.maxPowerKW, 22);
  assert.equal(c.totalConnectors, 1);
  assert.equal(c.name, 'Kaufland');
});

test('mapOsmElement falls back to capacity and default power when sockets are missing', () => {
  const el: OsmElement = { type: 'node', id: 5, lat: 42.6, lon: 23.3, tags: { capacity: '4' } };
  const c = mapOsmElement(el)!;
  assert.equal(c.totalConnectors, 4); // from capacity
  assert.equal(c.connectors.length, 0);
  assert.equal(c.currentType, 'AC');
  assert.equal(c.maxPowerKW, 22); // AC default
  assert.equal(c.name, 'Charging station');
});

test('mapOsmElement returns null without a coordinate', () => {
  assert.equal(mapOsmElement({ type: 'node', id: 1, tags: { 'socket:type2': '1' } }), null);
});

test('totalConnectors is 0 (not a fake 1) when nothing is known → badge shows "?"', () => {
  const c = mapOsmElement({ type: 'node', id: 2, lat: 42.6, lon: 23.3, tags: {} })!;
  assert.equal(c.totalConnectors, 0);
});

test('dedupeById keeps first occurrence', () => {
  const a = mapOsmElement({ type: 'node', id: 1, lat: 42, lon: 23, tags: { name: 'A' } })!;
  const b = mapOsmElement({ type: 'node', id: 1, lat: 42, lon: 23, tags: { name: 'B' } })!;
  const out = dedupeById([a, b]);
  assert.equal(out.length, 1);
  assert.equal(out[0].name, 'A');
});
