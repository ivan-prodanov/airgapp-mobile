# R11 §1a — The detents path (LIVE gorhom v5, module 4120)

Sources: iOS `main.decompiled.js` (v4.56) PRIMARY. Android `bundle.hasm` (v4.58) spot-checked — worklet
source strings are byte-identical for `evaluatePosition_Gorhom_BottomSheetTsx12` and
`gorhom_useAnimatedDetentsTs1` ⇒ `[both-match]` for all gorhom internals below.

---

## 🚨 HEADLINE — THE §1a PREMISE IS FALSE, AND SO IS THE R11 RECON'S READING OF THE MOUNT GATE

**`isAnimatedOnMount` is initialized to `TRUE` for the Climate sheet.** It is *not* false.

iOS **1783465-1783472**, verbatim register trace:
```
r2 = r1.useSharedValue;
r1 = !r12;                      // r12 = animateOnMount  (slot2)
if(r1) { goto 1157 }            // short-circuit ||
case 1153: r1 = (r11 === r5);   // r11 = _providedIndex (slot1), r5 = -1
case 1157: r7 = r2.bind(r3)(r1);
var _closure2_slot33 = r7;      // slot33 == 'isAnimatedOnMount'  (proved at 1785079-1785081)
```
⇒ **`const isAnimatedOnMount = useSharedValue(!animateOnMount || _providedIndex === -1);`**

Climate passes `animateOnMount: false` ⇒ `!false` ⇒ **`isAnimatedOnMount === true` from frame zero.**

### Consequences (this overturns the recon's annotation)
The recon annotated `evaluatePosition`'s `if (!isAnimatedOnMount.value)` block with
*"← FIRST TIME ONLY … Climate: instant, and FLIPS THE GATE"*. **That block NEVER executes for Climate.**
- `setToPosition(proposedPosition); isAnimatedOnMount.value = true;` — **dead code on this screen.**
- In `getEvaluatedPosition`, `if (!isAnimatedOnMount.value) return _providedIndex === -1 ? closedDetentPosition : detents[_providedIndex];` — **also never taken.** It always falls through to `return detents[currentIndex]`.
- The detents reaction's guard `JSON.stringify(result)===JSON.stringify(previous) && isAnimatedOnMount.value` — the second conjunct is **always true**, so the guard degenerates to a pure "detents unchanged ⇒ return".

**Every `evaluatePosition` call for Climate — including the very first one — takes the post-mount path
and ends at `animateToPosition(proposedPosition, source, undefined, animationConfigs)`.**

So the slide does **not** require `detents[0]` to change. It only requires
`animatedContainerHeightDidChange.value === false` at the moment the detents reaction first fires.

Sibling init, same region (iOS 1783445-1783464):
```
r45 = useReactiveSharedValue(animateOnMount ? -1 : _providedIndex);  // slot31 = animatedCurrentIndex  → 0 for Climate
r30 = useSharedValue(INITIAL_POSITION);                              // slot32 = animatedPosition      → SCREEN_HEIGHT = 852
```
Slot identities proved verbatim at iOS **1784287** (`r2['animatedCurrentIndex'] = r7 /*slot31*/`),
**1785079** (`r2['animatedPosition'] = r8 /*slot32*/`), **1784294 / 1785081** (`r2['isAnimatedOnMount'] = /*slot33*/`),
**1785083** (`r2['_providedIndex'] = r8 /*slot1*/`).

Prop destructuring proved at iOS **1783136-1783154**:
```
r56 = r1.animationConfigs;  var _closure2_slot0 = r56;   // undefined for Climate
r2 = r1.index; r11 = 0; if (r2 !== undefined) r11 = r2;  var _closure2_slot1 = r11;   // _providedIndex = index ?? 0 = 0
r12 = r1.animateOnMount; if (r12 === undefined) r12 = DEFAULT_ANIMATE_ON_MOUNT;  var _closure2_slot2 = r12;  // false
```

Constants: `INITIAL_LAYOUT_VALUE = -999` (iOS 1773757), `INITIAL_VALUE = Number.NEGATIVE_INFINITY` (iOS 1777809),
`INITIAL_SNAP_POINT = -999` (1777811), `INITIAL_POSITION = SCREEN_HEIGHT` (1777815), `DEFAULT_KEYBOARD_INDEX = -998` (1777806).
`animatedContainerHeightDidChange` (slot36) and `isInTemporaryPosition` (slot35) both `useSharedValue(false)` (iOS 1783568-1783573).

