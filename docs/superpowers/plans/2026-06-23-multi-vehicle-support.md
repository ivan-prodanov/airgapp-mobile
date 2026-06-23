# Multi-Vehicle Support Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Turn the single hardcoded car into a fleet of independently-stateful vehicles (S/3/X/Y) with Home-screen swipe-to-switch and an Explore add/remove manager.

**Architecture:** A pure `fleet` reducer module owns all fleet + active-vehicle-state logic and is unit-tested. A `useFleetState` hook wraps it in React state; `VehicleProvider` exposes the active car's `[state, actions]` (unchanged contract, so existing screens keep working) plus a new `useFleet()` and `useActiveVehicleId()`. The single Godot surface renders one car; switching the active vehicle re-applies that car's full state via a new `bridge.switchVehicle()`. The Home swipe slides the live car view out, swaps the product while off-screen, and slides the (now-live, real-state) incoming car in.

**Tech Stack:** Expo SDK 56, React Native 0.85, React 19, TypeScript (strict), react-native-gesture-handler 2.31, embedded Godot 3.2 via `expo-godot-view`, `node:test` + `tsx` for pure-logic unit tests.

## Global Constraints

- **Expo is version-pinned:** before writing any RN/Expo/gesture-handler code, read the exact versioned docs at `https://docs.expo.dev/versions/v56.0.0/` (per `AGENTS.md`). The API surface differs from older Expo.
- **Single live Godot surface:** never render two cars at once; never attempt GL frame capture. The revealed car must be the live engine render so it shows real state.
- **`carModel` is fixed per vehicle** (set at creation, never mutated). No in-place model switching.
- **Initial fleet:** exactly one Model Y named `"Red Velvet"`, id `"veh_1"`, active.
- **Names auto-dedup:** `"Model 3"`, then `"Model 3 (2)"`, `"Model 3 (3)"`, …
- **Cannot remove the last car.** Removing the active car selects a neighbor (previous if it exists, else next).
- **In-memory only** — no persistence; fleet resets on relaunch.
- **Swipe with one car is a no-op.** Swipe clamps at the ends (no wrap-around).
- **Per-task verification:** run `npx tsc --noEmit` (must pass) after every task. Pure-logic task also runs unit tests. UI/Godot tasks add an on-device manual verification checklist.
- **Strict TypeScript** — no `any`, no non-null assertions on possibly-undefined values without a guard.

---

### Task 1: Add `batteryLevel` to vehicle state

Each car shows its own battery % in the Home header instead of a shared hardcoded `48%`.

**Files:**
- Modify: `src/types/vehicleTypes.ts` (the `VehicleViewState` interface and `initialVehicleState`)

**Interfaces:**
- Produces: `VehicleViewState.batteryLevel: number` (default `48` in `initialVehicleState`).

- [ ] **Step 1: Add the field to the interface**

In `src/types/vehicleTypes.ts`, inside `interface VehicleViewState`, add after `theme: ThemeMode;` (the last field, line ~59):

```ts
  // Per-car battery percentage shown in the Home header (0–100). Stubbed until BLE; each vehicle
  // carries its own so switching cars shows a different value.
  batteryLevel: number;
```

- [ ] **Step 2: Add the default**

In the same file, in `initialVehicleState`, add after `theme: 'dark',` (line ~101):

```ts
  batteryLevel: 48,
```

- [ ] **Step 3: Typecheck**

Run: `npx tsc --noEmit`
Expected: PASS (no errors). `initialVehicleState` now satisfies `VehicleViewState` with the new required field.

- [ ] **Step 4: Commit**

```bash
git add src/types/vehicleTypes.ts
git commit -m "feat(state): add per-vehicle batteryLevel field"
```

---

### Task 2: Pure fleet reducer + unit-test runner (TDD)

All fleet and active-vehicle-state logic lives in one pure, tested module. This is the core of the feature.

**Files:**
- Create: `src/state/fleet.ts`
- Create: `src/state/fleet.test.ts`
- Modify: `package.json` (add `tsx` devDependency + `test` script)

**Interfaces:**
- Consumes: `VehicleViewState`, `initialVehicleState`, `modelYProductConfig`, `CarModel`, `SeatPosition`, `SeatClimateMode`, `SteeringWheelClimateMode`, `VehicleStateKey`, `CameraMode` from `../types/vehicleTypes`.
- Produces:
  - `interface Vehicle { id: string; name: string; state: VehicleViewState }`
  - `interface FleetState { vehicles: Vehicle[]; activeId: string }`
  - `createInitialFleet(): FleetState`
  - `activeIndex(fleet: FleetState): number`
  - `activeVehicle(fleet: FleetState): Vehicle`
  - `addVehicle(fleet: FleetState, model: CarModel): FleetState` (appends + makes active)
  - `removeVehicle(fleet: FleetState, id: string): FleetState`
  - `setActiveVehicle(fleet: FleetState, id: string): FleetState`
  - `nextVehicleId(fleet: FleetState): string` / `prevVehicleId(fleet: FleetState): string` (clamped)
  - `updateActiveVehicleState(fleet: FleetState, update: (s: VehicleViewState) => VehicleViewState): FleetState`
  - State updaters: `patchState`, `toggleState`, `setCameraModeState`, `setScreenCameraModeState`, `cycleSteeringWheelClimateState`, `cycleSeatClimateState` (all `(state, ...) => VehicleViewState`)

- [ ] **Step 1: Install the test runner and add the script**

Run:

```bash
pnpm add -D tsx
```

Then in `package.json`, add to `"scripts"`:

```json
    "test": "node --import tsx --test src/state/fleet.test.ts"
```

