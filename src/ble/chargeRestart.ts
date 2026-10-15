// chargeRestart — the software re-plug.
//
// What a hand does at the car: unlock the port, pull the cable, push it back. What this
// does from the couch: unlatch (VCSEC), wait, ask for charging again (which re-engages the
// latch), and WATCH the charge state long enough to know it stuck — the app's plain Start
// was accepted by the car every time and still reverted after ~30 s, so acceptance proves
// nothing; only a sustained Charging read does.
//
// It plans around the car's own fault name (VehicleData.alert_state → chargingAlerts):
//   voltage-drop  lower the current from the first attempt (V = I·R on the house wiring)
//   thermal/other/none  plain cycle first, lower current from the second
//   replug/power  plain cycles, lower current only as a last resort
//   equipment/dc  one plain attempt, then stop: the car cannot clear those
//
// PURE: every side effect is injected (ChargeRestartIo), every duration is an option, so
// the tests run the whole state machine on a fake clock. No RN imports.

import type { CarCommand } from './commands';
import { primaryChargingAlert } from './chargingAlerts';
import type { ChargePortLatch, ChargingAlertFamily, ChargingAlertInfo } from '../types/vehicleTypes';

export interface ChargeRead {
  // ChargingState name, lower-cased ('charging' | 'stopped' | 'starting' | 'nopower' | …) or null.
  chargingState: string | null;
  chargePortLatch: ChargePortLatch | null;
  chargeCableUnlatched: boolean | null;
  chargerActualCurrentA: number | null;
  chargingAmps: number | null;
}

export type ChargeRestartPhase =
  | 'reading'
  | 'unlatching'
  | 'waiting'
  | 'lowering-amps'
  | 'starting'
  | 'verifying'
  | 'done';

export interface ChargeRestartProgress {
  attempt: number;
  maxAttempts: number;
  phase: ChargeRestartPhase;
  // Wall-clock (io.now() units) when the current timed phase ends, for a countdown. null = untimed.
  untilMs: number | null;
}

export interface ChargeRestartIo {
  runCommand(cmd: CarCommand): Promise<{ ok: boolean; message?: string }>;
  readCharge(): Promise<ChargeRead>;
  // [] when the car reports none. Must not throw for "unsupported" — return [].
  readAlerts(): Promise<ChargingAlertInfo[]>;
  // Resolves after `ms`, or EARLY when `signal` aborts.
  sleep(ms: number, signal?: AbortSignal): Promise<void>;
  now(): number;
  log(step: string, data?: Record<string, string | number | boolean>): void;
  onProgress?(p: ChargeRestartProgress): void;
}

export interface ChargeRestartOptions {
  signal?: AbortSignal;
  maxAttempts?: number;
  dwellMs?: readonly number[];
  unlatchTimeoutMs?: number;
  unlatchPollMs?: number;
  verifyMs?: number;
  verifyPollMs?: number;
  startGraceMs?: number;
  minAmps?: number;
  ampsFactor?: number;
}

export const CHARGE_RESTART_DEFAULTS = Object.freeze({
  maxAttempts: 3,
  // Attempt 1 / 2 / 3. The first is the manual re-plug's own pace; the later ones give a
  // hot plug or a tripped supply time to recover before we ask again.
  dwellMs: [15_000, 45_000, 120_000] as readonly number[],
  unlatchTimeoutMs: 15_000,
  unlatchPollMs: 2_500,
  // Past the ~30 s window in which the plain Start reverted, with margin.
  verifyMs: 90_000,
  verifyPollMs: 3_000,
  // The car's own state lags a start request; a Stopped read inside this window is stale.
  startGraceMs: 20_000,
  // Tesla's floor is 5 A.
  minAmps: 5,
  ampsFactor: 0.7,
});

export type ChargeRestartReason =
  | 'charging'
  | 'complete'
  | 'aborted'
  | 'start-rejected'
  | 'stopped-again'
  | 'never-started'
  | 'needs-charger'
  | 'no-cable'
  | 'read-failed';

export interface ChargeRestartResult {
  ok: boolean;
  reason: ChargeRestartReason;
  attempts: number;
  alertsBefore: ChargingAlertInfo[];
  alertsAfter: ChargingAlertInfo[];
  ampsChangedTo: number | null;
  finalState: ChargeRead | null;
  trace: string[];
}

// The live view of a run, for the UI. Lives here (not in the hook) so the pure text
// helpers can type against it without importing React Native.
export interface ChargeRestartStatus {
  running: boolean;
  attempt: number;
  maxAttempts: number;
  phase: ChargeRestartPhase | null;
  // Date.now() when the timed phase ends; null when untimed.
  untilMs: number | null;
  startedAt: number | null;
  // The last run's verdict, kept until the next run starts.
  result: ChargeRestartResult | null;
}

