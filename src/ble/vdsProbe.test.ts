import test from 'node:test';
import assert from 'node:assert/strict';

import {
  describeVdsFrame,
  isSubscriptionPush,
  medianIntervalMs,
  cadenceMatches,
  buildVdsReport,
  armVdsCapture,
  disarmVdsCapture,
  observeVdsFrame,
  isVdsCaptureArmed,
  type VdsObservation,
} from './vdsProbe';

// Hand-built RoutableMessage frames. Built by hand rather than through protobufjs
// on purpose: the probe's whole job is to classify frames we may have no proto
// for, so its tests must not be able to lean on one.
const varint = (n: number): number[] => {
  const out: number[] = [];
  let v = n;
  do {
    let b = v & 0x7f;
    v >>>= 7;
    if (v > 0) b |= 0x80;
    out.push(b);
  } while (v > 0);
  return out;
};
const lenDelim = (field: number, body: number[]): number[] => [
  ...varint((field << 3) | 2),
  ...varint(body.length),
  ...body,
];
const scalar = (field: number, value: number): number[] => [...varint(field << 3), ...varint(value)];

// from_destination { domain: n }. Domain is field 1 — the oneof arm. Field 2 is
// routing_address, and reading THAT is what made run 1 misreport every frame.
const from = (domain: number): number[] => lenDelim(7, scalar(1, domain));
const payload = (body: number[]): number[] => lenDelim(10, body);
const requestUuid = (): number[] => lenDelim(50, new Array(16).fill(0xab));
const flags = (n: number): number[] => scalar(52, n);

const frame = (...parts: number[][]): Uint8Array => Uint8Array.from(parts.flat());

test('describeVdsFrame reads domain, request_uuid presence and flags off a routable', () => {
  const f = frame(from(3), payload(scalar(1, 7)), flags(2));
  const o = describeVdsFrame(f, 1234);
  assert.equal(o.fromDomain, 3);
  assert.equal(o.hasRequestUuid, false);
  assert.equal(o.flags, 2);
  assert.deepEqual(o.innerFields, [1]);
  assert.equal(o.atMs, 1234);
  assert.equal(o.byteLen, f.length);
});

test('domain-3 frames count as pushes whether or not they echo a request_uuid', () => {
  // Both shapes are pushes. See the REGRESSION test below for why the uuid must
  // NOT be used to exclude: RESPONSE-15 makes it the subscription's correlation
  // tag, so a working subscription is expected to echo it on every push.
  const noUuid = describeVdsFrame(frame(from(3), payload(scalar(1, 1))), 0);
  const withUuid = describeVdsFrame(frame(from(3), payload(scalar(1, 1)), requestUuid()), 0);
  assert.equal(isSubscriptionPush(noUuid), true);
  assert.equal(isSubscriptionPush(withUuid), true);
  assert.equal(withUuid.hasRequestUuid, true, 'still recorded, just not disqualifying');
});

test('a VCSEC status push (domain 2) is NOT counted, though the car sends them unprompted', () => {
  // This is the confound the baseline window exists for: these arrive whether or
  // not anything is subscribed, so counting them would make every run positive.
  const vcsec = describeVdsFrame(frame(from(2), payload(scalar(1, 1))), 0);
  assert.equal(vcsec.fromDomain, 2);
  assert.equal(isSubscriptionPush(vcsec), false);
});

test('describeVdsFrame never throws on garbage, and still reports the byte count', () => {
  // "Arrived but unparseable" must stay distinguishable from "did not arrive".
  const junk = Uint8Array.from([0xff, 0xff, 0xff, 0x07, 0x00, 0x99]);
  const o = describeVdsFrame(junk, 5);
  assert.equal(o.byteLen, 6);
  assert.equal(o.fromDomain, null);
  assert.equal(isSubscriptionPush(o), false);
});

test('truncated length-delimited field does not over-read past the buffer', () => {
  // Claims 200 bytes of from_destination in a 4-byte frame.
  const o = describeVdsFrame(Uint8Array.from([0x3a, 0xc8, 0x01, 0x00]), 0);
  assert.equal(o.fromDomain, null);
});

test('capture tap is inert until armed, and records relative timestamps once it is', () => {
  assert.equal(isVdsCaptureArmed(), false);
  observeVdsFrame(frame(from(3)), 1000); // dropped — not armed
  armVdsCapture(1000);
  assert.equal(isVdsCaptureArmed(), true);
  observeVdsFrame(frame(from(3), payload(scalar(1, 1))), 3500);
  const got = disarmVdsCapture();
  assert.equal(got.length, 1);
  assert.equal(got[0].atMs, 2500, 'timestamps are relative to arming');
  assert.equal(isVdsCaptureArmed(), false);
  assert.equal(disarmVdsCapture().length, 0, 'disarm clears the buffer');
});

const obs = (atMs: number, domain: number | null, hasUuid = false): VdsObservation => ({
  atMs,
  byteLen: 20,
  fromDomain: domain,
  hasRequestUuid: hasUuid,
  flags: 2,
  innerFields: [1],
  hex: '00',
});

