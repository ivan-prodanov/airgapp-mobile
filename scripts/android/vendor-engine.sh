#!/usr/bin/env bash
#
# Extract the prebuilt Godot 3.2.2 Android engine into the expo module's jniLibs.
# Android counterpart of modules/expo-godot-view/ios/VENDORING.md's restore step.
#
#   bash scripts/android/vendor-engine.sh
#
# ~50 MB of gitignored binaries. We ship arm64-v8a (the device) and x86_64 (the emulator)
# only — armeabi-v7a and x86 would double the APK for hardware we do not target.
#
# NOTE we deliberately do NOT copy the AAR's libc++_shared.so: React Native ships its own,
# newer copy, and two would collide at packaging time. build.gradle pickFirst's RN's.
set -euo pipefail

TPL="$HOME/Library/Application Support/Godot/templates/3.2.2.stable/android_source.zip"
DEST="/Users/ivan/Work/airgapp/mobile/modules/expo-godot-view/android/src/main/jniLibs"

[ -f "$TPL" ] || {
  echo "ERROR: $TPL missing." >&2
  echo "Install the Godot 3.2.2 export templates (Godot_v3.2.2-stable_export_templates.tpz)" >&2
  echo "into ~/Library/Application Support/Godot/templates/3.2.2.stable/." >&2
  exit 1
}

TMP="$(mktemp -d)"; trap 'rm -rf "$TMP"' EXIT

echo "→ extracting godot-lib.release.aar from the export template"
unzip -o -q -j "$TPL" 'libs/release/godot-lib.release.aar' -d "$TMP"
unzip -o -q "$TMP/godot-lib.release.aar" 'jni/*' -d "$TMP/aar"

for abi in arm64-v8a x86_64; do
  src="$TMP/aar/jni/$abi/libgodot_android.so"
  [ -f "$src" ] || { echo "ERROR: $abi missing from the AAR" >&2; exit 1; }
  mkdir -p "$DEST/$abi"
  cp "$src" "$DEST/$abi/"
  echo "  $abi: $(du -h "$DEST/$abi/libgodot_android.so" | cut -f1)"
done

echo "✓ engine vendored to $DEST"
echo "  (libc++_shared.so intentionally NOT copied — RN ships a newer one)"
