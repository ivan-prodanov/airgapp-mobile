# Multi-Vehicle Support Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Enrol more than one real Tesla, send commands to any of them, and have walk-up passive entry unlock whichever one you approach — on both iOS and Android.

**Architecture:** Replace the app's single-enrolled-car assumption with the official Tesla app's model, read out of its decompiled APK: a `Map<VIN, controller>` of independent per-car BLE controllers held concurrently, every command addressed by VIN, and a separate "selected VIN" that only drives what the UI shows. One device keypair stays global — that is the phone's identity and is enrolled into each car, which is already how this app stores it.

**Tech Stack:** TypeScript / React Native (Expo SDK 56), Kotlin (`modules/expo-passive-entry/android`), Swift (`modules/expo-passive-entry/ios`), `@noble/curves` P-256, VCSEC protobuf over BLE GATT.

## Global Constraints

- One device keypair for all cars. `ble.deviceKey.v1` is the phone's identity; each car enrols the same public key. **Never** make the device key per-VIN.
- Every persisted per-car value MUST be keyed by VIN. Existing correct examples: `carlink.cache.${vin}`, `peekPiSessionId(vin)`, Android's `peripheral_mac_<vin>`.
- Secrets (device key, Pi token, car configs) go through the injected `SecretStore` (Keychain / EncryptedSharedPreferences), never AsyncStorage. See `src/ble/keystore.ts` header.
- No behaviour change for a single-car install. Every storage change ships with a migration and a test that a pre-existing single-car install still works.
- iOS must keep building with the hand-maintained `ios/` project — never run `expo prebuild`. Same for `android/`. See AGENTS.md.
- Android BLE scans must stay bounded (20s windows) and must not exceed 5 scan starts per 30s.
- Tests run with `npm test`; typecheck with `npx tsc --noEmit`. Both must pass before every commit.

---

## Research: what the official app does

Read from the decompiled APK at `~/Downloads/com.teslamotors.tesla_4.58.0-*`, `classes8.dex`
(`jadx -d out --no-res dex/classes8.dex`), package `com.teslamotors.plugins.ble`:

| Evidence | File:line | What it establishes |
|---|---|---|
| `private final Map<String, g0> j = new HashMap();` | `BLEService.java:31` | VIN → BLE controller. One controller per car. |
| `"creating new ble controller for vin %s"` | `BLEService.java:1426` | Controllers are created per VIN, on demand. |
| `"Skipping initialization due to missing vins"` | `BLEService.java:1409` | The service initialises from a LIST of vins. |
| `data.getString("vin")` … `"SendRoutableData: missing vin or payload, dropping message"` | `BLEService.java:616` | Every outbound command is addressed by VIN and dropped without one. |
| `setSelectedVIN` | `BLEService.java:951` | A *selected* car exists for the UI, and is separate from which cars are connected. |
| `private final Set<Peripheral> f = Collections.newSetFromMap(new ConcurrentHashMap());` | `q1.java:23` | A controller holds peripherals concurrently. |
| `private final String vin;` + `ff0.g.e(this.vin, PERIPHERALSTATE_CONNECTED)` | `Peripheral.java:39,174` | Each peripheral owns its VIN and reports state per-VIN. |
| `new Peripheral(pos, q(), this.i.getRemoteDevice(mac), …)` from `j0()` | `q1.java:398,472` | Reconnect by REMEMBERED MAC, keyed per VIN. Already ported to Android in commit `630a636`. |

**Conclusion:** cars are connected concurrently, not one at a time. "Which car is on screen" is a
separate, purely-UI concern.

## Current state of this codebase

**Already correct for N cars — do not change:**

| Thing | Where | Why it is fine |
|---|---|---|
| Device keypair | `ble.deviceKey.v1`, `src/ble/keystore.ts:44` | One phone identity enrolled into each car. Matches Tesla. |
| Telemetry cache | `carlink.cache.${vin}`, `src/state/carLinkCache.ts:149` | Already per-VIN. |
| Pi session cache | `peekPiSessionId(vin)`, `src/ble/session.ts:213` | Already per-VIN. |
| Fleet shape | `FleetState { vehicles: Vehicle[]; activeId }`, `src/state/fleet.ts:32` | Already a list. |
| Android remembered MAC | `peripheral_mac_<vin>`, `PassiveEntryCentral.kt:234` | Already per-VIN (commit `630a636`). |

**Single-car blockers — this plan removes each one:**

| # | Blocker | Where |
|---|---|---|
| B1 | `CarConfig` is a single slot; enrolling a second car overwrites the first | `src/ble/config.ts:32,54` |
| B2 | `bindVehicleVin` deliberately CLEARS the vin from every other vehicle | `src/state/fleet.ts:59-71` |
| B3 | `updateEnrolledVehicleState` hardcodes `vehicles[0]` as the real car | `src/state/fleet.ts:185-200` |
| B4 | The VIN is bound only to `fleet.vehicles[0]` | `src/state/useFleetState.ts:190-194` |
| B5 | `activeIsLive` compares against ONE `carLink.vin` | `src/state/useFleetState.ts:199` |
| B6 | One `gatewayRef` / `selectorRef` / `vin` for the whole app | `src/state/useCarLink.ts:676-700` |
| B7 | `foregroundBleLink` is a module singleton holding one `vin` | `src/ble/foregroundBleLink.ts:80` |
| B8 | Native centrals are single-armed (`start(vin)`, one `targetName`) | `PassiveEntryCentral.kt:127`, `.swift:188` |
| B9 | iOS persists `peripheralId`, `vin` and the whole `sess.*` block GLOBALLY | `PassiveEntryCentral.swift:38,46,55-59` |
| B10 | Enrolment writes one car and replaces | `src/app/carlink.tsx:788` |

