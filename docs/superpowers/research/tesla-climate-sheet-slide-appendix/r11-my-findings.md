# R11 — my independent read (iOS main.decompiled.js v4.56)

## §1 — THE MOUNT GATE IS A FIRST-TIME-ONLY GATE. R10 §3a was wrong.
Climate's BottomSheet = **deps[10] = module 4054** (Climate deps array @5225197), registered @1772174 ⇒ the **`gorhom_*`** worklets
(1773286, 1783036-1783108) ARE the live copy. (R10's verifier's "module 4120" is a misnumber; same worklets.)

`evaluatePosition_Gorhom_BottomSheetTsx12` (iOS **1783076**) VERBATIM:
```js
if (!isLayoutCalculated.value) return;
const proposedPosition = getEvaluatedPosition(source);
if (proposedPosition === undefined) return;
if (!isAnimatedOnMount.value) {                                  // ← FIRST TIME ONLY
  if (animateOnMount) animateToPosition(proposedPosition, ANIMATION_SOURCE.MOUNT, undefined, animationConfigs);
  else { setToPosition(proposedPosition); isAnimatedOnMount.value = true; }   // ← Climate: INSTANT + FLIPS THE GATE
  return;
}
… if (animatedContainerHeightDidChange.value) { setToPosition(proposedPosition); return; }   // container change = INSTANT
animateToPosition(proposedPosition, source, undefined, animationConfigs);                     // ⭐ EVERY LATER CALL ANIMATES
```
`gorhom_BottomSheetTsx18` (iOS **1783100**) = detents useAnimatedReaction VERBATIM:
```js
if (JSON.stringify(result) === JSON.stringify(previous) && isAnimatedOnMount.value) return;
if (!isLayoutCalculated.value) return;
evaluatePosition(ANIMATION_SOURCE.SNAP_POINT_CHANGE);
```
⇒ **`animateOnMount:false` only suppresses the FIRST placement — and sets `isAnimatedOnMount = true`, ARMING every later
detents change to ANIMATE.** That is how `animateOnMount:false` coexists with a real slide.

`setToPosition_Gorhom_BottomSheetTsx9` (1783064): bare write `animatedPosition.value = targetPosition` (+ `stopAnimation()`,
`animatedContainerHeightDidChange.value = false`). Guard `if (!targetPosition) return;` is **falsy** (position 0 skipped).
`animateToPosition_Gorhom_BottomSheetTsx7` (1783056): early-returns `if (position === animatedPosition.get())`;
ends `animatedPosition.value = animate({point, configs: configs || _providedAnimationConfigs, velocity, overrideReduceMotion, onComplete})`.
The detents reaction passes NO configs ⇒ **`_providedAnimationConfigs`** (the `animationConfigs` prop) ⇒ Climate passes none ⇒ gorhom default.

`gorhom_useAnimatedDetentsTs1` (iOS **1773286**) VERBATIM — the detents source:
```js
const {containerHeight, handleHeight, contentHeight} = layoutState.get();
if (containerHeight === INITIAL_LAYOUT_VALUE) return {};
let _normalizedDetents = _detents.map(sp => normalizeSnapPoint(sp, containerHeight));
let closedDetentPosition = containerHeight;  // ($modal||detached → +bottomInset)
if (!enableDynamicSizing) return {detents:_normalizedDetents, …};
if (contentHeight === INITIAL_LAYOUT_VALUE) return {};
if (handleHeight  === INITIAL_LAYOUT_VALUE) return {};
const dynamicSnapPoint = containerHeight - Math.min(contentHeight + handleHeight, maxDynamicContentSize ?? containerHeight);
if (!_normalizedDetents.includes(dynamicSnapPoint)) _normalizedDetents.push(dynamicSnapPoint);
_normalizedDetents = _normalizedDetents.sort((a,b) => b-a);       // DESCENDING
```
⇒ detents[0] = **max(582, dynamic)** on 852; dynamic = 852 − (contentHeight + 15).
⇒ **detents[0] CHANGES iff contentHeight crosses 255** (below 255 → dynamic > 582 → detents[0] = dynamic; above → 582).
⇒ short-then-tall content ⇒ detents[0] drops ⇒ `animateToPosition(582, SNAP_POINT_CHANGE)` ⇒ **SLIDE UP**. (TO CONFIRM.)

`gorhom_BottomSheetTsx16` (1783092) container-height reaction: sets `animatedContainerHeightDidChange = result !== previous`;
only animates on `status===RUNNING && source===GESTURE && nextIndex===-1`. Not our path.

**Tesla's `useBottomSheetForceUpdate`** (module 8715, impl iOS 4036936; Climate calls it @5222570):
```js
const forceUpdate = useSharedValue(-1);
useDerivedValue(() => forceUpdate.value, [forceUpdate]);
useEffect(() => { setTimeout(() => { logEng('[BOTTOM SHEET] forceUpdate mapper rerun'); forceUpdate.value = 1; }, 500); }, [forceUpdate]);
```
A **500ms** poke to force Reanimated's mapper tree to re-run — Tesla knew a mapper wasn't firing. Prime suspect for the re-fire.

## §2 — THE DARK LINE = `StatusBarFade`. FOUND.
Climate render (fn #120821): `if (r63) → <LinearGradient style={headerGradient} …/> else → <StatusBarFade/>` (case 2649).
**`r63 = (useContext(ThemeContext).theme === AppTheme.CYBERTRUCK)`** (iOS 5221532) ⇒ the 300pt `headerGradient` is
**CYBERTRUCK-THEME ONLY** — the user's red Model Y NEVER renders it. (My own first lead, killed.)

**Non-CT ⇒ `<StatusBarFade />` with EMPTY props** = `deps[9]` = module **8567**, default export, fn #96623 @ iOS **3931473**:
```jsx
function StatusBarFade({colors, start, end, style}) {
  const theme = useContext(ThemeContext);
  if (colors == null) colors = [theme.v5BackgroundColor, theme.v5BackgroundColorTransparent];
  return <Fragment>{Platform.OS === 'ios' &&      // ⚠️ iOS-ONLY — Android renders NOTHING [differ]
    <Animated.View style={[styles.statusBarContainer, style]}>
      <LinearGradient style={styles.statusBarFade} colors={colors}
                      start={{x:0, y: start ?? 0}} end={{x:0, y: end ?? 1}} />
    </Animated.View>}</Fragment>;
}
```
Styles (iOS 3931461-3931470) VERBATIM:
```js
statusBarContainer = { height: Specifications.statusBarHeight, left: 0, right: 0, top: 0, position: 'absolute' };
statusBarFade      = { height: '100%', width: '100%' };
```
⇒ **a `statusBarHeight`-tall (59pt) full-width vertical gradient pinned to the very top, background→transparent.**
LIGHT theme: `v5BackgroundColor = #FAFAFA` → `v5BackgroundColorTransparent = '#FAFAFA00'` (iOS 1337927-1337929).
DARK theme: `v5BackgroundColor = <r18>`, `…Transparent = <r17>` (iOS 1338121-1338122) — hexes TO RESOLVE.
Its height is literally `Specifications.statusBarHeight` — the R9 function. Also used elsewhere via a `showStatusBarFade`
prop (defaults object @9170250 has `showStatusBarFade: true`); a 2nd copy of the component exists @4188443.