---

## 1. The detents computation — VERBATIM

**`gorhom_useAnimatedDetentsTs1`, iOS line 1773286** (this is the v5 replacement for `useNormalizedSnapPoints`;
the old `tesla_useNormalizedSnapPointsTs1` @1748976 is the DEAD v4 copy — different module, not module 4120):

```js
function gorhom_useAnimatedDetentsTs1() {
  const {layoutState, INITIAL_LAYOUT_VALUE, detents, normalizeSnapPoint,
         $modal, detached, bottomInset, enableDynamicSizing, maxDynamicContentSize} = this.__closure;
  const {containerHeight, handleHeight, contentHeight} = layoutState.get();
  if (containerHeight === INITIAL_LAYOUT_VALUE) { return {}; }
  const _detents = detents ? ('value' in detents ? detents.value : detents) : [];
  let _normalizedDetents = _detents.map(function (snapPoint) { return normalizeSnapPoint(snapPoint, containerHeight); });
  let highestDetentPosition = _normalizedDetents[_normalizedDetents.length - 1];
  let closedDetentPosition = containerHeight;
  if ($modal || detached) { closedDetentPosition = containerHeight + bottomInset; }
  if (!enableDynamicSizing) {
    return {detents: _normalizedDetents, highestDetentPosition, closedDetentPosition};
  }
  if (contentHeight === INITIAL_LAYOUT_VALUE) { return {}; }     // ← ATOMIC GATE
  if (handleHeight  === INITIAL_LAYOUT_VALUE) { return {}; }     // ← ATOMIC GATE
  const dynamicSnapPoint = containerHeight -
      Math.min(contentHeight + handleHeight,
               maxDynamicContentSize !== undefined ? maxDynamicContentSize : containerHeight);
  if (!_normalizedDetents.includes(dynamicSnapPoint)) { _normalizedDetents.push(dynamicSnapPoint); }
  _normalizedDetents = _normalizedDetents.sort(function (a, b) { return b - a; });   // DESCENDING
  highestDetentPosition = _normalizedDetents[_normalizedDetents.length - 1];
  const dynamicDetentIndex = _normalizedDetents.indexOf(dynamicSnapPoint);
  return {detents: _normalizedDetents, dynamicDetentIndex, highestDetentPosition, closedDetentPosition};
}
```

`gorhom_normalizeSnapPointTs1`, iOS **1774333**, verbatim:
```js
function gorhom_normalizeSnapPointTs1(snapPoint, containerHeight) {
  let normalizedSnapPoint = snapPoint;
  if (typeof normalizedSnapPoint === 'string') {
    normalizedSnapPoint = Number(normalizedSnapPoint.split('%')[0]) * containerHeight / 100;
  }
  return Math.max(0, containerHeight - normalizedSnapPoint);
}
```

### 🔑 The detents set is ATOMIC — there is NO partial first resolve
With `enableDynamicSizing: true`, the function returns the bare object `{}` (⇒ `detents === undefined`)
until **all three** of `containerHeight`, `contentHeight`, `handleHeight` are ≠ -999. It can never publish
"only the explicit 582" and then grow. **§1a's hypothesis (3) — "the FIRST resolve happens with a partial
set (e.g. only the explicit 582) and then changes when the dynamic detent lands" — is DISPROVEN.**

---

## 2. `isLayoutCalculated` — VERBATIM

**`gorhom_BottomSheetTsx2`, iOS line 1783032** (created as `useDerivedValue` at iOS 1783473-1783567, slot34):
```js
function gorhom_BottomSheetTsx2() {
  const {animatedLayoutState, INITIAL_LAYOUT_VALUE, handleComponent, animatedDetentsState} = this.__closure;
  let isContainerHeightCalculated = false;
  const {containerHeight, handleHeight} = animatedLayoutState.get();
  if (containerHeight !== null || containerHeight !== undefined) { isContainerHeightCalculated = true; }  // ⚠ always true (bug, `||`)
  if (containerHeight !== INITIAL_LAYOUT_VALUE) { isContainerHeightCalculated = true; }
  let isHandleHeightCalculated = false;
  if (handleComponent === null) { isHandleHeightCalculated = true; }
  if (handleHeight !== INITIAL_LAYOUT_VALUE) { isHandleHeightCalculated = true; }
  let isSnapPointsNormalized = false;
  const {detents} = animatedDetentsState.get();
  if (detents) { isSnapPointsNormalized = true; }
  return isContainerHeightCalculated && isHandleHeightCalculated && isSnapPointsNormalized;
}
```
Answers §1a(2): **it is NOT `detents[0] !== INITIAL_VALUE`.** In v5 it is
`isContainerHeightCalculated && isHandleHeightCalculated && Boolean(detents)`. Note the upstream bug
`containerHeight !== null || containerHeight !== undefined` is a tautology, so `isContainerHeightCalculated`
is unconditionally `true`. Climate passes a `handleComponent` (iOS 5222739, `r7['handleComponent'] = r11`),
so `isHandleHeightCalculated` requires a real `handleHeight`.