**B9 is a correctness bug today, not just a limitation.** `sess.epoch`, `sess.counter`,
`sess.clockBase` and `sess.carPub` are VCSEC anti-replay state. Arming car B after car A leaves car
A's session state in place, and `start(vin:)` never clears it.

## File Structure

**Part 1 — N enrolled cars, commands to any (ships on its own):**

| File | Responsibility |
|---|---|
| `src/ble/types.ts` | `CarConfig` unchanged; add `EnrolledCars { cars: CarConfig[]; selectedVin: string \| null }`. |
| `src/ble/config.ts` | List-shaped car storage + migration from the single slot. |
| `src/ble/config.test.ts` | Migration + list semantics. |
| `src/state/fleet.ts` | `bindVehicleVin` stops clearing others; `updateVehicleStateByVin` replaces `updateEnrolledVehicleState`. |
| `src/state/useCarLink.ts` | `Map<vin, gateway>`; `dispatch(vin, cmd, …)`. |
| `src/state/useFleetState.ts` | `activeIsLive` against the SET of linked vins. |
| `src/app/carlink.tsx` | Add / list / remove cars instead of replace. |

**Part 2 — passive entry for every enrolled car:**

| File | Responsibility |
|---|---|
| `modules/expo-passive-entry/android/.../CarCentral.kt` | **New.** One car's BLE controller (today's `PassiveEntryCentral` body, VIN-scoped). |
| `modules/expo-passive-entry/android/.../PassiveEntryCentral.kt` | Becomes the registry: `Map<VIN, CarCentral>`. |
| `modules/expo-passive-entry/ios/CarCentral.swift` | **New.** Same split for iOS, with per-VIN `UserDefaults` keys. |
| `modules/expo-passive-entry/ios/PassiveEntryCentral.swift` | Becomes the registry. |
| `modules/expo-passive-entry/src/*.ts` | `startPassiveEntry(vins: string[])`; frame/state events carry `vin`. |
| `src/ble/foregroundBleLink.ts` | `Map<vin, link>`; `linkFor(vin)`. |

---

## Part 1 — N enrolled cars

### Task 1: List-shaped car storage with migration

**Files:**
- Modify: `src/ble/types.ts:65-69`
- Modify: `src/ble/config.ts:32-62`
- Test: `src/ble/config.test.ts`

**Interfaces:**
- Consumes: `SecretStore` from `src/ble/types.ts`.
- Produces:
  - `loadEnrolledCars(store: SecretStore): Promise<EnrolledCars>`
  - `addCar(store: SecretStore, cfg: CarConfig): Promise<EnrolledCars>`
  - `removeCar(store: SecretStore, vin: string): Promise<EnrolledCars>`
  - `selectCar(store: SecretStore, vin: string): Promise<EnrolledCars>`
  - `loadCarConfig(store)` KEPT, now returning the **selected** car, so no existing caller breaks.

- [ ] **Step 1: Write the failing test**

```ts
// src/ble/config.test.ts — append
import { loadEnrolledCars, addCar, removeCar, selectCar, loadCarConfig } from './config';

test('migrates a single-slot install into the list, selected', async () => {
  const store = memoryStore();
  await store.setItem('ble.carConfig.v1', JSON.stringify({ vin: 'VIN_A', nickname: 'Red' }));
  const cars = await loadEnrolledCars(store);
  assert.deepEqual(cars.cars.map((c) => c.vin), ['VIN_A']);
  assert.equal(cars.selectedVin, 'VIN_A');
  // The legacy caller still sees its car.
  assert.equal((await loadCarConfig(store))?.vin, 'VIN_A');
});

test('adding a second car keeps the first and does not change the selection', async () => {
  const store = memoryStore();
  await addCar(store, { vin: 'VIN_A' });
  const after = await addCar(store, { vin: 'VIN_B' });
  assert.deepEqual(after.cars.map((c) => c.vin), ['VIN_A', 'VIN_B']);
  assert.equal(after.selectedVin, 'VIN_A');
});

test('adding the same VIN twice updates it rather than duplicating', async () => {
  const store = memoryStore();
  await addCar(store, { vin: 'VIN_A' });
  const after = await addCar(store, { vin: 'VIN_A', nickname: 'Renamed' });
  assert.equal(after.cars.length, 1);
  assert.equal(after.cars[0].nickname, 'Renamed');
});

test('removing the selected car selects another', async () => {
  const store = memoryStore();
  await addCar(store, { vin: 'VIN_A' });
  await addCar(store, { vin: 'VIN_B' });
  const after = await removeCar(store, 'VIN_A');
  assert.deepEqual(after.cars.map((c) => c.vin), ['VIN_B']);
  assert.equal(after.selectedVin, 'VIN_B');
});

test('removing the last car leaves no selection', async () => {
  const store = memoryStore();
  await addCar(store, { vin: 'VIN_A' });
  const after = await removeCar(store, 'VIN_A');
  assert.deepEqual(after.cars, []);
  assert.equal(after.selectedVin, null);
});
```

`memoryStore()` already exists in this test file. If it does not, add:

```ts
function memoryStore() {
  const m = new Map<string, string>();
  return {
    getItem: async (k: string) => m.get(k) ?? null,
    setItem: async (k: string, v: string) => void m.set(k, v),
    removeItem: async (k: string) => void m.delete(k),
  };
}
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `npx tsx --test src/ble/config.test.ts` (or `npm test`)
Expected: FAIL — `loadEnrolledCars is not a function`.

- [ ] **Step 3: Add the type**

```ts
// src/ble/types.ts — after CarConfig (line 69)

