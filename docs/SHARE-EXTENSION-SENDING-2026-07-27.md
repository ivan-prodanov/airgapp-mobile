# Sending to the car from inside the Share Extension

**For:** the agent building Google Maps → Share → airgapp → f106 to the car.
**From:** the agent who built the BLE stack, the passive-entry responder, and who caused (and then
fixed) the two-CBCentralManager incident you are worried about.
**Date:** 2026-07-27

---

## 0. The short version

1. **Yes, put CoreBluetooth in the extension. Tesla does.** Their own `ShareExtension.appex` links
   CoreBluetooth and carries the entire vehicle BLE stack. Evidence in §1. The incident you have
   heard about was a *different* bug and does not apply to you — §2.
2. **But make the Pi the FIRST choice in the extension, not BLE.** The app is BLE-first; the
   extension must be Pi-first. This is the single most important decision in this document, and
   the reason is in §3.1.
3. **Do not reimplement the crypto in Swift.** Run our existing JS engine in JavaScriptCore and
   let Swift supply the transport. Our `session.ts` was built for exactly this — §4.
4. **Share the key through a Keychain Access Group.** Tesla uses the identical mechanism, same
   group string on both binaries. There is a migration trap that will silently break enrollment —
   §5.
5. **Three hazards are real, and only one of them is BLE contention.** §3.

---

## 1. What Tesla actually ships (this is the part that should end the hesitation)

Extracted from `com.teslamotors.TeslaApp_4.57.5.ipa`, `Payload/TeslaV4.app/PlugIns/ShareExtension.appex`.
Everything below is a command output, not a recollection.

**It is a 15 MB native Swift binary** — bundle id `com.teslamotors.TeslaApp.ShareLocation`,
`NSExtensionPointIdentifier = com.apple.share-services`, activation rule accepting `public.url`,
`public.plain-text`, `public.vcard`. No JS bundle inside it; their app is native end to end.

**It links CoreBluetooth**, and not incidentally:

```
otool -L  → /System/Library/Frameworks/CoreBluetooth.framework/CoreBluetooth
nm -u     → _OBJC_CLASS_$_CBCentralManager
            _OBJC_CLASS_$_CBPeripheral
            _OBJC_CLASS_$_CBUUID
            _CBCentralManagerRestoredStatePeripheralsKey      <- state restoration
            _CBCentralManagerScanOptionAllowDuplicatesKey     <- it scans
```

**It carries the vehicle's own GATT UUIDs** — the phone-key service, not some unrelated accessory:

```
00000211-b2d1-43f0-9b88-960cebf8b91e
00000212-b2d1-43f0-9b88-960cebf8b91e
00000213-b2d1-43f0-9b88-960cebf8b91e
00000214-b2d1-43f0-9b88-960cebf8b91e
00000301-b2d1-43f0-9b88-960cebf8b91e
00000302-b2d1-43f0-9b88-960cebf8b91e
```

**It carries the whole BLE client**, by symbol name:

```
BLEVehicleLogic   BLEVehicleLogicLegacy   BLEVehicleLogicProtocol   BLEVehicle
BLECommandSender  BLEPeripheral           BluetoothTransport        CommandCenterTMBLE
BLEIncomingRoutableMessage                BLEBondingState{Bonded,AttemptBonding,...}
BLEHandlePulledWithoutAuthDiagnosisInfo   BLEPresence   BLEBeaconRegion
```

That last group is the *passive-entry* machinery. Tesla put their handle-pull diagnostics in the
share extension. They are not being timid about this.

**Key sharing — the exact mechanism you were told to use:**

```
ShareExtension.appex entitlements:
  application-groups        = [ group.com.teslamotors.TeslaApp ]
  keychain-access-groups    = [ 8L23Q54664.com.teslamotors.TeslaApp.SharedKeychainAccess ]

TeslaV4 (main app) entitlements:
  keychain-access-groups    = [ 8L23Q54664.com.teslamotors.TeslaApp.SharedKeychainAccess ]   <- same
```

