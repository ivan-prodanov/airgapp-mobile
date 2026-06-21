#!/usr/bin/env bash
#
# One command to ship a fresh Godot export to the iPhone.
#
#   deploy-ios.sh [godot-project-dir]   (defaults to the canonical /Users/ivan/Work/airgapp/godot)
#
# fix_godot_project.py converts the project's VRAM/s3tc texture imports to LOSSLESS in place (iOS has
# no PVRTC variants because the Mac importer segfaults — that's the white-car bug). This mutates the
# project's .import/ — expected and idempotent. Pass a fresh Codex export path to patch+deploy that.
#
# Pipeline:
#   1. fix_godot_project.py  — apply the iOS patches (textures + MobileComm + camera + injector)
#   2. Godot --export-pack   — produce airgapp.pck (iOS preset)
#   3. swap the pck into the standalone Release .app and re-sign (no full rebuild needed)
#   4. install + launch on the device
#
# Prereqs:
#   - Godot 3.2.stable at /Applications/Godot.app, iOS export templates installed.
#   - A standalone Release build already exists (build once with:
#       xcodebuild -workspace ios/airgapp.xcworkspace -scheme airgapp -configuration Release \
#         -sdk iphoneos -destination 'generic/platform=iOS' -allowProvisioningUpdates \
#         DEVELOPMENT_TEAM=859B8N529C CODE_SIGN_STYLE=Automatic build
#     Rebuild only when NATIVE (.mm/.swift) code changes; pck-only changes use this script.
#
set -uo pipefail

# Default to the canonical project; pass a path to deploy a fresh Codex export from elsewhere.
PROJECT="${1:-/Users/ivan/Work/airgapp/godot}"
HERE="$(cd "$(dirname "$0")" && pwd)"
APP_REPO="/Users/ivan/Work/airgapp/mobile"

GODOT="/Applications/Godot.app/Contents/MacOS/Godot"
PRESET="iOS"
MODULE_PCK="$APP_REPO/modules/expo-godot-view/ios/airgapp.pck"
# Glob the standalone Release build rather than hardcoding the DerivedData hash (survives clean
# rebuilds). Pick the newest match if more than one airgapp-* DerivedData dir has a Release app.
APP="$(ls -dt "$HOME"/Library/Developer/Xcode/DerivedData/airgapp-*/Build/Products/Release-iphoneos/airgapp.app 2>/dev/null | head -1)"
DEVICE="F3867E6E-E95F-5B2A-9C4E-06D1D72475A1"   # CoreDevice id (devicectl)
BUNDLE_ID="local.airgapp.mobile"

[ -f "$PROJECT/project.godot" ] || { echo "ERROR: not a Godot project: $PROJECT" >&2; exit 1; }
[ -x "$GODOT" ] || { echo "ERROR: Godot not found at $GODOT" >&2; exit 1; }

echo "→ [1/4] patching project for iOS"
python3 "$HERE/fix_godot_project.py" "$PROJECT" || exit 1

echo "→ [2/4] exporting iOS .pck"
TMP="$(mktemp -t airgapp-XXXXXX).pck"
trap 'rm -f "$TMP"' EXIT
# Godot may exit nonzero on missing-asset warnings even when the .pck is fine — judge by file size.
"$GODOT" --headless --path "$PROJECT" --export-pack "$PRESET" "$TMP" > /tmp/godot-export.log 2>&1 || true
[ -s "$TMP" ] || { echo "ERROR: export produced no .pck — see /tmp/godot-export.log" >&2; tail -20 /tmp/godot-export.log >&2; exit 1; }
echo "  pck: $(du -h "$TMP" | cut -f1)"
cp "$TMP" "$MODULE_PCK"
echo "  staged → $MODULE_PCK"

if [ ! -d "$APP" ]; then
  echo "✓ pck staged. No standalone Release app yet — do a Release build once (see header), then re-run."
  exit 0
fi

echo "→ [3/4] swapping pck into standalone app + re-signing"
cp "$TMP" "$APP/airgapp.pck"
ID="$(security find-identity -v -p codesigning 2>/dev/null | grep -m1 'Apple Development' | awk '{print $2}')"
[ -n "$ID" ] || { echo "ERROR: no 'Apple Development' codesigning identity found" >&2; exit 1; }
codesign -f -s "$ID" --preserve-metadata=entitlements,identifier,flags "$APP" >/dev/null 2>&1 \
  || { echo "ERROR: codesign failed" >&2; exit 1; }
echo "  re-signed"

echo "→ [4/4] installing + launching on device"
xcrun devicectl device install app --device "$DEVICE" "$APP" 2>&1 | grep -iE "App installed|error" | tail -1
xcrun devicectl device process launch --terminate-existing --device "$DEVICE" "$BUNDLE_ID" 2>&1 \
  | grep -iE "Launched|Locked|error" | head -1

echo "✓ done"