export const IDLE_CHARGE_RESTART: ChargeRestartStatus = Object.freeze({
  running: false,
  attempt: 0,
  maxAttempts: 0,
  phase: null,
  untilMs: null,
  startedAt: null,
  result: null,
});

type Family = ChargingAlertFamily | 'none';

// Attempts allowed per family; absent = the option's maxAttempts.
const MAX_ATTEMPTS_BY_FAMILY: Partial<Record<Family, number>> = { equipment: 1, dc: 1 };
// First attempt (1-based) on which the current is stepped down.
const LOWER_AMPS_FROM: Record<Family, number> = {
  'voltage-drop': 1,
  thermal: 2,
  other: 2,
  none: 2,
  replug: 3,
  power: 3,
  info: Number.POSITIVE_INFINITY,
  equipment: Number.POSITIVE_INFINITY,
  dc: Number.POSITIVE_INFINITY,
};

export function planAttempt(
  attempt: number,
  family: Family,
  opts: Pick<ChargeRestartOptions, 'maxAttempts' | 'dwellMs'> = {},
): { dwellMs: number; lowerAmps: boolean; maxAttempts: number } {
  const maxAttempts = Math.min(
    opts.maxAttempts ?? CHARGE_RESTART_DEFAULTS.maxAttempts,
    MAX_ATTEMPTS_BY_FAMILY[family] ?? Number.POSITIVE_INFINITY,
  );
  const dwells = opts.dwellMs ?? CHARGE_RESTART_DEFAULTS.dwellMs;
  const dwellMs = dwells[Math.min(Math.max(attempt, 1), dwells.length) - 1];
  return { dwellMs, lowerAmps: attempt >= LOWER_AMPS_FROM[family], maxAttempts };
}

const isCharging = (r: ChargeRead | null) => r?.chargingState === 'charging';
const isPlugged = (r: ChargeRead | null) => {
  const s = r?.chargingState;
  return s !== null && s !== undefined && s !== '' && s !== 'disconnected' && s !== 'unknown';
};
const familyOf = (alerts: readonly ChargingAlertInfo[]): Family => primaryChargingAlert(alerts)?.family ?? 'none';
const names = (alerts: readonly ChargingAlertInfo[]) => alerts.map((a) => a.name).join(',') || '-';