/**
 * Every car this phone is enrolled with, plus which one the UI is showing.
 *
 * The selection is a UI concern ONLY — it never limits which cars hold a BLE link or which cars
 * can be commanded. That split is taken from the official app, whose BLEService keeps a
 * `Map<String, controller>` of connected cars alongside a separate `setSelectedVIN`.
 */
export interface EnrolledCars {
  cars: CarConfig[];
  selectedVin: string | null;
}
```

- [ ] **Step 4: Implement the storage**

```ts
// src/ble/config.ts — replace the "Car identity" section (lines ~34-62)

const CARS_STORAGE_KEY = 'ble.cars.v2';

/**
 * Every enrolled car, migrating a pre-v2 single-slot install on first read.
 *
 * The old key held ONE CarConfig, so enrolling a second car overwrote the first. It is still read
 * here (and left in place, untouched) so a downgrade does not strand the car; the first write of
 * the v2 key is what actually migrates.
 */
export async function loadEnrolledCars(store: SecretStore): Promise<EnrolledCars> {
  const raw = await store.getItem(CARS_STORAGE_KEY);
  if (raw) {
    const parsed = JSON.parse(raw) as Partial<EnrolledCars>;
    const cars = parsed.cars ?? [];
    const selectedVin =
      parsed.selectedVin && cars.some((c) => c.vin === parsed.selectedVin)
        ? parsed.selectedVin
        : (cars[0]?.vin ?? null);
    return { cars, selectedVin };
  }
  const legacy = await loadLegacyCarConfig(store);
  return legacy ? { cars: [legacy], selectedVin: legacy.vin } : { cars: [], selectedVin: null };
}

async function saveEnrolledCars(store: SecretStore, next: EnrolledCars): Promise<EnrolledCars> {
  await store.setItem(CARS_STORAGE_KEY, JSON.stringify(next));
  return next;
}

/** Add or update a car by VIN. Never changes the current selection. */
export async function addCar(store: SecretStore, cfg: CarConfig): Promise<EnrolledCars> {
  const cur = await loadEnrolledCars(store);
  const i = cur.cars.findIndex((c) => c.vin === cfg.vin);
  const cars = i === -1 ? [...cur.cars, cfg] : cur.cars.map((c, n) => (n === i ? cfg : c));
  return saveEnrolledCars(store, { cars, selectedVin: cur.selectedVin ?? cfg.vin });
}

/** Forget a car. Destructive: the app can no longer reach it over BLE. */
export async function removeCar(store: SecretStore, vin: string): Promise<EnrolledCars> {
  const cur = await loadEnrolledCars(store);
  const cars = cur.cars.filter((c) => c.vin !== vin);
  const selectedVin = cur.selectedVin === vin ? (cars[0]?.vin ?? null) : cur.selectedVin;
  return saveEnrolledCars(store, { cars, selectedVin });
}

/** Change which car the UI shows. Does not disconnect anything. */
export async function selectCar(store: SecretStore, vin: string): Promise<EnrolledCars> {
  const cur = await loadEnrolledCars(store);
  if (!cur.cars.some((c) => c.vin === vin)) return cur;
  return saveEnrolledCars(store, { ...cur, selectedVin: vin });
}

/** The legacy single-slot read, kept for the migration above only. */
async function loadLegacyCarConfig(store: SecretStore): Promise<CarConfig | null> {
  const raw = await store.getItem(CAR_CONFIG_STORAGE_KEY);
  if (raw) return JSON.parse(raw) as CarConfig;
  const legacy = await store.getItem(PI_CONFIG_STORAGE_KEY);
  if (!legacy) return null;
  const parsed = JSON.parse(legacy) as { vin?: string; nickname?: string; vehicleId?: string };
  if (!parsed.vin) return null;
  return { vin: parsed.vin, nickname: parsed.nickname, vehicleId: parsed.vehicleId };
}

/**
 * The SELECTED car. Every existing caller means "the car the user is looking at", which is exactly
 * this — so they keep working unchanged while the storage underneath grew a list.
 */
export async function loadCarConfig(store: SecretStore): Promise<CarConfig | null> {
  const { cars, selectedVin } = await loadEnrolledCars(store);
  return cars.find((c) => c.vin === selectedVin) ?? cars[0] ?? null;
}
```

Keep `saveCarConfig` and `clearCarConfig` as thin wrappers so nothing else breaks yet:

```ts
export async function saveCarConfig(store: SecretStore, cfg: CarConfig): Promise<void> {
  await addCar(store, cfg);
}

export async function clearCarConfig(store: SecretStore): Promise<void> {
  const { cars } = await loadEnrolledCars(store);
  for (const c of cars) await removeCar(store, c.vin);
}
```

Add `EnrolledCars` to the import at the top of `config.ts`:

```ts
import type { CarConfig, EnrolledCars, PiConfig, SecretStore } from './types';
```

- [ ] **Step 5: Run the tests**

Run: `npm test`
Expected: PASS, and no existing test regresses.

- [ ] **Step 6: Commit**

```bash
git add src/ble/types.ts src/ble/config.ts src/ble/config.test.ts
git commit -m "feat(ble): store a LIST of enrolled cars, migrating the single slot"
```

---

### Task 2: Let the fleet hold more than one real car

**Files:**
- Modify: `src/state/fleet.ts:59-71` (`bindVehicleVin`), `:185-200` (`updateEnrolledVehicleState`)
- Test: `src/state/fleet.test.ts`

**Interfaces:**
- Produces: `bindVehicleVin(fleet, id, vin)` no longer clears other vins;
  `updateVehicleStateByVin(fleet: FleetState, vin: string, update: (s: VehicleViewState) => VehicleViewState): FleetState`.
- `updateEnrolledVehicleState` is DELETED; its one caller moves to `updateVehicleStateByVin`.

- [ ] **Step 1: Write the failing test**

```ts
// src/state/fleet.test.ts — append
test('two vehicles can each carry their own vin', () => {
  let f: FleetState = { vehicles: [veh('a'), veh('b')], activeId: 'a' };
  f = bindVehicleVin(f, 'a', 'VIN_A');
  f = bindVehicleVin(f, 'b', 'VIN_B');
  assert.equal(f.vehicles[0].vin, 'VIN_A');
  assert.equal(f.vehicles[1].vin, 'VIN_B');
});

