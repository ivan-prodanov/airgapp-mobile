import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

import {
  classifyOrderProbe,
  classifyRouteStart,
  formatGateSnapshot,
  gateProbeVerdict,
  isGateOpen,
  metresBetween,
  samePlace,
  type GateSample,
  type RouteSample,
} from './navProbe.ts';

// Three points in Sofia, far enough apart that the 150 m same-place window can
// never confuse them (B↔A is ~1.5 km).
const B = { lat: 42.6977, lon: 23.3219 }; // the throwaway route's destination
const A = { lat: 42.7105, lon: 23.3219 }; // the stop we APPEND
const SNAPPED_B = { lat: 42.69775, lon: 23.32195 }; // B as the car reports it after snapping

const seated: GateSample = { shiftState: 'p', userPresent: true };
const empty: GateSample = { shiftState: 'p', userPresent: false };
const driving: GateSample = { shiftState: 'd', userPresent: false };

const route = (coordinates: typeof B | null, destination = 'Somewhere'): RouteSample => ({
  present: true,
  destination,
  coordinates,
});
const noRoute: RouteSample = { present: false, destination: null, coordinates: null };

describe('metresBetween / samePlace', () => {
  it('treats a car-side snap as the same place and a real second stop as different', () => {
    assert.ok(metresBetween(B, SNAPPED_B) < 10);
    assert.equal(samePlace(B, SNAPPED_B), true);
    assert.ok(metresBetween(B, A) > 1000);
    assert.equal(samePlace(B, A), false);
  });

  it('returns null when either side is missing rather than guessing', () => {
    assert.equal(samePlace(B, null), null);
    assert.equal(samePlace(null, null), null);
  });
});

describe('isGateOpen', () => {
  it('opens on driver present OR a driving gear, per RESPONSE-19 Blocker 3', () => {
    assert.equal(isGateOpen(seated), true);
    assert.equal(isGateOpen(driving), true);
    assert.equal(isGateOpen(empty), false);
    assert.equal(isGateOpen({ shiftState: 'unknown', userPresent: null }), false);
  });
});

describe('classifyOrderProbe — does f53/f106/f21 honour `order`?', () => {
  it('ORDER_HONOURED when the next stop is unchanged after the APPEND', () => {
    const r = classifyOrderProbe({
      before: route(B),
      after: route(SNAPPED_B),
      sent: A,
      gate: seated,
    });
    assert.equal(r.verdict, 'ORDER_HONOURED');
  });

  it('ORDER_DISCARDED when the appended stop becomes the next stop', () => {
    const r = classifyOrderProbe({
      before: route(B),
      after: route(A),
      sent: A,
      gate: seated,
    });
    assert.equal(r.verdict, 'ORDER_DISCARDED');
  });

  it('AMBIGUOUS when the two probe points are too close to separate', () => {
    // Setup error, not a firmware finding: the appended point IS the route's
    // destination, so "unchanged" and "became what we sent" are both true.
    const r = classifyOrderProbe({
      before: route(B),
      after: route(SNAPPED_B),
      sent: B,
      gate: seated,
    });
    assert.equal(r.verdict, 'AMBIGUOUS');
  });

  it('falls back to the destination NAME when no coordinate is reported', () => {
    const honoured = classifyOrderProbe({
      before: route(null, 'Vitosha Blvd'),
      after: route(null, 'Vitosha Blvd'),
      sent: A,
      gate: seated,
    });
    assert.equal(honoured.verdict, 'ORDER_HONOURED');
    assert.match(honoured.why, /name-only/);

    const discarded = classifyOrderProbe({
      before: route(null, 'Vitosha Blvd'),
      after: route(null, 'Ivan Vazov St'),
      sent: A,
      gate: seated,
    });
    assert.equal(discarded.verdict, 'ORDER_DISCARDED');
  });

  it('reports GATED rather than a verdict when nobody is in the car', () => {
    // The trap this probe exists to avoid: an absent route block read as "no
    // route" when it only means the gate is shut.
    const r = classifyOrderProbe({ before: noRoute, after: noRoute, sent: A, gate: empty });
    assert.equal(r.verdict, 'GATED');
  });

  it('NO_BASELINE when the gate is open and there genuinely was no route to append to', () => {
    const r = classifyOrderProbe({ before: noRoute, after: route(A), sent: A, gate: seated });
    assert.equal(r.verdict, 'NO_BASELINE');
  });

  it('ROUTE_LOST when a live route disappears across the send', () => {
    const r = classifyOrderProbe({ before: route(B), after: noRoute, sent: A, gate: seated });
    assert.equal(r.verdict, 'ROUTE_LOST');
  });
});

describe('classifyRouteStart — does f21 route, or only drop a pin?', () => {
  it('ROUTED when a route exists after a send that started from none', () => {
    const r = classifyRouteStart({ before: noRoute, after: route(A), gate: seated });
    assert.equal(r.verdict, 'ROUTED');
  });

  it('PIN_ONLY only when the gate is demonstrably open', () => {
    const r = classifyRouteStart({ before: noRoute, after: noRoute, gate: seated });
    assert.equal(r.verdict, 'PIN_ONLY');
  });

  it('GATED — the same reading with nobody present proves nothing', () => {
    const r = classifyRouteStart({ before: noRoute, after: noRoute, gate: empty });
    assert.equal(r.verdict, 'GATED');
  });

  it('ALREADY_ROUTING when a route was running before the send', () => {
    const r = classifyRouteStart({ before: route(B), after: route(A), gate: seated });
    assert.equal(r.verdict, 'ALREADY_ROUTING');
  });
});

describe('gate probe (NAV-P3)', () => {
  const rows = [
    { label: 'seated, route running', gate: seated, route: route(B, 'Home') },
    { label: 'exited, doors shut', gate: empty, route: noRoute },
  ];

  it('CONFIRMED when a running route vanishes with the gate shut', () => {
    assert.match(gateProbeVerdict(rows), /^CONFIRMED/);
  });

  it('NOT REPRODUCED when the fields survive an empty car', () => {
    const survived = [rows[0], { label: 'exited', gate: empty, route: route(B, 'Home') }];
    assert.match(gateProbeVerdict(survived), /^NOT REPRODUCED/);
  });

  it('CONTRADICTED when the fields vanish with the gate still open', () => {
    const odd = [rows[0], { label: 'seated again', gate: seated, route: noRoute }];
    assert.match(gateProbeVerdict(odd), /^CONTRADICTED/);
  });

  it('INCONCLUSIVE when no row ever saw a route', () => {
    const never = [{ label: 'exited', gate: empty, route: noRoute }];
    assert.match(gateProbeVerdict(never), /^INCONCLUSIVE/);
  });

  it('formats a row with every input the verdict depends on', () => {
    assert.equal(
      formatGateSnapshot(rows[0]),
      'seated, route running: shift=p user=present gate=OPEN → route PRESENT (Home)',
    );
    assert.equal(formatGateSnapshot(rows[1]), 'exited, doors shut: shift=p user=absent gate=SHUT → route ABSENT');
  });
});
