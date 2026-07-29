import { forwardRef, useCallback, useImperativeHandle, useMemo, useRef, useState, type ReactNode } from 'react';
import {
  Animated,
  PanResponder,
  StyleSheet,
  useWindowDimensions,
  View,
  type GestureResponderHandlers,
  type NativeScrollEvent,
  type NativeSyntheticEvent,
} from 'react-native';

// Visible fraction of the screen at each detent (measured off the Tesla app's three states). Exported so the
// map can pad its centring/fitting by these panel heights.
export const SHEET_MINIMAL_FRAC = 0.25;
export const SHEET_MIDDLE_FRAC = 0.34;
// A middle detent a bit taller than the default, shared by the location list + charger + dropped-pin/POI
// preview sheets so they rest at a consistent, roomier height (between the default middle and full).
export const SHEET_TALL_FRAC = 0.43;
const SHEET_FULL_FRAC = 0.92;

export interface BottomSheetHandle {
  expand: () => void; // open at least to the middle detent (never shrinks)
  collapse: () => void; // drop to the minimal detent
  expandFull: () => void; // open to the full detent
  // The visible screen fraction the sheet currently rests at — but the MIDDLE detent's fraction when fully
  // extended, so a map fit that pads by this never reserves (nearly) the whole screen. Lets the map frame
  // content just above wherever the sheet actually is (minimal / middle / full), not a hardcoded height.
  reserveFrac: () => number;
}

// Props to spread on the consumer's scroll container so it scrolls only when the sheet is fully expanded and
// reports its offset (for the "at top → swipe down lowers the sheet" hand-off).
export interface SheetScrollProps {
  scrollEnabled: boolean;
  // false only while a fully-expanded list is SETTLED at its top — kills the native iOS TOP rubber-band so a
  // downward drag lowers the sheet cleanly; true everywhere else so BOTTOM/end over-scroll AND scrolling back
  // up to the top still bounce.
  bounces: boolean;
  onScroll: (e: NativeSyntheticEvent<NativeScrollEvent>) => void;
  onScrollEndDrag: (e: NativeSyntheticEvent<NativeScrollEvent>) => void;
  onMomentumScrollEnd: (e: NativeSyntheticEvent<NativeScrollEvent>) => void;
  scrollEventThrottle: number;
}

interface RenderProps {
  dragHandlers: GestureResponderHandlers; // the top handle strip
  expandFull: () => void;
  collapseToMiddle: () => void;
  // Spread on a View wrapping the scroll container: drags resize the sheet (not-full) or lower it (full+top).
  contentPanHandlers: GestureResponderHandlers;
  // Spread on the scroll container itself (ScrollView/FlatList). See SheetScrollProps.
  scrollProps: SheetScrollProps;
  // Latch OFF the content pan while an internal drag (e.g. a row reorder) owns the gesture.
  setContentBusy: (busy: boolean) => void;
  // Whether the sheet currently rests at the full detent (lets a consumer remember the detent, expand to
  // full for a mode, then restore it on exit). No current consumer — kept as part of the sheet's contract.
  atFull: boolean;
}
interface Props {
  children: (props: RenderProps) => ReactNode;
  // 'middle' locks the sheet so it can't be dragged below the middle detent (used by the place-preview
  // sheet, which keeps its pinned action button in view). Default 'minimal' = the full three-detent range.
  lowestDetent?: 'minimal' | 'middle';
  // Override the middle detent's visible screen fraction. The place-preview sheet uses the taller
  // SHEET_TALL_FRAC detent.
  middleFrac?: number;
  // Freeze the sheet size (no handle/body resize) for a consumer that pins itself to one detent. No current
  // consumer — kept as part of the sheet's contract.
  locked?: boolean;
}

const OVERDRAG_RESIST = 2.5;
const overDrag = (y: number, expanded: number, collapsed: number) => {
  if (y < expanded) return expanded - Math.sqrt(1 + (expanded - y)) * OVERDRAG_RESIST;
  if (y > collapsed) return collapsed + Math.sqrt(1 + (y - collapsed)) * OVERDRAG_RESIST;
  return y;
};