(If `pnpm add -D tsx` fails offline, fall back to running tests with Node's native TS support: `node --test --experimental-strip-types src/state/fleet.test.ts`, and set the `test` script to that. `fleet.ts` uses only erasable TS syntax, so both work.)

- [ ] **Step 2: Write the failing tests**

Create `src/state/fleet.test.ts`:

```ts
import { test } from 'node:test';
import assert from 'node:assert/strict';

import {
  activeVehicle,
  addVehicle,
  createInitialFleet,
  nextVehicleId,
  prevVehicleId,
  removeVehicle,
  setActiveVehicle,
  toggleState,
  updateActiveVehicleState,
} from './fleet';

test('initial fleet is a single Model Y named Red Velvet, active', () => {
  const fleet = createInitialFleet();
  assert.equal(fleet.vehicles.length, 1);
  assert.equal(fleet.vehicles[0].id, 'veh_1');
  assert.equal(fleet.vehicles[0].name, 'Red Velvet');
  assert.equal(fleet.vehicles[0].state.carModel, 'modelY');
  assert.equal(fleet.activeId, 'veh_1');
});

test('addVehicle appends a fresh car of the chosen model and makes it active', () => {
  const fleet = addVehicle(createInitialFleet(), 'model3');
  assert.equal(fleet.vehicles.length, 2);
  const added = fleet.vehicles[1];
  assert.equal(added.id, 'veh_2');
  assert.equal(added.name, 'Model 3');
  assert.equal(added.state.carModel, 'model3');
  assert.equal(added.state.locked, true); // fresh default state
  assert.equal(fleet.activeId, 'veh_2');
});

test('addVehicle de-dups names for the same model', () => {
  let fleet = createInitialFleet();
  fleet = addVehicle(fleet, 'model3');
  fleet = addVehicle(fleet, 'model3');
  assert.deepEqual(
    fleet.vehicles.map((v) => v.name),
    ['Red Velvet', 'Model 3', 'Model 3 (2)'],
  );
});

test('new vehicle inherits theme and lightingMode from the active car', () => {
  let fleet = createInitialFleet();
  fleet = updateActiveVehicleState(fleet, (s) => ({ ...s, theme: 'light', lightingMode: 'ambient_fill' }));
  fleet = addVehicle(fleet, 'modelX');
  const added = activeVehicle(fleet).state;
  assert.equal(added.theme, 'light');
  assert.equal(added.lightingMode, 'ambient_fill');
});

test('removeVehicle is a no-op when only one car remains', () => {
  const fleet = createInitialFleet();
  assert.deepEqual(removeVehicle(fleet, 'veh_1'), fleet);
});

test('removing the active car selects the previous neighbor', () => {
  let fleet = createInitialFleet();
  fleet = addVehicle(fleet, 'model3'); // veh_2, active
  fleet = addVehicle(fleet, 'modelX'); // veh_3, active
  fleet = setActiveVehicle(fleet, 'veh_2');
  fleet = removeVehicle(fleet, 'veh_2');
  assert.equal(fleet.vehicles.length, 2);
  assert.equal(fleet.activeId, 'veh_1'); // previous neighbor
});

test('removing the active first car selects the next neighbor', () => {
  let fleet = addVehicle(createInitialFleet(), 'model3'); // veh_2
  fleet = setActiveVehicle(fleet, 'veh_1');
  fleet = removeVehicle(fleet, 'veh_1');
  assert.equal(fleet.activeId, 'veh_2');
});

test('next/prev vehicle id clamps at the ends', () => {
  let fleet = addVehicle(createInitialFleet(), 'model3'); // veh_1, veh_2; active veh_2
  fleet = setActiveVehicle(fleet, 'veh_1');
  assert.equal(prevVehicleId(fleet), 'veh_1'); // clamp at start
  assert.equal(nextVehicleId(fleet), 'veh_2');
  fleet = setActiveVehicle(fleet, 'veh_2');
  assert.equal(nextVehicleId(fleet), 'veh_2'); // clamp at end
});

test('updateActiveVehicleState mutates only the active car', () => {
  let fleet = addVehicle(createInitialFleet(), 'model3'); // active veh_2
  fleet = setActiveVehicle(fleet, 'veh_1');
  fleet = updateActiveVehicleState(fleet, (s) => toggleState(s, 'locked'));
  assert.equal(fleet.vehicles[0].state.locked, false); // veh_1 toggled
  assert.equal(fleet.vehicles[1].state.locked, true); // veh_2 untouched
});
```

- [ ] **Step 3: Run tests to verify they fail**

Run: `pnpm test`
Expected: FAIL — `fleet.ts` does not exist / exports missing.

- [ ] **Step 4: Write the implementation**

Create `src/state/fleet.ts`:

```ts
import {
  initialVehicleState,
  modelYProductConfig,
  type CameraMode,
  type CarModel,
  type SeatClimateMode,
  type SeatPosition,
  type SteeringWheelClimateMode,
  type VehicleStateKey,
  type VehicleViewState,
} from '../types/vehicleTypes';

export interface Vehicle {
  id: string;
  name: string;
  state: VehicleViewState;
}

export interface FleetState {
  vehicles: Vehicle[];
  activeId: string;
}

const MODEL_BASE_NAME: Record<CarModel, string> = {
  modelS: 'Model S',
  model3: 'Model 3',
  modelX: 'Model X',
  modelY: 'Model Y',
};

export function createInitialFleet(): FleetState {
  return {
    vehicles: [{ id: 'veh_1', name: 'Red Velvet', state: { ...initialVehicleState } }],
    activeId: 'veh_1',
  };
}

export function activeIndex(fleet: FleetState): number {
  const index = fleet.vehicles.findIndex((v) => v.id === fleet.activeId);
  return index === -1 ? 0 : index;
}

export function activeVehicle(fleet: FleetState): Vehicle {
  return fleet.vehicles[activeIndex(fleet)];
}

function nextId(fleet: FleetState): string {
  const max = fleet.vehicles.reduce((acc, v) => {
    const n = Number(v.id.replace(/^veh_/, ''));
    return Number.isFinite(n) && n > acc ? n : acc;
  }, 0);
  return `veh_${max + 1}`;
}

function uniqueName(base: string, existing: string[]): string {
  if (!existing.includes(base)) {
    return base;
  }
  let n = 2;
  while (existing.includes(`${base} (${n})`)) {
    n += 1;
  }
  return `${base} (${n})`;
}

function defaultStateForModel(model: CarModel, inheritFrom: VehicleViewState): VehicleViewState {
  return {
    ...initialVehicleState,
    carModel: model,
    theme: inheritFrom.theme,
    lightingMode: inheritFrom.lightingMode,
  };
}

export function addVehicle(fleet: FleetState, model: CarModel): FleetState {
  const id = nextId(fleet);
  const name = uniqueName(MODEL_BASE_NAME[model], fleet.vehicles.map((v) => v.name));
  const inheritFrom = activeVehicle(fleet).state;
  const vehicle: Vehicle = { id, name, state: defaultStateForModel(model, inheritFrom) };
  return { vehicles: [...fleet.vehicles, vehicle], activeId: id };
}

export function removeVehicle(fleet: FleetState, id: string): FleetState {
  if (fleet.vehicles.length <= 1) {
    return fleet;
  }
  const index = fleet.vehicles.findIndex((v) => v.id === id);
  if (index === -1) {
    return fleet;
  }
  const vehicles = fleet.vehicles.filter((v) => v.id !== id);
  let activeId = fleet.activeId;
  if (id === fleet.activeId) {
    const neighbor = vehicles[index - 1] ?? vehicles[index] ?? vehicles[0];
    activeId = neighbor.id;
  }
  return { vehicles, activeId };
}

export function setActiveVehicle(fleet: FleetState, id: string): FleetState {
  return fleet.vehicles.some((v) => v.id === id) ? { ...fleet, activeId: id } : fleet;
}

export function nextVehicleId(fleet: FleetState): string {
  const i = activeIndex(fleet);
  return fleet.vehicles[Math.min(i + 1, fleet.vehicles.length - 1)].id;
}

export function prevVehicleId(fleet: FleetState): string {
  const i = activeIndex(fleet);
  return fleet.vehicles[Math.max(i - 1, 0)].id;
}

export function updateActiveVehicleState(
  fleet: FleetState,
  update: (state: VehicleViewState) => VehicleViewState,
): FleetState {
  const index = activeIndex(fleet);
  const vehicles = fleet.vehicles.slice();
  vehicles[index] = { ...vehicles[index], state: update(vehicles[index].state) };
  return { ...fleet, vehicles };
}

// --- Active-vehicle state updaters (moved from the old useVehicleState; pure + reused by the hook) ---

export function patchState(state: VehicleViewState, partial: Partial<VehicleViewState>): VehicleViewState {
  return { ...state, ...partial };
}

export function toggleState(state: VehicleViewState, key: VehicleStateKey): VehicleViewState {
  const value = state[key];
  if (typeof value !== 'boolean') {
    return state;
  }
  return { ...state, [key]: !value };
}

export function setCameraModeState(state: VehicleViewState, cameraMode: CameraMode): VehicleViewState {
  return { ...state, cameraMode };
}

export function setScreenCameraModeState(state: VehicleViewState, cameraMode: CameraMode): VehicleViewState {
  return {
    ...state,
    cameraMode,
    tirePressureVisible: cameraMode === 'TOP_DOWN' ? state.tirePressureVisible : false,
  };
}

export function cycleSteeringWheelClimateState(state: VehicleViewState): VehicleViewState {
  const caps = modelYProductConfig.climate_capabilities.steeringWheel;
  const sequence: SteeringWheelClimateMode[] = ['off'];
  if (caps.heating) {
    sequence.push('heat');
  }
  if (caps.auto) {
    sequence.push('auto');
  }
  return { ...state, steeringWheelClimateMode: nextInSequence(sequence, state.steeringWheelClimateMode) };
}

export function cycleSeatClimateState(state: VehicleViewState, seat: SeatPosition): VehicleViewState {
  const caps = modelYProductConfig.climate_capabilities.seats[seat];
  const sequence = seatClimateSequence(caps.heatLevels, caps.coolLevels, caps.auto);
  return {
    ...state,
    seatClimateModes: {
      ...state.seatClimateModes,
      [seat]: nextSeatMode(sequence, state.seatClimateModes[seat]),
    },
  };
}

function nextInSequence<T>(sequence: T[], current: T): T {
  const index = sequence.indexOf(current);
  return sequence[(index + 1) % sequence.length] ?? sequence[0];
}

function seatClimateSequence(heatLevels: 0 | 1 | 2 | 3, coolLevels: 0 | 1 | 2 | 3, auto: boolean): SeatClimateMode[] {
  const sequence: SeatClimateMode[] = [{ mode: 'off', level: 0 }];
  for (let level = 1; level <= heatLevels; level += 1) {
    sequence.push({ mode: 'heat', level: level as 1 | 2 | 3 });
  }
  if (auto) {
    sequence.push({ mode: 'auto', level: 0 });
  }
  for (let level = 1; level <= coolLevels; level += 1) {
    sequence.push({ mode: 'cool', level: level as 1 | 2 | 3 });
  }
  return sequence;
}

function nextSeatMode(sequence: SeatClimateMode[], current: SeatClimateMode): SeatClimateMode {
  const index = sequence.findIndex((item) => item.mode === current.mode && item.level === current.level);
  return sequence[(index + 1) % sequence.length] ?? sequence[0];
}
```

- [ ] **Step 5: Run tests to verify they pass**

Run: `pnpm test`
Expected: PASS — all 9 tests green.

- [ ] **Step 6: Typecheck**

Run: `npx tsc --noEmit`
Expected: PASS.

- [ ] **Step 7: Commit**

```bash
git add src/state/fleet.ts src/state/fleet.test.ts package.json pnpm-lock.yaml
git commit -m "feat(state): pure fleet reducer with unit tests"
```

---

### Task 3: Fleet hook + provider (preserve active-car contract)

Wrap the reducer in React state. `useVehicle()` keeps returning the active car's `[state, actions]` so existing screens are untouched. Add `useFleet()` and `useActiveVehicleId()`.

**Files:**
- Modify: `src/state/useVehicleState.ts` (keep `VehicleActions` interface; replace the hook with a `buildVehicleActions` factory)
- Create: `src/state/useFleetState.ts`
- Modify: `src/state/VehicleProvider.tsx`

**Interfaces:**
- Consumes: everything `fleet.ts` produces (Task 2).
- Produces:
  - `buildVehicleActions(apply: (update: (s: VehicleViewState) => VehicleViewState) => void): VehicleActions`
  - `interface Fleet { vehicles: Vehicle[]; activeId: string; activeIndex: number; activeName: string; addVehicle(model: CarModel): void; removeVehicle(id: string): void; setActiveVehicle(id: string): void; nextVehicle(): void; prevVehicle(): void }`
  - `useFleetState(): { active: [VehicleViewState, VehicleActions]; activeId: string; fleet: Fleet }`
  - `useFleet(): Fleet`, `useActiveVehicleId(): string`, unchanged `useVehicle(): [VehicleViewState, VehicleActions]`

- [ ] **Step 1: Replace the hook in `useVehicleState.ts` with the actions factory**

Replace the entire contents of `src/state/useVehicleState.ts` with:

```ts
import type { CameraMode, SeatPosition, VehicleStateKey, VehicleViewState } from '../types/vehicleTypes';
import {
  cycleSeatClimateState,
  cycleSteeringWheelClimateState,
  patchState,
  setCameraModeState,
  setScreenCameraModeState,
  toggleState,
} from './fleet';

export interface VehicleActions {
  setCameraMode: (cameraMode: CameraMode) => void;
  setScreenCameraMode: (cameraMode: CameraMode) => void;
  toggle: (key: VehicleStateKey) => void;
  patch: (patch: Partial<VehicleViewState>) => void;
  cycleSteeringWheelClimate: () => void;
  cycleSeatClimate: (seat: SeatPosition) => void;
}

// Builds the VehicleActions object from a single "apply an update to the active car's state"
// callback. The fleet hook provides `apply`; the action implementations live in fleet.ts so they
// stay pure and unit-tested.
export function buildVehicleActions(
  apply: (update: (state: VehicleViewState) => VehicleViewState) => void,
): VehicleActions {
  return {
    setCameraMode: (cameraMode) => apply((s) => setCameraModeState(s, cameraMode)),
    setScreenCameraMode: (cameraMode) => apply((s) => setScreenCameraModeState(s, cameraMode)),
    toggle: (key) => apply((s) => toggleState(s, key)),
    patch: (partial) => apply((s) => patchState(s, partial)),
    cycleSteeringWheelClimate: () => apply(cycleSteeringWheelClimateState),
    cycleSeatClimate: (seat) => apply((s) => cycleSeatClimateState(s, seat)),
  };
}
```

- [ ] **Step 2: Create the fleet hook**

Create `src/state/useFleetState.ts`:

```ts
import { useCallback, useMemo, useState } from 'react';

import type { CarModel, VehicleViewState } from '../types/vehicleTypes';
import {
  activeIndex,
  activeVehicle,
  addVehicle,
  createInitialFleet,
  nextVehicleId,
  prevVehicleId,
  removeVehicle,
  setActiveVehicle,
  updateActiveVehicleState,
  type FleetState,
  type Vehicle,
} from './fleet';
import { buildVehicleActions, type VehicleActions } from './useVehicleState';

export interface Fleet {
  vehicles: Vehicle[];
  activeId: string;
  activeIndex: number;
  activeName: string;
  addVehicle: (model: CarModel) => void;
  removeVehicle: (id: string) => void;
  setActiveVehicle: (id: string) => void;
  nextVehicle: () => void;
  prevVehicle: () => void;
}

export function useFleetState(): {
  active: [VehicleViewState, VehicleActions];
  activeId: string;
  fleet: Fleet;
} {
  const [fleet, setFleet] = useState<FleetState>(createInitialFleet);

  const applyActive = useCallback(
    (update: (state: VehicleViewState) => VehicleViewState) =>
      setFleet((current) => updateActiveVehicleState(current, update)),
    [],
  );
  const actions = useMemo(() => buildVehicleActions(applyActive), [applyActive]);

  const current = activeVehicle(fleet);

  const fleetApi: Fleet = {
    vehicles: fleet.vehicles,
    activeId: fleet.activeId,
    activeIndex: activeIndex(fleet),
    activeName: current.name,
    addVehicle: (model) => setFleet((f) => addVehicle(f, model)),
    removeVehicle: (id) => setFleet((f) => removeVehicle(f, id)),
    setActiveVehicle: (id) => setFleet((f) => setActiveVehicle(f, id)),
    nextVehicle: () => setFleet((f) => setActiveVehicle(f, nextVehicleId(f))),
    prevVehicle: () => setFleet((f) => setActiveVehicle(f, prevVehicleId(f))),
  };

  return { active: [current.state, actions], activeId: fleet.activeId, fleet: fleetApi };
}
```

- [ ] **Step 3: Update the provider**

Replace the entire contents of `src/state/VehicleProvider.tsx` with:

```ts
import { createContext, useContext, type ReactNode } from 'react';

import { useFleetState, type Fleet } from './useFleetState';
import type { VehicleActions } from './useVehicleState';
import type { VehicleViewState } from '../types/vehicleTypes';

type VehicleContextValue = [VehicleViewState, VehicleActions];

const VehicleContext = createContext<VehicleContextValue | null>(null);
const ActiveIdContext = createContext<string | null>(null);
const FleetContext = createContext<Fleet | null>(null);

// One shared fleet for the whole app. `useVehicle()` returns the ACTIVE car's [state, actions] so
// existing screens are unchanged; `useFleet()` exposes the list + add/remove/select; the Godot
// canvas reads `useActiveVehicleId()` to detect identity switches (vs. field edits).
export function VehicleProvider({ children }: { children: ReactNode }) {
  const { active, activeId, fleet } = useFleetState();
  return (
    <FleetContext.Provider value={fleet}>
      <ActiveIdContext.Provider value={activeId}>
        <VehicleContext.Provider value={active}>{children}</VehicleContext.Provider>
      </ActiveIdContext.Provider>
    </FleetContext.Provider>
  );
}

export function useVehicle(): VehicleContextValue {
  const ctx = useContext(VehicleContext);
  if (!ctx) {
    throw new Error('useVehicle must be used inside <VehicleProvider>');
  }
  return ctx;
}

export function useActiveVehicleId(): string {
  const ctx = useContext(ActiveIdContext);
  if (ctx === null) {
    throw new Error('useActiveVehicleId must be used inside <VehicleProvider>');
  }
  return ctx;
}

export function useFleet(): Fleet {
  const ctx = useContext(FleetContext);
  if (!ctx) {
    throw new Error('useFleet must be used inside <VehicleProvider>');
  }
  return ctx;
}
```

- [ ] **Step 4: Typecheck**

Run: `npx tsc --noEmit`
Expected: PASS. Existing consumers of `useVehicle()` still compile (same return type); the old `useVehicleState` hook is gone but nothing imports it except `VehicleProvider`, which now uses `useFleetState`.

- [ ] **Step 5: Run unit tests (regression)**

Run: `pnpm test`
Expected: PASS (fleet tests unaffected).

- [ ] **Step 6: Manual on-device/simulator smoke**

Launch the app (`pnpm ios` on a device, or the simulator for UI). Verify the app still boots, shows the single Model Y, and the Explore demo toggles still drive the Home car (doors/climate/etc.). Behavior is unchanged from before this task.

- [ ] **Step 7: Commit**

```bash
git add src/state/useVehicleState.ts src/state/useFleetState.ts src/state/VehicleProvider.tsx
git commit -m "feat(state): fleet hook + provider, preserving active-car contract"
```

---

### Task 4: GestureHandlerRootView at the app root

react-native-gesture-handler requires a root wrapper for `GestureDetector` to work (Task 8 needs it).

**Files:**
- Modify: `src/app/_layout.tsx`

**Interfaces:**
- Consumes: nothing new.
- Produces: app tree wrapped in `GestureHandlerRootView`.

- [ ] **Step 1: Read the docs**

Confirm the gesture-handler setup for Expo SDK 56 at `https://docs.expo.dev/versions/v56.0.0/sdk/gesture-handler/` (root view + `react-native-worklets`/reanimated already present in deps).

- [ ] **Step 2: Wrap the tree**

Replace the contents of `src/app/_layout.tsx` with:

```tsx
import { DarkTheme, DefaultTheme, ThemeProvider } from 'expo-router';
import { useColorScheme } from 'react-native';
import { GestureHandlerRootView } from 'react-native-gesture-handler';

import { AnimatedSplashOverlay } from '@/components/animated-icon';
import AppTabs from '@/components/app-tabs';
import { VehicleProvider } from '@/state/VehicleProvider';

export default function TabLayout() {
  const colorScheme = useColorScheme();
  return (
    <GestureHandlerRootView style={{ flex: 1 }}>
      <ThemeProvider value={colorScheme === 'dark' ? DarkTheme : DefaultTheme}>
        <VehicleProvider>
          <AnimatedSplashOverlay />
          <AppTabs />
        </VehicleProvider>
      </ThemeProvider>
    </GestureHandlerRootView>
  );
}
```

- [ ] **Step 3: Typecheck**

Run: `npx tsc --noEmit`
Expected: PASS.

- [ ] **Step 4: Manual smoke**

Launch the app. Verify it still boots and both tabs render normally (no layout regression from the root wrapper).

- [ ] **Step 5: Commit**

```bash
git add src/app/_layout.tsx
git commit -m "chore(app): wrap root in GestureHandlerRootView"
```

---

### Task 5: Home header — dynamic name, battery, page dots

Show the active car's name and battery, and a page indicator when there is more than one car.

**Files:**
- Modify: `src/screens/HomeScreen.tsx`

**Interfaces:**
- Consumes: `useFleet()` (Task 3) → `activeName`, `vehicles`, `activeIndex`.
- Produces: no new exports.

- [ ] **Step 1: Import the fleet hook**

In `src/screens/HomeScreen.tsx`, add to the imports (after the existing `import * as Haptics ...` line):

```tsx
import { useFleet } from '@/state/VehicleProvider';
```

- [ ] **Step 2: Read fleet data in the component**

Inside `HomeScreen`, just after `const insets = useSafeAreaInsets();`, add:

```tsx
  const fleet = useFleet();
```

- [ ] **Step 3: Use the active name**

Replace the hardcoded name in the header:

```tsx
            <Text style={styles.name}>Red Velvet</Text>
```

with:

```tsx
            <Text style={styles.name}>{fleet.activeName}</Text>
```

- [ ] **Step 4: Use the active battery level**

Replace the static battery fill view:

```tsx
          <View style={styles.batteryFill} />
```

with:

```tsx
          <View style={[styles.batteryFill, { width: `${state.batteryLevel}%` }]} />
```

and replace the hardcoded percentage:

```tsx
          <Text style={styles.statusPct}>48%</Text>
```

with:

```tsx
          <Text style={styles.statusPct}>{state.batteryLevel}%</Text>
```

Then remove the `width: '48%',` line from `styles.batteryFill` (it is now provided inline).

- [ ] **Step 5: Add the page dots**

Immediately after the closing `</View>` of the `styles.status` row (before the closing `</SafeAreaView>`), add:

```tsx
        {fleet.vehicles.length > 1 ? (
          <View style={styles.dots}>
            {fleet.vehicles.map((vehicle, index) => (
              <View
                key={vehicle.id}
                style={[styles.dot, index === fleet.activeIndex ? styles.dotActive : null]}
              />
            ))}
          </View>
        ) : null}
```

Add these style entries to the `StyleSheet.create({ ... })` object:

```tsx
  dots: {
    flexDirection: 'row',
    gap: 6,
    marginTop: 10,
  },
  dot: {
    width: 6,
    height: 6,
    borderRadius: 3,
    backgroundColor: 'rgba(255,255,255,0.3)',
  },
  dotActive: {
    backgroundColor: 'white',
  },
```

- [ ] **Step 6: Typecheck**

Run: `npx tsc --noEmit`
Expected: PASS. (Note: `width: \`${n}%\`` is a valid `DimensionValue`.)

- [ ] **Step 7: Manual smoke**

Launch the app. With one car: header reads "Red Velvet", battery 48%, **no dots**. (Dots appear after Task 6 lets you add a car.)

- [ ] **Step 8: Commit**

```bash
git add src/screens/HomeScreen.tsx
git commit -m "feat(home): active car name, battery, and page dots"
```

---

### Task 6: Explore — "Your Vehicles" manager; remove model switcher

Add/remove/select vehicles; the existing demo controls now drive the active car.

**Files:**
- Modify: `src/app/explore.tsx`

**Interfaces:**
- Consumes: `useFleet()` (Task 3), `CarModel`.
- Produces: no new exports.

- [ ] **Step 1: Import the fleet hook and types**

In `src/app/explore.tsx`, the file already imports `useVehicle` from `@/state/VehicleProvider` and `CarModel` from `@/types/vehicleTypes`. Update the provider import to also pull `useFleet`:

```tsx
import { useFleet, useVehicle } from '@/state/VehicleProvider';
```

- [ ] **Step 2: Read the fleet in the component**

Inside `ExploreScreen`, after `const [state, actions] = useVehicle();`, add:

```tsx
  const fleet = useFleet();
```

- [ ] **Step 3: Remove the in-place "Car model" section**

Delete the entire `<Section title="Car model"> ... </Section>` block (the `Segmented` bound to `state.carModel` plus its explanatory `ThemedText`). Also delete the now-unused `CAR_MODEL_OPTIONS` constant near the top of the file.

- [ ] **Step 4: Add the "Your Vehicles" section**

Add this section as the **first** section inside the `ScrollView`, immediately after the `<View style={styles.header}>...</View>` block:

```tsx
      <Section title="Your Vehicles">
        {fleet.vehicles.map((vehicle) => {
          const isActive = vehicle.id === fleet.activeId;
          return (
            <View
              key={vehicle.id}
              style={[styles.row, { backgroundColor: theme.backgroundElement }]}>
              <Pressable style={styles.vehicleSelect} onPress={() => fleet.setActiveVehicle(vehicle.id)}>
                <SymbolView
                  name={isActive ? 'largecircle.fill.circle' : 'circle'}
                  tintColor={isActive ? ACCENT : theme.textSecondary}
                  size={22}
                />
                <Text style={[styles.rowLabel, { color: theme.text }]}>{vehicle.name}</Text>
              </Pressable>
              <Pressable
                hitSlop={8}
                disabled={fleet.vehicles.length === 1}
                onPress={() => fleet.removeVehicle(vehicle.id)}>
                <SymbolView
                  name="trash"
                  tintColor={fleet.vehicles.length === 1 ? theme.backgroundSelected : '#E5484D'}
                  size={20}
                />
              </Pressable>
            </View>
          );
        })}
        <View style={styles.addRow}>
          {ADD_MODEL_OPTIONS.map((opt) => (
            <Pressable
              key={opt.value}
              onPress={() => fleet.addVehicle(opt.value)}
              style={({ pressed }) => [
                styles.addButton,
                { backgroundColor: theme.backgroundElement, opacity: pressed ? 0.85 : 1 },
              ]}>
              <SymbolView name="plus" tintColor={ACCENT} size={16} />
              <Text style={[styles.addButtonLabel, { color: theme.text }]}>{opt.label}</Text>
            </Pressable>
          ))}
        </View>
      </Section>
```

- [ ] **Step 5: Add the model options constant and styles**

Near the top of the file (where `CAR_MODEL_OPTIONS` used to be), add:

```tsx
// Models you can add to the fleet. Adding appends a fresh car of that model and makes it active.
const ADD_MODEL_OPTIONS: { value: CarModel; label: string }[] = [
  { value: 'modelS', label: 'Add S' },
  { value: 'model3', label: 'Add 3' },
  { value: 'modelX', label: 'Add X' },
  { value: 'modelY', label: 'Add Y' },
];
```

Add these entries to the bottom `StyleSheet.create({ ... })`:

```tsx
  vehicleSelect: {
    flex: 1,
    flexDirection: 'row',
    alignItems: 'center',
    gap: Spacing.three,
  },
  addRow: {
    flexDirection: 'row',
    gap: Spacing.two,
  },
  addButton: {
    flex: 1,
    flexDirection: 'row',
    justifyContent: 'center',
    alignItems: 'center',
    gap: 4,
    borderRadius: 12,
    paddingVertical: Spacing.three,
  },
  addButtonLabel: {
    fontSize: 15,
    fontWeight: '700',
  },
```

- [ ] **Step 6: Typecheck**

Run: `npx tsc --noEmit`
Expected: PASS. (Confirm `CarModel` is still imported — it is used by `ADD_MODEL_OPTIONS`. The old `Segmented`/`CameraMode`/`LightingMode` imports remain used by other sections.)

- [ ] **Step 7: Manual on-device verification**

Launch the app. On Explore:
- "Your Vehicles" shows one row, "Red Velvet", selected (filled circle), trash icon greyed/disabled.
- Tap "Add 3" → a "Model 3" row appears and becomes selected; Home header now reads "Model 3"; Home shows **2 dots** with the second active.
- Tap "Add 3" again → "Model 3 (2)" appears.
- Open a door via the Closures section → it applies to the now-active car only.
- Select "Red Velvet" → its own state shows (door still closed on it).
- Trash a non-last car → it is removed; if it was active, a neighbor becomes active. Trash is disabled when one car remains.

- [ ] **Step 8: Commit**

```bash
git add src/app/explore.tsx
git commit -m "feat(explore): add/remove/select vehicles; drop in-place model switcher"
```

---

### Task 7: Bridge `switchVehicle()` — clean full re-apply on identity change

When the active vehicle changes, re-apply that car's full state to the engine (a clean reveal regardless of whether the model changed). Wire `VehicleCanvas` to call it on identity change vs. incremental edits.

**Files:**
- Modify: `src/godot/GodotRendererBridge.ts`
- Modify: `src/godot/VehicleCanvas.tsx`
- Modify: `src/app/index.tsx`

**Interfaces:**
- Consumes: `useActiveVehicleId()` (Task 3); existing bridge message creators.
- Produces: `GodotRendererBridge.switchVehicle(next: VehicleViewState): void`; `VehicleCanvas` gains a `vehicleId: string` prop.

- [ ] **Step 1: Add `switchVehicle` to the bridge**

In `src/godot/GodotRendererBridge.ts`, add this method to the `GodotRendererBridge` class (e.g. right after `updateState`):

```ts
  // Active-vehicle switch: re-apply the incoming car's FULL state as a fresh product, so the reveal
  // is clean whether or not the model changed (UPDATE_PRODUCT alone can't swap the model, and a
  // freshly-instanced vehicle defaults its lights off). Mirrors the carModel-change branch of
  // updateState but is driven by vehicle IDENTITY, not field diffs.
  switchVehicle(next: VehicleViewState): void {
    const previous = this.lastState;
    this.lastState = next;
    if (!previous || previous.theme !== next.theme) {
      this.send(createThemeMessage(next.theme));
    }
    this.send(createShowProductMessage(next));
    this.moveCamera(next.cameraMode, false);
    this.requestMarkers();
    this.send(createVehicleLightsMessage(next, this.currentVehicleId()));
  }
```

- [ ] **Step 2: Add a `vehicleId` prop to `VehicleCanvas` and branch the update effect**

In `src/godot/VehicleCanvas.tsx`:

In the `VehicleCanvasProps` interface, add:

```tsx
  /** Active vehicle id. A change means the user switched cars (full re-apply) vs. editing fields. */
  vehicleId: string;
```

Update the component signature to destructure it:

```tsx
export function VehicleCanvas({ state, vehicleId, children }: VehicleCanvasProps) {
```

Add a ref next to the existing `booted`/`layout` refs:

```tsx
  const lastVehicleId = useRef<string | null>(null);
```

In `onLayout`, in the boot branch, record the id so the first state effect doesn't re-trigger a switch. Change the boot branch from:

```tsx
    if (!booted.current) {
      bridge.boot(state, frame);
      booted.current = true;
    } else {
```

to:

```tsx
    if (!booted.current) {
      bridge.boot(state, frame);
      lastVehicleId.current = vehicleId;
      booted.current = true;
    } else {
```

Replace the existing state effect:

```tsx
  useEffect(() => {
    if (booted.current) {
      bridge.updateState(state);
    }
  }, [bridge, state]);
```

with:

```tsx
  useEffect(() => {
    if (!booted.current) {
      return;
    }
    if (lastVehicleId.current !== vehicleId) {
      lastVehicleId.current = vehicleId;
      bridge.switchVehicle(state);
    } else {
      bridge.updateState(state);
    }
  }, [bridge, state, vehicleId]);
```

- [ ] **Step 3: Pass `vehicleId` from `index.tsx`**

In `src/app/index.tsx`, add the import:

```tsx
import { useActiveVehicleId, useVehicle } from '@/state/VehicleProvider';
```

(replacing the existing `import { useVehicle } from '@/state/VehicleProvider';`).

Inside `Index`, after `const [state, actions] = useVehicle();`, add:

```tsx
  const vehicleId = useActiveVehicleId();
```

Pass it to the canvas — change:

```tsx
      <VehicleCanvas state={state} actions={actions}>
```

to:

```tsx
      <VehicleCanvas state={state} actions={actions} vehicleId={vehicleId}>
```

- [ ] **Step 4: Typecheck**

Run: `npx tsc --noEmit`
Expected: PASS.

- [ ] **Step 5: Manual on-device verification**

Launch on a **device** (the engine is a no-op on the simulator). On Explore:
- Add a Model S, then a Model X. Select between Red Velvet (Y), Model S, Model X via the vehicle rows — the rendered car swaps to the correct model each time.
- Open a door on Model S, switch away and back — the door state is preserved and re-applied on return.

- [ ] **Step 6: Commit**

```bash
git add src/godot/GodotRendererBridge.ts src/godot/VehicleCanvas.tsx src/app/index.tsx
git commit -m "feat(godot): switchVehicle() full re-apply on active-car change"
```

---

### Task 8: Home swipe — slide-out → off-screen swap → slide-in

The signature interaction: a horizontal swipe over the car switches the active vehicle with a slide; the revealed car is the live engine render in its real state. Coexists with the vertical menu scroll. No-op with one car; clamps at the ends.

**Files:**
- Modify: `src/godot/VehicleCanvas.tsx` (accept a `carTranslateX` animated value, apply it to the Godot view)
- Modify: `src/app/index.tsx` (gesture + commit animation, Home only)

**Interfaces:**
- Consumes: `useFleet()` (Task 3), `Animated` from `react-native`, `Gesture`/`GestureDetector` from `react-native-gesture-handler`.
- Produces: `VehicleCanvas` gains an optional `carTranslateX?: Animated.AnimatedValue` prop.

- [ ] **Step 1: Read the docs**

Confirm the gesture-handler `Gesture.Pan()` + `GestureDetector` API and `runOnJS` usage for SDK 56 at `https://docs.expo.dev/versions/v56.0.0/sdk/gesture-handler/`. The commit animation uses RN's `Animated` (already used in `HomeScreen`).

- [ ] **Step 2: Let `VehicleCanvas` translate the live car view**

In `src/godot/VehicleCanvas.tsx`:

Add to imports:

```tsx
import { Animated as RNAnimated } from 'react-native';
```

Add to `VehicleCanvasProps`:

```tsx
  /** Horizontal translation of the live car surface, driven by the Home swipe. Defaults to static. */
  carTranslateX?: RNAnimated.Value;
```

Destructure it with a default:

```tsx
export function VehicleCanvas({ state, vehicleId, carTranslateX, children }: VehicleCanvasProps) {
```

Wrap **only** the `<ExpoGodotView .../>` element in an animated view so the overlay UI does not move. Replace:

```tsx
        <ExpoGodotView
          sceneName="mobile"
          orbitEnabled={false}
          style={StyleSheet.absoluteFill}
        />
```

with:

```tsx
        <RNAnimated.View
          style={[StyleSheet.absoluteFill, carTranslateX ? { transform: [{ translateX: carTranslateX }] } : null]}
          pointerEvents="none">
          <ExpoGodotView sceneName="mobile" orbitEnabled={false} style={StyleSheet.absoluteFill} />
        </RNAnimated.View>
```

- [ ] **Step 3: Add the swipe gesture + commit animation in `index.tsx`**

In `src/app/index.tsx`:

Update imports — add `Animated` and `useWindowDimensions` to the `react-native` import, add gesture-handler, add `useFleet`:

```tsx
import { useRef } from 'react';
import { Animated, PanResponder, Pressable, StyleSheet, Text, useWindowDimensions, View } from 'react-native';
import { Gesture, GestureDetector } from 'react-native-gesture-handler';
import { SafeAreaView } from 'react-native-safe-area-context';
import { SymbolView } from 'expo-symbols';

import { VehicleCanvas } from '@/godot/VehicleCanvas';
import { ClimateScreen } from '@/screens/ClimateScreen';
import { ControlsScreen } from '@/screens/ControlsScreen';
import { HomeScreen } from '@/screens/HomeScreen';
import { useActiveVehicleId, useFleet, useVehicle } from '@/state/VehicleProvider';
```

Inside `Index`, after `const vehicleId = useActiveVehicleId();`, add the fleet, dimensions, animated value, and gesture:

```tsx
  const fleet = useFleet();
  const { width } = useWindowDimensions();
  const carTranslateX = useRef(new Animated.Value(0)).current;
  const animating = useRef(false);

  // Commit a switch: slide the live car fully off-screen in `direction` (-1 left / +1 right), swap
  // the active vehicle WHILE off-screen (the engine re-renders the incoming car in its real state),
  // jump the surface to the opposite edge, then slide it back to centre.
  const commitSwitch = (direction: -1 | 1) => {
    animating.current = true;
    Animated.timing(carTranslateX, {
      toValue: direction * width,
      duration: 180,
      useNativeDriver: true,
    }).start(() => {
      if (direction < 0) {
        fleet.nextVehicle();
      } else {
        fleet.prevVehicle();
      }
      carTranslateX.setValue(-direction * width);
      Animated.timing(carTranslateX, {
        toValue: 0,
        duration: 220,
        useNativeDriver: true,
      }).start(() => {
        animating.current = false;
      });
    });
  };

  const springBack = () => {
    Animated.spring(carTranslateX, { toValue: 0, useNativeDriver: true, bounciness: 0 }).start();
  };

  // Horizontal pan over the car. activeOffsetX claims only clearly-horizontal drags; failOffsetY
  // lets the Home menu's vertical ScrollView win vertical drags. No-op with a single car.
  // runOnJS(true): this project has reanimated installed, so RNGH would otherwise workletize these
  // callbacks onto the UI thread — but we drive RN's Animated.Value and call plain-JS fleet methods,
  // which must run on the JS thread. Forcing JS-thread callbacks is the correct pairing here.
  const swipe = Gesture.Pan()
    .runOnJS(true)
    .activeOffsetX([-20, 20])
    .failOffsetY([-15, 15])
    .onUpdate((e) => {
      if (animating.current || fleet.vehicles.length < 2) {
        return;
      }
      const atStart = fleet.activeIndex === 0;
      const atEnd = fleet.activeIndex === fleet.vehicles.length - 1;
      // Rubber-band past the ends so a boundary swipe feels bounded, not stuck.
      const damped = (e.translationX > 0 && atStart) || (e.translationX < 0 && atEnd);
      carTranslateX.setValue(damped ? e.translationX * 0.25 : e.translationX);
    })
    .onEnd((e) => {
      if (animating.current || fleet.vehicles.length < 2) {
        springBack();
        return;
      }
      const threshold = width * 0.25;
      const atStart = fleet.activeIndex === 0;
      const atEnd = fleet.activeIndex === fleet.vehicles.length - 1;
      if (e.translationX <= -threshold && !atEnd) {
        commitSwitch(-1);
      } else if (e.translationX >= threshold && !atStart) {
        commitSwitch(1);
      } else {
        springBack();
      }
    });
```

> Note: `.runOnJS(true)` is REQUIRED. With reanimated present, RNGH v2 auto-workletizes gesture callbacks onto the UI thread; calling `fleet.nextVehicle()` (plain JS) or `carTranslateX.setValue()` (RN Animated, not a reanimated shared value) from a worklet would crash. Keep `.runOnJS(true)`; do not convert these callbacks to worklets.

- [ ] **Step 4: Wrap the Home view in the GestureDetector and pass `carTranslateX`**

Pass the animated value to the canvas — change:

```tsx
      <VehicleCanvas state={state} actions={actions} vehicleId={vehicleId}>
        {panel}
      </VehicleCanvas>
```

to wrap the Home panel in the detector (only Home gets the swipe; climate/controls do not):

```tsx
      <VehicleCanvas state={state} actions={actions} vehicleId={vehicleId} carTranslateX={carTranslateX}>
        {mode === 'home' ? <GestureDetector gesture={swipe}>{panel}</GestureDetector> : panel}
      </VehicleCanvas>
```

- [ ] **Step 5: Typecheck**

Run: `npx tsc --noEmit`
Expected: PASS.

- [ ] **Step 6: Run unit tests (regression)**

Run: `pnpm test`
Expected: PASS.

- [ ] **Step 7: Manual on-device verification**

Launch on a **device**. With one car: swiping the car horizontally does nothing (no-op). Add two cars in Explore (e.g. a Model 3 and a Model X), return Home:
- Swipe left → current car slides off left, the next car slides in from the right, **live and in its real state**; dots advance.
- Swipe right → previous car slides back in.
- Swipe left at the last car / right at the first car → rubber-bands and springs back (no wrap).
- A door opened on a car (via Explore) is visible when you swipe back to that car.
- Vertical drag on the car still opens the Home menu sheet (swipe did not steal vertical scroll).
- Swipe partially and release under the threshold → car springs back, no switch.

If translating the live GL view looks janky on device, apply the spec's fallback: keep the same `commitSwitch` swap logic but replace the translate with a directional cross-fade (animate the wrapped view's `opacity` 1→0 before the swap and 0→1 after) — change only Step 2's animated style and `commitSwitch`'s `Animated.timing` targets; the gesture/threshold logic is unchanged.