test('re-binding a vin to a different vehicle moves it, not duplicates it', () => {
  let f: FleetState = { vehicles: [veh('a'), veh('b')], activeId: 'a' };
  f = bindVehicleVin(f, 'a', 'VIN_A');
  f = bindVehicleVin(f, 'b', 'VIN_A');
  assert.equal(f.vehicles[0].vin, undefined);
  assert.equal(f.vehicles[1].vin, 'VIN_A');
});

test('updateVehicleStateByVin targets the right car, not vehicles[0]', () => {
  let f: FleetState = { vehicles: [veh('a'), veh('b')], activeId: 'a' };
  f = bindVehicleVin(f, 'b', 'VIN_B');
  f = updateVehicleStateByVin(f, 'VIN_B', (s) => ({ ...s, locked: false }));
  assert.equal(f.vehicles[1].state.locked, false);
  assert.equal(f.vehicles[0].state.locked, true);
});
```

`veh(id)` helper, if the file lacks one:

```ts
function veh(id: string): Vehicle {
  return { id, name: id, state: { ...initialVehicleState } };
}
```

- [ ] **Step 2: Run to verify it fails**

Run: `npm test`
Expected: FAIL — the first test fails because `bindVehicleVin` clears `VIN_A`; `updateVehicleStateByVin` is undefined.

- [ ] **Step 3: Implement**

```ts
// src/state/fleet.ts — replace bindVehicleVin (lines 59-71)

/**
 * Mark a vehicle as an enrolled car. Idempotent.
 *
 * It used to CLEAR the vin from every other vehicle, on a single-enrolled-car assumption tied to
 * useCarLink holding one gateway. That is gone: useCarLink now keeps a gateway per VIN, matching
 * the official app's `Map<String, controller>`, so several vehicles carrying their own vin is the
 * normal case. What must still never happen is ONE vin on TWO vehicles — that would make "which
 * car is this?" unanswerable — so a re-bind moves it.
 */
export function bindVehicleVin(fleet: FleetState, id: string, vin: string): FleetState {
  const already = fleet.vehicles.every((v) =>
    v.id === id ? v.vin === vin : v.vin !== vin,
  );
  if (already) return fleet;
  return {
    ...fleet,
    vehicles: fleet.vehicles.map((v) =>
      v.id === id ? { ...v, vin } : v.vin === vin ? { ...v, vin: undefined } : v,
    ),
  };
}
```

```ts
// src/state/fleet.ts — replace updateEnrolledVehicleState (lines 185-200)

/**
 * Update ONE enrolled car's state, found by VIN.
 *
 * Replaces updateEnrolledVehicleState, which wrote `vehicles[0]` because there could only ever be
 * one real car. Used by the launch-time cache rehydrate, which must seed each enrolled car with
 * its own persisted telemetry regardless of which car is on screen or whether its link is up —
 * bypassing the "active-is-live" gate that live telemetry uses (that gate stops live reads bleeding
 * into a demo car; a rehydrate of a car's OWN last-known values is not that).
 */
export function updateVehicleStateByVin(
  fleet: FleetState,
  vin: string,
  update: (state: VehicleViewState) => VehicleViewState,
): FleetState {
  const i = fleet.vehicles.findIndex((v) => v.vin === vin);
  if (i === -1) return fleet;
  const vehicles = fleet.vehicles.slice();
  vehicles[i] = { ...vehicles[i], state: update(vehicles[i].state) };
  return { ...fleet, vehicles };
}
```

- [ ] **Step 4: Update the one caller**

```bash
grep -rn "updateEnrolledVehicleState" src/ --include=*.ts --include=*.tsx
```

Replace each call `updateEnrolledVehicleState(f, fn)` with
`updateVehicleStateByVin(f, vin, fn)`, taking `vin` from the cache entry being rehydrated.

- [ ] **Step 5: Run the tests**

Run: `npm test && npx tsc --noEmit`
Expected: PASS, clean typecheck.

- [ ] **Step 6: Commit**

```bash
git add src/state/fleet.ts src/state/fleet.test.ts
git commit -m "feat(fleet): several vehicles may each carry their own vin"
```

---

### Task 3: A gateway per VIN in useCarLink

**Files:**
- Modify: `src/state/useCarLink.ts:209-215` (`dispatchToCar`), `:676-700` (gateway construction), `:430` (`vin` state)
- Test: `src/state/useCarLink.test.ts` (create if absent)

**Interfaces:**
- Consumes: `loadEnrolledCars` from Task 1.
- Produces on the `CarLink` value:
  - `linkedVins: string[]` (replaces the single `vin: string | null`, which stays as the selected car's vin for existing readers)
  - `dispatch(vin: string, cmd: CarCommand, rollback: () => void, affectedKeys?: VehicleStateKey[]): void`

- [ ] **Step 1: Write the failing test**

```ts
// src/state/useCarLink.test.ts
import { gatewayCacheKey, pickGateway } from './useCarLink';

