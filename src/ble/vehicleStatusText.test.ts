import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

import { DATA_STALE_MS, relativeAge, vehicleStatusText, type VehicleStatusInput } from './vehicleStatusText.ts';

const S = 1000;
const M = 60 * S;
const H = 60 * M;
const D = 24 * H;

const NOW = 10_000_000;
const base: VehicleStatusInput = {
  linked: true,
  lastVehicleDataAt: NOW,
  awake: true,
  wakeInFlight: false,
  now: NOW,
};

// Data older than this age is stale; anything fresher is a live state.
const staleAt = (age: number): VehicleStatusInput => ({ ...base, lastVehicleDataAt: NOW - age, now: NOW });

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
    assert.equal(relativeAge(21 * H, false), '21 hours');
  });

  it('crosses to "a day" at 22 hours', () => {
    assert.equal(relativeAge(22 * H, false), 'a day');
    assert.equal(relativeAge(35 * H, false), 'a day');
  });

  it('counts days up to the 26-day threshold', () => {
    assert.equal(relativeAge(36 * H, false), '2 days');
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

describe('vehicleStatusText — live states (findings §A priorities 1-6)', () => {
  it('shows a bare "Parked" with no spinner while data is fresh', () => {
    assert.deepEqual(vehicleStatusText(base), { text: 'Parked', spinner: false, stale: false });
  });

  it('stays live right up to the 2-minute staleness threshold', () => {
    const status = vehicleStatusText(staleAt(DATA_STALE_MS - 1));
    assert.deepEqual(status, { text: 'Parked', spinner: false, stale: false });
  });

  it('never shows an age while live', () => {
    assert.equal(/ago|Asleep/.test(vehicleStatusText(staleAt(60 * S)).text!), false);
  });
});

describe('vehicleStatusText — the spinner gate (device-verified)', () => {
  // The gate is the wake, NOT staleness. This car is airgapped, so the official
  // app is permanently stale for it — if staleness drove the spinner it would
  // spin forever, and on the real app it does not.
  it('does NOT spin at rest, however stale the data', () => {
    for (const age of [DATA_STALE_MS, 10 * M, 5 * H, 30 * D]) {
      assert.equal(vehicleStatusText(staleAt(age)).spinner, false, `age=${age} must not spin at rest`);
    }
  });

  it('does NOT spin on a cold start — the bug the user reported', () => {
    // Opening the app is not a wake request: "Last seen 3 hours ago", no spinner.
    const status = vehicleStatusText(staleAt(3 * H));
    assert.deepEqual(status, { text: 'Last seen 3 hours ago', spinner: false, stale: true });
  });

  it('spins while a user-requested wake is in flight', () => {
    const status = vehicleStatusText({ ...staleAt(3 * H), wakeInFlight: true });
    assert.deepEqual(status, { text: 'Last seen 3 hours ago', spinner: true, stale: true });
  });

  it('spins alongside a LIVE state too — the spinner is a sibling of the text', () => {
    // findings §1's tree gates the spinner independently of the status string,
    // so a pull-to-refresh on a fresh car spins next to "Parked".
    assert.deepEqual(vehicleStatusText({ ...base, wakeInFlight: true }), {
      text: 'Parked',
      spinner: true,
      stale: false,
    });
  });

  it('never spins for a demo car — there is nothing to wait for', () => {
    assert.equal(vehicleStatusText({ ...base, linked: false, wakeInFlight: true }).spinner, false);
  });
});

describe('vehicleStatusText — the stale branch (findings §A priority 7)', () => {
  it('flips to the freshness string exactly AT the 2-minute threshold', () => {
    const status = vehicleStatusText(staleAt(DATA_STALE_MS));
    assert.deepEqual(status, { text: 'Last seen 2 minutes ago', spinner: false, stale: true });
  });

  it('renders the freshness string, not "Connecting" — the Round-2 bug this replaces', () => {
    const status = vehicleStatusText(staleAt(2 * H));
    assert.equal(status.text, 'Last seen 2 hours ago');
  });

  it('shows "Asleep {age}" and drops the "ago" suffix', () => {
    const status = vehicleStatusText({ ...staleAt(5 * M), awake: false });
    assert.deepEqual(status, { text: 'Asleep 5 minutes', spinner: false, stale: true });
  });

  it('reaches "Connecting" ONLY for a never-fetched vehicle', () => {
    assert.deepEqual(vehicleStatusText({ ...base, lastVehicleDataAt: null }), {
      text: 'Connecting',
      spinner: false,
      stale: true,
    });
  });

  it('COLD START: a previously-seen car reads "Last seen {age} ago", never "Connecting"', () => {
    // The user's ground-truth observation, and the bug that prompted Round 3:
    // rehydrating a cached timestamp must NOT render the never-fetched fallback.
    const status = vehicleStatusText(staleAt(3 * H));
    assert.equal(status.text, 'Last seen 3 hours ago');
    assert.notEqual(status.text, 'Connecting');
  });
});

describe('vehicleStatusText — demo vehicles', () => {
  it('keeps the showroom copy and never spins', () => {
    assert.deepEqual(vehicleStatusText({ ...base, linked: false }), {
      text: 'Parked',
      spinner: false,
      stale: false,
    });
    assert.deepEqual(vehicleStatusText({ ...base, linked: false, awake: false }), {
      text: 'Last seen 3 days ago',
      spinner: false,
      stale: false,
    });
    // The battery row must not dim for a demo car either.
    assert.equal(vehicleStatusText({ ...base, linked: false }).stale, false);
  });
});
