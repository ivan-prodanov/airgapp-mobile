import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

import {
  TESLA_SBH_IPHONE_X,
  TESLA_SBH_MINI,
  TESLA_SBH_PLAIN,
  TESLA_SBH_TALL,
  TESLA_SBH_WIDE,
  teslaStatusBarHeight,
} from './teslaStatusBarHeight.ts';

const TARGET = { width: 420, height: 912 }; // iPhone18,4 as measured on device
const MINI = { width: 375, height: 812 };
const SE3 = { width: 375, height: 667 };

describe('teslaStatusBarHeight — their verbatim table (findings §1b)', () => {
  it('returns 50 for the minis via their EXACT carve-outs', () => {
    assert.equal(teslaStatusBarHeight('iPhone13,1', MINI, 50), TESLA_SBH_MINI); // 12 mini
    assert.equal(teslaStatusBarHeight('iPhone14,4', MINI, 50), TESLA_SBH_MINI); // 13 mini
  });

  it('returns 47 for the non-mini 12/13/14 families via .includes', () => {
    for (const id of ['iPhone13,2', 'iPhone13,4', 'iPhone14,5', 'iPhone14,7', 'iPhone14,8']) {
      assert.equal(teslaStatusBarHeight(id, { width: 390, height: 844 }, 47), TESLA_SBH_WIDE, id);
    }
  });

  it('returns 59 for the 14 Pro and newer', () => {
    for (const id of ['iPhone15,2', 'iPhone15,4', 'iPhone16,1', 'iPhone17,2', 'iPhone18,4']) {
      assert.equal(teslaStatusBarHeight(id, TARGET, 68), TESLA_SBH_TALL, id);
    }
  });

  it('routes the SE 3 back to the library, which yields 20 — NOT a phantom notch', () => {
    assert.equal(teslaStatusBarHeight('iPhone14,6', SE3, 20), TESLA_SBH_PLAIN);
  });
});

describe('the order is load-bearing (findings §1c)', () => {
  it('the exact mini carve-outs beat the substring test that would swallow them', () => {
    // If includes('iPhone13') ran first, the 12 mini would regress 50 -> 47.
    assert.notEqual(teslaStatusBarHeight('iPhone13,1', MINI, 50), TESLA_SBH_WIDE);
    assert.notEqual(teslaStatusBarHeight('iPhone14,4', MINI, 50), TESLA_SBH_WIDE);
  });

  it('the SE 3 carve-out beats includes("iPhone14")', () => {
    // Otherwise a notchless phone gets 47 — a 27pt phantom notch.
    assert.equal(teslaStatusBarHeight('iPhone14,6', SE3, 20), TESLA_SBH_PLAIN);
  });
});

describe('the table IGNORES the real inset — the point of mirroring it', () => {
  it('uses 59 on our target even though the device reports 68', () => {
    // The 9pt gap is the whole bug: Climate bakes sbh into its height.
    assert.equal(teslaStatusBarHeight('iPhone18,4', TARGET, 68), 59);
    assert.equal(teslaStatusBarHeight('iPhone18,4', TARGET, 59), 59);
  });
});

describe('the library fallback', () => {
  it('returns 44 for the exact iPhone X / XS Max window sizes', () => {
    assert.equal(teslaStatusBarHeight('iPhone10,3', MINI, 44), TESLA_SBH_IPHONE_X);
    assert.equal(teslaStatusBarHeight('iPhone11,8', { width: 414, height: 896 }, 44), TESLA_SBH_IPHONE_X);
  });

  it('DELIBERATELY DIVERGES for unknown/newer devices: real inset, not their 20', () => {
    // Tesla's allowlist falls through to 20 for anything past iPhone18,x — ~39pt
    // short, which would silently rescale the car on a future phone (findings §4).
    assert.equal(teslaStatusBarHeight('iPhone19,4', { width: 440, height: 956 }, 62), 62);
    assert.notEqual(teslaStatusBarHeight('iPhone19,4', { width: 440, height: 956 }, 62), TESLA_SBH_PLAIN);
  });

  it('falls back to 20 when there is no inset to use either', () => {
    assert.equal(teslaStatusBarHeight(null, { width: 375, height: 667 }, 0), TESLA_SBH_PLAIN);
  });
});

describe('the frame maths this feeds (target: iPhone18,4 @ 420x912)', () => {
  const H = 912;
  const sbh = teslaStatusBarHeight('iPhone18,4', TARGET, 68);

  it('Climate lands on 613 / 0.6721 — Tesla, not our old 604 / 0.6623', () => {
    assert.equal(H - sbh - 240, 613);
    assert.equal(Number(((H - sbh - 240) / H).toFixed(4)), 0.6721);
  });

  it("Controls is immune — sbh isn't in its formula", () => {
    assert.equal(Number(((H - 20) / H).toFixed(4)), 0.9781);
  });

  it('Home keeps its size (absolute 355) and sits 9pt higher than before', () => {
    assert.equal(sbh + 60, 119);
  });
});

describe('Android', () => {
  // Tesla's table is an iPhone allowlist, so every Android device falls through to
  // the library fallback — which the deliberate-divergence note above already
  // resolves to the REAL safe-area inset rather than the 20pt pre-notch default.
  it('the Galaxy S22 gets its real inset, not a hardcoded iPhone value', () => {
    assert.equal(teslaStatusBarHeight('SM-S901B', { width: 360, height: 780 }, 24), 24);
  });

  it('an Android phone at iPhone X dimensions does NOT collect a phantom notch', () => {
    // The isIPhoneX test is pure dimensions; without the isApple guard this would
    // return 44, and Climate bakes sbh into its height — silently rescaling the car.
    assert.equal(teslaStatusBarHeight('SM-S901B', { width: 375, height: 812 }, 24), 24);
    assert.equal(teslaStatusBarHeight('Pixel 9', { width: 414, height: 896 }, 30), 30);
  });

  it('a real iPhone X still gets 44 — the guard must not regress iOS', () => {
    assert.equal(teslaStatusBarHeight('iPhone10,3', { width: 375, height: 812 }, 44), 44);
  });

  it('falls back to the pre-notch 20 only when there is no inset at all', () => {
    assert.equal(teslaStatusBarHeight('SM-S901B', { width: 360, height: 780 }, 0), 20);
  });
});