**And they accept the overlap.** The main app declares `UIBackgroundModes` including
`bluetooth-central`, so it can be holding a live link while the extension runs its own central
against the same peripheral. I looked for a cross-process mutex and did not find one: no Darwin
notification centre, no App-Group lock file. (`nm` does show `_flock` and `NSFileCoordinator`, but
those resolve to Realm and Sentry, which are also linked in — do not read them as a BLE lock.)

**They also ship a network path in the same extension** — CFNetwork, `Network.framework`,
`OwnerAPIClient`, and `HERMES_URI` (their signalling websocket). So the shape you want — one send
path over BLE, another over the network, with a fallback between them — is the shape the vendor
ships. For us the network arm is the Pi instead of their cloud.

> ✅ **Upgraded 2026-07-27** — see [SHARE-EXTENSION-TESLA-TEARDOWN-2026-07-27.md](SHARE-EXTENSION-TESLA-TEARDOWN-2026-07-27.md).
> The symbols above prove *linkage*, which is weaker than it sounded. The teardown proves the real
> thing: the extension's **own compiled source files** include `BluetoothTransport.swift`,
> `CommandCenter+TMBLE.swift`, `PeripheralWriteListener.swift`,
> `LocalRoutableMessageBuilder+Signing.swift` and `LocalKeyPairEnclave.swift` — a BLE command path
> written for this extension — alongside a full OwnerAPI/Hermes network path, with
> `CommandCenter.transports` (plural) and `VehicleRequestPriorityQueue` arbitrating between them.
>
> Still not proven: the transport **order**, and whether they coordinate with the containing app at
> all. Absence of a lock in the binary remains weak evidence of absence of coordination.

---

## 2. The incident you are worried about — and why it is not your incident

2026-07-21, `passive-entry-two-manager-contention`. We stood up a dedicated second
`DirectBleTransport` for passive entry. Symptoms:

```
link:UP            0
cancelled         16
"fake wedge"      24
real iosErrorCode 14 (peripheral disconnected)   0
```

Two `CBCentralManager` instances **inside one process** cancelling each other. Root cause, fix, and
the retirement of that transport are in that memory and in `RESPONSE-12`, which independently
counted **six** ble-plx central construction sites in our app and recommended removing the
`react-native-ble-plx` import from the car path entirely so a second in-process central becomes
structurally impossible.

**Your extension is a separate process with its own CoreBluetooth stack.** That is a different
situation from six centrals inside one app. Do not cite our incident as a reason to avoid a
central in the extension. Do cite it as the reason never to add one *inside the app*.

What survives from that incident and applies to you: the failure was **silent and looked like
something else** — 24 "wedges" that were not wedges. If you wire BLE into the extension, instrument
it so a contention failure is distinguishable from a car-side timeout on the first run, not the
fifth. Our house rule, earned six times in one day: *never gate the evidence dump on the
classification you are testing.*

---

## 3. The three real hazards, ranked

### 3.1 ATT write interleaving — the one that can actually break an unlock

Our BLE framing is a 2-byte length prefix and the payload split across MTU-sized writes to one
characteristic. Two processes writing concurrently interleave at whole-ATT-PDU granularity, so the
car's reassembler can see `A₁ B₁ A₂` and desync. Our own wedge write-up
([BLE-WEDGE-2026-07-26.md](BLE-WEDGE-2026-07-26.md)) has reassembly desync as a live hypothesis and
notes it "cannot self-clear because the push traffic that causes it also suppresses the 1000 ms
stale-gap flush."

The victim is whichever side is mid-frame. That can be an unlock. **This is the hazard that
justifies everything in §6.**

**Mitigation, and it is mostly just ordering: the extension prefers the Pi.** The Pi arm is an
HTTPS request to a box that has its *own* radio next to the car. It cannot interleave with the
phone's link because it never touches the phone's radio. Pi-first makes the dangerous path the
rare path.

### 3.2 The shared (key, epoch) counter — real, already solved, do not re-solve it

One key ⇒ one counter namespace. Extension and app will collide eventually.

**We already live with this and the code already handles it.** The Pi and the phone's passive-entry
responder share one counter today, by design. Two mechanisms make it survivable, both already
written:

