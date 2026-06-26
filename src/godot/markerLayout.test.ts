import { test } from 'node:test';
import assert from 'node:assert/strict';

import { anchorToPoint, lockAnchorPx, overlayAnchorsPx } from './markerLayout';
import type { VehicleMarkers } from '../types/markerTypes';

const fullMarkers: VehicleMarkers = {
  frunk: [600, 200],
  trunk: [600, 1400],
  chargePort: [200, 1300],
  doorFrontL: [400, 700],
  doorFrontR: [800, 700],
  doorRearL: [400, 1100],
  doorRearR: [800, 1100],
};

test('lockAnchorPx returns the centroid of the four door markers', () => {
  assert.deepEqual(lockAnchorPx(fullMarkers), [600, 900]);
});

test('lockAnchorPx falls back to the frunk-trunk midpoint when a door is missing', () => {
  const { doorRearR: _drop, ...missingDoor } = fullMarkers;
  assert.deepEqual(lockAnchorPx(missingDoor), [600, 800]);
});

test('lockAnchorPx returns null when neither doors nor frunk+trunk are present', () => {
  assert.equal(lockAnchorPx({ chargePort: [10, 10] }), null);
});

test('overlayAnchorsPx exposes frunk, trunk, chargePort and the derived lock', () => {
  const anchors = overlayAnchorsPx(fullMarkers);
  assert.deepEqual(anchors.frunk, [600, 200]);
  assert.deepEqual(anchors.trunk, [600, 1400]);
  assert.deepEqual(anchors.chargePort, [200, 1300]);
  assert.deepEqual(anchors.lock, [600, 900]);
});

test('overlayAnchorsPx omits buttons whose source markers are absent', () => {
  const anchors = overlayAnchorsPx({ frunk: [600, 200] });
  assert.deepEqual(anchors.frunk, [600, 200]);
  assert.equal(anchors.trunk, undefined);
  assert.equal(anchors.chargePort, undefined);
  // No doors and no trunk → no lock either.
  assert.equal(anchors.lock, undefined);
});

test('anchorToPoint divides device pixels by the pixel ratio and applies the calibration offset', () => {
  assert.deepEqual(anchorToPoint([600, 900], 3, { dx: 0, dy: 0 }), { left: 200, top: 300 });
  assert.deepEqual(anchorToPoint([600, 900], 3, { dx: 5, dy: -8 }), { left: 205, top: 292 });
});

test('anchorToPoint ignores non-positive pixel ratios by treating them as 1', () => {
  assert.deepEqual(anchorToPoint([120, 240], 0, { dx: 0, dy: 0 }), { left: 120, top: 240 });
});
