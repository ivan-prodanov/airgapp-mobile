import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mapGeoNamesRow, parsePopulation } from './gazetteer';

// A real cities1000.txt line has 19 tab-separated columns:
// geonameid,name,asciiname,alternatenames,lat,lng,featureClass,featureCode,country,cc2,
// admin1,admin2,admin3,admin4,population,elevation,dem,timezone,modDate
const SOFIA = [
  '727011', 'Sofia', 'Sofia', 'Sofiya,София', '42.69751', '23.32415',
  'P', 'PPLC', 'BG', '', '42', '', '', '', '1152556', '', '531', 'Europe/Sofia', '2019-09-05',
].join('\t');

test('mapGeoNamesRow maps a well-formed line', () => {
  const r = mapGeoNamesRow(SOFIA);
  assert.ok(r);
  assert.equal(r.id, '727011');
  assert.equal(r.name, 'Sofia');
  assert.equal(r.asciiname, 'Sofia');
  assert.equal(r.country, 'BG');
  assert.equal(r.admin1, '42');
  assert.equal(r.population, 1152556);
  assert.ok(Math.abs(r.lat - 42.69751) < 1e-6);
  assert.ok(Math.abs(r.lng - 23.32415) < 1e-6);
});

test('mapGeoNamesRow returns null for a coordinate-less / short line', () => {
  assert.equal(mapGeoNamesRow('123\tX'), null);
  const noCoord = ['1', 'X', 'X', '', 'NaN', '', 'P', 'PPL', 'BG', '', '', '', '', '', '0', '', '', '', ''].join('\t');
  assert.equal(mapGeoNamesRow(noCoord), null);
});

test('parsePopulation handles blanks and non-numbers', () => {
  assert.equal(parsePopulation('1152556'), 1152556);
  assert.equal(parsePopulation(''), 0);
  assert.equal(parsePopulation('abc'), 0);
});
