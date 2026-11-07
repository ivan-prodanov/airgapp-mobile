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

**The fix:** `loadOrCreateDeviceKeys` now takes an optional native deriver, wired to the existing `VcsecSigner.devicePublicKey` in CryptoKit. The key is still re-derived rather than cached, which keeps the existing rule in `keystore.ts`. On the real key, the native result matched noble byte for byte, and key loading took 5 ms. iOS only for now; Android falls back to noble.

**What that gained, from the ring log (ms after JS boot, 200 launches before, 120 after):**

| Event | Before, median | After, median | Before, p90 | After, p90 |
|---|---|---|---|---|
| `GODOT_READY` | 511 | 205 | 519 | 214 |
| `FIRST_PRODUCT_LOADED` | 512 | 397 | 521 | 502 |

Expect a modest visible change, not a transformed launch. The JS thread is free about 300 ms sooner, but the car only arrives about 115 ms sooner at the median, and possibly less on screen. These timestamps record when JS received each message, and JS was stalled until about 510 ms, so the engine may have finished loading the car before the "before" figure. Launches where the stall delayed `godot boot` benefit most.

We have not measured Tesla's app or on-screen time, so this compares our own before and after, not the two apps.

**Other costs not addressed:**
- Live car data takes about 3 s over the Pi relay, mostly `openSession` at 2 to 2.5 s. This may be a large part of how slow launch feels, and `docs/RECONNECT-LATENCY-FLAP-2026-11-07.md` covers related relay latency.
- We link Godot's debug template, which calls `glGetError` and `NSLog`s `DrawView: 500` every frame. Moving to the release template needs `IOSGodotInterface` rebinding without `DEBUG_METHODS_ENABLED`, and new `static_assert` values.
- The engine's `OSIPhone::initialize` starts Game Center login on launch, and links StoreKit and iCloud support. A custom engine build could drop them, but stock `iphone.zip` cannot.

---

## How this was debugged

Keeping these for next time:

- **LLDB hid the bug.** There were 0 catches in 70 launches, against a 5% baseline. The approach that worked was an in-process recorder: `malloc_logger` logging the size class to a ring, plus a `SIGTRAP` handler that dumps the corrupted block and its history.
- **`MallocProbGuard` needs small limits.** Setting `MallocProbGuardSlots=80000` made every launch die in `pgm_create_zone`, which looks like a 100% repro of the bug but is not.
- **Relaunch harness:** launch with `devicectl device process launch --terminate-existing`, wait, then check that the pid is still alive. A release build takes about 40 s.
- **iOS drops crash reports under load.** Count deaths by process liveness, not `.ips` files.
- **Screen capture:** `idevicescreenshot` does not work on this iOS version. `glReadPixels` from inside the delegate can read frames instead.

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

Not tested: the orbit drag fix (the sizes are confirmed by the guards), and Android (unchanged).

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

Checked on a genuine wake, a walk to the car at 11:00:46 UTC: Bluetooth restoration relaunched the app into the background. `ExpoGodotView` deferred 26 ms after JS boot, and the engine booted 24 s later from inside the `willEnterForeground` dispatch, when the app was opened (`iphone_main` 1 ms after the observer, with CoreLocation's observers for the same notification waiting until the boot finished). The car loaded 0.39 s after the foreground. `sudo log collect` from 12:59 local shows no `Insufficient Permission` line. The app's deferral lines appear as `(Foundation) <private>`, see the note on Swift `NSLog` above. Passive entry could not be checked on that walk: the car refused the phone's Bluetooth pairing (`Peer removed pairing information`), which is unrelated to this change.

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
