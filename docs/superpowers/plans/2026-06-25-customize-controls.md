# Customize Controls (Favorites Drag-and-Drop) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add the official Tesla app's "Customize Controls" flow — long-press the Home favorites bar to open a bottom sheet, then drag any action from a grid onto one of the 5 favorite slots to replace it.

**Architecture:** Introduce a central action **catalog**, a global **favorites** preference slice backed by a generic **persistence** layer (in-memory default, AsyncStorage-ready), expose it through the existing `VehicleProvider`, render the Home favorites bar from it, and build a self-contained **CustomizeControlsSheet** using `PanResponder` + `Animated` for the drag-and-drop (RNGH is inert in this app's native tabs).

**Tech Stack:** React Native 0.85 / Expo SDK 56, TypeScript (strict), `expo-symbols` (SF Symbols), `expo-haptics`, React Context + hooks, `node --test` + `tsx` for unit tests.

## Global Constraints

- **No new native dependency.** Persistence defaults to an in-memory backend so this ships JS-only (no `xcodebuild` rebuild). Do NOT add `@react-native-async-storage/async-storage` in this plan.
- **Gestures via `PanResponder` only** — react-native-gesture-handler is inert inside the native tabs here. Long-press via `Pressable.onLongPress` is fine.
- **Icons must be valid `SFSymbol` names** (the type is a closed union from `sf-symbols-typescript`). All names in this plan were verified to exist in `sf-symbols-typescript@2.2.0`.
- **Catalog = 16 actions; favorites = always 5; grid = always the other 11** (fixed 3×4, no scrolling).
- **Favorites are account-global**, not per-vehicle.
- Path alias `@/*` → `src/*`. Strict TypeScript. Test files (`**/*.test.ts`) are excluded from `tsc`.
- Match the existing dark visual language (sheet tone `#1C1C1E`, hairline borders) used in `src/screens/ClimateScreen.tsx`.

---

### Task 1: Action catalog

**Files:**
- Create: `src/state/controlActions.ts`
- Test: `src/state/controlActions.test.ts`
- Modify: `package.json` (add the new test file to the `test` script)

**Interfaces:**
- Consumes: `VehicleViewState` (from `src/types/vehicleTypes.ts`), `VehicleActions` (from `src/state/useVehicleState.ts`), `SFSymbol` (from `expo-symbols`) — all **type-only** imports so this module has no native runtime dependency and stays node-testable.
- Produces:
  - `type ControlActionId` — union of the 16 action ids.
  - `interface ControlActionDef { id; label; symbol(state): SFSymbol; isActive(state): boolean; run(state, actions): void }`
  - `const CONTROL_ACTIONS: Record<ControlActionId, ControlActionDef>`
  - `const CONTROL_ACTION_ORDER: ControlActionId[]` (all 16, stable grid order)
  - `const DEFAULT_FAVORITES: ControlActionId[]` (length 5)

- [ ] **Step 1: Write the failing test**

Create `src/state/controlActions.test.ts`:

```ts
import test from 'node:test';
import assert from 'node:assert/strict';

import { CONTROL_ACTIONS, CONTROL_ACTION_ORDER, DEFAULT_FAVORITES, type ControlActionId } from './controlActions';

test('CONTROL_ACTION_ORDER lists every catalog action exactly once', () => {
  const ids = Object.keys(CONTROL_ACTIONS) as ControlActionId[];
  assert.equal(CONTROL_ACTION_ORDER.length, ids.length);
  assert.deepEqual([...CONTROL_ACTION_ORDER].sort(), [...ids].sort());
});

test('there are 16 actions', () => {
  assert.equal(Object.keys(CONTROL_ACTIONS).length, 16);
});

test('every action def id matches its catalog key', () => {
  for (const [key, def] of Object.entries(CONTROL_ACTIONS)) {
    assert.equal(def.id, key);
  }
});

test('DEFAULT_FAVORITES are five valid, distinct action ids', () => {
  assert.equal(DEFAULT_FAVORITES.length, 5);
  assert.equal(new Set(DEFAULT_FAVORITES).size, 5);
  for (const id of DEFAULT_FAVORITES) {
    assert.ok(CONTROL_ACTIONS[id], `unknown favorite ${id}`);
  }
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `node --import tsx --test src/state/controlActions.test.ts`
Expected: FAIL — `Cannot find module './controlActions'`.

- [ ] **Step 3: Write the catalog**

Create `src/state/controlActions.ts`:

```ts
import type { SFSymbol } from 'expo-symbols';

import type { VehicleViewState } from '../types/vehicleTypes';
import type { VehicleActions } from './useVehicleState';

export type ControlActionId =
  | 'lock'
  | 'climate'
  | 'charging'
  | 'frunk'
  | 'trunk'
  | 'vent'
  | 'flash'
  | 'honk'
  | 'lightShow'
  | 'lowPower'
  | 'start'
  | 'sentry'
  | 'summon'
  | 'unlatchDoor'
  | 'bioweapon'
  | 'homelink';

export interface ControlActionDef {
  id: ControlActionId;
  label: string;
  /** Glyph for the favorites bar / grid; a function so lock can swap open↔closed. */
  symbol: (state: VehicleViewState) => SFSymbol;
  /** Whether the favorites-bar icon renders "active" (white) vs dimmed. */
  isActive: (state: VehicleViewState) => boolean;
  /** What happens when the favorites-bar icon is tapped. */
  run: (state: VehicleViewState, actions: VehicleActions) => void;
}

const noop = () => {};

const anyWindowOpen = (s: VehicleViewState) =>
  s.leftFrontWindowOpen || s.rightFrontWindowOpen || s.leftRearWindowOpen || s.rightRearWindowOpen;

export const CONTROL_ACTIONS: Record<ControlActionId, ControlActionDef> = {
  lock: {
    id: 'lock',
    label: 'Lock',
    symbol: (s) => (s.locked ? 'lock.fill' : 'lock.open.fill'),
    isActive: (s) => !s.locked,
    run: (_s, a) => a.toggle('locked'),
  },
  climate: {
    id: 'climate',
    label: 'Climate',
    symbol: () => 'fanblades.fill',
    isActive: (s) => s.climateOn,
    run: (_s, a) => a.setCameraMode('CLIMATE'),
  },
  charging: {
    id: 'charging',
    label: 'Charging',
    symbol: () => 'bolt.fill',
    isActive: (s) => s.charging,
    run: (_s, a) => a.setCameraMode('CHARGING'),
  },
  frunk: {
    id: 'frunk',
    label: 'Frunk',
    symbol: () => 'car.side.front.open.fill',
    isActive: (s) => s.frunkOpen,
    run: (_s, a) => a.toggle('frunkOpen'),
  },
  trunk: {
    id: 'trunk',
    label: 'Trunk',
    symbol: () => 'car.side.rear.open.fill',
    isActive: (s) => s.trunkOpen,
    run: (_s, a) => a.toggle('trunkOpen'),
  },
  vent: {
    id: 'vent',
    label: 'Vent',
    symbol: () => 'wind',
    isActive: anyWindowOpen,
    run: (s, a) => {
      const open = !anyWindowOpen(s);
      a.patch({
        leftFrontWindowOpen: open,
        rightFrontWindowOpen: open,
        leftRearWindowOpen: open,
        rightRearWindowOpen: open,
      });
    },
  },
  flash: {
    id: 'flash',
    label: 'Flash',
    symbol: () => 'headlight.low.beam',
    isActive: () => false,
    run: (_s, a) => {
      a.patch({ headlightsOn: true });
      setTimeout(() => a.patch({ headlightsOn: false }), 1200);
    },
  },
  honk: {
    id: 'honk',
    label: 'Honk',
    symbol: () => 'horn.fill',
    isActive: () => false,
    run: noop,
  },
  lightShow: {
    id: 'lightShow',
    label: 'Light Show',
    symbol: () => 'globe.americas.fill',
    isActive: () => false,
    run: noop,
  },
  lowPower: {
    id: 'lowPower',
    label: 'Low Power',
    symbol: () => 'battery.25',
    isActive: () => false,
    run: noop,
  },
  start: {
    id: 'start',
    label: 'Start',
    symbol: () => 'key.radiowaves.forward.fill',
    isActive: () => false,
    run: noop,
  },
  sentry: {
    id: 'sentry',
    label: 'Sentry',
    symbol: () => 'record.circle.fill',
    isActive: (s) => s.sentryEnabled,
    run: (_s, a) => a.toggle('sentryEnabled'),
  },
  summon: {
    id: 'summon',
    label: 'Summon',
    symbol: () => 'steeringwheel',
    isActive: () => false,
    run: noop,
  },
  unlatchDoor: {
    id: 'unlatchDoor',
    label: 'Unlatch Door',
    symbol: () => 'door.left.hand.open',
    isActive: (s) => s.driverFrontDoorOpen,
    run: (_s, a) => a.toggle('driverFrontDoorOpen'),
  },
  bioweapon: {
    id: 'bioweapon',
    label: 'Bioweapon Defense',
    symbol: () => 'microbe',
    isActive: () => false,
    run: noop,
  },
  homelink: {
    id: 'homelink',
    label: 'HomeLink',
    symbol: () => 'house.fill',
    isActive: () => false,
    run: noop,
  },
};

// Stable grid ordering (the official app's rough grouping). The grid renders this list filtered to
// the actions NOT currently in the favorites bar, so it is always exactly 11 items.
export const CONTROL_ACTION_ORDER: ControlActionId[] = [
  'bioweapon',
  'flash',
  'honk',
  'lightShow',
  'lowPower',
  'start',
  'sentry',
  'summon',
  'trunk',
  'unlatchDoor',
  'vent',
  'homelink',
  'lock',
  'climate',
  'charging',
  'frunk',
];

export const DEFAULT_FAVORITES: ControlActionId[] = ['lock', 'climate', 'charging', 'frunk', 'vent'];
```

- [ ] **Step 4: Run test to verify it passes**

Run: `node --import tsx --test src/state/controlActions.test.ts`
Expected: PASS — 4 tests pass.

- [ ] **Step 5: Wire the test into `npm test`**

In `package.json`, change the `test` script from:

```json
"test": "node --import tsx --test src/state/fleet.test.ts"
```

to:

```json
"test": "node --import tsx --test src/state/fleet.test.ts src/state/controlActions.test.ts"
```

- [ ] **Step 6: Commit**

```bash
git add src/state/controlActions.ts src/state/controlActions.test.ts package.json
git commit -m "feat(controls): central action catalog (16 actions) + default favorites"
```

---

### Task 2: Favorites preferences reducer

**Files:**
- Create: `src/state/preferences.ts`
- Test: `src/state/preferences.test.ts`
- Modify: `package.json` (add to `test` script)

**Interfaces:**
- Consumes: `ControlActionId`, `DEFAULT_FAVORITES` (from `src/state/controlActions.ts`).
- Produces:
  - `interface Preferences { favorites: ControlActionId[] }`
  - `const defaultPreferences: Preferences`
  - `function setFavoriteSlot(prefs, slotIndex, id): Preferences`
  - `type PreferencesAction = { type: 'setFavorite'; slotIndex: number; id: ControlActionId }`
  - `function preferencesReducer(prefs, action): Preferences`

- [ ] **Step 1: Write the failing test**

Create `src/state/preferences.test.ts`:

```ts
import test from 'node:test';
import assert from 'node:assert/strict';

import { defaultPreferences, preferencesReducer, setFavoriteSlot } from './preferences';

test('replaces the slot when the dropped id is not already a favorite', () => {
  const next = setFavoriteSlot(defaultPreferences, 0, 'honk');
  assert.equal(next.favorites[0], 'honk');
  assert.deepEqual(next.favorites.slice(1), defaultPreferences.favorites.slice(1));
});

test('swaps positions when the dropped id is already a favorite elsewhere', () => {
  // default: ['lock','climate','charging','frunk','vent']; drop 'vent' (idx 4) into slot 0
  const next = setFavoriteSlot(defaultPreferences, 0, 'vent');
  assert.equal(next.favorites[0], 'vent');
  assert.equal(next.favorites[4], 'lock'); // displaced 'lock' lands in vent's old slot
});

test('no-op (same reference) when dropping an id onto the slot it already occupies', () => {
  assert.equal(setFavoriteSlot(defaultPreferences, 0, 'lock'), defaultPreferences);
});

test('ignores an out-of-range slot index', () => {
  assert.equal(setFavoriteSlot(defaultPreferences, 9, 'honk'), defaultPreferences);
  assert.equal(setFavoriteSlot(defaultPreferences, -1, 'honk'), defaultPreferences);
});

test('does not mutate the input', () => {
  const input = { favorites: [...defaultPreferences.favorites] };
  const snapshot = [...input.favorites];
  setFavoriteSlot(input, 1, 'sentry');
  assert.deepEqual(input.favorites, snapshot);
});

test('preferencesReducer dispatches setFavorite', () => {
  const next = preferencesReducer(defaultPreferences, { type: 'setFavorite', slotIndex: 2, id: 'summon' });
  assert.equal(next.favorites[2], 'summon');
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `node --import tsx --test src/state/preferences.test.ts`
Expected: FAIL — `Cannot find module './preferences'`.

- [ ] **Step 3: Write the reducer**

Create `src/state/preferences.ts`:

```ts
import { DEFAULT_FAVORITES, type ControlActionId } from './controlActions';

export interface Preferences {
  favorites: ControlActionId[];
}

export const defaultPreferences: Preferences = {
  favorites: DEFAULT_FAVORITES,
};

// Drop `id` into `slotIndex`. If `id` already occupies another slot, the two slots SWAP (keeps
// favorites duplicate-free). If `id` already sits in `slotIndex`, returns the same object (no-op).
// Out-of-range index is ignored. Pure — never mutates the input.
export function setFavoriteSlot(
  prefs: Preferences,
  slotIndex: number,
  id: ControlActionId,
): Preferences {
  const { favorites } = prefs;
  if (slotIndex < 0 || slotIndex >= favorites.length) {
    return prefs;
  }
  if (favorites[slotIndex] === id) {
    return prefs;
  }
  const next = [...favorites];
  const existing = next.indexOf(id);
  if (existing !== -1) {
    next[existing] = next[slotIndex];
  }
  next[slotIndex] = id;
  return { ...prefs, favorites: next };
}

export type PreferencesAction = { type: 'setFavorite'; slotIndex: number; id: ControlActionId };

export function preferencesReducer(prefs: Preferences, action: PreferencesAction): Preferences {
  switch (action.type) {
    case 'setFavorite':
      return setFavoriteSlot(prefs, action.slotIndex, action.id);
    default:
      return prefs;
  }
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `node --import tsx --test src/state/preferences.test.ts`
Expected: PASS — 6 tests pass.

- [ ] **Step 5: Wire into `npm test`**

In `package.json`, append `src/state/preferences.test.ts` to the `test` script:

```json
"test": "node --import tsx --test src/state/fleet.test.ts src/state/controlActions.test.ts src/state/preferences.test.ts"
```

- [ ] **Step 6: Commit**

```bash
git add src/state/preferences.ts src/state/preferences.test.ts package.json
git commit -m "feat(controls): favorites preferences slice + pure reducer"
```

---

### Task 3: Generic persistence infra (pure)

**Files:**
- Create: `src/state/persistence.ts`
- Test: `src/state/persistence.test.ts`
- Modify: `package.json` (add to `test` script)

**Interfaces:**
- Consumes: nothing (no React, no native modules — keeps it node-testable).
- Produces:
  - `interface AppStorage { getItem(key): Promise<string|null>; setItem(key, value): Promise<void> }`
  - `function createMemoryBackend(): AppStorage`
  - `const memoryBackend: AppStorage`
  - `function load<T>(storage, key, fallback): Promise<T>`
  - `function makeSaver<T>(storage, key, delayMs?): (value: T) => void`

- [ ] **Step 1: Write the failing test**

Create `src/state/persistence.test.ts`:

```ts
import test from 'node:test';
import assert from 'node:assert/strict';

import { createMemoryBackend, load, makeSaver } from './persistence';

test('load returns the fallback for a missing key', async () => {
  const s = createMemoryBackend();
  assert.deepEqual(await load(s, 'missing', { a: 1 }), { a: 1 });
});

test('load returns the stored value', async () => {
  const s = createMemoryBackend();
  await s.setItem('k', JSON.stringify({ a: 2 }));
  assert.deepEqual(await load(s, 'k', { a: 1 }), { a: 2 });
});

test('load returns the fallback on corrupt JSON', async () => {
  const s = createMemoryBackend();
  await s.setItem('k', 'not json{');
  assert.deepEqual(await load(s, 'k', { a: 1 }), { a: 1 });
});

test('makeSaver persists the latest value once after the debounce window', async () => {
  const s = createMemoryBackend();
  const save = makeSaver<{ n: number }>(s, 'k', 5);
  save({ n: 1 });
  save({ n: 2 });
  save({ n: 3 });
  await new Promise((r) => setTimeout(r, 25));
  assert.deepEqual(await load(s, 'k', { n: 0 }), { n: 3 });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `node --import tsx --test src/state/persistence.test.ts`
Expected: FAIL — `Cannot find module './persistence'`.

- [ ] **Step 3: Write the persistence helpers**

Create `src/state/persistence.ts`:

```ts
// Generic, storage-agnostic persistence. The default backend is in-memory (no native module), so
// features can ship JS-only. Swapping in an AsyncStorage-backed `AppStorage` (and rebuilding) makes
// every consumer persist across app launches with no other changes.

export interface AppStorage {
  getItem(key: string): Promise<string | null>;
  setItem(key: string, value: string): Promise<void>;
}

export function createMemoryBackend(): AppStorage {
  const store = new Map<string, string>();
  return {
    getItem: async (key) => (store.has(key) ? (store.get(key) as string) : null),
    setItem: async (key, value) => {
      store.set(key, value);
    },
  };
}

// One shared in-memory backend for the app. Replace with an AsyncStorage adapter later.
export const memoryBackend: AppStorage = createMemoryBackend();

export async function load<T>(storage: AppStorage, key: string, fallback: T): Promise<T> {
  try {
    const raw = await storage.getItem(key);
    if (raw == null) {
      return fallback;
    }
    return JSON.parse(raw) as T;
  } catch {
    return fallback;
  }
}

// Debounced saver: repeated calls within `delayMs` collapse into one write of the latest value.
export function makeSaver<T>(storage: AppStorage, key: string, delayMs = 300): (value: T) => void {
  let timer: ReturnType<typeof setTimeout> | null = null;
  let pending: T;
  return (value: T) => {
    pending = value;
    if (timer != null) {
      clearTimeout(timer);
    }
    timer = setTimeout(() => {
      timer = null;
      void storage.setItem(key, JSON.stringify(pending));
    }, delayMs);
  };
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `node --import tsx --test src/state/persistence.test.ts`
Expected: PASS — 4 tests pass.

- [ ] **Step 5: Wire into `npm test`**

In `package.json`, append `src/state/persistence.test.ts`:

```json
"test": "node --import tsx --test src/state/fleet.test.ts src/state/controlActions.test.ts src/state/preferences.test.ts src/state/persistence.test.ts"
```

- [ ] **Step 6: Commit**

```bash
git add src/state/persistence.ts src/state/persistence.test.ts package.json
git commit -m "feat(state): generic in-memory-default persistence layer"
```

---

### Task 4: `usePersistedReducer` hook + provider wiring

**Files:**
- Create: `src/state/usePersistedReducer.ts`
- Modify: `src/state/VehicleProvider.tsx`

**Interfaces:**
- Consumes: `AppStorage`, `memoryBackend`, `load`, `makeSaver` (Task 3); `defaultPreferences`, `preferencesReducer`, `Preferences` (Task 2); `ControlActionId` (Task 1).
- Produces:
  - `function usePersistedReducer<S, A>(storage, key, initial, reducer): [S, (action: A) => void]`
  - `usePreferences(): { favorites: ControlActionId[]; setFavorite(slotIndex: number, id: ControlActionId): void }`
  - `VehicleProvider` now also provides the preferences context.

- [ ] **Step 1: Write the hook**

Create `src/state/usePersistedReducer.ts`:

```ts
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';

import { load, makeSaver, type AppStorage } from './persistence';

// useReducer + hydrate-from-storage + persist-on-change. Hydrates `key` once on mount (falling back
// to `initial`), then writes the new state (debounced) after every dispatch. `reducer` must be a
// stable reference (module-level function).
export function usePersistedReducer<S, A>(
  storage: AppStorage,
  key: string,
  initial: S,
  reducer: (state: S, action: A) => S,
): [S, (action: A) => void] {
  const [state, setState] = useState<S>(initial);
  const saver = useMemo(() => makeSaver<S>(storage, key), [storage, key]);
  const initialRef = useRef(initial);

  useEffect(() => {
    let cancelled = false;
    void load(storage, key, initialRef.current).then((loaded) => {
      if (!cancelled) {
        setState(loaded);
      }
    });
    return () => {
      cancelled = true;
    };
  }, [storage, key]);

  const dispatch = useCallback(
    (action: A) => {
      setState((current) => {
        const next = reducer(current, action);
        saver(next);
        return next;
      });
    },
    [reducer, saver],
  );

  return [state, dispatch];
}
```

- [ ] **Step 2: Add the preferences context to the provider**

In `src/state/VehicleProvider.tsx`, replace the current import block and provider with the version below (adds `PreferencesContext`, wires `usePersistedReducer`, exports `usePreferences`). Full file:

```tsx
import { createContext, useContext, useMemo, type ReactNode } from 'react';

import { useFleetState, type Fleet } from './useFleetState';
import { usePersistedReducer } from './usePersistedReducer';
import { memoryBackend } from './persistence';
import { defaultPreferences, preferencesReducer } from './preferences';
import type { ControlActionId } from './controlActions';
import type { VehicleActions } from './useVehicleState';
import type { VehicleViewState } from '../types/vehicleTypes';

type VehicleContextValue = [VehicleViewState, VehicleActions];

interface PreferencesApi {
  favorites: ControlActionId[];
  setFavorite: (slotIndex: number, id: ControlActionId) => void;
}

const VehicleContext = createContext<VehicleContextValue | null>(null);
const ActiveIdContext = createContext<string | null>(null);
const FleetContext = createContext<Fleet | null>(null);
const PreferencesContext = createContext<PreferencesApi | null>(null);

// One shared fleet for the whole app. `useVehicle()` returns the ACTIVE car's [state, actions] so
// existing screens are unchanged; `useFleet()` exposes the list + add/remove/select; the Godot
// canvas reads `useActiveVehicleId()` to detect identity switches (vs. field edits). `usePreferences()`
// exposes app-global UI preferences (the customizable favorites bar), persisted via the persistence
// layer (in-memory by default).
export function VehicleProvider({ children }: { children: ReactNode }) {
  const { active, activeId, fleet } = useFleetState();
  const [prefs, dispatch] = usePersistedReducer(
    memoryBackend,
    'prefs.v1',
    defaultPreferences,
    preferencesReducer,
  );

  const preferences = useMemo<PreferencesApi>(
    () => ({
      favorites: prefs.favorites,
      setFavorite: (slotIndex, id) => dispatch({ type: 'setFavorite', slotIndex, id }),
    }),
    [prefs.favorites, dispatch],
  );

  return (
    <FleetContext.Provider value={fleet}>
      <ActiveIdContext.Provider value={activeId}>
        <PreferencesContext.Provider value={preferences}>
          <VehicleContext.Provider value={active}>{children}</VehicleContext.Provider>
        </PreferencesContext.Provider>
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

export function usePreferences(): PreferencesApi {
  const ctx = useContext(PreferencesContext);
  if (!ctx) {
    throw new Error('usePreferences must be used inside <VehicleProvider>');
  }
  return ctx;
}
```

- [ ] **Step 3: Typecheck**

Run: `npx tsc --noEmit`
Expected: PASS — no type errors in `src/state/usePersistedReducer.ts` or `src/state/VehicleProvider.tsx`. (If `tsc` reports pre-existing errors elsewhere, confirm none are in files this plan creates or edits.)

- [ ] **Step 4: Run the full unit suite (sanity)**

Run: `npm test`
Expected: PASS — all of fleet/controlActions/preferences/persistence tests pass.

- [ ] **Step 5: Commit**

```bash
git add src/state/usePersistedReducer.ts src/state/VehicleProvider.tsx
git commit -m "feat(state): usePersistedReducer + preferences context in VehicleProvider"
```

---

### Task 5: Render the Home favorites bar from the catalog

**Files:**
- Modify: `src/screens/HomeScreen.tsx` (imports; the `iconRow` block at lines ~88-98; `QuickIcon`)

**Interfaces:**
- Consumes: `usePreferences` (Task 4), `CONTROL_ACTIONS` (Task 1).
- Produces: no new exports. The 5 favorites are now data-driven; behavior of taps is unchanged for the default set (lock toggles, climate/charging open, frunk toggles, vent toggles windows).

- [ ] **Step 1: Add imports**

In `src/screens/HomeScreen.tsx`, the existing import of the provider is:

```tsx
import { useFleet } from '@/state/VehicleProvider';
```

Change it to also import `usePreferences`, and add the catalog import:

```tsx
import { useFleet, usePreferences } from '@/state/VehicleProvider';
import { CONTROL_ACTIONS } from '@/state/controlActions';
```

- [ ] **Step 2: Read favorites in the component**

Just below the existing `const fleet = useFleet();` line, add:

```tsx
  const { favorites } = usePreferences();
```

- [ ] **Step 3: Replace the hardcoded favorites bar**

Replace this block (the 5 hardcoded `QuickIcon`s):

```tsx
          <View style={styles.iconRow}>
            <QuickIcon
              symbol={state.locked ? 'lock.fill' : 'lock.open.fill'}
              active={!state.locked}
              onPress={() => actions.toggle('locked')}
            />
            <QuickIcon symbol="fanblades.fill" active={state.climateOn} onPress={() => actions.setCameraMode('CLIMATE')} />
            <QuickIcon symbol="bolt.fill" active={state.charging} onPress={() => actions.setCameraMode('CHARGING')} />
            <QuickIcon symbol="car.side.front.open.fill" active={state.frunkOpen} onPress={() => actions.toggle('frunkOpen')} />
            <QuickIcon symbol="wind" active={false} onPress={() => {}} />
          </View>
```

with:

```tsx
          <View style={styles.iconRow}>
            {favorites.map((id) => {
              const action = CONTROL_ACTIONS[id];
              return (
                <QuickIcon
                  key={id}
                  symbol={action.symbol(state)}
                  active={action.isActive(state)}
                  onPress={() => {
                    Haptics.selectionAsync().catch(() => {});
                    action.run(state, actions);
                  }}
                />
              );
            })}
          </View>
```

(`Haptics` is already imported at the top of this file.)

- [ ] **Step 4: Typecheck**

Run: `npx tsc --noEmit`
Expected: PASS — no new type errors.

- [ ] **Step 5: Manual verification**

Launch the app (use the project's `/run` flow or `npm run ios`). On Home:
- The favorites bar shows the same 5 icons as before (lock, fan, bolt, frunk, wind), in order.
- Tapping **lock** flips the glyph open↔closed; **Climate** opens the climate screen; **Charging** opens charging; **Frunk** toggles the frunk on the car; **Vent** lowers/raises the windows.

Expected: identical behavior to before this task, now data-driven.

- [ ] **Step 6: Commit**

```bash
git add src/screens/HomeScreen.tsx
git commit -m "feat(home): render favorites bar from the action catalog + preferences"
```

---

### Task 6: Customize Controls sheet + long-press to open

**Files:**
- Create: `src/components/CustomizeControlsSheet.tsx`
- Modify: `src/screens/HomeScreen.tsx` (sheet visibility state; `onLongPress` on the bar; render the sheet; `QuickIcon` gains `onLongPress`)

**Interfaces:**
- Consumes: `usePreferences`, `useVehicle` (Task 4); `CONTROL_ACTIONS`, `CONTROL_ACTION_ORDER`, `ControlActionId` (Task 1).
- Produces: `CustomizeControlsSheet({ visible, onClose }: { visible: boolean; onClose: () => void })`.

- [ ] **Step 1: Create the sheet component**

Create `src/components/CustomizeControlsSheet.tsx`:

```tsx
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  Animated,
  PanResponder,
  Pressable,
  StyleSheet,
  Text,
  useWindowDimensions,
  View,
  type LayoutRectangle,
} from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { SymbolView } from 'expo-symbols';
import * as Haptics from 'expo-haptics';

import { CONTROL_ACTIONS, CONTROL_ACTION_ORDER, type ControlActionId } from '@/state/controlActions';
import { usePreferences, useVehicle } from '@/state/VehicleProvider';

const TILE = 72; // ghost square size

interface Props {
  visible: boolean;
  onClose: () => void;
}

// Tesla "Customize Controls" sheet. Rises over a dimmed Home; the top row mirrors the 5 favorite
// slots (drop targets), and the grid below holds every other action. Drag a grid tile onto a slot to
// replace it. Drag the grab-handle down (or tap the backdrop) to dismiss. PanResponder throughout —
// RNGH is inert in this app's native tabs.
export function CustomizeControlsSheet({ visible, onClose }: Props) {
  const { height } = useWindowDimensions();
  const insets = useSafeAreaInsets();
  const [state] = useVehicle();
  const { favorites, setFavorite } = usePreferences();

  // Grid = catalog order minus the current favorites → always 11 items.
  const gridItems = CONTROL_ACTION_ORDER.filter((id) => !favorites.includes(id));

  // Keep the sheet mounted through the close animation, then unmount.
  const [mounted, setMounted] = useState(visible);
  const translateY = useRef(new Animated.Value(height)).current;
  const backdropOpacity = useRef(new Animated.Value(0)).current;

  const onCloseRef = useRef(onClose);
  onCloseRef.current = onClose;
  const setFavoriteRef = useRef(setFavorite);
  setFavoriteRef.current = setFavorite;

  const open = useCallback(() => {
    Animated.parallel([
      Animated.spring(translateY, { toValue: 0, useNativeDriver: true, bounciness: 2, speed: 14 }),
      Animated.timing(backdropOpacity, { toValue: 1, duration: 180, useNativeDriver: true }),
    ]).start();
  }, [translateY, backdropOpacity]);

  useEffect(() => {
    if (visible) {
      setMounted(true);
      requestAnimationFrame(open);
    } else if (mounted) {
      Animated.parallel([
        Animated.timing(translateY, { toValue: height, duration: 200, useNativeDriver: true }),
        Animated.timing(backdropOpacity, { toValue: 0, duration: 200, useNativeDriver: true }),
      ]).start(() => setMounted(false));
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [visible, height]);

  // --- drag the grab handle down to dismiss ---
  const handlePan = useRef(
    PanResponder.create({
      onMoveShouldSetPanResponder: (_e, g) => g.dy > 6 && g.dy > Math.abs(g.dx),
      onPanResponderMove: (_e, g) => translateY.setValue(Math.max(0, g.dy)),
      onPanResponderRelease: (_e, g) => {
        if (g.dy > 120 || g.vy > 0.6) {
          onCloseRef.current();
        } else {
          Animated.spring(translateY, { toValue: 0, useNativeDriver: true, bounciness: 2, speed: 14 }).start();
        }
      },
    }),
  ).current;

  // --- drag-and-drop state ---
  const ghost = useRef(new Animated.ValueXY()).current;
  const ghostScale = useRef(new Animated.Value(0)).current;
  const [dragId, setDragId] = useState<ControlActionId | null>(null);
  const [hoverSlot, setHoverSlot] = useState(-1);

  // Slot frames in WINDOW coordinates (so PanResponder's moveX/moveY compare directly). The root view
  // is full-screen at (0,0), so window coords == this component's local coords for the ghost overlay.
  const slotFrames = useRef<LayoutRectangle[]>([]);
  const slotRefs = useRef<(View | null)[]>([]);
  const dragRef = useRef<{ id: ControlActionId | null; hoverSlot: number }>({ id: null, hoverSlot: -1 });

  const measureSlot = useCallback((i: number) => {
    const node = slotRefs.current[i];
    if (node) {
      node.measureInWindow((x, y, width, h) => {
        slotFrames.current[i] = { x, y, width, height: h };
      });
    }
  }, []);

  const hitSlot = useCallback((x: number, y: number) => {
    const frames = slotFrames.current;
    for (let i = 0; i < frames.length; i += 1) {
      const f = frames[i];
      if (f && x >= f.x && x <= f.x + f.width && y >= f.y && y <= f.y + f.height) {
        return i;
      }
    }
    return -1;
  }, []);

  const endDrag = useCallback(() => {
    Animated.timing(ghostScale, { toValue: 0, duration: 120, useNativeDriver: false }).start(() => {
      setDragId(null);
      setHoverSlot(-1);
      dragRef.current = { id: null, hoverSlot: -1 };
    });
  }, [ghostScale]);

  // One PanResponder per action id, built once (closures read live values via refs).
  const tilePans = useMemo(() => {
    const map = {} as Record<ControlActionId, ReturnType<typeof PanResponder.create>>;
    for (const id of CONTROL_ACTION_ORDER) {
      map[id] = PanResponder.create({
        onStartShouldSetPanResponder: () => false,
        onMoveShouldSetPanResponder: (_e, g) => Math.abs(g.dx) > 4 || Math.abs(g.dy) > 4,
        onPanResponderGrant: (e) => {
          const { pageX, pageY } = e.nativeEvent;
          ghost.setValue({ x: pageX - TILE / 2, y: pageY - TILE / 2 });
          dragRef.current = { id, hoverSlot: -1 };
          setDragId(id);
          setHoverSlot(-1);
          Animated.spring(ghostScale, { toValue: 1, useNativeDriver: false, friction: 6 }).start();
          Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Medium).catch(() => {});
        },
        onPanResponderMove: (_e, g) => {
          ghost.setValue({ x: g.moveX - TILE / 2, y: g.moveY - TILE / 2 });
          const slot = hitSlot(g.moveX, g.moveY);
          if (slot !== dragRef.current.hoverSlot) {
            dragRef.current.hoverSlot = slot;
            setHoverSlot(slot);
            if (slot !== -1) {
              Haptics.selectionAsync().catch(() => {});
            }
          }
        },
        onPanResponderRelease: (_e, g) => {
          const slot = hitSlot(g.moveX, g.moveY);
          const draggedId = dragRef.current.id;
          if (slot !== -1 && draggedId) {
            setFavoriteRef.current(slot, draggedId);
            Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success).catch(() => {});
          }
          endDrag();
        },
        onPanResponderTerminate: () => endDrag(),
      });
    }
    return map;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  if (!mounted) {
    return null;
  }

  return (
    <View style={styles.root} pointerEvents="box-none">
      <Animated.View style={[styles.backdrop, { opacity: backdropOpacity }]}>
        <Pressable style={StyleSheet.absoluteFill} onPress={onClose} />
      </Animated.View>

      <Animated.View
        style={[styles.sheet, { paddingBottom: insets.bottom + 16, transform: [{ translateY }] }]}
      >
        <View style={styles.handleWrap} {...handlePan.panHandlers}>
          <View style={styles.handle} />
        </View>

        <Text style={styles.title}>Customize Controls</Text>
        <Text style={styles.subtitle}>Drag to replace</Text>

        <View style={styles.slotsRow}>
          {favorites.map((id, i) => {
            const action = CONTROL_ACTIONS[id];
            return (
              <View
                key={id}
                ref={(n) => {
                  slotRefs.current[i] = n;
                }}
                onLayout={() => measureSlot(i)}
                style={[styles.slot, hoverSlot === i && styles.slotHover]}
              >
                <SymbolView
                  name={action.symbol(state)}
                  tintColor={action.isActive(state) ? 'white' : 'rgba(255,255,255,0.55)'}
                  size={28}
                />
              </View>
            );
          })}
        </View>

        <Text style={styles.dragLabel}>{dragId ? CONTROL_ACTIONS[dragId].label : ' '}</Text>

        <View style={styles.divider} />

        <View style={styles.grid}>
          {gridItems.map((id) => {
            const action = CONTROL_ACTIONS[id];
            const dragging = dragId === id;
            return (
              <View key={id} style={styles.tile} {...tilePans[id].panHandlers}>
                <View style={dragging ? styles.tileIconHidden : undefined}>
                  <SymbolView name={action.symbol(state)} tintColor="rgba(255,255,255,0.92)" size={26} />
                </View>
                <Text style={styles.tileLabel} numberOfLines={1}>
                  {action.label}
                </Text>
              </View>
            );
          })}
        </View>
      </Animated.View>

      {dragId ? (
        <Animated.View
          pointerEvents="none"
          style={[
            styles.ghost,
            {
              transform: [
                { translateX: ghost.x },
                { translateY: ghost.y },
                { scale: ghostScale.interpolate({ inputRange: [0, 1], outputRange: [0.6, 1.25] }) },
              ],
            },
          ]}
        >
          <SymbolView name={CONTROL_ACTIONS[dragId].symbol(state)} tintColor="white" size={32} />
        </Animated.View>
      ) : null}
    </View>
  );
}

const styles = StyleSheet.create({
  root: {
    position: 'absolute',
    top: 0,
    left: 0,
    right: 0,
    bottom: 0,
  },
  backdrop: {
    ...StyleSheet.absoluteFillObject,
    backgroundColor: 'rgba(0,0,0,0.5)',
  },
  sheet: {
    position: 'absolute',
    left: 0,
    right: 0,
    bottom: 0,
    paddingHorizontal: 16,
    paddingTop: 8,
    backgroundColor: '#1C1C1E',
    borderTopLeftRadius: 22,
    borderTopRightRadius: 22,
    borderTopWidth: StyleSheet.hairlineWidth,
    borderTopColor: 'rgba(255,255,255,0.09)',
    shadowColor: '#000',
    shadowOffset: { width: 0, height: -8 },
    shadowOpacity: 0.55,
    shadowRadius: 16,
  },
  handleWrap: {
    alignItems: 'center',
    paddingVertical: 8,
  },
  handle: {
    width: 38,
    height: 5,
    borderRadius: 3,
    backgroundColor: 'rgba(255,255,255,0.32)',
  },
  title: {
    fontSize: 20,
    fontWeight: '700',
    color: 'white',
    textAlign: 'center',
    marginTop: 4,
  },
  subtitle: {
    fontSize: 14,
    color: 'rgba(255,255,255,0.5)',
    textAlign: 'center',
    marginTop: 2,
  },
  slotsRow: {
    flexDirection: 'row',
    justifyContent: 'space-around',
    alignItems: 'center',
    marginTop: 20,
  },
  slot: {
    width: 56,
    height: 56,
    borderRadius: 14,
    alignItems: 'center',
    justifyContent: 'center',
  },
  slotHover: {
    backgroundColor: 'rgba(255,255,255,0.14)',
  },
  dragLabel: {
    height: 18,
    fontSize: 13,
    color: 'rgba(255,255,255,0.6)',
    textAlign: 'center',
    marginTop: 6,
  },
  divider: {
    height: StyleSheet.hairlineWidth,
    backgroundColor: 'rgba(255,255,255,0.12)',
    marginTop: 8,
    marginBottom: 4,
  },
  grid: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    marginTop: 8,
  },
  tile: {
    width: '25%',
    alignItems: 'center',
    paddingVertical: 16,
    gap: 8,
  },
  tileIconHidden: {
    opacity: 0,
  },
  tileLabel: {
    fontSize: 13,
    color: 'rgba(255,255,255,0.6)',
    paddingHorizontal: 2,
  },
  ghost: {
    position: 'absolute',
    top: 0,
    left: 0,
    width: TILE,
    height: TILE,
    alignItems: 'center',
    justifyContent: 'center',
  },
});
```

- [ ] **Step 2: Add `onLongPress` to `QuickIcon`**

In `src/screens/HomeScreen.tsx`, replace the `QuickIcon` function:

```tsx
function QuickIcon({ symbol, active, onPress }: { symbol: SFSymbol; active: boolean; onPress: () => void }) {
  return (
    <Pressable style={styles.quickIcon} onPress={onPress} hitSlop={8}>
      <SymbolView name={symbol} tintColor={active ? 'white' : 'rgba(255,255,255,0.45)'} size={28} />
    </Pressable>
  );
}
```

with:

```tsx
function QuickIcon({
  symbol,
  active,
  onPress,
  onLongPress,
}: {
  symbol: SFSymbol;
  active: boolean;
  onPress: () => void;
  onLongPress?: () => void;
}) {
  return (
    <Pressable style={styles.quickIcon} onPress={onPress} onLongPress={onLongPress} delayLongPress={300} hitSlop={8}>
      <SymbolView name={symbol} tintColor={active ? 'white' : 'rgba(255,255,255,0.45)'} size={28} />
    </Pressable>
  );
}
```

- [ ] **Step 3: Wire the sheet into HomeScreen**

In `src/screens/HomeScreen.tsx`:

(a) Add the imports near the other imports:

```tsx
import { CustomizeControlsSheet } from '@/components/CustomizeControlsSheet';
```

(b) Add visibility state + an open handler in the component body, just after `const { favorites } = usePreferences();`:

```tsx
  const [customizing, setCustomizing] = useState(false);
  const openCustomize = () => {
    Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Medium).catch(() => {});
    setCustomizing(true);
  };
```

(`useState` is already imported in this file — it imports `{ useRef, useState }` from 'react').

(c) Add `onLongPress` to the bar. The `iconRow` container `View` gets an enclosing `Pressable` for long-press, and each `QuickIcon` also forwards `onLongPress`. Replace the favorites bar block from Task 5:

```tsx
          <View style={styles.iconRow}>
            {favorites.map((id) => {
              const action = CONTROL_ACTIONS[id];
              return (
                <QuickIcon
                  key={id}
                  symbol={action.symbol(state)}
                  active={action.isActive(state)}
                  onPress={() => {
                    Haptics.selectionAsync().catch(() => {});
                    action.run(state, actions);
                  }}
                />
              );
            })}
          </View>
```

with:

```tsx
          <Pressable onLongPress={openCustomize} delayLongPress={300} style={styles.iconRow}>
            {favorites.map((id) => {
              const action = CONTROL_ACTIONS[id];
              return (
                <QuickIcon
                  key={id}
                  symbol={action.symbol(state)}
                  active={action.isActive(state)}
                  onPress={() => {
                    Haptics.selectionAsync().catch(() => {});
                    action.run(state, actions);
                  }}
                  onLongPress={openCustomize}
                />
              );
            })}
          </Pressable>
```

(d) Render the sheet. Add it just before the closing `</View>` of the root view (after the `</SafeAreaView>` that holds the header):

```tsx
      <CustomizeControlsSheet visible={customizing} onClose={() => setCustomizing(false)} />
```

- [ ] **Step 4: Typecheck**

Run: `npx tsc --noEmit`
Expected: PASS — no new type errors.

- [ ] **Step 5: Manual verification**

Launch the app. On Home:
- **Long-press** anywhere on the favorites bar → the sheet slides up over a dimmed Home, titled "Customize Controls" / "Drag to replace", showing the 5 current favorites on top and an 11-item grid (Bioweapon Defense, Flash, Honk, Light Show, Low Power, Start, Sentry, Summon, Trunk, Unlatch Door, HomeLink) below.
- **Drag** a grid tile (e.g. Flash) onto a slot: a lifted icon follows the finger, the target slot highlights, the action name shows under the slots, and on release the slot's icon becomes the dropped action. The favorites bar on Home reflects the change after closing.
- The displaced action reappears in the grid; the grid stays 11 items.
- **Tap the backdrop** or **drag the handle down** dismisses the sheet.
- A short tap on a favorite still fires its action (long-press and tap don't conflict).

- [ ] **Step 6: Commit**

```bash
git add src/components/CustomizeControlsSheet.tsx src/screens/HomeScreen.tsx
git commit -m "feat(home): Customize Controls sheet with drag-and-drop favorites"
```

---

### Task 7: Verification & icon polish

**Files:**
- Modify (only if a glyph fails to render): `src/state/controlActions.ts`

**Interfaces:** none.

- [ ] **Step 1: Run the full unit suite**

Run: `npm test`
Expected: PASS — fleet, controlActions, preferences, persistence suites all green.

- [ ] **Step 2: Typecheck the whole project**

Run: `npx tsc --noEmit`
Expected: PASS — no type errors in any file created/edited by this plan.

- [ ] **Step 3: On-device icon audit**

Launch the app and open the Customize Controls sheet. Visually confirm **every** grid tile and every favorite slot renders a real SF Symbol (no empty box / missing-glyph placeholder). Pay special attention to: `car.side.rear.open.fill` (Trunk), `record.circle.fill` (Sentry), `door.left.hand.open` (Unlatch Door), `globe.americas.fill` (Light Show), `battery.25` (Low Power), `house.fill` (HomeLink), `microbe` (Bioweapon Defense).

If any glyph is missing on the device's SF Symbols version, replace that single `symbol: () => '...'` in `src/state/controlActions.ts` with a close, confirmed alternative (e.g. Sentry → `smallcircle.filled.circle`; Trunk → `car.rear.fill`; Light Show → `sparkles`), then rebuild the JS and re-check.

- [ ] **Step 4: End-to-end flow check**

Confirm the full acceptance flow on device: long-press opens the sheet → drag two different actions into two different slots → close → the Home favorites bar shows both new actions and they fire on tap. Switch vehicles (swipe) and re-open: favorites are unchanged (global), and each action's active tint reflects the now-active car.

- [ ] **Step 5: Commit any icon fixes**

```bash
git add src/state/controlActions.ts
git commit -m "fix(controls): swap any unrendered SF Symbols for verified glyphs"
```

(Skip this commit if Step 3 found no issues.)

---

## Self-Review

**Spec coverage:**
- Long-press → sheet → drag-drop flow → Task 6. ✓
- 16-action catalog incl. HomeLink + Bioweapon (`microbe`) → Task 1. ✓
- Always-11-item grid (catalog − favorites) → Task 1 (order) + Task 6 (filter). ✓
- Global favorites preference slice + swap/replace reducer → Task 2. ✓
- Generic persistence infra, in-memory default, AsyncStorage-deferred, JS-only → Task 3 + Task 4 (note: spec's single `persistence.ts` is split into pure `persistence.ts` + React `usePersistedReducer.ts` to keep the test import free of React; documented here). ✓
- Provider wiring `usePreferences()` → Task 4. ✓
- Home favorites bar from catalog → Task 5. ✓
- PanResponder drag (RNGH inert), ghost + slot highlight + hit-test, haptics → Task 6. ✓
- Reducer + persistence unit tests; manual device verification incl. icon audit → Tasks 1-3, 5-7. ✓
- Out of scope (AsyncStorage enablement, ControlsScreen refactor, persisting other slices, reordering within bar) → not implemented, as intended. ✓

**Placeholder scan:** No TBD/TODO/"handle edge cases"/"similar to Task N". Every code step has full code; the one conditional step (Task 7 Step 5) names concrete fallback glyphs. ✓

**Type consistency:** `ControlActionId`, `CONTROL_ACTIONS`, `CONTROL_ACTION_ORDER`, `DEFAULT_FAVORITES`, `setFavoriteSlot`, `preferencesReducer`, `defaultPreferences`, `Preferences`, `AppStorage`, `memoryBackend`, `load`, `makeSaver`, `usePersistedReducer`, `usePreferences`, `CustomizeControlsSheet` are defined once and referenced with identical names/signatures across tasks. The provider's `setFavorite(slotIndex, id)` matches the sheet's call site and the reducer's `{ type:'setFavorite', slotIndex, id }` action. ✓
