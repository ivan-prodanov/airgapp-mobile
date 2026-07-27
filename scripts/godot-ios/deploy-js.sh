#!/usr/bin/env bash
#
# JS-ONLY fast deploy — push a JS/TS-only change to the iPhone WITHOUT an xcodebuild (~seconds, not
# ~25 min). Rebuilds the RN bundle, Hermes-compiles it, swaps it into the standalone Release .app,
# re-signs, installs + launches.
#
#   deploy-js.sh
#
# Use this ONLY for JS/TS changes. If you touched native code (.mm/.swift) do a full Release build;
# if you touched the Godot project use deploy-ios.sh (swaps the .pck).
#
# Prereq: a standalone Release airgapp.app already exists in DerivedData (build once with the
# xcodebuild command in deploy-ios.sh's header). This script swaps the JS bundle INTO that .app.
#
set -uo pipefail

APP_REPO="/Users/ivan/Work/airgapp/mobile"
DEVICE="F3867E6E-E95F-5B2A-9C4E-06D1D72475A1"   # CoreDevice id (devicectl)
BUNDLE_ID="local.airgapp.mobile"

# Load gitignored local secrets so EXPO_PUBLIC_* vars (e.g. the TomTom key) are inlined into the bundle.
# `expo export:embed` does NOT auto-load .env.local, so we export it ourselves before bundling.
[ -f "$APP_REPO/.env.local" ] && { set -a; . "$APP_REPO/.env.local"; set +a; }

# Newest standalone Release .app (survives clean rebuilds / changing DerivedData hashes).
APP="$(ls -dt "$HOME"/Library/Developer/Xcode/DerivedData/airgapp-*/Build/Products/Release-iphoneos/airgapp.app 2>/dev/null | head -1)"
[ -n "$APP" ] && [ -d "$APP" ] || { echo "ERROR: no standalone Release .app — do a full xcodebuild Release once (see deploy-ios.sh)." >&2; exit 1; }
[ -f "$APP/main.jsbundle" ] || { echo "ERROR: $APP has no main.jsbundle — not a JS-embedded Release app." >&2; exit 1; }

HERMESC="$(find "$APP_REPO/node_modules" -name hermesc -path '*osx-bin*' 2>/dev/null | head -1)"
[ -x "$HERMESC" ] || { echo "ERROR: hermesc not found under node_modules." >&2; exit 1; }

TMP="$(mktemp -d -t airgapp-js-XXXXXX)"
trap 'rm -rf "$TMP"' EXIT

echo "→ [1/4] bundling JS (expo export:embed)"
( cd "$APP_REPO" && npx expo export:embed \
    --platform ios \
    --dev false \
    --entry-file node_modules/expo-router/entry.js \
    --bundle-output "$TMP/main.plain.js" \
    --assets-dest "$TMP/assets" ) > "$TMP/bundle.log" 2>&1
[ -s "$TMP/main.plain.js" ] || { echo "ERROR: bundle failed — last lines:" >&2; tail -25 "$TMP/bundle.log" >&2; exit 1; }
echo "  plain JS: $(du -h "$TMP/main.plain.js" | cut -f1)"

echo "→ [2/4] Hermes-compiling → main.jsbundle (bytecode)"
"$HERMESC" -emit-binary -O -w -out "$TMP/main.hbc" "$TMP/main.plain.js" || { echo "ERROR: hermesc failed" >&2; exit 1; }
# Sanity: Hermes bytecode magic is 1F1903C103BC1FC6 (little-endian: c6 1f bc 03 ...).
head -c4 "$TMP/main.hbc" | xxd -p | grep -qi '^c61fbc03' || { echo "ERROR: hermesc output is not Hermes bytecode" >&2; exit 1; }
cp "$TMP/main.hbc" "$APP/main.jsbundle"
echo "  swapped: $(du -h "$APP/main.jsbundle" | cut -f1)"

