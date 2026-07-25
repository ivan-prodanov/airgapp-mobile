# RE RESPONSE #16 — the car's iBeacon region (the reboot-surviving wake source)

**Answers:** `REQUEST-16-ibeacon-region-wake.md` (Q1–Q6).
**Method:** 3 traces → 2 adversarial verifiers → critic, over the official iOS `TeslaV4` 4.58.0-4392 arm64 Mach-O + the 115 MB Hermes bundle + Android jadx + the car rootfs. **Plus my own independent spot-check of the load-bearing value** (I did not take the agents' word for the UUID).
**One trace was wrong and was overruled:** T2 concluded the UUID "could not be tied to Tesla / is JS-supplied." That is a **false negative** — it searched only the dead `convertDictToBeaconRegion:` path. V1 + the critic + my own disassembly all land on the same constant.

---

## THE ANSWER — the value you can't get yourself

```
proximityUUID = 74278BDA-B644-4520-8F0C-720EAF059935
```
**Hardcoded compile-time constant. Not cloud-provisioned, not VIN-derived, not JS-supplied.** So it is obtainable offline — the beacon path is *not* closed to an air-gapped client.

**Independently verified by me this session** (not just reported):
- The literal lives at file offset `0x342c35d`, with its siblings `"monitor"` (`0x342c382`) and `"C-%@"` (`0x342c38a`) — the fallback and format for the region *identifier*.
- `r2 -c 'ic BLEBeaconRegion'` confirms the class: `initFromVIN:` @`0x1013abc4c`, `convertToBeaconRegion` @`0x1013abe34`, getters `major/minor/uuid/identifier`, class helpers `endianSwapU16:`/`U32msw:`/`U32lsw:`.
- **Both** branches of `initFromVIN:` store the same cfstring into `_uuid` (+0x18): `adrp x9, 0x103c91000; add x9, x9, #0x438; str x9, [x20, #0x18]` at `0x1013abdb0` (normal VIN) **and** `0x1013abcc0` (nil/short VIN) ⇒ VIN-independent.
- `convertToBeaconRegion` materialises it: `NSUUID initWithUUIDString:` → `CLBeaconRegion initWithProximityUUID:major:minor:identifier:` (`0x1013abf1c`), with `and w3,w21,#0xffff` / `and w4,w23,#0xffff` masking major/minor.
- V1's exhaustive binary-wide scan: the 4-arg init has exactly **2** call sites, and `startMonitoringForRegion:` exactly **3** — two are Expo/Supercharger circular geofencing, and the third is inside `-[BLEHelper changeMonitoringForVehicle:shouldStart:]` @`0x1012aba20`. **There is no other live path.**

**major / minor (per-VIN)** — helper bodies disassembled by me:
```
v      = integerValue(last 5 chars of VIN)      // NSString: scans leading digits, stops
major  = bswap16( (v >> 16) & 0xFFFF )          // U32msw: ubfx x0,x2,#16,#16  → endianSwapU16
minor  = bswap16(  v        & 0xFFFF )          // U32lsw: and x0,x2,#0xffff   → endianSwapU16
identifier = "C-<last5>"                        // fallback "monitor"
endianSwapU16: lsl w8,w2,#8 ; orr w8,w8,w2,lsr #8 ; and x0,x8,#0xffff   // true 16-bit swap, BOTH halves
```
> ⚠ **Both halves are byte-swapped** — an earlier write-up read as if only `minor` was. Anyone implementing from that prose would get `major` wrong. (That explicit byte swap is itself corroboration that a real wire format is being matched: you don't byte-swap to satisfy an API that already parses iBeacon major/minor big-endian — it implies a firmware emitter `memcpy`ing a little-endian u32.)

**⚠ But monitor UUID-only anyway.** A right-UUID/wrong-major region **never fires, with no error and no log** — a second silent no-op. Tesla itself already uses a UUID-only constraint for *ranging*, so this shape is well within what the platform and the emitter support:
```swift
CLBeaconRegion(uuid: UUID(uuidString: "74278BDA-B644-4520-8F0C-720EAF059935")!,
               identifier: "airgapp.car.beacon")
```
Only tighten to major/minor **after** a sniff confirms the derivation. (Also note `Int(vin.suffix(5)) ?? 0` diverges from `NSString.integerValue` on a non-numeric serial — another reason to skip the derivation entirely.)

---

## VERDICT: **ADD the beacon; KEEP the geofence.** Conditional, not strictly better — and they have *disjoint* failure sets.

### ⚠ First, the thing you most need to know: your shipped geofence probably doesn't fix the modal case

iOS relaunches a terminated app for a `CLCircularRegion` **only on a boundary crossing**. A 150 m circle centred on the car parked **at home swallows the entire house** — so the modal reboot (overnight, at home) leaves the phone **permanently inside** the region. Your `requestState(for:)` only runs once the app is already alive. User wakes up, walks to the car, **crosses nothing → no relaunch → no unlock**. That is precisely the bug the workaround shipped to fix.

A `CLBeaconRegion`'s boundary is **BLE detection range** (metres to tens of metres), so a phone that reboots anywhere but right beside the car is genuinely **outside** it, and the walk-up **is** a crossing.

### Where the beacon wins
No bootstrap (VIN-derivable offline; you already persist the VIN); immune to the car being moved without your phone seeing it; immune to garage GPS error; and it carries `notifyEntryStateOnDisplay` (a launch trigger `CLCircularRegion` has no equivalent for — though this one is narrow: it needs the screen turned on *while already inside* BLE range).

### Where the beacon loses
1. **It depends on the car actually emitting an Apple iBeacon frame — INFERRED, not proven** (VCSEC is a separate ECU, absent from the MCU rootfs).
2. **Less lead time** — entry fires at BLE range, not 150 m out, so less time to relaunch + connect + authenticate before a hand is on the handle.
3. **Requires the OS Bluetooth toggle ON** — a user-reachable way to silently lose the wake that the geofence doesn't have.

### So: ship both
The objective is *P(at least one relaunch between reboot and the next walk-up)* — one relaunch of **any** kind re-arms the standing CoreBluetooth connect, which the OS then holds until the next reboot. Independent triggers multiply. Cost: **2 of your 20-region budget, ~40 lines.** And note the official app has a third backstop you structurally cannot have — its `UIBackgroundModes` include `fetch` and `remote-notification` (silent-push) — which is an independent reason an air-gapped client should run **two** local wake sources rather than one.

---

## Answers to your six questions

**Q1 — what does `startMonitoringForVehicle:` construct?** A **per-VIN `CLBeaconRegion`** (not a constraint-based monitor): proximityUUID = the constant above; major/minor **constrained** per-VIN as derived above; identifier `"C-<last5 of VIN>"`. `startMonitoringForVehicle:` / `stopMonitoringForVehicle:` both tail-call `changeMonitoringForVehicle:shouldStart:` @`0x1012ab430`, which builds `BLEBeaconRegion initFromVIN:` → `convertToBeaconRegion`, sets **`notifyOnEntry=YES`, `notifyOnExit=YES`, `notifyEntryStateOnDisplay=YES`** (`0x1012ab530/53c/548`), de-dups against `locationManager.monitoredRegions` by UUID+major+minor, then calls `startMonitoringForRegion:` — **inside a `requestLocationServicesPermissionAlways:callback:` completion block**. ✅ PROVEN.

**Q2 — does the car actually advertise an iBeacon frame?** **INFERRED, not proven, and not provable from these artifacts.** The emitter is VCSEC (separate ECU, not in the rootfs); the MCU's `QtCarBluetooth` has only audio/charger strings. The app has **no `kCBAdvDataManufacturerData` reference at all** — it cannot and does not read the beacon via CoreBluetooth; it relies entirely on `locationd`. Circumstantial support is strong though: VIN-keyed major/minor with a wire-format byte swap the API doesn't need, `_isInBeaconRegion`/`_beaconState`/`_beaconTimestamp` ivars, `IBEACON_STATE_{INSIDE,OUTSIDE,SNA}` telemetry, and a production gating string *"…they are not in the beacon region…stop connecting"*. **Sleep-gating is the open risk** — a 31-byte legacy ADV can't hold both the 128-bit service UUID and a 25-byte iBeacon payload, so the car must interleave two payloads, and that interleave could plausibly be vehicle-state-gated.

**Q3 — beacon vs circular: which carries the reboot case?** **The beacon, and only the beacon.** `CLCircularRegion` appears **only** in Expo geofencing + `SuperchargerGeofenceManager` — never in the phone-key stack. `startMonitoringSignificantLocationChanges` has exactly 2 callers, both JS bridges; `startMonitoringVisits` is **absent**. So **your parked-location circle is a genuinely different mechanism, not a reimplementation of theirs** — which is exactly why they're complementary.

**Q4 — what happens on entry, and does it range?** Enter → filter identifiers prefixed `"supercharger_"` → `handleDidEnterBeaconRegionForVIN:` → `-[BLEVehicle didEnterBeaconRegion]` @`0x1012be19c` → `startConnectingTimer`, `setIsInBeaconRegion:1`, **tail-call `connectPeripheral`** @`0x1012be22c`. Already-inside/cold-launch → `didDetermineState:` state==1 → **same path** (this is your `didDetermineState(.inside)` → `wakeForRegionEntry`, 1:1 — correct as written). **Exit does NOT disconnect** — only `setIsInBeaconRegion:0` + cancel the connecting timer. **Yes it ranges** (`startRangingForRegion:` @`0x1013b3e40` → `CLBeaconIdentityConstraint initWithUUID:` — UUID-only — → `startRangingBeaconsSatisfyingConstraint:`), **but the proximity is used phone-side only**: dedupe, reconnect-if-needed, telemetry. **It is never sent to the car** — so this does **not** touch the drive-latency question from P0-2.

**Q5 — lifecycle & the 20-region cap.** One region per vehicle, de-duplicated by UUID+major+minor before arming (`"Already monitoring %@; skipping"` → only `requestStateForRegion:`). `stopMonitoringForAllRegions` iterates `monitoredRegions`. **No prune/evict/cap logic exists** — with >20 monitored vehicles iOS would silently drop the extras. Irrelevant for you at 2 regions. (The exact *first* arming trigger — enrolment vs pairing vs launch — wasn't fully resolved; xref scans timed out on the 74 MB binary.)

**Q6 — is Location Always genuinely required?** **Yes.** `startMonitoringForRegion:` is called *inside* the `requestLocationServicesPermissionAlways:callback:` completion block — the official app gates region monitoring on Always and asks for it explicitly. (iOS requires Always for region monitoring to relaunch a terminated app; WhenInUse cannot deliver the post-reboot wake you need.) Your ask is not over-scoped.

---

## What to ship

1. **Add a second, independent `CLBeaconRegion`** with **UUID-only** matching (above), `notifyOnEntry/Exit/EntryStateOnDisplay = true`, identifier distinct from your circular one (`"airgapp.car.beacon"`), and **widen both delegate handlers** to accept either identifier (your existing `guard region.identifier == regionId` would otherwise drop it).
2. **Keep the circular region as-is.** It covers the cases the beacon can't (Bluetooth off, car silent/asleep, and it gives 150 m of lead time).
3. **Debounce** beacon entries (~30 s) — UUID-only matching means you'll also wake near *other* Teslas. Harmless (re-arming a pending connect for an absent peripheral is a no-op) but don't let a parking lot thrash relaunches.
4. **Log every enter/determineState separately per region identifier.** This answers the last inferred fact — whether the car actually emits — **for free, from field data, within a week**.
5. Guard with `CLLocationManager.isMonitoringAvailable(for: CLBeaconRegion.self)`.
6. Entry handler: copy Tesla — **enter → connect; exit → do NOT disconnect** (just clear the flag/timer). Yours is already the right shape.

## Residual unknowns (with measurements)
- **Does the car emit at all, and is it sleep-gated?** The decisive open fact. Park beside the car with nRF Connect / an AltBeacon scanner, filter manufacturer data company `0x004C` type `0x02`, read UUID/major/minor from the raw ADV — sampled at four states: awake, just-locked walkaway, 30–60 min parked, multi-day parked. If the iBeacon frame vanishes while the connectable `00001122` advert persists, the beacon can't be a sole wake source.
- **Is the major/minor derivation right?** Same capture. **Prediction: `major ∈ {0, 256}`** for any Tesla VIN (a 5-digit serial ≤ 99999 = 0x1869F ⇒ msw ∈ {0,1} ⇒ bswap16 ⇒ 0 or 256); `minor = bswap16(v & 0xFFFF)`. Anything else means the derivation is wrong — another reason to ship UUID-only first.
- **Does a `CLCircularRegion` relaunch a terminated app when you're already inside at reboot?** The whole audit turns on this and it's an SDK-contract inference. One morning: park at home, stand inside the circle, reboot, don't leave the circle, walk to the car.
- Bluetooth-off failure mode; reduced-accuracy (Precise Location off) behaviour; where the official app first arms the monitor.

## Provenance
Traces `T1-region-construction-uuid` (correct), `T2-car-emission-and-fallbacks` (**wrong on the UUID — overruled**), `T3-entry-behavior-and-permissions`; verifiers `V1-uuid` (**SUPPORTED/HIGH**, five refutation angles incl. proving the JS-dict path is dead code — no objc stub, zero selref references — and that the Hermes bundle contains zero hits for the UUID while control strings from the same subsystem do hit), `V2-beacon-vs-geofence` (**PARTIALLY_SUPPORTED** — correctly rejected "strictly better"); critic. **My own independent spot-check** re-confirmed the string, the class layout, both `initFromVIN:` store sites, and all three helper bodies. Findings: `~/Work/tesla-firmware/out/req16-findings/`. Closes the RESPONSE-15 residual "the car's iBeacon UUID".
