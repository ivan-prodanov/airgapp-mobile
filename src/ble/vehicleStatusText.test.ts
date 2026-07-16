import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

import { relativeAge, vehicleStatusText, type VehicleStatusInput } from './vehicleStatusText.ts';

const S = 1000;
const M = 60 * S;
const H = 60 * M;
const D = 24 * H;

const base: VehicleStatusInput = {
  linked: true,
  connection: 'online',
  lastUpdatedAt: 1_000_000,
  awake: true,
  now: 1_000_000,
};

describe('relativeAge (moment fromNow parity)', () => {
  it('collapses anything under 45s to "a few seconds"', () => {
    assert.equal(relativeAge(0, false), 'a few seconds');
    assert.equal(relativeAge(44 * S, false), 'a few seconds');
  });

  it('crosses to "a minute" at 45s (moment rounds 45s -> 1 minute)', () => {
    assert.equal(relativeAge(45 * S, false), 'a minute');
    assert.equal(relativeAge(89 * S, false), 'a minute');
  });

  it('counts minutes from 90s up to the 45-minute threshold', () => {
    assert.equal(relativeAge(90 * S, false), '2 minutes');
    assert.equal(relativeAge(5 * M, false), '5 minutes');
    assert.equal(relativeAge(44 * M, false), '44 minutes');
  });

  it('crosses to "an hour" at 45 minutes', () => {
    assert.equal(relativeAge(45 * M, false), 'an hour');
    assert.equal(relativeAge(89 * M, false), 'an hour');
  });

  it('counts hours from 90 minutes up to the 22-hour threshold', () => {
    assert.equal(relativeAge(90 * M, false), '2 hours');
    assert.equal(relativeAge(2 * H, false), '2 hours');
    assert.equal(relativeAge(21 * H, false), '21 hours');
  });

  it('crosses to "a day" at 22 hours', () => {
    assert.equal(relativeAge(22 * H, false), 'a day');
    assert.equal(relativeAge(35 * H, false), 'a day');
  });

  it('counts days up to the 26-day threshold', () => {
    assert.equal(relativeAge(36 * H, false), '2 days');
    assert.equal(relativeAge(3 * D, false), '3 days');
    assert.equal(relativeAge(25 * D, false), '25 days');
  });

  it('crosses to months and years', () => {
    assert.equal(relativeAge(30 * D, false), 'a month');
    assert.equal(relativeAge(90 * D, false), '3 months');
    assert.equal(relativeAge(365 * D, false), 'a year');
    assert.equal(relativeAge(365 * 3 * D, false), '3 years');
  });

  it('appends "ago" only with the suffix (asleep uses fromNow(true) = no suffix)', () => {
    assert.equal(relativeAge(2 * H, true), '2 hours ago');
    assert.equal(relativeAge(2 * H, false), '2 hours');
  });

  it('never renders a negative age (clock skew reads as "a few seconds")', () => {
    assert.equal(relativeAge(-5 * M, false), 'a few seconds');
  });
});

describe('vehicleStatusText display rules', () => {
  it('shows "Connecting" WITH the spinner while undetermined', () => {
    assert.deepEqual(vehicleStatusText({ ...base, connection: 'connecting' }), {
      text: 'Connecting',
      spinner: true,
    });
  });

  it('treats "no contact yet" as undetermined, not offline', () => {
    // Before the first read there is no age to report, so the official app's
    // null fallback ("Connecting") applies rather than "Last seen …".
    assert.deepEqual(vehicleStatusText({ ...base, connection: 'offline', lastUpdatedAt: null }), {
      text: 'Connecting',
      spinner: true,
    });
  });

  it('shows a bare "Parked" when online and awake — no age, no spinner', () => {
    assert.deepEqual(vehicleStatusText(base), { text: 'Parked', spinner: false });
  });

  it('does NOT show an age while online, however stale the read', () => {
    const status = vehicleStatusText({ ...base, now: base.lastUpdatedAt! + 3 * H });
    assert.equal(status.text, 'Parked');
  });

  it('shows "Asleep {age}" with no "ago" when online but asleep', () => {
    const status = vehicleStatusText({
      ...base,
      awake: false,
      now: base.lastUpdatedAt! + 5 * M,
    });
    assert.deepEqual(status, { text: 'Asleep 5 minutes', spinner: false });
  });

  it('shows "Last seen {age} ago" when offline', () => {
    const status = vehicleStatusText({
      ...base,
      connection: 'offline',
      now: base.lastUpdatedAt! + 2 * H,
    });
    assert.deepEqual(status, { text: 'Last seen 2 hours ago', spinner: false });
  });

  it('never spins outside the Connecting state', () => {
    for (const connection of ['online', 'offline'] as const) {
      for (const awake of [true, false]) {
        const status = vehicleStatusText({ ...base, connection, awake, now: base.lastUpdatedAt! + M });
        assert.equal(status.spinner, false, `${connection}/awake=${awake} must not spin`);
      }
    }
  });

  it('never renders two facts at once (a status OR an age, never both)', () => {
    const parked = vehicleStatusText(base);
    assert.equal(/ago|Asleep/.test(parked.text!), false);
    const offline = vehicleStatusText({ ...base, connection: 'offline', now: base.lastUpdatedAt! + D });
    assert.equal(offline.text, 'Last seen a day ago');
  });

  it('keeps the demo copy for unlinked vehicles', () => {
    assert.deepEqual(vehicleStatusText({ ...base, linked: false }), { text: 'Parked', spinner: false });
    assert.deepEqual(vehicleStatusText({ ...base, linked: false, awake: false }), {
      text: 'Last seen 3 days ago',
      spinner: false,
    });
  });
});
