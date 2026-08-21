#!/usr/bin/env bash
#
# Fast deploy of a JS/TS change to the Android device. Counterpart of
# scripts/godot-ios/deploy-js.sh.
#
#   bash scripts/android/deploy-js.sh
#
# MEASURED 2026-08-21 on the Galaxy S22: ~31s to re-bundle + build, ~9s to install — about 40s
# end to end. (A no-op run is ~18s because Gradle skips createBundleReleaseJsAndAssets when
# nothing changed; do not quote that as the JS-change number.)
#
# WHY A FULL assembleRelease AND NOT AN APK SWAP: on iOS the JS bundle is a loose file inside the
# .app, so deploy-js.sh swaps it and re-signs. An Android APK is a signed zip — replacing
# assets/index.android.bundle means re-zipping, re-aligning and re-signing, which is more moving
# parts than it saves. Gradle's incremental release build already does the same work in about the
# same time, and it cannot produce a mismatched APK.
#
# The gradle bundle task DOES load .env.local on its own (unlike `expo export:embed` on the iOS
# path, which needs it sourced first), so EXPO_PUBLIC_* values are inlined without extra work.
#
# For native (.kt / .java) changes this is also the right command — the same build covers both.
# For a Godot scene or .pck change use deploy-godot.sh instead.
set -uo pipefail

REPO="/Users/ivan/Work/airgapp/mobile"
PKG="local.airgapp.mobile"
APK="$REPO/android/app/build/outputs/apk/release/app-release.apk"

export ANDROID_HOME="${ANDROID_HOME:-$HOME/Library/Android/sdk}"
export JAVA_HOME="${JAVA_HOME:-/Library/Java/JavaVirtualMachines/zulu-17.jdk/Contents/Home}"

cd "$REPO/android" || { echo "ERROR: no android/ project at $REPO" >&2; exit 1; }
adb get-state >/dev/null 2>&1 || { echo "ERROR: no adb device attached." >&2; exit 1; }

echo "→ [1/2] building release (JS bundled in, so the phone runs untethered)"
if ! ./gradlew :app:assembleRelease --max-workers=2 > /tmp/android-deploy-js.log 2>&1; then
  echo "ERROR: build failed — last lines:" >&2
  grep -B2 -A12 "What went wrong" /tmp/android-deploy-js.log >&2 | head -20
  exit 1
fi
[ -f "$APK" ] || { echo "ERROR: build produced no APK at $APK" >&2; exit 1; }
echo "  apk: $(du -h "$APK" | cut -f1)"

echo "→ [2/2] installing + relaunching"
adb install -r "$APK" 2>&1 | tail -1
adb shell am force-stop "$PKG"
adb shell am start -n "$PKG/.MainActivity" >/dev/null 2>&1
echo "✓ done"
