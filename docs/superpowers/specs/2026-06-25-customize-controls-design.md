# Customize Controls (Favorites Drag-and-Drop) — Design

**Date:** 2026-06-25
**Status:** Approved
**Branch context:** `phase4/engine-embed`

## Goal

Reproduce the official Tesla app's **Customize Controls** flow for the Home screen's
favorites bar (the 5 quick-action icons under the car render):

- **Long-press** the favorites bar → a bottom sheet rises ("**Customize Controls** / Drag to
  replace"), dimming Home behind it.
- The sheet shows the **5 current favorites as drop-target slots** (top), a divider, then a
  **grid of all the other actions** (Bioweapon Defense, Flash, Honk, Light Show, Low Power, Start,
  Sentry, Summon, Trunk, Unlatch Door, Vent, HomeLink, …).
- **Drag** a grid action onto a slot — a lifted "ghost" icon follows the finger and the target slot
  highlights — **release to replace**. The displaced action returns to the grid.
- Tap the backdrop (or drag the sheet down) to dismiss. Haptics on long-press-open and on drop.

Visual target = the three reference screenshots from the official app (favorites row + "Drag to
replace" caption + labelled action grid + mid-drag lifted tile with highlighted target slot).

## Scope decisions (from brainstorming)

- **Interaction:** true drag-and-drop, matching the official app (not tap-to-swap).
- **Action set:** match the screenshots — real handlers where the app's state supports it, harmless
  stub handlers (haptic only) otherwise. Plus a **HomeLink** action.
- **Persistence:** set up **generic persistence infrastructure now**, defaulting to a
  zero-native-dependency backend so this feature ships **JS-only** (no `xcodebuild` rebuild). Real
  cross-restart persistence (AsyncStorage) is a deferred flip, see §4.
- **Favorites are account-global** (like Tesla), not per-vehicle.
- ControlsScreen refactor to consume the new catalog is **out of scope** (see Out Of Scope).

## Hard Constraint That Shapes The Design

Per project memory, **react-native-gesture-handler gestures are inert inside the native tabs** in
this app — the proven pattern is React Native's core `PanResponder` (used for the swipe-to-switch
and edge-back gestures). Therefore the drag-and-drop is built on `PanResponder` + `Animated`, **not**
RNGH. Long-press to open uses `Pressable.onLongPress` (core press system, unaffected).

The icon library is **`expo-symbols` (SF Symbols) only** — no `@expo/vector-icons`. Every action
icon must be an SF Symbol name. `microbe` (Bioweapon) is already proven in `ClimateScreen.tsx`.

## 1. Action Catalog — `src/state/controlActions.ts` (new)

The app has no central action registry today; actions are hardcoded in `HomeScreen.tsx` /
`ControlsScreen.tsx`. This introduces one. `HomeScreen`'s favorites bar becomes the first consumer.

```ts
export type ControlActionId =
  | 'lock' | 'climate' | 'charging' | 'frunk' | 'trunk' | 'vent'
  | 'flash' | 'honk' | 'lightShow' | 'lowPower' | 'start' | 'sentry'
  | 'summon' | 'unlatchDoor' | 'bioweapon' | 'homelink';

export interface ControlActionDef {
  id: ControlActionId;
  label: string;                                  // grid label, e.g. "Light Show"
  symbol: (s: VehicleViewState) => SFSymbol;      // dynamic so lock ↔ unlock can swap glyphs
  isActive: (s: VehicleViewState) => boolean;     // white (active) vs dimmed in the bar
  run: (s: VehicleViewState, a: VehicleActions) => void;
}

export const CONTROL_ACTIONS: Record<ControlActionId, ControlActionDef>;
export const CONTROL_ACTION_ORDER: ControlActionId[];   // stable grid ordering
export const DEFAULT_FAVORITES: ControlActionId[] = ['lock', 'climate', 'charging', 'frunk', 'vent'];
```

**16 actions total.** Favorites are always 5 → the grid always shows the other **11**, a stable
3×4 layout with no scrolling.

| id | label | symbol | active? | run |
|----|-------|--------|---------|-----|
| `lock` | Lock | `lock.fill` / `lock.open.fill` | `!locked` | `toggle('locked')` |
| `climate` | Climate | `fanblades.fill` | `climateOn` | `setCameraMode('CLIMATE')` |
| `charging` | Charging | `bolt.fill` | `charging` | `setCameraMode('CHARGING')` |
| `frunk` | Frunk | `car.side.front.open.fill` | `frunkOpen` | `toggle('frunkOpen')` |
| `trunk` | Trunk | `car.side.rear.open.fill` † | `trunkOpen` | `toggle('trunkOpen')` |
| `vent` | Vent | `wind` | any window open | toggle 4 window flags (cf. `ClimateScreen.toggleVent`) |
| `sentry` | Sentry | `record.circle` † | `sentryEnabled` | `toggle('sentryEnabled')` |
| `unlatchDoor` | Unlatch Door | `door.left.hand.open` † | `driverFrontDoorOpen` | `toggle('driverFrontDoorOpen')` |
| `flash` | Flash | `headlight.low.beam` | momentary (false) | brief headlight blink (set `headlightsOn` true→false) |
| `honk` | Honk | `horn.fill` | false | haptic only |
| `start` | Start | `key.radiowaves.forward.fill` | false | haptic only |
| `summon` | Summon | `steeringwheel` | false | haptic only |
| `lightShow` | Light Show | `sparkles` † | false | haptic only |
| `lowPower` | Low Power | `battery.25` † | false | haptic only |
| `bioweapon` | Bioweapon Defense | `microbe` | false | haptic only |
| `homelink` | HomeLink | `house.fill` | false | haptic only |

† **Unproven SF Symbol names** (`car.side.rear.open.fill`, `record.circle`, `door.left.hand.open`,
`sparkles`, `battery.25`). The implementation plan must include a **device verification pass**:
render every catalog icon and confirm none fall back to the SF Symbols "missing glyph". Swap any
that don't resolve. All other names are already used elsewhere in the repo and are known-good.

Momentary actions (`isActive` always false) fire a haptic on tap and otherwise no-op — matching the
"match the screenshots / stubs otherwise" decision.

## 2. Favorites State — `src/state/preferences.ts` (new)

Favorites are an app-level UI preference, kept **out of per-vehicle `VehicleViewState`** so they're
global (Tesla-like) and don't bloat the fleet reducer.

```ts
export interface Preferences {
  favorites: ControlActionId[];   // length 5
}
export const defaultPreferences: Preferences = { favorites: DEFAULT_FAVORITES };

// Pure reducer. Drops `id` into slot `slotIndex`. If `id` already occupies another slot, the two
// slots SWAP (defensive — keeps favorites duplicate-free). Otherwise the slot's previous action is
// simply replaced (and, because the grid is computed as catalog − favorites, it reappears there).
export function setFavoriteSlot(prefs: Preferences, slotIndex: number, id: ControlActionId): Preferences;
```

Unit-tested (`src/state/preferences.test.ts`) alongside the existing `fleet.test.ts` `node --test`
setup: replace into an empty-of-that-id slot, swap when the id is already favorited, no-op when
dropping an id onto the slot it already occupies, out-of-range slot index is ignored.

## 3. Persistence Infra — `src/state/persistence.ts` (new)

Generic, storage-agnostic infrastructure (the "infra now, persist everything later" ask). Nothing
in it is favorites-specific.

```ts
export interface AppStorage {
  getItem(key: string): Promise<string | null>;
  setItem(key: string, value: string): Promise<void>;
}

export const memoryBackend: AppStorage;          // DEFAULT — in-process Map, no native module
// export const asyncStorageBackend: AppStorage; // ready-to-enable, requires the native dep + rebuild

export async function load<T>(storage: AppStorage, key: string, fallback: T): Promise<T>;
export function makeSaver<T>(storage: AppStorage, key: string): (value: T) => void; // debounced ~300ms

// React glue: hydrate `key` on mount, expose [state, dispatch], persist on every change.
export function usePersistedReducer<S, A>(
  storage: AppStorage, key: string, initial: S, reducer: (s: S, a: A) => S,
): [S, (action: A) => void];
```

- **Default backend = `memoryBackend`** → zero native dependencies, feature ships JS-only. Favorites
  survive in-session (and re-renders) but reset on relaunch — acceptable since persistence is an
  explicitly future goal.
- **Enabling real persistence later** = `npm i @react-native-async-storage/async-storage`, swap the
  backend constant, one native rebuild. Because `load`/`makeSaver`/`usePersistedReducer` are
  generic, persisting other slices (full fleet state, theme, etc.) later is "pass another key
  through the same helpers" — no new infra. JSON (de)serialization is centralized here; corrupt/old
  payloads fall back to the provided default rather than throwing.

## 4. Provider wiring — `src/state/VehicleProvider.tsx` (edit)

Extend the existing provider tree with a preferences context (no new top-level provider component to
wire in `_layout.tsx`):

- Add `PreferencesContext` providing `{ favorites: ControlActionId[]; setFavorite(slotIndex, id) }`.
- Back it with `usePersistedReducer(memoryBackend, 'prefs', defaultPreferences, preferencesReducer)`
  where the reducer dispatches to `setFavoriteSlot`.
- Export `usePreferences()` (throws outside the provider, matching `useVehicle` / `useFleet`).

## 5. The Sheet — `src/components/CustomizeControlsSheet.tsx` (new)

Self-contained overlay component. Props: `{ visible: boolean; onClose: () => void }`. Reads
`usePreferences()` + the active `useVehicle()` state for rendering icons.

Structure (mirrors the screenshots):

- **Backdrop:** absolute full-screen dim (`rgba(0,0,0,~0.5)`), `Pressable` → `onClose`.
- **Sheet:** bottom-anchored `Animated.View` (same construction as `ClimateScreen`'s sheet — rounded
  top, hairline border, top shadow, `#1C1C1E` tone). Slides up on `visible` via `Animated.spring`
  on `translateY`; slides down then calls `onClose` on dismiss. A vertical `PanResponder` on a grab
  handle supports drag-down-to-close (drag past threshold → close; else spring back).
- **Title block:** "Customize Controls" (centered, bold) + "Drag to replace" (muted subtitle).
- **Slots row:** the 5 favorites rendered from `favorites` through the catalog (icon only, active
  tint from `isActive`). Each slot view records its on-screen frame `{x,y,w,h}` (measured **relative
  to the sheet** via `onLayout` / `measureInWindow`) into a `slotFrames` ref for hit-testing.
- **Divider.**
- **Grid:** the **11** actions = `CONTROL_ACTION_ORDER` filtered to those **not** in `favorites`,
  laid out 3 rows × 4 (icon + label, label tint muted like the screenshots). Fixed — no ScrollView,
  so hit-testing needs no scroll-offset math.

### Drag-and-drop mechanics

Each grid tile owns a `PanResponder`:

- `onMoveShouldSetPanResponder`: claim when moved > ~4px in any direction (a pure tap does nothing).
- **On grant:** capture the tile's `ControlActionId` + start point; show an absolutely-positioned
  **ghost** (`Animated.ValueXY`) — an enlarged copy of the tile's icon — following the finger; haptic.
- **On move:** update the ghost position; continuously hit-test the finger against `slotFrames` and
  set a `hoverSlot` index → the hovered slot renders a highlighted rounded background (screenshot 3).
- **On release:** if over a slot, `setFavorite(hoverSlot, draggedId)` + success haptic, animate the
  ghost into the slot; else animate the ghost back to its grid origin. Clear drag state. The grid
  re-renders (the dropped id leaves it; the displaced id re-enters it).
- `onPanResponderTerminate`: same as a miss (ghost returns home).

Because favorites count is invariant (5) and grid = catalog − favorites (11), no empty slots or
variable grid heights ever occur.

## 6. Home Screen Integration — `src/screens/HomeScreen.tsx` (edit)

- Replace the hardcoded 5 `QuickIcon`s (`lines 88–98`) with
  `favorites.map((id) => <QuickIcon … />)`, pulling `symbol`/`active`/`onPress` from
  `CONTROL_ACTIONS[id]` (`onPress = () => run(state, actions)`).
- `QuickIcon` gains an optional `onLongPress`; the whole `iconRow` opens the sheet on long-press
  (long-press on the row container + passthrough on each icon) with an open haptic.
- Local `useState` for sheet visibility; render `<CustomizeControlsSheet visible … onClose … />` as
  an overlay above the scrim and below the fixed header.

## Edge Cases

- Long-press must not also fire the icon's `onPress` (rely on RN's press system: a recognized
  long-press cancels the tap).
