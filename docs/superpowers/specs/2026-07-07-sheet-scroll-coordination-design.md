# Bottom sheet scroll/resize coordination — design

**Date:** 2026-07-07
**Status:** Approved (build straight through — gates waived by the user)
**Scope:** make the shared `BottomSheet` coordinate list-scroll with sheet-resize, as **default behavior for
every sheet** (Location + Charging + Trip). JS-only, no new deps.

## Problem

Today only the sheet's top handle resizes it; the body `ScrollView`/list scrolls freely at any detent. Desired:
- **Not fully expanded:** a vertical drag on the body **resizes** the sheet; the list does not scroll.
- **Fully expanded:** the list **scrolls**; when it's at the top and you swipe down, the sheet **lowers**
  instead of fighting the scroll.

## Mechanism (in `BottomSheet`)

Reuse the existing `translateY` + `settle`. Add a **content-area capture `PanResponder`** and expose it +
scroll wiring to the consumer via the render-prop.

- Track (refs, read by the pan which is created once): `restingY` (existing), `scrollOffset`,
  `contentBusy`; and a reactive `atFull` state (updated in `settle`) that drives `scrollEnabled`.
- **Capture rule** (`onMoveShouldSetPanResponderCapture`):
  1. `contentBusy` → `false` (an internal drag like a reorder owns the gesture);
  2. horizontal (`|dy| ≤ |dx|`) → `false` (let row swipes / taps through);
  3. not at full (`restingY ≠ full`) → capture any vertical drag (`|dy| > 6`) → **resize**;
  4. at full → capture only `dy > 6 && scrollOffset ≤ 0` → **lower**; else fall through to the list.
  Move/release reuse the same overdrag + snap logic as the handle pan.
- **Render-prop additions:** `contentPanHandlers` (spread on a `View` wrapping the scroll container),
  `scrollProps = { scrollEnabled: atFull, onScroll, scrollEventThrottle: 16 }`, and
  `setContentBusy(b: boolean)`. Existing `dragHandlers` / `expandFull` / `collapseToMiddle` stay.

## Consumer wiring

- **LocationSheet** (`LocationBody`, `ChargingBody` — plain `ScrollView`): wrap the `ScrollView` in
  `<View style={{flex:1}} {...contentPanHandlers}>` and spread `{...scrollProps}` on the `ScrollView`
  (`onScroll` updates `scrollOffset` for the top-detection).
- **TripSheet** (`ReorderableList`): wrap it in the content-pan `View`; pass `scrollEnabled={scrollProps.scrollEnabled}`
  only (its `onScroll` wants a reanimated handler, so we skip precise offset tracking — trip lists are short,
  so `scrollOffset` stays 0 and "full + down → lower" works); wire `onDragStart → setContentBusy(true)` and
  `onDragEnd → setContentBusy(false)` so the `≡` reorder drag is never stolen by the sheet pan.

## Edge cases / risks

- **Trip reorder vs resize** (both vertical) → resolved by the `contentBusy` latch (set on the reorderable
  list's drag-start/-end). The one on-device-tuning risk: if the sheet pan captures the very first move before
  `onDragStart` fires, also latch on the handle's `onPressIn`. Verified on device.
- **Very long trip (>~8 stops)** that scrolls: offset isn't tracked for the reorderable list, so scroll-up
  after scrolling down could be pre-empted by "down → lower." Rare; acceptable, noted.
- Horizontal row swipes (`ReanimatedSwipeable`) and taps are unaffected (rule 2 / move-only capture).
- The search field sits above the content-pan (sibling), so focusing/typing is unaffected.

## Testing

- No new pure logic → no node tests.
- **Manual (device):** at middle detent, dragging the list resizes the sheet (no scroll); at full, the list
  scrolls; at full + top, swipe-down lowers the sheet; trip-sheet `≡` reorder still works; row swipe + taps
  still work; search focus unaffected.

## Decision record

- **Universal in `BottomSheet`** (all sheets), via a content-area capture PanResponder — no `@gorhom` (jitters
  on this reanimated-4 stack), no RNGH rewrite, no new deps.
- **`contentBusy` latch** keeps the Trip sheet's reorder winning on the handle.
- **Offset tracking only on the plain `ScrollView` sheets**; the short reorderable trip list relies on
  offset≈0.