**⇒ `isLayoutCalculated` flips true in the SAME derived-value pass in which `detents` first becomes defined**
(it is gated on `Boolean(detents)`, and `detents` already subsumes the container/handle/content checks).
There is no window where `isLayoutCalculated` is true but `detents` is undefined, nor vice-versa (modulo mapper ordering).

---

## 3. TIMELINE for Climate — snapPoints:[270], enableDynamicSizing:true, containerHeight 852, handleHeight 15

Climate's props, VERBATIM (iOS **5222699**):
```js
{'index': null, 'onChange': null, 'snapPoints': null, 'animateOnMount': false, 'enableDynamicSizing': true,
 'enableOverDrag': true, 'enableHandlePanningGesture': true, 'enableContentPanningGesture': true,
 'enablePanDownToClose': false, 'keyboardBehavior': 'extend'}
// then: r7['index'] = …(=0); r7['snapPoints'] = …(=[270]); r7['handleComponent'] = …
```
**CONFIRMED: no `animationConfigs` prop. CONFIRMED: no `maxDynamicContentSize` prop.**
⇒ `configs || _providedAnimationConfigs` in `animateToPosition` resolves to `undefined` ⇒ gorhom's
default spring. ⇒ `maxDynamicContentSize !== undefined ? … : containerHeight` ⇒ **852**.

### Arithmetic
- explicit detent: `normalizeSnapPoint(270, 852) = max(0, 852 - 270)` = **582**
- `dynamicSnapPoint = 852 - Math.min(contentHeight + 15, 852)`
- `detents = [582, dyn].sort((a,b) => b-a)` — **descending**
- `detents[0] = max(582, dyn)`  ← the LARGEST position = the SMALLEST sheet
- `highestDetentPosition = detents[len-1] = min(582, dyn)`
- `closedDetentPosition = 852` (Climate is not `$modal`/`detached`; otherwise `852 + bottomInset`)

### Layout events
| # | event | layoutState | `useAnimatedDetents` returns | `isLayoutCalculated` |
|---|-------|-------------|------------------------------|----------------------|
| 0 | mount (initialUpdaterRun, sync during render) | c=-999, h=-999, ct=-999 | `{}` | **false** |
| 1 | container onLayout → 852 | c=852, h=-999, ct=-999 | `{}` (contentHeight gate) | **false** |
| 2 | handle onLayout → 15 | c=852, h=15, ct=-999 | `{}` (contentHeight gate) | **false** |
| 3 | **content onLayout → C** | c=852, h=15, ct=C | `{detents:[max(582,852-C-15), min(...)], dynamicDetentIndex, highestDetentPosition, closedDetentPosition:852}` | **true** |
| 4+ | any content re-measure → C' | ct=C' | recomputed | true |

(Order of 1/2/3 is irrelevant — the gate is atomic. Only the *last* of the three matters.)

### ⭐ Does `detents[0]` change between the first `isLayoutCalculated==true` evaluation and a later one?

**`detents[0] = max(582, 852 - (contentHeight + 15))`.**
It changes **iff `contentHeight` crosses 255**:
- `contentHeight < 255` ⇒ `dyn = 852-(C+15) > 582` ⇒ `detents = [dyn, 582]`, **`detents[0] = dyn`** (sheet sits LOW)
- `contentHeight ≥ 255` ⇒ `dyn ≤ 582` ⇒ `detents = [582, dyn]`, **`detents[0] = 582`**

`contentHeight` **is** re-writable — the write is **UNGUARDED on every layout event**:

