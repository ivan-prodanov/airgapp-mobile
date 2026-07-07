# Native iOS Sheet for the Location Screen — Design

**Date:** 2026-07-08
**Status:** Approved (design), pending implementation plan
**Supersedes on this screen:** the hand-rolled `src/components/BottomSheet.tsx` gesture/resize coordination (`2026-07-07-sheet-scroll-coordination-design.md`).

## Problem

The location screen renders a full-screen native `MapView` with a bottom sheet over it. The sheet's content switches between **Location / Charging** (a plain `ScrollView`) and **Trip** (a `react-native-reorderable-list`, a `FlatList` wrapped in an RNGH `GestureDetector`).

The sheet is hand-rolled on RN core `Animated.Value` + `PanResponder`. In the Trip sheet, **swiping up on the list body does not expand the sheet**, so trip stops that overflow the resting detent are unreachable.

### Root cause (confirmed, high confidence)

Two gesture systems fight on the vertical axis. The reorderable list wraps its `FlatList` in `Gesture.Simultaneous(Gesture.Native(), pan)` ([ReorderableListCore.tsx:1137](../../../node_modules/react-native-reorderable-list/src/components/ReorderableListCore.tsx)). **RNGH claims the touch at the native layer before React Native's JS responder system runs**, so the sheet's `contentPan` `PanResponder` ([BottomSheet.tsx:146](../../../src/components/BottomSheet.tsx)) is never asked. `LocationSheet` resizes fine because it's a plain `ScrollView` with no RNGH detector. `scrollEnabled=false` is irrelevant — the gesture is gone before scroll logic sees it.

Dropping the ≡ reorder handle would **not** fix this: the conflict is scroll-vs-resize on the body, not reorder (the ≡ handle is already a separate touch target).

## Decision

Adopt a **real native iOS bottom sheet** — `UISheetPresentationController` — so iOS coordinates detents-vs-scroll natively (the Apple Maps / Find My behavior). This is the most platform-standard iOS pattern; the user accepts the native rebuild cost.

**Library:** `@lodev09/react-native-true-sheet@3.11.3`.
- Wraps `UISheetPresentationController` on iOS; Fabric-required (v3+); devDeps test against RN 0.85.3.
- No Expo config plugin — installs the manual, no-`expo prebuild` way (`expo install` → `pod install` → `xcodebuild`), exactly like `modules/expo-apple-search`. No Info.plist changes.
- Exposes everything needed: `detents` (fractional, ≤3), `dimmed={false}` (background stays interactive — their documented Maps use-case), `scrollable` with native scroll-to-expand (`scrollableOptions.scrollingExpandsSheet`, backed by iOS `prefersScrollingExpandsWhenScrolledToEdge`), pinned `footer`, `backgroundColor`/`cornerRadius`/grabber, ref methods `present(index, animated)` / `resize(index)` / `dismiss()`, and events `onDidPresent` / `onDetentChange` / `onDidDismiss`. On iOS, `scrollable` auto-detects a `ScrollView`/`FlatList` up to **2 levels deep**, so the reorderable list's `FlatList` is findable.

