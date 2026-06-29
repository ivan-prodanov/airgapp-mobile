# Expo HAS CHANGED

Read the exact versioned docs at https://docs.expo.dev/versions/v56.0.0/ before writing any code.

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
