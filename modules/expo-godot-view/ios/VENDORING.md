# Vendored Godot 3.2 binaries (gitignored)

These ~600 MB of binaries are required to build the device (iOS) engine embed but are kept out
of git history (see `.gitignore`). Restore them on a fresh checkout with the commands below.

| File (in this `ios/` dir) | Size | Source | Provenance |
|---|---|---|---|
| `engine/libgodot.iphone.debug.fat.a` | 127 MB | `~/Library/Application Support/Godot/templates/3.2.stable/iphone.zip` | Godot 3.2.stable iOS export template (2020). Slices: `x86_64 arm64`. |
| `engine/libgodot.iphone.release.fat.a` | 109 MB | same `iphone.zip` | Slices: `x86_64 arm64`. |
| `airgapp.pck` | 366 MB | `/Users/ivan/Downloads/temp_fake_viz2/airgapp.pck` | Packed `mobile`-feature scene with `web_export_dynamic_scenes` removed. |

## Restore

```sh
cd modules/expo-godot-view/ios
mkdir -p engine
unzip -o -j ~/Library/Application\ Support/Godot/templates/3.2.stable/iphone.zip \
  'libgodot.iphone.debug.fat.a' 'libgodot.iphone.release.fat.a' -d engine
cp /Users/ivan/Downloads/temp_fake_viz2/airgapp.pck airgapp.pck
```

## Critical notes

- **No `arm64-iphonesimulator` slice** (the `arm64` slice is device-only — 2020 pre-xcframework
  era). The engine therefore links/runs on **physical iPhone only**; the podspec must scope the
  engine link to `[sdk=iphoneos*]` so the simulator build (Phase 3 stub) stays green.
- The `.a` bakes in Godot's iOS `main()` + ObjC `AppDelegate`/`GLView` classes (from
  `platform/iphone/main.m` + `app_delegate.mm`). We deliberately **do not** link `main.m`/
  `app_delegate.mm`'s entry path (RN's `AppDelegate.swift` owns the app). Avoid force-loading the
  whole archive with `-ObjC`, which would collide Godot's `AppDelegate` class with Expo's.
- **The car is expected to be invisible** in this `.pck` (missing `Brakes_Std_MRA.png` cascade in
  the Bayberry brake material). Engine-runs + scene-loads + GDScript-executes is the embed bar;
  asset packaging is a later sprint.

## Matching engine source (for headers)

Embed code that calls `iphone_main`/`Main::setup`/`OSIPhone`/`GLView` compiles against Godot 3.2
headers cloned at `/Users/ivan/Work/rpi-filter/godot-3.2-src` (tag `3.2-stable`, matches the
prebuilt `.a` ABI). Reclone: `git clone --depth 1 --branch 3.2-stable https://github.com/godotengine/godot.git`.

### Generated headers (REQUIRED — the source clone alone won't compile)

Godot's headers `#include` build-generated files that a plain clone lacks. After cloning, generate
them into the clone (one-time):

```sh
cd /Users/ivan/Work/rpi-filter/godot-3.2-src
python3 -c "import sys; sys.path.insert(0,'core'); import make_binders; \
  make_binders.run(['core/method_bind.gen.inc','core/method_bind_ext.gen.inc','core/method_bind_free_func.gen.inc'], None, None)"
cat > core/version_generated.gen.h <<'V'
#define VERSION_SHORT_NAME "godot"
#define VERSION_NAME "Godot Engine"
#define VERSION_MAJOR 3
#define VERSION_MINOR 2
#define VERSION_PATCH 0
#define VERSION_STATUS "stable"
#define VERSION_BUILD "custom_build"
#define VERSION_MODULE_CONFIG ""
#define VERSION_YEAR 2020
#define VERSION_WEBSITE "https://godotengine.org"
V
```

`godot_module_stubs.cpp` in this dir stubs `register_{arkit,camera}_types()` (referenced by
libgodot's `register_module_types()`; real impls are in the unlinked module `.a`s).
