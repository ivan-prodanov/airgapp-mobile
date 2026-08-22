import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

// The twin of carLinkCacheCoverage.test.ts, for the OTHER half of the round trip.
//
// That test made SAVING non-optional: a telemetry field must be cached or excused. But there are two edits,
// not one — a field also has to be RESTORED on cold start (cacheToStatePatch), and for a long time it wasn't:
// ~half the cache was saved to disk and silently dropped on rehydrate, so sentry/valet/speed-limit/parental/
// low-power/keep-accessory and every climate toggle reverted to their initialVehicleState defaults (sentry off,
// speed limit "85 mph", Cabin Overheat "On, 40C") on every launch until the car was woken. Nothing failed when
// you forgot the restore side, exactly like the save side before its coverage test existed.
//
// So make the restore edit non-optional too: every CarLinkCache field must be applied by cacheToStatePatch or
// listed in NOT_REHYDRATED with a reason. Source-scanned (types are erased at runtime), same as the sibling test.

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const CACHE = path.join(__dirname, 'carLinkCache.ts');

// Fields declared on the CarLinkCache interface.
function cacheKeys(): string[] {
  const src = readFileSync(CACHE, 'utf8');
  const body = /export interface CarLinkCache \{([\s\S]*?)\n\}/.exec(src);
  assert.ok(body, 'could not find the CarLinkCache interface — did it get renamed?');
  return [...new Set([...body[1].matchAll(/^ {2}([A-Za-z_][A-Za-z0-9_]*)\??:/gm)].map((m) => m[1]))];
}

// Keys cacheToStatePatch applies onto the rehydrate patch — both the set('x') calls and any direct p.x = writes.
function rehydratedKeys(): string[] {
  const src = readFileSync(CACHE, 'utf8');
  const fn = /export function cacheToStatePatch\([\s\S]*?\n\}/.exec(src);
  assert.ok(fn, 'could not find cacheToStatePatch — did it get renamed?');
  const viaSet = [...fn[0].matchAll(/\bset\('([A-Za-z_][A-Za-z0-9_]*)'\)/g)].map((m) => m[1]);
  const viaAssign = [...fn[0].matchAll(/\bp\.([A-Za-z_][A-Za-z0-9_]*)\s*=/g)].map((m) => m[1]);
  return [...new Set([...viaSet, ...viaAssign])];
}

// Cache fields deliberately NOT applied to vehicle state on rehydrate, each with the reason.
const NOT_REHYDRATED: Record<string, string> = {
  lastVehicleDataAt:
    'NOT a VehicleViewState field — the header reads it directly via setLastVehicleDataAt, outside the patch.',
};

test('every cached field is restored on cold start (or explicitly excused)', () => {
  const applied = new Set(rehydratedKeys());
  const missing = cacheKeys().filter((k) => !applied.has(k) && !(k in NOT_REHYDRATED));
  assert.deepEqual(
    missing,
    [],
    `these CarLinkCache fields are saved but never restored on cold start (they will show the ` +
      `initialVehicleState default until the car is woken). Apply them in cacheToStatePatch in ` +
      `carLinkCache.ts, or add them to NOT_REHYDRATED with a reason:\n  ${missing.join('\n  ')}`,
  );
});

test('NOT_REHYDRATED does not rot: every excuse still names a real, un-rehydrated cache field', () => {
  const cached = new Set(cacheKeys());
  const applied = new Set(rehydratedKeys());
  for (const key of Object.keys(NOT_REHYDRATED)) {
    assert.ok(cached.has(key), `NOT_REHYDRATED lists "${key}", which is not a CarLinkCache field`);
    assert.ok(!applied.has(key), `"${key}" IS rehydrated now — remove its NOT_REHYDRATED entry`);
  }
});