- Dropping onto no slot (released over the grid / outside) = cancel, no state change.
- Dropping a grid item onto the slot whose action it would duplicate cannot happen (grid excludes
  favorited ids), but `setFavoriteSlot` is defensive anyway.
- Opening the sheet, switching vehicles underneath: favorites are global, so the slot/grid contents
  are vehicle-independent; only the per-action `isActive` tint reflects the active car. Acceptable.
- In-memory backend: relaunch resets favorites to `DEFAULT_FAVORITES`. Documented, intended.

## Testing

- `setFavoriteSlot` pure-reducer unit tests (replace / swap / no-op / out-of-range) via `node --test`.
- `persistence` round-trip test against `memoryBackend` (save → load returns value; missing key →
  fallback; corrupt JSON → fallback).
- Manual on-device verification (`/verify` or `/run`): long-press opens sheet; drag a grid action
  onto a slot replaces it; ghost + slot highlight render; favorites update live in the Home bar;
  **every catalog icon resolves to a real SF Symbol** (no missing-glyph boxes).

## Out Of Scope (YAGNI)

- Enabling the AsyncStorage backend / the native rebuild (infra is built and ready; flip later).
- Persisting anything beyond favorites (infra supports it; not wired this iteration).
- Refactoring `ControlsScreen.tsx` (Flash/Honk/Start/Vent) to consume the new catalog — leave as is
  to keep the diff focused; can follow up.
- Reordering favorites within the bar (screenshots only show grid → slot replacement).
- Per-action long-press detail panels (HomeLink config, Summon UI, etc.).

## Files Touched (anticipated)

- `src/state/controlActions.ts` — **new** action catalog + `DEFAULT_FAVORITES`.
- `src/state/preferences.ts` — **new** `Preferences`, `defaultPreferences`, `setFavoriteSlot`.
- `src/state/preferences.test.ts` — **new** reducer tests.
- `src/state/persistence.ts` — **new** generic storage infra (`AppStorage`, `memoryBackend`,
  `load`, `makeSaver`, `usePersistedReducer`).
- `src/state/persistence.test.ts` — **new** round-trip tests (optional but recommended).
- `src/state/VehicleProvider.tsx` — **edit** add `PreferencesContext` + `usePreferences()`.
- `src/components/CustomizeControlsSheet.tsx` — **new** the bottom sheet + drag-and-drop.
- `src/screens/HomeScreen.tsx` — **edit** favorites bar from catalog + long-press to open sheet.
