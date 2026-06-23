# Multi-Vehicle Support — Design

**Date:** 2026-06-23
**Status:** Approved (initial scope)
**Branch context:** `phase4/engine-embed`

## Goal

Rearchitect the app from a single hardcoded car into a **fleet** of vehicles, behaving like
the official Tesla app:

- Multiple vehicles, each of any model (S / 3 / X / Y), each with its **own independent state**
  (doors, windows, climate, charging, lights, camera, appearance, etc.).
- On the Home screen, **swipe left/right** to switch the active vehicle.
- The **Explore** tab gains controls to **add / remove** vehicles and select the active one.
- Initial state: a single Model Y named **"Red Velvet"** (today's car). With one car, swiping
  does nothing.

## Hard Constraint That Shapes The Design

There is exactly **one live Godot render surface** (`ExpoGodotView` + one `GodotRendererBridge`).
It renders **one car at a time**; switching the rendered car means re-issuing `SHOW_PRODUCT`
(the same mechanism the current Explore "Car model" switcher uses). The native module exposes
**no frame-capture API** — only `sendMessageToGodot` + the `onGodotMessage` event — and capturing
the live GLES2 surface to an image is unreliable on iOS. The iOS Godot 3.2 ↔ GLES2 path is known to
be fragile around touch/camera mutation (orbit is disabled for this reason).

**Consequence:** we cannot show two live cars simultaneously, and we cannot snapshot a car that was
never rendered. Therefore the swipe transition is built so that **the revealed car is always the
live engine render** (so it shows its real state), and **no image capture is ever required**.

## Swipe Transition: slide-out → swap-while-hidden → slide-in

1. Viewing car A (live engine, real state).
2. User drags horizontally: the `Animated.View` wrapping `ExpoGodotView` translates with the
   finger — car A slides toward the edge in its real state. No capture; it is already live.
3. On release **past threshold**: car A finishes sliding off-screen → **while off-screen**, the
   bridge applies car B's **full real state** → the view repositions to the opposite (incoming) edge
   → slides into center. To keep the reveal consistent the bridge should be told to re-apply the
   incoming car as a fresh product: `SHOW_PRODUCT` when B is a **different model**, and at minimum
   `UPDATE_PRODUCT` + lights/markers refresh when B is the **same model** as A. The plan should
   decide whether to force `SHOW_PRODUCT` on every active-vehicle switch (simplest, always-clean
   reveal) or branch on model equality (cheaper for same-model switches).
4. Car B is now centered and live, showing its **actual** doors/windows/charging/etc.
5. On release **under threshold**: car A slides back to center, no swap.

This satisfies the requirement that a revealed car appears in its real state (e.g. a second car
with open doors slides in with open doors). It differs from a literal two-cars-visible carousel only
in that you do not see both cars side-by-side mid-drag — acceptable, because the revealed car is
fully real, which is the property that matters.

**Implementation risk + fallback:** translating the live GL view's layer is expected to be safe (a
layer transform does not fire `onLayout`, so it does not re-boot or re-frame the engine). If it
proves janky on device, fall back to a **directional cross-fade** using the same off-screen
`SHOW_PRODUCT` swap logic with less motion. This fallback is a presentation-only change; the data
flow is identical.

## Data Model

A fleet of vehicles, each carrying its own full state:

```ts
interface Vehicle {
  id: string;              // unique, generated (e.g. "veh_1")
  name: string;            // "Red Velvet" (initial Y), "Model 3", "Model X (2)", …
  state: VehicleViewState; // existing per-car state, unchanged in shape
}
```

- `VehicleViewState` keeps its current shape **including `carModel`**. The only change in meaning:
  `carModel` is now **fixed per vehicle** (set at creation, never mutated). The adapter/bridge that
  read `state.carModel` (`vehicleConfigs[state.carModel]`, `vehicleIdForModel`) therefore need **no
  changes**.
- Add one field to `VehicleViewState`: `batteryLevel: number` (default `48`), so each car shows its
  own percentage in the Home header instead of the hardcoded `48%`. Default added to
  `initialVehicleState`.
- A **new** car inherits the active car's `theme` and `lightingMode` (appearance stays consistent
  app-wide), and otherwise starts from `initialVehicleState` with `carModel` set to the chosen model.

## State Store (core refactor)

Replace the single-car `useVehicleState` with a fleet store while preserving the existing consumer
contract.

- New `useFleetState()` owns `{ vehicles: Vehicle[]; activeId: string }`.
- `useVehicle()` continues to return **the active car's `[state, actions]`**, so every existing
  consumer works unchanged: `HomeScreen`, `ClimateScreen`, `ControlsScreen`, `VehicleCanvas`, and the
  Explore demo controls. `actions.toggle / patch / setCameraMode / cycleSeatClimate / …` mutate the
  **active** vehicle's state.
