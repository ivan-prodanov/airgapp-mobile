# Open-then-minimize on relaunch: root cause and fix

**Date:** 2026-11-07
**Status:** All three bugs are fixed on `feat/ble-carlink` and verified on device. Bug 3 is what you see after a swipe-kill and reopen.
**Repo:** `mobile` (embedded Godot 3.2.2 via `modules/expo-godot-view`).

This doc began as a handoff blaming the `CADisplayLink` teardown for the bug. That was a real crash, but it was not what you see when you relaunch the app. Three bugs were being reported as one, and they are separated below. Bug 3 was found last and is the only one that leaves no crash report.

---

## Summary

| | Bug 1: heap overflow | Bug 2: dangling display link |
|---|---|---|
| **What you see** | App opens, then minimizes, about 1 launch in 20 | Crash when the Godot view unmounts |
| **When** | 0.3 to 1 s after launch, on any launch | Whenever `VehicleCanvas` unmounts |
| **Crash signature** | `BUG IN CLIENT OF LIBMALLOC: memory corruption of free block`, usually in `hermes::bigint::div_rem` | `EXC_BAD_ACCESS` or `unrecognized selector ... drawView:` in `-[GLView drawView]` |
| **Cause** | Godot headers compiled with different defines than the prebuilt engine | `GodotHost` freed while its display link was still firing |
| **Fix** | Match the defines, add compile-time guards | Host lives for the whole process |

Rapid relaunching did not cause Bug 1. It only produced many launches, and each launch had the same chance of crashing. A swipe-kill ends the old process, so nothing from it can interfere with the new one, which rules out the race this doc originally proposed.

---

## Bug 1: heap overflow from an ABI mismatch

`ExpoGodotView.podspec` links the prebuilt `libgodot.iphone.debug.fat.a` but compiled our `.mm` files against the Godot headers without two of the defines the engine was built with:

- `DEBUG_ENABLED` (from `scons target=release_debug`) adds members to `Object`.
- `PTRCALL_ENABLED` (from `modules/gdnative`, which sets `use_ptrcall`) adds a `MethodBind` virtual, which shifts vtable slots.

The podspec only set `DEBUG_METHODS_ENABLED`, which is enough to fix the link error it was added for. `core/method_bind.h` normally derives it from `DEBUG_ENABLED`, so defining it alone hid the real mismatch.

The result is that the two sides disagree about sizes:

| Type | Our code allocated | Engine writes |
|---|---|---|
| `Object` | 200 | 216 |
| `IOSGodotInterface` (GDCLASS) | 208 | 224 |
| `InputEventScreenTouch` | 352 | 368 |
| `InputEventScreenDrag` | 368 | 384 |

### How that becomes "opens then minimizes"

1. `register_ios_godot_interface()` runs `memnew(IOSGodotInterface)` once per launch and allocates 208 bytes.
2. Godot's debug allocator adds a 16-byte header, so the request is 224 bytes and fills a 224-byte block exactly.
3. The engine's `Object::Object()` ends with `strb wzr, [x19, #0xd0]`, a zero byte at offset 208. That is one byte past the allocation, and it lands on offset 0 of the next heap block.
4. If that next block is free, offset 0 is its freelist cookie. The next `malloc` to use the block fails its cookie check and aborts.

Whether it crashes depends on what sits next to the allocation, which is why it looked random. The crash usually appears in BigInt `%` only because that was the busiest user of the 224-byte class at that moment: each 512-bit `%` allocates 216 bytes of scratch space.

### Evidence

- Every heap-corruption crash on the phone fits the 224-byte size class, and it is the only class that fits them all.
- In the two crashes captured by a flight recorder with no debugger attached, exactly one byte differed from the expected cookie: `...7f6c` became `...7f00`, and `...bb0d` became `...bb00`. The rest of each block was a healthy free block.
- In the capture inspected in detail (trap-8541), the vtable of the block below matched `__ZTV17IOSGodotInterface` plus the slide, and its allocation was about 20 µs before the `frame1.setup2.end` mark.
- The fixed build calls `alloc_static` with `mov w0, #0xe0` (224), up from 208.

