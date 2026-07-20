# RE RESPONSE #5 — where the Bluetooth name in the bond-repair copy comes from

**Answers:** `REQUEST-5-bluetooth-name-source.md` (Q1 name source, Q2 🔑 prefix, Q3 GAP 0x2A00 vs
peripheral.name, Q4 cold case). 3 finders + 1 adversarial verifier over the iOS Mach-O, both RN bundles,
Android jadx, **and the 3.7 GB car firmware** (`QtCarServer`/`QtCarBluetooth`). Confidence per claim.

## TL;DR — your stopgap is right; the *source* was the bug, and the fix is capture discipline

- **Your bug:** you bound `{{name}}` to `fleet.activeName` ("Red Velvet") — an **airgapp-only nickname**
  (zero hits in either Tesla bundle) with no relationship to the car.
- **The correct source is the OS-cached bonded-device name** — `CBPeripheral.name` (iOS) /
  `BluetoothDevice.getName()` (Android) — because *that is exactly what iOS Settings > Bluetooth renders,
  by construction.* This is **your existing `peripheral.name` stopgap**. Keep it; don't swap it for a cloud
  value. (The verifier **REFUTED** the "bind cloud `vehicle_name`" alternative.)
- **You couldn't use the cloud name anyway:** airgapp's `teslaHostGuard` denylists `owner-api`/`tesla.com`,
  so the Fleet API `vehicle_state.vehicle_name` is unreachable. For an air-gapped app the OS BLE name is the
  *only* source.
- **The 🔑 is part of the name** — user-typed, not composed by app or firmware. Print it verbatim.
- **The one fix your stopgap needs: capture timing.** `peripheral.name` is the advertised `S<hex>C` token
  until CoreBluetooth reads `0x2A00` on connect; read it **after `peripheralDidUpdateName`** and snapshot it
  **at the peer-removed error instant**, not at first discovery.

---

## Q1 — what fills `{{name}}`

The friendly name is **car-authoritative vehicle state**, and in the steady state it is one string that the
car propagates everywhere:

- Renaming (app or touchscreen) lands on the car as **`CarServer.SetVehicleNameAction`** → firmware D-Bus
  `set_vehicle_name(vehicle_name:s)` (`CarAPIServiceImpl::set_vehicle_name`, `VEHICLE_NAME_CHANGED`) →
  stored as the `GUI_vehicleName` DataValue → `QtCarBluetooth::BluetoothManager::vehicleNameChanged()`
  writes it to the **BT adapter alias**. Verbatim pass-through — the only default the firmware synthesizes
  is `Tesla %1` (model name) when no name is set. *(high)*
- So **`vehicle_name` == car BT/EIR alias == iOS-cached `peripheral.name` == the Settings string** in the
  common case. `fleet.activeName` ("Red Velvet") is none of these — it's an app-local label. *(high)*

