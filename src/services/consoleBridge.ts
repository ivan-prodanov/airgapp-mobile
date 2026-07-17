import { log } from './logbus';

// Mirror console.warn / console.error / console.log into logbus, so the many
// existing `console.warn('[ble] …')` sites across the frozen core are captured
// in the pulled log WITHOUT editing those files. Keeps the originals intact (so
// a Metro/dev console still shows them), and never recurses.

let installed = false;

export function installConsoleBridge(): void {
  if (installed) return;
  installed = true;
  const orig = { log: console.log, warn: console.warn, error: console.error };
  const mirror = (level: 'debug' | 'warn' | 'error', args: unknown[]) => {
    try {
      const msg = args
        .map((a) => (typeof a === 'string' ? a : a instanceof Error ? a.message : safe(a)))
        .join(' ');
      log(level, 'console', msg);
    } catch {
      /* never let logging break a console call */
    }
  };
  console.log = (...args: unknown[]) => {
    mirror('debug', args);
    orig.log(...args);
  };
  console.warn = (...args: unknown[]) => {
    mirror('warn', args);
    orig.warn(...args);
  };
  console.error = (...args: unknown[]) => {
    mirror('error', args);
    orig.error(...args);
  };
}

function safe(a: unknown): string {
  try {
    return JSON.stringify(a);
  } catch {
    return String(a);
  }
}
