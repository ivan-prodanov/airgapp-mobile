import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

import { planDrain, transitionFor } from './outboxDrain.ts';
import { STALE_AFTER_MS, type OutboxItem } from './shareOutbox.ts';

const NOW = 1_800_000_000_000;

const item = (over: Partial<OutboxItem> = {}): OutboxItem => ({
  id: 'a',
  ts: NOW,
  location: { lat: 42.6977, lng: 23.3219 },
  status: 'pending',
  attempts: 0,
  ...over,
});

describe('planDrain', () => {
  it('sends pending items oldest first', () => {
    const plan = planDrain([item({ id: 'new', ts: NOW }), item({ id: 'old', ts: NOW - 5000 })], NOW);
    assert.deepEqual(plan.toSend.map((i) => i.id), ['old', 'new']);
  });

  it('never removes anything — a drain pass only reports', () => {
    // The invariant: removal happens after the CAR confirms, not because we
    // looked at the queue.
    const items = [item({ id: 'a' }), item({ id: 'b', status: 'rejected', lastError: 'no results' })];
    const plan = planDrain(items, NOW);
    assert.equal(plan.cleaned.length, 2, 'nothing dropped just by planning');
  });

  it('surfaces refusals instead of hiding them', () => {
    const plan = planDrain([item({ id: 'r', status: 'rejected', lastError: 'no results found' })], NOW);
    assert.deepEqual(plan.toSurface.map((i) => i.id), ['r']);
    assert.equal(plan.toSend.length, 0, 'a refusal is terminal, not retried');
  });

  it('reports expired items separately rather than silently skipping them', () => {
    const old = item({ id: 'old', ts: NOW - STALE_AFTER_MS - 1 });
    const plan = planDrain([old], NOW);
    assert.equal(plan.toSend.length, 0, 'not sent verbatim');
    assert.deepEqual(plan.expired.map((i) => i.id), ['old'], 'but the caller can say so');
  });

  it('cleaned drops delivered and expired, keeps refusals and pending', () => {
    const items = [
      item({ id: 'sent', status: 'sent' }),
      item({ id: 'expired', ts: NOW - STALE_AFTER_MS - 1 }),
      item({ id: 'refused', status: 'rejected', lastError: 'nope' }),
      item({ id: 'waiting' }),
    ];
    assert.deepEqual(
      planDrain(items, NOW).cleaned.map((i) => i.id).sort(),
      ['refused', 'waiting'],
    );
  });
});

describe('transitionFor — an ACK is not an acceptance', () => {
  it('only the car’s own OK marks an item sent', () => {
    assert.equal(transitionFor({ kind: 'accepted' }), 'sent');
  });

  it('a refusal is terminal', () => {
    assert.equal(transitionFor({ kind: 'refused', reason: 'no results found' }), 'rejected');
  });

  it('transport failures retry', () => {
    assert.equal(transitionFor({ kind: 'failed', error: 'unreachable' }), 'retry');
  });

  it('NO VERDICT is a retry, never a success', () => {
    // Measured 2026-07-27: without FLAG_ENCRYPT_RESPONSE_BIT the car answers
    // status-only, so an accepted send and a refused one are byte-identical to
    // us. Calling that success is how a dropped destination looks like a
    // delivered one. Worst case here is a duplicate; the alternative is silence.
    assert.equal(transitionFor({ kind: 'unverified' }), 'retry');
  });
});
