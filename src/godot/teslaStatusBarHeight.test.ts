import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

import {
  TESLA_SBH_NOTCH,
  TESLA_SBH_PLAIN,
  TESLA_SBH_TALL,
  teslaStatusBarHeight,
} from './teslaStatusBarHeight.ts';

// The device this app ships to reports a 68pt inset; Tesla's table says 59.
// That 9pt gap is the whole bug, so pin it.
const REAL_INSET_ON_TARGET = 68;

describe('teslaStatusBarHeight — their hardcoded table, NOT the real inset', () => {
  it('maps every listed identifier prefix to 59', () => {
    for (const id of [
      'iPhone13,1',
      'iPhone13,2',
      'iPhone14,4',
      'iPhone14,6',
      'iPhone14,7',
      'iPhone15,4',
      'iPhone16,1',
      'iPhone17,2',
      'iPhone18,1',
    ]) {
      assert.equal(teslaStatusBarHeight(id, REAL_INSET_ON_TARGET), TESLA_SBH_TALL, id);
    }
  });

  it('IGNORES the device inset for a listed device — the point of the table', () => {
    // The target phone reports 68 (Display Zoom). Tesla still uses 59, and so
    // must we, or the Climate frame comes out 9pt short and the car 1.5% small.
    assert.equal(teslaStatusBarHeight('iPhone17,2', 68), 59);
    assert.equal(teslaStatusBarHeight('iPhone17,2', 59), 59);
    assert.equal(teslaStatusBarHeight('iPhone17,2', 47), 59);
  });

  it('falls back to their notch/non-notch split for unlisted models', () => {
    assert.equal(teslaStatusBarHeight('iPhone12,1', 47), TESLA_SBH_NOTCH); // notched
    assert.equal(teslaStatusBarHeight('iPhone9,3', 20), TESLA_SBH_PLAIN); // pre-notch
  });

  it('falls back safely when the model id is unavailable', () => {
    assert.equal(teslaStatusBarHeight(null, 68), TESLA_SBH_NOTCH);
    assert.equal(teslaStatusBarHeight(null, 20), TESLA_SBH_PLAIN);
  });
});

describe('the frame maths this feeds (target device: 420x912)', () => {
  const H = 912;
  const sbh = teslaStatusBarHeight('iPhone17,2', 68);

  it('Climate lands on Tesla scale 0.6721, not our 0.6623', () => {
    const height = H - sbh - 240;
    assert.equal(height, 613);
    assert.equal(Number((height / H).toFixed(4)), 0.6721);
  });

  it("Controls is unaffected — statusBarHeight isn't in its formula", () => {
    assert.equal(Number(((H - 20) / H).toFixed(4)), 0.9781);
  });

  it('Home keeps its size (absolute 355) and only moves 9pt up', () => {
    assert.equal(sbh + 60, 119); // was 128 with the raw inset
  });
});
