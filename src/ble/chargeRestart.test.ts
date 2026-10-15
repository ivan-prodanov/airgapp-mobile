import { test } from 'node:test';
import assert from 'node:assert/strict';

import { chargingAlertInfo } from './chargingAlerts';
import { planAttempt, restartCharging, type ChargeRead, type ChargeRestartIo } from './chargeRestart';
import type { CarCommand } from './commands';
import type { ChargingAlertInfo } from '../types/vehicleTypes';

// A scripted car on a fake clock. `reads` is consulted by wall-clock: the read at time t
// returns the LAST script entry whose `at` <= t, so a scenario is written as a timeline.
function fakeIo(script: {
  reads: { at: number; read: Partial<ChargeRead> }[];
  alerts?: ChargingAlertInfo[] | (() => ChargingAlertInfo[]);
  reject?: Partial<Record<CarCommand['type'], string>>;
  onCommand?: (cmd: CarCommand, t: number) => void;
}) {
  let t = 0;
  const cmds: CarCommand[] = [];
  const phases: string[] = [];
  const base: ChargeRead = {
    chargingState: 'stopped',
    chargePortLatch: 'engaged',
    chargeCableUnlatched: false,
    chargerActualCurrentA: 0,
    chargingAmps: 16,
  };
  const io: ChargeRestartIo = {
    async runCommand(cmd) {
      cmds.push(cmd);
      script.onCommand?.(cmd, t);
      const why = script.reject?.[cmd.type];
      return why ? { ok: false, message: why } : { ok: true };
    },
    async readCharge() {
      const hit = [...script.reads].reverse().find((r) => r.at <= t);
      return { ...base, ...(hit?.read ?? {}) };
    },
    async readAlerts() {
      const a = script.alerts;
      return typeof a === 'function' ? a() : (a ?? []);
    },
    async sleep(ms, signal) {
      if (!signal?.aborted) t += ms;
    },
    now: () => t,
    log: () => {},
    onProgress: (p) => phases.push(p.phase),
  };
  return { io, cmds, phases, now: () => t };
}

const sec = (s: number) => s * 1000;

// Wrap readCharge so that `after` ms past the last chargeStart the car reports `live`.
function reportAfterStart(
  f: ReturnType<typeof fakeIo>,
  startedRef: { t: number },
  after: number,
  live: Partial<ChargeRead>,
) {
  const orig = f.io.readCharge;
  f.io.readCharge = async () => {
    const r = await orig();
    return startedRef.t >= 0 && f.now() >= startedRef.t + after ? { ...r, ...live } : r;
  };
}

test('already charging: no commands, ok', async () => {
  const f = fakeIo({ reads: [{ at: 0, read: { chargingState: 'charging', chargerActualCurrentA: 16 } }] });
  const r = await restartCharging(f.io);
  assert.equal(r.ok, true);
  assert.equal(r.reason, 'charging');
  assert.deepEqual(f.cmds, []);
});

test('no cable: refuses without commands', async () => {
  const f = fakeIo({ reads: [{ at: 0, read: { chargingState: 'disconnected' } }] });
  const r = await restartCharging(f.io);
  assert.equal(r.ok, false);
  assert.equal(r.reason, 'no-cable');
  assert.deepEqual(f.cmds, []);
});

test('first attempt succeeds: unlatch seen, 15s dwell, start, verified charging; no amps change', async () => {
  const started = { t: -1 };
  const f = fakeIo({
    reads: [
      { at: 0, read: {} },
      { at: sec(2.5), read: { chargePortLatch: 'disengaged', chargeCableUnlatched: true } },
    ],
    onCommand: (cmd, t) => {
      if (cmd.type === 'chargeStart') started.t = t;
    },
  });
  reportAfterStart(f, started, sec(6), { chargingState: 'charging', chargerActualCurrentA: 16, chargePortLatch: 'engaged' });
  const r = await restartCharging(f.io);
  assert.equal(r.ok, true);
  assert.equal(r.reason, 'charging');
  assert.equal(r.attempts, 1);
  assert.deepEqual(
    f.cmds.map((c) => c.type),
    ['openChargePort', 'chargeStart'],
  );
  assert.equal(r.ampsChangedTo, null);
  // one unlatch poll (2.5s) + the 15s dwell → start at 17.5s
  assert.equal(started.t, sec(17.5));
  assert.ok(f.phases.includes('unlatching') && f.phases.includes('waiting') && f.phases.includes('verifying'));
});

test('voltage-drop alert: amps stepped down on the FIRST attempt (16 → 11)', async () => {
  const started = { t: -1 };
  const f = fakeIo({
    reads: [{ at: 0, read: {} }],
    alerts: [chargingAlertInfo(93, 'warning')!],
    onCommand: (cmd, t) => {
      if (cmd.type === 'chargeStart') started.t = t;
    },
  });
  reportAfterStart(f, started, sec(3), { chargingState: 'charging', chargerActualCurrentA: 11 });
  const r = await restartCharging(f.io);
  assert.equal(r.ok, true);
  assert.deepEqual(
    f.cmds.map((c) => c.type),
    ['openChargePort', 'setChargingAmps', 'chargeStart'],
  );
  assert.equal((f.cmds[1] as { amps: number }).amps, 11);
  assert.equal(r.ampsChangedTo, 11);
  assert.equal(r.alertsBefore[0]?.name, 'PCS_A054_CHGINPUTVDROPTOOHIGH');
});

