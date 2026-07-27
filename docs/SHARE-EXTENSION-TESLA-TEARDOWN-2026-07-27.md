# What Tesla's Share Extension actually contains

**Date:** 2026-07-27
**Source:** `com.teslamotors.TeslaApp_4.57.5.ipa` → `Payload/TeslaV4.app/PlugIns/ShareExtension.appex`
**Supersedes:** the §1 and §11 hedges in `SHARE-EXTENSION-SENDING-2026-07-27.md`.

---

## 0. The finding

Tesla's share extension ships **both transports and an arbiter between them**, compiled into the
extension target itself. Not a linked framework it happens to drag in — its own source files.

That means the answer to *"can the extension talk BLE to the car?"* is not merely "the platform
allows it". It is **"the vendor wrote a BLE command path specifically for this extension, and a
CommandCenter to choose between it and the network path."**

---

## 1. The extension's own source files

`strings -n 8 ShareExtension | grep -E 'ShareExtension/.*\.swift' | sort -u` — 42 files. Grouped:

**Direct BLE to the car**
```
BluetoothTransport.swift              CommandCenter+TMBLE.swift        (TMBLE = Tesla Mobile BLE)
PeripheralWriteListener.swift         LocalRoutableMessageBuilder.swift
LocalRoutableMessageBuilder+Signing.swift
LocalKeyPairEnclave.swift             SessionInfoValidator.swift
RoutableMessageDecoder.swift          InfotainmentDecoder.swift
```

**Network to the car**
```
OwnerAPI.swift          OwnerAPI+Vehicle.swift        CommandCenterTransport+OwnerAPI.swift
SignedOAPITransport.swift             RemoteRoutableMessageBuilder.swift
Hermes.swift  HermesSocket.swift  Hermes+SendMessages.swift  Hermes+ProcessMessage.swift
HermesTokenManager.swift
```

**The arbitration layer — the part worth copying**
```
CommandCenter.swift                   VehicleRequestPriorityQueue.swift
CommandRequestManager.swift           InFlightRequests.swift
MessageEvaluator.swift                VehicleStateManager.swift
```

**Plumbing**
```
ShareViewController.swift  TSVehicleClient.swift  TeslaCommandRequest.swift  TokenManager.swift
Analytics.swift  RemoteLog.swift  MonitoringService.swift  TelemetryTracker.swift
RealmHelper.swift  LoggingUtils.swift  ReduxPropertyHelper.swift  FeatureConfigService.swift
CalendarSync.swift  AppRegionHelper.swift  OAPIRequestConfig.swift  OwnerAPI+Log.swift
WakeFreshDataTelemetryManager.swift  InFlightRequests.swift
```

## 2. Ivar-level shape of the arbiter

Demangled from the symbol table:

```
CommandCenter
  .transports                 <- PLURAL. an ordered transport list.
  .sessionInfoManager
  .feedbackSentForSignedError
  sendCommandTo:receivedRequestBytesTimestamp:withMessage:withRequestToken:withCompletionHandler:

VehicleRequestPriorityQueue
  .elements                   <- a priority queue, inside the share extension

InFlightRequests
  .requests  .log

ShareViewController
  .vehicleClient (TSVehicleClient)  .shareContent  .runningTasks
  .fetchingSuccess  .titleLabel  .contentLabel  .imageView  .fullScreenOverlay
  viewDidLoad / dismissPopupWithContext
```

**`CommandCenter.transports` + `VehicleRequestPriorityQueue` is our `transportSelector.ts` +
`SessionQueue`, reimplemented inside their extension process.** That is the direct answer to the
gap flagged in the guide's §3.3 — *"`SessionQueue` is per-process and will not help you"*. Tesla's
answer: then put a priority queue in the extension too.

`LocalKeyPairEnclave.swift` says the signing key is a **Secure Enclave** key reached from the
extension — the shared-keychain plan in the guide's §5 is the right mechanism.

## 3. The UX, from the string table

```
share_popup_title_sending  = "Sending"      share_popup_title_success = "Sent"
share_popup_title_error    = "Error"        share_popup_title_info    = "Info"
share_to_vehicle_success   = "Shared with %@"
share_to_vehicle_error     = "There was a problem sharing content with your vehicle…"
share_to_vehicle_timeout   = "Request timed out. Please try again later."
share_extension_error_{require_log_in, launch_app_first, no_vehicle_data,
                       mobile_access_disabled, invalid_content}
```

All five `share_extension_error_*` keys and both `share_to_vehicle_*` keys appear in the binary, so
every one of those paths exists in code.

**So Tesla sends inside the extension, synchronously, behind a spinner, with a bounded timeout.**
Four terminal states: Sent / Error / Timed out / Info. A slow send is a spinner, not a failure —
which settles the "is 10 s acceptable?" question: they designed for it.

## 4. Two facts that are directly actionable

- **The extension has NO `NSBluetoothAlwaysUsageDescription`**, while the containing app has both
  that and `NSBluetoothPeripheralUsageDescription`. So an extension inherits the container's
  Bluetooth grant — do not add the key to the extension's Info.plist and do not expect a prompt.
- **The containing app declares `bluetooth-central`** (ours does too). So Tesla genuinely accepts
  the app-holding-a-link / extension-running-a-central overlap. They ship no visible cross-process
  mutex.

## 5. A methodological warning — I nearly concluded the opposite

Before finding the source-file list I had two pieces of indirect evidence pointing the other way,
and both were wrong:

1. **The error strings are entirely account-shaped** — "sign in", "launch the app", "select a
   vehicle", "enable mobile access" (an ownerapi concept). No range/proximity/Bluetooth error
   anywhere, which a BLE-primary flow would surely need.
2. **`ownerapi_endpoints.json` is bundled inside the appex** and contains
   `SEND_GPS_DESTINATION_TO_VEHICLE → POST api/1/vehicles/{vin}/command/navigation_gps_destination_request`
   — f106 over the cloud, sitting right there in the extension.

Both are true. Neither implies cloud-only; they describe the *network arm* of a two-arm design. The
absence of a BLE-range error string is explained by `CommandCenter` falling through to the other
transport rather than surfacing a per-transport failure.

Compiled source-file paths beat inference from a string table. Same lesson as the tyre labels this
morning: recover the constant, don't reason about the rendering.

## 6. Still unrecovered

- **The order of `CommandCenter.transports`.** BLE-first or network-first is the single decision
  this teardown does not answer, and it is exactly the decision the guide's §6.1 makes. Needs
  disassembly of `CommandCenter.init`, not more `strings`.
- **How they avoid ATT interleaving with the containing app**, if they do. No lock is visible.
  `InFlightRequests` + a completion handler + a timeout is consistent with "accept rare corruption,
  retry" — but that is a guess.
- **Whether the extension's BLE connection counts as a separate central to the car.** With our Pi
  in the picture it would be a third client.

Reproduce:

```bash
unzip -o -q ~/Downloads/com.teslamotors.TeslaApp_4.57.5_und3fined.ipa 'Payload/*/PlugIns/*' -d /tmp/tesla-ipa
cd /tmp/tesla-ipa/Payload/*.app/PlugIns/ShareExtension.appex
strings -n 8 ShareExtension | grep -E 'ShareExtension/.*\.swift' | sort -u
nm -a ShareExtension | grep CommandCenter | sed 's/.* //' | sort -u | xcrun swift-demangle
plutil -p en.lproj/ShareExtensionLocalizable.strings
```