const win = (label: string, startMs: number, endMs: number, requestedRateMs: number) => ({
  label,
  startMs,
  endMs,
  requestedRateMs,
  subscribeOutcome: 'ok',
  subscribeResponseHex: null,
});

// Frames at a fixed cadence inside a window — the shape a working subscription
// produces, and the shape run 1 actually saw.
const train = (from: number, to: number, everyMs: number, domain = 3, hasUuid = true): VdsObservation[] => {
  const out: VdsObservation[] = [];
  for (let t = from; t < to; t += everyMs) out.push(obs(t, domain, hasUuid));
  return out;
};

test('REGRESSION: a domain-3 frame carrying a request_uuid IS a push', () => {
  // Run 1's predicate excluded these, so nine 5-second frames were reported as
  // "no pushes". RESPONSE-15 states the request_uuid is the subscription's
  // CORRELATION TAG, so echoing it is expected — and the subscribe ACK never
  // reaches this path anyway (the gateway's correlator consumes it).
  assert.equal(isSubscriptionPush(obs(0, 3, true)), true);
  assert.equal(isSubscriptionPush(obs(0, 3, false)), true);
  assert.equal(isSubscriptionPush(obs(0, 2, false)), false, 'VCSEC pushes still excluded');
});

test('REGRESSION: from_destination.domain is field 1 (the oneof arm), not field 2', () => {
  // Reading field 2 (routing_address, length-delimited) yielded null for every
  // frame in run 1, which the report rendered as `domain=?` and then counted as
  // "not a push". This asserts against the real wire layout.
  const f = frame(from(3), payload(scalar(1, 1)));
  assert.equal(describeVdsFrame(f, 0).fromDomain, 3);
});

test('medianIntervalMs is robust to one late frame', () => {
  assert.equal(medianIntervalMs([obs(0, 3), obs(5000, 3), obs(10_000, 3), obs(23_000, 3)]), 5000);
  assert.equal(medianIntervalMs([obs(0, 3)]), null, 'one frame has no interval');
  assert.equal(medianIntervalMs([]), null);
});

test('cadenceMatches is loose enough for BLE jitter but still discriminates', () => {
  assert.equal(cadenceMatches(5000, 5000), true);
  assert.equal(cadenceMatches(4700, 5000), true, 'observed 4.7s against a 5s request');
  assert.equal(cadenceMatches(5000, 2000), false, 'a 5s cadence does not answer a 2s request');
  assert.equal(cadenceMatches(null, 5000), false);
});

test('rate sweep: cadence tracking BOTH requested rates → PUSHES', () => {
  // The decisive shape. Nothing else on the link follows a parameter we chose.
  const r = buildVdsReport({
    observations: [...train(15_000, 45_000, 5000), ...train(45_000, 75_000, 2000)],
    baselineEndMs: 15_000,
    windows: [win('5000ms', 15_000, 45_000, 5000), win('2000ms', 45_000, 75_000, 2000)],
  });
  assert.equal(r.verdict, 'PUSHES');
  assert.match(r.lines.join('\n'), /TRACKS the requested rate/);
});

test('rate sweep: frames at a FIXED cadence regardless of the request → INCONCLUSIVE, not PUSHES', () => {
  // The confound that run 1 could not rule out: something ticking at 5s on its
  // own would look identical in a single-window run. Here the second window asks
  // for 2000ms and still gets 5000ms, so the frames are NOT ours.
  const r = buildVdsReport({
    observations: [...train(15_000, 45_000, 5000), ...train(45_000, 75_000, 5000)],
    baselineEndMs: 15_000,
    windows: [win('5000ms', 15_000, 45_000, 5000), win('2000ms', 45_000, 75_000, 2000)],
  });
  assert.equal(r.verdict, 'INCONCLUSIVE');
  assert.match(r.lines.join('\n'), /did not clearly track/);
});

test('rate sweep: only domain-2 traffic → NO_PUSHES', () => {
  const r = buildVdsReport({
    observations: train(15_000, 45_000, 5000, 2),
    baselineEndMs: 15_000,
    windows: [win('5000ms', 15_000, 45_000, 5000), win('2000ms', 45_000, 75_000, 2000)],
  });
  assert.equal(r.verdict, 'NO_PUSHES');
});

test('rate sweep: a totally silent link is INCONCLUSIVE, never a negative', () => {
  const r = buildVdsReport({
    observations: [],
    baselineEndMs: 15_000,
    windows: [win('5000ms', 15_000, 45_000, 5000), win('2000ms', 45_000, 75_000, 2000)],
  });
  assert.equal(r.verdict, 'INCONCLUSIVE');
  assert.match(r.lines.join('\n'), /no car-initiated frames at all/);
});

test('REGRESSION: raw hex is printed for EVERY window frame, not only classified pushes', () => {
  // Run 1 gated the hex dump on the predicate it was testing, so when the
  // predicate turned out to be wrong there were no bytes left to re-examine.
  const r = buildVdsReport({
    observations: [{ ...obs(20_000, 2), hex: 'de ad be ef' }],
    baselineEndMs: 15_000,
    windows: [win('5000ms', 15_000, 45_000, 5000)],
  });
  assert.match(r.lines.join('\n'), /de ad be ef/, 'a NON-push frame must still show its bytes');
});
