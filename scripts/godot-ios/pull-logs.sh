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
# INTEGRITY: the db and its -wal are two separate copies taken against a LIVE
# writer, so they can disagree. A mismatched pair does not fail loudly — SQLite
# recovers a scrambled mixture that still reads as a plausible timeline once
# sorted by timestamp. On 2026-07-28 a pull returned seq 0 holding the newest
# row and seq 6391 a row from ten hours earlier, and analysis was done on it
# before anyone checked. The app now WAL-checkpoints after every flush so the
# main file is near-self-contained, and the check at the end of this script
# verifies seq really does rise with time before you trust the output.
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

# ── integrity check ────────────────────────────────────────────────────────
# seq is a monotonic INTEGER PRIMARY KEY, so ordering by seq and by time must
# agree. If they don't, the db/-wal pair was inconsistent and EVERY row is
# suspect — re-pull rather than reading the output above.
# ⚠️ This check used to compare seq-order against time-order across the WHOLE
# table and flag any mismatch. That is a guaranteed FALSE POSITIVE: `seq` is an
# INTEGER PRIMARY KEY that restarts at 0 when the app trims the capped file, so a
# db holding two eras always "fails" — 6392 of 6392 rows, every single pull.
#
# It cost most of a day. The rows are DISPLAYED in `t` order and were correct all
# along, but the banner said DO NOT TRUST and so good evidence was thrown away
# twice, and the tool blamed for a live-copy race it never had.
#
# What the check is actually for is a TORN db/-wal pair, which shows up as seq
# jumping backwards repeatedly among rows that are adjacent in time. One backward
# step is just the reset boundary, so allow it; more than that is a real tear.
BAD=$(sqlite3 "$OUT" "
  WITH r AS (SELECT seq, t FROM log ORDER BY t DESC LIMIT 300),
       a AS (SELECT seq, LAG(seq) OVER (ORDER BY t) ps FROM r)
  SELECT MAX(0, COUNT(*) - 1) FROM a WHERE ps IS NOT NULL AND seq < ps;" 2>/dev/null || echo "?")
if [ "$BAD" != "0" ]; then
  echo
  echo "⚠️  INTEGRITY CHECK FAILED — $BAD rows out of seq/time order."
  echo "    The db and -wal copies did not correspond. DO NOT TRUST THE ROWS ABOVE."
  echo "    Re-run this script; if it keeps failing, the app is writing faster"
  echo "    than the checkpoint keeps up and the copy needs the app backgrounded."
else
  echo
  echo "✓ integrity: seq and time agree — rows are consistent."
fi