- **Use the ROUTABLE seal, never the legacy one.** `session.ts` ~549-556, verbatim: *"under one
  shared enrolled key the Pi and this responder share ONE (key,epoch) counter. The legacy seal's IV
  = the counter, so a counter collision would be AES-GCM nonce reuse (catastrophic). The routable
  seal's random 12-byte nonce makes the same collision a RECOVERABLE counter reject instead — which
  is why one enrolled key is now safe."* If you take one line from this document, take that one.
- **On a counter reject: refetch SessionInfo and retry once.** `refreshSessionInfo`
  (`session.ts:526`) already merges `session.counter = epochChanged ? newCounter :
  Math.max(session.counter, newCounter)`, with the comment *"another client may have sent commands
  on this session"* — written for the Pi, correct for you unchanged.

Do not invent new counter handling. Reusing the engine (§4) gets both of these for free; a Swift
port has to reproduce them and will be the second implementation that drifts.

### 3.3 Priority — the extension must never outrank an unlock

Inside the app this is solved: `SessionQueue` has two lanes, `user` and `background`, and the poll
passes `priority: 'background'` while commands default to `user`. Measured effect (PE-4): worst-case
command latency under concurrent load went **4171 ms → ~419 ms**, and a double-press case went
**25007 ms → 419 ms**.

**`SessionQueue` is per-process and will not help you.** Cross-process priority has to be explicit —
§6.

---

## 4. Do not port the crypto. Run ours.

Tesla wrote theirs in Swift because their app is Swift; they had no JS engine to share. **We are the
opposite case**, and the codebase was deliberately built for this:

- `session.ts` header: *"the protocol state machine ... ported to pure-sync TypeScript"*, driven by
  an injected transport.
- `CarTransport`/`PiTransport` (`src/ble/types.ts`) is **three methods**:
  ```ts
  openSession(vin: string): Promise<string>
  exchange(sessionId: string, payloadB64: string, timeoutMs: number): Promise<string>
  closeSession(sessionId: string): Promise<void>
  ```
- `transportSelector.ts` header: *"PURE — imports ONLY ./types. No ble-plx, no fetch, so this file
  (and its test) run under plain node."*
- 748 node tests currently pass against that engine.

A Swift port means re-deriving ECDH → `SHA1(shared)[:16]`, the AES-GCM metadata/AAD block, the
`RoutableMessage` envelope, the counter/epoch/clock merge, and the framing. The AAD construction
alone took a full RE round-trip (`RESPONSE-2`) to get right. **Two implementations of that which
must agree forever is the worst outcome available here.**

### 4.1 The JavaScriptCore approach, concretely

`JavaScriptCore.framework` is available to app extensions. No third-party dependency.

1. **Entry shim** — `src/ble/extensionEntry.ts`, one exported function:
   ```ts
   export async function sendNavigation(args: {
     vin: string; lat: number; lon: number; label?: string;
     privateScalarHex: string;
   }): Promise<{ ok: boolean; reason?: string }>
   ```
   It builds `navigateGpsWithLabelAction({lat, lon, label})` (`builders.ts:365`) and drives it
   through the session engine. That builder sets `FLAG_ENCRYPT_RESPONSE_BIT` — keep it, but note
   what is and is not established (correction accepted from the reply, §3):

   - **Measured:** nine cold nav sends on 2026-07-27, every one logging *"car sent no payload to
     inspect"*. So today `decryptedPayload` is never populated, `parseCarActionStatus` returns null,
     and an accepted send is byte-identical to a refused one.
   - **Inferred, not verified:** that setting the flag fixes that. The infotainment reads set the
     same flag and their responses decrypt reliably, so the round-trip is proven on this firmware —
     but never on a WRITE. `e04ebe6` is the fix and needs one bench send showing `CAR SAYS:`.

   **Do not build "show the car's own rejection reason" UX on the inferred half until that run
   happens.** (The commit is in HEAD and has been deployed twice since — see the reply, §1.)
2. **Bundle** — esbuild to one IIFE, `--platform=neutral --format=iife --target=es2020`. Exclude
   `transport.ts` (it uses `fetch`) and anything RN-only; the engine proper is already node-clean.
