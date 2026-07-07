# Sheet Scroll/Resize Coordination — Implementation Plan

> Build straight through (gates waived). JS-only, no rebuild.

**Goal:** `BottomSheet` coordinates list-scroll with sheet-resize for every sheet: not-full → body drag resizes; full → list scrolls; full+top+down → lower.

**Tasks:**
1. `BottomSheet.tsx` — add a content-area capture `PanResponder`, `atFull` state, `scrollOffset`/`contentBusy` refs, shared `onMove`/`onRelease`; expose `contentPanHandlers`, `scrollProps`, `setContentBusy` on the render-prop.
2. `LocationSheet.tsx` — thread the new render-props to `LocationBody`/`ChargingBody`; wrap each `ScrollView` in `<View style={{flex:1}} {...contentPanHandlers}>` and spread `{...scrollProps}`.
3. `TripSheet.tsx` — wrap the `ReorderableList` in the content-pan `View`; `scrollEnabled={scrollProps.scrollEnabled}`; `onDragStart→setContentBusy(true)`, `onDragEnd→setContentBusy(false)`.
4. Deploy + on-device verify (resize when not full, scroll when full, top+down lowers, reorder still works, swipe/taps unaffected).

**Capture rule:** `contentBusy→false`; `|dy|≤|dx|→false`; `restingY≠full → |dy|>6` (resize); else `dy>6 && scrollOffset≤0` (lower).

**Risk:** trip reorder vs resize → `contentBusy` latch; tune on device (add `onPressIn` latch if the first move is stolen).