**But for the literal copy "Remove '{{name}}' in Settings > Bluetooth," the right binding is the OS-cached
name, not the cloud value** — because Settings renders the OS cache, and the OS cache can **diverge** from
cloud after a *post-pairing rename* (iOS does not refresh a bonded device's cached name until you re-pair;
cloud/`vehicle_name` updates, Settings stays stale). The official app most likely reads the OS name too
(Android decompile: `BLEService.java:388` `device.getName()` → `localName` → JS). *(which exact JS variable
the official row binds is Hermes-opaque — ⚠ not statically provable — but the recommendation is the same
either way, and airgapp can't reach the cloud regardless.)*

---

## Q2 — the 🔑 prefix: **user-typed into the vehicle name** *(high)*

Definitively resolved by hunting all layers:

- **App:** `U+1F511` (UTF-8 `F0 9F 94 91`) = **0 hits** in the iOS Mach-O, JS bundle, and Android bundle.
- **Car firmware:** **0 hits in the entire 3.7 GB rootfs** — in *any* encoding (UTF-8 bytes, decimal
  `128273`, `1F511` literal, UTF-16 surrogate pairs), and in fact **no astral-plane emoji anywhere** in
  `QtCarServer`/`QtCarBluetooth`/`authd`. There is no prefix constant and no format string that prepends
  one. The name pipeline is verbatim: `set_vehicle_name(arg)` → BT alias, no prefix/separator/emoji.

⇒ `🔑`, the space, and `CHUŠKOPEK` are all **literal characters someone typed into the vehicle-name field**
(car touchscreen, or app rename → `SetVehicleNameAction`). Neither app nor firmware composes it. **You cannot
strip, synthesize, or normalize it** — print whatever the OS hands back byte-for-byte (emoji included).
Confirm on-device: the car's name editor shows the field literally reading `🔑 CHUŠKOPEK`.

---

## Q3 — GAP `0x2A00` vs `peripheral.name`

**Neither app does an explicit `0x2A00` read; both rely on the OS-cached name — same as your stopgap.** *(high)*

- No `00002a00…` / `2a00` / "Generic Access" / "Device Name characteristic" literal exists in the iOS
  Mach-O, JS, or Android. iOS uses `CBPeripheral.name` + `advertisementData[CBAdvertisementDataLocalNameKey]`;
  Android uses `BluetoothDevice.getName()` + `scanRecord.getDeviceName()`.
- CoreBluetooth **auto-reads `0x2A00` on connect** and fires `peripheralDidUpdateName`, updating
  `peripheral.name`. So an explicit GATT read is unnecessary and is **not** what Tesla does — if you distrust
  timing, observe `peripheralDidUpdateName`, don't issue a manual read.

**The four name layers — keep them distinct (this is where the `S<hex>C` trap lives):**

| Layer | What | This car | For the row? |
|---|---|---|---|
| (a) ADV **local name** | in the scan packet | `S<hex>C` (VIN-derived; the app calls it `bleName`, uses it only for matching) | ❌ wrong — this is the discovery token |
| (b) GAP **0x2A00** | GATT char, read on connect | UNKNOWN (VCSEC ECU, not in this rootfs) | source of (c) |
| (c) **OS-cached name** | `peripheral.name` / `getName()` | `🔑 CHUŠKOPEK` after `0x2A00` resolves | ✅ **this is the Settings string** |
| (d) cloud `vehicle_name` | account/car record | `🔑 CHUŠKOPEK` | ⚠ can go stale vs Settings; **unreachable for airgapp anyway** |

**`peripheral.name` starts as `S<hex>C` (layer a) and only becomes `🔑 CHUŠKOPEK` (layer c) after
`peripheralDidUpdateName` fires** — this is the real hazard in your stopgap.

- **Readable unbonded?** ADV local name (a) yes (passive scan). GAP `0x2A00` (b) — *usually* readable
  without encryption, but whether VCSEC exposes it at all, gates it behind encryption, or returns the
  friendly name vs `S<hex>C` on an unbonded link is **VCSEC-ECU-internal → ⚠ not statically determinable,
  log it** (Q3's first-connect concern). *(Given the row can only fire when a bond already exists — see Q4 —
  the unbonded case doesn't actually gate the row.)*

---

## Q4 — the cold case: **there essentially isn't one** *(high)*

The row's trigger is peer-removed-bonding (`CBErrorPeerRemovedPairingInformation`, error 14), which by
definition **requires a pre-existing OS bond** (the phone still holds pairing info; the car dropped its
side). And **a bond guarantees the OS holds a cached name.** So:

- **Truly never-bonded phone:** the error can't fire → the row is **structurally suppressed**. No cold case.
- **Fresh *app* install over a surviving OS bond:** reinstall doesn't clear OS bonds or the name cache → the
  error can fire, and the OS still has the cached name. `{{name}}` is populated.
- On **Android** a nameless peripheral is dropped before it reaches JS (`BLEService.java:422`), so an empty
  name is unrepresentable.
- **Only residual (iOS, thin):** a bond exists but `CBPeripheral.name` is `nil` at row-build time → the
  official copy interpolates to literal `Remove '' in Settings > Bluetooth…` (Tesla ships **no** nameless
  fallback string; no "your car" variant).

Tesla's design tell: for devices whose friendly name it may not have (Powerwall), it uses `{{din}}` (a
hardware id); for the *vehicle* row it uses `{{name}}` precisely because a bond-triggered row always has an
OS name available.

---

## The binding to ship (definitive for airgapp)

```
{{name}}  ← OS-cached bonded-device name
             iOS: CBPeripheral.name   Android: BluetoothDevice.getName()   (ble-plx: Device.name)
             NOT fleet.activeName. NOT cloud vehicle_name (unreachable + can diverge from Settings).
```

Capture discipline (this is the actual fix, not the source alone):
1. **Read after `peripheralDidUpdateName`, not at `didConnect`/discovery** — before that, `peripheral.name`
   is the advertised `S<hex>C` token, which is *also* wrong for this row.
2. **Capture on every scan/discovery, and snapshot again at the peer-removed error instant** — the row fires
   when connect *fails*, so a capture-on-successful-connect-only cache can be empty exactly when you need it.
3. **Reject `S<hex>C`-shaped values** (e.g. `^S[0-9A-Fa-f]{16}C$`) — if that's all you have, treat it as "no
   friendly name yet."
4. **Persist the last-good friendly name per-VIN** as the offline fallback (you already persist; keep it).
5. **Cold / nil / only-`S<hex>C` case:** mirror Tesla — **suppress the quoted-name row or degrade to a
   name-free instruction** ("Forget the paired vehicle in Settings > Bluetooth and try again"). **Never quote
   `''` and never substitute the app nickname.** Quoting the *wrong* name (the Red Velvet bug) is worse than
   quoting none; your current "your car" degrade is fine *as long as it omits the quoted token*.
6. **Print the name verbatim** (emoji, diacritics, everything) — do not compose or normalize.

One extra nuance to verify (Ivan's ground truth already covers the practical case): the car exposes **two
radios** — the MCU **classic-BT** device (adapter alias = friendly name, for phone audio) and the **BLE**
phone-key device (VCSEC). Ivan forgetting `🔑 CHUŠKOPEK` fixed the wedge, so whichever entry that is,
forgetting it cleared the BLE bond. Tell the user to forget the entry **labeled with the friendly name** —
which is what worked.

## What to log on-device (you have the pipeline + can wedge the car)

Per-VIN, at every connect **and** at the peer-removed-error instant, side by side:
- **(a) `CBPeripheral.name` / `getName()`** — the OS-cached bonded name; expect `🔑 CHUŠKOPEK` byte-for-byte
  (incl. `F0 9F 94 91`). *This is the ground truth for the Settings string.*
- **(b) `advertisementData[CBAdvertisementDataLocalNameKey]` / `scanRecord.getDeviceName()`** — expect the
  VIN-derived `S<hex>C`. Log whether (a) transitions `S<hex>C → 🔑 CHUŠKOPEK` after `peripheralDidUpdateName`
  (and when it fires).

Two wedge tests that close the only non-static unknowns:
- **Rename test:** rename the car on the touchscreen and reconnect **without re-pairing.** If (a) stays the
  *old* name (while the cloud value updates), that empirically proves the stale-iOS-cache divergence and
  confirms **only the OS name (a) is guaranteed == Settings** — i.e. binding a cloud name would be wrong.
- **Wedge test:** force the car to drop pairing / bump the bonding version to fire error 14 on a still-bonded
  phone, and record which of {`🔑 CHUŠKOPEK`, `S<hex>C`, nil} (a) holds *at that instant* — tells you whether
  the live OS name at row-build time is the Settings string or you must fall back to the persisted per-VIN name.

## Not statically determinable (⚠)
- The exact RN variable the *official* app binds to `{{name}}` (Hermes v96 = string table only) — but the
  recommendation holds under either reading, and airgapp can't reach the cloud source regardless.
- Whether iOS refreshes a bonded device's cached name after a rename (standard CoreBluetooth says no — the
  divergence path — but measure it).
- What VCSEC's `0x2A00` returns on an unbonded link (separate ECU, absent from this MCU rootfs).

## Provenance
Finders `name-source`, `gap-name-and-emoji` (incl. 3.7 GB firmware emoji hunt), `cold-case` + verifier
`name-binding` (**REFUTED** the cloud-name binding, high on the OS-name recommendation). Reports:
`scratchpad/findings8/*.md`.
