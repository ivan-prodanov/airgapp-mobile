// Pure text for the ChargingAlertCard, kept out of the component so it runs under node.
import type { ChargeRestartStatus } from '../ble/chargeRestart';
import { primaryChargingAlert } from '../ble/chargingAlerts';
import type { ChargingAlertInfo } from '../types/vehicleTypes';
import { chargingStateText } from './chargeText';

// The card leads with the car's own alert (Tesla's title + remedy line); without one it
// names the charging state and says what Restart will do.
export function alertCardText(
  alerts: readonly ChargingAlertInfo[],
  chargingState: string | null,
): { title: string; body: string; warning: boolean } {
  const a = primaryChargingAlert(alerts);
  if (a) return { title: a.title, body: a.subtitle, warning: a.kind === 'warning' };
  return {
    title: chargingStateText(chargingState) ?? 'Charging Stopped',
    body: 'Restart from here: the app unlatches the cable, waits, starts again and checks that it sticks.',
    warning: false,
  };
}

// Tesla's ChargingAlerts row shows whenever the car reports an alert; ours also shows for a
// plain Stopped/NoPower (the car may not name the fault), and never without a cable.
export function shouldShowChargingAlertCard(
  cableAttached: boolean,
  chargingState: string | null,
  alerts: readonly ChargingAlertInfo[],
): boolean {
  if (!cableAttached) return false;
  const s = (chargingState ?? '').toLowerCase();
  return s === 'stopped' || s === 'nopower' || primaryChargingAlert(alerts) !== null;
}

const PHASE_WORD: Record<string, string> = {
  unlatching: 'unlatching',
  waiting: 'waiting',
  'lowering-amps': 'lowering the current',
  starting: 'starting',
  verifying: 'verifying',
};

// One line of progress while a restart runs; null when idle.
export function chargeRestartPhaseText(
  s: Pick<ChargeRestartStatus, 'running' | 'attempt' | 'maxAttempts' | 'phase' | 'untilMs'>,
  now: number,
): string | null {
  if (!s.running || !s.phase || s.phase === 'done') return null;
  if (s.phase === 'reading') return 'Reading the fault';
  const word = PHASE_WORD[s.phase] ?? s.phase;
  const left = s.untilMs !== null ? Math.max(0, Math.round((s.untilMs - now) / 1000)) : null;
  const timed = left !== null && (s.phase === 'waiting' || s.phase === 'verifying') ? ` ${left} s` : '';
  return `Attempt ${s.attempt} of ${s.maxAttempts} · ${word}${timed}`;
}
