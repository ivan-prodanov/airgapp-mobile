import { test } from 'node:test';
import assert from 'node:assert/strict';

import { pickOnlineSearch, type OnlineSearchFn } from './onlineSearchPick';

const apple: OnlineSearchFn = async () => [];
const photon: OnlineSearchFn = async () => [];

test('iOS uses Apple MKLocalSearch', () => {
  assert.equal(pickOnlineSearch('ios', { apple, photon }), apple);
});

test('Android uses Photon — not nothing, which would silently narrow search to the gazetteer', () => {
  assert.equal(pickOnlineSearch('android', { apple, photon }), photon);
});

test('an unknown platform falls to Photon rather than Apple, which is iOS-only', () => {
  assert.equal(pickOnlineSearch('web', { apple, photon }), photon);
});
