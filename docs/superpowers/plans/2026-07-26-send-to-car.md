# Send to Car Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Replace the client-side trip planner with a single `Send to Car` button that sends one destination (title + coordinate) to the car.

**Architecture:** The send path already exists — `fleet.sendNavigation` builds `NavigationGpsDestinationRequest` (f106) at `order = REPLACE`. This work is therefore ~80% deletion: the trip model, its four state modules, two components, the trip mode inside `location.tsx`, and all 599 lines of the native share popup. What gets built is small: one pure title-resolution function, one shared button, and a decode of the car's `actionStatus` so a rejected send stops looking like a successful one.

**Tech Stack:** TypeScript / React Native (Expo SDK 56), Swift (Share Extension + Expo native modules), protobuf over BLE, `node:test` for unit tests.

## Global Constraints

- Spec: `docs/superpowers/specs/2026-07-26-send-to-car-design.md`. Read it before Task 1.
- **Message is f106 only** (`NavigationGpsDestinationRequest`), `order = REPLACE` (`NAV_ORDER.REPLACE`, wire value 0). f21 is dropped; do not reintroduce prepend/append.
- **No wake before sending.** Verified on-car: sends land on a sleeping car.
- **No route-state detection anywhere.** `DriveState`'s active-route fields are unreadable while the car is locked; nothing in the UI may branch on them.
- Tests are `node:test` + `node:assert/strict`, run with `npm test`. Test files sit beside their source as `*.test.ts`.
- Pure logic modules must have **no React Native imports** so they stay node-testable.
- Typecheck with `npx tsc --noEmit -p tsconfig.json` — it must be clean before every commit.
- JS/TS changes deploy with `bash scripts/godot-ios/deploy-js.sh`. Native/Swift changes and dependency removal need a full Release `xcodebuild`.
- Commit after every task. Do not squash tasks together.

---

### Task 1: Destination title resolution

The label we send is what appears on the car's screen. Today a long-pressed pin is the literal string `'Dropped Pin'` (`location.tsx:347`) and the Google-body share path passes `name: nil` outright (`SharedLocationResolver.swift:37`) — so the current code would send "Dropped Pin" to the car as a destination name. One pure function, applied at the send boundary, fixes every call site at once.

**Files:**
- Create: `src/services/destinationTitle.ts`
- Test: `src/services/destinationTitle.test.ts`

**Interfaces:**
- Consumes: nothing.
- Produces: `destinationTitle(input: TitleInput): string` and `interface TitleInput { name?: string | null; address?: string | null; coordinate: { latitude: number; longitude: number } }`. Task 3 calls this.

- [ ] **Step 1: Write the failing test**

Create `src/services/destinationTitle.test.ts`:

```typescript
import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

import { destinationTitle, isPlaceholderTitle } from './destinationTitle.ts';

const coord = { latitude: 42.6977, longitude: 23.3219 };

describe('destinationTitle', () => {
  it('prefers a real name', () => {
    assert.equal(destinationTitle({ name: 'Kaufland Mladost', address: 'ul. Andrey Saharov 1', coordinate: coord }), 'Kaufland Mladost');
  });

  it('falls back to the address when there is no name', () => {
    assert.equal(destinationTitle({ address: 'ul. Andrey Saharov 1', coordinate: coord }), 'ul. Andrey Saharov 1');
  });

  it('falls back to the coordinate when there is neither', () => {
    assert.equal(destinationTitle({ coordinate: coord }), '42.6977, 23.3219');
  });

  it('never sends a display placeholder as a destination name', () => {
    // "Dropped Pin" in the car's route list is worse than a coordinate, which at
    // least says where it is.
    assert.equal(destinationTitle({ name: 'Dropped Pin', coordinate: coord }), '42.6977, 23.3219');
    assert.equal(destinationTitle({ name: 'dropped pin', address: 'ul. Filip Avramov 1', coordinate: coord }), 'ul. Filip Avramov 1');
    assert.equal(destinationTitle({ name: 'Location', coordinate: coord }), '42.6977, 23.3219');
    assert.equal(destinationTitle({ name: 'Shared Location', coordinate: coord }), '42.6977, 23.3219');
  });

  it('treats blank and whitespace-only strings as absent', () => {
    assert.equal(destinationTitle({ name: '   ', address: '', coordinate: coord }), '42.6977, 23.3219');
  });

  it('trims surrounding whitespace off a real title', () => {
    assert.equal(destinationTitle({ name: '  Lidl  ', coordinate: coord }), 'Lidl');
  });

  it('collapses newlines in a multi-line address into one line', () => {
    // Apple postal addresses arrive multi-line; the car shows a single row.
    assert.equal(
      destinationTitle({ address: 'ul. Filip Avramov 1\n1000 Sofia\nBulgaria', coordinate: coord }),
      'ul. Filip Avramov 1, 1000 Sofia, Bulgaria',
    );
  });

  it('exposes the placeholder check for callers that want to warn', () => {
    assert.equal(isPlaceholderTitle('Dropped Pin'), true);
    assert.equal(isPlaceholderTitle('Kaufland'), false);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `node --import tsx --test "src/services/destinationTitle.test.ts"`
Expected: FAIL — `Cannot find module './destinationTitle.ts'`

- [ ] **Step 3: Write minimal implementation**

Create `src/services/destinationTitle.ts`:

```typescript
// destinationTitle — what we put in NavigationGpsDestinationRequest.destination,
// i.e. the text the car shows in its route list.
//
// Applied at the SEND boundary rather than at each of the four call sites (pin,
// POI, search result, charger), so there is exactly one place this can go wrong.
//
// The placeholder filter is the point of this module. Several sources synthesise
// a label purely so the UI has something to draw — a long-pressed pin starts as
// 'Dropped Pin' and only improves if reverse-geocoding happens to succeed. Those
// strings are fine on our own map and useless in a car's route list, so they are
// treated as ABSENT and we fall through to something that actually locates the
// place. "42.6977, 23.3219" tells you where you are going; "Dropped Pin" does not.
//
// No React Native imports — node-testable.