`gorhom_BottomSheetViewTsx1`, iOS **1791819** — `function gorhom_BottomSheetViewTsx1(state){const{height}=this.__closure;state.contentHeight=height;return state;}`
driven by BottomSheetView's `onLayout` (iOS **1791925-1791960**), whose only gate is `if (enableDynamicSizing)`:
```
r2 = a0; r3 = _closure2_slot2 /*enableDynamicSizing*/; if(!r3) goto 62;   // skip write
r3 = r2.nativeEvent.layout.height;  → animatedLayoutState.modify(state => { state.contentHeight = height; return state; })
```
Same for `gorhom_useBottomSheetContentSizeSetterTs1`, iOS **1780072** —
`function(state){const{contentHeight}=this.__closure;state.contentHeight=contentHeight;return state;}`,
setter body iOS 1780007-1780062, again gated only on `enableDynamicSizing`.

**VERDICT (§1a.3 / §1a.6):** `detents[0]` is **not proven to change** for a plain Climate open. Statically,
it changes only under the specific condition `contentHeight` crossing 255 (i.e. a first content measure
under 255pt followed by the real one). I cannot resolve Climate's actual first `contentHeight` from the
bundle — that is a runtime value. **UNRESOLVED — but it no longer matters**, because §1a's premise is
void: with `isAnimatedOnMount === true` from frame zero, the *first* detents resolve already routes to
`animateToPosition`. See §6.

---

## 4. EVERY `evaluatePosition` / `animateToPosition` call site in module 4120

| # | Call site | iOS line | Calls | Fires on a plain Climate open? |
|---|-----------|----------|-------|-------------------------------|
| 1 | **detents reaction** `gorhom_BottomSheetTsx18` | 1783100 (closure @1786180) | `evaluatePosition(SNAP_POINT_CHANGE)` | **YES — the primary one.** Fires when `detents` goes `undefined → [·,·]` at layout event #3 |
| 2 | container-height reaction `gorhom_BottomSheetTsx16` | 1783092 | `animateToPosition(closedDetentPosition, GESTURE)` | **NO** — see below |
| 3 | keyboard reaction `gorhom_BottomSheetTsx20` | 1783108 (closure @1786526) | `evaluatePosition(KEYBOARD, animationConfigs)` | **NO** — first guard `if (status === KEYBOARD_STATUS.UNDETERMINED) return;` |
| 4 | **mount `useEffect` → `handleSnapToIndex(_providedIndex)`** | **1786644-1786670** | `runOnUI(animateToPosition)(detents[0], USER, 0, undefined)` | **YES — and it was NOT in the recon's list.** See §4b |
| 5 | `handleSnapToPosition` `gorhom_BottomSheetTsx13` | 1783080 / body 1785451 | `runOnUI(animateToPosition)(·, USER, 0, ·)` | NO — imperative ref only |
| 6 | imperative handle: `snapToIndex`/`snapToPosition`/`expand`/`collapse`/`close`/`forceClose` | 1785828-1785838, 1785962-1785972 | via `handleSnapToIndex`/`handleSnapToPosition` | NO — Climate holds no ref that calls these on open |
| 7 | gesture `handleOnEnd` (`useGestureEventsHandlersDefault`) | 1776269 | `animateToPosition(destinationPoint, GESTURE, velocityY/2)` | NO — requires a drag |
| 8 | gesture `handleOnStart`/`handleOnChange` | 1776265 | writes `animatedPosition` directly | NO |

### 4a. `gorhom_BottomSheetTsx16` — container-height reaction, VERBATIM (iOS 1783092)
```js
function gorhom_BottomSheetTsx16(result, previous) {
  const {INITIAL_LAYOUT_VALUE, animatedContainerHeightDidChange, animatedDetentsState,
         animatedAnimationState, ANIMATION_STATUS, ANIMATION_SOURCE, animateToPosition} = this.__closure;
  if (result === INITIAL_LAYOUT_VALUE) { return; }
  animatedContainerHeightDidChange.value = result !== previous;          // ⭐ THE GATEKEEPER
  const {closedDetentPosition} = animatedDetentsState.get();
  if (closedDetentPosition === undefined) { return; }
  const {status: animationStatus, source: animationSource, nextIndex} = animatedAnimationState.get();
  if (animationStatus === ANIMATION_STATUS.RUNNING && animationSource === ANIMATION_SOURCE.GESTURE && nextIndex === -1) {
    animateToPosition(closedDetentPosition, ANIMATION_SOURCE.GESTURE);
  }
}
```
prepare = `gorhom_BottomSheetTsx15` @1783088 = `animatedLayoutState.get().containerHeight`.

