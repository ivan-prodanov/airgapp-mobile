import test from 'node:test';
import assert from 'node:assert/strict';

import {
  describeVdsFrame,
  isSubscriptionPush,
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

// from_destination { domain: n }
const from = (domain: number): number[] => lenDelim(7, scalar(2, domain));
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

test('a domain-3 frame WITHOUT request_uuid is a push; with one it is a reply', () => {
  const push = describeVdsFrame(frame(from(3), payload(scalar(1, 1))), 0);
  const reply = describeVdsFrame(frame(from(3), payload(scalar(1, 1)), requestUuid()), 0);
  assert.equal(isSubscriptionPush(push), true);
  // The subscribe ACK itself comes from domain 3 — counting it as a push would
  // manufacture a false positive on the one question the probe exists to answer.
  assert.equal(isSubscriptionPush(reply), false);
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

test('report: domain-3 pushes after the baseline boundary → PUSHES', () => {
  const r = buildVdsReport({
    observations: [obs(1000, 2), obs(16_000, 3), obs(21_000, 3)],
    baselineEndMs: 15_000,
    subscribeOutcome: 'ok',
    subscribeResponseHex: null,
    windowEndMs: 75_000,
  });
  assert.equal(r.verdict, 'PUSHES');
  assert.equal(r.domain3Pushes, 2);
  assert.equal(r.baselineFrames, 1);
});

test('report: traffic but no domain-3 pushes → NO_PUSHES (a real, trustworthy negative)', () => {
  const r = buildVdsReport({
    observations: [obs(1000, 2), obs(16_000, 2), obs(20_000, 3, true)],
    baselineEndMs: 15_000,
    subscribeOutcome: 'ok',
    subscribeResponseHex: 'aa bb',
    windowEndMs: 75_000,
  });
  assert.equal(r.verdict, 'NO_PUSHES');
  assert.equal(r.domain3Pushes, 0);
  assert.equal(r.windowFrames, 2, 'the domain-3 REPLY still counts as traffic, just not as a push');
});

test('report: a totally silent link is INCONCLUSIVE, never a negative', () => {
  // The distinction that keeps this experiment honest: no frames at all means
  // the link was dead, which says nothing about subscriptions.
  const r = buildVdsReport({
    observations: [],
    baselineEndMs: 15_000,
    subscribeOutcome: 'ok',
    subscribeResponseHex: null,
    windowEndMs: 75_000,
  });
  assert.equal(r.verdict, 'INCONCLUSIVE');
  assert.match(r.lines.join('\n'), /no car-initiated frames at all/);
});

test('report: baseline traffic that STOPS after subscribing is still NO_PUSHES, not INCONCLUSIVE', () => {
  const r = buildVdsReport({
    observations: [obs(1000, 2), obs(9000, 2)],
    baselineEndMs: 15_000,
    subscribeOutcome: 'ok',
    subscribeResponseHex: null,
    windowEndMs: 75_000,
  });
  assert.equal(r.verdict, 'NO_PUSHES');
  assert.equal(r.baselineFrames, 2);
  assert.equal(r.windowFrames, 0);
});

test('report prints raw hex for pushes so a positive can be decoded afterwards', () => {
  const r = buildVdsReport({
    observations: [{ ...obs(20_000, 3), hex: 'de ad be ef' }],
    baselineEndMs: 15_000,
    subscribeOutcome: 'ok',
    subscribeResponseHex: null,
    windowEndMs: 75_000,
  });
  assert.match(r.lines.join('\n'), /de ad be ef/);
});
