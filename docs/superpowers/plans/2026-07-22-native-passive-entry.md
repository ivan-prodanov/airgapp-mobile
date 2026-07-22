# Native Background Passive Entry — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Unlock the car on walk-up while the phone is in the user's pocket and the app is suspended — the way the official Tesla app does — by running the VCSEC passive-entry responder in a native iOS module that iOS can wake in the background.

> **STATUS 2026-07-22: ✅ NATIVE PASSIVE ENTRY WORKS ON-CAR (foreground).** The native module unlocked the real car end-to-end with ZERO JS: scan(service 1122)→connect→GATT→SessionInfoRequest handshake (ECDH sessionKey + counter + HMAC ✓)→answered a live challenge with the golden-verified routable seal→**car UNLOCKED** (log: `HANDSHAKE ✓ hmacOK=true` then `auth ANSWERED #1 counter=82 level=2 out=169B`, one answer → grant). All crypto proven off-car first. Phase 1 DONE on-car (Task 1 module loads; Task 2 connect-and-hold, car advertises service `1122`, held ~8 min zero JS; Task 3 single-writer rule). Phase 2 crypto DONE + golden-verified with NO car: Task 4 routable seal ✅ MATCH (169B); Task 5 ECDH sessionKey ✅ MATCH + device-key round-trip (KeychainKey stores JS-supplied key, native fingerprint == JS fingerprint ✅). **The ONLY thing left is BLE GATT I/O** (no crypto unknowns remain):
> - **Task 5c (next, needs car):** GATT layer in Swift — discover service `00000211` + chars `0212`(write)/`0213`(notify), MTU, chunked write, notification reassembly. Wire framing = **2-byte BIG-ENDIAN length prefix + payload, chunked to `MTU−3`** (bleFraming.ts frameForWrite; MAX_BLE_MESSAGE_SIZE=1024). Then `SessionInfoRequest` round-trip: RoutableMessage{toDestination.domain, fromDestination.routingAddress, sessionInfoRequest.publicKey=myPubRaw, uuid=challenge}; parse the reply's `sessionInfo` (Signatures.SessionInfo: publicKey, epoch, counter, clockTime) + verify HMAC: subkey=HMAC-SHA256(sessionKey,"session info"), tag=HMAC-SHA256(subkey, metaTLV[SIG_TYPE=HMAC(6),PERSONALIZATION=vin,CHALLENGE=challenge] ‖ 0xff ‖ sessionInfoBytes) vs respMsg.signatureData.sessionInfoTag.tag. sessionKey = ecdhSessionKey(myPriv, sessionInfo.publicKey). Verify on-car: native handshake logs {epoch,counter,hmacOK}, compare to a JS openDirectSession.
> - **Task 6 DONE on-car:** native answered a real `0213` challenge → car UNLOCKED (foreground).
> - **Task 7 ✅ DONE on-car (app backgrounded / phone locked in pocket):** armed via `start()`, backgrounded, walked away till disconnect, walked back, pulled handle → native re-scanned(1122)→reconnected→re-handshook→`auth ANSWERED counter=112`→**UNLOCK, zero JS.** `CBCentralManager` (restore id) built at APP LAUNCH via `PassiveEntryAppDelegate` (ExpoAppDelegateSubscriber); VIN persisted in UserDefaults. Single-writer enforced: resume/`willRestoreState` only DRIVE when `applicationState==.background`; foreground releases to JS (proven: `willRestoreState: 1 peripherals` fired + released on a fg relaunch). **iOS CEILING (expected, matches official Tesla app):** user **force-quit** (swipe-away) → iOS does NOT relaunch for BLE events (log: only a `foreground launch` reopen after force-quit, never a bg relaunch). **✅ Cold-boot restoration ALSO verified on-car:** reboot → unlock once → walk up → iOS background-relaunched (`willRestoreState bg=true`, re-adopted connected peripheral) → answered `counter=125` → unlock, **relaunch→answer ~1s** (inside the ~6s window; warm-session fallback unneeded). **Fix landed:** reject car-pushed SessionInfo with `hmacOK=false` (was overwriting the verified session → desync risk). **All achievable iOS states now proven** (foreground, backgrounded/pocket, cold-boot restoration); force-quit is the platform ceiling (matches official Tesla app).