**It does neither `animateToPosition` nor `setToPosition` for Climate** — its `animateToPosition` needs
`status===RUNNING && source===GESTURE && nextIndex===-1`. Its ONLY relevant effect on a plain open is the
side-effect `animatedContainerHeightDidChange.value = result !== previous`:
- pass A (containerHeight still -999): `result === INITIAL_LAYOUT_VALUE` ⇒ **return**, flag stays `false`.
- pass B (containerHeight -999 → 852): `852 !== -999` ⇒ **flag = `true`**.
- It does **not** run again at the content-onLayout pass (containerHeight unchanged ⇒ its input didn't change
  ⇒ its mapper is not dirty), so **the flag is still `true` when the detents reaction first fires.**

⇒ In `evaluatePosition`, `if (animatedContainerHeightDidChange.value) { setToPosition(proposedPosition); return; }`
**wins** on the first detents resolve ⇒ that first write is **INSTANT** (consistent with R8/R10 and with
the user's "the mount write IS instantaneous"), and `setToPosition` clears the flag to `false`
(`animatedContainerHeightDidChange.value = false;`) **and** stamps
`animatedAnimationState.nextPosition = 582, nextIndex = detents.indexOf(582) = 0`.

**Caveat (mapper ordering):** this "container reaction runs first" conclusion rests on
`updateMappersOrder()`'s DFS visiting `mappers` in **insertion order** (iOS 1369116). Both reactions have
`outputs === undefined` (they are sinks — `updateMappersOrder` only threads mappers that *have* `outputs`),
so their relative order is pure registration order. Tsx15/16 are `_closure1_slot22/23`, Tsx17/18 are
`_closure1_slot24/25` ⇒ the container reaction registers first ⇒ runs first. **INFERRED** (source-order →
hook-order → mapper-insertion-order), not directly observed.

### 4b. ⭐ THE UNLISTED CALL SITE — the mount `useEffect`

iOS **1786644-1786670**, decoded verbatim from the register trace:
```js
useEffect(() => {
  if (animateOnMount /*slot2*/) {              // case 0:  if(!r1) goto 26
    if (!isAnimatedOnMount.value /*slot33*/) { // case 10: if(r1)  goto 26
      return;                                  // case 22: return undefined
    }
  }
  handleSnapToIndex(_providedIndex /*slot1*/); // case 26: slot59(slot1)
}, [animateOnMount, _providedIndex, isAnimatedOnMount, handleSnapToIndex]);
```
i.e. `if (animateOnMount && !isAnimatedOnMount.value) return; handleSnapToIndex(_providedIndex);`

**For Climate `animateOnMount === false` ⇒ the early-return is skipped ⇒ `handleSnapToIndex(0)` ALWAYS runs on mount.**

`handleSnapToIndex` (slot59) — `useStableCallback(...)` (iOS **1785361-1785449**: `r6 = r4.useStableCallback;`),
body decoded verbatim from iOS 1785363-1785448:
```js
const handleSnapToIndex = useStableCallback(function handleSnapToIndex(index, animationConfigs) {
  const {detents} = animatedDetentsState.get();          // slot29
  const _isLayoutCalculated = isLayoutCalculated.get();  // slot34
  if (detents === undefined) return;                     // case 47 → 288
  if (detents.length === 0) return;                      // case 61 → 288
  if (!_isLayoutCalculated) return;                      // case 61/64
  invariant(index >= -1 && index <= detents.length - 1,
    "'index' was provided but out of the provided snap points range! expected value to be between -1, " + (detents.length - 1));
  const nextPosition = detents[index];
  const {nextPosition: _nextPosition, nextIndex, isForcedClosing} = animatedAnimationState.get();  // slot43
  if (!isLayoutCalculated.value) return;                 // case ~190 → 286
  if (index === nextIndex)            return;            // case 196 → 286   ⭐
  if (nextPosition === _nextPosition) return;            // case 200 → 286   ⭐
  if (isForcedClosing)                return;            // case 204 → 286
  isInTemporaryPosition.value = false;                   // slot35
  runOnUI(animateToPosition)(nextPosition, ANIMATION_SOURCE.USER, 0, animationConfigs);  // ⭐⭐ A REAL ANIMATION
});
```
Because it is a **`useStableCallback`**, and Climate's `index` is a frozen `useState(0)[0]`, **all four
useEffect deps are constant ⇒ the effect runs exactly ONCE, on mount.**

**This is a genuine `animateToPosition(582, ANIMATION_SOURCE.USER, 0, undefined)` from
`animatedPosition = INITIAL_POSITION = SCREEN_HEIGHT = 852` ⇒ a 270px SLIDE UP to 582.**

Whether it lands is a **race** (see §6).

### 4c. Which one actually runs on a plain Climate open?
Two, in an order decided by a React-passive-effect-flush vs Reanimated-mapper-microtask race:
**#4 (mount `useEffect` → `handleSnapToIndex(0)` → `animateToPosition(582, USER)`)** and
**#1 (detents reaction → `evaluatePosition(SNAP_POINT_CHANGE)`)**. #2/#3/#5/#6/#7/#8 do not fire.

---

## 5. `useBottomSheetForceUpdate` — the 500ms poke: **it CANNOT re-fire the detents reaction**

Impl (iOS **4036936-4036999**, module 8715, deps `[3, 2471, 712]`) — confirms the recon's decode:
```js
function useBottomSheetForceUpdate() {
  const forceUpdate = useSharedValue(-1);
  useDerivedValue(() => forceUpdate.value, [forceUpdate]);   // __workletHash 6833109788851
  useEffect(() => {
    setTimeout(() => { logEng('[BOTTOM SHEET] forceUpdate mapper rerun'); forceUpdate.value = 1; }, 500);
  }, [forceUpdate]);
}
```

**`createMapperRegistry_reactNativeReanimated_mappersTs1`, iOS 1369116, VERBATIM (key parts):**
```js
function mapperRun() {
  runRequested = false;
  if (processingMappers) { return; }
  try {
    processingMappers = true;
    if (mappers.size !== sortedMappers.length) { updateMappersOrder(); }
    for (const mapper of sortedMappers) { if (mapper.dirty) { mapper.dirty = false; mapper.worklet(); } }   // ⭐ DIRTY ONLY
  } finally { processingMappers = false; runRequested = false; }
}
…
start: function (mapperID, worklet, inputs, outputs) {
  const mapper = {id: mapperID, dirty: true, worklet, inputs: extractInputs(inputs, []), outputs};
  mappers.set(mapper.id, mapper);
  sortedMappers = [];                                          // ⭐ forces a re-sort on the next run
  for (const sv of mapper.inputs) { sv.addListener(mapper.id, function () { mapper.dirty = true; maybeRequestUpdates(); }); }
  maybeRequestUpdates();
},
```
and `updateMappersOrder()` builds `pre` **only from mappers that have `outputs`** — `useAnimatedReaction`
mappers have `outputs === undefined`, so they are pure sinks.

**Therefore:** a mapper runs only if **its own registered input shared-values** were written
(`sv.addListener(… mapper.dirty = true …)`). `forceUpdate` is an input of exactly one mapper — the
`useDerivedValue(() => forceUpdate.value)` inside the hook. Nothing consumes that derived value.
**Writing `forceUpdate.value = 1` marks that one mapper dirty and nothing else.** The detents reaction's
inputs are `animatedDetentsState`-derived; they are untouched.

⇒ **§1a(5) answer: NO.** The 500ms poke cannot cause the detents reaction (@1783100) to re-fire, and
nothing makes `detents` differ on such a re-run. The hook's *only* real cross-effect is at **mount**, not
at 500ms: its `useDerivedValue` calls `start()`, which sets `sortedMappers = []`, which forces
`updateMappersOrder()` (a full topological re-sort of the **global** mapper graph) on the next `mapperRun`.
That is the only plausible thing it "fixes" — a stale global mapper ordering.

**Why Tesla added it:** the only evidence in the bundle is the log string
`'[BOTTOM SHEET] forceUpdate mapper rerun'` (iOS 4036986). There is **no comment and no other log**
explaining the bug. Given the analysis above, the hook is a **cargo-cult workaround** — the author's
mental model ("poke a shared value ⇒ the mapper tree re-runs") is contradicted by the mapper registry
in the same bundle. My best-supported reading: they were chasing the sheet occasionally being stuck at
`INITIAL_POSITION` (852, off-screen) because both #1 and #4 above can bail (see §6), and a 500ms nudge
appeared to help. **INFERRED — the intent is not documented anywhere in the bundle.**

**It is NOT Climate-specific.** 7 call sites (iOS): **4816154, 4819040, 5058320, 5222570 (Climate),
7486923, 7772799, 9397651**.

---

## 6. Conclusion — where the slide comes from

**`detents[0]` is NOT proven to change on a plain Climate open, and it does not need to.**
§1a's framing — *"the slide requires detents[0] to CHANGE after the first resolve, because
`animateToPosition` early-returns when `position === animatedPosition.get()`"* — assumed
`isAnimatedOnMount` starts `false` and that the first resolve therefore parks `animatedPosition` at 582
via the mount branch. **Both halves are wrong:**

1. `isAnimatedOnMount = useSharedValue(!animateOnMount || _providedIndex === -1)` ⇒ **`true` for Climate**
   (iOS 1783465-1783472). The mount branch of `evaluatePosition` is **dead code** here.
2. Therefore `animatedPosition` is still `INITIAL_POSITION = 852` when the first `evaluatePosition` runs,
   and `proposedPosition = detents[currentIndex] = detents[0] = 582`. `582 !== 852` ⇒ **`animateToPosition`
   does NOT early-return.**

The **only** thing standing between that and a slide is `animatedContainerHeightDidChange`, which
`gorhom_BottomSheetTsx16` sets to `true` when containerHeight goes `-999 → 852` and which nothing clears
before the detents reaction fires. That routes the first resolve to `setToPosition` ⇒ instant.

So a plain Climate open has **two** candidate movers, racing:

- **#4 mount `useEffect` → `handleSnapToIndex(0)` → `animateToPosition(582, ANIMATION_SOURCE.USER, 0, undefined)`,
  animating `animatedPosition` 852 → 582 with gorhom's default spring.** ⭐ **This is the strongest
  candidate for the observed slide, and it is a translation of exactly the right magnitude (270px, bottom → up).**
  It lands iff the passive-effect flush happens *after* `detents`/`isLayoutCalculated` resolve but *before*
  the detents reaction's `setToPosition` stamps `animatedAnimationState.nextIndex = 0` /
  `nextPosition = 582` (which would trip `if (index === nextIndex) return;` / `if (nextPosition === _nextPosition) return;`).
- **#1 detents reaction → `evaluatePosition(SNAP_POINT_CHANGE)`** → `setToPosition(582)` (instant) while
  `animatedContainerHeightDidChange` is still `true`; a *later* detents change (only if `contentHeight`
  crosses 255) would then reach `animateToPosition`.

**§1b should target #4 (the mount `useEffect` at iOS 1786644 → `handleSnapToIndex` at iOS 1785363), not
the detents reaction.** The animation is gorhom's default spring, since Climate passes no `animationConfigs`
and `handleSnapToIndex` forwards `animationConfigs = undefined` ⇒ `configs || _providedAnimationConfigs`
⇒ `undefined` ⇒ `animate()`'s built-in default.

### What I looked at and ruled out
- Module 4120 (LIVE gorhom v5) worklet slots `_closure1_slot8` … `_closure1_slot31` (iOS 1783032-1783125) — all dumped.
- `useAnimatedDetents` (1773286), `normalizeSnapPoint` (1774333), `useAnimatedLayout` (1774800-1775200),
  `INITIAL_*` constants (1773757, 1777800-1777820).
- BottomSheetView content onLayout (1791819, 1791925-1791960); `useBottomSheetContentSizeSetter` (1780007-1780072).
- The whole `BottomSheet` component body (1783128-1786900): prop destructuring, all shared-value inits,
  `handleSnapToIndex`, `handleSnapToPosition`, the imperative handle, all 4 `useAnimatedReaction`s, the mount `useEffect`.
- Reanimated mapper registry (1369116) — proves the forceUpdate poke is inert.
- **Ruled out as the mover:** `gorhom_BottomSheetTsx16` (needs RUNNING+GESTURE+nextIndex===-1),
  `gorhom_BottomSheetTsx20` (keyboard UNDETERMINED guard), gesture handlers (need a drag),
  `useBottomSheetForceUpdate` (inert per the mapper registry),
  the v4 copies `tesla_useNormalizedSnapPointsTs1` @1748976 / `tesla_BottomSheetTsx19` @1752017 (DEAD — different module).