### The orbit drag overflow

`GodotHost.mm` calls `Ref<InputEventScreenTouch>::instance()` in `handlePan:`, which also allocates from our smaller size while the constructor runs in the engine. Every orbit drag on the Controls screen overran the heap by 16 bytes. The same define fixes it.

This may also be related to the older touch crash described in the comment above `glView.userInteractionEnabled = NO`, but that has not been tested.

### The fix

- `ExpoGodotView.podspec`: set `DEBUG_ENABLED=1 PTRCALL_ENABLED=1`, and drop `DEBUG_METHODS_ENABLED=1` because it is now derived.
- `IOSGodotInterface.mm` and `GodotHost.mm`: `#error` and `static_assert` guards, so a mismatch now fails the build. Checked against the same guard code in a scratch file: the old defines fail, `DEBUG_ENABLED` alone fails, and the new set passes.

A header scan found no other define that differs from the engine build.

If the engine `.a` is ever replaced, the `static_assert` values must be re-checked against that build.

---

## Bug 2: dangling display link

`CADisplayLink` retains the `GLView`, and `GLView.delegate` is a plain `assign` pointer to `GodotHost`. When `ExpoGodotView` was freed, `GodotHost` went with it, but the display link kept firing into freed memory.

Stopping the link in `dealloc`, as this doc first suggested, is not enough. A remounted view would then call `iphone_main` a second time, and Godot's singletons are process-wide.

**The fix:** `GodotHost` now lives for the whole process. `+attachToParentView:pckPath:` boots the engine once and moves the existing `GLView` to whichever view is currently mounted. `-detachFromParentView:` parks it when that view goes away, unless a newer view has already taken over. The delegate can no longer dangle, and a remount no longer kills the engine.

The JS routing guards from `c2ceffc` should stay, because avoiding a remount is still cheaper than recovering from one.

---

## Cold start, compared with Tesla

Startup speed does not cause either bug. The connection is only that the boot crypto was the busiest user of the 224-byte class, so it was usually what tripped over the corrupted block.

Timings from a recorder build (which adds some overhead), in ms since exec, on one launch:

| Stage | Time |
|---|---|
| Our static constructor runs (dyld finished) | 191 (25 on another launch) |
| `GodotHost.init` | 373 |
| `iphone_main` done | 389 |
| `Main::start` done | 581 |
| Fifth engine frame done | about 1,000 |

Godot's own boot is cheap and was not the main cost. The largest JS-thread stall we found was `p256.getPublicKey` in `loadDeviceKeys`, which took **449 ms on every launch**. noble builds a precompute table on first use, and under Hermes each `%` is a heap allocation plus a bit-at-a-time long division. In runs where it got in first, JS could not tell Godot which car to show until it finished.

**The fix:** `loadOrCreateDeviceKeys` now takes an optional native deriver, wired to the existing `VcsecSigner.devicePublicKey` in CryptoKit. The key is still re-derived rather than cached, which keeps the existing rule in `keystore.ts`. On the real key, the native result matched noble byte for byte, and key loading took 5 ms. Android uses its existing Kotlin `VcsecSigner.devicePublicKey`, the same derivation its passive-entry responder already uses (see below).

**What that gained, from the ring log (ms after JS boot, 200 launches before, 120 after):**

| Event | Before, median | After, median | Before, p90 | After, p90 |
|---|---|---|---|---|
| `GODOT_READY` | 511 | 205 | 519 | 214 |
| `FIRST_PRODUCT_LOADED` | 512 | 397 | 521 | 502 |

Expect a modest visible change, not a transformed launch. The JS thread is free about 300 ms sooner, but the car only arrives about 115 ms sooner at the median, and possibly less on screen. These timestamps record when JS received each message, and JS was stalled until about 510 ms, so the engine may have finished loading the car before the "before" figure. Launches where the stall delayed `godot boot` benefit most.

