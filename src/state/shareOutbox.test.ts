import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

import {
  appendShare,
  forgetDelivered,
  isStale,
  makeItemId,
  markRejected,
  markSent,
  MAX_ITEMS,
  nextToSend,
  parseOutbox,
  recordFailure,
  serializeOutbox,
  STALE_AFTER_MS,
  type OutboxItem,
} from './shareOutbox.ts';

const NOW = 1_800_000_000_000;

const item = (over: Partial<OutboxItem> = {}): OutboxItem => ({
  id: 'a',
  ts: NOW,
  location: { lat: 42.6977, lng: 23.3219, name: 'Kaufland' },
  status: 'pending',
  attempts: 0,
  ...over,
});

describe('parseOutbox — reads a file another process wrote', () => {
  it('round-trips through serialize', () => {
    const items = [item(), item({ id: 'b', status: 'sent' })];
    assert.deepEqual(parseOutbox(serializeOutbox(items)), items);
  });

  it('returns empty for null, garbage, or a non-array', () => {
    assert.deepEqual(parseOutbox(null), []);
    assert.deepEqual(parseOutbox('not json {{'), []);
    assert.deepEqual(parseOutbox('{"not":"an array"}'), []);
  });

  it('drops ONLY the malformed entries, never the whole queue', () => {
    // Throwing here would strand every pending place behind one bad record —
    // written by a different process, possibly a different app version.
    const raw = JSON.stringify([
      item({ id: 'good' }),
      { id: 'no-coords', ts: NOW, location: {} },
      { ts: NOW, location: { lat: 1, lng: 2 } }, // no id
      null,
      'nonsense',
      item({ id: 'also-good' }),
    ]);
    assert.deepEqual(
      parseOutbox(raw).map((i) => i.id),
      ['good', 'also-good'],
    );
  });

  it('defaults an unknown status to pending rather than discarding the item', () => {
    const raw = JSON.stringify([{ id: 'x', ts: NOW, location: { lat: 1, lng: 2 }, status: 'weird' }]);
    assert.equal(parseOutbox(raw)[0].status, 'pending');
  });
});

describe('appendShare', () => {
  it('adds to the end', () => {
    assert.deepEqual(appendShare([item({ id: 'a' })], item({ id: 'b' })).map((i) => i.id), ['a', 'b']);
  });

  it('deduplicates on id so a retried write cannot double-queue a share', () => {
    const first = item({ id: 'dup', attempts: 3 });
    const retry = item({ id: 'dup', attempts: 0 });
    const out = appendShare([first], retry);
    assert.equal(out.length, 1);
    assert.equal(out[0].attempts, 0, 'the newer write wins');
  });

  it('caps the queue but never drops a PENDING item for a terminal one', () => {
    // A broken send path must not grow the file without bound, but the trim must
    // not throw away places still waiting to be delivered.
    const terminal = Array.from({ length: MAX_ITEMS }, (_, n) => item({ id: `old${n}`, status: 'sent' }));
    const out = appendShare(terminal, item({ id: 'fresh' }));
    assert.equal(out.length, MAX_ITEMS);
    assert.ok(
      out.some((i) => i.id === 'fresh'),
      'the new pending share survives',
    );
  });
});

describe('the core invariant: remove only on a confirmed accept', () => {
  it('markSent is the only transition that makes an item removable', () => {
    const items = [item({ id: 'a' })];
    assert.deepEqual(forgetDelivered(items, NOW), items, 'pending stays');
    assert.deepEqual(forgetDelivered(recordFailure(items, 'a', 'unreachable'), NOW).length, 1, 'a failure stays');
    assert.deepEqual(forgetDelivered(markRejected(items, 'a', 'no results'), NOW).length, 1, 'a rejection stays');
    assert.deepEqual(forgetDelivered(markSent(items, 'a'), NOW), [], 'only a confirmed send goes');
  });

  it('recordFailure keeps the item pending — these conditions clear on their own', () => {
    const out = recordFailure([item()], 'a', 'car unreachable');
    assert.equal(out[0].status, 'pending');
    assert.equal(out[0].attempts, 1);
    assert.equal(out[0].lastError, 'car unreachable');
    assert.equal(nextToSend(out, NOW).length, 1, 'still eligible for retry');
  });

  it('markRejected is terminal and carries the car’s own words', () => {
    const out = markRejected([item()], 'a', 'no results found');
    assert.equal(out[0].status, 'rejected');
    assert.equal(out[0].lastError, 'no results found');
    assert.equal(nextToSend(out, NOW).length, 0, 'a semantic refusal fails the same way forever');
  });

  it('a rejection is KEPT for the user to see, not silently dropped', () => {
    const out = forgetDelivered(markRejected([item()], 'a', 'no results found'), NOW);
    assert.equal(out.length, 1, 'a failed share must not become invisible');
  });
});

describe('staleness', () => {
  it('a week-old share is not sent verbatim', () => {
    const old = item({ ts: NOW - STALE_AFTER_MS - 1 });
    assert.equal(isStale(old, NOW), true);
    assert.equal(nextToSend([old], NOW).length, 0);
  });

  it('something shared a minute ago is fine', () => {
    assert.equal(isStale(item({ ts: NOW - 60_000 }), NOW), false);
  });

  it('an item with no timestamp is never treated as stale', () => {
    // ts 0 means "written by something that did not record it" — refusing to send
    // it would strand the place forever, which is the failure we care about most.
    assert.equal(isStale(item({ ts: 0 }), NOW), false);
    assert.equal(nextToSend([item({ ts: 0 })], NOW).length, 1);
  });

  it('forgetDelivered drops stale pending items but keeps stale rejections', () => {
    const stalePending = item({ id: 'p', ts: NOW - STALE_AFTER_MS - 1 });
    const staleRejected = item({ id: 'r', ts: NOW - STALE_AFTER_MS - 1, status: 'rejected' });
    assert.deepEqual(
      forgetDelivered([stalePending, staleRejected], NOW).map((i) => i.id),
      ['r'],
    );
  });
});

describe('nextToSend', () => {
  it('returns pending items oldest first', () => {
    const items = [item({ id: 'new', ts: NOW }), item({ id: 'old', ts: NOW - 1000 })];
    assert.deepEqual(nextToSend(items, NOW).map((i) => i.id), ['old', 'new']);
  });

  it('skips terminal statuses', () => {
    const items = [item({ id: 'a', status: 'sent' }), item({ id: 'b', status: 'rejected' }), item({ id: 'c' })];
    assert.deepEqual(nextToSend(items, NOW).map((i) => i.id), ['c']);
  });
});

describe('makeItemId', () => {
  it('is stable for the same share and distinct for different places', () => {
    assert.equal(makeItemId(NOW, 42.6977, 23.3219), makeItemId(NOW, 42.6977, 23.3219));
    assert.notEqual(makeItemId(NOW, 42.6977, 23.3219), makeItemId(NOW, 42.7105, 23.3219));
    assert.notEqual(makeItemId(NOW, 42.6977, 23.3219), makeItemId(NOW + 1, 42.6977, 23.3219));
  });
});