- New `useFleet()` hook exposes fleet-level data + actions:
  - `vehicles`, `activeId`, `activeIndex`, `activeName`
  - `addVehicle(model: CarModel)`, `removeVehicle(id: string)`, `setActiveVehicle(id: string)`
  - `nextVehicle()`, `prevVehicle()`
- `VehicleProvider` provides both contexts (active `[state, actions]` and the fleet).

The active-car actions are implemented by updating `vehicles[activeIndex].state` immutably (the
existing reducer logic moves from "the one state" to "the active vehicle's state").

## Home Screen Changes (`src/screens/HomeScreen.tsx`, `src/app/index.tsx`)

- Header car name: replace hardcoded `"Red Velvet"` with `activeName` from `useFleet()`.
- Battery: replace hardcoded `48%` with `state.batteryLevel`.
- **Page dots** under the header showing N cars + active index. Rendered only when
  `vehicles.length > 1`.
- **Horizontal Pan gesture** (react-native-gesture-handler) over the car band with
  `activeOffsetX ≈ ±20` and `failOffsetY` so the vertical menu `ScrollView` keeps scrolling. Swipe
  left → `nextVehicle()`, swipe right → `prevVehicle()`, driving the slide transition. With a single
  car the gesture does not activate (no-op / rubber-band).
- The car-translation animation wraps `ExpoGodotView` in `index.tsx` / `VehicleCanvas` in an
  `Animated.View` whose `translateX` is driven by the gesture and the commit animation.

## Explore Tab Changes (`src/app/explore.tsx`)

- New **"Your Vehicles"** section at the top:
  - List of cars: name + model badge, active one highlighted; tap a row to select it (sets active).
  - **＋ Add**: pick S / 3 / X / Y → appends a new car with fresh default state for that model and an
    auto-generated, de-duplicated name.
  - **Remove** affordance per car, **disabled when only one car remains**.
- **Remove** the existing in-place "Car model" segmented control (model is now fixed per car at
  add-time; switching a car's model no longer exists).
- The existing demo controls (vehicle state, closures, windows, climate, charging, lights, app
  state, appearance) stay and now drive the **active** car.

## Naming

- Initial car: `"Red Velvet"` (Model Y).
- Added cars: friendly base name per model — `"Model S"`, `"Model 3"`, `"Model X"`, `"Model Y"`.
- Duplicates de-dup with a suffix: `"Model 3"`, then `"Model 3 (2)"`, `"Model 3 (3)"`, …

## Edge Cases

- The last remaining car cannot be removed (Remove disabled at `vehicles.length === 1`).
- Removing the **active** car selects a neighbor (previous if it exists, else next) as active.
- Selecting a car in Explore updates the active car; Home reflects it (and slides if Home is the
  current view).
- Add `GestureHandlerRootView` at the app root in `src/app/_layout.tsx` (required for
  react-native-gesture-handler). Low-risk wrapper addition.

## Out Of Scope (YAGNI for this iteration)

- Persistence across app restarts (in-memory only; fleet resets to the single Model Y on relaunch —
  matches current behavior, no storage layer exists today).
- Per-car custom naming via text input (auto-named only).
- Two-cars-visible-mid-drag carousel (precluded by the single live engine).
- Native GL frame capture.
- Wiring the header name chevron to a vehicle picker (swipe + dots cover switching). The chevron
  retains its current behavior.

## Files Touched (anticipated)

- `src/types/vehicleTypes.ts` — add `batteryLevel` to `VehicleViewState` + `initialVehicleState`.
- `src/state/useVehicleState.ts` → fleet store (`useFleetState`, active-car actions, fleet actions).
- `src/state/VehicleProvider.tsx` — provide active `[state, actions]` + `useFleet()`.
- `src/screens/HomeScreen.tsx` — name, battery, page dots from fleet.
- `src/app/index.tsx` / `src/godot/VehicleCanvas.tsx` — swipe gesture + car-translation animation +
  off-screen `SHOW_PRODUCT` swap on commit.
- `src/app/explore.tsx` — "Your Vehicles" manager; remove "Car model" switcher.
- `src/app/_layout.tsx` — `GestureHandlerRootView` root wrapper.
- `src/godot/GodotRendererBridge.ts` — drive the swap from an active-vehicle change. Today it
  re-issues `SHOW_PRODUCT` only on `carModel` change and otherwise diffs via
  `hasVehicleVisualStateChanged` → `UPDATE_PRODUCT`. Add an explicit "switch to this vehicle's full
  state" entry point so a same-model switch still cleanly applies the incoming car's state (doors,
  lights, markers) during the off-screen swap.