test('each vin gets its own gateway instance', () => {
  const made: string[] = [];
  const cache = new Map<string, { id: string }>();
  const a = pickGateway(cache, 'VIN_A', (v) => { made.push(v); return { id: v }; });
  const b = pickGateway(cache, 'VIN_B', (v) => { made.push(v); return { id: v }; });
  const a2 = pickGateway(cache, 'VIN_A', (v) => { made.push(v); return { id: v }; });
  assert.equal(a.id, 'VIN_A');
  assert.equal(b.id, 'VIN_B');
  assert.equal(a2, a, 'the second ask for VIN_A must reuse the first gateway');
  assert.deepEqual(made, ['VIN_A', 'VIN_B']);
});
```

- [ ] **Step 2: Run to verify it fails**

Run: `npm test`
Expected: FAIL — `pickGateway` is not exported.

- [ ] **Step 3: Implement the cache helper**

```ts
// src/state/useCarLink.ts — near the top, exported for the test

/**
 * One gateway per VIN, created on demand and reused.
 *
 * The app used to hold a single `gatewayRef`, which is what forced the whole single-enrolled-car
 * design. The official app keeps `Map<String, controller>` keyed by VIN (BLEService.java:31) and
 * creates a controller lazily per car ("creating new ble controller for vin %s", :1426); this is
 * that, in TypeScript.
 */
export function pickGateway<T>(cache: Map<string, T>, vin: string, make: (vin: string) => T): T {
  const hit = cache.get(vin);
  if (hit) return hit;
  const made = make(vin);
  cache.set(vin, made);
  return made;
}
```

- [ ] **Step 4: Convert the refs**

Replace `const gatewayRef = useRef<CarGateway | null>(null)` and the matching `selectorRef` with:

```ts
const gatewaysRef = useRef(new Map<string, CarGateway>());
const selectorsRef = useRef(new Map<string, ReturnType<typeof createSelectingTransport>>());
```

Every read of `gatewayRef.current` becomes
`pickGateway(gatewaysRef.current, vin, (v) => buildGateway(v))`, where `buildGateway(vin)` is the
existing construction body (lines ~676-700) with `carCfg.vin` replaced by its `vin` argument, and
`new BridgedBleTransport(...)` replaced by `new BridgedBleTransport({ vin, scanTimeoutMs: AUTO_BLE_SCAN_TIMEOUT_MS })`
(the `vin` option is added in Task 6; until then pass only `scanTimeoutMs`).

Anywhere the code drops the gateway on a config change, clear the whole map:

```ts
gatewaysRef.current.clear();
selectorsRef.current.clear();
```

- [ ] **Step 5: Make dispatch take a VIN**

```ts
// src/state/useCarLink.ts — replace dispatchToCar's counterpart on the CarLink value
dispatch: (vin: string, cmd: CarCommand, rollback: () => void, affectedKeys: VehicleStateKey[] = []) => {
  // Addressed by VIN, like the official app's SendRoutableData, which drops a message outright when
  // the vin is missing (BLEService.java:616). A command with no car is a bug, not a default.
  const gw = pickGateway(gatewaysRef.current, vin, buildGateway);
  // …existing body, using `gw` instead of gatewayRef.current…
},
```

- [ ] **Step 6: Expose the linked set**

```ts
// Replace `const [vin, setVin] = useState<string | null>(null)` usage in the returned value with:
linkedVins,          // string[] — every enrolled car
vin: selectedVin,    // kept: the SELECTED car, what existing readers already meant
```

where `linkedVins` comes from `loadEnrolledCars(store)` in the same effect that used to call
`loadCarConfig` (line ~587):

```ts
const enrolled = await loadEnrolledCars(store);
setLinkedVins(enrolled.cars.map((c) => c.vin));
setVin(enrolled.selectedVin);
setLinked(enrolled.cars.length > 0);
```

- [ ] **Step 7: Run the tests**

Run: `npm test && npx tsc --noEmit`
Expected: PASS. Fix every call site the typechecker flags — `dispatch` now needs a VIN.

- [ ] **Step 8: Commit**

```bash
git add src/state/useCarLink.ts src/state/useCarLink.test.ts
git commit -m "feat(carlink): one gateway per VIN, commands addressed by VIN"
```

---

### Task 4: activeIsLive against the set of enrolled cars

**Files:**
- Modify: `src/state/useFleetState.ts:188-200`
- Test: `src/state/fleet.test.ts` (extend the existing `activeIsLive` helper test at line ~398)

**Interfaces:**
- Consumes: `carLink.linkedVins` (Task 3), `bindVehicleVin` (Task 2).

- [ ] **Step 1: Write the failing test**

```ts
// src/state/fleet.test.ts — replace the activeIsLive helper and add cases
const activeIsLive = (activeVin: string | undefined, linkedVins: string[]) =>
  !!activeVin && linkedVins.includes(activeVin);

test('the second enrolled car is live when it is the active one', () => {
  assert.equal(activeIsLive('VIN_B', ['VIN_A', 'VIN_B']), true);
});

test('a demo car is never live', () => {
  assert.equal(activeIsLive(undefined, ['VIN_A', 'VIN_B']), false);
});

test('an unenrolled vin is not live', () => {
  assert.equal(activeIsLive('VIN_C', ['VIN_A', 'VIN_B']), false);
});
```

- [ ] **Step 2: Run to verify it fails**

Run: `npm test`
Expected: FAIL — the old helper takes `(activeVin, enrolled, linked)`.

- [ ] **Step 3: Implement**

```ts
// src/state/useFleetState.ts — replace lines 188-200

// Bind every enrolled car's vin onto a vehicle. One vehicle per vin; a vin already bound elsewhere
// moves (see bindVehicleVin). Vehicles beyond the enrolled set stay demo cars with no vin.
useEffect(() => {
  setFleet((f) => {
    let next = f;
    carLink.linkedVins.forEach((vin, i) => {
      const already = next.vehicles.find((v) => v.vin === vin);
      const target = already ?? next.vehicles[i];
      if (target) next = bindVehicleVin(next, target.id, vin);
    });
    return next;
  });
}, [carLink.linkedVins]);

