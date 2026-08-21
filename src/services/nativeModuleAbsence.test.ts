// Guards the invariant that keeps the app bootable on a platform a local Expo module
// does not implement.
//
// `requireNativeModule('X')` THROWS when X is absent. A module wrapper that uses it and
// has no Android implementation therefore throws at *import* time on Android — before
// first render, as an unrecoverable red box, with a message that names the module but not
// the importer. `requireOptionalNativeModule` returns null instead, so the wrapper's
// callers can degrade (searchProvider already catches and falls back to the offline
// gazetteer; every expo-passive-entry export already `?.`s and returns a default).
//
// This is a static check on the source rather than an import of the real modules: the
// node --test harness deliberately resolves no react-native/expo code (see
// scripts/test-asset-stub.cjs), so importing them here would fail for reasons unrelated
// to the invariant and give a false signal.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readdirSync, readFileSync, existsSync } from 'node:fs';
import { join } from 'node:path';

const MODULES_DIR = join(import.meta.dirname, '..', '..', 'modules');

/** Local Expo modules, paired with whether they ship an Android implementation. */
function localModules(): { name: string; hasAndroid: boolean; wrappers: string[] }[] {
  return readdirSync(MODULES_DIR, { withFileTypes: true })
    .filter((e) => e.isDirectory() && existsSync(join(MODULES_DIR, e.name, 'expo-module.config.json')))
    .map((e) => {
      const dir = join(MODULES_DIR, e.name);
      const srcDir = join(dir, 'src');
      const wrappers = existsSync(srcDir)
        ? readdirSync(srcDir)
            .filter((f) => f.endsWith('Module.ts'))
            .map((f) => join(srcDir, f))
        : [];
      return { name: e.name, hasAndroid: existsSync(join(dir, 'android')), wrappers };
    });
}

test('the module inventory is non-empty (guards against a silently vacuous test)', () => {
  const mods = localModules();
  assert.ok(mods.length >= 5, `expected >=5 local Expo modules, found ${mods.length}`);
  assert.ok(
    mods.every((m) => m.wrappers.length > 0),
    `modules with no *Module.ts wrapper: ${mods.filter((m) => !m.wrappers.length).map((m) => m.name).join(', ')}`,
  );
});

test('a module without an Android implementation must be required OPTIONALLY', () => {
  const offenders: string[] = [];
  for (const m of localModules()) {
    if (m.hasAndroid) continue;
    for (const w of m.wrappers) {
      const src = readFileSync(w, 'utf8');
      // Match the call, not the import line — `requireOptionalNativeModule` contains
      // `requireNativeModule` as a substring only in the non-optional spelling's absence,
      // so anchor on the opening paren.
      if (/(?<!Optional)requireNativeModule\s*[<(]/.test(src)) {
        offenders.push(`${m.name}/${w.split('/').pop()}`);
      }
    }
  }
  assert.deepEqual(
    offenders,
    [],
    `these wrappers throw at import time on Android — switch them to requireOptionalNativeModule: ${offenders.join(', ')}`,
  );
});

test('a module WITH an Android implementation may require it non-optionally', () => {
  // expo-godot-view implements both platforms, so a hard require is correct there — it
  // should fail loudly if the native side is genuinely missing rather than silently no-op.
  const godot = localModules().find((m) => m.name === 'expo-godot-view');
  assert.ok(godot, 'expo-godot-view not found');
  assert.equal(godot.hasAndroid, true, 'expo-godot-view lost its android/ implementation');
});