**Android, Galaxy S22 (ms after JS boot, 20 cold launches each via `am start -W`, same tree with and without the Kotlin function):**

| Event | Before, median | After, median | Before, p90 | After, p90 |
|---|---|---|---|---|
| `godot boot` (JS tells Godot) | 228 | 224 | 254 | 295 |
| `GODOT_READY` | 1,366 | 957 | 1,474 | 1,011 |
| `FIRST_PRODUCT_LOADED` | 1,565 | 1,457 | 1,675 | 1,506 |

The same shape as iOS: JS hears `GODOT_READY` about 410 ms sooner, but the car arrives only about 110 ms sooner at the median (170 ms at p90), and the slowest launch went from 1,965 to 1,511 ms. Android's engine is much slower to get ready than iOS's either way (about 0.95 s against 0.2 s).

We have not measured Tesla's app or on-screen time, so this compares our own before and after, not the two apps.

### Why `FIRST_PRODUCT_LOADED` was still bimodal: JS waited on Godot's first car frame

After the key fix, some launches still logged `FIRST_PRODUCT_LOADED` (FPL) at about 510 ms instead of about 395 ms. The JS thread was waiting on the main thread. The car itself was not slower.

**Godot's main-thread timeline** (native trace of every engine frame, 135 launches):

| Frame | Time after JS boot | What it does |
|---|---|---|
| 2 | 99 to 206 ms (medians) | `Main::start`. Sends `GODOT_READY` at the end. |
| 3 | 206 to 527 ms (medians); 253 to 351 ms long | Drains the message queue, loads the car (`SHOW_PRODUCT`, 175 to 200 ms), sends FPL from inside that handler (median 394 ms), then handles the rest of the queue and draws. |

**The wait:** a few ms after `GODOT_READY`, `useCarLink` arms passive entry and calls `setForegroundResponderActive(true)`. It was a synchronous Expo `Function`, so it ran on the JS thread. Its refusal check reads `applicationState` through `DispatchQueue.main.sync`, and it does that on every `true` call, before the already-set early return.

- If the call reached main before frame 3 began, it took under 5 ms.
- If frame 3 had just begun, JS waited for the whole frame, 242 to 317 ms. Every native-to-JS event, FPL included, was handled only afterwards.
- `foregroundBleLink.start` makes the same call first thing. A command `openSession` that fell back to BLE during frame 3 waited the same way.

In the ring log for 2026-11-07, 265 launches had a normal `GODOT_READY`. 44 of them were slow, and every one shows this: in 20 the `foregroundResponderActive=true` row, and in 24 a BLE `openSession` result, lands within 2 ms of FPL.

**Fix:** `setForegroundResponderActive` is now an `AsyncFunction` on the main queue. The check still runs on main against the real state, at the same point in the main queue where the `main.sync` block ran, but JS returns at once. The flag also now changes on the queue its CoreBluetooth readers use. The central has `queue: nil`, so the old JS-thread write raced them.

**Measured** on one instrumented binary (a native frame trace, plus timing of every synchronous JS-to-native call), with the variants in interleaved blocks of 15 launches:

| | Synchronous (before) | Main-queue AsyncFunction |
|---|---|---|
| Launches | 45 | 90 |
| FPL over 450 ms | 4 | 0 |
| FPL p90 / max | 432 / 514 | 406 / 415 |
| Most JS heard FPL after Godot sent it | 129 ms | 0 ms |
| Native FPL / end of frame 3, medians | 395 / 525 | 394 / 528 |

One-sided Fisher p is about 0.011 for 4/45 against 0/90.

To force the race, a test bundle made the same call from the FPL handler, which always runs during frame 3. The synchronous call blocked for 113 to 136 ms in 9 of 10 launches and returned in the same millisecond frame 3 ended. The async call returned in 0 to 1 ms in 10 of 10.

On the shipping build (540f4f1) with only the JS timing added, 5 of 70 launches were slow. Each was this call, blocked for 242 to 317 ms.

