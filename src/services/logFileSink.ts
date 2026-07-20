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

// Categories worth persisting. Deliberately narrow: the point is diagnosing the
// link, not mirroring every event into a file we then have to read.
const CATEGORIES = new Set(['poll', 'ble', 'txp', 'cmd', 'stream', 'lifecycle']);

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
    if (!CATEGORIES.has(e.cat) && e.level === 'debug') return;
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