# Sync bundled assets (images, assets/places.db …) into the .app so JS-only deploys pick up new/changed
# assets.
#
# LAYOUT GOTCHA (got a new image silently rendering blank once): metro writes each asset to
# <assets-dest>/<httpServerLocation>/<file>, and httpServerLocation for a repo asset at
# <repo>/assets/images/x.png is "/assets/assets/images". Xcode's own build phase passes the .app ROOT as
# --assets-dest, so the runtime looks for <app>/assets/assets/images/x.png. We bundle to $TMP/assets, so
# the same asset lands at $TMP/assets/assets/assets/images/x.png — one level deeper. Sync from
# "$TMP/assets/assets/" (NOT "$TMP/assets/") so the tree mirrors Xcode's and the loader finds the file.
if [ -d "$TMP/assets/assets" ]; then
  rsync -a "$TMP/assets/assets/" "$APP/assets/" 2>/dev/null || cp -R "$TMP/assets/assets/." "$APP/assets/"
  echo "  synced assets → $APP/assets (mirroring Xcode's <app>/assets/assets/… layout)"
fi
# GOTCHA: expo-sqlite's importDatabaseFromAssetAsync resolves the bundled gazetteer to
# <app>/assets/assets/places.db — one level SHALLOWER than the image-loader asset layout the rsync above
# produces (<app>/assets/assets/assets/places.db). So ALSO place the DB at the shallower path explicitly,
# else initPlaceSources() silently fails ("Database …/assets/assets/places.db not found") and the
# gazetteer returns zero rows. See docs/superpowers/plans/2026-07-07-navigate-search.md (Task 7).
if [ -f "$APP_REPO/assets/places.db" ]; then
  mkdir -p "$APP/assets/assets"
  cp "$APP_REPO/assets/places.db" "$APP/assets/assets/places.db"
  echo "  placed gazetteer DB → assets/assets/places.db (importDatabaseFromAssetAsync path)"
fi

echo "→ [3/4] re-signing"
ID="$(security find-identity -v -p codesigning 2>/dev/null | grep -m1 'Apple Development' | awk '{print $2}')"
[ -n "$ID" ] || { echo "ERROR: no 'Apple Development' codesigning identity found" >&2; exit 1; }
codesign -f -s "$ID" --preserve-metadata=entitlements,identifier,flags "$APP" >/dev/null 2>&1 \
  || { echo "ERROR: codesign failed" >&2; exit 1; }
echo "  re-signed with $ID"

echo "→ [4/4] installing + launching on device"
# Check the INSTALL's own exit status, not the pipeline's.
#
# This used to be `install … | grep …`, whose status is grep's, so a failed
# install printed its error and the script still finished with "✓ done". On
# 2026-07-27 that reported a successful deploy of a build that never reached the
# phone — and "I deployed it, nothing happened" then looked like a code bug.
# A deploy that did not install must not exit 0.
INSTALL_LOG="$(xcrun devicectl device install app --device "$DEVICE" "$APP" 2>&1)" || {
  echo "$INSTALL_LOG" | grep -iE "error" | tail -2
  echo "ERROR: install FAILED — nothing new is on the phone." >&2
  case "$INSTALL_LOG" in
    *"unable to locate a device"*|*"tunnel"*)
      echo "  The device is unreachable. Unlock the phone, and make sure it is on" >&2
      echo "  the same network or plugged in — 'xcrun devicectl list devices' should" >&2
      echo "  show it as 'available' rather than 'unavailable'." >&2 ;;
    *"expired"*|*0xe8008011*|*"error 13"*)
      echo "  The free 7-day provisioning profile expired — see AGENTS.md; rebuild" >&2
      echo "  with -allowProvisioningUpdates to renew it." >&2 ;;
  esac
  exit 1
}
echo "$INSTALL_LOG" | grep -iE "App installed|error" | tail -1
xcrun devicectl device process launch --terminate-existing --device "$DEVICE" "$BUNDLE_ID" 2>&1 \
  | grep -iE "Launched|Locked|error" | head -1

echo "✓ done"
