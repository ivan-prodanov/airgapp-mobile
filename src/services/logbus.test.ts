import assert from 'node:assert/strict';
import { afterEach, describe, it } from 'node:test';

import {
  __resetForTest,
  log,
  logi,
  setSink,
  snapshot,
  subscribe,
  timed,
  toJSONL,
  type LogEntry,
} from './logbus.ts';

let clock = 0;
const tick = (ms: number) => (clock += ms);

afterEach(() => __resetForTest());

describe('logbus ring', () => {
  it('records structured entries with monotonic seq + injected clock', () => {
    __resetForTest(() => clock);
    clock = 1000;
    logi('cmd', 'dispatch', { type: 'lock' });
    tick(5);
    logi('cmd', 'settle', { type: 'lock', ms: 5 });
    const s = snapshot();
    assert.equal(s.length, 2);
    assert.deepEqual(
      s.map((e) => [e.seq, e.t, e.cat, e.msg]),
      [
        [0, 1000, 'cmd', 'dispatch'],
        [1, 1005, 'cmd', 'settle'],
      ],
    );
    assert.deepEqual(s[0].data, { type: 'lock' });
  });

  it('caps the ring (a runaway logger can’t OOM the app)', () => {
    __resetForTest(() => clock);
    for (let i = 0; i < 5000; i++) log('debug', 'x', String(i));
    const s = snapshot();
    assert.equal(s.length, 4000, 'ring capped');
    // The oldest were dropped; the newest survive with their real seq.
    assert.equal(s[s.length - 1].msg, '4999');
    assert.equal(s[0].msg, '1000');
  });

  it('a throwing sink can never break the caller', () => {
    __resetForTest(() => clock);
    setSink(() => {
      throw new Error('disk full');
    });
    assert.doesNotThrow(() => logi('cmd', 'still works'));
    assert.equal(snapshot().length, 1);
  });

  it('backfills the sink with entries logged before it attached', () => {
    __resetForTest(() => clock);
    logi('boot', 'before sink');
    const got: LogEntry[] = [];
    setSink((e) => got.push(e));
    logi('boot', 'after sink');
    assert.deepEqual(got.map((e) => e.msg), ['before sink', 'after sink']);
  });

  it('level filtering drops below the threshold', async () => {
    const { setMinLevel } = await import('./logbus.ts');
    __resetForTest(() => clock);
    setMinLevel('warn');
    logi('cmd', 'info dropped');
    log('error', 'cmd', 'error kept');
    assert.deepEqual(snapshot().map((e) => e.msg), ['error kept']);
  });
});

describe('logbus subscribe', () => {
  it('notifies live and unsubscribes cleanly', () => {
    __resetForTest(() => clock);
    const got: string[] = [];
    const off = subscribe((e) => got.push(e.msg));
    logi('cmd', 'a');
    off();
    logi('cmd', 'b');
    assert.deepEqual(got, ['a']);
  });
});

describe('logbus timed', () => {
  it('logs duration + ok on success and returns the value', async () => {
    __resetForTest(() => clock);
    clock = 100;
    const out = await timed('ble', 'openSession', async () => {
      clock = 6100; // 6s scan
      return 'sid-1';
    });
    assert.equal(out, 'sid-1');
    const e = snapshot()[0];
    assert.equal(e.data?.ms, 6000);
    assert.equal(e.data?.ok, true);
  });

  it('logs ok:false + rethrows on failure', async () => {
    __resetForTest(() => clock);
    await assert.rejects(() =>
      timed('ble', 'openSession', async () => {
        throw new Error('scan timeout');
      }),
    );
    const e = snapshot()[0];
    assert.equal(e.data?.ok, false);
    assert.match(String(e.data?.err), /scan timeout/);
  });
});

describe('logbus export', () => {
  it('serialises to JSONL, one object per line', () => {
    __resetForTest(() => clock);
    logi('cmd', 'a', { x: 1 });
    logi('poll', 'b');
    const lines = toJSONL().split('\n');
    assert.equal(lines.length, 2);
    assert.deepEqual(JSON.parse(lines[0]).data, { x: 1 });
    assert.equal(JSON.parse(lines[1]).cat, 'poll');
  });
});