// THE narrowing. A command is only ever legitimate when the car ON SCREEN is an enrolled one.
// Without this, tapping Lock on a demo Model S sent a real lock to the real Tesla. It is now a set
// membership test rather than equality with the single linked vin.
const activeIsLive = !!current.vin && carLink.linkedVins.includes(current.vin);
activeIsLiveRef.current = activeIsLive;
```

- [ ] **Step 4: Route dispatch with the active vin**

`dispatchToCar` (line ~209) must pass the active car's VIN:

```ts
const dispatchToCar = useCallback(
  (cmd: CarCommand, onFail: () => void = () => {}, keys: VehicleStateKey[] = []) => {
    const vin = currentRef.current.vin;
    if (!activeIsLiveRef.current || !vin) return;
    carLink.dispatch(vin, cmd, onFail, keys);
  },
  [carLink],
);
```

Add `const currentRef = useRef(current); currentRef.current = current;` beside the other refs.

- [ ] **Step 5: Run the tests**

Run: `npm test && npx tsc --noEmit`
Expected: PASS.

- [ ] **Step 6: Commit**

```bash
git add src/state/useFleetState.ts src/state/fleet.test.ts
git commit -m "feat(fleet): the active car is live when it is any enrolled car"
```

---

### Task 5: Enrol a second car from the UI

**Files:**
- Modify: `src/app/carlink.tsx:780-800`
- Modify: `src/components/CarsSheet.tsx` (the header-name dropdown; see the cars-dropdown memory)
- Test: manual on device, plus `src/ble/config.test.ts` already covers the storage

**Interfaces:**
- Consumes: `addCar`, `removeCar`, `selectCar`, `loadEnrolledCars` (Task 1).

- [ ] **Step 1: Add rather than replace**

```ts
// src/app/carlink.tsx — replace line 788
// addCar, not saveCarConfig: enrolling a second car must not evict the first. The device key is
// unchanged and global — the same public key is enrolled into each car, which is exactly how the
// official app works.
await addCar(store, { vin });
```

Update the import on line 24 from `saveCarConfig` to `addCar`.

- [ ] **Step 2: List enrolled cars on the carlink screen**

Render, above the VIN field:

```tsx
{enrolled.cars.map((c) => (
  <View key={c.vin} style={styles.row}>
    <Text style={styles.mono}>{c.vin}</Text>
    {c.vin === enrolled.selectedVin ? <Text style={styles.badge}>selected</Text> : null}
    <Pressable onPress={() => void selectCar(store, c.vin).then(setEnrolled)}>
      <Text style={styles.link}>select</Text>
    </Pressable>
    <Pressable onPress={() => void removeCar(store, c.vin).then(setEnrolled)}>
      <Text style={styles.link}>forget</Text>
    </Pressable>
  </View>
))}
```

with `const [enrolled, setEnrolled] = useState<EnrolledCars>({ cars: [], selectedVin: null });`
loaded in an effect via `loadEnrolledCars(store).then(setEnrolled)`.

- [ ] **Step 3: Make the Cars dropdown switch real cars**

In `CarsSheet`, when the tapped vehicle has a `vin`, call `selectCar(store, vin)` as well as
setting `activeId`. Selecting a car must NOT disconnect anything — it is a UI-only concern, exactly
as `setSelectedVIN` is in the official app (`BLEService.java:951`).

- [ ] **Step 4: Verify on device**

```bash
bash scripts/android/deploy-js.sh
```

Enrol a second VIN on the carlink screen, confirm both cars list, switch between them in the Cars
dropdown, and confirm the first car's VIN survives a force-stop:

```bash
adb shell "run-as local.airgapp.mobile cat files/SQLite/carlink-log.db" > /tmp/cl.db
```

- [ ] **Step 5: Commit**

```bash
git add src/app/carlink.tsx src/components/CarsSheet.tsx
git commit -m "feat(carlink): enrol, list, select and forget more than one car"
```

---

## Part 2 — Passive entry for every enrolled car

> Part 1 ships on its own. Do not start Part 2 until a second car has actually been enrolled and
> commanded on device — the whole point of Part 2 is unattended behaviour, which is far harder to
> debug on top of an unverified Part 1.

### Task 6: Android — one CarCentral per VIN

**Files:**
- Create: `modules/expo-passive-entry/android/src/main/java/expo/modules/passiveentry/CarCentral.kt`
- Modify: `modules/expo-passive-entry/android/src/main/java/expo/modules/passiveentry/PassiveEntryCentral.kt`
- Modify: `modules/expo-passive-entry/android/src/main/java/expo/modules/passiveentry/PassiveEntryModule.kt`

**Interfaces:**
- Produces: `CarCentral(context, vin)` with today's `PassiveEntryCentral` API (`start()`, `stop()`,
  `write(bytes)`, `isConnected()`, `onLog`, `onFrame`, `onConnectionState`) but scoped to one VIN;
  `PassiveEntryCentral.startAll(vins: List<String>)`, `.stopAll()`, `.centralFor(vin): CarCentral?`.
- Every callback gains a `vin` first argument: `onFrame: (vin: String, ByteArray) -> Unit`.

- [ ] **Step 1: Move the body**

`git mv` the class body into `CarCentral.kt`, renaming the class and making the VIN a constructor
parameter rather than `start(vin)` state:

```kotlin
class CarCentral(private val context: Context, val vin: String) {
  private val targetName: String = vehicleLocalName(vin)
  // …everything else unchanged: adapter, gatt, scan window, remembered MAC, standing connect…
  // macKey() simplifies, because the VIN is now fixed for this instance:
  private fun macKey(): String = "peripheral_mac_$vin"
}
```

Keep the remembered-MAC and standing-connect logic exactly as committed in `630a636` — it is
already per-VIN and is the piece the official app also relies on (`q1.j0()` reading a stored
`position-MAC` pair per VIN).

- [ ] **Step 2: Turn PassiveEntryCentral into the registry**

```kotlin
/**
 * The registry — one CarCentral per enrolled VIN, held concurrently.
 *
 * Modelled directly on the official app: BLEService keeps `Map<String, controller>` keyed by VIN
 * (BLEService.java:31) and creates one lazily per car ("creating new ble controller for vin %s",
 * :1426). Cars are connected AT THE SAME TIME; which car the UI shows is a separate concern
 * (setSelectedVIN, :951) and must never gate connectivity — walk-up entry has to work for whichever
 * car you approach, not whichever car is on screen.
 */
