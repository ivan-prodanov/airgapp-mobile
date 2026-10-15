import { test } from 'node:test';
import assert from 'node:assert/strict';

import { CHARGING_ALERT_TABLE } from './chargingAlertTable';
import { alertFamily, chargingAlertInfo, parseChargingAlerts, primaryChargingAlert } from './chargingAlerts';

test('table: every named enum value (129), unique numbers and names, Tesla text on each, no INVALID row', () => {
  assert.equal(CHARGING_ALERT_TABLE.length, 129);
  assert.equal(new Set(CHARGING_ALERT_TABLE.map((r) => r.n)).size, 129);
  assert.equal(new Set(CHARGING_ALERT_TABLE.map((r) => r.name)).size, 129);
  assert.ok(!CHARGING_ALERT_TABLE.some((r) => r.n === 0));
  assert.ok(CHARGING_ALERT_TABLE.every((r) => r.title.length > 0 && r.subtitle.length > 0 && !/^Charging alert /.test(r.title)));
});

test('parse: numeric enum from a decoded AlertState → Tesla title/remedy, family, kind', () => {
  const [a] = parseChargingAlerts({ chargingAlerts: [{ alertName: 93, alertType: 1 }] });
  assert.equal(a.name, 'PCS_A054_CHGINPUTVDROPTOOHIGH');
  assert.equal(a.title, 'Charging stopped due to large voltage drop');
  assert.equal(a.subtitle, 'Remove extension cords / Have wiring inspected');
  assert.equal(a.family, 'voltage-drop');
  assert.equal(a.kind, 'warning');
});

test('parse: string enum names (toObject-style) are accepted too', () => {
  const [a] = parseChargingAlerts({ chargingAlerts: [{ alertName: 'UMC_A002_GFCITRIPPED', alertType: 'NOTIFICATION' }] });
  assert.equal(a.n, 112);
  assert.equal(a.family, 'replug');
  assert.equal(a.kind, 'notification');
});

test('parse: unknown numbers are kept (never dropped), INVALID(0) and junk are dropped, duplicates collapse', () => {
  const list = parseChargingAlerts({
    chargingAlerts: [{ alertName: 999, alertType: 1 }, { alertName: 0 }, { alertName: 999 }, null, 'x'],
  });
  assert.equal(list.length, 1);
  assert.equal(list[0].name, 'ALERT_999');
  assert.equal(list[0].family, 'other');
  assert.deepEqual(parseChargingAlerts(undefined), []);
  assert.deepEqual(parseChargingAlerts({}), []);
});

test('family: keyed on the remedy wording', () => {
  assert.equal(chargingAlertInfo(110)?.family, 'replug'); // PCS2_A116 Unable to AC charge - Unplug and retry
  assert.equal(chargingAlertInfo(1)?.family, 'info'); // BMS_A007 battery heating, rate will increase
  assert.equal(chargingAlertInfo(13)?.family, 'replug'); // CC_A011 too hot — "Let Wall Connector cool and try again"
  assert.equal(chargingAlertInfo(118)?.family, 'thermal'); // UMC_A008 wall plug temperature high
  assert.equal(chargingAlertInfo(88)?.family, 'power'); // PCS_A017 power lost while charging
  assert.equal(chargingAlertInfo(3)?.family, 'equipment'); // CC_A001 insufficient grounding
  assert.equal(chargingAlertInfo(44)?.family, 'dc'); // CP_A062 Supercharger stall out of service
  assert.equal(alertFamily({ title: 'x', subtitle: 'y' }), 'other');
});

test('primary: first non-info alert, warnings first; null when only info', () => {
  const info = chargingAlertInfo(1, 'notification')!;
  const warn = chargingAlertInfo(93, 'warning')!;
  const note = chargingAlertInfo(112, 'notification')!;
  assert.equal(primaryChargingAlert([info, note, warn])?.name, warn.name);
  assert.equal(primaryChargingAlert([info]), null);
  assert.equal(primaryChargingAlert([]), null);
});