The committed fix, built clean, ran 30 launches: 0 were slow, with FPL median 399 ms and p90 412 ms. The native flag switched on in all 30, with no refusals. When the app was sent to the background, the flag switched off within the 1-second resolution of `airgapp-native.log`, and back on when it returned. Not yet tried at the car.

**What this does not change: when the car is on screen.** The FPL row is when JS heard about it. Godot sends FPL in the middle of frame 3, and the frame that draws the car ends at about 525 ms in every launch, before and after this fix. A "fast" launch's 395 ms FPL is about 130 ms before the car can be on screen. To time launch-to-car, use the end of that frame, not the FPL row. The fix gives the JS thread back up to about 300 ms during launch. It does not make the car appear sooner.

**Addressed later (see "The first car frame applied the scene twice" below):** frame 3 itself holds the main thread, and therefore all UIKit and React Native UI, for about 300 ms. About 110 ms of it, after the car load, is the queue being drained twice. `boot()` queues the scene messages before `GODOT_READY`, and none are dropped. Then `resync('godot-ready')` queues them all again, including a second `SHOW_PRODUCT` and two more `GET_VEHICLE_MARKERS`. Each marker response costs about 19 ms.

**Other costs not addressed:**
- Live car data takes about 3 s over the Pi relay, mostly `openSession` at 2 to 2.5 s. This may be a large part of how slow launch feels, and `docs/RECONNECT-LATENCY-FLAP-2026-11-07.md` covers related relay latency.
- We link Godot's debug template, which calls `glGetError` and `NSLog`s `DrawView: 500` every frame. The release template was measured and does not launch faster (next subsection). Switching is one line, `godot_engine` in `ExpoGodotView.podspec`, and needs no rebinding: `D_METHOD` compiles either way.
- The engine's `OSIPhone::initialize` starts Game Center login on launch, and links StoreKit and iCloud support. A custom engine build could drop them, but stock `iphone.zip` cannot.

### Process start to car, and the release engine (not faster)

Interleaved A/B on the iPhone, 12 blocks of 10 cold launches (60 per engine), first launch after each install not counted. Both apps were built from the same tree with the same JS bundle and `.pck`; only `godot_engine` differed. A temporary native trace added the process start (`sysctl` `p_starttime`) and our static initialisers to the frame trace above. Every launch was traced with the expected engine label, became active, and switched `foregroundResponderActive=true`. Medians in ms:

| Phase | Debug engine | Release engine | Release − debug [95% CI] |
|---|---|---|---|
| Process start → our static initialisers (pre-`main`) | 24 | 24 | 0 [0, 1] |
| Static initialisers → JS `app boot` | 131 | 131 | 0 [−1, 1] |
| JS `app boot` → `iphone_main` | 40 | 40 | 0 [−1, 1] |
| `iphone_main` (`Main::setup`) | 12 | 11 | −1 |
| Frame 1 | 25 | 18 | −7 [−8, −7] |
| Frame 2 (`Main::start`) | 104 | 106 | +2 [−2, 7] |
| Car load (`SHOW_PRODUCT` → FPL sent) | 180 | 189 | +9 [5, 13] |
| Frame 3 | 315 | 331 | +16 [10, 22] |
| `GODOT_READY` sent, from process start | 359 | 354 | −5 [−9, 0] |
| **Car on screen** (end of frame 3), from process start | **680** | **688** | **+8 [0, 16]** |

The release engine reaches `GODOT_READY` slightly sooner but loads the car slightly slower, so the car is no sooner. We stay on the debug engine. The ABI `static_assert`s now hold the values for both engines, read from each `.a` (the size passed to the allocator in `ClassDB::creator<T>`): `Object` 216/200, `InputEventScreenTouch` 368/352, `InputEventScreenDrag` 384/368.