export interface TitleInput {
  name?: string | null;
  address?: string | null;
  coordinate: { latitude: number; longitude: number };
}

// Labels our own UI invents for display. Compared case-insensitively after
// trimming. Keep this list in sync with the strings the screens synthesise.
const PLACEHOLDERS = new Set(['dropped pin', 'location', 'shared location', 'unknown location', 'pin']);

export function isPlaceholderTitle(s: string): boolean {
  return PLACEHOLDERS.has(s.trim().toLowerCase());
}

// A usable title, or null. Blank/whitespace-only and placeholder strings are
// both "absent" as far as the fallback chain is concerned.
function usable(s: string | null | undefined): string | null {
  if (!s) return null;
  // Apple postal addresses are multi-line; the car shows a single row.
  const flat = s.replace(/\s*\n\s*/g, ', ').trim();
  if (!flat) return null;
  if (isPlaceholderTitle(flat)) return null;
  return flat;
}

export function destinationTitle({ name, address, coordinate }: TitleInput): string {
  return (
    usable(name) ??
    usable(address) ??
    `${coordinate.latitude.toFixed(4)}, ${coordinate.longitude.toFixed(4)}`
  );
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `node --import tsx --test "src/services/destinationTitle.test.ts"`
Expected: PASS, 8 tests.

- [ ] **Step 5: Typecheck and commit**

```bash
npx tsc --noEmit -p tsconfig.json
git add src/services/destinationTitle.ts src/services/destinationTitle.test.ts
git commit -m "feat(nav): destinationTitle — one fallback chain for the label we send

The label goes on the car's screen. A long-pressed pin is the literal string
'Dropped Pin' until reverse-geocoding improves it, and the Google-body share path
never sets a name at all — so today's code would send 'Dropped Pin' to the car as
a destination. Placeholders are now treated as absent and we fall through to the
address, then the coordinate, which at least says where you are going."
```

---

### Task 2: Make the car's reported state honest — `actionStatus` + `activeRoute` clearing

`runAction` returns `ok: true` whenever the ROUTABLE-layer `signedMessageStatus.operationStatus` is 0 (`gateway.ts:450`). That is the transport saying "I delivered it" — not the car saying "I did it". The application-layer verdict lives in `Response.actionStatus { result, result_reason.plain_text }`, and **nothing in this codebase has ever read it**. That is why an on-car send that failed and one that worked both logged `ACK ok`.

Scope is deliberately narrow: attach the decoded status to the outcome and log it for every command, but only let it flip `ok` for **navigation** commands. Other commands may be returning `ERROR` today in ways the app tolerates; flipping those globally would produce new user-visible failures with no evidence behind them. The logs from this task are that evidence.

**Files:**
- Modify: `src/ble/gateway.ts` (the `CommandOutcome` type at :77, and the success return inside `runAction` at :450)
- Modify: `src/ble/telemetry.ts` (the `activeRoute` patch), `src/ble/telemetry.test.ts`
- Create: `src/ble/carActionStatus.ts`
- Test: `src/ble/carActionStatus.test.ts`

**Interfaces:**
- Consumes: nothing.
- Produces: `parseCarActionStatus(payload: Uint8Array | null | undefined): CarActionStatus | null` where `interface CarActionStatus { ok: boolean; reason: string | null }`. `CommandOutcome`'s success arm gains `carStatus?: CarActionStatus`.

- [ ] **Step 1: Write the failing test**

Create `src/ble/carActionStatus.test.ts`:

```typescript
import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

import { parseCarActionStatus } from './carActionStatus.ts';
import { Response as CarServerResponse, encodeMessage } from './proto.ts';

const encode = (actionStatus: unknown) => encodeMessage(CarServerResponse, { actionStatus });

describe('parseCarActionStatus', () => {
  it('reads OK with no reason', () => {
    assert.deepEqual(parseCarActionStatus(encode({ result: 0 })), { ok: true, reason: null });
  });

  it('reads ERROR and carries the car’s own reason text', () => {
    // This is the field that would have said "no results found" on the sends we
    // logged as "ACK ok".
    const bytes = encode({ result: 1, resultReason: { plainText: 'no results found' } });
    assert.deepEqual(parseCarActionStatus(bytes), { ok: false, reason: 'no results found' });
  });

  it('reads ERROR with no reason text', () => {
    assert.deepEqual(parseCarActionStatus(encode({ result: 1 })), { ok: false, reason: null });
  });

  it('treats an absent actionStatus as no information, not as success', () => {
    assert.equal(parseCarActionStatus(encodeMessage(CarServerResponse, {})), null);
  });

  it('returns null for a missing payload rather than throwing', () => {
    assert.equal(parseCarActionStatus(null), null);
    assert.equal(parseCarActionStatus(undefined), null);
  });

  it('returns null for undecodable bytes rather than throwing', () => {
    // A decode failure must never take down a command that otherwise succeeded.
    assert.equal(parseCarActionStatus(new Uint8Array([0xff, 0xff, 0xff, 0xff])), null);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `node --import tsx --test "src/ble/carActionStatus.test.ts"`
Expected: FAIL — `Cannot find module './carActionStatus.ts'`

- [ ] **Step 3: Write minimal implementation**

Create `src/ble/carActionStatus.ts`:

```typescript
// carActionStatus — the CAR's verdict on a command, as opposed to the transport's.
//
// runAction reports ok:true when the routable-layer signedMessageStatus says the
// frame was delivered and accepted for processing. That is not the same claim as
// "the car did what you asked". CarServer answers with
// Response.actionStatus { result: OK|ERROR, result_reason.plain_text }, and until
// now nothing in this codebase read it — which is why an on-car navigation send
// that the car REJECTED and one that worked produced byte-identical logs.
//
// Returns null when there is nothing to report (no payload, no actionStatus,
// undecodable bytes). Null means "no information", NOT "success" — the caller
// must not treat it as a pass.

import { Response as CarServerResponse, decodeMessage } from './proto';

export interface CarActionStatus {
  ok: boolean;
  reason: string | null;
}

// OperationStatus_E: 0 = OK, 1 = ERROR (car_server.proto:315).
export function parseCarActionStatus(payload: Uint8Array | null | undefined): CarActionStatus | null {
  if (!payload || payload.length === 0) return null;
  try {
    const resp = decodeMessage(CarServerResponse, payload) as {
      actionStatus?: { result?: number; resultReason?: { plainText?: string } };
    };
    const st = resp.actionStatus;
    if (!st || st.result === undefined) return null;
    return { ok: st.result === 0, reason: st.resultReason?.plainText ?? null };
  } catch {
    // A decode problem is our failure to understand the reply, not the car
    // failing the command. Never let it turn a good command into a bad one.
    return null;
  }
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `node --import tsx --test "src/ble/carActionStatus.test.ts"`
Expected: PASS, 6 tests.

- [ ] **Step 5: Add `carStatus` to the outcome type**

In `src/ble/gateway.ts`, change the success arm of `CommandOutcome` (line 78) from:

```typescript
  | { ok: true; attempts: number }
```

to:

```typescript
  | { ok: true; attempts: number; carStatus?: CarActionStatus }
```

and add the import near the other `./` imports:

```typescript
import { parseCarActionStatus, type CarActionStatus } from './carActionStatus';
```

Also re-export the type from `src/ble/index.ts`, beside the existing `CommandOutcome` export on line 15:

```typescript
export type { CarActionStatus } from './carActionStatus';
```

- [ ] **Step 6: Populate it, and fail navigation commands the car rejected**

In `src/ble/gateway.ts`, replace the success return inside `runAction` (currently at :450):

```typescript
        // opStatus 0 (or absent) is success — the car ACK'd the command.
        if (opStatus === 0 || opStatus === undefined) {
          return { outcome: { ok: true, attempts: attempt }, result };
        }
```

with:

```typescript
        // opStatus 0 (or absent) means the ROUTABLE layer accepted the frame. It
        // does NOT mean the car carried the command out — that verdict is in
        // CarServer's Response.actionStatus, which we decode here.
        if (opStatus === 0 || opStatus === undefined) {
          const carStatus = parseCarActionStatus(result.decryptedPayload);
          if (carStatus && !carStatus.ok) {
            logw('gateway', 'car rejected command', { label, reason: carStatus.reason });
          }
          // Only NAVIGATION is failed on the car's verdict for now. Other commands
          // may be returning ERROR today in ways the app tolerates silently, and
          // flipping all of them at once would invent user-visible failures with
          // no evidence behind them. The log line above is how we gather that
          // evidence; widen this once we know what it says.
          const isNav = label.startsWith('navigate');
          if (isNav && carStatus && !carStatus.ok) {
            return {
              outcome: {
                ok: false,
                kind: 'fault',
                fault: 0,
                faultName: 'carRejected',
                message: `[${label}] the car rejected it${carStatus.reason ? `: ${carStatus.reason}` : ''}`,
              },
              result,
            };
          }
          return { outcome: { ok: true, attempts: attempt, carStatus: carStatus ?? undefined }, result };
        }
```

Note: `runCommand` passes `cmd.type` as the label, so `navigateTo` matches `label.startsWith('navigate')`.

If `logw` is not already imported in `gateway.ts`, check the existing logger import at the top of the file and use whatever `logi`/`logw` binding is already there.

- [ ] **Step 7: Verify nothing regressed**

Run: `npx tsc --noEmit -p tsconfig.json`
Expected: no output.

Run: `npm test`
Expected: all tests pass (743+ at time of writing), no failures.

- [ ] **Step 8: Fix the never-cleared `activeRoute`**

Separate latent bug in the same area — the car's reported state being wrong. `telemetry.ts` sets `patch.activeRoute` only when a route is present, so a route that ended stays in memory for the rest of the session. Nothing renders it today and nothing will after this work, but it is wrong and the fix is three lines. Leaving it would hand a landmine to whoever next tries to read route state.

In `src/ble/telemetry.ts`, find (in `infotainmentToPatch`):

```typescript
  if (snap.route) {
    patch.activeRoute = {
      destination: snap.route.destination,
      minutesToArrival: snap.route.minutesToArrival,
      milesToArrival: snap.route.milesToArrival,
    };
  }
```

Replace with:

```typescript
  // Emit null, don't omit. Omitting leaves the PREVIOUS route in state forever:
  // once set, a route that has since ended never clears for the rest of the
  // session. Only emit when the drive slice was actually read — an absent
  // driveState means "we did not ask", not "there is no route".
  if (snap.drive) {
    patch.activeRoute = snap.route
      ? {
          destination: snap.route.destination,
          minutesToArrival: snap.route.minutesToArrival,
          milesToArrival: snap.route.milesToArrival,
        }
      : null;
  }
```

- [ ] **Step 9: Test the clearing**

Add to `src/ble/telemetry.test.ts`, beside the existing `'drive: active route -> activeRoute patch; no route -> omitted'` test — and rename that test, since its stated behaviour is what we are changing:

```typescript
test('drive: a route that ends CLEARS activeRoute instead of leaving the old one', () => {
  // The bug this guards: patch.activeRoute was only ever set, never cleared, so a
  // route that finished stayed in state for the rest of the session.
  const ended = parseCarServerResponse({ driveState: { activeRouteDestination: '' } });
  assert.equal(infotainmentToPatch(ended).activeRoute, null);
});

test('drive: an unread driveState leaves activeRoute untouched', () => {
  // "We did not ask" is not "there is no route" — omitting is correct here.
  assert.equal(infotainmentToPatch(parseCarServerResponse({})).activeRoute, undefined);
});
```

Run: `node --import tsx --test "src/ble/telemetry.test.ts"`
Expected: PASS. The pre-existing `no route -> omitted` assertion now fails and must be updated to expect `null`.

- [ ] **Step 10: Commit**

```bash
git add src/ble/carActionStatus.ts src/ble/carActionStatus.test.ts src/ble/gateway.ts src/ble/index.ts src/ble/telemetry.ts src/ble/telemetry.test.ts
git commit -m "feat(ble): read Response.actionStatus — the car's verdict, not the transport's

runAction reported ok:true off the routable-layer status, which only says the
frame was delivered. The car's own answer lives in actionStatus {result,
result_reason.plain_text} and nothing here has ever read it — which is why an
on-car nav send the car REJECTED and one that worked logged identically.

Decoded for every command and logged; only navigation is failed on it for now,
because other commands may return ERROR in ways the app already tolerates and
flipping them together would invent failures with no evidence. The log is how we
get that evidence.

Also fixes a latent bug in the same area: patch.activeRoute was only ever set,
never cleared, so a route that ended stayed in state for the whole session."
```

---

### Task 3: The `Send to Car` button

**Files:**
- Create: `src/components/SendToCarButton.tsx`
- Create: `src/hooks/useSendToCar.ts`

**Interfaces:**
- Consumes: `destinationTitle` + `TitleInput` (Task 1); `useFleet()` from `@/state/VehicleProvider`; `controlHaptic()` from `@/state/controlHaptic`.
- Produces: `useSendToCar(): (target: SendTarget) => void` where `interface SendTarget { name?: string | null; address?: string | null; coordinate: { latitude: number; longitude: number } }` (structurally identical to `TitleInput`), and `<SendToCarButton target={...} onSent={...} />`. Tasks 4 and 6 use both. NOTE: there is no `insetBottom` prop — the component handles the home-indicator inset itself with `SafeAreaView edges={['bottom']}`, exactly as the three bars it replaces do.

- [ ] **Step 1: Write the hook**

Create `src/hooks/useSendToCar.ts`:

```typescript
import { useCallback } from 'react';

import { useFleet } from '@/state/VehicleProvider';
import { controlHaptic } from '@/state/controlHaptic';
import { destinationTitle, type TitleInput } from '@/services/destinationTitle';

export type SendTarget = TitleInput;

// One place a destination leaves the app for the car. Every screen that can show
// a place routes through this, so the title rules and the haptic are identical
// everywhere.
//
// Fire-and-forget by design: no wake (verified on-car — sends land on a sleeping
// car) and no route-state check (the active-route fields are unreadable while the
// car is locked, which is whenever you would use this).
//
// DELIBERATELY SILENT ON SUCCESS. The haptic is the immediate feedback; there is
// no "Sent X to the car" toast. Task 2 made navigation fail on the car's OWN
// actionStatus rather than on the transport ACK, so a rejection now surfaces
// through the shared failure toast with the car's reason — and a success toast
// fired at tap time would be claiming an outcome we do not yet know, then being
// contradicted a moment later. Silence on success, the truth on failure.
export function useSendToCar(): (target: SendTarget) => void {
  const fleet = useFleet();
  return useCallback(
    (target: SendTarget) => {
      const title = destinationTitle(target);
      controlHaptic();
      fleet.sendNavigation(target.coordinate.latitude, target.coordinate.longitude, title);
    },
    [fleet],
  );
}
```

- [ ] **Step 2: Write the button**

Create `src/components/SendToCarButton.tsx`:

```typescript
import { Pressable, StyleSheet, Text, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { SymbolView } from 'expo-symbols';

import { useSendToCar, type SendTarget } from '@/hooks/useSendToCar';

// The single action on any place: the dropped pin, a tapped POI, a search result,
// a charger.
//
// It says "Send to Car" and not "Navigate" deliberately. With a route already
// running, f106 REPLACE drops a tappable pin on the centre screen instead of
// rerouting — and we cannot detect which of those two will happen, because route
// state is unreadable while the car is locked. "Send to Car" is true either way;
// "Navigate" would be a lie in one of them.
export function SendToCarButton({ target, onSent }: { target: SendTarget; onSent?: () => void }) {
  const send = useSendToCar();
  return (
    <SafeAreaView edges={['bottom']} style={styles.bar} pointerEvents="box-none">
      <View style={styles.row}>
        <Pressable
          style={({ pressed }) => [styles.button, { opacity: pressed ? 0.75 : 1 }]}
          onPress={() => {
            send(target);
            onSent?.();
          }}
        >
          <SymbolView name="arrow.turn.up.right" tintColor="white" size={17} weight="semibold" />
          <Text style={styles.label}>Send to Car</Text>
        </Pressable>
      </View>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  bar: { position: 'absolute', left: 0, right: 0, bottom: 0 },
  row: { flexDirection: 'row', paddingHorizontal: 16, paddingBottom: 10, gap: 10 },
  button: {
    flex: 1,
    height: 50,
    borderRadius: 25,
    backgroundColor: '#0A84FF',
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 8,
  },
  label: { color: 'white', fontSize: 17, fontWeight: '600' },
});
```

- [ ] **Step 3: Verify it compiles**

Run: `npx tsc --noEmit -p tsconfig.json`
Expected: no output. (Nothing imports these yet — that is Task 4.)

- [ ] **Step 4: Commit**

```bash
git add src/components/SendToCarButton.tsx src/hooks/useSendToCar.ts
git commit -m "feat(nav): SendToCarButton + useSendToCar — the single place a destination leaves

Named 'Send to Car' rather than 'Navigate' on purpose: with a route already
running f106 REPLACE drops a tappable pin instead of rerouting, and we cannot
detect which will happen because route state is unreadable while the car is
locked. The chosen label is true in both cases."
```

---

### Task 4: Strip trip mode out of `location.tsx`

The one task where the app is broken mid-flight, so it is a single task and ends with a manual run. `location.tsx` goes from ~1257 lines to roughly 750.

**Files:**
- Modify: `src/app/location.tsx`

**Interfaces:**
- Consumes: `SendToCarButton` (Task 3).
- Produces: a `location.tsx` with no reference to any trip module. Task 5 deletes those modules and will fail to typecheck if anything was missed.

- [ ] **Step 1: Remove the trip imports**

Delete these import lines from the top of `src/app/location.tsx`:

```typescript
import { useTrip } from '@/state/useTrip';
import { carStop, straightLineLegs, tripTotals, uid, type TripStop } from '@/state/trip';
import { useTripRoute } from '@/state/useTripRoute';
import { TripSheet, TRIP_SHEET_FRAC, type TripSheetHandle, type TripRowAction } from '@/components/TripSheet';
import { TripRowMenu } from '@/components/TripRowMenu';
import { loadTripSnapshotFrom } from '@/state/tripSnapshot';
```

Add:

```typescript
import { SendToCarButton } from '@/components/SendToCarButton';
```

- [ ] **Step 2: Remove the trip state and handlers**

Delete every one of these from the component body. Each is listed with the marker to search for:

- `const trip = useTrip();`
- `const [screen, setScreen] = useState<'search' | 'trip'>('search');`
- `const [tripEditing, setTripEditing] = useState(false);`
- `const tripSheetRef = useRef<TripSheetHandle>(null);`
- `const [pendingInsert, setPendingInsert] = useState<number | null>(null);` (search `pendingInsert`)
- `const [rowMenu, setRowMenu] = useState(...)` and `openRowMenu`
- the `useEffect` that calls `loadTripSnapshotFrom`
- the `useEffect` that calls `SharedIntake.setSavedTrip` / `setSavedCar`
- `onSendTripToCar`, `onTripRowAction`, `onAddChargerToTrip`, `startNewTrip`, `onNewTripFromPin`, `onTripCancel`
- `const tripRoute = useTripRoute(...)`, `tripLegs`, `tripTotalsVal`
- the `useEffect` that calls `fitToCoordinates` for the trip
- `formatDuration` (only the trip footer used it — confirm with a grep before deleting)

- [ ] **Step 3: Replace the sheet switch**

Find the `droppedPin ? … : screen === 'trip' && trip.trip ? <TripSheet …/> : <LocationSheet …/>` block and reduce it to two arms:

```tsx
      {droppedPin ? (
        <PlacePreviewSheet pin={droppedPin} onClose={dismissDroppedPin} />
      ) : (
        <LocationSheet
          ref={sheetRef}
          tab={tab}
          onTabChange={setTab}
          chargers={listChargers}
          availability={availability}
          sort={sort}
          onSortChange={setSort}
          filter={filter}
          onFilterChange={setFilter}
          selectedCharger={selectedCharger}
          onSelectCharger={onSelectCharger}
          onCloseDetail={onCloseDetail}
          onNavigateCharger={onNavigateToCharger}
          query={nav.query}
          onChangeQuery={nav.setQuery}
          results={nav.results}
          recentGroups={nav.recentGroups}
          carCoord={carCoord}
          onSelectPlace={onSelectPlace}
        />
      )}
```

The `onBackToTrip` prop goes; remove it from `LocationSheet`'s props interface in `src/components/LocationSheet.tsx` and from any use inside that file.

- [ ] **Step 4: Replace the three action bars with one**

Delete the charger-detail bar, the dropped-pin `New Trip` / `Add to Trip` bar, and the `Send to Car / Cancel` trip bar. Replace with:

```tsx
      {droppedPin ? (
        <SendToCarButton
          target={{
            name: droppedPin.name,
            address: droppedPin.address ?? droppedPin.subtitle,
            coordinate: droppedPin.coordinate,
          }}
          onSent={dismissDroppedPin}
        />
      ) : tab === 'charging' && selectedCharger ? (
        <SendToCarButton
          target={{
            name: selectedCharger.name,
            address: selectedCharger.region || selectedCharger.place,
            coordinate: chargerCoord(selectedCharger),
          }}
        />
      ) : null}
```

Also delete the `{rowMenu && trip.trip ? <TripRowMenu … /> : null}` block.

- [ ] **Step 5: Simplify the place selection handler**

Replace `onSelectPlace` (currently at `location.tsx:323-336`) — from:

```typescript
  // Select a place → record a recent, then start a trip (none yet), insert at a pending position, or append.
  const onSelectPlace = (place: Place) => {
    nav.select(place);
    if (trip.trip) {
      if (pendingInsert != null) trip.insertStop(place, pendingInsert);
      else trip.addStop(place);
      setPendingInsert(null);
      setScreen('trip');
    } else {
      trip.start(carCoord, place);
      setScreen('trip');
      tripSheetRef.current?.expand();
    }
  };
```

to:

```typescript
  // Select a place → record it as a recent and show it as a pin, so the Send to
  // Car bar has a target. Selecting is no longer a commitment to anything.
  const onSelectPlace = (place: Place) => {
    nav.select(place);
    if (!place.coordinate) return; // unresolved Apple completion — nothing to show or send
    setDroppedPin({
      coordinate: place.coordinate,
      name: place.title,
      subtitle: place.subtitle ?? '',
      fromPoi: false,
    });
    mapRef.current?.animateCamera({ center: place.coordinate }, { duration: 350 });
  };
```

- [ ] **Step 6: Simplify the charger navigate handler**

Replace `onNavigateToCharger` (currently at `location.tsx:747-766`). It currently branches on `trip.trip` to add or insert a charger stop, else falls through to `onSelectPlace`. It should now only select and frame — the charger detail's own `SendToCarButton` is the send path:

```typescript
  // Kept as the charger row/pin tap target. Sending is the SendToCarButton's job,
  // so this only opens the detail and frames the map on it.
  const onNavigateToCharger = (c: Charger) => {
    onSelectCharger(c);
  };
```

If `LocationSheet` distinguishes `onSelectCharger` from `onNavigateCharger` in a way that makes this collapse wrong, keep both props but give `onNavigateCharger` the body above.

- [ ] **Step 7: Typecheck**

Run: `npx tsc --noEmit -p tsconfig.json`
Expected: no output. Errors here mean a `trip.*` reference was missed — fix each one.

Run: `grep -n "trip\|Trip" src/app/location.tsx`
Expected: no matches other than incidental words in comments. Any code match is a miss.

- [ ] **Step 8: Run it on the device**

```bash
bash scripts/godot-ios/deploy-js.sh
```

Manually verify: the Location screen opens; long-press drops a pin and shows `Send to Car`; tapping an Apple POI shows the card and the button; the Charging tab opens a charger detail with the button; sending shows the toast. **Do not proceed until this passes** — Task 5 deletes the modules and makes reverting harder.

- [ ] **Step 9: Commit**

```bash
git add src/app/location.tsx src/components/LocationSheet.tsx
git commit -m "refactor(location): remove trip mode, one Send to Car button in its place

The screen no longer plans anything: no trip sheet, no stop reordering, no
insert positions, no Apple route polyline, no snapshot restore, no App Group
mirror. A place is shown and can be sent. ~1257 lines to ~750."
```

---

### Task 5: Delete the orphaned trip modules and dependency

Nothing imports these after Task 4. The typecheck is the proof.

**Files:**
- Delete: `src/state/trip.ts`, `src/state/trip.test.ts`, `src/state/useTrip.ts`, `src/state/useTripRoute.ts`, `src/state/tripSnapshot.ts`, `src/state/tripSnapshot.test.ts`, `src/components/TripSheet.tsx`, `src/components/TripRowMenu.tsx`, `src/services/appleDirections.ts`
- Modify: `src/state/useFleetState.ts` (remove `sendWaypoints` and `NAV_CHAIN_GAP_MS`), `package.json`

**Interfaces:**
- Consumes: a `location.tsx` with no trip references (Task 4).
- Produces: nothing. Pure removal.

- [ ] **Step 1: Confirm nothing still imports them**

```bash
grep -rn "state/trip\|useTrip\|TripSheet\|TripRowMenu\|appleDirections\|tripSnapshot\|sendWaypoints" src/ modules/ --include="*.ts" --include="*.tsx"
```
Expected: only matches inside the files about to be deleted. Any other hit must be cleaned up first.

- [ ] **Step 2: Delete the files**

```bash
git rm src/state/trip.ts src/state/trip.test.ts src/state/useTrip.ts src/state/useTripRoute.ts \
       src/state/tripSnapshot.ts src/state/tripSnapshot.test.ts \
       src/components/TripSheet.tsx src/components/TripRowMenu.tsx \
       src/services/appleDirections.ts
```

- [ ] **Step 3: Remove `sendWaypoints`**

In `src/state/useFleetState.ts`, delete from the `Fleet` interface (lines 42-44):

```typescript
  // Multi-stop route. Coordinates only (the car takes "lat,lon;lat,lon"); no label
  // and no trip-order — NavigationWaypointsRequest carries neither.
  sendWaypoints: (coords: { lat: number; lon: number }[]) => void;
```

Delete the whole `const sendWaypoints = useCallback(...)` block (around line 186, including its long comment), the `sendWaypoints,` entry in the `fleetApi` object, and the `NAV_CHAIN_GAP_MS` constant.

- [ ] **Step 4: Remove the dependency**

`react-native-reorderable-list`'s only consumer was `TripSheet`. Confirm, then remove:

```bash
grep -rn "react-native-reorderable-list" src/ modules/ ios/ --include="*.ts" --include="*.tsx" --include="*.swift"
pnpm remove react-native-reorderable-list
```
Expected from the grep: no matches. It ships native code, so the Podfile.lock changes — that is expected and gets rebuilt in Task 8.

- [ ] **Step 5: Verify**

Run: `npx tsc --noEmit -p tsconfig.json`
Expected: no output.

Run: `npm test`
Expected: all pass. The count DROPS — `trip.test.ts` (11 tests) and `tripSnapshot.test.ts` (2) are gone.

- [ ] **Step 6: Commit**

```bash
git add -A
git commit -m "chore(trip): delete the trip planner and its one exclusive dependency

Six state/component modules, appleDirections (whose only caller was useTripRoute),
sendWaypoints, and react-native-reorderable-list — audited by grepping consumers,
not assumed. gesture-handler and reanimated LOOK trip-only from TripSheet but have
other consumers and stay; react-native-maps is imported only in location.tsx,
which is where the trip code lived, and is emphatically not trip-only."
```

---

### Task 6: Share intake sends immediately

**Files:**
- Modify: `src/state/sharedLocationStore.ts`, `src/hooks/useSharedLocationIntake.ts`, `src/app/location.tsx`
- Test: `src/state/sharedLocationStore.test.ts`

**Interfaces:**
- Consumes: `useSendToCar` (Task 3).
- Produces: `SharedIntent { location: SharedLocation }` — no `action`, no `reorderedStops`. Task 7's Swift writes the matching payload.

- [ ] **Step 1: Narrow the intent contract**

In `src/state/sharedLocationStore.ts`, delete `SharedAction` and `ReorderedStop`, and reduce the interface to:

```typescript
// One shared place, waiting to be sent. There is no action to choose any more —
// sharing into airgapp means "send this to the car", full stop.
export interface SharedIntent {
  location: SharedLocation;
}
```

Update `src/state/sharedLocationStore.test.ts` to drop any `action` / `reorderedStops` assertions.

- [ ] **Step 2: Simplify the intake hook**

In `src/hooks/useSharedLocationIntake.ts`, remove `action` and `reorderedStops` from the internal `Intent` interface, and change the publish call from:

```typescript
            sharedLocationStore.set({ location: loc, action: intent.action, reorderedStops: intent.reorderedStops });
```

to:

```typescript
            sharedLocationStore.set({ location: loc });
```

Leave the drain loop, the timeout guard and the degraded JS resolution fallback exactly as they are — all three still earn their keep.

- [ ] **Step 3: Send on arrival**

In `src/app/location.tsx`, replace the whole shared-intent effect (the one that branched on `addToTrip` vs navigate) with:

```tsx
  // A shared place is sent the moment it arrives — the choice was already made by
  // sharing into airgapp. The screen still opens so the toast has somewhere to
  // land and you can see the pin that was sent.
  const sendToCar = useSendToCar();
  useEffect(() => {
    const consume = () => {
      const intent = sharedLocationStore.consume();
      if (!intent) return;
      const { coordinate, name } = intent.location;
      setDroppedPin({
        coordinate,
        name: name ?? 'Shared Location',
        subtitle: `${coordinate.latitude.toFixed(4)}, ${coordinate.longitude.toFixed(4)}`,
        fromPoi: false,
      });
      sendToCar({ name, address: intent.location.address, coordinate });
    };
    consume();
    return sharedLocationStore.subscribe(consume);
  }, [sendToCar]);
```

Add `import { useSendToCar } from '@/hooks/useSendToCar';` to the imports. Note `'Shared Location'` is in `destinationTitle`'s placeholder set, so it renders on our map but never reaches the car as a label — the real `name` is passed to `sendToCar` separately.

Check `SharedLocation` in `src/services/sharedLocation.ts` actually carries `address`; if it does not, pass `undefined` and note it for Task 7.

- [ ] **Step 4: Verify**

Run: `npx tsc --noEmit -p tsconfig.json`
Expected: no output.

Run: `npm test`
Expected: all pass.

- [ ] **Step 5: Commit**

```bash
git add src/state/sharedLocationStore.ts src/state/sharedLocationStore.test.ts src/hooks/useSharedLocationIntake.ts src/app/location.tsx
git commit -m "feat(share): a shared place is sent on arrival, no action to choose

Sharing into airgapp IS the decision, so the intent carries a location and
nothing else. The screen still opens, so the toast lands somewhere and you can
see the pin that went to the car."
```

---

### Task 7: Gut the share extension

**Files:**
- Delete: `ios/ShareExtension/SharePreviewView.swift`
- Rewrite: `ios/ShareExtension/ShareViewController.swift`
- Modify: `modules/shared-intake/ios/SharedIntakeModule.swift`, `modules/shared-intake/src/SharedIntakeModule.ts`

**Interfaces:**
- Consumes: the intent contract from Task 6 — `{lat, lng, name?, address?, source}` under `location`, plus `raw` and `ts`. No `action`, no `reorderedStops`.
- Produces: nothing consumed by later tasks.

- [ ] **Step 1: Delete the popup**

```bash
git rm ios/ShareExtension/SharePreviewView.swift
```

Remove its entry from the ShareExtension target's Sources build phase in `ios/airgapp.xcodeproj/project.pbxproj`. Use the `xcodeproj` gem (never `expo prebuild` — it clobbers the custom Godot `ios/`):

```bash
cd ios && ruby -e "require 'xcodeproj'; p = Xcodeproj::Project.open('airgapp.xcodeproj'); t = p.targets.find { |x| x.name == 'ShareExtension' }; t.source_build_phase.files.each { |f| f.remove_from_project if f.file_ref&.path&.include?('SharePreviewView') }; p.save"
```

- [ ] **Step 2: Rewrite the view controller**

`ShareViewController.swift` becomes: a spinner with "Sharing to car", resolve, write the intent, open the app, dismiss. Delete `parseStops`, `pendingIntentStops`, `savedCarStop`, `setEditingPresentation`, `restorePreShareIntent`, `preShareIntent`, the `card` property and every reference to it.

`writeIntent` loses its `action` parameter and the `reorderedStops` block:

```swift
  private func writeIntent() {
    var payload: [String: Any] = ["raw": rawShare, "ts": Date().timeIntervalSince1970 * 1000]
    if let r = resolved {
      var loc: [String: Any] = ["lat": r.latitude, "lng": r.longitude, "source": r.source.rawValue]
      if let n = r.name { loc["name"] = n }
      if let a = r.address { loc["address"] = a }
      payload["location"] = loc
    }
    if let defaults = UserDefaults(suiteName: suite),
       let data = try? JSONSerialization.data(withJSONObject: payload),
       let json = String(data: data, encoding: .utf8) {
      defaults.set(json, forKey: "pendingSharedIntent")
      defaults.synchronize()
    }
  }
```

The loading view, added in `viewDidLoad`:

```swift
  private let spinner = UIActivityIndicatorView(style: .large)
  private let statusLabel = UILabel()

  private func installLoadingUI() {
    view.backgroundColor = .systemBackground
    statusLabel.text = "Sharing to car"
    statusLabel.font = .systemFont(ofSize: 17, weight: .medium)
    statusLabel.textColor = .label
    statusLabel.textAlignment = .center
    let stack = UIStackView(arrangedSubviews: [spinner, statusLabel])
    stack.axis = .vertical
    stack.spacing = 14
    stack.alignment = .center
    stack.translatesAutoresizingMaskIntoConstraints = false
    view.addSubview(stack)
    NSLayoutConstraint.activate([
      stack.centerXAnchor.constraint(equalTo: view.centerXAnchor),
      stack.centerYAnchor.constraint(equalTo: view.centerYAnchor),
    ])
    spinner.startAnimating()
  }
```

The spinner is not decoration: resolving a Google short link is a network round-trip that can take seconds, and without it the share sheet appears frozen.

`finish(_:)` writes the intent, opens the host app, and completes the request. Keep the existing `completed` guard so a double call cannot fire `completeRequest` twice.

- [ ] **Step 3: Remove the dead native module methods**

In `modules/shared-intake/ios/SharedIntakeModule.swift`, delete the `setSavedTrip` and `setSavedCar` functions. In `modules/shared-intake/src/SharedIntakeModule.ts`, delete both declarations and their comments, leaving only `consumeSharedIntent`.

- [ ] **Step 4: Confirm nothing still calls them**

```bash
grep -rn "setSavedTrip\|setSavedCar" src/ modules/ ios/
```
Expected: no matches. (Task 4 removed the only JS caller.)

- [ ] **Step 5: Typecheck**

Run: `npx tsc --noEmit -p tsconfig.json`
Expected: no output.

- [ ] **Step 6: Commit**

```bash
git add -A
git commit -m "refactor(share): the popup is a spinner now, not a trip planner

599 lines of UIKit — card mode, trip mode, edit mode, the stops table, MKDirections
route computation, reorder/delete/duplicate — replaced by 'Sharing to car' and a
spinner. The spinner earns its place: resolving a Google short link is a network
round-trip and the sheet would otherwise look frozen.

setSavedTrip/setSavedCar go with it; their only caller was the trip mirror."
```

---

### Task 8: Rebuild, verify on-car, update docs

**Files:**
- Modify: `AGENTS.md` if any deploy step changed (it should not have)

- [ ] **Step 1: Full Release build**

Swift changed and a native dependency was removed, so `deploy-js.sh` is not enough.

```bash
cd ios && LANG=en_US.UTF-8 pod install && cd ..
xcodebuild -workspace ios/airgapp.xcworkspace -scheme airgapp -configuration Release \
  -sdk iphoneos -destination 'generic/platform=iOS' -allowProvisioningUpdates build
```

If this fails with `This provisioning profile has expired` (`0xe8008011`), that is the weekly free-profile expiry — the same command regenerates it. Do not pass `DEVELOPMENT_TEAM`.

- [ ] **Step 2: Install on the device**

```bash
xcrun devicectl list devices
```
Expected: the iPhone shows `connected`. If `unavailable`, unlock it and connect it before continuing.

Then install the built `.app` and launch. `CoreDeviceError 10002` on auto-launch is a benign transient — the bundle is installed, just tap the icon.

- [ ] **Step 3: Verify in-app sending**

With the car reachable, confirm each of these sends (haptic on tap; NO success toast by design — the car receiving the destination is the confirmation):

1. Long-press the map → `Send to Car`. Check the car names it by its address, **not** "Dropped Pin".
2. Tap an Apple POI → `Send to Car`. The car should show the POI's name.
3. Charging tab → a charger → `Send to Car`.
4. Search a place → select it → `Send to Car`.

- [ ] **Step 4: Verify sharing**

Share a place into airgapp from Apple Maps, then Google Maps, then Waze. Each should show "Sharing to car", open the app, and send — with the place's real name reaching the car.

- [ ] **Step 5: Verify the documented degradation**

Start a route on the car, then send a place from the app. Expected: a tappable pin appears on the centre screen and the route does **not** change. This is the accepted behaviour from the spec — confirm it happens rather than a silent nothing.

- [ ] **Step 6: Verify a rejected send is now visible**

Send a destination the car will refuse — the open-water coordinate from the bench, `39.936693, 25.306087`, entered as a long-press or via the bench's Point C. Expected: a failure toast appears carrying the car's own reason. (Success is silent, so a failure toast is the ONLY toast you should ever see from a send.) This is what Task 2 was for; if it still reports success, `actionStatus` is not reaching the outcome and that needs fixing before this is called done.

- [ ] **Step 7: Commit anything that changed**

```bash
git add -A
git commit -m "chore: rebuild after the share extension rewrite and dependency removal"
```

---

## Notes for the implementer

- **Do not reintroduce prepend/append.** f21 is the only message that honours the order field, and it could not be trusted with a coordinate — three points in one area, same format, one accepted and two rejected. That is why the feature is one button.
- **Do not add a wake before sending.** Verified on-car: sends land on a sleeping car.
- **Do not branch on route state anywhere.** It is unreadable while the car is locked.
- The nav bench in `src/app/carlink.tsx` and `src/ble/navBench.ts` stay. They are isolated debug tooling and the next RE round will want them.
- If a task's typecheck fails in a way the plan did not predict, stop and report it rather than inventing a fix — several assumptions here rest on greps taken on 2026-07-26 and the tree may have moved.
