import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join } from 'node:path';

import { sfToTesla, SF_NAMES_IN_USE } from './sfFallback';
import ICONS from './teslaIcons.json';
import EXTRA from './extraGlyphs.json';
import VEHICLE from './teslaVehicleGlyphs.json';

const GLYPHS = new Set([...Object.keys(ICONS), ...Object.keys(EXTRA), ...Object.keys(VEHICLE)]);

test('every SF symbol the app used maps to a glyph that actually exists', () => {
  const unmapped = SF_NAMES_IN_USE.filter((sf) => {
    const t = sfToTesla(sf);
    return !t || !GLYPHS.has(t);
  });
  assert.deepEqual(unmapped, [], `SF symbols with a missing or bogus target: ${unmapped.join(', ')}`);
});

test('an unknown SF name maps to null rather than throwing', () => {
  assert.equal(sfToTesla('definitely.not.a.symbol'), null);
});

test('the chevron rotation convention is degrees clockwise from up', () => {
  // Guards against a silent left/right flip if the mapping is ever edited. Verified
  // against the path data: chevron-270's apex is at x≈7.8 (left), chevron-90's at
  // x≈16.2 (right).
  assert.equal(sfToTesla('chevron.left'), 'chevron-270');
  assert.equal(sfToTesla('chevron.right'), 'chevron-90');
  assert.equal(sfToTesla('chevron.up'), 'chevron-0');
  assert.equal(sfToTesla('chevron.down'), 'chevron-180');
});

// ── The lasting guard: SF Symbols must not come back ──────────────────────────────
//
// expo-symbols is iOS-only and fails SILENTLY on Android — no warning, no red box, the
// icon simply does not draw. A regression is therefore invisible in CI and easy to miss
// in review, so it gets a structural test rather than a convention.

const SRC = join(import.meta.dirname, '..');

function tsxFiles(dir: string, out: string[] = []): string[] {
  for (const e of readdirSync(dir)) {
    const p = join(dir, e);
    if (statSync(p).isDirectory()) tsxFiles(p, out);
    else if (p.endsWith('.tsx') || p.endsWith('.ts')) out.push(p);
  }
  return out;
}

test('no source file imports expo-symbols or renders SymbolView', () => {
  const offenders = tsxFiles(SRC)
    .filter((f) => !f.endsWith('sfFallback.ts') && !f.endsWith('sfFallback.test.ts'))
    .filter((f) => {
      const s = readFileSync(f, 'utf8');
      return /from 'expo-symbols'|<SymbolView/.test(s);
    })
    .map((f) => f.slice(SRC.length + 1));

  assert.deepEqual(
    offenders,
    [],
    `expo-symbols is iOS-only and renders nothing on Android — use <AppIcon>/<TeslaIcon>: ${offenders.join(', ')}`,
  );
});
