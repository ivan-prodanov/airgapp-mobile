# Vendored Godot 3.2.2 binaries (gitignored)

These ~450 MB of binaries are required to build the device (iOS) engine embed but are kept out
of git history (see `.gitignore`). Restore them on a fresh checkout with the commands below.

> **Engine version: Godot 3.2.2.stable** (upgraded from 3.2.0 on 2026-06-23). The 2020 stock 3.2.0
> template mis-rendered the S/3/X body textures on iOS-26 / A19 Metal-backed GLES2 (oil-slick garble);
> stock 3.2.2's reworked GLES2 rasterizer renders them correctly. The official Tesla app uses
> `3.2.2.stable.custom` — stock 3.2.2 is sufficient (no custom changes needed). See the
> `s3x-ios-texture-garble` project memory for the full diagnosis.

| File (in this `ios/` dir) | Size | Source | Provenance |
|---|---|---|---|
| `engine/libgodot.iphone.debug.fat.a` | 135 MB | `~/Library/Application Support/Godot/templates/3.2.2.stable/iphone.zip` | Godot 3.2.2.stable iOS export template. Slices: `x86_64 arm64`. The podspec links the **debug** lib (needs `DEBUG_METHODS_ENABLED=1`). |
| `engine/libgodot.iphone.release.fat.a` | 116 MB | same `iphone.zip` | Slices: `x86_64 arm64`. |
| `airgapp.pck` | 320 MB | exported from `/Users/ivan/Work/airgapp/godot` by `deploy-ios.sh` | Packed `mobile`-feature scene (real official textures; iOS preset). Regenerate any time via the deploy script. |

The 3.2.2 export templates come from `Godot_v3.2.2-stable_export_templates.tpz` (a zip of templates);
extract it into `~/Library/Application Support/Godot/templates/3.2.2.stable/` so the editor and the
`iphone.zip` are available. The old 3.2.0 template remains at `templates/3.2.stable/` and an engine
backup is kept (gitignored) at `engine/backup-3.2.0/` for quick revert.

## Restore

```sh
cd modules/expo-godot-view/ios
mkdir -p engine
unzip -o -j ~/Library/Application\ Support/Godot/templates/3.2.2.stable/iphone.zip \
  'libgodot.iphone.debug.fat.a' 'libgodot.iphone.release.fat.a' -d engine
# Regenerate airgapp.pck (patches the project + exports the iOS pck):
bash scripts/godot-ios/deploy-ios.sh      # from repo root; needs Godot 3.2.2 at /Applications/Godot.app
```

> ⚠️ **Changing the engine `.a` requires a full Release rebuild** (it recompiles the embed + relinks),
> not just `deploy-ios.sh` (which only re-exports + swaps the pck). Rebuild:
> `xcodebuild -workspace ios/airgapp.xcworkspace -scheme airgapp -configuration Release -sdk iphoneos \`
> `-destination 'generic/platform=iOS' -allowProvisioningUpdates DEVELOPMENT_TEAM=859B8N529C CODE_SIGN_STYLE=Automatic build`.
> Verify the swap landed: `strings <DerivedData>/…/airgapp.app/airgapp | grep 3.2.2.stable`.

## Critical notes

- **No `arm64-iphonesimulator` slice** (the `arm64` slice is device-only — 2020 pre-xcframework
  era). The engine therefore links/runs on **physical iPhone only**; the podspec must scope the
  engine link to `[sdk=iphoneos*]` so the simulator build (Phase 3 stub) stays green.
- The `.a` bakes in Godot's iOS `main()` + ObjC `AppDelegate`/`GLView` classes (from
  `platform/iphone/main.m` + `app_delegate.mm`). We deliberately **do not** link `main.m`/
  `app_delegate.mm`'s entry path (RN's `AppDelegate.swift` owns the app). Avoid force-loading the
  whole archive with `-ObjC`, which would collide Godot's `AppDelegate` class with Expo's.
- All four models (S/3/X/Y) now render correctly with full fidelity (real textures, AO, panel
  shadows). The `DrawView: 500` (GL_INVALID_ENUM) console spam persists on 3.2.2 but is harmless —
  it fires every frame even for the perfectly-rendering Model Y.

## Matching engine source (for headers)

Embed code that calls `iphone_main`/`Main::setup`/`OSIPhone`/`GLView` compiles against Godot 3.2.2
headers cloned at `/Users/ivan/Work/airgapp/godot-src` (tag `3.2.2-stable`, matches the prebuilt
`.a` ABI). Reclone: `git clone --depth 1 --branch 3.2.2-stable https://github.com/godotengine/godot.git`.
(The embed-used headers — `main/main.h`, `gl_view.h`, `core/os/*`, `class_db.h`, `engine.h`,
`object.h` — are identical or only additively changed 3.2.0→3.2.2, so the embed compiles unchanged.)

### Generated headers (REQUIRED — the source clone alone won't compile)

Godot's headers `#include` build-generated files that a plain clone lacks. After cloning, generate
them into the clone (one-time):

```sh
cd /Users/ivan/Work/airgapp/godot-src
python3 -c "import sys; sys.path.insert(0,'core'); import make_binders; \
  make_binders.run(['core/method_bind.gen.inc','core/method_bind_ext.gen.inc','core/method_bind_free_func.gen.inc'], None, None)"
cat > core/version_generated.gen.h <<'V'
#define VERSION_SHORT_NAME "godot"
#define VERSION_NAME "Godot Engine"
#define VERSION_MAJOR 3
#define VERSION_MINOR 2
#define VERSION_PATCH 2
#define VERSION_STATUS "stable"
#define VERSION_BUILD "custom_build"
#define VERSION_MODULE_CONFIG ""
#define VERSION_YEAR 2020
#define VERSION_WEBSITE "https://godotengine.org"
V
```

`godot_module_stubs.cpp` in this dir stubs `register_{arkit,camera}_types()` (referenced by
libgodot's `register_module_types()`; real impls are in the unlinked module `.a`s).