object PassiveEntryCentral {
  private val centrals = ConcurrentHashMap<String, CarCentral>()

  var onLog: ((String) -> Unit)? = null
  var onFrame: ((String, ByteArray) -> Unit)? = null
  var onConnectionState: ((String, String, Int) -> Unit)? = null

  fun startAll(context: Context, vins: List<String>) {
    // Drop centrals for cars that are no longer enrolled, so forgetting a car really disconnects it.
    centrals.keys.filter { it !in vins }.forEach { centrals.remove(it)?.stop() }
    vins.forEach { vin ->
      centrals.getOrPut(vin) {
        CarCentral(context, vin).also { c ->
          c.onLog = { line -> onLog?.invoke("[${vin.takeLast(6)}] $line") }
          c.onFrame = { bytes -> onFrame?.invoke(vin, bytes) }
          c.onConnectionState = { state, mtu -> onConnectionState?.invoke(vin, state, mtu) }
        }
      }.start()
    }
  }

  fun stopAll() {
    centrals.values.forEach { it.stop() }
    centrals.clear()
  }

  fun centralFor(vin: String): CarCentral? = centrals[vin]
}
```

- [ ] **Step 3: Widen the module surface**

In `PassiveEntryModule.kt`, change `Function("start") { vin: String -> … }` to take a list, and add
the VIN to every emitted event:

```kotlin
Function("startPassiveEntry") { vins: List<String> ->
  PassiveEntryCentral.startAll(appContext.reactContext!!, vins)
}
Function("writeFrame") { vin: String, b64: String ->
  PassiveEntryCentral.centralFor(vin)?.write(Base64.decode(b64, Base64.NO_WRAP))
}
```

Events become `{"vin": vin, "data": b64}` and `{"vin": vin, "state": state, "mtu": mtu}`.

- [ ] **Step 4: Build**

```bash
cd android && ANDROID_HOME=$HOME/Library/Android/sdk \
  JAVA_HOME=/Library/Java/JavaVirtualMachines/zulu-17.jdk/Contents/Home \
  ./gradlew :expo-passive-entry:compileReleaseKotlin --max-workers=2
```

Expected: BUILD SUCCESSFUL.

- [ ] **Step 5: Commit**

```bash
git add modules/expo-passive-entry/android
git commit -m "feat(android/ble): one CarCentral per VIN, held concurrently"
```

---

### Task 7: iOS — one CarCentral per VIN, per-VIN persistence

**Files:**
- Create: `modules/expo-passive-entry/ios/CarCentral.swift`
- Modify: `modules/expo-passive-entry/ios/PassiveEntryCentral.swift`
- Modify: `modules/expo-passive-entry/ios/PassiveEntryModule.swift`

**Interfaces:** mirrors Task 6 — `CarCentral(vin:)`, `PassiveEntryCentral.startAll(vins:)`,
`.stopAll()`, `.central(for:)`.

- [ ] **Step 1: Scope every persisted key by VIN**

This is a correctness fix, not only a multi-car one. `peripheralIdKey`, `vinKey` and the whole
`sess.*` block are single global keys today, and `start(vin:)` never clears them — so arming car B
after car A leaves car A's VCSEC session state (epoch, counter, clock base, car public key) in
place. Anti-replay state from the wrong car is a real fault.

```swift
// CarCentral.swift
private func key(_ suffix: String) -> String { "airgapp.passiveentry.\(vin).\(suffix)" }
private var peripheralIdKey: String { key("peripheralId") }
private var sessEpochKey: String    { key("sess.epoch") }
private var sessCounterKey: String  { key("sess.counter") }
private var sessClockKey: String    { key("sess.clockBase") }
private var sessWallKey: String     { key("sess.clockWall") }
private var sessCarPubKey: String   { key("sess.carPub") }
```

Migrate on first read: if the per-VIN key is absent and the old global key is present AND the old
global `airgapp.passiveentry.vin` equals this VIN, copy it across, then remove the global.

- [ ] **Step 2: Keep the armed-VIN list, not one VIN**

Replace the single `vinKey` with `airgapp.passiveentry.vins` holding a JSON array, so
`startIfConfigured()` — the background-relaunch path — re-arms every car rather than one.

- [ ] **Step 3: Scan once, dispatch by name**

One `CBCentralManager` serves every car: keep the existing service-filtered scan
(`scanForPeripherals(withServices: [advertisedServiceUUID])`) in the registry, and route each
discovery to the `CarCentral` whose `targetName` matches the advertised local name. This is the one
place the platforms differ in shape — CoreBluetooth gives one manager, and per-car pending connects
hang off it.

- [ ] **Step 4: Build**

```bash
xcodebuild -workspace ios/airgapp.xcworkspace -scheme airgapp -configuration Release \
  -sdk iphoneos -destination 'generic/platform=iOS' -allowProvisioningUpdates build