**Architecture:** A native `CBCentralManager` (Swift) with CoreBluetooth State Preservation & Restoration holds/re-adopts the BLE link to the car and answers the car's `authenticationRequest` challenge natively, without the JS runtime. It signs with the **existing** enrolled key (read from the shared Keychain) using the **routable** seal already proven on-car. Foreground passive entry keeps using the existing JS inline responder; native only runs while backgrounded — so the two never sign concurrently (single-writer by lifecycle). Commands are unchanged (Pi when away, BLE when near); this plan does not alter them.

**Tech Stack:** Expo SDK 56 custom native module (Swift, no `expo prebuild`), CoreBluetooth (`bluetooth-central` + `location` background modes, State Restoration), CryptoKit (P-256 ECDH) + the routable AES-GCM seal, Keychain (shared access group with expo-secure-store), existing `src/ble` TS for the foreground path.

## Global Constraints

- **ONE enrolled key.** Reuse the existing device key (`loadOrCreateDeviceKeys`, stored by expo-secure-store). NO second whitelist slot, NO second enrollment. (Routable removes the nonce-reuse hazard — RE #8/#9 confirmed on-car.)
- **Routable seal only** for the auth response: `RoutableMessage{ UnsignedMessage{ authenticationResponse } }`, `AES_GCM_Personalized` random 12-byte nonce, `to.domain=VEHICLE_SECURITY(2)`, `uuid={0x00}`, no token bound. Byte-for-byte match to what `buildRoutablePassiveResponse` (src/ble/session.ts) already emits and the car GRANTed 2026-07-22.
- **Never two BLE centrals to the car from this phone at once** (two-manager contention, proven fatal). Native owns BLE in background; the existing JS path owns it in foreground; the two are lifecycle-exclusive.
- **No `expo prebuild`** (clobbers the custom Godot `ios/`). Add the native module via the manual pattern used for `modules/expo-apple-search` / `modules/expo-bg-task`, then `pod install` (LANG=en_US.UTF-8) + full `xcodebuild`.
- **Deploy:** native `.swift` changes need a full `xcodebuild` Release build (per AGENTS.md), NOT `deploy-js.sh`.
- **Every claim about the car is verified on-device**, never inferred — the project rule.

---

## Confirmed decisions (do NOT relitigate — this section exists to stop the thrash)

These are settled by on-car evidence + RE. A task that contradicts one of these is wrong.

1. **One key, shared.** Native reads the same key JS uses from the Keychain. No second key. (If — and only if — a future security review wants a non-extractable Secure-Enclave key, that becomes a *separate* key = second enrollment; explicitly out of scope here.)
2. **Routable works, legacy is retired-pending.** Native emits routable. (Legacy `gcmShortIv` stays in the JS tree as reference until routable is the sole path everywhere; native never emits legacy.)
3. **Commands are not touched by this plan.** They go Pi (away) / BLE (near) exactly as today. This plan is *only* the background passive-entry responder.
4. **Single-writer by lifecycle.** Background → native is the sole signer (JS suspended, so it isn't driving the Pi, so nothing else signs). Foreground → native stands down, JS inline responder handles passive. Each side reads the car's current counter (via a `SessionInfoRequest`) before it signs, so their local counters never need syncing.
5. **Car tolerates Pi central + phone BLE central simultaneously** (probe-confirmed 2026-07-22). So native BLE and the Pi command path coexist with no eviction.
6. **Background scan filter = service UUID `1122`.** On-car 2026-07-22 the car advertises the 16-bit service `1122` (NOT the full GATT `00000211`). Background scanning (which forbids nil-scan) filters on `CBUUID(string:"1122")`. Confirmed connect-and-hold works (Task 2, held ~8 min with zero JS).

## Open question routed to RE (do NOT improvise — blocks Phase 4 only)

**REQUEST-12 (to write in Task 0):** the exact foreground↔background handoff. In the foreground the JS command path may hold its own `DirectBleTransport` central; native must take over BLE on background *without* a moment where both hold a central to the car. Precisely: (a) does iOS `willResignActive`/`didEnterBackground` reliably fire before suspension so JS can drop its central first; (b) should native instead own the ONE central full-time (foreground + background) with JS bridging BLE commands through it (RESPONSE-7 L1's model), making the handoff moot; (c) the state-restoration timing relative to JS teardown. Phases 1–3 do not depend on this; Phase 4 does.

## Gating

- **No wake-latency spike.** The official Tesla app ships this exact mechanism (CoreBluetooth State Restoration + `bluetooth-central`), so "does iOS wake a suspended app on a BLE event" is settled — it does; force-quit is the known ceiling; reboot relaunches via restoration. Re-measuring that pre-build gives no decision-relevant data. Build the responder directly.
- **The one real latency unknown is measured on the working build, not before:** when native wakes COLD (session dropped), does re-handshake (`SessionInfoRequest`) + seal fit the car's ~6 s window? This is the acceptance test of Task 7 (background answer). **Fallback if too slow: keep the session warm** (avoid the cold re-handshake) — a standard technique the official app likely uses. Not a gate; a known mitigation.
- **REQUEST-11 (drive vs unlock) shapes ROI.** If drive is UWB-gated (unlock-only ceiling), passive entry is "unlock only" — still worth it, but the user should know before Phase 2. Not a hard block.

---

## File Structure

**New native module** (manual Expo module, iOS-only for now):
- `modules/expo-passive-entry/expo-module.config.json` — module registration.
- `modules/expo-passive-entry/index.ts` — JS API surface (`start/stop/isRunning`, event emitter for probe logs).
- `modules/expo-passive-entry/ios/PassiveEntryModule.swift` — Expo `Module` bridge (JS↔native).
- `modules/expo-passive-entry/ios/PassiveEntryCentral.swift` — the `CBCentralManager` owner: restore identifier, scan/connect-and-hold, `0213` notify handler, `willRestoreState`.
- `modules/expo-passive-entry/ios/VcsecSigner.swift` — P-256 ECDH + SHA1-KDF + the routable AES-GCM seal + counter (Phase 2+; absent in the Phase-1 spike).
- `modules/expo-passive-entry/ios/KeychainKey.swift` — reads the shared device key.

**Modified:**
- `ios/airgapp/Info.plist` — `UIBackgroundModes` (`bluetooth-central`, `location`), and (Phase 3) the CB restore identifier.
- `src/state/useCarLink.ts` — start/stop the native module on lifecycle; native stands down in foreground (Phase 4).

**Pure logic that IS unit-tested (TS, node):**
- `src/ble/passiveLifecycle.ts` — the single-writer-by-lifecycle state machine (who may sign: `native` | `js` | `none`), pure and node-tested. This is the coordination brain, kept in TS so it's testable and shared conceptually with native (native reads the same rule).

---

## Phase 1 — Native module + connect-and-hold central

**Purpose:** stand up the native module and hold a BLE link to the car. These are the load-bearing building blocks of the responder, not a throwaway spike — the mechanism is already proven by the shipping Tesla app, so we build straight toward answering a challenge.

### Task 1: Scaffold the native module (no logic yet)

**Files:**
- Create: `modules/expo-passive-entry/expo-module.config.json`
- Create: `modules/expo-passive-entry/index.ts`
- Create: `modules/expo-passive-entry/ios/PassiveEntryModule.swift`
- Modify: `package.json` (add the module to the workspace if needed, mirroring `modules/expo-bg-task`)

**Interfaces:**
- Produces: `NativePassiveEntry.start(vin: string): void`, `NativePassiveEntry.stop(): void`, `NativePassiveEntry.addListener('log', (line: string) => void)` — the JS surface Phase-1 uses to start the central and stream wake logs.

- [ ] **Step 1: Copy the module skeleton from `modules/expo-bg-task`.** Replace names with `ExpoPassiveEntry`. `expo-module.config.json` registers `PassiveEntryModule`. `index.ts` exports `start/stop/addListener` bound to the native module via `requireNativeModule('ExpoPassiveEntry')`.

- [ ] **Step 2: `PassiveEntryModule.swift` — a stub Module.** Define `Name("ExpoPassiveEntry")`, `Events("log")`, `Function("start")` / `Function("stop")` that just `sendEvent("log", ["line": "start(vin) called"])`. No CoreBluetooth yet.

- [ ] **Step 3: `pod install` + full build, verify it loads.**

Run: `LANG=en_US.UTF-8 npx pod-install ios && xcodebuild -workspace ios/airgapp.xcworkspace -scheme airgapp -configuration Release -sdk iphoneos -destination 'generic/platform=iOS' -allowProvisioningUpdates build`
Expected: build succeeds; no dyld/symbol errors at launch. (Watch the `ExpoModulesCore` version-pin gotcha — the new module must not pull a newer core.)

- [ ] **Step 4: Wire a temporary "Start native central" button in the carlink harness** (`src/app/carlink.tsx`) that calls `NativePassiveEntry.start(vin)` and `append`s each `log` event. Deploy via full build, tap it, confirm `start(vin) called` appears.

- [ ] **Step 5: Commit.** `git commit -m "feat(native): scaffold expo-passive-entry module (spike, no logic)"`

### Task 2: Connect-and-hold central + wake logging

**Files:**
- Create: `modules/expo-passive-entry/ios/PassiveEntryCentral.swift`
- Modify: `modules/expo-passive-entry/ios/PassiveEntryModule.swift` (own a `PassiveEntryCentral`)
- Modify: `ios/airgapp/Info.plist` (`UIBackgroundModes`: `bluetooth-central`, `location`)

**Interfaces:**
- Consumes: `start(vin)` / `stop()` from Task 1.
- Produces: timestamped `log` lines for every CB lifecycle callback (`didUpdateState`, `didDiscover`, `didConnect`, `didDisconnect`, `willRestoreState`, and — critically — the process launch time + launch reason).

- [ ] **Step 1: `PassiveEntryCentral`** — a `CBCentralManager` (delegate) created WITH `CBCentralManagerOptionRestoreIdentifierKey: "airgapp.passiveentry"`. On `poweredOn`, scan for the VIN-derived local name (port `vehicleLocalName` logic — reuse the exact `S<hex>C` derivation from `src/ble/bleScanName.ts`; hardcode the algorithm in Swift, it's SHA1(utf8(vin))[0:8]). On discover-match, `connect` and hold (no GATT ops needed for the spike). Log every callback with `Date().timeIntervalSince1970`.

- [ ] **Step 2: Log the launch reason + wake deltas.** In `PassiveEntryModule` init (which runs on app launch, including background relaunch), log the process start time and — from the app delegate or `ProcessInfo` — whether this launch is a background BLE/location wake. Emit these as `log` events; ALSO append them to the diagnostics file directly from native (write to the same `Documents/airgapp-diagnostics.log`) so they survive when JS isn't running.

- [ ] **Step 3: `willRestoreState`** — implement `centralManager(_:willRestoreState:)`: read `CBCentralManagerRestoredStatePeripheralsKey`, re-adopt the peripheral, log `"restored N peripherals at <t>"`. (Restoration is required infrastructure for the background answer in Task 7; wire it now while the central is fresh in context.)

- [ ] **Step 4: Build, deploy, foreground sanity check.** Near the car, start the central from the harness; confirm the log shows `didConnect` and the link holds (a `didDisconnect` only when you walk out of range). This proves connect-and-hold works — enough to move to the signer.

- [ ] **Step 5: Commit.** `git commit -m "feat(native): connect-and-hold central + state restoration"`

---

## Phase 2 — Native routable signer (gated on Phase 1; pure crypto, verifiable against JS)

Port the proven routable seal to Swift and verify byte-for-byte against the TS implementation before it ever touches the car.

### Task 3: `passiveLifecycle.ts` — the single-writer rule (pure TS, TDD)

**Files:**
- Create: `src/ble/passiveLifecycle.ts`
- Test: `src/ble/passiveLifecycle.test.ts`

**Interfaces:**
- Produces: `whoMaySign(state: { appActive: boolean; nativeUp: boolean }): 'native' | 'js' | 'none'` — the single-writer arbiter both sides consult.

- [ ] **Step 1: Write the failing test.**

```ts
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { whoMaySign } from './passiveLifecycle';

test('foreground → JS signs, native stands down', () => {
  assert.equal(whoMaySign({ appActive: true, nativeUp: true }), 'js');
});
test('background with native up → native signs', () => {
  assert.equal(whoMaySign({ appActive: false, nativeUp: true }), 'native');
});
test('background, native not up → nobody signs (no phantom signer)', () => {
  assert.equal(whoMaySign({ appActive: false, nativeUp: false }), 'none');
});
test('foreground, native not up → JS (the path we have today)', () => {
  assert.equal(whoMaySign({ appActive: true, nativeUp: false }), 'js');
});
```

- [ ] **Step 2: Run it, verify FAIL** (`node --import tsx --test src/ble/passiveLifecycle.test.ts` → "whoMaySign is not a function").

- [ ] **Step 3: Implement.**

```ts
// The single-writer rule: exactly one of {native, js} may answer a passive
// challenge at any instant. Foreground → JS owns it (existing inline responder).
// Background → native owns it (JS is suspended, so it isn't driving the Pi;
// native is the only possible signer). This is what keeps the shared-key counter
// race from ever opening — see the plan's Confirmed Decision #4.
export function whoMaySign(state: { appActive: boolean; nativeUp: boolean }): 'native' | 'js' | 'none' {
  if (state.appActive) return 'js';
  return state.nativeUp ? 'native' : 'none';
}
```

- [ ] **Step 4: Run, verify PASS.**
- [ ] **Step 5: Commit.** `git commit -m "feat(ble): single-writer-by-lifecycle rule for passive entry"`

### Task 4: Swift routable seal, verified against TS golden vectors

**Files:**
- Create: `modules/expo-passive-entry/ios/VcsecSigner.swift`
- Create: `modules/expo-passive-entry/ios/KeychainKey.swift`
- Create (golden vectors): `src/ble/__fixtures__/routableSeal.golden.json` + a small node script `scripts/gen-routable-golden.ts`

- [ ] **Step 1: Generate golden vectors from the PROVEN TS path.** Write `scripts/gen-routable-golden.ts` that, for a FIXED key/epoch/counter/nonce/challenge, calls `buildRoutablePassiveResponse` (with a deterministic nonce injected) and dumps `{ inputs, expectedFrameHex }`. These are the ground truth — the TS path is on-car-proven.

- [ ] **Step 2: `KeychainKey.swift`** — read the device key from the shared Keychain access group (the same item expo-secure-store wrote). Return the P-256 private scalar + public raw. (Confirm the access group + accessibility with a `SecItemCopyMatching` query; log the fingerprint so we can match it to `deviceKeyFingerprint`.)

- [ ] **Step 3: `VcsecSigner.swift`** — implement ECDH (`P256.KeyAgreement`), `sessionKey = SHA1(ecdh)[:16]`, and the AES-GCM routable seal producing the `RoutableMessage` bytes. Accept an injectable nonce for the golden test. Encode the protobuf either via a minimal hand-rolled encoder (the RoutableMessage shape is fixed and small) or a vendored SwiftProtobuf — decide in this step and note it.

- [ ] **Step 4: Add a `Function("sealGolden")`** to the module that runs `VcsecSigner` over the golden inputs and returns the frame hex. Build, deploy, call it from the harness, and assert the returned hex EQUALS `expectedFrameHex`. **This proves the Swift seal is byte-identical to the on-car-proven TS seal without risking a car frame.**

- [ ] **Step 5: Commit.** `git commit -m "feat(native): Swift routable VCSEC signer, byte-verified vs TS golden"`

### Task 5: Native session handshake (`SessionInfoRequest`) + counter

- [ ] **Step 1:** Implement `SessionInfoRequest` in Swift over the held `0212/0213` characteristics: send the request, parse `SessionInfo` (epoch, counter high-water, clock), verify the HMAC (port `_verifySessionInfoHmac`). This gives native the fresh counter it seals from — Confirmed Decision #4.
- [ ] **Step 2:** On-car: from the harness (foreground, native central up), do a native handshake and log the parsed `{epoch, counter}`; cross-check it matches what a JS `openDirectSession` reads at the same moment.
- [ ] **Step 3: Commit.** `git commit -m "feat(native): SessionInfoRequest handshake + counter sync"`

---

## Phase 3 — Answer a real challenge from the background (gated on Phase 1 numbers)

### Task 6: Native `0213` challenge → routable response, foreground first

- [ ] **Step 1:** In `PassiveEntryCentral`'s `didUpdateValueForCharacteristic` (`0213`), parse `FromVCSECMessage.authenticationRequest` (port `parseAuthenticationRequest`); if it's a challenge, build the routable response via `VcsecSigner` and write it to `0212`. Rate-limit + circuit-break exactly like the TS `makeAuthResponder`.
- [ ] **Step 2: On-car, FOREGROUND, official-app Bluetooth OFF:** with the native central holding the link (JS passive disabled for this test), walk up and pull the handle. Expect the car to unlock and a routable ack (the frame decoded 2026-07-22). Pull the log; confirm `GRANTED`.
- [ ] **Step 3: Commit.** `git commit -m "feat(native): answer passive challenge natively (foreground proof)"`

### Task 7: Background wake → answer (the payoff + the one real latency measurement)

- [ ] **Step 1:** Ensure the challenge path runs from a `willRestoreState` cold wake: on restore, re-adopt the peripheral, re-handshake if the session is cold (native session cache is RAM-only; a cold wake re-runs `SessionInfoRequest`), then answer. All native, no JS. **Log timestamps** at: wake, handshake-done, `0213`-challenge-received, `0212`-answer-written.
- [ ] **Step 2: On-car, BACKGROUNDED, phone in pocket, official-app BT OFF:** walk up, pull handle. Expect unlock. Pull the log (native wrote it). Confirm the wake→answer path fired with no JS.
- [ ] **Step 3: Read the measured latency** (challenge-received → answer-written, and whether a cold re-handshake was needed). **This is the one real latency unknown.** If a cold wake answers within the car window → done. If it's too slow → apply the keep-warm mitigation: hold the session across the wake (don't drop the `sharedSecret`/counter on background), so the wake only pays the ~one-seal cost, not a full re-handshake. Re-measure.
- [ ] **Step 4: Commit.** `git commit -m "feat(native): background-wake passive unlock (M2 payoff)"`

---

## Phase 4 — JS↔native coordination (BLOCKED on REQUEST-12)

Do not start until REQUEST-12 answers the foreground↔background BLE-ownership handoff. Then:

### Task 8: Lifecycle wiring in `useCarLink`

- [ ] **Step 1:** On `AppState` → background, call `NativePassiveEntry.start(vin)`; on → active, `NativePassiveEntry.stop()` and let JS resume (per `whoMaySign`). Ensure JS drops its `DirectBleTransport` central before native starts (or route per REQUEST-12's answer) so there is never two phone centrals at once.
- [ ] **Step 2:** On-car soak: background/foreground transitions repeatedly near the car; confirm no two-manager contention (no `Operation was cancelled` storms) and passive entry works in both states.
- [ ] **Step 3: Commit.**

---

## Self-review notes

- **Spec coverage:** connect-and-hold central (Task 2), native signer verified vs proven TS (Task 4), single-writer rule (Task 3), handshake/counter (Task 5), foreground proof (Task 6), background wake + the one real latency measurement (Task 7), lifecycle wiring (Task 8). One key / routable / no-Pi-command-change are pinned in Global Constraints + Confirmed Decisions.
- **Known gaps by design:** the exact foreground BLE-ownership handoff (REQUEST-12, blocks Phase 4 only); whether drive is achievable (REQUEST-11, ROI only); Android (out of scope — iOS first, Android mirrors later per RESPONSE-7).
- **Anti-thrash:** the "Confirmed decisions" section is the anchor. Any task that reintroduces a second key, moves commands onto Pi as a requirement, or has JS open a second BLE central is a plan violation.
