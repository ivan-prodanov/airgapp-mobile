# De-hardcode the car: first-run onboarding & a persisted fleet

**Date:** 2026-10-16
**Status:** Design approved (conversational); spec pending user review.

## Intent

Today the app boots straight into a hardcoded car. The initial fleet is re-seeded
fresh on every launch with a single fixed vehicle, and the enrolled car's VIN is
stapled onto it. We want the opposite: a fresh install starts empty and the user
**adds** their car — a real Tesla paired over BLE, or a demo car — and the fleet is
remembered across launches.

**Audience:** distribution-quality. Someone who is not the author, on a fresh
device, must be able to set up their own car. No assumptions about a specific VIN
or keys. Stays airgapped: pure BLE + local storage, never Tesla's servers.

**Success:**
- Fresh install → onboarding, not a hardcoded car.
- User pairs their real Tesla (VIN → connect → tap key card) and/or adds a demo car.
- Added cars — real and demo — persist across launches with their names, appearance,
  order, and which one was active.
- Removing the last car returns to onboarding.
- No "Red Velvet" (or any fixed seed car) remains in the code.

## Current state (what we're changing)

- [`createInitialFleet()`](../../../src/state/fleet.ts) returns one hardcoded vehicle
  (`veh_1` "Red Velvet", no VIN). [`useFleetState`](../../../src/state/useFleetState.ts)
  does `useState(createInitialFleet)` — **the fleet is never persisted**; demo cars added
  via the Cars sheet are lost on restart.
