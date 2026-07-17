# R8 — my independent findings (iOS main.decompiled.js v4.56)

## THE HEADLINE: team's "320 = sheet height" theory is KILLED
**Climate BottomSheet `snapPoints = [270]`** — iOS **5222718** (`r11 = [270]; r7['snapPoints'] = r11;`).
It is the ONLY `snapPoints` in the whole Climate module (5220000-5232000), and `320` appears EXACTLY ONCE in that
module — at 5222037, inside the frame formula itself. So **320 is NOT the sheet's height. The sheet is 270.**

## BottomSheet props verbatim (iOS 5222699)
```
{ 'index': <r11>, 'onChange': <fn120844>, 'snapPoints': [270],
  'animateOnMount': false, 'enableDynamicSizing': true, 'enableOverDrag': true,
  'enableHandlePanningGesture': true, 'enableContentPanningGesture': true,
  'enablePanDownToClose': false, 'keyboardBehavior': 'extend' }
```
- `onChange` (fn #120844): `if (index === -1) slot35(0)` → snaps back to index 0; the sheet never stays closed.
- `enableDynamicSizing: true` ⇒ gorhom ADDS a second, content-derived snap:
  `push(containerHeight - min(contentHeight + handleHeight, maxDynamicContentSize ?? containerHeight))`, sorted desc.
  ⇒ **collapsed/peek = 270 (explicit); expanded = contentHeight + handleHeight (DYNAMIC, not a literal).**
- gorhom normalize (iOS 1749649): `normalizeSnapPoint(sp, containerHeight) = max(0, containerHeight - sp)` ⇒ snapPoints are HEIGHTS → positions.

## Geometry on 393×852 / statusBarOffset 59
- Car band (R7): top 59, height 553 ⇒ band spans **y 59..612**.
- Sheet collapsed 270 ⇒ sheet top **y = 852 − 270 = 582** (IF containerHeight = full window 852 — VERIFY container).
- ⇒ the car band's bottom **30pt** sits BEHIND the sheet (612 − 582 = 30). There IS an overlap, but **30pt, not 80**.
- Team's sheet = `useWindowDimensions().height * 0.25` = **213** ⇒ **57pt too short** (270 − 213). Directly explains
  the user's "the sheet is smaller", and their sheet top 639 leaves a 27pt gap instead of a 30pt overlap.

## Sheet styles (Climate module StyleSheet, iOS 5221173-5221261) — registers still to resolve
- `bottomSheet` = { backgroundColor: Colors.<r5>, elevation: <r13> }
- `bottomSheetBackgroundStyle` = { borderRadius: <r5> }
- `bottomSheetHandler` = { height: <r7> }
- `bottomSheetShadow` = { shadowOffset: {width:0, height:10}, shadowOpacity: 1, shadowRadius: 20 }
- inline at call site (5222720-5222760): backgroundStyle = [bottomSheetBackgroundStyle, bottomSheetShadow,
  {backgroundColor: theme.backgroundColor, shadowColor: Colors.black}];
  handleStyle = bottomSheetHandler; handleComponent = SheetHandle (module 46);
  handleIndicatorStyle = [handleIndicator, {backgroundColor: theme.reverseTextColor}];
  style = bottomSheet; BottomSheetView style = {backgroundColor: theme.backgroundColor}
  ⇒ **sheet is OPAQUE (solid theme.backgroundColor), no BlurView.**
- Also seen: {'borderTopLeftRadius': 0, 'borderTopRightRadius': 0} at 5224172 (context TBD).

## Still open (for readers/verifier)
- `index` (initial snap) — r11 source not yet located.
- containerHeight for the sheet (full window 852? or a safe-area-inset container?) → decides sheet top y.
- borderRadius / handler height / elevation / Colors token values.
- Whether frame is re-sent on drag (dynamic band) — `useBottomSheetForceUpdate`, `setScreenOverlayColor` @5222082.

## SHEET STYLES — RESOLVED VERBATIM (iOS 5221165-5221190, contiguous)
```
r4 = {}; r5 = Colors.transparentWhite; r4['backgroundColor'] = r5; r13 = 1; r4['elevation'] = r13;
r0['bottomSheet'] = r4;                       // = { backgroundColor: Colors.transparentWhite, elevation: 1 }
r4 = {}; r5 = 0; r4['borderRadius'] = r5;
r0['bottomSheetBackgroundStyle'] = r4;        // = { borderRadius: 0 }   <-- SQUARE CORNERS, no radius
r4 = {}; r7 = 12; r4['height'] = r7;
r0['bottomSheetHandler'] = r4;                // = { height: 12 }
r4 = {'shadowOffset': null, 'shadowOpacity': 1, 'shadowRadius': 20}; r10 = {'width':0,'height':10}; r4['shadowOffset'] = r10;
r0['bottomSheetShadow'] = r4;                 // = { shadowOffset:{width:0,height:10}, shadowOpacity:1, shadowRadius:20 }
```
`r0['handleIndicator'] = {'marginTop': 2, 'width': 60}` (iOS 5221261) — grabber 60 wide, marginTop 2.
`r0['headerGradient'] = {'height': 300, 'position':'absolute', 'width':'100%', 'zIndex': -10}` (4294967286 = -10).

### Call-site composition (iOS 5222720-5222760)
- `backgroundStyle` = [ bottomSheetBackgroundStyle{borderRadius:0}, bottomSheetShadow{...}, { backgroundColor: theme.backgroundColor, shadowColor: Colors.black } ]
- `handleStyle` = bottomSheetHandler {height:12};  `handleComponent` = SheetHandle (module 46; def iOS 1766121)
- `handleIndicatorStyle` = [ handleIndicator{marginTop:2,width:60}, { backgroundColor: theme.reverseTextColor } ]
- `style` = bottomSheet { backgroundColor: Colors.transparentWhite, elevation: 1 }
- `BottomSheetView` style = { backgroundColor: theme.backgroundColor }
⇒ **Sheet is OPAQUE (solid theme.backgroundColor). NO BlurView / translucency. borderRadius 0 (square top corners).**

## ANSWERS
1. collapsed/peek = **270**; expanded = contentHeight+handleHeight (**dynamic**, enableDynamicSizing); snapPoints=[270] only.
2. **Is 320 the sheet height? NO — KILLED.** Sheet is 270. 320 appears only in the frame formula (5222037).
3. **+80 is NOT a 320-sheet overlap.** Net −240 ⇒ band 59..612; sheet top (270) = 582 ⇒ real overlap = **30pt**, not 80.
4. **Opaque**, theme.backgroundColor, no blur, shadow (0,10)/r20/opacity1/black.
5. **borderRadius 0**; handle area height 12; grabber width 60, marginTop 2, color theme.reverseTextColor.
6. Frame re-send on drag — OPEN (reader).

## WHY "ours shows more hood" — explained WITHOUT any scale change
Tesla visible car region = 59..**582** (opaque sheet crops the band's bottom 30pt).
Team  visible car region = 59..**612** + a 27pt empty gap to their sheet top at 639.
⇒ team shows **30pt more of the car's bottom** (the hood in this top-down CLIMATE view) and 57pt more open space.
Same scale (0.6491), same center_y (335.5), same pose. **Fix the sheet to 270 and the extra hood disappears.**
