#!/usr/bin/env bash
#
# ONE COMMAND — refresh the whole-world EV charger data and push it to the iPhone. No params.
#
#   bash scripts/godot-ios/deploy-chargers.sh
#
# 1. Fetches EVERY charging_station on the planet from OpenStreetMap / Overpass — ~181k point nodes in one
#    tag-index query + ~8k area sites (ways/relations) tiled by region — ≈189k total (~98% of OSM).
# 2. Builds a SQLite DB (scripts/osm/out/chargers.db, ~36 MB) via Node's built-in node:sqlite.
# 3. Pushes it into the app's container at Documents/chargers.db over USB (devicectl) and relaunches, where
#    src/services/chargerSource.ts queries it by bounding box.
#
# No app rebuild, no hosting. ~15-30 min (mostly the OSM fetch; public Overpass is slow/rate-limited, and a
# few dense-Europe area tiles may miss — non-fatal, just re-run later). Requires the app already installed
# WITH the expo-sqlite native module (one full xcodebuild). Until a DB is pushed, the app falls back to the
# small bundled Balkans extract.
set -uo pipefail

APP_REPO="/Users/ivan/Work/airgapp/mobile"
DEVICE="F3867E6E-E95F-5B2A-9C4E-06D1D72475A1"   # CoreDevice id (devicectl)
BUNDLE_ID="local.airgapp.mobile"
DB="$APP_REPO/scripts/osm/out/chargers.db"

cd "$APP_REPO" || { echo "ERROR: cannot cd to $APP_REPO" >&2; exit 1; }

echo "→ [1/2] fetching world charger data from OSM + building SQLite (several minutes)…"
npx tsx scripts/osm/build-charger-db.ts --world || { echo "ERROR: build failed" >&2; exit 1; }
[ -f "$DB" ] || { echo "ERROR: build produced no DB at $DB" >&2; exit 1; }

echo "→ [2/2] pushing chargers.db ($(du -h "$DB" | cut -f1)) → $BUNDLE_ID:Documents/chargers.db"
xcrun devicectl device copy to \
  --device "$DEVICE" \
  --domain-type appDataContainer \
  --domain-identifier "$BUNDLE_ID" \
  --user mobile \
  --source "$DB" \
  --destination "Documents/chargers.db" 2>&1 | grep -iE "error|Transferred|Total|copied" | tail -3

echo "→ relaunching app (so it re-opens the DB)"
xcrun devicectl device process launch --terminate-existing --device "$DEVICE" "$BUNDLE_ID" 2>&1 \
  | grep -iE "Launched|error" | head -1

echo "✓ chargers refreshed + deployed"
