// logbus — the app's own log pipe.
//
// WHY THIS EXISTS: in a Hermes RELEASE build, `console.log`/`console.warn` do
// NOT reach the device syslog (only native NSLog does). So every diagnostic we
// print during a real-car session is invisible — which is how "every command
// took 8-10s then suddenly went fast" stayed a guess. logbus captures
// structured events into an in-memory ring AND (via an injected sink) persists
// them to a file we can PULL off the device with devicectl and read directly.
//
// PURE — no react-native / expo imports, so it stays node-testable and can be
// imported from the ble/* core without breaking that isolation rule. The sink
// (SQLite, RN-only) is injected at runtime; the core just holds the ring and
// hands each entry to the sink if one is set.

export type LogLevel = 'debug' | 'info' | 'warn' | 'error';

export interface LogEntry {
  seq: number;
  t: number; // wall-clock ms
  level: LogLevel;
  cat: string; // subsystem: 'cmd' | 'poll' | 'ble' | 'txp' | 'coalesce' | 'console' | …
  msg: string;
  data?: Record<string, unknown>;
}

// A sink persists/forwards entries. Injected so the pure core never imports RN.
export type LogSink = (entry: LogEntry) => void;

const RING_CAP = 4000;

let ring: LogEntry[] = [];
let seq = 0;
let sink: LogSink | null = null;
let minLevel: LogLevel = 'debug';
const subscribers = new Set<(e: LogEntry) => void>();
const LEVELS: Record<LogLevel, number> = { debug: 0, info: 1, warn: 2, error: 3 };

// now is injectable ONLY for tests; production always uses the real clock.
let now: () => number = () => Date.now();

export function log(level: LogLevel, cat: string, msg: string, data?: Record<string, unknown>): void {
  if (LEVELS[level] < LEVELS[minLevel]) return;
  const entry: LogEntry = { seq: seq++, t: now(), level, cat, msg, ...(data ? { data } : {}) };
  ring.push(entry);
  if (ring.length > RING_CAP) ring.shift();
  // The sink and subscribers must NEVER be able to break the caller — a broken
  // logger cannot be allowed to take down the command path it's observing.
  if (sink) {
    try {
      sink(entry);
    } catch {
      /* swallow */
    }
  }
  for (const s of subscribers) {
    try {
      s(entry);
    } catch {
      /* swallow */
    }
  }
}

// Convenience wrappers.
export const logd = (cat: string, msg: string, data?: Record<string, unknown>) => log('debug', cat, msg, data);
export const logi = (cat: string, msg: string, data?: Record<string, unknown>) => log('info', cat, msg, data);
export const logw = (cat: string, msg: string, data?: Record<string, unknown>) => log('warn', cat, msg, data);
export const loge = (cat: string, msg: string, data?: Record<string, unknown>) => log('error', cat, msg, data);

// timed wraps an async op and logs its duration + outcome under one message.
// Returns the op's result (or rethrows) — logging must be transparent.
export async function timed<T>(
  cat: string,
  msg: string,
  op: () => Promise<T>,
  data?: Record<string, unknown>,
): Promise<T> {
  const start = now();
  try {
    const out = await op();
    log('info', cat, msg, { ...data, ms: Math.round(now() - start), ok: true });
    return out;
  } catch (e) {
    log('warn', cat, msg, { ...data, ms: Math.round(now() - start), ok: false, err: String(e) });
    throw e;
  }
}

export function setSink(s: LogSink | null): void {
  sink = s;
  // Backfill anything logged before the sink attached (e.g. during boot) so the
  // persisted file isn't missing the earliest, often most interesting, entries.
  if (s) for (const e of ring) try { s(e); } catch { /* swallow */ }
}

export function setMinLevel(level: LogLevel): void {
  minLevel = level;
}

export function subscribe(fn: (e: LogEntry) => void): () => void {
  subscribers.add(fn);
  return () => subscribers.delete(fn);
}

export function snapshot(): LogEntry[] {
  return ring.slice();
}

export function toJSONL(entries: LogEntry[] = ring): string {
  return entries.map((e) => JSON.stringify(e)).join('\n');
}

// Test-only reset.
export function __resetForTest(clock?: () => number): void {
  ring = [];
  seq = 0;
  sink = null;
  minLevel = 'debug';
  subscribers.clear();
  now = clock ?? (() => Date.now());
}
