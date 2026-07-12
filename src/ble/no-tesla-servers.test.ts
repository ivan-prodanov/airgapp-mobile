// Safety guard (P1.T6, partial): the app must NEVER contact Tesla's real
// servers, only the RPi byte-forwarder. This scans every source file under
// src/ble/ for literals that would indicate a Tesla-server endpoint and
// fails the build if any appear. See src/ble/README.md and
// src/types/vehicleTypes.ts:210-221 for the full constraint.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readdirSync, readFileSync, statSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const BLE_DIR = __dirname;
const THIS_FILE = path.basename(fileURLToPath(import.meta.url));

const FORBIDDEN_LITERALS = ['tesla.com', 'tesla.cn', 'owner-api', 'owners-api', 'akamai'];

// Only scan source code, not documentation (README.md legitimately names
// these literals in prose, to document that this very guard forbids them)
// and not this guard's own file (whose source necessarily contains the
// literals as string constants).
const SCAN_EXTENSIONS = new Set(['.ts', '.tsx', '.js', '.jsx', '.mjs', '.cjs', '.json']);

// teslaHostGuard.ts is the ONE module allowed to know these hostnames — it
// owns the actual denylist (see its header comment) and spells them out
// plainly rather than via string-concatenation tricks, so its own test
// (which legitimately needs the same plain hostnames as test input) is
// excluded alongside it.
const EXCLUDED_FILES = new Set([THIS_FILE, 'teslaHostGuard.ts', 'teslaHostGuard.test.ts']);

function listFilesRecursive(dir: string): string[] {
  const out: string[] = [];
  for (const entry of readdirSync(dir)) {
    const full = path.join(dir, entry);
    const st = statSync(full);
    if (st.isDirectory()) {
      out.push(...listFilesRecursive(full));
    } else if (st.isFile()) {
      out.push(full);
    }
  }
  return out;
}

test('src/ble contains no Tesla-server literals (tesla.com, tesla.cn, owner-api, owners-api, akamai)', () => {
  const files = listFilesRecursive(BLE_DIR).filter((f) => {
    if (EXCLUDED_FILES.has(path.basename(f))) return false;
    return SCAN_EXTENSIONS.has(path.extname(f));
  });
  assert.ok(files.length > 0, 'expected to find files under src/ble');

  const offenders: { file: string; literal: string }[] = [];
  for (const file of files) {
    const contents = readFileSync(file, 'utf8').toLowerCase();
    for (const literal of FORBIDDEN_LITERALS) {
      if (contents.includes(literal)) {
        offenders.push({ file: path.relative(BLE_DIR, file), literal });
      }
    }
  }

  assert.deepEqual(
    offenders,
    [],
    `found forbidden Tesla-server literal(s) under src/ble: ${JSON.stringify(offenders)}`,
  );
});
