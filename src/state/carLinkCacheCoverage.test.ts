import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

// Why this file exists.
//
// carLinkCache.ts states its own rule, in its own comments: "anything rendered
// from telemetry belongs in this cache." That rule has now been broken by
// omission three separate times, each caught by Ivan on the device rather than
// by anything in the repo:
//
//   • carLocation  — on relaunch the map fell back to the USER's position and
//                    only jumped to the car after a pull-to-refresh.
//   • tirePressures — em dashes until the car was woken. Caught "immediately",
//                    one day after carLocation, on the very next field added.
//   • the climate toggles — Cabin Overheat Protection asserted "On, 40°C" on
//                    every cold start regardless of the car.
//
// The rule was written down all three times. Writing it down is evidently not
// the control; the failure mode is that adding a telemetry field and adding a
// cache field are two separate edits, and the second is easy to forget because
// nothing fails when you do.
//
// So: make the second edit non-optional. Every key telemetry writes must appear
// EITHER in CarLinkCache or in NOT_CACHED below with a reason. A new telemetry
// field fails this test until someone makes that choice deliberately.
//
// Source-scanned rather than type-derived because TypeScript types are erased at
// runtime — there is no object to walk. Same approach as no-tesla-servers.test.ts
// and for the same reason: the invariant lives in source text, so check the text.

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const TELEMETRY = path.join(__dirname, '..', 'ble', 'telemetry.ts');
const CACHE = path.join(__dirname, 'carLinkCache.ts');

// Keys telemetry assigns onto the patch it hands to the store — i.e. everything
// we learn from the car.
function telemetryKeys(): string[] {
  const src = readFileSync(TELEMETRY, 'utf8');
  return [...new Set([...src.matchAll(/\bpatch\.([A-Za-z_][A-Za-z0-9_]*)\s*=/g)].map((m) => m[1]))];
}

// Fields declared on the CarLinkCache interface.
function cacheKeys(): string[] {
  const src = readFileSync(CACHE, 'utf8');
  const body = /export interface CarLinkCache \{([\s\S]*?)\n\}/.exec(src);
  assert.ok(body, 'could not find the CarLinkCache interface — did it get renamed?');
  return [...new Set([...body[1].matchAll(/^ {2}([A-Za-z_][A-Za-z0-9_]*)\??:/gm)].map((m) => m[1]))];
}

// Telemetry-derived fields we deliberately do NOT persist, each with the reason.
//
// The test does not judge which side is right — it only insists the choice was
// made. Two genuinely different categories are in here, and they are labelled
// so the second does not quietly disguise itself as the first:
//
//   VOLATILE — a stale value would be actively WRONG, not merely old. These
//   should never be cached.
//
//   GAP — steady-state values that a cold start should arguably show dimmed,
//   exactly like the battery percentage next to them. Not yet done. Listing
//   them here is the point: the backlog is visible instead of invisible.
const NOT_CACHED: Record<string, string> = {
  // ── VOLATILE ──────────────────────────────────────────────────────────────
  speed: 'VOLATILE: a cached "45 mph" on a cold start is a lie, not a stale truth.',
  powerKw: 'VOLATILE: instantaneous draw; meaningless once the app is closed.',
  driving: 'VOLATILE: claiming the car is driving because it was an hour ago is worse than blank.',
  gear: 'VOLATILE: moves with `driving`; same reasoning.',
  userPresent: 'VOLATILE: whether someone is in the car right now.',
  centerDisplay: 'VOLATILE: screen on/off state of the car this second.',
  activeRoute: 'VOLATILE: a finished route rendered as active would misroute the user.',

};

test('every telemetry-written field is either cached or explicitly excused', () => {
  const cached = new Set(cacheKeys());
  const unaccounted = telemetryKeys().filter((k) => !cached.has(k) && !(k in NOT_CACHED));

  assert.deepEqual(
    unaccounted,
    [],
    `New telemetry field(s) with no cache decision: ${unaccounted.join(', ')}.\n` +
      `Either add them to CarLinkCache (and to cacheInfotainment + the seed object in\n` +
      `useCarLink.ts, or they will silently never persist), or add them to NOT_CACHED\n` +
      `in this file with a reason. This is the check that carLocation, tirePressures\n` +
      `and the climate toggles each needed and did not have.`,
  );
});

test('NOT_CACHED does not rot: every excuse still names a real telemetry field', () => {
  // The mirror failure. If a field is cached later, or renamed, or stops being
  // written, its excuse must go — otherwise the list drifts into a graveyard
  // that excuses fields nobody writes any more, and the next real omission hides
  // among them.
  const telemetry = new Set(telemetryKeys());
  const cached = new Set(cacheKeys());
  for (const key of Object.keys(NOT_CACHED)) {
    assert.ok(telemetry.has(key), `NOT_CACHED lists "${key}", which telemetry no longer writes`);
    assert.ok(!cached.has(key), `"${key}" IS cached now — remove its NOT_CACHED entry`);
  }
});

test('the extractors actually find something (a silently-empty scan would pass everything)', () => {
  // Both checks above are satisfied by an empty set, so a regex that quietly
  // stops matching — a rename of `patch`, a reformat of the interface — would
  // turn this file into a no-op that still reports green. Pin the shape.
  const tel = telemetryKeys();
  const cache = cacheKeys();
  assert.ok(tel.length > 30, `telemetry scan found only ${tel.length} keys — extractor broken?`);
  assert.ok(cache.length > 20, `cache scan found only ${cache.length} keys — extractor broken?`);
  // Spot-check one key from each of the three incidents that motivated this file.
  for (const k of ['carLocation', 'tirePressures', 'cabinOverheatMode']) {
    assert.ok(tel.includes(k), `telemetry scan missed ${k}`);
    assert.ok(cache.includes(k), `cache scan missed ${k}`);
  }
});
