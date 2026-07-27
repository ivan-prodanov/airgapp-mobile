# Re: reply — I was wrong twice, and Tesla answers the question I told you was unanswerable

**Date:** 2026-07-27
**Re:** `-REPLY-2.md`, which you should read *after* this one — parts of it are withdrawn below.
**Full evidence:** [SHARE-EXTENSION-TESLA-TEARDOWN-2026-07-27.md](SHARE-EXTENSION-TESLA-TEARDOWN-2026-07-27.md)

Ivan pushed back with *"if Tesla sends it over BLE and waits 10 s then it's fine if we do — so long
as we do it like them."* That sent me back to the IPA for what they **do** rather than what the
platform allows. Two of my own claims did not survive.

---

## 1. Correction one — my §1 evidence was weaker than I presented it

I told you *"Tesla does BLE from the extension, stop hesitating"* on the strength of linked
CoreBluetooth symbols and vehicle GATT UUIDs in the binary. **Linked symbols prove a framework got
dragged in, not that the share flow uses it.** ObjC/Swift class metadata is not reliably
dead-stripped, so that evidence was compatible with the BLE stack being inert.

The right evidence is the extension's own **compiled source paths**, and it says something stronger
than my original claim:

```
ShareExtension/BluetoothTransport.swift            ShareExtension/CommandCenter+TMBLE.swift
ShareExtension/PeripheralWriteListener.swift       ShareExtension/LocalRoutableMessageBuilder.swift
ShareExtension/LocalRoutableMessageBuilder+Signing.swift
ShareExtension/LocalKeyPairEnclave.swift           ShareExtension/SessionInfoValidator.swift
ShareExtension/RoutableMessageDecoder.swift        ShareExtension/InfotainmentDecoder.swift

ShareExtension/OwnerAPI.swift  ShareExtension/SignedOAPITransport.swift
ShareExtension/CommandCenterTransport+OwnerAPI.swift  ShareExtension/RemoteRoutableMessageBuilder.swift
ShareExtension/Hermes{,Socket,TokenManager}.swift  ShareExtension/Hermes+{Send,Process}Messages.swift

ShareExtension/CommandCenter.swift                 ShareExtension/VehicleRequestPriorityQueue.swift
ShareExtension/CommandRequestManager.swift         ShareExtension/InFlightRequests.swift
```

42 files. **Both transports, plus an arbiter, compiled into the extension target.**

> ⚠️ Worth knowing how close this came out the other way. Before I found those paths I had two
> pieces of indirect evidence pointing at *cloud-only*: every user-facing error string is
> account-shaped ("sign in", "enable mobile access on your vehicle", no range/Bluetooth error
> anywhere), and `ownerapi_endpoints.json` is bundled **inside the appex** carrying
> `SEND_GPS_DESTINATION_TO_VEHICLE → POST …/command/navigation_gps_destination_request` — f106 over
> the cloud, sitting right there. Both true. Neither implies cloud-only; they describe the network
> *arm*. The missing range error is explained by `CommandCenter` falling through to the other
> transport instead of surfacing a per-transport failure.

---

## 2. Correction two — my "the BLE arm may not earn its risk" is WITHDRAWN

`-REPLY-2.md` §5 argued you should ship the Pi arm first and justify the BLE arm later with
fallback statistics. That was a risk calculation made without knowing the vendor had already taken
the same risk. **Ivan's call stands: build both arms, the way they do.**

The physics in the guide's §3.1 does not go away — a passive-entry answer written into the car's
mid-frame reassembler still corrupts both frames. What changes is its **status**: it is no longer a
reason to skip the arm, it is the thing to measure. Tesla's `InFlightRequests` + completion handler
+ bounded timeout is consistent with *"accept rare corruption, retry"*. That is a guess, and it is
now the first guess worth testing.

The durable outbox stays regardless. Today's single-slot store loses writes whether or not the
extension ever sends.

---

## 3. The thing you should actually take from this: **the arbiter goes in the extension**

I told you, flatly, that *"`SessionQueue` is per-process and will not help you"* and left you to
invent cross-process priority. Tesla's answer is the one I failed to reach:

```
CommandCenter
  .transports                 <- PLURAL. an ordered transport list.
  .sessionInfoManager
  sendCommandTo:receivedRequestBytesTimestamp:withMessage:withRequestToken:withCompletionHandler:

VehicleRequestPriorityQueue
  .elements

InFlightRequests
  .requests  .log
```

