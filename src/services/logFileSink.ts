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

// ALLOW-list. Ivan's call (f9783e7): the file is capped at 200 KB and each
// append rewrites it, so breadth is bought with HISTORY, and agents reading back
// over a long run need the window more than they need every category.
//
// ⚠️ RESTORED 2026-07-28. That revert flipped the CHECK back to the allow-list
// but never restored this CONSTANT, so `CATEGORIES.has(...)` referenced an
// undefined binding and threw on EVERY entry. The sink wrote nothing from then
// on, and `pull-logs.sh` kept returning the stale tail of the old file — which
// is why it failed its own integrity check and why a whole session's worth of
// "there are no stream lines, so the stream never runs" was reasoning about a
// log that could not have contained them.
//
// That is the SECOND time this file has produced exactly that failure: the note
// it replaced described the same thing happening to 'outbox' the day before. The
// lesson survives the policy change — an absent line is not evidence, until you
// have checked that the line could have been written.
//
// So: adding a logi() with a NEW category means adding it here, or it is
// invisible.
//
// 'push' and 'read' added 2026-07-28 for the closure-freshness work, and their
// absence is the THIRD instance of this exact failure in two days: the whole
// "we receive no unsolicited pushes, therefore the stream is broken" conclusion
// rested on a log that could not contain a single 'push' line. Every closure
// fact the app learns arrives on one of these two categories, so diagnosing
// closures without them is diagnosing blind.
//
// They cost history — 'read' fires per poll. Drop them again once the closure
// behaviour is settled.
const CATEGORIES = new Set([
  'poll',
  'ble',
  'txp',
  'cmd',
  'stream',
  'lifecycle',
  'push',
  'read',
]);

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
