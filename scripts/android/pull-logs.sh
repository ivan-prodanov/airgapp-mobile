#!/usr/bin/env bash
#
# Pull the app's logs off the Galaxy S22. Counterpart of scripts/godot-ios/pull-logs.sh.
#
#   bash scripts/android/pull-logs.sh            # last 200 app-log lines + the native passive-entry log tail
#   bash scripts/android/pull-logs.sh 1000       # last 1000
#   bash scripts/android/pull-logs.sh all ble    # everything, only the 'ble' category
#
# TWO logs, because two runtimes: the JS logbus ring (files/SQLite/carlink-log.db, also carries the
# native `log` event lines under cat=region while JS is alive) and files/airgapp-native.log, which
# the passive-entry service writes itself — the only record of what happened while JS was not
# running (boot, background, the share process). Both need `debuggable true` (adb run-as).
set -uo pipefail

PKG="local.airgapp.mobile"
LIMIT="${1:-200}"
CAT="${2:-}"
OUT="${TMPDIR:-/tmp}/airgapp-android-logs"
mkdir -p "$OUT"

adb get-state >/dev/null 2>&1 || { echo "ERROR: no adb device attached." >&2; exit 1; }

echo "=== app log (SQLite ring) ==="
# The ring is in WAL mode: without the -wal/-shm sidecars the newest rows are invisible.
for f in carlink-log.db carlink-log.db-wal carlink-log.db-shm; do
  adb shell "run-as $PKG cat files/SQLite/$f" > "$OUT/$f" 2>/dev/null || true
  [ -s "$OUT/$f" ] || rm -f "$OUT/$f"
done
if [ -s "$OUT/carlink-log.db" ]; then
  node -e '
    const { DatabaseSync } = require("node:sqlite");
    const [db, limit, cat] = [new DatabaseSync(process.argv[1]), process.argv[2], process.argv[3]];
    const where = cat ? `where cat = ${JSON.stringify(cat)}` : "";
    const lim = limit === "all" ? "" : `limit ${Number(limit)}`;
    // ORDER BY t, not seq: `seq` is the JS logbus counter and restarts at 0 on every app boot,
    // so a fresh boot writes LOW seq values that replace the oldest rows — the ring wraps.
    const rows = db.prepare(`select t, level, cat, msg, data from log ${where} order by t desc ${lim}`).all().reverse();
    for (const r of rows) console.log([new Date(r.t).toISOString(), r.level, r.cat, r.msg, r.data].filter(Boolean).join(" | "));
  ' "$OUT/carlink-log.db" "$LIMIT" "$CAT"
else
  echo "(no SQLite log yet)"
fi

echo
echo "=== native passive-entry log (files/airgapp-native.log) ==="
adb shell "run-as $PKG cat files/airgapp-native.log" > "$OUT/airgapp-native.log" 2>/dev/null
if [ -s "$OUT/airgapp-native.log" ]; then
  if [ "$LIMIT" = "all" ]; then cat "$OUT/airgapp-native.log"; else tail -n "$LIMIT" "$OUT/airgapp-native.log"; fi
else
  echo "(no native log yet — the passive-entry service has not run)"
fi
echo
echo "copies: $OUT/carlink-log.db, $OUT/airgapp-native.log"