// Bottom-anchored panel dragged by its top handle between three detents (full / middle / minimal), shared by
// LocationSheet (search/charging) and PlacePreviewSheet (a pin/POI). The body coordinates scroll-vs-resize: not fully
// expanded → a body drag resizes the sheet; fully expanded → the list scrolls, and a downward drag at the top
// lowers the sheet.
export const BottomSheet = forwardRef<BottomSheetHandle, Props>(function BottomSheet(
  { children, lowestDetent = 'minimal', middleFrac = SHEET_MIDDLE_FRAC, locked = false },
  ref,
) {
  const { height } = useWindowDimensions();
  const lockedRef = useRef(locked); // read live from the PanResponder closures
  lockedRef.current = locked;
  const SHEET_H = Math.round(height * SHEET_FULL_FRAC);
  const snaps = useMemo(() => {
    const full = 0;
    const middle = Math.round(SHEET_H - height * middleFrac);
    const minimal = Math.round(SHEET_H - height * SHEET_MINIMAL_FRAC);
    const points = lowestDetent === 'middle' ? [full, middle] : [full, middle, minimal];
    return { full, middle, minimal, points, collapsed: points[points.length - 1] };
  }, [SHEET_H, height, lowestDetent, middleFrac]);
  const snapsRef = useRef(snaps);
  snapsRef.current = snaps;

  const translateY = useRef(new Animated.Value(snaps.middle)).current;
  const restingY = useRef(snaps.middle);
  const contentBusy = useRef(false); // an internal drag (reorder) owns the gesture → the sheet pan yields
  const [atFull, setAtFull] = useState(false); // reactive: drives scrollEnabled on the body
  // "The list is SETTLED at its top." Drives `bounces` (off only here) and the down-drag-lowers-the-sheet
  // capture. Kept as a ref too so the PanResponder closure reads the live value. Flips false the instant you
  // scroll away from the top; flips back true only when a scroll SETTLES at the top (not mid-scroll), so
  // scrolling back UP to the top still bounces.
  const [atTop, setAtTop] = useState(true);
  const atTopRef = useRef(true);
  const markAtTop = useCallback((v: boolean) => {
    if (atTopRef.current !== v) {
      atTopRef.current = v;
      setAtTop(v);
    }
  }, []);

  const settle = useCallback(
    (target: number, velocityY = 0) => {
      restingY.current = target;
      setAtFull(target === snapsRef.current.full);
      Animated.spring(translateY, {
        toValue: target,
        velocity: velocityY * 500,
        stiffness: 1000,
        damping: 500,
        mass: 3,
        overshootClamping: true,
        restDisplacementThreshold: 0.5,
        restSpeedThreshold: 0.5,
        useNativeDriver: true,
      }).start();
    },
    [translateY],
  );

  const onMove = useCallback(
    (dy: number) => {
      const s = snapsRef.current;
      translateY.setValue(overDrag(restingY.current + dy, s.full, s.collapsed));
    },
    [translateY],
  );
  const onRelease = useCallback(
    (dy: number, vy: number) => {
      const s = snapsRef.current;
      // Commit toward the drag direction once you've travelled ~35% of the way to the next detent — plain
      // "nearest" (50%) felt sticky on a tall middle↔full gap (SHEET_TALL_FRAC: "sometimes up, sometimes stuck
      // in the middle"). Amplifying dy + weighting the fling velocity lets a normal swipe snap to the next
      // detent instead of falling back.
      const projected = restingY.current + dy * 1.4 + vy * 260;
      const target = s.points.reduce(
        (best, p) => (Math.abs(p - projected) < Math.abs(best - projected) ? p : best),
        s.points[0],
      );
      settle(target, vy);
    },
    [settle],
  );

  useImperativeHandle(
    ref,
    () => ({
      expand: () => settle(Math.min(restingY.current, snapsRef.current.middle)),
      collapse: () => settle(snapsRef.current.collapsed),
      expandFull: () => settle(snapsRef.current.full),
      reserveFrac: () => {
        const s = snapsRef.current;
        // Fully extended → reserve only the middle detent's height (never the whole screen).
        const y = restingY.current === s.full ? s.middle : restingY.current;
        return (SHEET_H - y) / height;
      },
    }),
    [settle, SHEET_H, height],
  );

  // The top handle strip: always resizes the sheet.
  const handlePan = useRef(
    PanResponder.create({
      onMoveShouldSetPanResponderCapture: (_e, g) => !lockedRef.current && Math.abs(g.dy) > 8 && Math.abs(g.dy) > Math.abs(g.dx),
      onPanResponderMove: (_e, g) => onMove(g.dy),
      onPanResponderRelease: (_e, g) => onRelease(g.dy, g.vy),
    }),
  ).current;

  // The body: resizes the sheet when not fully expanded; when fully expanded, only a downward drag at the top
  // of the list is captured (to lower the sheet) — everything else falls through to the scroll container.
  const contentPan = useRef(
    PanResponder.create({
      onMoveShouldSetPanResponderCapture: (_e, g) => {
        if (lockedRef.current) return false; // Edit mode: sheet size is frozen (scroll/reorder still pass through)
        if (contentBusy.current) return false; // a reorder drag owns the gesture
        if (Math.abs(g.dy) <= Math.abs(g.dx)) return false; // horizontal → row swipe / let through
        if (restingY.current !== snapsRef.current.full) return Math.abs(g.dy) > 6; // not full → resize
        return g.dy > 6 && atTopRef.current; // full → drag down while SETTLED at the top → lower the sheet
      },
      onPanResponderMove: (_e, g) => onMove(g.dy),
      onPanResponderRelease: (_e, g) => onRelease(g.dy, g.vy),
    }),
  ).current;

  const setContentBusy = useCallback((busy: boolean) => {
    contentBusy.current = busy;
  }, []);

  const renderProps: RenderProps = {
    dragHandlers: handlePan.panHandlers,
    expandFull: () => settle(snapsRef.current.full),
    collapseToMiddle: () => settle(snapsRef.current.middle),
    contentPanHandlers: contentPan.panHandlers,
    scrollProps: {
      scrollEnabled: atFull,
      // Off only while SETTLED at the top (there a downward drag = lower the sheet; killing the native top
      // rubber-band avoids the flash/snap-back under the pan). onScroll flips it false the moment you scroll
      // away (so BOTTOM over-scroll bounces); it turns back on only when a scroll SETTLES at the top, so
      // scrolling UP into the top edge still rubber-bands (the reported case).
      bounces: !(atFull && atTop),
      onScroll: (e) => {
        if (e.nativeEvent.contentOffset.y > 0) markAtTop(false);
      },
      onScrollEndDrag: (e) => markAtTop(e.nativeEvent.contentOffset.y <= 0),
      onMomentumScrollEnd: (e) => markAtTop(e.nativeEvent.contentOffset.y <= 0),
      scrollEventThrottle: 16,
    },
    setContentBusy,
    atFull,
  };

  return (
    <Animated.View style={[styles.sheet, { height: SHEET_H, transform: [{ translateY }] }]}>
      {/* Grabber made invisible (and non-draggable) while locked, so the frozen sheet doesn't invite a drag —
          but it still occupies its 4px so the content below doesn't shift when toggling Edit. */}
      <View style={styles.handleWrap} {...(locked ? {} : handlePan.panHandlers)}>
        <View style={[styles.handle, locked && styles.handleHidden]} />
      </View>
      {children(renderProps)}
    </Animated.View>
  );
});

const styles = StyleSheet.create({
  sheet: {
    position: 'absolute',
    left: 0,
    right: 0,
    bottom: 0,
    backgroundColor: '#161616',
    borderTopLeftRadius: 16,
    borderTopRightRadius: 16,
    shadowColor: '#000',
    shadowOffset: { width: 0, height: -8 },
    shadowOpacity: 0.5,
    shadowRadius: 16,
  },
  // The location sheet shares Tesla's Climate grabber: the FlippableSheetHandle shared component
  // (used by both the Climate and Location modules — FlippedSheetHandle @1333626 sits among
  // LocationSwitchDropdownListItem/selectedLocationType) → `styles.indicator` 100x4 radius 4,
  // backgroundColor colors.backgroundTertiary = #2D2D2D, in a `container` padded 10.
  handleWrap: { alignItems: 'center', paddingTop: 10, paddingBottom: 10 },
  handle: { width: 100, height: 4, borderRadius: 4, backgroundColor: '#2D2D2D' },
  handleHidden: { opacity: 0 },
});
