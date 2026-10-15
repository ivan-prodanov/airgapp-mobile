import { test } from 'node:test';
import assert from 'node:assert/strict';

import { chargingAlertInfo } from '../ble/chargingAlerts';
import { alertCardText, chargeRestartPhaseText, shouldShowChargingAlertCard } from './chargingAlertCardText';

test("card text leads with the car's alert, falls back to the charging state", () => {
  const t = alertCardText([chargingAlertInfo(93, 'warning')!], 'Stopped');
  assert.equal(t.title, 'Charging stopped due to large voltage drop');
  assert.equal(t.body, 'Remove extension cords / Have wiring inspected');
  assert.equal(t.warning, true);
  const s = alertCardText([], 'Stopped');
  assert.equal(s.title, 'Charging Stopped');
  assert.equal(s.warning, false);
  assert.equal(alertCardText([], 'NoPower').title, 'Charging Error - No Power');
});

test('card shows only with a cable and a stop or an actionable alert', () => {
  assert.equal(shouldShowChargingAlertCard(true, 'Stopped', []), true);
  assert.equal(shouldShowChargingAlertCard(true, 'Charging', []), false);
  assert.equal(shouldShowChargingAlertCard(true, 'Charging', [chargingAlertInfo(93, 'warning')!]), true);
  assert.equal(shouldShowChargingAlertCard(true, 'Charging', [chargingAlertInfo(1, 'notification')!]), false); // info only
  assert.equal(shouldShowChargingAlertCard(false, 'Stopped', [chargingAlertInfo(93, 'warning')!]), false);
});

test('phase text counts down the timed phases', () => {
  const base = { running: true, attempt: 2, maxAttempts: 3 };
  assert.equal(chargeRestartPhaseText({ ...base, phase: 'waiting', untilMs: 46_000 }, 1_000), 'Attempt 2 of 3 · waiting 45 s');
  assert.equal(chargeRestartPhaseText({ ...base, phase: 'verifying', untilMs: 90_000 }, 30_000), 'Attempt 2 of 3 · verifying 60 s');
  assert.equal(chargeRestartPhaseText({ ...base, phase: 'unlatching', untilMs: null }, 0), 'Attempt 2 of 3 · unlatching');
  assert.equal(chargeRestartPhaseText({ ...base, phase: 'reading', attempt: 0, untilMs: null }, 0), 'Reading the fault');
  assert.equal(chargeRestartPhaseText({ ...base, running: false, phase: 'done', untilMs: null }, 0), null);
});
