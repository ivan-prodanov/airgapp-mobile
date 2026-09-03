# Expo HAS CHANGED

Read the exact versioned docs at https://docs.expo.dev/versions/v56.0.0/ before writing any code.

# Android deploy & build (read before touching the Android app)

Deploy paths (fastest first) — all measured on the Galaxy S22 (`SM-S901B`, arm64-v8a, SDK 36):
- **JS/TS *or* native `.kt` change** → `bash scripts/android/deploy-js.sh` (~40s: ~31s bundle+build, ~9s install). One command covers both; the same incremental build handles either.
- **Godot scene / `.tscn` / `.pck` change** → `bash scripts/android/deploy-godot.sh` (~30s to push the 320 MB pack over USB). Add `--reexport` to re-export from the Godot project first.
- **Charger / gazetteer DB** → `bash scripts/android/deploy-chargers.sh`.

**No weekly signing expiry.** This is the single biggest iOS friction the Android port does not have — the release variant is signed with the checked-in debug keystore and installs indefinitely.

## The build

```bash
cd android && ANDROID_HOME=$HOME/Library/Android/sdk   JAVA_HOME=/Library/Java/JavaVirtualMachines/zulu-17.jdk/Contents/Home   ./gradlew :app:assembleRelease --max-workers=2
```

`ANDROID_HOME` is **not** set in the shell profile — every gradle invocation must export it. Keep
`--max-workers=2`: the release build OOM'd the daemon at higher parallelism and corrupted the
Gradle cache, which then failed in three unrelated places. If you see
`Could not receive a message from the daemon` or a `FileLock ... is null`, that is the corruption —
`./gradlew --stop`, delete `~/.gradle/caches/journal-1` and `*/transforms*`, and rebuild.

## `android/` is HAND-MAINTAINED

Generated once by `expo prebuild --platform android` on 2026-08-21 and committed. **Never prebuild
again** — the same argument that protects `ios/` now applies to it (the Godot embed, the BLE
module's manifest entries). Only build outputs are gitignored.

## `release` means "standalone", not "for distribution"

`android/app/build.gradle` sets `debuggable true` on the release variant deliberately. Release here
means *the JS bundle is embedded so the phone runs untethered* — which is what lets you carry it to
the car. Keeping it debuggable preserves `adb run-as`, the only way to read the app's own SQLite
log afterwards. **Flip that off for any real distribution build.**

A debug build needs Metro over `adb reverse tcp:8081 tcp:8081` and will not start away from the
desk. Use release for anything involving the car.

## Reading what the app did

The app logs to a SQLite ring (`logbus`), **not** to logcat — grepping logcat for app-level events
finds nothing. Pull it with:

```bash
adb shell "run-as local.airgapp.mobile cat files/SQLite/carlink-log.db" > /tmp/cl.db
node -e "const {DatabaseSync}=require('node:sqlite');const db=new DatabaseSync('/tmp/cl.db');for(const r of db.prepare('select * from log order by t desc limit 40').all().reverse())console.log([r.level,r.cat,r.msg,r.data].filter(Boolean).join(' | '))"
```

(`order by t`, not rowid/seq — the JS seq counter restarts per boot and a new boot's rows replace the
oldest ones.) Native BLE and Godot logs **do** go to logcat: `adb logcat -s PassiveEntry:* GodotHost:* godot:*`.

The passive-entry service also writes its own `files/airgapp-native.log` (survives process death and
reboot — the only record of a boot/background wake). `bash scripts/android/pull-logs.sh` pulls both.

## Gotchas that cost real time

- **Kotlin block comments NEST.** A `/*` inside a KDoc — e.g. writing a path like `src/ble/*` —
  opens a nested comment that never closes, and the compiler blames a line hundreds down. Java
  does not do this.
- **`ExpoView` does not lay out natively-added children.** Fabric only knows React children, so a
  view you `addView()` yourself stays at 0x0. For a `GLSurfaceView` that means no surface, no GL
  thread, and an engine that reports "up" while producing no output at all.
- **A BLE scan must be bounded.** Android silently stops delivering results for long-running scans,
  and blocks an app that starts 5 scans in 30s. Both failures look exactly like "no car nearby".
- **`run-as` needs a debuggable build**; there is no adb equivalent of iOS's
  `devicectl copy --domain-type appDataContainer`.

# iOS deploy & signing (read before deploying to the device)

Deploy paths (fastest first):
- **JS/TS change** → `bash scripts/godot-ios/deploy-js.sh` (swaps the Hermes bundle into the standalone Release `.app`, re-signs, installs; ~30s).
- **Godot scene / `.tscn` / `.glb` / `.pck` change** → `bash scripts/godot-ios/deploy-ios.sh` (re-exports the `.pck`, swaps it in, re-signs; ~2 min). NOT a 25-min rebuild.
- **Native `.mm`/`.swift` change** → full `xcodebuild` Release build.

## Provisioning profile expires WEEKLY — renew it yourself, never make the user do it

The dev profile is a **free 7-day** profile, so installs break about once a week. When `devicectl install` fails with `This provisioning profile has expired` (`0xe8008011` / `MIInstallerErrorDomain error 13`), it is NOT a code problem and NOT a locked phone — just renew the profile and continue:

```bash
xcodebuild -workspace ios/airgapp.xcworkspace -scheme airgapp -configuration Release \
  -sdk iphoneos -destination 'generic/platform=iOS' -allowProvisioningUpdates build
```

Then install the freshly-signed `.app` (and re-run `deploy-js.sh` if needed). The project is configured for **automatic** signing (`CODE_SIGN_STYLE=Automatic`, `DEVELOPMENT_TEAM=859B8N529C` "Ivan Prodanov"), and the Apple ID is already in Xcode — so the command above regenerates the profile and re-signs on its own.

**Do NOT** pass `DEVELOPMENT_TEAM=<anything else>` — overriding it (e.g. to the cert's `6248H4VVPZ`) triggers a misleading `No Account for Team …` / `No profiles for 'local.airgapp.mobile'` error and makes it look like the account is missing when it isn't. Let the project settings drive signing; the standalone install uses the `15F2DBAC…` Apple Development identity. The auto-launch hitting `CoreDeviceError 10002` after a successful install is a benign transient — the bundle is installed; just tell the user to tap the app icon.
