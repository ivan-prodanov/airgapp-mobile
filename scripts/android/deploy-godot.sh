#!/usr/bin/env bash
#
# Push the Godot scene pack to the Android device. Android counterpart of
# scripts/godot-ios/deploy-ios.sh's pck-swap step.
#
#   bash scripts/android/deploy-godot.sh              # push the existing pck
#   bash scripts/android/deploy-godot.sh --reexport   # re-export from the Godot project first
#
# Destination is `files/airgapp.pck`, which is what GodotHost.pckPath() passes to the engine as
# `--main-pack`. Same mechanism as iOS (GodotHost.mm:76-82), just a different path.
#
# adb cannot write app-private storage, so we stage in /data/local/tmp and run-as the app to move
# it in. run-as needs a DEBUGGABLE build — our release variant sets `debuggable true` for exactly
# this kind of on-device work, so both variants accept the push.
set -uo pipefail

REPO="/Users/ivan/Work/airgapp/mobile"
PKG="local.airgapp.mobile"
# The iOS embed keeps the canonical pck; there is only one, and it is platform-neutral.
PCK="$REPO/modules/expo-godot-view/ios/airgapp.pck"

cd "$REPO" || exit 1

if [ "${1:-}" = "--reexport" ]; then
  echo "→ re-exporting the pck from the Godot project"
  bash scripts/godot-ios/deploy-ios.sh --export-only || {
    echo "ERROR: export failed. Export manually from /Users/ivan/Work/airgapp/godot." >&2; exit 1; }
fi

[ -f "$PCK" ] || {
  echo "ERROR: no pack at $PCK" >&2
  echo "Restore it per modules/expo-godot-view/ios/VENDORING.md (it is gitignored, ~320 MB)." >&2
  exit 1
}

adb get-state >/dev/null 2>&1 || { echo "ERROR: no adb device attached." >&2; exit 1; }
adb shell "run-as $PKG true" 2>/dev/null || {
  echo "ERROR: run-as refused — the installed build is not debuggable." >&2; exit 1; }

echo "→ pushing $(du -h "$PCK" | cut -f1) → $PKG files/airgapp.pck (this takes a minute)"
adb push "$PCK" /data/local/tmp/airgapp.pck >/dev/null || { echo "ERROR: adb push failed" >&2; exit 1; }
adb shell "run-as $PKG cp /data/local/tmp/airgapp.pck files/airgapp.pck" || {
  echo "ERROR: run-as cp failed" >&2; exit 1; }
adb shell rm -f /data/local/tmp/airgapp.pck

adb shell "run-as $PKG ls -l files/airgapp.pck"

echo "→ relaunching (the engine reads the pack once, at boot)"
adb shell am force-stop "$PKG"
adb shell am start -n "$PKG/.MainActivity" >/dev/null 2>&1
echo "✓ done"
