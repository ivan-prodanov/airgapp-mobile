import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

import { feedbackClass, isFireAndForget, spins } from './commandFeedback.ts';

describe('commandFeedback — the report §3 verdict', () => {
  it('lock/unlock FLIP (optimistic), never spin — the current app is backwards', () => {
    assert.equal(feedbackClass('lock'), 'optimistic');
    assert.equal(spins('lock'), false);
    assert.equal(spins('unlock'), false);
  });

  it('frunk/trunk are the ONE pair that spins', () => {
    assert.equal(spins('openFrunk'), true);
    assert.equal(spins('openTrunk'), true);
    assert.equal(spins('closeTrunk'), true);
  });

  it('climate keeper spins; seat heaters never do', () => {
    assert.equal(spins('climateKeeper'), true);
    assert.equal(spins('seatHeater'), false);
    assert.equal(spins('seatCooler'), false);
  });

  it('momentary actions are fire-and-forget — no feedback at all', () => {
    for (const t of ['honk', 'flashLights', 'homelink', 'boombox'] as const) {
      assert.equal(isFireAndForget(t), true, t);
    }
  });

  it('sliders/steppers are release-class (local during drag, no spinner)', () => {
    for (const t of ['setChargeLimit', 'setChargingAmps', 'setClimateTemp'] as const) {
      assert.equal(feedbackClass(t), 'release', t);
      assert.equal(spins(t), false);
    }
  });

  it('charge start/stop, windows, sentry, charge-port all flip', () => {
    for (const t of ['chargeStart', 'chargeStop', 'ventWindows', 'sentry', 'openChargePort'] as const) {
      assert.equal(feedbackClass(t), 'optimistic', t);
    }
  });
});
