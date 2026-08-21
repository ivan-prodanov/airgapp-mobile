# Vendored Godot 3.2.2 Android engine (gitignored)

Mirrors `modules/expo-godot-view/ios/VENDORING.md`. Same engine version as iOS —
**Godot 3.2.2.stable** — and it must not drift from it.

| File | Size | Source |
|---|---|---|
| `src/main/jniLibs/arm64-v8a/libgodot_android.so` | 23 MB | `templates/3.2.2.stable/android_source.zip` → `libs/release/godot-lib.release.aar` → `jni/arm64-v8a/` |
| `src/main/jniLibs/x86_64/libgodot_android.so` | 26 MB | same AAR, `jni/x86_64/` |

## Restore

```sh
bash scripts/android/vendor-engine.sh
```

## Notes

- **x86_64 IS shipped**, so the Android emulator runs the full app. This is a real advantage
  over iOS, where the 2020 engine has no arm64-simulator slice and the engine is device-only.
- **`libc++_shared.so` is deliberately NOT vendored.** React Native ships its own, newer copy;
  two would collide at packaging. `build.gradle` also `pickFirst`s it as a belt-and-braces guard.
- **Page alignment is 4 KB (`0x1000`)**, measured with `llvm-readelf -l` on 2026-08-21. Android
  15+ wants 16 KB alignment on devices with 16 KB pages; the target Galaxy S22 uses 4 KB pages,
  so it loads. If a 16 KB-page device ever matters, rebuild the `.so` from the matching source at
  `/Users/ivan/Work/airgapp/godot-src` (tag `3.2.2-stable`) with a modern NDK:
  `scons platform=android target=release android_arch=arm64v8`.
- The Java runtime under `src/main/java/org/godotengine/` is vendored from that same
  `godot-src` checkout and PATCHED — see the patch notes in that directory.

## Vendored Java runtime — patch set

Copied from `godot-src` (tag `3.2.2-stable`)
`platform/android/java/lib/src/org/godotengine/` — 30 files, ~5,500 lines. Four files carry
patches; everything else is byte-identical to upstream, so a future re-vendor only has to
re-apply these.

| File | Patch | Why |
|---|---|---|
| `Godot.java` | Rewritten as a `ContextWrapper` around the host Activity instead of `extends FragmentActivity`. Downloader removed; `onVideoInit` exposes `containerLayout` instead of calling `setContentView`; `getCommandLine` returns host argv; `restart`/`forceQuit` no-op. | The engine cannot own the Activity or the screen inside a React Native view tree. Direct analogue of `GodotHost.mm` on iOS. `GodotView` does `super(activity)`, so the class must still BE a `Context` — hence `ContextWrapper`. |
| `plugin/GodotPlugin.java` | `getActivity()` unwraps via `godot.getActivity()`; `BuildConfig` import repointed to `expo.modules.godotview`. | Upstream's `Godot` *is* an Activity and ships its own `BuildConfig`; neither holds here. |
| `GodotRenderer.java` | Dropped the two legacy `Godot.singleton_count` / `Godot.singletons` loops. | That is the pre-`GodotPlugin` singleton mechanism, removed from our `Godot.java`. Engine singletons now register through `GodotPlugin` (see `AndroidGodotInterface`), which the adjacent loop already covers. |
| *(deleted)* `GodotDownloaderService.java`, `GodotDownloaderAlarmReceiver.java`, `GodotInstrumentation.java` | Removed | APK-expansion download and process-restart. We use `--main-pack` like iOS, and restarting the process would take the whole RN app down. Removing them also drops the `com.google.android.vending` dependency. |

**Load-bearing:** `java_godot_wrapper.cpp:44` does `FindClass("org/godotengine/godot/Godot")` and
then `GetMethodID` for **17 exact signatures**. The class name, package, and all 17 methods must
survive any future edit — they are `@Keep`-annotated, since nothing in Java calls most of them and
a minifying build would otherwise strip them. Breakage is silent at compile time.