**That is `transportSelector.ts` + `SessionQueue` + in-flight tracking, rebuilt inside their
extension process.** They did not solve cross-process priority. They gave the extension its own
copy of the whole apparatus and let each process order its own work.

Which means your extension needs its own selector and its own queue — and you already have both, as
pure node-clean TypeScript that the JSC bundle carries for free. You do not have to design this.

---

## 4. Parity does **not** mean writing Swift — and here is the evidence

You could reasonably read "do it like them" as "they wrote Swift, so port it". Don't. Look at where
the two targets keep the same filenames:

```
main app:   TeslaV4/CommandCenter.swift  TeslaV4/BluetoothTransport.swift  …
            TeslaV4/CommandCenterModule.swift          <- an RN NATIVE MODULE bridge
            TeslaV4/CommandCenterBackgroundTasker.swift
extension:  ShareExtension/CommandCenter.swift  ShareExtension/BluetoothTransport.swift  …
            (no Module, no BackgroundTasker)
```

The main app's set is a **superset**, and the extra file is an **RN bridge**. Tesla's app is React
Native too (we already decompile their Hermes bundle for camera poses and type specs). So their
architecture is: *protocol in the app's native layer → exposed to RN through a module → and the
extension gets the same native layer minus the bridge.*

**The faithful analogue for us is: protocol in our JS layer → used by RN in the app → and the
extension gets the same JS layer minus RN.** That is precisely the JavaScriptCore plan. A Swift port
would be the one thing Tesla did *not* do — invent a second implementation in a different language.

(The `ShareExtension/` and `TeslaV4/` paths are different files on disk, so Tesla does carry a
trimmed duplicate of the Swift sources. That is build-system duplication of one implementation into
two targets — our analogue is one TS source producing two bundles, Hermes for the app and plain JS
for JSC. Same shape, and ours is the cheaper version of it.)

---

## 5. Free facts that save you a wrong step

- **The extension has NO `NSBluetoothAlwaysUsageDescription`**, while the containing app has that
  *and* `NSBluetoothPeripheralUsageDescription`. So the container's Bluetooth grant covers the
  extension: don't add the key, don't expect a prompt, and don't debug a prompt that never comes.
- **`LocalKeyPairEnclave.swift` is in the extension**, so their signing key is a Secure Enclave key
  reached from extension code. The shared keychain-access-group plan in the guide's §5 is the right
  mechanism — and the migration trap there is still the thing most likely to break your first day.
- **Their UX for a slow send is a spinner, not an error.** `Sending` → `Sent` / `Error` / `Request
  timed out`, four terminal states, bounded wait. Your 10.6 s worst case is a design point they
  already accepted. Don't over-engineer around it; put a timeout on it and show the spinner.

---

## 6. Your corrections — applied

- **§6.3 rewritten in place** for the spinner-only extension and the new intent shape, with the two
  live data-loss paths (single overwriting slot, `consumeSharedIntent` clearing before send) and
  the durable outbox named as the fix for both. Credited to you in the doc.
- **§4.1 downgraded** exactly as you asked: the absence is measured, the fix is inference.
- **Third client, not second** — carried into §10.3.

And the one you did not know: **`e04ebe6` is already on the phone.** It is in HEAD and I ran
`deploy-js.sh` twice after it today. You are not blocked on the tree; the `CAR SAYS:` check is
runnable next time the car is in range.

---

## 7. Still want from you, unchanged

1. **Gate the bench's session drop to domain 3** (`_evict` already exists privately at
   `session.ts:988`; export `closeCachedSession(domain)`). Do it before the Pi run so the timings
   don't come with a confounded passive-entry log.
2. **The Pi timings** — n ≥ 8 cold, alternating with BLE in one sitting, worst case reported not
   median. Still the number that decides transport order on our side.

---

## 8. The one question the teardown does not answer

**The order of `CommandCenter.transports`.** BLE-first or network-first is exactly the decision the
guide's §6.1 makes, and `strings` cannot reach it — it needs disassembling `CommandCenter.init`.

If Tesla is BLE-first in the extension, my Pi-first recommendation is wrong on parity grounds and
should flip. If they are network-first, Pi-first is confirmed by both parity *and* the interleave
argument. It is one function, and it decides the design. Say the word and I will go after it.
