import * as SQLite from 'expo-sqlite';

import { setSink, type LogEntry } from './logbus';

// The persistent sink for logbus, backed by expo-sqlite.
//
// WHY SQLITE: `console.*` is invisible in a Hermes Release build, so logs must
// go to a file we can PULL off the device. expo-sqlite is fully linked and
// already proven (the charger DB uses the same mechanism), and its default dir
// is <container>/Documents/SQLite — pullable with:
//
//   xcrun devicectl device copy from --device <id> \
//     --domain-type appDataContainer --domain-identifier local.airgapp.mobile \
//     --source Documents/SQLite/carlink-log.db --destination ./carlink-log.db
//   sqlite3 carlink-log.db 'select t,level,cat,msg,data from log order by seq'
//
// (scripts/godot-ios/pull-logs.sh wraps that.)
//
// RN-only (imports expo-sqlite → unloadable under node), isolated in its own
// file so the pure logbus core stays node-testable. Best-effort throughout: a
// logging failure must never disturb the app it's observing.

const DB_NAME = 'carlink-log.db';
// Rows past this are trimmed on the next flush — a session's worth, not forever.
const MAX_ROWS = 20_000;
const FLUSH_MS = 1000;

let db: SQLite.SQLiteDatabase | null = null;
let queue: LogEntry[] = [];
let timer: ReturnType<typeof setInterval> | null = null;

async function open(): Promise<SQLite.SQLiteDatabase> {
  const handle = await SQLite.openDatabaseAsync(DB_NAME);
  await handle.execAsync(
    'PRAGMA journal_mode=WAL;' +
      'CREATE TABLE IF NOT EXISTS log (seq INTEGER PRIMARY KEY, t INTEGER, level TEXT, cat TEXT, msg TEXT, data TEXT);',
  );
  return handle;
}

async function flush(): Promise<void> {
  if (!db || queue.length === 0) return;
  const batch = queue;
  queue = [];
  try {
    await db.withTransactionAsync(async () => {
      for (const e of batch) {
        await db!.runAsync('INSERT OR REPLACE INTO log (seq, t, level, cat, msg, data) VALUES (?,?,?,?,?,?)', [
          e.seq,
          e.t,
          e.level,
          e.cat,
          e.msg,
          e.data ? JSON.stringify(e.data) : null,
        ]);
      }
    });
    // Trim to a bounded tail so a long session doesn't grow the file forever.
    await db.runAsync('DELETE FROM log WHERE seq <= (SELECT MAX(seq) FROM log) - ?', [MAX_ROWS]);
  } catch {
    // Re-queue on failure so a transient error doesn't lose the batch — but cap
    // it, so a persistently-broken DB can't grow the in-memory queue unbounded.
    if (queue.length < MAX_ROWS) queue = batch.concat(queue);
  }
}

// initLogSink wires logbus → SQLite. Call once, at app root. Idempotent-ish:
// a second call is a no-op while a sink is already running.
export function initLogSink(): void {
  if (timer) return;
  void (async () => {
    try {
      db = await open();
    } catch {
      return; // no DB → logs stay in the in-memory ring only; app unaffected
    }
    // logbus.setSink backfills everything logged before now, so boot-time
    // entries land in the file too.
    setSink((e) => {
      queue.push(e);
    });
    timer = setInterval(() => void flush(), FLUSH_MS);
  })();
}