Where the ~680 ms goes: about 155 ms before JS boots (React Native and the bundle), 40 ms until React lays out the Godot view, and then about 485 ms of Godot on the main thread (`iphone_main` to the end of frame 3), of which the car load is ~180 ms and the duplicate queue drain ~110 ms (since cut by about 83 ms, next subsection). Godot cannot start until React mounts its view at about 195 ms after process start; starting the engine natively at launch could overlap part of frames 1 and 2 with JS startup, at the cost of main-thread contention with React Native's own mount. Not tried.

### The first car frame applied the scene twice

The car arrives at the end of Godot's first car frame: the frame after `GODOT_READY`, which holds the main thread for about 300 ms. That frame drains the whole host-to-Godot queue. `GodotRendererBridge.boot()` had queued the scene before `GODOT_READY`, and the bridge queued it again on `GODOT_READY` (`resync('godot-ready')`), so the engine handled two batches in that one frame.

Applying the second batch took about 0.3 ms, because the second `SHOW_PRODUCT` returns at once for an already-loaded car. The cost was the marker requests. There were 4 to 5 `GET_VEHICLE_MARKERS` in the frame: each batch asked twice, once directly and once from the 0 ms timer that a non-animated `moveCamera` already sets, and `updateFrame` usually asked once more. `VehicleManager.on_get_vehicle_markers` waits for `frame_post_draw` and then reads the whole viewport back to sample the frunk colour. Every response after the first adds about 20 ms to the frame.