export async function restartCharging(io: ChargeRestartIo, o: ChargeRestartOptions = {}): Promise<ChargeRestartResult> {
  const opts = { ...CHARGE_RESTART_DEFAULTS, ...o };
  const signal = o.signal;
  const trace: string[] = [];
  const say = (step: string, data?: Record<string, string | number | boolean>) => {
    trace.push(data ? `${step} ${JSON.stringify(data)}` : step);
    io.log(step, data);
  };
  const aborted = () => signal?.aborted === true;
  const progress = (attempt: number, maxAttempts: number, phase: ChargeRestartPhase, untilMs: number | null = null) =>
    io.onProgress?.({ attempt, maxAttempts, phase, untilMs });
  const safeAlerts = async (): Promise<ChargingAlertInfo[]> => {
    try {
      return await io.readAlerts();
    } catch (e) {
      say('alerts read failed', { error: e instanceof Error ? e.message : String(e) });
      return [];
    }
  };

  let attempt = 0;
  let alertsBefore: ChargingAlertInfo[] = [];
  let alertsAfter: ChargingAlertInfo[] = [];
  let ampsChangedTo: number | null = null;
  let last: ChargeRead | null = null;
  const done = (ok: boolean, reason: ChargeRestartReason): ChargeRestartResult => {
    progress(attempt, opts.maxAttempts, 'done');
    say('result', { ok, reason, attempts: attempt });
    return { ok, reason, attempts: attempt, alertsBefore, alertsAfter, ampsChangedTo, finalState: last, trace };
  };

  progress(0, opts.maxAttempts, 'reading');
  alertsBefore = await safeAlerts();
  try {
    last = await io.readCharge();
  } catch (e) {
    say('charge read failed', { error: e instanceof Error ? e.message : String(e) });
    return done(false, 'read-failed');
  }
  say('before', {
    state: last.chargingState ?? '-',
    latch: last.chargePortLatch ?? '-',
    cableUnlatched: String(last.chargeCableUnlatched),
    amps: last.chargingAmps ?? -1,
    alerts: names(alertsBefore),
  });
  if (isCharging(last)) return done(true, 'charging');
  if (!isPlugged(last)) return done(false, 'no-cable');

  let family = familyOf(alertsBefore);
  let lastReason: ChargeRestartReason = 'never-started';

  for (;;) {
    const plan = planAttempt(attempt + 1, family, opts);
    if (attempt >= plan.maxAttempts) {
      return done(false, plan.maxAttempts < opts.maxAttempts ? 'needs-charger' : lastReason);
    }
    attempt += 1;
    if (aborted()) return done(false, 'aborted');
    say('attempt', { attempt, family, dwellMs: plan.dwellMs, lowerAmps: plan.lowerAmps });

    // 1. Unlatch — the same VCSEC action as the Unlock Charge Port button.
    progress(attempt, plan.maxAttempts, 'unlatching', io.now() + opts.unlatchTimeoutMs);
    const un = await io.runCommand({ type: 'openChargePort' });
    say('unlatch', { ok: un.ok, message: un.message ?? '' });
    if (aborted()) return done(false, 'aborted');
    const unlatchDeadline = io.now() + opts.unlatchTimeoutMs;
    let unlatched = false;
    while (io.now() < unlatchDeadline) {
      await io.sleep(opts.unlatchPollMs, signal);
      if (aborted()) return done(false, 'aborted');
      try {
        last = await io.readCharge();
      } catch {
        continue;
      }
      if (last.chargePortLatch === 'disengaged' || last.chargeCableUnlatched === true) {
        unlatched = true;
        break;
      }
    }
    say('unlatched', {
      seen: unlatched,
      latch: last?.chargePortLatch ?? '-',
      cableUnlatched: String(last?.chargeCableUnlatched),
    });

    // 2. Dwell — the pause a hand takes between pulling and pushing, longer each attempt.
    progress(attempt, plan.maxAttempts, 'waiting', io.now() + plan.dwellMs);
    await io.sleep(plan.dwellMs, signal);
    if (aborted()) return done(false, 'aborted');

    // 3. Current step-down when the plan says so. Never raised back; the result reports it.
    // Basis = the LOWER of what the car reports and what we already set: the ChargeState
    // slice does not carry the amps setting, so a read can lag our own step-down.
    const reported = last?.chargingAmps ?? null;
    const amps = ampsChangedTo !== null ? Math.min(ampsChangedTo, reported ?? ampsChangedTo) : reported;
    if (plan.lowerAmps && amps !== null && amps > opts.minAmps) {
      const target = Math.max(opts.minAmps, Math.floor(amps * opts.ampsFactor));
      if (target < amps) {
        progress(attempt, plan.maxAttempts, 'lowering-amps');
        const r = await io.runCommand({ type: 'setChargingAmps', amps: target });
        say('amps', { from: amps, to: target, ok: r.ok, message: r.message ?? '' });
        if (r.ok) {
          ampsChangedTo = target;
          if (last) last = { ...last, chargingAmps: target };
        }
        if (aborted()) return done(false, 'aborted');
      }
    }

    // 4. Ask for charging — this is what re-engages the latch.
    progress(attempt, plan.maxAttempts, 'starting');
    const st = await io.runCommand({ type: 'chargeStart' });
    say('start', { ok: st.ok, message: st.message ?? '' });
    let verdict: 'charging' | 'complete' | 'stopped' | 'never' | 'rejected' = st.ok ? 'never' : 'rejected';

    // 5. Verify — watch it past the window the plain Start used to revert in.
    if (st.ok) {
      const t0 = io.now();
      progress(attempt, plan.maxAttempts, 'verifying', t0 + opts.verifyMs);
      let sawLive = false;
      while (io.now() - t0 < opts.verifyMs) {
        await io.sleep(opts.verifyPollMs, signal);
        if (aborted()) return done(false, 'aborted');
        try {
          last = await io.readCharge();
        } catch {
          continue;
        }
        const s = last.chargingState;
        if (s === 'charging' || s === 'starting') sawLive = true;
        if (s === 'complete') {
          verdict = 'complete';
          break;
        }
        if ((s === 'stopped' || s === 'nopower') && (sawLive || io.now() - t0 >= opts.startGraceMs)) {
          verdict = 'stopped';
          break;
        }
      }
      if (verdict === 'never' && isCharging(last)) verdict = 'charging';
      say('verify', {
        verdict,
        state: last?.chargingState ?? '-',
        currentA: last?.chargerActualCurrentA ?? -1,
        latch: last?.chargePortLatch ?? '-',
        ms: io.now() - t0,
      });
      if (verdict === 'charging' || verdict === 'complete') return done(true, verdict);
    }

    // Failed attempt: ask the car why, re-plan around the newest alert.
    alertsAfter = await safeAlerts();
    say('after', { alerts: names(alertsAfter) });
    const next = familyOf(alertsAfter);
    if (next !== 'none') family = next;
    lastReason = verdict === 'rejected' ? 'start-rejected' : verdict === 'stopped' ? 'stopped-again' : 'never-started';
  }
}