- [ ] **Step 8: Commit**

```bash
git add src/app/index.tsx src/godot/VehicleCanvas.tsx
git commit -m "feat(home): swipe to switch vehicles with slide-out/swap/slide-in"
```

---

## Self-Review

**Spec coverage:**
- Multiple vehicles, each independent state → Task 2 (`Vehicle`/`FleetState`, per-car `state`), Task 3 (active-state isolation). ✓
- Swipe left/right on Home switches active car → Task 8. ✓
- One car ⇒ swipe no-op → Task 8 (`vehicles.length < 2` guard). ✓
- Initial Model Y "Red Velvet" → Task 2 (`createInitialFleet`). ✓
- Explore add/remove cars → Task 6. ✓
- Remove in-place model switcher → Task 6 Step 3. ✓
- Revealed car shows real state → Task 7 (`switchVehicle` full re-apply) + Task 8 (swap while off-screen, live engine). ✓
- Per-car battery, dynamic name, page dots → Tasks 1 + 5. ✓
- Can't remove last car; remove-active selects neighbor; name dedup; clamped swipe → Task 2 (tested). ✓
- GestureHandlerRootView root wrapper → Task 4. ✓
- In-memory only → no persistence anywhere; `useState(createInitialFleet)`. ✓
- Same-model vs different-model swap → Task 7 `switchVehicle` re-applies fully (SHOW_PRODUCT) for both. ✓

**Placeholder scan:** No TBD/TODO/"handle edge cases"/"similar to Task N"; every code step shows complete code. ✓

**Type consistency:** `FleetState`/`Vehicle` shapes, `Fleet` interface methods (`addVehicle`/`removeVehicle`/`setActiveVehicle`/`nextVehicle`/`prevVehicle`), `buildVehicleActions` signature, `VehicleActions` shape, `switchVehicle(next: VehicleViewState)`, and `VehicleCanvas` props (`vehicleId`, `carTranslateX`) match across Tasks 2/3/5/6/7/8. The `apply` callback type `(update: (s: VehicleViewState) => VehicleViewState) => void` is identical in `buildVehicleActions` (Task 3 Step 1) and `applyActive` (Task 3 Step 2). ✓
