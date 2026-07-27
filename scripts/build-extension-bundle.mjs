// Builds the JavaScript the Share Extension runs inside JavaScriptCore.
//
// One self-contained IIFE, no imports, no module system — JSC gets a string and
// evaluates it. The bundle installs `airgappSendNavigation` on the global object;
// Swift calls that and nothing else.
//
// Run: node scripts/build-extension-bundle.mjs
// Output: modules/shared-intake/ios/AirgappEngine.js  (compiled into the
// extension as a bundle resource — see the extension's Copy Bundle Resources)
//
// ── Why platform=neutral ──
//
// Not 'node' and not 'browser': JSC in an app extension has neither. Anything the
// bundle assumes about its host is a runtime crash in a process with no debugger
// attached, so the build is configured to assume nothing and the four host
// symbols are injected explicitly (see extensionEntry.ts).
//
// ── The check below is not decoration ──
//
// This project has shipped `Buffer.from` into Hermes before and the node tests
// passed, because node HAS Buffer. The same trap applies here with more force:
// JSC lacks Buffer, has no fetch, no process, no require, and an extension has no
// console to find out from.
//
// Grepping the output for those names does NOT work — protobufjs feature-DETECTS
// them behind `typeof global !== "undefined"` guards and falls back correctly, so
// a textual match flags working code. The only honest test is to run the bundle
// somewhere those globals genuinely do not exist, which is what the VM check
// below does: a bare context with nothing but what Swift will actually inject.

import { build } from 'esbuild';
import { readFileSync, writeFileSync } from 'node:fs';
import vm from 'node:vm';

const OUT = 'modules/shared-intake/ios/AirgappEngine.js';

const result = await build({
  entryPoints: ['src/ble/extensionEntry.ts'],
  bundle: true,
  format: 'iife',
  platform: 'neutral',
  target: 'es2020',
  outfile: OUT,
  // Keep it readable: this runs where no debugger can attach, so a stack trace in
  // a log line is the only diagnostic available.
  minify: false,
  legalComments: 'none',
  logLevel: 'warning',
});

if (result.warnings.length) {
  for (const w of result.warnings) console.warn('warning:', w.text);
}

const code = readFileSync(OUT, 'utf8');

// Evaluate the bundle in a context that has NOTHING node provides — no Buffer, no
// process, no require, no fetch, no console — and only the symbols Swift will
// inject. If it survives this, its host assumptions are ones JSC can meet.
const sandbox = {
  // TextDecoder/TextEncoder are DELIBERATELY absent here. protobufjs uses them
  // unguarded and throws at load without them, so the bundle polyfills them
  // itself — and this check only proves that if the sandbox genuinely lacks them.
  // Adding them back would make the check pass for the wrong reason.
  //
  // setTimeout/clearTimeout ARE here because Swift installs them: JSC has no
  // event loop, and a timer cannot be polyfilled without a clock and a run loop.
  // The sandbox must mirror what the host provides — no more, no less.
  setTimeout,
  clearTimeout,
  // The one host symbol the engine genuinely requires. Swift backs this with
  // SecRandomCopyBytes; here it only has to be present and fill the array.
  crypto: {
    getRandomValues(arr) {
      for (let i = 0; i < arr.length; i += 1) arr[i] = (i * 7 + 11) % 256;
      return arr;
    },
  },
  // The transport HANGS rather than failing fast.
  //
  // It used to throw immediately, and that is precisely why this check shipped a
  // bundle that died on the device with "Can't find variable: setTimeout": the
  // engine gave up before it ever armed a timeout, so the timer code — the code
  // that needed a host global we had not installed — never ran. The check
  // reported a clean pass on a send that had exercised almost nothing.
  //
  // A transport that never settles forces the engine down its timeout path, which
  // is where the host contract is actually used.
  __openSession: () => new Promise(() => {}),
  __exchange: () => new Promise(() => {}),
  __closeSession: async () => {},
};
sandbox.globalThis = sandbox;

try {
  vm.createContext(sandbox);
  vm.runInContext(code, sandbox, { timeout: 10_000 });
} catch (err) {
  console.error('\nREFUSING TO SHIP: the bundle threw while LOADING in a bare context.');
  console.error('It depends on a host global JavaScriptCore will not provide.\n');
  console.error(err);
  process.exit(1);
}

if (typeof sandbox.airgappSendNavigation !== 'function') {
  console.error('\nREFUSING TO SHIP: the bundle did not install airgappSendNavigation.');
  console.error('That is the only symbol Swift calls; without it the extension can do nothing.\n');
  process.exit(1);
}

// Drive it once end to end. The transport never settles, so the engine must arm
// and fire its own timeout to finish at all — exercising the host globals a
// fast-failing stub would skip. A well-formed 'failed' verdict then proves the
// crypto, protobuf, gateway AND timer paths all ran under host-only globals.
const raw = await Promise.race([
  sandbox.airgappSendNavigation(
    JSON.stringify({ vin: '5YJ3E1EA7KF000316', lat: 42.6977, lon: 23.3219, privateScalarHex: 'a'.repeat(64) }),
  ),
  new Promise((_, rej) =>
    setTimeout(() => rej(new Error('the engine never settled — its own timeout did not fire')), 120_000),
  ),
]);
const parsed = JSON.parse(raw);
if (parsed.ok !== false || parsed.verdict !== 'failed') {
  console.error('\nREFUSING TO SHIP: the bundle ran but did not behave as expected.');
  console.error('Expected a clean {ok:false, verdict:"failed"} after the engine timed out. Got:', parsed);
  process.exit(1);
}
console.log(`  timeout path exercised — engine settled on its own: ${parsed.reason ?? parsed.verdict}`);

writeFileSync(
  OUT,
  `// GENERATED by scripts/build-extension-bundle.mjs — do not edit.\n` +
    `// Source: src/ble/extensionEntry.ts (and everything it imports).\n` +
    `// Runs in JavaScriptCore inside the Share Extension. See extensionEntry.ts\n` +
    `// for the symbols the Swift host must inject.\n${code}`,
);

console.log(`built ${OUT} — ${(code.length / 1024).toFixed(0)} KB, loads and runs in a bare context`);