**Rejected native alternative:** `react-native-screens` `formSheet`. It is a *navigation-route* presentation (would restructure the single map-screen into a router modal) and has unresolved iOS 26 scroll bugs (screens #2424, #3161) needing a swipe-back-disabling workaround.

**Fallback:** if the spike (below) fails, revert to **Option A — unify the sheet on RNGH** (JS-only, no rebuild): rewrite the sheet drag as `Gesture.Pan` and compose with the list via its `panGesture` prop + `simultaneousWithExternalGesture` / `requireExternalGestureToFail` / `activeOffsetY`. This was independently verified feasible and is how `@gorhom/bottom-sheet` solves the same problem.

## The one real risk

**Nobody has publicly shipped RNGH drag-reorder inside a native `UISheetPresentationController` with native scroll-to-expand.** It should work — iOS coordinates with the underlying `UIScrollView` below RNGH's `Gesture.Native()` wrapper (which exists precisely to let the native scroll run simultaneously with the reorder pan), and true-sheet's v3.11 notes claim RNGH child pans now activate correctly inside the sheet — but it is unproven on our stack. Everything else is low-risk. Therefore we **spike before the full refactor.**

## Phase 0 — Spike (one rebuild, gated)

Prove the crux before the big change.

1. Install `@lodev09/react-native-true-sheet@3.11.3` (`expo install` → `pod install` → `xcodebuild` Release).
2. Mount a bare `<TrueSheet detents={[0.5, 0.92]} scrollable dimmed={false} backgroundColor="#161616">` over the map, containing the **existing** reorderable trip list (real `TripSheet` content, minimal chrome).
3. On-device checklist:
   - [ ] Swipe up on the list at 0.5 → sheet expands to 0.92, then the list scrolls (native scroll-to-expand).
   - [ ] ≡ handle drags and reorders rows.
   - [ ] Map is touchable at the resting detent (`dimmed={false}`).
   - [ ] Swipe actions (Share / Insert / Delete) and long-press context menu still fire.
   - [ ] A pinned `footer` renders and stays put across detents.

**Gate:** all green → proceed to the full migration. Any red that can't be resolved with a documented true-sheet prop → stop, fall back to Option A.

## Full migration (only if the spike is green)

### Component architecture

- **One persistent `<TrueSheet>`** in `src/app/location.tsx`, presented whenever the location screen is active. Its children switch by the screen's existing mode state:
  - Location / Charging → the existing `LocationSheet` body (`ScrollView`).
  - Trip → the existing `TripSheet` body (reorderable `FlatList`).
- `scrollable` auto-coordinates with whichever scroll view is currently mounted.
- `LocationSheet.tsx` and `TripSheet.tsx` **stop wrapping themselves in `BottomSheet`** and become plain content components (header + body + list). They no longer consume `dragHandlers` / `contentPanHandlers` / `scrollProps` / `setContentBusy`.
- **`src/components/BottomSheet.tsx` is deleted** along with its `PanResponder`/`Animated` plumbing and `SheetScrollProps` type (verify no other consumers first).
- The `TripSheet` `onDragStart`/`onDragEnd` worklet latch (added to coordinate with the old `PanResponder`) is **removed** — no PanResponder remains to coordinate with.

### Gesture model (the fix)

| Interaction | Owner |
| --- | --- |
| Sheet resize | Native grabber + detent drag (UIKit) |
| Scroll-to-expand (swipe up at top → expand, then scroll) | Native `scrollable`, `scrollingExpandsSheet` default `true` |
| Reorder | RNGH ≡ handle (unchanged) |
| Swipe actions / long-press menu | RNGH `ReanimatedSwipeable` / `Pressable` (unchanged; horizontal, no axis conflict) |
| Map interactive at rest | `dimmed={false}` |

### Config

- `detents={[0.25, 0.5, 0.92]}` — preserves the current minimal/middle/full; Trip presents at index 1 (0.5). (If the user prefers no sub-half peek, `[0.5, 0.92]`.)
- `dimmed={false}`, `backgroundColor="#161616"`, `cornerRadius` ≈ 16, grabber on.
- `footer={<TripActions/>}` — Send to Car / Cancel, pinned natively; Trip mode only (Send to Car remains a local mock; never a network/Tesla call).
- The screen's imperative `expand()` maps to `sheet.resize(index)` / `sheet.present(index)`.

### Data flow

The screen keeps its existing state machine (mode, `selectedCharger`, `pendingInsert`, etc.) unchanged. The `TrueSheet` stays mounted and presented; only its children and `detents`/`footer` vary by mode. To avoid true-sheet issue #686 (content invisible after re-render while dismissed), we **switch content in place** rather than dismiss/re-present.

## Testing

- Pure logic (`src/state/trip.ts`) tests unchanged — 64 node tests stay green.
- Gesture/native behavior is validated on-device (the spike checklist, plus a fuller pass over Location↔Charging↔Trip transitions, detent changes, footer, keyboard, safe-area).

## Risks & mitigations

- **Crux gesture coordination** → the spike de-risks it before any refactor; Option A is the proven fallback.
- **true-sheet #686** (content invisible after re-render while dismissed) → keep the sheet mounted and presented; switch content, don't dismiss/re-present.
- **`scrollToEnd` unreliable under `scrollable`** → we don't auto-scroll; use `scrollToOffset` if ever needed.
- **v3.11.3 recency** → pin the exact version; the spike validates on our exact stack.
- **CocoaPods sunset (Dec 2026)** → out of scope now; true-sheet is expected to move to SPM.

## Out of scope

- Migrating any other screen's sheet.
- Changing trip data / itinerary logic.
- Android (project is iOS-only in practice).