test('equipment alert: one plain attempt, then needs-charger', async () => {
  const f = fakeIo({ reads: [{ at: 0, read: {} }], alerts: [chargingAlertInfo(3, 'warning')!] });
  const r = await restartCharging(f.io);
  assert.equal(r.ok, false);
  assert.equal(r.reason, 'needs-charger');
  assert.equal(r.attempts, 1);
  assert.deepEqual(
    f.cmds.map((c) => c.type),
    ['openChargePort', 'chargeStart'],
  );
});

test('no alert, stops again every time: 3 attempts, amps lowered from attempt 2, dwell grows', async () => {
  const starts: number[] = [];
  const f = fakeIo({
    reads: [{ at: 0, read: {} }],
    onCommand: (cmd, t) => {
      if (cmd.type === 'chargeStart') starts.push(t);
    },
  });
  const orig = f.io.readCharge;
  // After each start: charging for 30s, then stopped again.
  f.io.readCharge = async () => {
    const r = await orig();
    const last = starts[starts.length - 1];
    if (last === undefined) return r;
    const dt = f.now() - last;
    return dt > 0 && dt <= sec(30)
      ? { ...r, chargingState: 'charging', chargerActualCurrentA: 16 }
      : { ...r, chargingState: 'stopped' };
  };
  const r = await restartCharging(f.io);
  assert.equal(r.ok, false);
  assert.equal(r.reason, 'stopped-again');
  assert.equal(r.attempts, 3);
  assert.deepEqual(
    f.cmds.map((c) => c.type),
    ['openChargePort', 'chargeStart', 'openChargePort', 'setChargingAmps', 'chargeStart', 'openChargePort', 'setChargingAmps', 'chargeStart'],
  );
  // 16 → 11 → 7 (floor(11 × 0.7)), never below 5
  assert.deepEqual(
    f.cmds.filter((c) => c.type === 'setChargingAmps').map((c) => (c as { amps: number }).amps),
    [11, 7],
  );
  assert.equal(starts.length, 3);
  const gap1 = starts[1] - starts[0];
  const gap2 = starts[2] - starts[1];
  // dwell 45s → 120s: the second gap is ~75s longer than the first
  assert.ok(gap2 - gap1 >= sec(72), `dwell should grow by ~75s (got ${gap2 - gap1})`);
});

test('abort during the dwell ends the run with aborted and sends no start', async () => {
  const ac = new AbortController();
  const f = fakeIo({ reads: [{ at: 0, read: {} }] });
  f.io.onProgress = (p) => {
    if (p.phase === 'waiting') ac.abort();
  };
  const r = await restartCharging(f.io, { signal: ac.signal });
  assert.equal(r.ok, false);
  assert.equal(r.reason, 'aborted');
  assert.deepEqual(
    f.cmds.map((c) => c.type),
    ['openChargePort'],
  );
});

test('unlatch never observed: proceeds anyway after the 15s cap', async () => {
  const started = { t: -1 };
  const f = fakeIo({
    reads: [{ at: 0, read: { chargePortLatch: 'engaged', chargeCableUnlatched: false } }],
    onCommand: (cmd, t) => {
      if (cmd.type === 'chargeStart') started.t = t;
    },
  });
  reportAfterStart(f, started, 1, { chargingState: 'charging', chargerActualCurrentA: 16 });
  const r = await restartCharging(f.io);
  assert.equal(r.ok, true);
  // 15s unlatch cap (6 polls of 2.5s) + 15s dwell
  assert.equal(started.t, sec(30));
});

test('start rejected by the car: attempt ends, next attempt still runs, reason start-rejected at the end', async () => {
  const f = fakeIo({ reads: [{ at: 0, read: {} }], reject: { chargeStart: 'is_charging' } });
  const r = await restartCharging(f.io);
  assert.equal(r.ok, false);
  assert.equal(r.reason, 'start-rejected');
  assert.equal(r.attempts, 3);
});

test('planAttempt: policy table', () => {
  assert.deepEqual(planAttempt(1, 'voltage-drop'), { dwellMs: sec(15), lowerAmps: true, maxAttempts: 3 });
  assert.deepEqual(planAttempt(1, 'thermal'), { dwellMs: sec(15), lowerAmps: false, maxAttempts: 3 });
  assert.deepEqual(planAttempt(2, 'thermal'), { dwellMs: sec(45), lowerAmps: true, maxAttempts: 3 });
  assert.deepEqual(planAttempt(2, 'replug'), { dwellMs: sec(45), lowerAmps: false, maxAttempts: 3 });
  assert.deepEqual(planAttempt(3, 'replug'), { dwellMs: sec(120), lowerAmps: true, maxAttempts: 3 });
  assert.deepEqual(planAttempt(1, 'equipment'), { dwellMs: sec(15), lowerAmps: false, maxAttempts: 1 });
  assert.deepEqual(planAttempt(1, 'dc'), { dwellMs: sec(15), lowerAmps: false, maxAttempts: 1 });
  assert.deepEqual(planAttempt(2, 'none'), { dwellMs: sec(45), lowerAmps: true, maxAttempts: 3 });
  assert.deepEqual(planAttempt(4, 'none'), { dwellMs: sec(120), lowerAmps: true, maxAttempts: 3 });
});