**The resync on `GODOT_READY` was redundant.** It was added in `e76de2c` for an intermittent black car on cold boot, and no cause was captured at the time. A batch sent before `GODOT_READY` cannot be lost:
- `GodotBridge` (iOS, and Android's `GodotBridge.kt`) only appends to the queue. Android clears it only in the module's `OnDestroy`.
- `MobileComm` drains the queue in `_process`, so it starts on the engine's first frame after `Main::start`.
- Every message listener registers on the first line of `_ready` in a node of `mobile.tscn`. `SceneManager` sends `GODOT_READY` from the root's `_ready`, which runs after all of its children's.
- The engine lives for the whole process (the Bug 2 fix), so `GODOT_READY` arrives once per process.

**Fix:** `boot()` records whether it ran before `GODOT_READY`. If it did, that `GODOT_READY` skips the resync and logs `godot resync skipped` to the ring. A `GODOT_READY` with no boot queued ahead of it still resyncs, and the foreground resync is unchanged. Callers no longer add their own marker request after a non-animated `moveCamera`.

**Measured** on one instrumented binary with the JS swapped in, in interleaved blocks of 10 launches, iPhone Air, no syslog attached. Times are ms after JS `app boot` (medians unless stated):

| | Before | Skip the resync only | Fix (skip + one marker request per batch) |
|---|---|---|---|
| Car frame ends | 534 (p10 501, p90 555) | 494 (461, 511) | **470** (455, 487) |
| Change in median, 95% bootstrap CI | | −41 (−51 to −32) | **−64 (−71 to −55)** |
| Car frame length | 320 | 278 | 259 |
| From `FIRST_PRODUCT_LOADED` to frame end | 138 | 95 | 75 |
| Marker requests in the frame | 5 (4–5) | 3 (2–3) | 2 |
| Next frame ends | 539 | 500 | 476 |

n = 30 per arm. The car load itself (`FIRST_PRODUCT_LOADED` at 394–398) and `GODOT_READY` (205–206) did not move.

**Render check:** the same build read the GL frame back at three points: after the car frame, 3 s after engine start, and 1.5 s after each activation. All 90 launches gave byte-identical frames at each point, across all three arms. At 3 s that frame is the fully lit car. In 8 of 8 background-to-foreground cycles on the fix build, the foreground resync ran, and the frame afterwards was byte-identical to the cold-launch frame. iOS reclaiming GPU resources after a long background was not reproduced at the desk. Android was not run.

**Still in the car frame:** a second `GET_VEHICLE_MARKERS`, about 20 ms. The trace shows it right after a second `UPDATE_MAIN_VIEW_FRAME`, which is the pair `updateFrame` sends. Whether `onLayout` or the camera-mode effect calls it was not traced. Also, the readback taken right after the car frame shows the car upside down on black, identically in every arm. This may be the cold-boot blip noted under Bug 2, or it may be the readback picking up Godot's viewport buffer after the frunk-colour sample. That was not investigated.

---

## How this was debugged

Keeping these for next time:

- **LLDB hid the bug.** There were 0 catches in 70 launches, against a 5% baseline. The approach that worked was an in-process recorder: `malloc_logger` logging the size class to a ring, plus a `SIGTRAP` handler that dumps the corrupted block and its history.
- **`MallocProbGuard` needs small limits.** Setting `MallocProbGuardSlots=80000` made every launch die in `pgm_create_zone`, which looks like a 100% repro of the bug but is not.
- **Relaunch harness:** launch with `devicectl device process launch --terminate-existing`, wait, then check that the pid is still alive. A release build takes about 40 s.
- **Never time launches with `idevicesyslog` attached.** A live syslog relay slows the launch itself. On the pristine Xcode build, interleaved blocks with and without it measured `GODOT_READY` 278 vs 206 ms median (+72 ms, 95% CI 63 to 82). Every attached launch fell into the slow `FIRST_PRODUCT_LOADED` mode, about 500 ms against about 400. The device streams about 10,000 log lines a second while it is attached. On 2026-11-07 this was first read as Xcode's bundle being 115 ms slower than `deploy-js.sh`'s. It isn't. The Xcode block was the only one recorded with a capture running, and the 08:17–08:54 UTC slow runs sat inside another session's capture (298/543 ms inside, 217/423 outside). With no capture, the pristine Xcode app, a deploy-js swap of it, and a re-sign alone all measured within noise (`FIRST_PRODUCT_LOADED` 403, 396 and 389 ms, 20 launches each). So were seven bundle variants covering entry file, minify, the `ShareSheet` import and polyfill order. Capture logs in a separate run from the one you time.
- **`FIRST_PRODUCT_LOADED` was bimodal even with no capture:** about 395 ms or about 510 ms. In slow launches, JS received nothing from about 200 ms (`resync`) until the product loaded, not even the native `foregroundResponderActive=true` event that normally arrives at about 212 ms. That was the JS thread waiting on Godot's first car frame, and it is fixed. See "Why `FIRST_PRODUCT_LOADED` was still bimodal" above. Builds from before that fix still show it, so compare their medians, not single launches. On any build, time launch-to-car by the end of that frame, not the FPL row.
- **iOS drops crash reports under load.** Count deaths by process liveness, not `.ips` files.
- **Screen capture:** `idevicescreenshot` does not work on this iOS version. `glReadPixels` from inside the delegate can read frames instead.
- **Ring-log times are when JS handled a row, not when it happened.** Several rows in the same millisecond after a gap mean JS was blocked. To find where, wrap the native module objects in a `Proxy` that times every synchronous call and logs the slow ones. Then record epoch-ms marks in `GodotHost drawView:` and `IOSGodotInterface` `sendMessage`/`getMessage` into a static array, dumped to `Documents/` a few seconds later. Epoch ms lines up with the ring log's `t`. Both instruments are kept as a patch in the side-session notes for the FPL investigation.

## Verification

Device: iPhone Air, iOS 27.0, each launch followed by a 4 s liveness check.

| Build | Launches | Deaths |
|---|---|---|
| Before the fix | 40 | 2 |
| Before the fix, with the recorder | 80 | 2 |
| Bug 1 fix only | 200 | 0 |
| Final (all fixes) | 120 | 0 |

At a true 5% crash rate, 200 clean launches would have odds of about 1 in 28,000. At 2.5%, about 0.6%.

Bug 2 was tested with a temporary forced unmount, a remount 4 s later, and an instant key swap. The app survived all of it. Frames sampled after recovery were byte-identical to frames from before the unmount. A 30 ms black or flipped blip appears when JS re-sends the scene state, and the same blip occurs on a normal cold boot behind the splash.

Not tested: the orbit drag fix (the sizes are confirmed by the guards). Android only received the native public key. The three fixes are all in iOS-only code, and Android was not checked for equivalent bugs.

These numbers only count process deaths after `devicectl` launches. All 444 launches in those runs became active, so they say nothing about Bug 3.

---

## Bug 3: the swipe-kill reminder collides with the next launch

**Status:** fixed, and passed a real swipe-kill retest on device (results below).

Swipe-killing the app posts "Keep the Airgapp app running". Reopening soon afterwards can leave you back on the Home Screen, with no crash report. This trace is from the failed attempt, captured with `idevicesyslog` at 10:25 on 2026-11-07, on the build with the Bug 1 and 2 fixes (`97f6556e`):

| Time | What happened |
|---|---|
| 34.170 | SpringBoard terminates the app: `killed from app switcher` |
| 34.222 | `applicationWillTerminate` posts the reminder with no delay, then blocks on a semaphore for up to 3 s |
| 34.474 | The icon is tapped. SpringBoard can't start a new process until the old one exits |
| 35.700 | SpringBoard finishes its notification pipeline for the reminder |
| 37.19 | The old process exits, 3 s after the kill |
| 37.273 | SpringBoard starts the new process for the tap: `intent foreground-interactive` |
| 37.279 | The tap's update fails: `Failing for reason: scene update failed` |
| 37.344 | SpringBoard sends the reminder's `UIWillPresentNotificationAction` to the new process, and sets it to background |
| 37.371 | The reminder's open request is denied: `A process for app<…> already exists` |
| 37.519 | The new process drops to `BG-Active`, and the app is left in the background |

The reminder is posted while the process is still alive, so SpringBoard opens the app to deliver `willPresent`. That open waits for the exit, then starts a process. In the earlier cycle that recovered, the open request went first (29.192) and the tap second (29.615): the new process started in the background and the tap then brought it forward. This is the source of the `background relaunch` rows, and of the 3 s rhythm. The failing order, with the tap first, comes from these two cycles only, but the fix removes both the collision and the wait, so it doesn't depend on that detail.

**Connection to "Tesla opens quicker":** after a swipe-kill, the tap waited on our dying process for 2.66 s and 2.80 s in these two cycles. That cost is ours, and it only applies to reopening soon after a kill. It says nothing about an ordinary cold start, and Tesla's app still hasn't been measured.

**The fix (`Notifier.postAfterExit`, `PassiveEntryAppDelegate`):**
- The reminder uses a 2 s time-interval trigger, so it fires after the process has gone and nothing needs delivering to a dying app.
- The wait drops from 3 s to 0.5 s. In the two traced cycles, SpringBoard logged the request within a millisecond of the app adding it.
- Launching cancels a reminder that hasn't fired yet, so reopening within 2 s shows no reminder.

**Retest results:** 15 swipe-kills and 14 reopens on build `7165F650`, checked against the system log:

| | Before | After |
|---|---|---|
| Reopens that became active | Failed on the third attempt, twice | 14 of 14 |
| Swipe-kill to process exit | About 3 s | 0.07 s median, 1.11 s worst |
| Tap to launch | 2.66 s and 2.80 s | 0.03 s median, 0.89 s worst |
| `UIWillPresentNotificationAction` opens | Present | 0 |
| `scene update failed`, `RequestDenied` | Present | 0 |

- **Reminder:** all 15 kills scheduled it. It was delivered once, for the last kill, when the app stayed closed. It fired 2.005 s after the request, and iOS finished processing it 4.7 s after the kill. The other 14 didn't produce a delivery.
- **The worst cycle:** the main thread was busy for about 1.05 s before `applicationWillTerminate` ran, so the tap landed on a dying process. It still launched and became active. In this one sample, waiting on a dying process wasn't enough to fail without an immediate notification competing with the tap.
- **Final build:** `58D67285` differs from the tested build only by removing a diagnostic `NSLog`, and came up fine on 3 remote launches. It wasn't swipe-kill tested again. That `NSLog` never appeared in the capture for any of the 15 kills, so the exit timing above is the evidence that the wait is short. The likely reason, found later the same day: Swift's `NSLog` passes its text as an argument, so the system log stores it as `(Foundation) <private>`. Search for that, or use `os.Logger` with `privacy: .public` for a readable line.

**Remaining risk:** a launch that overlaps the moment the reminder fires, about 2 s after the kill, can still receive `willPresent`. It would go to a new process rather than a dying one, which is not the failure traced here. This is untested: the latest tap in the retest came 1.65 s after a kill.

**How to retest:** this needs a real swipe-kill, because remote kills don't reproduce it. Run `idevicesyslog` during rapid cycles, then:
- **Pass:** the tap launches at once with `intent foreground-interactive`, with no `UIWillPresentNotificationAction`, and the native log shows `foregroundResponderActive=true`.
- **Failure signature:** `RequestDenied` and `scene update failed`. Don't search for `already exists`, because SpringBoard logs it on healthy launches too.
- **Reminder:** kill the app and stay away for about 5 s. The banner should still appear.

**Why the harness missed it:** remote kills produced no relaunch within 14 s, and its launches never followed a swipe-kill. Process liveness also can't detect this, because the app stays alive in the background. Treat a launch as healthy only if it logs `foregroundResponderActive=true`.

**Also seen:** background launches booted Godot, which then failed with `Insufficient Permission (to submit GPU work from background)`. It wasn't the cause here. Genuine wakes (Bluetooth restoration, car beacon) happen about twice a day, and in the ring log 59 of 76 of them reached `GODOT_READY` in the background. `ExpoGodotView` now waits for `willEnterForeground` before attaching the engine when the app is in the background. Foreground launches are unchanged (20 launches each: `FIRST_PRODUCT_LOADED` median 397 ms before, 398 ms after).

Checked on a genuine wake, a walk to the car at 11:00:46 UTC: Bluetooth restoration relaunched the app into the background. `ExpoGodotView` deferred 26 ms after JS boot, and the engine booted 24 s later from inside the `willEnterForeground` dispatch, when the app was opened (`iphone_main` 1 ms after the observer, with CoreLocation's observers for the same notification waiting until the boot finished). The car loaded 0.39 s after the foreground and looked normal on screen. `sudo log collect` from 12:59 local shows no `Insufficient Permission` line. The app's deferral lines appear as `(Foundation) <private>`, see the note on Swift `NSLog` above. Passive entry could not be checked on that walk: the car refused the phone's Bluetooth pairing (`Peer removed pairing information`), which is unrelated to this change.

## Reproducing

```bash
DEV=F3867E6E-E95F-5B2A-9C4E-06D1D72475A1
xcrun devicectl device process launch --terminate-existing --device $DEV local.airgapp.mobile
```

```bash
mkdir -p /tmp/ips && idevicecrashreport -k /tmp/ips
```

`idevicecrashreport` works over USB only. A native change needs a full `xcodebuild` Release build, which takes about 40 s when incremental.

## Key files

| File | What |
|---|---|
| `modules/expo-godot-view/ios/ExpoGodotView.podspec` | Engine defines (Bug 1) |
| `modules/expo-godot-view/ios/IOSGodotInterface.mm` | ABI guard, singleton |
| `modules/expo-godot-view/ios/GodotHost.mm` | Process-lifetime host, input event size guards |
| `modules/expo-godot-view/ios/ExpoGodotView.swift` | Attach and detach (Bug 2) |
| `modules/expo-passive-entry/ios/Notifier.swift` | Delayed swipe-kill reminder (Bug 3) |
| `modules/expo-passive-entry/ios/PassiveEntryAppDelegate.swift` | Posts the reminder on terminate, cancels it on launch (Bug 3) |
| `src/ble/keystore.ts` | Native public key derivation seam |
| `modules/expo-passive-entry/ios/PassiveEntryModule.swift` | `devicePublicKey` |