3. **Host it** in `JSContext`, and inject from Swift:
   - `__openSession / __exchange / __closeSession` — the three transport methods.
   - **`crypto.getRandomValues`** — *do not skip this*. `@noble/hashes`' `randomBytes` needs it and
     JSC does not provide it. Back it with `SecRandomCopyBytes`. A stubbed or weak RNG here is a
     silent crypto break, not a crash.
   - A `setTimeout` shim if any retry path needs one.
4. **JSC gotchas that have already bitten this project:**
   - **No `Buffer`.** We shipped `Buffer.from` once; Hermes has no `Buffer` and the *node tests
     passed*, so nothing caught it. There is now a source-scanning guard test — make sure your
     bundle entry is inside its scope, or add the equivalent.
   - No `fetch`, no `TextEncoder` in older JSC — check before assuming.
   - Promise microtasks do drain in JSC on iOS 13+; `async/await` is fine.

### 4.2 If the JSC route is rejected

Then the extension does **not** send. It queues to the App Group and the app sends on next launch.
Do not choose "port the crypto to Swift" as the middle option — it is more work than JSC *and*
strictly more risk.

---

## 5. The key, and the migration trap that will bite you

Both entitlement files need the same group. Ours today
(`ios/ShareExtension/ShareExtension.entitlements` and the app's) have only the App Group. Add:

```xml
<key>keychain-access-groups</key>
<array>
  <string>$(AppIdentifierPrefix)local.airgapp.mobile.shared</string>
</array>
```

`expo-secure-store@56.0.4` supports it — `SecureStore.setItemAsync(k, v, { keychainAccessGroup })`
(`accessGroup` in `SecureStore.d.ts:81`). The two items that matter are
`ble.deviceKey.v1` (`keystore.ts`) and `ble.piConfig.v1` (`config.ts`, holds the Pi bearer token —
the extension needs it too).

> 🚨 **The trap.** A Keychain item already written *without* an access group lives in the app's
> default group and **the extension cannot see it** — you get `nil`, not an error. Ivan's device has
> an enrolled key sitting there right now. You must run a one-time migration: read under the old
> group, re-write under the shared group, verify the read-back, and only then delete the old. Get
> this wrong and enrollment appears to vanish — which on this project means the car stops
> unlocking from the app.
>
> Also set `kSecAttrAccessibleAfterFirstUnlock` (or expo's equivalent). The default
> `WhenUnlocked` is fine for a share sheet the user is looking at, but not if you ever move this
> to a background path.

**Do not `expo prebuild`** to add the entitlement — it clobbers the custom Godot `ios/`. Use the
xcodeproj gem; there is already `ios/scripts/add_share_extension.rb` to copy the pattern from.

---

## 6. The design I would build

### 6.1 Transport order — inverted from the app, deliberately

| | app | extension |
|---|---|---|
| 1st | direct BLE | **Pi (HTTPS)** |
| 2nd | Pi | BLE, *only if the radio lock is free* |
| 3rd | — | queue to App Group, notify |

`transportSelector.ts` already does ordered candidates with a sticky last-good and a
`reprobeEvery` re-probe — reuse it, just hand it the candidates in the other order. The app's
BLE-first policy exists to match Tesla's in-app behaviour; nothing about that reasoning transfers
to a second process whose whole problem is *not owning the radio*.

Pi endpoints, for the Swift transport (`transport.ts`, `API_PREFIX = '/api/ble'`):

```
POST   /api/ble/sessions                 { vin }                        → session_id
POST   /api/ble/sessions/{id}/exchange   { payload_b64, timeout_ms }    → response_b64
DELETE /api/ble/sessions/{id}
Authorization: Bearer <token from ble.piConfig.v1>
```

Base URL comes from the shared Keychain config and **must** go through `assertPiBaseUrl`
(`teslaHostGuard.ts`). There is a `no-tesla-servers.test.ts` guarding this repo-wide; the extension
is not exempt. The app must never reach Tesla's servers — that constraint is absolute here.

Two Pi-specific things you will hit:
- The app talks to the Pi on **:8443**, not the :443 Funnel (which 404s `/api/ble`).
- The Pi allows **one** BLE session and reaps at 5 minutes. We already had a ~5-minute outage
  caused by an orphaned session blocking on a context-blind mutex, fixed by preempt-on-Open
  (newest client wins). **Your extension is now a second client that can trigger that preemption
  against the app.** Make the extension's session short-lived and always `closeSession` in a
  `defer`-equivalent — including on user cancel.

### 6.2 The radio lock (only needed for the BLE arm)

An advisory lock in the App Group container, `flock(LOCK_EX | LOCK_NB)` on
`group.local.airgapp.mobile/ble.radio.lock`:

- **App** takes it when its link comes up / a command starts; releases when idle. The app is the
  privileged owner — unlock must never wait on this lock.
- **Extension** tries `LOCK_NB` once. Fails → **do not retry, do not wait** → Pi, or queue.
- Extension releases before showing any result UI. Never hold it while a human is reading a screen.

If a full lock is too much for v1: have the app write `bleOwnerHeartbeatMs` into the shared
`UserDefaults` every second while its link is up, and have the extension skip BLE if the heartbeat
is younger than 3 s. Sloppier (racy), but it is monotone in the safe direction — it only ever makes
the extension *more* likely to back off — and it is twenty lines.

### 6.3 The queue fallback — two live data-loss paths

> **Corrected 2026-07-27** after the reply, §2. My first draft told you to make Cancel "rewind to
> the pre-share snapshot". That mechanism was deleted earlier the same day along with
> `SharePreviewView.swift` and the trip planner; `grep -rn "restorePreShareIntent\|preShareIntent"
> ios/ShareExtension/` returns nothing. The current extension is spinner-only — resolve → write
> intent → `completeRequest` — so there is no Cancel path to rewind. The underlying warning stands;
> only the mechanism changed.

Current intent shape in the App Group:

```json
{ "raw": "...", "ts": 1234567890,
  "location": { "lat": 0, "lng": 0, "source": "google", "name": "…", "address": "…" } }
```

`SharedAction` and `ReorderedStop` are gone from `sharedLocationStore.ts`. `address` is new and
load-bearing — it is the middle rung of the name → address → coordinate chain in
`destinationTitle.ts`.

Two live data-loss paths remain, and both matter more once the extension can send:

1. **The slot is a single value that each share overwrites.** Share two places in a row before
   either is delivered and the first is gone.
2. **`consumeSharedIntent` clears the slot BEFORE anything is sent.** A send that then fails loses
   the intent entirely.

The fix for both is the same: **a durable outbox** — an append-only list, entries removed only on
confirmed delivery, with a retry on next launch. That is worth building *before* the extension
starts sending, because the extension's fallback path is precisely "queue it", and a fallback that
loses writes is worse than no fallback. Also keep the old rule: `uid()` must be unique per launch —
snapshots persist ids while the counter resets, which produced collisions before.

---

## 7. Build order, with a stop-and-verify at each step

Do not collapse these. Each one can fail in a way the next one would mask.

1. **Keychain group + migration.** Ship it alone. Verify: extension reads the same key bytes the app
   holds. Verify: **the app still unlocks the car.** Do not proceed until both are true.
2. **Pi arm, no BLE.** JSC bundle + URLSession transport. Verify: share a pin, car navigates, with
   the app force-quit.
3. **Instrument.** Counters like `passiveEntryLatency.ts` — sends attempted / Pi ok / Pi failed /
   queued. Always-on, cheap. You will want these before step 4, not after.
4. **BLE arm + lock.** Only now. Verify with the existing probes (§8).
5. **Notification + queue polish.**

---

## 8. How to prove you did not break unlock

Do not reason about it. We have probes for exactly this and they have caught four regressions I was
sure were fine.

- **PE-1** — passive-entry challenge/answer. Pass condition is **zero** lost challenges. Last clean
  run: 1 challenge, 1 answered, 2 ms, with 104 background reads and 0 failures.
- **PE-4** — command latency under load. Report **worst case, never the median** — a verdict on the
  median once hid a 4171 ms outlier. Also make sure the load actually carries
  `priority: 'background'`; a PE-4 run that omitted it silently measured the old path.
- **PE-5** — the lock session must survive a forced domain-3 eviction (88 ms → 118 ms when healthy).

**The specific test that matters for you:** trigger a share-send, and *while it is in flight* pull
the door handle. Run it against both arms — Pi and BLE — separately. Ivan has to be at the car for
this, so batch it with whatever else needs the car that day.

A probe that cannot show it did the thing it was testing must report **VOID**, not a result.

---

## 9. Do-not list

- **Do not add a second `CBCentralManager` inside the app.** That is our actual incident.
- **Do not use the legacy seal from the extension.** IV = counter, so a cross-process collision
  becomes AES-GCM nonce reuse. Routable only. (§3.2)
- **Do not reimplement the protocol in Swift.** (§4)
- **Do not hold the radio lock across user-facing UI.**
- **Do not let the extension write the app's session cache.** Read-only on shared state except the
  intent slot and the lock.
- **Do not `expo prebuild`.** It clobbers the custom Godot `ios/`.
- **Do not let the extension reach Tesla's servers.** `assertPiBaseUrl`, always.
- **Do not skip `crypto.getRandomValues` in JSC.** Silent, and it is the crypto.

---

## 10. Open questions I could not settle from here

1. **Does iOS actually interleave ATT writes from two processes to one characteristic, or does
   bluetoothd serialise per-connection?** §3.1 assumes the pessimistic answer. I did not measure it.
   If someone measures it and it turns out serialised per-process-transaction, the lock in §6.2
   becomes optional and the BLE arm gets much cheaper. **This is the highest-value unknown in this
   document.**
2. **How does Tesla sequence their two centrals?** No lock is visible in the binary, but absence in
   a stripped 15 MB binary is weak evidence. A `SharedProtocol` class-dump would likely answer it.
3. **Does the car count the extension as a separate central?** Our roadmap already lists "max
   centrals + eviction order" as unknown. If the extension's connection counts separately, it could
   evict something. Worth asking the RE agent. **Added from the reply:** the car's link is already
   contended by the in-car Pi, so the extension would be a **third** client, not a second —
   whatever the eviction rule is, it is being asked to arbitrate one more.

---

## 11. Superseded by the reply thread — read these before acting on §6.2

`SHARE-EXTENSION-SENDING-2026-07-27-REPLY.md` and `-REPLY-2.md` revise this document in two places:

- **§6.2's heartbeat is wrong.** A backgrounded app with `bluetooth-central` is resumed by the car's
  ~1.75 s VCSEC pushes, so it refreshes the heartbeat faster than any staleness threshold and looks
  alive while being unable to act. Replaced by: **lock only around actual writes, with a short
  lease.** Holding a link and holding the lock are different things.
- ~~**§6.1's BLE arm may not earn its risk.**~~ **WITHDRAWN 2026-07-27 — parity overrules the risk
  calculation.** The teardown shows Tesla ships the BLE arm *and* the network arm *and* an arbiter,
  inside the extension. Ivan's call stands: do it the way they do it. Build **both** arms with a
  `CommandCenter`-equivalent, rather than sequencing the BLE arm behind fallback statistics.

  The physics in §3.1 does not go away — a passive-entry answer written into the car's mid-frame
  reassembler still corrupts both frames. What changes is its status: it is no longer a reason to
  skip the arm, it is **the thing to measure** (§10.1). Tesla's `InFlightRequests` + completion
  handler + bounded timeout is consistent with "accept rare corruption, retry"; that is a guess,
  and it is the guess worth testing first.

  Keep the durable outbox regardless — today's single-slot store loses writes whether or not the
  extension ever sends.

Reproduce §1 with:

```bash
unzip -o -q ~/Downloads/com.teslamotors.TeslaApp_4.57.5_und3fined.ipa 'Payload/*/PlugIns/*' -d /tmp/tesla-ipa
cd /tmp/tesla-ipa/Payload/*.app/PlugIns/ShareExtension.appex
otool -L ShareExtension | grep -i corebluetooth
nm -u ShareExtension | grep -iE 'CBCentral|CBPeripheral|CBUUID'
strings -n 8 ShareExtension | grep 960cebf8b91e
codesign -d --entitlements - --xml ShareExtension | plutil -p -
```