```

Expected: BUILD SUCCEEDED. (If it fails on signing, renew per AGENTS.md — that is not a code error.)

- [ ] **Step 5: Commit**

```bash
git add modules/expo-passive-entry/ios
git commit -m "feat(ios/ble): one CarCentral per VIN; scope session state per car"
```

---

### Task 8: JS — a link per car

**Files:**
- Modify: `src/ble/foregroundBleLink.ts`
- Modify: `src/ble/bridgedBleTransport.ts:21-45`
- Modify: `modules/expo-passive-entry/index.ts` (or `src/*.ts`)
- Test: `src/ble/foregroundBleLink.test.ts`

**Interfaces:**
- Produces: `linkFor(vin: string): ForegroundBleLink`; `startPassiveEntry(vins: string[])`;
  `BridgedBleTransport` gains a required `vin` option and uses `linkFor(vin)`.

- [ ] **Step 1: Write the failing test**

```ts
// src/ble/foregroundBleLink.test.ts
import { linkFor } from './foregroundBleLink';

test('each vin gets its own link, reused across calls', () => {
  const a = linkFor('VIN_A');
  const b = linkFor('VIN_B');
  assert.notEqual(a, b);
  assert.equal(linkFor('VIN_A'), a);
});
```

- [ ] **Step 2: Run to verify it fails**

Run: `npm test`
Expected: FAIL — `linkFor` is not exported.

- [ ] **Step 3: Implement**

```ts
// src/ble/foregroundBleLink.ts — replace the singleton export at the bottom

const links = new Map<string, ForegroundBleLink>();

/**
 * One link per car. The module used to export a single instance holding one `vin`, which is what
 * made "the enrolled car" singular all the way up the stack. Native now keeps a CarCentral per VIN
 * (see PassiveEntryCentral.startAll), so the JS side mirrors that: frames arrive tagged with a vin
 * and are demultiplexed here.
 */
export function linkFor(vin: string): ForegroundBleLink {
  const hit = links.get(vin);
  if (hit) return hit;
  const made = new ForegroundBleLink(vin);
  links.set(vin, made);
  return made;
}

export function startAllLinks(vins: string[]): void {
  for (const vin of vins) linkFor(vin).start();
  for (const [vin, link] of links) if (!vins.includes(vin)) { link.stop(); links.delete(vin); }
}
```

`ForegroundBleLink`'s constructor takes the VIN; `start()` loses its argument and calls
`startPassiveEntry([this.vin])`. The single native frame subscription moves to module scope and
routes on the event's `vin`:

```ts
onPassiveEntryFrame((e) => links.get(e.vin)?.onNativeFrame(base64ToBytes(e.data)));
onPassiveEntryConnectionState((e) => links.get(e.vin)?.onNativeConnectionState(e));
```

- [ ] **Step 4: Give the transport a VIN**

```ts
// src/ble/bridgedBleTransport.ts
constructor(opts: { vin: string; scanTimeoutMs?: number }) {
  this.vin = opts.vin;
  this.link = linkFor(opts.vin);
  this.connectBudgetMs = opts.scanTimeoutMs ?? CONNECT_TIMEOUT_MS;
}
```

Replace every `foregroundBleLink.` with `this.link.` in that file.

- [ ] **Step 5: Run the tests**

Run: `npm test && npx tsc --noEmit`
Expected: PASS. The typechecker will flag every `new BridgedBleTransport(` missing a `vin` — fix
each, taking the VIN from the surrounding gateway.

- [ ] **Step 6: Commit**

```bash
git add src/ble modules/expo-passive-entry
git commit -m "feat(ble): a foreground link per car, frames demultiplexed by vin"
```

---

### Task 9: Verify two cars on real hardware

**Files:** none — this is the acceptance gate.

- [ ] **Step 1: Enrol the second car**

At car B, with it awake, run the enrol flow. Confirm both VINs list on the carlink screen.

- [ ] **Step 2: Command each car**

With both cars in range, lock car A from the app, then switch cars in the dropdown and lock car B.
Confirm each physically responds and that the other does not move.

- [ ] **Step 3: Confirm concurrent links**

```bash
adb logcat -s PassiveEntry | grep -E "\[.*\] CONNECTED"
```

Expected: a `CONNECTED` line tagged with each of the two VIN suffixes, both live at once.

- [ ] **Step 4: Walk-up entry, both cars**

Lock the phone. Walk to car A — confirm it unlocks. Walk to car B — confirm it unlocks, without
opening the app in between and without selecting car B in the UI.

- [ ] **Step 5: Record the result**

Update `docs/android-parity.md` and add a memory note recording what was measured — per-car
connection timings and whether both links held simultaneously.

- [ ] **Step 6: Commit**

```bash
git add docs/android-parity.md
git commit -m "docs: two-car passive entry verified on hardware"
```

---

## Known gaps this plan does not close

- **Android background passive entry** still needs the Phase 4 foreground service
  (`docs/superpowers/plans/2026-08-21-android-port.md`, Phase 4 Task 1). Task 9 Step 4 will only
  pass on Android once that service exists; on iOS it works from `bluetooth-central` background
  mode today. Do Phase 4 first if walk-up entry on Android is the priority.
- **Two cars advertising at once** is untested against the scan matcher. The Android matcher accepts
  a result on the advertised service `1122` when no name is present, and rejects a name that is a
  valid `S<16 hex>C` token for a *different* car — but with two enrolled cars both advertising
  unnamed, it cannot tell them apart until after connecting. If Task 9 Step 3 shows cross-connection,
  the fix is to confirm identity from the GATT handshake and hand the peripheral to the right
  `CarCentral`, which is what the official app's per-controller `Peripheral` ownership implies.
- **Pi forwarder** is one base URL + token, shared. Per-car forwarders are out of scope; the Pi arm
  already keys sessions by VIN, so a single Pi serving two cars works unchanged.