- The real car's identity+keys **are** persisted: `EnrolledCars { cars: CarConfig[],
  selectedVin }` in the OS Keychain via [`secureStoreSecretStore`](../../../src/ble/secureStoreSecretStore.ts),
  with `addCar`/`removeCar`/`selectCar`/`loadEnrolledCars` in [`config.ts`](../../../src/ble/config.ts).
- At boot, [useFleetState.ts:193](../../../src/state/useFleetState.ts) binds the persisted
  `selectedVin` onto `vehicles[0]` — the VIN gets stapled onto the fixed placeholder.
- Appearance (`carModel`, `exteriorColor`, `wheelType`, `interiorTrim`) is **never set by
  telemetry and never cached** — it is purely local presentation state. Defaults:
  `carModel: 'modelY'`, colors/wheels/trim `null` ([vehicleTypes](../../../src/types/vehicleTypes.ts)).
- The pairing mechanics already exist, used by the dev console [`carlink.tsx`](../../../src/app/carlink.tsx):
  `loadOrCreateDeviceKeys` → `transport.enrollPublicKey(pubkey)` (a one-shot VCSEC
  "present key" message, [`bleEnroll.ts`](../../../src/ble/bleEnroll.ts)) → the operator
  **taps an existing NFC key card on the console** to approve → poll `paired`.
- The demo configurator already exists: [`CarsSheet`](../../../src/components/CarsSheet.tsx)'s
  Add Car (model line / body gen / seats / color / wheels / interior trim / name,
  `resolveCarModel(base, body, seats)`).

### What a VIN can and cannot tell us

A real car's appearance cannot be derived. The VIN encodes the **model line**
(S/3/X/Y) and that is all we can use offline. Body generation is only a hint
(mid-model-year refreshes). Color, wheels, interior trim, seat count, and
trim/performance are build options Tesla keeps server-side and does not report over
BLE. The official app knows them only because it reads `vehicle_config` from the
cloud account — which we never touch. So a real car's appearance is user-chosen,
exactly like a demo car's; only the model line is inferred.

## Design

### 1. Data model & persistence — two stores, reconciled at boot

Keep `EnrolledCars` (Keychain) as the **source of truth for real cars' identity +
keys**, untouched. Add one new **non-secret** store for presentation, matching the
existing AsyncStorage-per-VIN convention used by `carLinkCache`/`schedules`/
`securityStore`.

**New file `src/state/fleetStore.ts`** — AsyncStorage, key `fleet.v1`:

```ts
interface PersistedFleet {
  version: 1;
  order: PersistedVehicle[];     // display order
  activeId: string | null;
}
interface PersistedVehicle {
  id: string;                    // stable 'veh_N'
  name: string;
  vin?: string;                  // present ⇒ this row IS a real (enrolled) car
  config: {                      // appearance, for BOTH real and demo cars
    carModel: CarModel;
    exteriorColor: string | null;
    wheelType: string | null;
    interiorTrim: string | null;
    performance: boolean;
  };
}
```

Appearance config is stored for **every** vehicle, real and demo alike — a real car
is simply a configured car that also has a `vin`. `carLinkCache` continues to
rehydrate only dynamic telemetry (battery, climate, doors, odometer); it never held
appearance.

`fleetStore` exposes `loadPersistedFleet()`, `savePersistedFleet(f)`, and a pure
`toPersisted(fleet: FleetState): PersistedFleet` / `fromPersisted(...)` pair for
serialization. A missing/corrupt read returns `null` (treated as "no persisted
fleet" — a new install, or a pre-this-change install).

### 2. `reconcileFleet` — the one seam (pure)

**New pure function `reconcileFleet(persisted: PersistedFleet | null, enrolled:
EnrolledCars): FleetState`**, unit-tested in isolation:

1. Start from `persisted.order` (empty if `persisted` is null).
2. Drop any row with a `vin` **not** present in `enrolled.cars` (the car was
   wiped/forgotten) — keep its demo siblings.
3. Append any `enrolled` car **not** already listed by VIN (e.g. paired out-of-band
   via `carlink.tsx` or a deep link), materialized with default appearance
   (`carModel` from `vinToModelLine` if known, else `modelY`; colors/wheels/trim
   `null`) and a default name (the model's base name).
4. Build each `Vehicle`'s `state` from `initialVehicleState` + the row's `config`
   (reusing the existing `defaultStateForModel`-style merge), and bind `vin` where
   present.
5. `activeId` = `persisted.activeId` if that vehicle survived, else the first
   vehicle, else `null`.

An empty result (no persisted rows, no enrolled cars) ⇒ a zero-vehicle fleet ⇒ the
app shows onboarding.

**Upgrade/migration behavior (important):** an existing install (e.g. the author's
phone) has `EnrolledCars` populated but no `fleet.v1` yet. On first boot after this
change, `reconcileFleet(null, enrolled)` appends the enrolled car from step 3 — so
the real car survives the upgrade and the user is **not** dumped into onboarding.
Its appearance resets to Model Y defaults (same as the old hardcoded placeholder)
and the old hardcoded name "Red Velvet" is lost (it was never persisted); the user
can rename it.

### 3. Boot, hydration & empty-state gating

- `createInitialFleet()` → returns **empty**: `{ vehicles: [], activeId: null }`.
- Secure/AsyncStorage are async, so `useFleetState` gains a `hydrated: boolean`.
  Start empty; an effect loads `EnrolledCars` + `fleetStore`, runs `reconcileFleet`,
  `setFleet`, sets `hydrated = true`.
- A `persist` effect writes `toPersisted(fleet)` whenever `hydrated && fleet`
  changes (add / remove / rename / reorder / select / VIN-bind).
- **Gating** at the app entry ([`src/app/index.tsx`](../../../src/app/index.tsx) /
  [`_layout.tsx`](../../../src/app/_layout.tsx)):
  - `!hydrated` → a minimal splash (no car-flash, no onboarding-flash).
  - `hydrated && vehicles.length === 0` → `/onboarding` (new route).
  - else → home.
- Remove the blind staple at [useFleetState.ts:193](../../../src/state/useFleetState.ts):
  VIN binding now happens inside `reconcileFleet` by VIN match, not onto `vehicles[0]`.
- **Active ↔ selectedVin:** selecting a **real** car calls `selectCar(vin)` so the
  gateway/`useCarLink` target it. Selecting a **demo** car leaves `selectedVin`
  unchanged (so passive entry keeps targeting the last real car while a demo is on
  screen); the demo active car simply reports `activeIsLive = false`.
- Guard `activeVehicle`/`activeIndex` ([fleet.ts](../../../src/state/fleet.ts)) to
  tolerate an empty fleet (return `undefined`/`-1`); callers already run only post-gate.

### 4. Onboarding + pairing wizard — new `src/app/onboarding.tsx`

A new expo-router route, added to the Stack. Welcome screen offers **"Pair your
Tesla"** and **"Add a demo car."** Also reachable later as "Add car" from the Cars
sheet (same component, not gated on empty).

**Pair flow** (reuses the proven `carlink.tsx` calls; clean wizard UI, extracted
step state machine):

1. **Enter VIN** — validate with `isValidVin`; hint on where to find it.
2. **Connect** — scan by VIN (the car is found by its VIN-derived iBeacon via
   `DirectBleTransport`). Handle not-found (move closer / Bluetooth off) with retry.
3. **Present key** — `loadOrCreateDeviceKeys` → `transport.enrollPublicKey(pubkey)` →
   instruct **"Tap your key card on the center console now"** → poll `paired` (≤60s)
   with retry.
4. **Appearance** — the **shared `CarsSheet` configurator** (see §5), model-line
   picker locked to `vinToModelLine(vin)`.
5. **Finish** — `addCar(vin)` + `selectCar(vin)`, write the vehicle (with `vin` +
   appearance) into the fleet/`fleetStore`, navigate home with it active.

Errors at each step are surfaced inline with retry; cancel returns to welcome
(nothing is created on an aborted pair). The Pi forwarder (remote relay,
`parseEnrolUrl`) is **out of the core wizard** — an optional item in settings later.
`carlink.tsx` stays as the hidden dev console, unchanged.

### 5. Shared appearance configurator

Reuse [`CarsSheet`](../../../src/components/CarsSheet.tsx)'s configurator verbatim as
the appearance step for **both** demo and real cars. For a real car:

- **New pure helper `vinToModelLine(vin): BaseModel | null`** — Tesla VIN char 4 →
  `S`→modelS line, `3`→model3, `X`→modelX, `Y`→modelY; unknown/future WMI → `null`.
  Unit-tested.
- When a model line is inferred, the **model-line (base) picker is locked** (shown
  with its value and a subtle "from your VIN" hint), not editable.
- **Body generation is prefilled with a best guess but stays editable** — the VIN's
  model-year is unreliable at refresh boundaries, so we never lock a possibly-wrong
  body onto the car.
- Everything else — **color, wheels, interior trim, seats, name** — is editable;
  none of it is in the VIN.
- A `null` inference (unknown VIN) leaves the model picker editable, defaulting to
  Model Y as today.

Demo path = the same configurator with nothing locked.

### 6. Demo-add path

"Add a demo car" opens the shared configurator → `addVehicle(model, opts)` →
persist → home. No `vin`. Minimal new code (the configurator already exists).

### 7. Teardown / remove

Extend [`confirmRemoveVehicle`](../../../src/components/confirmRemoveVehicle.tsx)
wiring: a demo car → drop from the fleet + persist; a real car → `removeCar(vin)`
(forget locally, matching today's `clearCarConfig` semantics — no BLE un-enroll
from the car) + drop + persist. Removing the **last** car empties the fleet → the
gate returns the app to onboarding.

### 8. Empty-fleet safety

Post-gate, home only renders with ≥1 car, but add defensive guards so pre-hydration
and the empty fleet never crash: do not drive Godot (`SHOW_PRODUCT`) with no active
car; the onboarding route renders no `VehicleCanvas`.

## Non-goals (scope guards)

- No multi-key / key-role management, no removing this phone's key *from* the car.
- No Pi forwarder in onboarding (optional settings item later).
- No account/cloud anything — stays airgapped (BLE + local storage only).
- No automatic appearance detection beyond the VIN model line.
- No reordering UI beyond what exists; stored order is simply insertion order.

## Risks & constraints

- **Async hydration flicker.** The splash-until-hydrated gate must cover both the
  home and onboarding branches, or the wrong screen flashes on launch.
- **Effect ordering.** `reconcileFleet` must populate the fleet (and VIN binding)
  before `useCarLink` resolves the live car; `selectedVin` from `EnrolledCars`
  should already agree with the active real car at boot.
- **Migration.** Verify an existing enrolled install materializes its car (§2) and
  does not land in onboarding.
- **Pairing is physical.** Step 3 depends on the user tapping an NFC key card at the
  car; the wizard must tolerate the 60s poll and offer retry, not assume success.

## Testing

Pure-unit tests (mirroring [`fleet.test.ts`](../../../src/state/fleet.test.ts)):

- `fleetStore`: `toPersisted`/`fromPersisted` round-trip; missing/corrupt read → `null`;
  version handling.
- `reconcileFleet`: every case — empty; demo-only; real-only; mixed order preserved;
  enrolled-not-listed (append/materialize); listed-not-enrolled (drop); active
  missing → falls back; upgrade (`null` persisted + enrolled present).
- `vinToModelLine`: each line char, unknown char, invalid length (guarded by caller).
- Fleet mutations persist (add/remove/rename/select) and removing the last car empties.
- Pairing **step state machine** extracted as a pure reducer; unit-tested with
  `memorySecretStore` + a fake transport (BLE mocked) — no real BLE in tests.

Source-scan invariant test: no hardcoded seed car / "Red Velvet" remains, and
`createInitialFleet` returns empty.

Manual on-device: fresh install → pair (tap card) → home; add demo; restart →
both persist; switch active persists; remove last → onboarding; upgrade an enrolled
install → car materializes, no onboarding.

## Touched files (indicative)

- **New:** `src/state/fleetStore.ts`, `src/state/reconcileFleet.ts` (+ tests),
  `src/ble/vinDecode.ts` (`vinToModelLine`, + test), `src/app/onboarding.tsx` (+ pair
  wizard components and its reducer + test).
- **Changed:** `src/state/fleet.ts` (`createInitialFleet` → empty; empty-fleet guards),
  `src/state/useFleetState.ts` (hydration, persist effect, VIN bind via reconcile,
  `selectCar` on select, remove → `removeCar`), `src/app/index.tsx` /
  `src/app/_layout.tsx` (splash + gate + onboarding route), `src/components/CarsSheet.tsx`
  (configurator accepts a locked model line; shared with onboarding),
  `src/components/confirmRemoveVehicle.tsx` wiring, `src/state/useCarLink.ts` (drop the
  `vehicles[0]` VIN assumption if needed).
