// logFileSink.ts — tee the in-memory logbus to the pullable diagnostics file.
//
// WHY: RN console.log never reaches the device syslog in a Hermes Release build,
// and the logbus ring is in-memory only — so on-device failures were invisible
// unless someone read them off a phone screen. That gap cost a debugging round
// trip: "bluetooth won't connect" could not be told apart from "the link is fine
// but the poll is failing", which are very different bugs with the same symptom.
// All the instrumentation to distinguish them already existed (logi/logw/loge in
// the poll and transport); it just had nowhere to go.
//
// BATCHED ON PURPOSE. appendDiagnostic rewrites the whole file, so a per-event
// append is O(file) and at ~1 Hz it starves the JS thread — the earlier
// per-frame capture grew the log to 90 KB and wrote it back on every frame.
// Buffering + a periodic flush keeps this cheap regardless of log volume.

import { subscribe, type LogEntry } from './logbus';
import { appendDiagnostic } from './diagnosticFile';

const FLUSH_MS = 4000;
const MAX_BUFFERED = 200;

// Everything except debug-level noise is persisted.
//
// This was an ALLOW-list of categories, and on 2026-07-27 it silently swallowed
// every 'outbox' line — seven call sites, none of which could ever reach the
// file. Hours went into "the share queue does nothing" while reading a log that
// structurally could not have shown it working, and the absence of lines was
// read as evidence the code never ran.
//
// The list was not even earning its keep as a volume guard: 'poll', the ~1 Hz
// category, was IN it. Batching plus MAX_BUFFERED is what actually bounds the
// cost, and neither depends on the category.
//
// So a category is visible by default and one that proves too chatty goes in
// NOISY. A diagnostic you have to remember to enable is one you will not have on
// the day you need it.
const NOISY = new Set<string>([]);

function format(e: LogEntry): string {
  const data = e.data ? ` ${JSON.stringify(e.data)}` : '';
  return `[${e.level}] ${e.cat}: ${e.msg}${data}`;
}

let buffer: string[] = [];
let timer: ReturnType<typeof setTimeout> | null = null;
let stop: (() => void) | null = null;

function flush(): void {
  timer = null;
  if (buffer.length === 0) return;
  const lines = buffer;
  buffer = [];
  void appendDiagnostic('log', lines);
}

// startLogFileSink begins teeing. Idempotent; returns a stop function.
export function startLogFileSink(): () => void {
  if (stop) return stop;
  const unsub = subscribe((e) => {
    if (e.level === 'debug') return;
    if (!CATEGORIES.has(e.cat)) return;
    buffer.push(format(e));
    // Hard cap: a runaway loop must not grow the buffer without bound.
    if (buffer.length >= MAX_BUFFERED) {
      if (timer) clearTimeout(timer);
      flush();
      return;
    }
    if (!timer) timer = setTimeout(flush, FLUSH_MS);
  });
  stop = () => {
    unsub();
    if (timer) clearTimeout(timer);
    timer = null;
    flush();
    stop = null;
  };
  return stop;
}
