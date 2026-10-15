# Car Onboarding & Persisted Fleet Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Replace the hardcoded seed car with an empty-on-fresh-install fleet, a first-run onboarding that pairs a real Tesla over BLE or adds a demo car, and persistence that remembers both across launches.

**Architecture:** Two stores reconciled at boot — `EnrolledCars` (Keychain, real cars' keys, unchanged) + a new non-secret `fleet.v1` (AsyncStorage, presentation: order/names/appearance/active). `useFleetState` hydrates asynchronously, gates the app to onboarding when empty, and persists on change. Appearance is user-chosen for every car (nothing but the VIN model line is inferable); the pair wizard reuses the demo configurator with the model line locked.

**Tech Stack:** Expo SDK 56, React Native, expo-router, TypeScript, `node --test` via `npm test`, AsyncStorage (`AppStorage`), expo-secure-store (`SecretStore`), direct BLE (`@noble/*`).

**Spec:** `docs/superpowers/specs/2026-10-16-car-onboarding-design.md`

## Global Constraints

- Expo SDK 56 — read `https://docs.expo.dev/versions/v56.0.0/` before touching native/config. One line each below is binding on every task.
- **Never** run `expo prebuild` (clobbers the hand-maintained `ios/`/`android/` + Godot embed).
- Pure/logic modules take an injected `AppStorage` (`{ getItem(k): Promise<string|null>; setItem(k,v): Promise<void> }`, `src/state/persistence.ts`) or `SecretStore` (`{ getItem; setItem; removeItem }`, `src/ble/types.ts`) argument — **never import `@react-native-async-storage/async-storage` or `expo-secure-store` directly** in a tested module (they can't load under node/tsx). RN-only wiring imports `appStorage` (`src/state/appStorage.ts`) and `secureStoreSecretStore as store` (`src/ble/secureStoreSecretStore.ts`).
- Tests live at `src/**/*.test.ts`, run with `npm test` (`node --import tsx --test`). Follow the pure-function style of `src/state/fleet.test.ts`.
- Airgapped: onboarding is **BLE + local storage only**. No network to Tesla, ever.
- **v1 scope — one live real car.** `useCarLink` keeps its single-gateway, `selectedVin`-driven design. `EnrolledCars`/the fleet store stay list-shaped (robust to a car paired out-of-band), but only the selected VIN is live; runtime switching of the live link between two real cars is out of scope.
- Commit after every passing task. TDD: failing test → minimal code → green → commit.

## Review Focus

Inputs the spec implies but a naive task might not exercise — each is pinned to a test in the owning task:

- **Corrupt/partial `fleet.v1` JSON** on load must not throw; treat as "no persisted fleet" (→ Task 3).
- **Enrolled car whose VIN is not in the persisted list** (paired out-of-band via `carlink.tsx`/deep link) must still appear (→ Task 4).
- **Persisted `activeId` points at a car removed/unenrolled since last launch** → active falls back to the first vehicle, no crash (→ Task 4).
- **Upgrade path:** an existing enrolled install has `EnrolledCars` but no `fleet.v1` → the real car materializes; the user is **not** dumped into onboarding (→ Task 4).
- **Pair verify never succeeds** (user never taps the card / wrong car) → 60s timeout, retry offered, nothing half-created in the fleet (→ Task 7 reducer; Task 10 wiring).

---

### Task 1: `vinToModelLine` — the only VIN-derivable field

**Files:**
- Create: `src/ble/vinDecode.ts`
- Test: `src/ble/vinDecode.test.ts`

**Interfaces:**
- Consumes: `BaseModel` from `src/state/carConfigurator.ts` (`'modelS' | 'model3' | 'modelX' | 'modelY'`).
- Produces: `vinToModelLine(vin: string): BaseModel | null`.

- [ ] **Step 1: Write the failing test**

```ts
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { vinToModelLine } from './vinDecode';

test('vinToModelLine maps the Tesla line char (position 4)', () => {
  assert.equal(vinToModelLine('5YJSA1E26MF000000'), 'modelS'); // 4th char S
  assert.equal(vinToModelLine('5YJ3E1EA7LF000000'), 'model3'); // 4th char 3
  assert.equal(vinToModelLine('5YJXCBE22HF000000'), 'modelX'); // 4th char X
  assert.equal(vinToModelLine('7SAYGDEE9PF000000'), 'modelY'); // 4th char Y, newer WMI
});

test('vinToModelLine returns null for unknown line or malformed VIN', () => {
  assert.equal(vinToModelLine('5YJRA1E20KF000000'), null); // R (Roadster) — unsupported
  assert.equal(vinToModelLine('TOO-SHORT'), null);
  assert.equal(vinToModelLine(''), null);
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx tsx --test src/ble/vinDecode.test.ts`
Expected: FAIL (`vinToModelLine` not defined).

- [ ] **Step 3: Write minimal implementation**

```ts
import type { BaseModel } from '../state/carConfigurator';

// A real Tesla's appearance is not derivable — color, wheels, trim and seats are build options Tesla
// keeps server-side. The ONE thing the VIN gives us offline is the model line: position 4 (0-based
// index 3). Everything else the user picks (see the onboarding appearance step).
const LINE_BY_CHAR: Record<string, BaseModel> = { S: 'modelS', '3': 'model3', X: 'modelX', Y: 'modelY' };

export function vinToModelLine(vin: string): BaseModel | null {
  if (typeof vin !== 'string' || vin.length !== 17) return null;
  return LINE_BY_CHAR[vin[3].toUpperCase()] ?? null;
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx tsx --test src/ble/vinDecode.test.ts`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add src/ble/vinDecode.ts src/ble/vinDecode.test.ts
git commit -m "feat(onboarding): vinToModelLine — the only VIN-derivable appearance field"
```

---

### Task 2: Empty fleet, config-driven builders, removable-to-empty (`fleet.ts`)

**Files:**
- Modify: `src/state/fleet.ts` (`createInitialFleet`, `activeVehicle`, `addVehicle` caller guard, `removeVehicle` floor, `updateEnrolledVehicleState` by VIN; add `VehicleConfig`, `vehicleFromConfig`, `vehicleFromCarConfig`, `addVehicleWithVin`)
- Modify (migrate): `src/state/fleet.test.ts` — it currently relies on the hardcoded `veh_1`/"Red Velvet" seed at ~15 sites; rewrite it against the empty seed.

**Interfaces:**
- Consumes: `initialVehicleState`, `CarModel` (`src/types/vehicleTypes.ts`); `CarConfig` (`src/ble/types.ts`); `vinToModelLine` (Task 1); `MODEL_BASE_NAME`, `defaultStateForModel`, `activeIndex` (already in `fleet.ts`).
- Produces:
  - `interface VehicleConfig { carModel: CarModel; exteriorColor: string | null; wheelType: string | null; interiorTrim: string | null; performance: boolean | null }`
  - `createInitialFleet(): FleetState` → `{ vehicles: [], activeId: '' }`
  - `activeVehicle(fleet: FleetState): Vehicle | undefined`
  - `vehicleFromConfig(id: string, name: string, config: VehicleConfig, vin?: string): Vehicle`
  - `vehicleFromCarConfig(id: string, cfg: CarConfig): Vehicle` (default appearance; model from `vinToModelLine(cfg.vin) ?? 'modelY'`; name from `MODEL_BASE_NAME`)
  - `addVehicleWithVin(fleet, vin, model, opts): FleetState` (like `addVehicle` but binds `vin`)
  - `removeVehicle(fleet, id): FleetState` — now removes the LAST car too (empties the fleet)
  - `updateEnrolledVehicleState(fleet, update): FleetState` — targets the vehicle with a `vin` (the real car), not `vehicles[0]`

- [ ] **Step 1: Write the failing tests** (append these to `src/state/fleet.test.ts`)

```ts
import {
  createInitialFleet, activeVehicle, vehicleFromConfig, vehicleFromCarConfig, addVehicleWithVin,
  removeVehicle, updateEnrolledVehicleState,
} from './fleet';

test('createInitialFleet is empty — no hardcoded car', () => {
  const f = createInitialFleet();
  assert.deepEqual(f.vehicles, []);
  assert.equal(f.activeId, '');
  assert.equal(activeVehicle(f), undefined);
});

test('vehicleFromConfig builds state from the stored appearance', () => {
  const v = vehicleFromConfig('veh_1', 'Mine', {
    carModel: 'modelX', exteriorColor: 'DeepBlue', wheelType: 'Turbine', interiorTrim: 'White', performance: true,
  }, '5YJXCBE22HF000000');
  assert.equal(v.vin, '5YJXCBE22HF000000');
  assert.equal(v.state.carModel, 'modelX');
  assert.equal(v.state.exteriorColor, 'DeepBlue');
  assert.equal(v.state.performance, true);
});

test('vehicleFromCarConfig materializes an enrolled car with default appearance + VIN-derived model', () => {
  const v = vehicleFromCarConfig('veh_2', { vin: '5YJ3E1EA7LF000000' });
  assert.equal(v.vin, '5YJ3E1EA7LF000000');
  assert.equal(v.state.carModel, 'model3'); // from vinToModelLine
  assert.equal(v.state.exteriorColor, null);
  assert.equal(v.name, 'Model 3');
});

test('addVehicleWithVin appends a real car and makes it active', () => {
  const f = addVehicleWithVin(createInitialFleet(), '5YJYGDEE9PF000000', 'modelY', { name: 'Y' });
  assert.equal(f.vehicles.length, 1);
  assert.equal(f.vehicles[0].vin, '5YJYGDEE9PF000000');
  assert.equal(f.activeId, f.vehicles[0].id);
});

test('removeVehicle can empty the fleet (last car → onboarding)', () => {
  const f = addVehicle(createInitialFleet(), 'model3'); // veh_1, active
  const empty = removeVehicle(f, f.activeId);
  assert.deepEqual(empty.vehicles, []);
  assert.equal(empty.activeId, '');
});

test('updateEnrolledVehicleState targets the vin-bound car, not index 0', () => {
  let f = addVehicle(createInitialFleet(), 'model3');                 // veh_1 demo, active
  f = addVehicleWithVin(f, '5YJYGDEE9PF000000', 'modelY', {});        // veh_2 real, active
  const out = updateEnrolledVehicleState(f, (s) => ({ ...s, locked: true }));
  assert.equal(out.vehicles[0].state.locked, false); // demo untouched
  assert.equal(out.vehicles[1].state.locked, true);  // real car updated
});
```

- [ ] **Step 2: Run to verify it fails**

Run: `npx tsx --test src/state/fleet.test.ts`
Expected: FAIL (new exports undefined; `createInitialFleet` still returns Red Velvet; old seed-dependent tests now also fail — fixed in Step 4).

- [ ] **Step 3: Implement** in `src/state/fleet.ts`

```ts
export interface VehicleConfig {
  carModel: CarModel;
  exteriorColor: string | null;
  wheelType: string | null;
  interiorTrim: string | null;
  performance: boolean | null;
}

export function createInitialFleet(): FleetState {
  return { vehicles: [], activeId: '' };
}

export function activeVehicle(fleet: FleetState): Vehicle | undefined {
  return fleet.vehicles[activeIndex(fleet)];
}

export function vehicleFromConfig(id: string, name: string, config: VehicleConfig, vin?: string): Vehicle {
  return {
    id,
    name,
    ...(vin ? { vin } : {}),
    state: {
      ...initialVehicleState,
      carModel: config.carModel,
      exteriorColor: config.exteriorColor,
      wheelType: config.wheelType,
      interiorTrim: config.interiorTrim,
      performance: config.performance,
    },
  };
}

export function vehicleFromCarConfig(id: string, cfg: CarConfig): Vehicle {
  const model = (vinToModelLine(cfg.vin) ?? 'modelY') as CarModel; // base line is a valid CarModel
  return vehicleFromConfig(
    id,
    cfg.nickname?.trim() || MODEL_BASE_NAME[model],
    { carModel: model, exteriorColor: null, wheelType: null, interiorTrim: null, performance: null },
    cfg.vin,
  );
}

export function addVehicleWithVin(
  fleet: FleetState, vin: string, model: CarModel, opts?: Parameters<typeof addVehicle>[2],
): FleetState {
  const added = addVehicle(fleet, model, opts);        // reuses naming/id/dedup
  const id = added.activeId;
  return { ...added, vehicles: added.vehicles.map((v) => (v.id === id ? { ...v, vin } : v)) };
}
```

Fix the `activeVehicle(...).state` caller inside `addVehicle` (line ~129):

```ts
const inheritFrom = activeVehicle(fleet)?.state ?? initialVehicleState;
```

Replace `removeVehicle` (remove the `length <= 1` floor so the last car can go):

```ts
export function removeVehicle(fleet: FleetState, id: string): FleetState {
  const index = fleet.vehicles.findIndex((v) => v.id === id);
  if (index === -1) return fleet;
  const vehicles = fleet.vehicles.filter((v) => v.id !== id);
  const activeId =
    id === fleet.activeId ? ((vehicles[index - 1] ?? vehicles[index] ?? vehicles[0])?.id ?? '') : fleet.activeId;
  return { vehicles, activeId };
}
```

Replace `updateEnrolledVehicleState` (target the vin-bound car, not index 0):

```ts
export function updateEnrolledVehicleState(
  fleet: FleetState, update: (state: VehicleViewState) => VehicleViewState,
): FleetState {
  const i = fleet.vehicles.findIndex((v) => v.vin); // the (single, v1) real car
  if (i === -1) return fleet;
  const vehicles = fleet.vehicles.slice();
  vehicles[i] = { ...vehicles[i], state: update(vehicles[i].state) };
  return { ...fleet, vehicles };
}
```

Add imports at top of `fleet.ts`: `import { vinToModelLine } from '../ble/vinDecode';` and `import type { CarConfig } from '../ble/types';`.

- [ ] **Step 4: Migrate the existing seed-dependent tests in `src/state/fleet.test.ts`**

The old seed gave every test a free `veh_1` (Model Y "Red Velvet"). Add a helper that reproduces exactly that first car, and use it wherever a test assumed a pre-existing car:

```ts
// one starting car == the shape the old createInitialFleet() seeded, now explicit
const oneCar = () => addVehicle(createInitialFleet(), 'modelY', { name: 'Red Velvet' }); // → veh_1, active
```

Then, concretely:
- The old test `initial fleet is a single Model Y named Red Velvet, active` (≈line 44) → delete it; the new `createInitialFleet is empty` test (Step 1) replaces it.
- The old `removeVehicle is a no-op when only one car remains` (≈line 127) → delete it; the new `removeVehicle can empty the fleet` test (Step 1) replaces it.
- In every remaining test that calls `createInitialFleet()` AND then relies on a pre-existing `veh_1` (≈lines 54, 65, 76, 90, 98–103, 111, 119, 133–139, 143–145, 150, 159–162, 362–365, 370, 379), replace the bare `createInitialFleet()` with `oneCar()`. IDs are unchanged (`oneCar()` yields `veh_1`; the next `addVehicle` yields `veh_2`), so the existing `veh_1`/`veh_2` assertions keep holding.
- The `uniqueName` test asserting `['Red Velvet', 'Model 3', 'Model 3 (2)']` (≈line 103): build from `oneCar()` then add two `model3`s — the expectation is unchanged.
- The `bindVehicleVin` tests (≈lines 388–393): replace `createInitialFleet()` with `oneCar()`; `createInitialFleet().vehicles[0].vin` (≈393) → `oneCar().vehicles[0].vin` is `undefined` (demo car has no vin). `bindVehicleVin` itself is unchanged by this task.
- `src/ble/bondWedge.test.ts` references "Red Velvet" only in **comments** (≈lines 71, 83) — leave it.

- [ ] **Step 5: Run to verify green**

Run: `npx tsx --test src/state/fleet.test.ts`
Expected: PASS (all migrated + new tests).

- [ ] **Step 6: Commit**

```bash
git add src/state/fleet.ts src/state/fleet.test.ts
git commit -m "feat(onboarding): empty fleet, config builders, removable-to-empty; migrate fleet tests"
```

---

### Task 3: `fleetStore` — persist presentation (AsyncStorage)

**Files:**
- Create: `src/state/fleetStore.ts`
- Test: `src/state/fleetStore.test.ts`

**Interfaces:**
- Consumes: `AppStorage` (`src/state/persistence.ts`); `FleetState`, `Vehicle`, `VehicleConfig` (Task 2).
- Produces:
  - `interface PersistedVehicle { id: string; name: string; vin?: string; config: VehicleConfig }`
  - `interface PersistedFleet { version: 1; order: PersistedVehicle[]; activeId: string | null }`
  - `toPersisted(fleet: FleetState): PersistedFleet`
  - `loadPersistedFleet(storage: AppStorage): Promise<PersistedFleet | null>`
  - `savePersistedFleet(storage: AppStorage, f: PersistedFleet): Promise<void>`
  - `const FLEET_STORAGE_KEY = 'fleet.v1'`

- [ ] **Step 1: Write the failing test** (uses an in-memory `AppStorage`)

```ts
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createMemoryBackend } from './persistence';
import { toPersisted, loadPersistedFleet, savePersistedFleet } from './fleetStore';
import { vehicleFromConfig } from './fleet';

const cfg = { carModel: 'modelY' as const, exteriorColor: 'Pearl', wheelType: 'Gemini', interiorTrim: 'Black', performance: false };

test('toPersisted captures id/name/vin/appearance and active', () => {
  const fleet = { vehicles: [vehicleFromConfig('veh_1', 'Mine', cfg, '5YJYGDEE9PF000000')], activeId: 'veh_1' };
  const p = toPersisted(fleet);
  assert.equal(p.version, 1);
  assert.equal(p.activeId, 'veh_1');
  assert.deepEqual(p.order[0], { id: 'veh_1', name: 'Mine', vin: '5YJYGDEE9PF000000', config: cfg });
});

test('save then load round-trips', async () => {
  const s = createMemoryBackend();
  const fleet = { vehicles: [vehicleFromConfig('veh_1', 'Mine', cfg)], activeId: 'veh_1' };
  await savePersistedFleet(s, toPersisted(fleet));
  assert.deepEqual(await loadPersistedFleet(s), toPersisted(fleet));
});

test('missing or corrupt payload loads as null, never throws', async () => {
  const s = createMemoryBackend();
  assert.equal(await loadPersistedFleet(s), null);           // nothing stored
  await s.setItem('fleet.v1', '{ not json');
  assert.equal(await loadPersistedFleet(s), null);           // corrupt
  await s.setItem('fleet.v1', JSON.stringify({ version: 2 })); // unknown version
  assert.equal(await loadPersistedFleet(s), null);
});
```

- [ ] **Step 2: Run to verify it fails**

Run: `npx tsx --test src/state/fleetStore.test.ts`
Expected: FAIL (module missing).

- [ ] **Step 3: Implement**

```ts
import type { AppStorage } from './persistence';
import type { FleetState, VehicleConfig } from './fleet';

export const FLEET_STORAGE_KEY = 'fleet.v1';

export interface PersistedVehicle {
  id: string;
  name: string;
  vin?: string;
  config: VehicleConfig;
}
export interface PersistedFleet {
  version: 1;
  order: PersistedVehicle[];
  activeId: string | null;
}

export function toPersisted(fleet: FleetState): PersistedFleet {
  return {
    version: 1,
    activeId: fleet.activeId || null,
    order: fleet.vehicles.map((v) => ({
      id: v.id,
      name: v.name,
      ...(v.vin ? { vin: v.vin } : {}),
      config: {
        carModel: v.state.carModel,
        exteriorColor: v.state.exteriorColor,
        wheelType: v.state.wheelType,
        interiorTrim: v.state.interiorTrim,
        performance: v.state.performance,
      },
    })),
  };
}

export async function loadPersistedFleet(storage: AppStorage): Promise<PersistedFleet | null> {
  try {
    const raw = await storage.getItem(FLEET_STORAGE_KEY);
    if (!raw) return null;
    const parsed = JSON.parse(raw) as Partial<PersistedFleet>;
    if (parsed.version !== 1 || !Array.isArray(parsed.order)) return null;
    return { version: 1, order: parsed.order, activeId: parsed.activeId ?? null };
  } catch {
    return null; // corrupt payload — treat as no persisted fleet
  }
}

export async function savePersistedFleet(storage: AppStorage, f: PersistedFleet): Promise<void> {
  await storage.setItem(FLEET_STORAGE_KEY, JSON.stringify(f));
}
```

- [ ] **Step 4: Run to verify green**

Run: `npx tsx --test src/state/fleetStore.test.ts`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add src/state/fleetStore.ts src/state/fleetStore.test.ts
git commit -m "feat(onboarding): fleetStore — persist fleet presentation to AsyncStorage"
```

---

### Task 4: `reconcileFleet` — the one boot seam

**Files:**
- Create: `src/state/reconcileFleet.ts`
- Test: `src/state/reconcileFleet.test.ts`

**Interfaces:**
- Consumes: `PersistedFleet` (Task 3); `EnrolledCars`, `CarConfig` (`src/ble/types.ts`); `FleetState`, `vehicleFromConfig`, `vehicleFromCarConfig` (Task 2).
- Produces: `reconcileFleet(persisted: PersistedFleet | null, enrolled: EnrolledCars): FleetState`.

Rules (from spec §2): keep persisted order; drop a `vin` row whose VIN is no longer enrolled; append any enrolled car not already listed (materialized, default appearance); `activeId` = persisted if it survived else first vehicle else `''`.

- [ ] **Step 1: Write the failing tests**

```ts
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { reconcileFleet } from './reconcileFleet';

const cfg = { carModel: 'modelY' as const, exteriorColor: null, wheelType: null, interiorTrim: null, performance: null };
const demo = (id: string, name: string) => ({ id, name, config: cfg });
const real = (id: string, name: string, vin: string) => ({ id, name, vin, config: cfg });

test('empty persisted + no enrolled → empty fleet', () => {
  const f = reconcileFleet(null, { cars: [], selectedVin: null });
  assert.deepEqual(f, { vehicles: [], activeId: '' });
});

test('demo-only persisted survives with order and active', () => {
  const f = reconcileFleet(
    { version: 1, order: [demo('veh_1', 'A'), demo('veh_2', 'B')], activeId: 'veh_2' },
    { cars: [], selectedVin: null });
  assert.deepEqual(f.vehicles.map((v) => v.id), ['veh_1', 'veh_2']);
  assert.equal(f.activeId, 'veh_2');
  assert.equal(f.vehicles[0].vin, undefined);
});

test('listed real car whose VIN is no longer enrolled is dropped', () => {
  const f = reconcileFleet(
    { version: 1, order: [real('veh_1', 'Gone', 'VIN_GONE_00000000'), demo('veh_2', 'Demo')], activeId: 'veh_1' },
    { cars: [], selectedVin: null });
  assert.deepEqual(f.vehicles.map((v) => v.id), ['veh_2']); // real dropped
  assert.equal(f.activeId, 'veh_2');                         // active fell back
});

test('enrolled car not in the list is appended (out-of-band pair / upgrade)', () => {
  const f = reconcileFleet(null, { cars: [{ vin: '5YJ3E1EA7LF000000' }], selectedVin: '5YJ3E1EA7LF000000' });
  assert.equal(f.vehicles.length, 1);
  assert.equal(f.vehicles[0].vin, '5YJ3E1EA7LF000000');
  assert.equal(f.vehicles[0].state.carModel, 'model3');
  assert.equal(f.activeId, f.vehicles[0].id);
});

test('a listed real car is bound by VIN and kept in place', () => {
  const f = reconcileFleet(
    { version: 1, order: [demo('veh_1', 'Demo'), real('veh_2', 'Mine', '5YJYGDEE9PF000000')], activeId: 'veh_2' },
    { cars: [{ vin: '5YJYGDEE9PF000000' }], selectedVin: '5YJYGDEE9PF000000' });
  assert.deepEqual(f.vehicles.map((v) => v.id), ['veh_1', 'veh_2']);
  assert.equal(f.vehicles[1].vin, '5YJYGDEE9PF000000');
});
```

- [ ] **Step 2: Run to verify it fails**

Run: `npx tsx --test src/state/reconcileFleet.test.ts`
Expected: FAIL.

- [ ] **Step 3: Implement**

```ts
import type { EnrolledCars } from '../ble/types';
import type { FleetState, Vehicle } from './fleet';
import { vehicleFromConfig, vehicleFromCarConfig } from './fleet';
import type { PersistedFleet } from './fleetStore';

export function reconcileFleet(persisted: PersistedFleet | null, enrolled: EnrolledCars): FleetState {
  const enrolledByVin = new Map(enrolled.cars.map((c) => [c.vin, c]));
  const listed = persisted?.order ?? [];
  const vehicles: Vehicle[] = [];
  const seenVins = new Set<string>();

  for (const row of listed) {
    if (row.vin) {
      if (!enrolledByVin.has(row.vin)) continue; // car forgotten since last launch — drop it
      seenVins.add(row.vin);
    }
    vehicles.push(vehicleFromConfig(row.id, row.name, row.config, row.vin));
  }

  // Append any enrolled car the persisted list did not carry (paired out-of-band, or first boot
  // after upgrade where fleet.v1 does not exist yet).
  let n = vehicles.reduce((max, v) => Math.max(max, Number(v.id.replace(/^veh_/, '')) || 0), 0);
  for (const cfg of enrolled.cars) {
    if (seenVins.has(cfg.vin)) continue;
    vehicles.push(vehicleFromCarConfig(`veh_${++n}`, cfg));
  }

  const activeId =
    persisted?.activeId && vehicles.some((v) => v.id === persisted.activeId)
      ? persisted.activeId
      : (vehicles[0]?.id ?? '');
  return { vehicles, activeId };
}
```

- [ ] **Step 4: Run to verify green**

Run: `npx tsx --test src/state/reconcileFleet.test.ts`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add src/state/reconcileFleet.ts src/state/reconcileFleet.test.ts
git commit -m "feat(onboarding): reconcileFleet — merge persisted presentation with enrolled cars"
```

---

### Task 5: Hydrate, persist & gate in `useFleetState`

**Files:**
- Modify: `src/state/useFleetState.ts`
- Test: covered by Tasks 3–4 (pure pieces) + manual (Task 12); add one guard test below.
- Test: `src/state/useFleetState.hydrate.test.ts` (pure helper only — see Step 1)

**Interfaces:**
- Consumes: `reconcileFleet` (Task 4), `toPersisted`/`loadPersistedFleet`/`savePersistedFleet` (Task 3), `addVehicleWithVin` (Task 2), `loadEnrolledCars`/`removeCar`/`selectCar` (`src/ble/config.ts`), `appStorage`, `secureStoreSecretStore as store`, `CarModel`.
- Produces on the returned object: `hydrated: boolean`; `Fleet` gains `hydrated: boolean` and `addRealCar(vin: string, model: CarModel, opts?): void`. `removeVehicle` now also forgets a real car via `removeCar`.

Pull the empty-fleet guard out as a tiny pure helper so it is unit-testable without rendering:

- [ ] **Step 1: Write the failing test**

```ts
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { currentOrEmpty, EMPTY_VEHICLE } from './useFleetState';

test('currentOrEmpty returns a safe placeholder for an empty fleet', () => {
  assert.equal(currentOrEmpty({ vehicles: [], activeId: '' }), EMPTY_VEHICLE);
  assert.equal(EMPTY_VEHICLE.state.carModel, 'modelY'); // initialVehicleState default
});
```

- [ ] **Step 2: Run to verify it fails**

Run: `npx tsx --test src/state/useFleetState.hydrate.test.ts`
Expected: FAIL (`currentOrEmpty`/`EMPTY_VEHICLE` not exported).

- [ ] **Step 3: Implement the hook changes**

Add near the top of `useFleetState.ts`:

```ts
import { reconcileFleet } from './reconcileFleet';
import { loadPersistedFleet, savePersistedFleet, toPersisted } from './fleetStore';
import { addVehicleWithVin } from './fleet';
import { loadEnrolledCars, removeCar, selectCar } from '../ble/config';
import { secureStoreSecretStore as store } from '../ble/secureStoreSecretStore';
import { appStorage } from './appStorage';

export const EMPTY_VEHICLE: Vehicle = { id: '', name: '', state: initialVehicleState };
export function currentOrEmpty(fleet: FleetState): Vehicle {
  return activeVehicle(fleet) ?? EMPTY_VEHICLE;
}
```

Change the seed + add hydration/persist. Replace `const [fleet, setFleet] = useState<FleetState>(createInitialFleet);` with:

```ts
const [fleet, setFleet] = useState<FleetState>(createInitialFleet); // empty now
const [hydrated, setHydrated] = useState(false);

// Boot reconcile: presentation (AsyncStorage) + enrolled cars (Keychain) → FleetState.
useEffect(() => {
  let cancelled = false;
  (async () => {
    const [persisted, enrolled] = await Promise.all([loadPersistedFleet(appStorage), loadEnrolledCars(store)]);
    if (cancelled) return;
    setFleet(reconcileFleet(persisted, enrolled));
    setHydrated(true);
  })();
  return () => { cancelled = true; };
}, []);

// Persist presentation after hydration, on every fleet change.
useEffect(() => {
  if (!hydrated) return;
  void savePersistedFleet(appStorage, toPersisted(fleet));
}, [hydrated, fleet]);
```

Replace line 181 `const current = activeVehicle(fleet);` with `const current = currentOrEmpty(fleet);`.

Delete the vehicles[0] VIN staple effect (lines ~189–194) — reconcile + `addRealCar` bind VINs now, and `hydrateTelemetry` already routes through `updateEnrolledVehicleState` (made vin-targeted in Task 2). (Keep `bindVehicleVin` import only if still used; otherwise drop it.)

Extend the `actions`/`fleetApi` memo (around line 450):

```ts
hydrated,
addRealCar: (vin: string, model: CarModel, opts) => {
  void selectCar(store, vin);                        // make it the live/selected car
  setFleet((f) => addVehicleWithVin(f, vin, model, opts));
},
removeVehicle: (id) => {
  setFleet((f) => {
    const v = f.vehicles.find((x) => x.id === id);
    if (v?.vin) void removeCar(store, v.vin);         // forget the real car's keys too
    return removeVehicle(f, id);
  });
},
setActiveVehicle: (id) => setFleet((f) => {
  const v = f.vehicles.find((x) => x.id === id);
  if (v?.vin) void selectCar(store, v.vin);           // keep selectedVin on the active real car
  return setActiveVehicle(f, id);
}),
```

Add `hydrated: boolean;` and `addRealCar: (vin: string, model: CarModel, opts?: Parameters<Fleet['addVehicle']>[1]) => void;` to the `Fleet` interface (lines 34–74), and include `hydrated` in the memo deps. (`removeVehicle`'s empty-the-fleet behavior and the vin-targeted `updateEnrolledVehicleState` are done in Task 2.)

- [ ] **Step 4: Run to verify green + typecheck**

Run: `npx tsx --test src/state/useFleetState.hydrate.test.ts && npx tsc --noEmit`
Expected: PASS, tsc exit 0. (Fix any `removeVehicle`/`activeVehicle` call sites the type change surfaces — e.g. `CarsSheet` consumes `Fleet`; it already handles both.)

- [ ] **Step 5: Commit**

```bash
git add src/state/useFleetState.ts src/state/useFleetState.hydrate.test.ts
git commit -m "feat(onboarding): hydrate+persist the fleet, bind VIN by match, wire add/remove/select"
```

---

### Task 6: `useCarLink.reload()` — pick up a freshly paired car without restart

**Files:**
- Modify: `src/state/useCarLink.ts`

**Interfaces:**
- Produces: `reload: () => void` on the hook's return and on `CarLinkStatus` (so onboarding can call it after pairing). Re-runs the mount load (refreshes `cfgRef`/`carCfgRef`/`keysRef`, `setLinked`/`setVin`, cache rehydrate) and resets `gatewayRef`/`selectorRef` so the next dispatch builds a gateway for the new VIN.

- [ ] **Step 1: Implement** (no unit test — integration-only; verified in Task 12)

Add a reload nonce and fold it into the existing load effect deps:

```ts
const [reloadNonce, setReloadNonce] = useState(0);
const reload = useCallback(() => {
  gatewayRef.current = null;          // force a rebuild for the new VIN
  selectorRef.current?.closeSession('').catch(() => {});
  selectorRef.current = null;
  setReloadNonce((n) => n + 1);
}, []);
```

Change the load effect's dependency array from `[enabled]` to `[enabled, reloadNonce]`.

Add `reload` to the hook's returned object and to the `CarLinkStatus` interface + `carLinkStatus` memo in `useFleetState.ts` (so `useCarLinkStatus().reload` is callable from onboarding).

- [ ] **Step 2: Typecheck**

Run: `npx tsc --noEmit`
Expected: exit 0.

- [ ] **Step 3: Commit**

```bash
git add src/state/useCarLink.ts src/state/useFleetState.ts
git commit -m "feat(onboarding): useCarLink.reload() so a freshly paired car goes live immediately"
```

---

### Task 7: Pair wizard state machine (pure reducer)

**Files:**
- Create: `src/state/pairingReducer.ts`
- Test: `src/state/pairingReducer.test.ts`

**Interfaces:**
- Produces:
  - `type PairStep = 'vin' | 'connecting' | 'presentKey' | 'verifying' | 'paired' | 'error'`
  - `interface PairState { step: PairStep; vin: string; error: string | null }`
  - `type PairEvent = { t: 'submitVin'; vin: string } | { t: 'connected' } | { t: 'connectFailed'; error: string } | { t: 'keySent' } | { t: 'verified' } | { t: 'verifyTimeout' } | { t: 'retry' } | { t: 'cancel' }`
  - `const initialPairState: PairState`
  - `pairReducer(s: PairState, e: PairEvent): PairState`
  - `isValidVin` is reused from `@/ble` (do not reimplement).

- [ ] **Step 1: Write the failing tests**

```ts
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { pairReducer, initialPairState } from './pairingReducer';

test('happy path: vin → connecting → presentKey → verifying → paired', () => {
  let s = initialPairState;
  s = pairReducer(s, { t: 'submitVin', vin: '5YJYGDEE9PF000000' });
  assert.equal(s.step, 'connecting');
  assert.equal(s.vin, '5YJYGDEE9PF000000');
  s = pairReducer(s, { t: 'connected' });
  assert.equal(s.step, 'presentKey');
  s = pairReducer(s, { t: 'keySent' });
  assert.equal(s.step, 'verifying');
  s = pairReducer(s, { t: 'verified' });
  assert.equal(s.step, 'paired');
});

test('submitVin rejects an invalid VIN (stays on vin, sets error)', () => {
  const s = pairReducer(initialPairState, { t: 'submitVin', vin: 'nope' });
  assert.equal(s.step, 'vin');
  assert.ok(s.error);
});

test('connect failure and verify timeout surface an error, retry resumes', () => {
  let s = pairReducer({ step: 'connecting', vin: '5YJYGDEE9PF000000', error: null }, { t: 'connectFailed', error: 'not found' });
  assert.equal(s.step, 'error');
  assert.equal(s.error, 'not found');
  s = pairReducer(s, { t: 'retry' });               // retry goes back to connecting with the same VIN
  assert.equal(s.step, 'connecting');
  assert.equal(s.vin, '5YJYGDEE9PF000000');

  const t = pairReducer({ step: 'verifying', vin: '5YJYGDEE9PF000000', error: null }, { t: 'verifyTimeout' });
  assert.equal(t.step, 'error');
});

test('cancel resets to the initial VIN step', () => {
  assert.deepEqual(pairReducer({ step: 'verifying', vin: 'x', error: null }, { t: 'cancel' }), initialPairState);
});
```

- [ ] **Step 2: Run to verify it fails**

Run: `npx tsx --test src/state/pairingReducer.test.ts`
Expected: FAIL.

- [ ] **Step 3: Implement**

```ts
import { isValidVin } from '../ble';

export type PairStep = 'vin' | 'connecting' | 'presentKey' | 'verifying' | 'paired' | 'error';
export interface PairState { step: PairStep; vin: string; error: string | null }
export type PairEvent =
  | { t: 'submitVin'; vin: string }
  | { t: 'connected' } | { t: 'connectFailed'; error: string }
  | { t: 'keySent' } | { t: 'verified' } | { t: 'verifyTimeout' }
  | { t: 'retry' } | { t: 'cancel' };

export const initialPairState: PairState = { step: 'vin', vin: '', error: null };

export function pairReducer(s: PairState, e: PairEvent): PairState {
  switch (e.t) {
    case 'submitVin':
      return isValidVin(e.vin)
        ? { step: 'connecting', vin: e.vin, error: null }
        : { ...s, step: 'vin', error: `"${e.vin}" is not a valid 17-character VIN` };
    case 'connected': return { ...s, step: 'presentKey', error: null };
    case 'connectFailed': return { ...s, step: 'error', error: e.error };
    case 'keySent': return { ...s, step: 'verifying', error: null };
    case 'verified': return { ...s, step: 'paired', error: null };
    case 'verifyTimeout': return { ...s, step: 'error', error: 'Pairing timed out — did you tap your key card on the console?' };
    case 'retry': return { ...s, step: 'connecting', error: null };
    case 'cancel': return initialPairState;
    default: return s;
  }
}
```

- [ ] **Step 4: Run to verify green**

Run: `npx tsx --test src/state/pairingReducer.test.ts`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add src/state/pairingReducer.ts src/state/pairingReducer.test.ts
git commit -m "feat(onboarding): pure pair-wizard state machine"
```

---

### Task 8: `src/ble/pairing.ts` — BLE enroll + verify glue

**Files:**
- Create: `src/ble/pairing.ts`

**Interfaces:**
- Consumes: the BLE transport construction used by `carlink.tsx` (`getBleTransport`/`createSelectingTransport` + `openSession(vin)` + `sendAddKey(pubkeyB64)`), `loadOrCreateDeviceKeys`, `publicKeyBase64`, `openDirectSession`/the gateway's authenticated read, `SecretStore`.
- Produces:
  - `enrollDeviceKeyOverBle(opts: { vin: string; store: SecretStore }): Promise<void>` — build the BLE transport for `vin`, `openSession(vin)`, `sendAddKey(publicKeyBase64(await loadOrCreateDeviceKeys(store)))`.
  - `verifyPaired(opts: { vin: string; store: SecretStore }): Promise<boolean>` — attempt ONE authenticated BLE session/read (ECDH handshake on `DOMAIN_VEHICLE_SECURITY`); resolve `true` on success, `false` on the car refusing our (not-yet-whitelisted) key. Over pure BLE this authenticated handshake is the only "paired" signal — the `pairInfo` poll in `carlink.tsx` is Pi-only.

This task is integration glue over existing BLE primitives (mirror the bodies of `handleEnrolOverBle` and the "Read/Lock to verify" path in `src/app/carlink.tsx`). No node unit test (BLE can't run under node); correctness is proven on-device in Task 12. Keep the file thin — all branching/UI logic lives in the Task 7 reducer and Task 10 screen.

- [ ] **Step 1: Implement** `enrollDeviceKeyOverBle` and `verifyPaired` by lifting the proven calls from `carlink.tsx` (`getBleTransport().openSession(vin)`, `.sendAddKey(...)`, and an authenticated read via `openDirectSession`/gateway). Export both.

- [ ] **Step 2: Typecheck**

Run: `npx tsc --noEmit`
Expected: exit 0.

- [ ] **Step 3: Commit**

```bash
git add src/ble/pairing.ts
git commit -m "feat(onboarding): BLE enroll + authenticated-read verify helpers"
```

---

### Task 9: Extract `CarConfigurator` from `CarsSheet` (lockable model)

**Files:**
- Create: `src/components/CarConfigurator.tsx` (move the `AddCar` form out of `CarsSheet.tsx`)
- Modify: `src/components/CarsSheet.tsx` (import and render `CarConfigurator`)

**Interfaces:**
- Consumes: everything `AddCar` already uses from `@/state/carConfigurator` + `vinToModelLine` (Task 1).
- Produces:
  ```ts
  export function CarConfigurator(props: {
    contentMaxHeight: number;
    lockedBase?: BaseModel;          // when set, the Model segmented is fixed + shows a "from your VIN" hint
    initialBase?: BaseModel;         // starting line when not locked (default 'modelY')
    submitLabel?: string;            // 'Add' (demo) | 'Finish' (pair); default 'Add'
    onBack: () => void;
    onSubmit: (model: CarModel, opts: { name: string; exteriorColor: string; wheelType: string; interiorTrim: string; performance: boolean }) => void;
  }): JSX.Element
  ```

- [ ] **Step 1:** Move the `AddCar` component body verbatim into `CarConfigurator.tsx`, renaming to `CarConfigurator` and the `onCreate` prop to `onSubmit`. Initialize `base` from `lockedBase ?? initialBase ?? 'modelY'`. When `lockedBase` is set, render the Model `Segmented` disabled (no `onChange`) with a small caption "Detected from your VIN"; keep `pickModel` usable only when unlocked.

- [ ] **Step 2:** In `CarsSheet.tsx`, replace the inlined `AddCar` with `<CarConfigurator contentMaxHeight={...} onBack={...} onSubmit={(model, opts) => onCreate(model, opts)} />`. Keep the existing `onCreate → onAddVehicle` wiring unchanged.

- [ ] **Step 3: Verify render + typecheck**

Run: `npx tsc --noEmit`
Expected: exit 0. Manually confirm the Cars sheet "Add Car" flow is visually unchanged (device check folds into Task 12).

- [ ] **Step 4: Commit**

```bash
git add src/components/CarConfigurator.tsx src/components/CarsSheet.tsx
git commit -m "refactor(onboarding): extract CarConfigurator with a lockable model line"
```

---

### Task 10: Onboarding route — welcome + pair wizard + appearance

**Files:**
- Create: `src/app/onboarding.tsx`
- Modify: `src/app/_layout.tsx` (register `<Stack.Screen name="onboarding" />`)

**Interfaces:**
- Consumes: `useFleet()` (for `addVehicle`, `addRealCar`), `useCarLinkStatus()` (for `reload`), `pairReducer`/`initialPairState` (Task 7), `enrollDeviceKeyOverBle`/`verifyPaired` (Task 8), `CarConfigurator` (Task 9), `vinToModelLine` (Task 1), `secureStoreSecretStore as store`, `addCar`/`selectCar` (`@/ble/config`), `useRouter` (expo-router).
- Produces: the default-exported `Onboarding` screen.

Structure (expo-router screen; dark root `#161618`; `EdgeSwipeBack`/back is disabled because onboarding is the root when empty):

- **Welcome** — title + two buttons: **"Pair your Tesla"** → pair wizard; **"Add a demo car"** → `CarConfigurator` with nothing locked → on submit `fleet.addVehicle(model, opts)` → `router.replace('/')`.
- **Pair wizard** — driven by `useReducer(pairReducer, initialPairState)`:
  - `vin`: `TextInput` + hint; **Continue** dispatches `{ t: 'submitVin', vin }`.
  - entering `connecting`: `useEffect` on `step === 'connecting'` runs `enrollDeviceKeyOverBle({ vin, store })`; on resolve dispatch `{ t: 'connected' }` then immediately `{ t: 'keySent' }` (enroll performs connect+send); on reject `{ t: 'connectFailed', error }`.
  - `presentKey`/`verifying`: show **"Tap your key card on the center console"**; an effect polls `verifyPaired({ vin, store })` every 3s until `true` (dispatch `verified`) or a 60s deadline (dispatch `verifyTimeout`).
  - `paired`: persist + build the car, then go home:
    ```ts
    const model = (vinToModelLine(s.vin) ?? 'modelY') as CarModel;
    // appearance step:
    <CarConfigurator lockedBase={vinToModelLine(s.vin) ?? undefined} submitLabel="Finish"
      onSubmit={async (m, opts) => {
        await addCar(store, { vin: s.vin });
        await selectCar(store, s.vin);
        fleet.addRealCar(s.vin, m, opts);
        carLink.reload();                 // pick up the new car without a restart (Task 6)
        router.replace('/');
      }} />
    ```
  - `error`: message + **Try again** (`retry`) / **Cancel** (`cancel` → welcome).

- [ ] **Step 1:** Build `src/app/onboarding.tsx` with the structure above (real handlers as shown; JSX/styling to match the app's dark Tesla look).

- [ ] **Step 2:** Register the route in `_layout.tsx`:

```tsx
<Stack.Screen name="onboarding" options={{ gestureEnabled: false }} />
```

- [ ] **Step 3: Typecheck**

Run: `npx tsc --noEmit`
Expected: exit 0.

- [ ] **Step 4: Commit**

```bash
git add src/app/onboarding.tsx src/app/_layout.tsx
git commit -m "feat(onboarding): welcome + BLE pair wizard + appearance screen"
```

---

### Task 11: Gate the app + empty-fleet safety

**Files:**
- Modify: `src/app/index.tsx` (splash until hydrated; redirect to `/onboarding` when empty)
- Verify: `src/godot/VehicleCanvas.tsx` / `src/screens/HomeScreen.tsx` tolerate the empty/placeholder active car.

**Interfaces:**
- Consumes: `useFleet()` (`hydrated`, `vehicles`), `Redirect` from `expo-router`.

- [ ] **Step 1:** At the top of `index.tsx`'s component, before rendering Home:

```tsx
import { Redirect } from 'expo-router';
// ...
const fleet = useFleet();
if (!fleet.hydrated) return null;                       // splash: AnimatedSplashOverlay already covers the frame
if (fleet.vehicles.length === 0) return <Redirect href="/onboarding" />;
```

- [ ] **Step 2:** Guard Godot: do not emit `SHOW_PRODUCT`/drive the renderer when the active id is empty (`useActiveVehicleId() === ''`). In `VehicleCanvas.tsx`, early-return/skip the bridge calls when there is no active vehicle. (Post-gate this never renders, but the guard prevents a crash during the pre-redirect frame.)

- [ ] **Step 3: Typecheck + launch**

Run: `npx tsc --noEmit`
Expected: exit 0.

- [ ] **Step 4: Commit**

```bash
git add src/app/index.tsx src/godot/VehicleCanvas.tsx
git commit -m "feat(onboarding): gate to onboarding when the fleet is empty; empty-fleet render safety"
```

---

### Task 12: Invariant test + full verification + device run

**Files:**
- Create: `src/state/noHardcodedCar.test.ts` (source-scan invariant, like `carLinkCacheCoverage.test.ts`)

- [ ] **Step 1: Write the invariant test**

```ts
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { createInitialFleet } from './fleet';

test('no hardcoded seed car remains', () => {
  assert.deepEqual(createInitialFleet().vehicles, []);
  const fleetSrc = readFileSync(new URL('./fleet.ts', import.meta.url), 'utf8');
  assert.ok(!/Red Velvet/.test(fleetSrc), 'fleet.ts must not hardcode a seed vehicle');
});
```

- [ ] **Step 2: Run the full suite + typecheck**

Run: `npm test && npx tsc --noEmit`
Expected: all tests PASS (1050 existing + the new suites), tsc exit 0.

- [ ] **Step 3: Deploy + manual device verification**

Run: `bash scripts/godot-ios/deploy-js.sh`

Verify on the device:
- Fresh install (delete app first, or clear `fleet.v1` + Keychain) → **onboarding**, not a car.
- "Add a demo car" → configurator → Home shows it; relaunch → still there.
- "Pair your Tesla" at the car → enter VIN → connect → **tap key card** → appearance (model locked to VIN line) → Finish → Home shows the live car; lock/unlock works without a restart (Task 6).
- Relaunch → both cars persist, same active one.
- Cars sheet → remove the real car → it is forgotten (`removeCar`) and gone; remove the last car → returns to onboarding.
- **Upgrade check:** install this build over an already-enrolled build (do NOT clear storage) → the enrolled car materializes and Home opens on it; no onboarding.

- [ ] **Step 4: Commit**

```bash
git add src/state/noHardcodedCar.test.ts
git commit -m "test(onboarding): invariant — no hardcoded seed car; full suite green"
```
