#!/usr/bin/env bash
#
# Push the whole-world EV charger DB to the Android device. Android counterpart of
# scripts/godot-ios/deploy-chargers.sh.
#
#   bash scripts/android/deploy-chargers.sh            # push the existing DB
#   bash scripts/android/deploy-chargers.sh --rebuild  # re-fetch from OSM first (~15-30 min)
#
# Destination is `files/chargers.db` — the parent of expo-sqlite's `files/SQLite`, matching
# what src/services/dbPaths.ts derives (node-tested there). Getting this wrong fails
# SILENTLY: chargerSource catches and degrades to "no chargers", which looks like an empty
# map rather than an error.
#
# `adb push` cannot write into an app's private storage, so we stage in /data/local/tmp and
# `run-as` the app to move it in. run-as REQUIRES a debuggable build — for a release build the
# app would have to copy the DB in itself from a bundled asset. There is no adb equivalent of
# iOS's `devicectl copy --domain-type appDataContainer`.
set -uo pipefail

REPO="/Users/ivan/Work/airgapp/mobile"
PKG="local.airgapp.mobile"
DB="$REPO/scripts/osm/out/chargers.db"

cd "$REPO" || { echo "ERROR: cannot cd to $REPO" >&2; exit 1; }

if [ "${1:-}" = "--rebuild" ]; then
  echo "→ fetching world charger data from OSM + building SQLite (several minutes)…"
  npx tsx scripts/osm/build-charger-db.ts --world || { echo "ERROR: build failed" >&2; exit 1; }
fi

[ -f "$DB" ] || { echo "ERROR: no DB at $DB — run with --rebuild first." >&2; exit 1; }

adb get-state >/dev/null 2>&1 || { echo "ERROR: no adb device attached." >&2; exit 1; }
adb shell "run-as $PKG true" 2>/dev/null || {
  echo "ERROR: run-as failed — is this a DEBUGGABLE build? Release builds cannot be pushed to." >&2
  exit 1
}

echo "→ pushing chargers.db ($(du -h "$DB" | cut -f1)) → $PKG files/chargers.db"
adb push "$DB" /data/local/tmp/chargers.db >/dev/null || { echo "ERROR: adb push failed" >&2; exit 1; }
adb shell "run-as $PKG cp /data/local/tmp/chargers.db files/chargers.db" || {
  echo "ERROR: run-as cp failed" >&2; exit 1; }
adb shell rm -f /data/local/tmp/chargers.db

echo "→ verifying"
adb shell "run-as $PKG ls -l files/chargers.db"

echo "→ relaunching app (so it re-opens the DB)"
adb shell am force-stop "$PKG"
adb shell am start -n "$PKG/.MainActivity" >/dev/null 2>&1
echo "✓ done"
