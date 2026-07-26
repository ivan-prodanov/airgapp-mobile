import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

import {
  formatRouteDelta,
  formatRouteRead,
  metresBetween,
  parseCoord,
  type RouteRead,
} from './navBench.ts';

const read = (over: Partial<RouteRead> = {}): RouteRead => ({
  present: true,
  destination: 'Keros Blue',
  coordinates: { lat: 42.6977, lon: 23.3219 },
  minutesToArrival: 12,
  milesToArrival: 4.5,
  shiftState: 'P',
  userPresent: true,
  sleepStatus: 'awake',
  readError: null,
  ...over,
});

describe('parseCoord', () => {
  it('accepts a well-formed pair with surrounding space', () => {
    assert.deepEqual(parseCoord(' 42.6977 , 23.3219 '), { lat: 42.6977, lon: 23.3219 });
  });

  it('rejects anything that would be sent to the car as a bogus destination', () => {
    assert.equal(parseCoord('42.6977'), null); // one component
    assert.equal(parseCoord('42.6977,23.3219,1'), null); // three
    assert.equal(parseCoord('north,east'), null); // not numbers
    assert.equal(parseCoord('91,23'), null); // latitude out of range
    assert.equal(parseCoord('42,181'), null); // longitude out of range
    assert.equal(parseCoord(''), null);
  });
});

describe('metresBetween', () => {
  it('measures a real separation between two probe points', () => {
    const d = metresBetween({ lat: 42.6977, lon: 23.3219 }, { lat: 42.7105, lon: 23.3219 });
    assert.ok(d > 1400 && d < 1500, `expected ~1.42 km, got ${d}`);
  });

  it('is zero for the same point', () => {
    assert.equal(Math.round(metresBetween({ lat: 42.6977, lon: 23.3219 }, { lat: 42.6977, lon: 23.3219 })), 0);
  });
});

describe('formatRouteRead', () => {
  it('states destination, coordinate, ETA and the gate inputs', () => {
    assert.equal(
      formatRouteRead(read()),
      'ROUTE: "Keros Blue" @ 42.69770,23.32190 (12min 4.5mi) | shift=P driver=yes car=awake',
    );
  });

  it('distinguishes an unreadable DriveState from a car with no route', () => {
    assert.equal(
      formatRouteRead(read({ present: false, readError: 'car asleep', sleepStatus: 'asleep', userPresent: false })),
      'ROUTE: UNREADABLE (car asleep) | shift=P driver=no car=asleep',
    );
  });

  it('says the fields are ABSENT rather than claiming there is no route', () => {
    // The distinction the whole gate question turns on: an absent block is not
    // the same claim as "the car is not navigating".
    assert.equal(
      formatRouteRead(read({ present: false, userPresent: false })),
      'ROUTE: none (no active-route fields in the reply) | shift=P driver=no car=awake',
    );
  });

  it('renders unknown presence and a missing coordinate without inventing either', () => {
    const line = formatRouteRead(read({ userPresent: null, coordinates: null, minutesToArrival: null, milesToArrival: null }));
    assert.equal(line, 'ROUTE: "Keros Blue" @ no coord | shift=P driver=? car=awake');
  });
});

describe('formatRouteDelta', () => {
  it('reports movement in metres and whether the name changed', () => {
    const delta = formatRouteDelta(read(), read({ coordinates: { lat: 42.7105, lon: 23.3219 }, destination: 'Elsewhere' }));
    assert.match(delta, /next stop moved 14\d\d m/);
    assert.match(delta, /name "Keros Blue" → "Elsewhere"/);
  });

  it('reports zero movement as zero — never as a verdict about `order`', () => {
    const delta = formatRouteDelta(read(), read());
    assert.equal(delta, 'DELTA: next stop moved 0 m; name unchanged ("Keros Blue")');
  });

  it('calls out a route appearing or disappearing across two reads', () => {
    assert.match(formatRouteDelta(read({ present: false }), read()), /route APPEARED/);
    assert.match(formatRouteDelta(read(), read({ present: false })), /route DISAPPEARED/);
  });

  it('has nothing to compare on the first read', () => {
    assert.match(formatRouteDelta(null, read()), /first read this session/);
  });

  it('refuses to compare against an unreadable side rather than inventing a change', () => {
    // The sleep test's normal outcome: DriveState faults on a sleeping car. That
    // must not read as "the route disappeared".
    const asleep = read({ present: false, readError: 'car asleep', sleepStatus: 'asleep' });
    assert.match(formatRouteDelta(read(), asleep), /not comparable — this read failed/);
    assert.match(formatRouteDelta(asleep, read()), /not comparable — the previous read failed/);
  });
});
