#!/usr/bin/env bash
#
# Pull the on-device carlink log off the iPhone and print it as a readable
# timeline. Run this AFTER reproducing an issue on the car — no screenshots, no
# relaying: the app writes structured events to Documents/SQLite/carlink-log.db
# (see src/services/logSink.ts), and this copies it out and formats it.
#
#   bash scripts/godot-ios/pull-logs.sh            # last 200 lines
#   bash scripts/godot-ios/pull-logs.sh 1000       # last 1000
#   bash scripts/godot-ios/pull-logs.sh all txp    # everything, only the 'txp' category
#
set -uo pipefail

DEVICE="F3867E6E-E95F-5B2A-9C4E-06D1D72475A1"
BUNDLE_ID="local.airgapp.mobile"
OUT="/tmp/carlink-log.db"
N="${1:-200}"
CAT="${2:-}"

rm -f "$OUT" "$OUT-wal" "$OUT-shm"

echo "→ pulling Documents/SQLite/carlink-log.db …"
# WAL mode: the -wal sidecar holds un-checkpointed rows, so grab it too.
for f in carlink-log.db carlink-log.db-wal; do
  xcrun devicectl device copy from \
    --device "$DEVICE" \
    --domain-type appDataContainer \
    --domain-identifier "$BUNDLE_ID" \
    --source "Documents/SQLite/$f" \
    --destination "/tmp/$f" 2>&1 | grep -iE "error|not found" && [ "$f" = "carlink-log.db" ] && {
      echo "  (no log db yet — has the app run since the logging build was installed?)"; exit 1; }
done

command -v sqlite3 >/dev/null || { echo "sqlite3 not found on this Mac"; exit 1; }

WHERE=""
[ -n "$CAT" ] && WHERE="WHERE cat='$CAT'"
LIMIT=""
[ "$N" != "all" ] && LIMIT="LIMIT $N"

echo "→ timeline (t = ms since epoch; Δ = ms since previous line):"
echo
# Print each row with a delta from the previous timestamp — the deltas are where
# the story is (a 6000ms gap before an openSession = a cold BLE scan).
sqlite3 -noheader -separator '|' "$OUT" \
  "SELECT t, level, cat, msg, COALESCE(data,'') FROM (
     SELECT * FROM log $WHERE ORDER BY t DESC $LIMIT
   ) ORDER BY t ASC;" 2>/dev/null | awk -F'|' '
  BEGIN { prev=0 }
  {
    d = (prev==0) ? 0 : $1 - prev; prev=$1
    printf "%+7d  %-5s %-9s %s %s\n", d, $2, $3, $4, $5
  }'
